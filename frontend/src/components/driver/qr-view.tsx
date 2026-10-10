"use client";

import { ArrowsClockwiseIcon, CircleNotchIcon, LockKeyIcon, QrCodeIcon, WarningIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { QrCode } from "@/components/ui/qr-code";
import { ApiError } from "@/lib/api";
import { driverApi, loadQr, saveQr, type ActiveTrip, type Qr, type Trip } from "@/lib/driver-api";
import { useWakeLock } from "@/lib/hooks";

import { ReasonSheet } from "./reason-sheet";
import { tripErrorKey } from "./trip-errors";
import { TripProgress } from "./trip-progress";

type Stage = "start" | "end";

/**
 * The one-time QR the passenger scans: Start QR while waiting for the passenger, End QR after the end form.
 * Navy full screen so the white code stands out; the screen is kept on; a ring shows how long the code lasts.
 */
export function QrView({
  stage,
  active,
  onRefresh,
  onFinished,
  onCancelled,
}: {
  stage: Stage;
  active: ActiveTrip & { trip: Trip };
  onRefresh: () => Promise<void>;
  onFinished: (trip: Trip) => void;
  onCancelled: () => void;
}) {
  const t = useTranslations("qrView");
  const tr = useTranslations("reasons");
  const te = useTranslations("tripErrors");
  const { trip } = active;
  const blocked = stage === "start" ? active.start_qr_blocked : active.end_qr_blocked;

  const [qr, setQr] = useState<Qr | null>(() => loadQr(trip.id, stage));
  const [expired, setExpired] = useState(false);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"cancel" | "cantScan" | null>(null);

  useWakeLock(Boolean(qr) && !expired && !blocked);

  async function newQr() {
    setMaking(true);
    setError(null);
    try {
      const res = stage === "start" ? (await driverApi.newStartQr(trip.id)).start_qr : (await driverApi.newEndQr(trip.id)).end_qr;
      saveQr(trip.id, stage, res);
      setQr(res);
      setExpired(false);
    } catch (err) {
      setError(te(tripErrorKey(err)));
      if (err instanceof ApiError && (err.status === 423 || err.status === 409)) await onRefresh();
    } finally {
      setMaking(false);
    }
  }

  const totalSeconds = active.qr_expiry_minutes * 60;
  const showCode = qr && !blocked;

  return (
    <div className="flex min-h-dvh flex-col bg-navy text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-gutter pt-[max(0.9rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* compact top: everything the passenger needs has to fit on one phone screen with the buttons */}
        <TripProgress status={trip.status} withPassenger={trip.with_passenger} />
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-xs text-sky">
              {trip.trip_no} · {trip.car_code}
            </span>
            <span className="truncate text-sm font-semibold">
              {stage === "start" ? `${trip.start_place} → ${trip.destination}` : `${trip.destination} · ${trip.distance_km ?? 0} km`}
            </span>
          </div>
          <LanguageSwitch tone="onDark" />
        </div>

        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-[1.4rem] leading-tight font-bold">{stage === "start" ? t("startTitle") : t("endTitle")}</h1>
          <p className="text-sm text-[#c9d3ea]">
            {stage === "start"
              ? t("startBody")
              : trip.start_no_scan_reason && !trip.passenger_name
                ? t("endBodyIdentify")
                : trip.is_visitor
                  ? t("endBodyVisitor")
                  : t("endBody")}
          </p>
        </div>

        {/* the code */}
        <div className="flex justify-center">
          <div className="relative rounded-[1.75rem] bg-white p-4 shadow-[0_0_0_10px_var(--color-navy-2),0_24px_48px_rgb(0_0_0/0.3)]">
            <AnimatePresence mode="wait" initial={false}>
              {blocked ? (
                <motion.div key="blocked" className="flex size-[13rem] flex-col items-center justify-center gap-3 text-center text-[#a3182f]" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <LockKeyIcon size={48} weight="duotone" />
                  <p className="px-2 text-sm font-bold">{t("blocked")}</p>
                </motion.div>
              ) : showCode ? (
                <motion.div
                  key={qr.url}
                  initial={{ rotateY: 90, opacity: 0 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  exit={{ rotateY: -90, opacity: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="relative"
                >
                  <QrCode value={qr.url} size={208} label={stage === "start" ? t("startCodeLabel") : t("endCodeLabel")} className={expired ? "blur-[6px] opacity-40 transition" : "transition"} />
                  {expired ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                      <p className="font-display text-lg font-bold text-navy">{t("expired")}</p>
                      <Button onClick={() => void newQr()} disabled={making}>
                        {making ? <CircleNotchIcon size={20} className="animate-spin" /> : <ArrowsClockwiseIcon size={20} weight="bold" />}
                        {t("newQr")}
                      </Button>
                    </div>
                  ) : null}
                </motion.div>
              ) : (
                <motion.div key="none" className="flex size-[13rem] flex-col items-center justify-center gap-3 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <QrCodeIcon size={52} weight="duotone" className="text-sky" />
                  <p className="px-2 text-sm font-semibold text-[#5a6478]">{t("noCode")}</p>
                  <Button onClick={() => void newQr()} disabled={making}>
                    {making ? <CircleNotchIcon size={20} className="animate-spin" /> : <QrCodeIcon size={20} weight="bold" />}
                    {t("showQr")}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            <p className="mt-2.5 text-center font-display text-[0.75rem] font-semibold tracking-[0.12em] text-navy uppercase">
              {stage === "start" ? t("startCodeLabel") : t("endCodeLabel")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl bg-navy-2/60 px-4 py-2.5">
          {showCode && !expired ? (
            <CountdownRing key={qr.url} expiresAt={qr.expires_at} totalSeconds={totalSeconds} size={44} label={t("untilExpires")} onExpire={() => setExpired(true)} />
          ) : (
            <span className="text-sm text-[#c9d3ea]">{blocked ? t("blockedShort") : t("noCodeShort")}</span>
          )}
          <span className="flex items-center gap-2 text-right text-xs font-semibold text-[#c9d3ea]" aria-live="polite">
            <span className="inline-flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1.5 rounded-full bg-sky"
                  animate={{ opacity: [0.25, 1, 0.25] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </span>
            {t("waitingFor")}
          </span>
        </div>

        {active.reminders.length ? (
          <p className="flex items-start gap-2 rounded-2xl bg-wait-bg px-4 py-3 text-sm font-medium text-wait-fg">
            <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
            {t("reminder")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm font-semibold text-bad-fg">
            {error}
          </p>
        ) : null}

        <div className="mt-auto flex flex-col gap-2">
          {active.allow_cant_scan ? (
            <Button variant="outlineInverse" size="md" className="h-12" onClick={() => setSheet("cantScan")}>
              {t("cantScan")}
            </Button>
          ) : null}
          <div className="flex gap-2.5">
            {!blocked ? (
              <Button variant="inverse" size="md" className="h-12 flex-1" onClick={() => void newQr()} disabled={making}>
                <ArrowsClockwiseIcon size={18} weight="bold" />
                {t("newQr")}
              </Button>
            ) : null}
            {stage === "start" ? (
              <Button variant="inverse" size="md" className="h-12 flex-1 text-[#ffc2cd]" onClick={() => setSheet("cancel")}>
                {t("cancelTrip")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ReasonSheet
        open={sheet === "cancel"}
        onOpenChange={(o) => setSheet(o ? "cancel" : null)}
        title={t("cancelTitle")}
        description={t("cancelBody")}
        reasons={[tr("cancel1"), tr("cancel2"), tr("cancel3")]}
        confirmLabel={t("cancelConfirm")}
        danger
        onConfirm={async (reason) => {
          try {
            await driverApi.cancel(trip.id, reason);
            setSheet(null);
            onCancelled();
          } catch (err) {
            return te(tripErrorKey(err));
          }
        }}
      />
      <ReasonSheet
        open={sheet === "cantScan"}
        onOpenChange={(o) => setSheet(o ? "cantScan" : null)}
        title={t("cantScanTitle")}
        description={t("cantScanBody")}
        reasons={[tr("cantScan1"), tr("cantScan2"), tr("cantScan3")]}
        confirmLabel={stage === "start" ? t("cantScanConfirmStart") : t("cantScanConfirmEnd")}
        onConfirm={async (reason) => {
          try {
            if (stage === "start") {
              await driverApi.cantScanStart(trip.id, reason);
              setSheet(null);
              await onRefresh();
            } else {
              const res = await driverApi.cantScanEnd(trip.id, reason);
              setSheet(null);
              onFinished(res.trip);
            }
          } catch (err) {
            return te(tripErrorKey(err));
          }
        }}
      />
    </div>
  );
}
