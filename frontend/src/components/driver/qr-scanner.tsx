"use client";

import {
  CameraSlashIcon,
  CheckIcon,
  FlashlightIcon,
  KeyboardIcon,
  LockKeyIcon,
  QrCodeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { parseCarSticker } from "@/lib/driver-api";
import { cn } from "@/lib/utils";

// Minimal typing for the browser's built-in QR reader (Chrome on Android has it; iPhone Safari does not yet).
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};
type JsQr = typeof import("jsqr").default;

type Phase = "starting" | "scanning" | "found" | "denied" | "nocamera" | "insecure" | "failed";

/** The big "Scan car QR" button on the driver home; opens the scanner and goes to the car page. */
export function ScanCarButton() {
  const t = useTranslations("scanner");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="xl" lift onClick={() => setOpen(true)} className="gap-3">
        <QrCodeIcon size={24} weight="bold" />
        {t("scanButton")}
      </Button>
      <QrScanner
        open={open}
        onOpenChange={setOpen}
        onCar={(code, v) => router.push(`/c/${encodeURIComponent(code)}${v ? `?v=${v}` : ""}`)}
        onTypeCode={() => {
          setOpen(false);
          setTimeout(() => document.getElementById("car-code")?.focus(), 250);
        }}
      />
    </>
  );
}

/**
 * Full-screen camera that reads a car's QR sticker. Uses the browser's own QR reader when there is one,
 * otherwise jsQR on a small crop of the frame (works on every phone). Only our car stickers are accepted.
 */
export function QrScanner({
  open,
  onOpenChange,
  onCar,
  onTypeCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCar: (code: string, v: string | null) => void;
  onTypeCode: () => void;
}) {
  const t = useTranslations("scanner");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-0 z-50 overflow-hidden bg-ink text-white"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.04 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <Dialog.Title className="sr-only">{t("title")}</Dialog.Title>
                <ScannerBody onCar={onCar} onTypeCode={onTypeCode} />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function ScannerBody({
  onCar,
  onTypeCode,
}: {
  onCar: (code: string, v: string | null) => void;
  onTypeCode: () => void;
}) {
  const t = useTranslations("scanner");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [notOurs, setNotOurs] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // the latest callback, without restarting the camera when the parent re-renders
  const onCarRef = useRef(onCar);
  useEffect(() => {
    onCarRef.current = onCar;
  });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let notOursTimer: ReturnType<typeof setTimeout> | undefined;
    let lastRejected = "";

    async function run() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setPhase("insecure");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "nocamera" : "failed");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch({ available: Boolean(caps.torch), on: false });
      setPhase("scanning");

      // Pick a reader: the browser's own if it can read QR codes, else jsQR (loaded only when needed).
      let detector: BarcodeDetectorLike | null = null;
      const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (Native) {
        try {
          const formats = (await Native.getSupportedFormats?.()) ?? ["qr_code"];
          if (formats.includes("qr_code")) detector = new Native({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      const jsQR: JsQr | null = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (cancelled) return;
        let text: string | null = null;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          try {
            if (detector) {
              text = (await detector.detect(video))[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              // a centre square (where the frame is drawn), scaled down: fast enough on older phones
              const side = Math.min(video.videoWidth, video.videoHeight) * 0.85;
              const size = 480;
              canvas.width = size;
              canvas.height = size;
              ctx.drawImage(
                video,
                (video.videoWidth - side) / 2,
                (video.videoHeight - side) / 2,
                side,
                side,
                0,
                0,
                size,
                size,
              );
              const img = ctx.getImageData(0, 0, size, size);
              text = jsQR(img.data, size, size, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
          } catch {
            text = null;
          }
        }
        if (cancelled) return;
        if (text) {
          const car = parseCarSticker(text);
          if (car) {
            setPhase("found");
            navigator.vibrate?.(40);
            timer = setTimeout(() => {
              stop();
              onCarRef.current(car.code, car.v);
            }, 550);
            return;
          }
          if (text !== lastRejected) {
            lastRejected = text;
            setNotOurs(true);
            clearTimeout(notOursTimer);
            notOursTimer = setTimeout(() => {
              setNotOurs(false);
              lastRejected = "";
            }, 2600);
          }
        }
        timer = setTimeout(tick, detector ? 120 : 180);
      };
      timer = setTimeout(tick, 250);
    }

    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(notOursTimer);
      stop();
    };
  }, [attempt, stop]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch((s) => ({ ...s, on }));
    } catch {
      setTorch({ available: false, on: false });
    }
  }

  const failed = phase === "denied" || phase === "nocamera" || phase === "insecure" || phase === "failed";
  const found = phase === "found";

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-hidden="true"
        className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-500", phase === "scanning" || found ? "opacity-100" : "opacity-0")}
      />

      {!failed ? (
        // The viewfinder: everything outside the square is dimmed by one huge shadow.
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <motion.div
            className="relative aspect-square w-[min(72vw,20rem)] rounded-[1.75rem] shadow-[0_0_0_200vmax_rgb(5_10_34/0.64)]"
            animate={found ? { scale: 0.94 } : { scale: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
          >
            {(["top-0 left-0 border-t-4 border-l-4 rounded-tl-[1.75rem]", "top-0 right-0 border-t-4 border-r-4 rounded-tr-[1.75rem]", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-[1.75rem]", "right-0 bottom-0 border-r-4 border-b-4 rounded-br-[1.75rem]"] as const).map((c) => (
              <span
                key={c}
                className={cn("absolute size-12 transition-colors duration-200", c, found ? "border-ok-dot" : "border-white")}
              />
            ))}
            {phase === "scanning" ? (
              <span className="absolute inset-x-5 top-5 h-0.5 rounded-full bg-sky shadow-[0_0_14px_3px_rgb(159_180_245/0.7)] [--scan-travel:calc(min(72vw,20rem)-2.6rem)] motion-safe:animate-scan" />
            ) : null}
            <AnimatePresence>
              {found ? (
                <motion.span
                  className="absolute inset-0 flex items-center justify-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <motion.span
                    className="flex size-20 items-center justify-center rounded-full bg-ok-dot text-white shadow-2xl"
                    initial={{ scale: 0.3 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 520, damping: 17 }}
                  >
                    <CheckIcon size={44} weight="bold" />
                  </motion.span>
                </motion.span>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </div>
      ) : null}

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="font-display text-lg font-semibold drop-shadow">{t("title")}</p>
        <Dialog.Close asChild>
          <button
            type="button"
            aria-label={t("close")}
            className="inline-flex size-12 items-center justify-center rounded-full bg-black/40 backdrop-blur active:scale-95"
          >
            <XIcon size={24} weight="bold" />
          </button>
        </Dialog.Close>
      </div>

      {/* "that is not a car sticker" note */}
      <AnimatePresence>
        {notOurs && !found ? (
          <motion.p
            role="status"
            className="absolute inset-x-6 top-[calc(50%+min(36vw,10rem)+1.25rem)] mx-auto max-w-sm rounded-2xl bg-wait-bg px-4 py-3 text-center text-sm font-semibold text-wait-fg shadow-lg"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            {t("notOurs")}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <motion.div
            className="flex max-w-sm flex-col items-center gap-3 text-center"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="inline-flex size-16 items-center justify-center rounded-2xl bg-white/10 text-sky">
              {phase === "insecure" ? <LockKeyIcon size={32} weight="duotone" /> : <CameraSlashIcon size={32} weight="duotone" />}
            </span>
            <p className="font-display text-xl font-semibold">{t(`${phase}Title`)}</p>
            <p className="text-[#c9d3ea]">{t(`${phase}Body`)}</p>
            {phase === "denied" || phase === "failed" ? (
              <Button variant="inverse" className="mt-2" onClick={() => { setPhase("starting"); setAttempt((n) => n + 1); }}>
                {t("tryAgain")}
              </Button>
            ) : null}
          </motion.div>
        </div>
      ) : null}

      {/* bottom bar */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {!failed ? <p className="text-center text-sm text-white/85 drop-shadow">{phase === "starting" ? t("starting") : t("hint")}</p> : null}
        <div className="flex items-center gap-3">
          {torch.available ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torch.on}
              aria-label={t("torch")}
              className={cn(
                "inline-flex size-14 items-center justify-center rounded-full backdrop-blur transition-colors active:scale-95",
                torch.on ? "bg-white text-ink" : "bg-black/40 text-white",
              )}
            >
              <FlashlightIcon size={26} weight={torch.on ? "fill" : "regular"} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onTypeCode}
            className="inline-flex h-14 items-center gap-2 rounded-full bg-black/40 px-5 text-sm font-bold backdrop-blur active:scale-95"
          >
            <KeyboardIcon size={20} weight="bold" />
            {t("typeInstead")}
          </button>
        </div>
      </div>
    </div>
  );
}
