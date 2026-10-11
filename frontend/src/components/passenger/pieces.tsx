"use client";

import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  ImageIcon,
  LockKeyIcon,
  ProhibitIcon,
  WarningCircleIcon,
  WifiSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { ApiError, NETWORK_ERROR } from "@/lib/api";
import { useNowSeconds } from "@/lib/hooks";
import { DEAD_CODES, openTripOnThisPhone } from "@/lib/passenger-api";
import { cn } from "@/lib/utils";

import { ScanEndButton } from "./scan-end";

/** The navy card with the trip: car, driver, from and to, time. */
export function TripCard({
  carCode,
  carModel,
  driver,
  from,
  to,
  time,
  timeLabel,
  children,
}: {
  carCode: string;
  carModel: string;
  driver: string;
  from: string;
  to: string;
  time: string;
  /** Default "Time"; the end page says "Ended". */
  timeLabel?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("passenger");
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-4 rounded-panel bg-navy p-5 text-left text-white shadow-lift">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-2xl font-bold">{carCode}</span>
        <span className="truncate text-sm text-[#c9d3ea]">{carModel}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Item label={t("driver")} value={driver} />
        <Item label={timeLabel ?? t("time")} value={format.dateTime(new Date(time), { hour: "numeric", minute: "2-digit" })} mono />
        <Item label={t("from")} value={from} wrap />
        <Item label={t("to")} value={to} wrap />
      </dl>
      {children}
    </div>
  );
}

function Item({ label, value, mono, wrap }: { label: string; value: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-sky">{label}</dt>
      <dd className={cn("text-[0.95rem] leading-snug font-semibold", wrap ? "line-clamp-2 break-words" : "truncate", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

/** "Code valid for 12:31". Calls onExpired once when the time is up. */
export function CodeTimer({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const t = useTranslations("passenger");
  const now = useNowSeconds();
  const end = Math.floor(new Date(expiresAt).getTime() / 1000);
  const left = now === null ? null : Math.max(0, end - now);
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpired();
    }
  }, [left, onExpired]);
  if (left === null) return null;
  const urgent = left <= 60;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors",
        urgent ? "bg-wait-bg text-wait-fg" : "bg-soft text-title",
      )}
    >
      <ClockCountdownIcon size={14} weight="bold" />
      {t("validFor")}
      <span className="font-mono tabular-nums">
        {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
      </span>
    </span>
  );
}

/** Small "see photo" button that opens the dashboard photo full screen (pinch to zoom on the phone). */
export function PhotoButton({ src, label, alt }: { src: string; label: string; alt: string }) {
  const t = useTranslations("passenger");
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-full bg-white/12 px-3.5 text-sm font-bold text-white transition-colors hover:bg-white/20 active:scale-95"
        >
          <ImageIcon size={16} weight="bold" />
          {label}
        </button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-40 bg-ink/95 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
              >
                <Dialog.Title className="sr-only">{alt}</Dialog.Title>
                {/* eslint-disable-next-line @next/next/no-img-element -- photo behind a one-time code, not a site image */}
                <img src={src} alt={alt} className="max-h-[80dvh] w-full rounded-2xl object-contain shadow-2xl" onError={() => setFailed(true)} />
                <p className="text-center text-sm font-semibold text-[#c9d3ea]">{alt}</p>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label={t("closePhoto")}
                    className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 inline-flex size-12 items-center justify-center rounded-full bg-black/50 text-white"
                  >
                    <XIcon size={22} weight="bold" />
                  </button>
                </Dialog.Close>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

const DEAD_LOOK: Record<string, { Icon: typeof ProhibitIcon; tone: "ok" | "wait" | "bad" }> = {
  QR_USED: { Icon: CheckCircleIcon, tone: "ok" }, // already confirmed: nothing wrong, nothing to do
  QR_EXPIRED: { Icon: ClockCountdownIcon, tone: "wait" },
  QR_REPLACED: { Icon: ArrowsClockwiseIcon, tone: "wait" },
  OFFLINE: { Icon: WifiSlashIcon, tone: "wait" },
  QR_BLOCKED: { Icon: LockKeyIcon, tone: "bad" },
  TRIP_CANCELLED: { Icon: ProhibitIcon, tone: "bad" },
  OTHER: { Icon: ProhibitIcon, tone: "wait" },
};

const noSubscribe = () => () => {};

/**
 * The code cannot be used (expired, used, replaced, blocked, cancelled ...): one clear message, what to do next.
 * A start code opened again later on the phone that confirmed it ("already used") also offers the end scan.
 */
export function DeadCode({ code }: { code: string }) {
  const t = useTranslations("passenger.dead");
  const tp = useTranslations("passenger");
  const key = ["QR_INVALID", "WRONG_QR", "QR_USED", "TRIP_CANCELLED", "QR_BLOCKED", "QR_REPLACED", "QR_EXPIRED", "TRIP_NOT_WAITING", "OFFLINE"].includes(code)
    ? code
    : "OTHER";
  const { Icon, tone } = DEAD_LOOK[key] ?? DEAD_LOOK.OTHER;
  // this browser's storage (the server sees nothing there, so the button appears after hydration)
  const raw = useSyncExternalStore(
    noSubscribe,
    () => (key === "QR_USED" ? openTripOnThisPhone.raw() : null),
    () => null,
  );
  const openTrip = useMemo(() => openTripOnThisPhone.parse(raw), [raw]);
  return (
    <div className="flex flex-col gap-4">
      <Reveal>
        <Card className="flex flex-col items-start gap-3 border-0 p-6 shadow-lift">
          <motion.span
            className={cn(
              "inline-flex size-14 items-center justify-center rounded-2xl",
              tone === "ok" ? "bg-ok-bg text-ok-fg" : tone === "bad" ? "bg-bad-bg text-bad-fg" : "bg-wait-bg text-wait-fg",
            )}
            initial={{ rotate: -12, scale: 0.8 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 14 }}
          >
            <Icon size={28} weight="duotone" />
          </motion.span>
          <h1 className="font-display text-2xl font-bold text-title">{t(`${key}.title`)}</h1>
          <p className="text-muted">{t(`${key}.body`)}</p>
        </Card>
      </Reveal>
      <AnimatePresence>
        {openTrip ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
            <p className="text-sm text-muted">{tp("onTripNow", { car: openTrip.car_code })}</p>
            <ScanEndButton />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const CONFETTI = Array.from({ length: 22 }, (_, i) => {
  const angle = -Math.PI / 2 + ((i / 21) - 0.5) * Math.PI * 1.25; // a fan upwards
  const speed = 96 + (i % 5) * 16; // stays inside a 320 px wide phone
  return {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed,
    fall: 150 + (i % 4) * 30,
    rotate: (i % 2 ? 1 : -1) * (180 + i * 25),
    colour: ["#155dfc", "#2bb683", "#f5a524", "#9fb4f5", "#284dae", "#ff5c7a"][i % 6],
    w: i % 3 === 0 ? 6 : 9,
    h: i % 3 === 0 ? 6 : 4,
    delay: 0.32 + (i % 5) * 0.025,
  };
});

/** Green tick that draws itself, with a soft ring pulsing out once. `celebrate`: a little confetti too. */
export function SuccessMark({ celebrate = false }: { celebrate?: boolean }) {
  return (
    <div className="relative mx-auto flex size-24 items-center justify-center">
      {celebrate ? (
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2">
          {CONFETTI.map((c, i) => (
            <motion.span
              key={i}
              className="absolute rounded-[2px]"
              style={{ width: c.w, height: c.h, background: c.colour, marginLeft: -c.w / 2, marginTop: -c.h / 2 }}
              initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
              animate={{ x: [0, c.x, c.x * 1.1], y: [0, c.y, c.y + c.fall], opacity: [0, 1, 1, 0], rotate: c.rotate }}
              transition={{
                duration: 1.6,
                delay: c.delay,
                x: { duration: 1.6, delay: c.delay, times: [0, 0.4, 1], ease: ["easeOut", "linear"] },
                y: { duration: 1.6, delay: c.delay, times: [0, 0.4, 1], ease: ["easeOut", "easeIn"] },
                opacity: { duration: 1.6, delay: c.delay, times: [0, 0.08, 0.75, 1] },
              }}
            />
          ))}
        </span>
      ) : null}
      <motion.span
        className="absolute inset-0 rounded-full bg-ok-dot/25"
        initial={{ scale: 0.6, opacity: 0.9 }}
        animate={{ scale: 1.7, opacity: 0 }}
        transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
      />
      <motion.span
        className="relative flex size-24 items-center justify-center rounded-full bg-ok-dot text-white shadow-xl"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 16 }}
      >
        <svg viewBox="0 0 24 24" className="size-12" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.2 }} />
        </svg>
      </motion.span>
    </div>
  );
}

/** Turns an API error into one line for the form, or switches the page to a full notice (dead code). */
export function useErrorText(typed: "id" | "phone" = "id") {
  const t = useTranslations("passenger.errors");
  return (err: unknown, onDead: (code: string) => void): string | null => {
    if (!(err instanceof ApiError)) return t("generic");
    if (err.code === NETWORK_ERROR || err.code === "BACKEND_DOWN") return t("network");
    if (DEAD_CODES.has(err.code)) {
      onDead(err.code);
      return null;
    }
    const left = typeof err.detail.tries_left === "number" ? err.detail.tries_left : null;
    if (left === 0) {
      onDead("QR_BLOCKED");
      return null;
    }
    if (err.code === "BAD_ID_FORMAT") return t("BAD_ID_FORMAT");
    if (err.code === "ID_MISMATCH" && typed === "phone") return left !== null ? t("phoneMismatchLeft", { left }) : t("phoneMismatch");
    if (err.code === "ID_MISMATCH") return left !== null ? t("mismatchLeft", { left }) : t("mismatch");
    if (["DRIVER_CANNOT_CONFIRM", "PASSENGER_IS_DRIVER", "PASSENGER_INACTIVE", "VISITORS_NOT_ALLOWED", "WRONG_PASSENGER_TYPE", "NAME_REQUIRED"].includes(err.code)) return t(err.code);
    if (err.status === 422) return t("checkFields");
    return t("generic");
  };
}

/** Shakes its children when `shake` changes (a wrong ID). */
export function Shake({ shake, children }: { shake: number; children: React.ReactNode }) {
  const [scope, animate] = useAnimate();
  useEffect(() => {
    if (shake > 0 && scope.current) animate(scope.current, { x: [0, -10, 10, -7, 7, -3, 3, 0] }, { duration: 0.42 });
  }, [shake, animate, scope]);
  return <div ref={scope}>{children}</div>;
}

export function ErrorText({ text }: { text: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {text ? (
        <motion.p
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-start gap-2 overflow-hidden text-sm font-semibold text-bad-fg"
        >
          <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
          {text}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}
