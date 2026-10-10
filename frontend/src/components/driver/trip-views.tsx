"use client";

import {
  ArrowLeftIcon,
  CheckIcon,
  CircleNotchIcon,
  FlagCheckeredIcon,
  InfoIcon,
  ProhibitIcon,
  UserIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { LiveDot } from "@/components/ui/live-dot";
import { Odometer } from "@/components/ui/odometer";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { StatusChip } from "@/components/ui/status-chip";
import { driverApi, saveQr, type ActiveTrip, type Trip } from "@/lib/driver-api";
import { useGeolocation, useNowSeconds } from "@/lib/hooks";
import { cn } from "@/lib/utils";

import { DriverFrame } from "./driver-frame";
import { LocationField } from "./location-field";
import { PhotoField } from "./photo-field";
import { tripErrorKey } from "./trip-errors";
import { TripProgress } from "./trip-progress";

// ---- helpers ------------------------------------------------------------------------------------------------

function secondsBetween(fromIso: string | null, to: number | null): number | null {
  if (!fromIso || to === null) return null;
  return Math.max(0, to - Math.floor(new Date(fromIso).getTime() / 1000));
}

function useDuration() {
  const t = useTranslations("time");
  return (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? t("hoursMinutes", { h, m }) : t("minutes", { m });
  };
}

/** From → To with a moving dashed line between the two points. */
function Route({ from, to, fromNote, toNote }: { from: string; to: string; fromNote?: string; toNote?: string }) {
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
      <div className="row-span-2 flex flex-col items-center pt-1.5">
        <span className="size-3 rounded-full border-[3px] border-accent" />
        <span className="my-1 w-0.5 flex-1 overflow-hidden">
          <span className="block h-[200%] w-full bg-[repeating-linear-gradient(var(--border-strong)_0_5px,transparent_5px_10px)] motion-safe:animate-[route-dash_1.2s_linear_infinite]" />
        </span>
        <span className="size-3 rounded-[3px] bg-signal" />
      </div>
      <div className="flex flex-col pb-5">
        {fromNote ? <span className="text-xs text-muted">{fromNote}</span> : null}
        <span className="font-semibold">{from}</span>
      </div>
      <div className="flex flex-col">
        {toNote ? <span className="text-xs text-muted">{toNote}</span> : null}
        <span className="font-semibold">{to}</span>
      </div>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function PassengerRow({ trip }: { trip: Trip }) {
  const t = useTranslations("tripView");
  if (!trip.with_passenger) {
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-soft text-muted">
          <UserIcon size={20} />
        </span>
        <div className="flex flex-col">
          <span className="font-bold">{t("noPassenger")}</span>
          {trip.purpose ? <span className="text-sm text-muted">{trip.purpose}</span> : null}
        </div>
      </div>
    );
  }
  const name = trip.passenger_name;
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-soft font-display font-semibold text-title">
        {name ? initials(name) : <UserIcon size={20} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{name ?? t("passengerUnconfirmed")}</span>
        <span className="text-sm text-muted">{trip.is_visitor ? t("visitor") : t("employee")}</span>
      </div>
      {trip.start_no_scan_reason ? (
        <StatusChip status="waiting" size="sm">
          {t("notConfirmed")}
        </StatusChip>
      ) : name ? (
        <StatusChip status="available" size="sm">
          {t("confirmed")}
        </StatusChip>
      ) : null}
    </div>
  );
}

// ---- trip in progress ---------------------------------------------------------------------------------------

export function InProgressView({ active, onEnd }: { active: ActiveTrip & { trip: Trip }; onEnd: () => void }) {
  const t = useTranslations("tripView");
  const format = useFormatter();
  const now = useNowSeconds();
  const { trip } = active;
  const started = trip.journey_start_time ?? trip.start_time;
  const elapsed = secondsBetween(started, now);
  const h = elapsed === null ? 0 : Math.floor(elapsed / 3600);
  const m = elapsed === null ? 0 : Math.floor((elapsed % 3600) / 60);
  const s = elapsed === null ? 0 : elapsed % 60;
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "numeric", minute: "2-digit" });

  return (
    <DriverFrame
      header={
        <div className="flex flex-col gap-4">
          <TripProgress status={trip.status} withPassenger={trip.with_passenger} />
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-sm text-sky">
              {trip.trip_no} · {trip.car_code}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-signal px-2.5 py-1 text-xs font-bold text-white">
              <LiveDot className="bg-white" />
              {t("onTrip")}
            </span>
          </div>
          <div className="flex flex-col gap-0.5" aria-live="off">
            <span className="text-sm text-[#c9d3ea]">{t("drivingFor")}</span>
            <span className="flex items-baseline gap-2 font-display text-5xl font-bold tabular-nums">
              {elapsed === null ? "–" : h > 0 ? t("hm", { h, m }) : t("m", { m })}
              <span className="font-mono text-lg font-medium text-sky tabular-nums">:{String(s).padStart(2, "0")}</span>
            </span>
            <span className="text-sm text-[#c9d3ea]">
              {trip.journey_start_time
                ? trip.passenger_name && !trip.start_no_scan_reason
                  ? t("startedWith", { time: time(trip.journey_start_time), name: trip.passenger_name })
                  : t("startedAt", { time: time(trip.journey_start_time) })
                : t("startedAt", { time: time(trip.start_time) })}
            </span>
          </div>
        </div>
      }
    >
      <Stagger className="flex flex-col gap-4">
        <StaggerItem>
          <Card className="flex flex-col gap-5 border-0 p-5 shadow-lift">
            <Route from={trip.start_place} to={trip.destination} fromNote={t("from")} toNote={t("to")} />
            <div className="h-px bg-border" />
            <PassengerRow trip={trip} />
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted">{t("startKm")}</span>
              <Odometer value={trip.start_km} size="sm" rollIn={false} />
            </div>
          </Card>
        </StaggerItem>
        {trip.start_no_scan_reason ? (
          <StaggerItem>
            <p className="flex items-start gap-2.5 rounded-2xl bg-soft px-4 py-3 text-sm text-title">
              <InfoIcon size={18} weight="fill" className="mt-px shrink-0 text-accent" />
              {t("needsApproval")}
            </p>
          </StaggerItem>
        ) : null}
        {active.reminders.length ? (
          <StaggerItem>
            <p className="flex items-start gap-2.5 rounded-2xl bg-wait-bg px-4 py-3 text-sm font-medium text-wait-fg">
              <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
              {t("longTripReminder")}
            </p>
          </StaggerItem>
        ) : (
          <StaggerItem>
            <p className="flex items-start gap-2.5 rounded-2xl bg-wait-bg/70 px-4 py-3 text-sm text-wait-fg">
              <FlagCheckeredIcon size={18} weight="fill" className="mt-px shrink-0" />
              {t("arriveReminder")}
            </p>
          </StaggerItem>
        )}
        <StaggerItem>
          <Button size="xl" lift onClick={onEnd} className="h-16 text-lg">
            {t("endTrip")}
          </Button>
        </StaggerItem>
      </Stagger>
    </DriverFrame>
  );
}

// ---- end form -----------------------------------------------------------------------------------------------

export function EndForm({
  trip,
  onBack,
  onEnded,
}: {
  trip: Trip;
  onBack: () => void;
  onEnded: (result: { trip: Trip; hasQr: boolean }) => void;
}) {
  const t = useTranslations("tripForm");
  const tv = useTranslations("tripView");
  const te = useTranslations("tripErrors");
  const { geo, retry } = useGeolocation();
  const [km, setKm] = useState("");
  const [place, setPlace] = useState(trip.destination);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [missing, setMissing] = useState<Partial<Record<"km" | "place" | "photo", true>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); // from the server
  const [attempted, setAttempted] = useState(false);

  function touch(field: "km" | "place" | "photo") {
    setMissing((m) => ({ ...m, [field]: undefined }));
    setError(null);
  }

  const kmNum = /^\d{1,7}$/.test(km) ? Number(km) : NaN;
  const valid = Number.isFinite(kmNum) && kmNum > trip.start_km;
  const distance = valid ? kmNum - trip.start_km : 0;
  const tooLow = Number.isFinite(kmNum) && km.length >= String(trip.start_km).length && kmNum <= trip.start_km;

  const message = error ?? (attempted && Object.values(missing).some(Boolean) ? t("fixHighlighted") : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const miss: typeof missing = {};
    if (!valid) miss.km = true;
    if (!place.trim()) miss.place = true;
    if (!photo) miss.photo = true;
    setMissing(miss);
    setAttempted(true);
    if (Object.keys(miss).length) return;
    const form = new FormData();
    form.set("end_km", String(kmNum));
    form.set("end_place", place.trim());
    if (geo.status === "ok") {
      form.set("end_lat", String(geo.lat));
      form.set("end_lng", String(geo.lng));
    }
    form.set("photo", photo!, "dashboard-end.jpg");
    setBusy(true);
    setError(null);
    try {
      const res = await driverApi.end(trip.id, form);
      if (res.end_qr) saveQr(trip.id, "end", res.end_qr);
      navigator.vibrate?.(30);
      onEnded({ trip: res.trip, hasQr: Boolean(res.end_qr) });
    } catch (err) {
      setBusy(false);
      const key = tripErrorKey(err);
      if (key === "END_KM_TOO_LOW") setMissing({ km: true });
      if (key === "PHOTO_TOO_LARGE" || key === "INVALID_PHOTO") setMissing({ photo: true });
      setError(te(key, { km: trip.start_km }));
    }
  }

  return (
    <DriverFrame
      hideFooter
      header={
        <div className="flex flex-col gap-4">
          <TripProgress status={trip.status} withPassenger={trip.with_passenger} />
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold tracking-[0.14em] text-sky uppercase">{tv("endEyebrow")}</p>
            <h1 className="font-display text-3xl font-bold">{tv("endTitle")}</h1>
            <p className="text-sm text-[#c9d3ea]">
              {trip.car_code} · {trip.trip_no}
            </p>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Stagger className="flex flex-col gap-4">
          <StaggerItem>
            <div className="flex flex-col gap-4 rounded-card bg-card p-4 shadow-lift sm:p-5">
              <Field
                label={t("endKm")}
                htmlFor="f-endkm"
                error={tooLow || missing.km ? t("endKmTooLow", { km: trip.start_km.toLocaleString("en-US") }) : undefined}
                hint={!tooLow && !missing.km ? t("endKmHint", { km: trip.start_km.toLocaleString("en-US") }) : undefined}
              >
                <Input
                  id="f-endkm"
                  mono
                  autoFocus
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={7}
                  placeholder={String(trip.start_km)}
                  value={km}
                  onChange={(e) => {
                    setKm(e.target.value.replace(/\D/g, ""));
                    touch("km");
                  }}
                  invalid={tooLow || missing.km}
                />
              </Field>
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-soft px-4 py-3">
                <span className="text-sm font-semibold text-title">{t("distance")}</span>
                <span className="flex items-end gap-2">
                  <Odometer value={distance} minDigits={3} size="sm" rollIn={false} />
                  <span className="pb-0.5 text-sm font-semibold text-muted">km</span>
                </span>
              </div>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="flex flex-col gap-4 rounded-card bg-card p-4 sm:p-5">
              <LocationField
                id="f-place"
                label={t("endPlace")}
                value={place}
                onChange={(v) => {
                  setPlace(v);
                  touch("place");
                }}
                geo={geo}
                onRetry={retry}
                invalid={missing.place}
              />
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="rounded-card bg-card p-4 sm:p-5">
              <PhotoField
                id="f-photo-end"
                label={t("photoEnd")}
                hint={t("photoHint")}
                value={photo}
                onChange={(p) => {
                  setPhoto(p);
                  touch("photo");
                }}
                invalid={missing.photo}
              />
            </div>
          </StaggerItem>
        </Stagger>

        <AnimatePresence initial={false}>
          {message ? (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2 rounded-xl bg-bad-bg px-3.5 py-3 text-sm font-semibold text-bad-fg"
            >
              <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
              {message}
            </motion.p>
          ) : null}
        </AnimatePresence>

        <div className="sticky bottom-0 z-10 -mx-gutter flex flex-col gap-2 bg-gradient-to-t from-bg via-bg to-transparent px-gutter pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="submit" size="xl" lift disabled={busy} aria-busy={busy}>
            {busy ? (
              <>
                <CircleNotchIcon size={22} className="animate-spin" />
                {t("ending")}
              </>
            ) : trip.with_passenger ? (
              t("endWithQr")
            ) : (
              t("endNoPassenger")
            )}
          </Button>
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeftIcon size={16} weight="bold" />
            {t("notYet")}
          </Button>
        </div>
      </form>
    </DriverFrame>
  );
}

// ---- finished -----------------------------------------------------------------------------------------------

/** "Trip complete": the odometer rolls from the start km to the end km, with the key numbers below. */
export function SummaryView({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const t = useTranslations("tripView");
  const duration = useDuration();
  const started = trip.journey_start_time ?? trip.start_time;
  const seconds = trip.end_time ? Math.max(0, (new Date(trip.end_time).getTime() - new Date(started).getTime()) / 1000) : null;
  const pending = trip.approval_status === "pending";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative overflow-hidden rounded-b-[2rem] bg-navy px-gutter pt-[max(2.5rem,env(safe-area-inset-top))] pb-20 text-center text-white">
        <Burst />
        <div className="relative mx-auto flex max-w-md flex-col items-center gap-3">
          <motion.span
            className="flex size-20 items-center justify-center rounded-full bg-ok-dot text-white shadow-xl"
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 16, delay: 0.1 }}
          >
            <svg viewBox="0 0 24 24" className="size-11" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.35 }} />
            </svg>
          </motion.span>
          <Reveal delay={0.25} className="flex flex-col gap-1">
            <h1 className="font-display text-3xl font-bold">{t("completeTitle")}</h1>
            <p className="font-mono text-sm text-sky">
              {trip.trip_no} · {trip.car_code}
            </p>
          </Reveal>
        </div>
      </header>
      <main className="relative z-10 mx-auto -mt-12 flex w-full max-w-md flex-1 flex-col gap-4 px-gutter pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Reveal delay={0.35}>
          <Card className="flex flex-col items-center gap-2 border-0 p-5 shadow-lift">
            <span className="text-sm font-semibold text-muted">{t("odometerNow")}</span>
            <Odometer value={trip.end_km ?? trip.start_km} from={trip.start_km} size="lg" unit="km" />
          </Card>
        </Reveal>
        <Stagger className="grid grid-cols-2 gap-3">
          <StaggerItem>
            <Stat label={t("distance")} value={`${trip.distance_km ?? 0} km`} />
          </StaggerItem>
          <StaggerItem>
            <Stat label={t("duration")} value={seconds === null ? "–" : duration(seconds)} />
          </StaggerItem>
        </Stagger>
        <Reveal delay={0.5}>
          <Card className="flex flex-col gap-5 p-5">
            <Route from={trip.start_place} to={trip.end_place ?? trip.destination} />
            <div className="h-px bg-border" />
            <PassengerRow trip={trip} />
          </Card>
        </Reveal>
        {pending ? (
          <Reveal delay={0.6}>
            <p className="flex items-start gap-2.5 rounded-2xl bg-soft px-4 py-3 text-sm text-title">
              <InfoIcon size={18} weight="fill" className="mt-px shrink-0 text-accent" />
              {t("pendingApproval")}
            </p>
          </Reveal>
        ) : null}
        <div className="mt-auto pt-2">
          <Button size="xl" lift onClick={onDone}>
            <CheckIcon size={20} weight="bold" />
            {t("done")}
          </Button>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex h-full flex-col gap-1 p-4">
      <span className="text-xs font-bold tracking-wide text-muted uppercase">{label}</span>
      <span className="font-display text-2xl font-bold text-title">{value}</span>
    </Card>
  );
}

/** Small dots flying out behind the tick, once. */
function Burst() {
  const dots = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    const dist = 90 + (i % 3) * 26;
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, c: ["#9fb4f5", "#2bb683", "#ffffff", "#e59a1a"][i % 4], s: 6 + (i % 3) * 2 };
  });
  return (
    <div aria-hidden="true" className="pointer-events-none absolute top-[calc(max(2.5rem,env(safe-area-inset-top))+2.5rem)] left-1/2">
      {dots.map((d, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ width: d.s, height: d.s, background: d.c, marginLeft: -d.s / 2, marginTop: -d.s / 2 }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: d.x, y: d.y, opacity: [0, 1, 0], scale: 1 }}
          transition={{ duration: 1.1, delay: 0.3 + (i % 4) * 0.03, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

/** The trip was cancelled, or the transport office closed it. */
export function ClosedView({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const t = useTranslations("tripView");
  const byAdmin = trip.status === "closed_by_admin";
  return (
    <DriverFrame>
      <Reveal>
        <Card className="flex flex-col items-start gap-3 border-0 p-6 shadow-lift">
          <span className={cn("inline-flex size-14 items-center justify-center rounded-2xl", byAdmin ? "bg-wait-bg text-wait-fg" : "bg-off-bg text-off-fg")}>
            <ProhibitIcon size={28} weight="duotone" />
          </span>
          <h1 className="font-display text-xl font-bold text-title">{byAdmin ? t("closedTitle") : t("cancelledTitle")}</h1>
          <p className="text-muted">
            {trip.trip_no} · {trip.car_code}
            {trip.close_reason ? ` · ${trip.close_reason}` : ""}
          </p>
          <Button size="xl" className="mt-2" onClick={onDone}>
            {t("backHome")}
          </Button>
        </Card>
      </Reveal>
    </DriverFrame>
  );
}

/** Full-screen "Passenger confirmed" moment when the passenger confirms the start. Tap or wait to continue. */
export function ConfirmedOverlay({ name, onDone }: { name: string | null; onDone: () => void }) {
  const t = useTranslations("tripView");
  return (
    <motion.button
      type="button"
      onClick={onDone}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-navy/95 px-8 text-center text-white backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.span
        className="flex size-24 items-center justify-center rounded-full bg-ok-dot shadow-2xl"
        initial={{ scale: 0.3 }}
        animate={{ scale: [0.3, 1.12, 1] }}
        transition={{ duration: 0.5, times: [0, 0.6, 1] }}
      >
        <CheckIcon size={52} weight="bold" />
      </motion.span>
      <p className="font-display text-3xl font-bold">{t("passengerConfirmed")}</p>
      {name ? <p className="text-lg text-sky">{name}</p> : null}
      <p className="text-sm text-[#c9d3ea]">{t("haveAGoodTrip")}</p>
    </motion.button>
  );
}
