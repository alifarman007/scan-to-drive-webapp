"use client";

import { ArrowLeftIcon, CheckCircleIcon, CircleNotchIcon, IdentificationCardIcon, UserIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Reveal } from "@/components/ui/reveal";
import { PHONE_RE, passengerApi, type StartConfirmed, type StartPage } from "@/lib/passenger-api";
import { cn } from "@/lib/utils";

import { CodeTimer, DeadCode, ErrorText, PhotoButton, Shake, SuccessMark, TripCard, useErrorText } from "./pieces";

type Mode = "employee" | "visitor";

/**
 * Start QR page (PDF 6.2 P1-P2): the passenger sees the trip, says who they are, and confirms the start.
 * Employee: type the ID, see your NAME to check for typos, then confirm. Visitor: name, phone, optional reason.
 */
export function StartFlow({ token, page }: { token: string; page: StartPage }) {
  const t = useTranslations("passenger");
  const [mode, setMode] = useState<Mode>("employee");
  const [dead, setDead] = useState<string | null>(null);
  const [done, setDone] = useState<StartConfirmed["trip"] | null>(null);
  const onExpired = useCallback(() => setDead((d) => d ?? "QR_EXPIRED"), []);

  if (done) return <StartDone trip={done} />;
  if (dead) return <DeadCode code={dead} />;

  return (
    <div className="flex flex-col gap-4">
      <Reveal className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">{t("startEyebrow")}</p>
        <h1 className="font-display text-[1.7rem] leading-tight font-bold text-title">{t("startTitle")}</h1>
        <CodeTimer expiresAt={page.expires_at} onExpired={onExpired} />
      </Reveal>

      <Reveal delay={0.06}>
        <TripCard
          carCode={page.trip.car_code}
          carModel={page.trip.car_model}
          driver={page.trip.driver_name}
          from={page.trip.start_place}
          to={page.trip.destination}
          time={page.trip.start_time}
        >
          <PhotoButton src={`/api/p/${encodeURIComponent(token)}/photo`} label={t("seePhoto")} alt={t("startPhotoAlt")} />
        </TripCard>
      </Reveal>

      {page.opened_by_driver ? (
        <Reveal delay={0.12}>
          <p className="flex items-start gap-2.5 rounded-2xl bg-wait-bg px-4 py-3.5 text-sm font-semibold text-wait-fg">
            <WarningCircleIcon size={20} weight="fill" className="mt-px shrink-0" />
            {t("driversPhone")}
          </p>
        </Reveal>
      ) : (
        <Reveal delay={0.12} className="flex flex-col gap-4">
          {page.allow_visitors ? (
            <div role="radiogroup" aria-label={t("whoAreYou")} className="grid grid-cols-2 gap-1 rounded-control bg-soft p-1">
              {(
                [
                  ["employee", t("employee"), IdentificationCardIcon],
                  ["visitor", t("visitor"), UserIcon],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "relative flex h-12 items-center justify-center gap-2 rounded-[0.7rem] text-sm font-bold transition-colors",
                    mode === value ? "text-title" : "text-muted",
                  )}
                >
                  {mode === value ? <motion.span layoutId="who-pill" className="absolute inset-0 rounded-[0.7rem] bg-card shadow-sm" /> : null}
                  <Icon size={18} weight={mode === value ? "fill" : "regular"} className="relative" />
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
          ) : null}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, x: mode === "employee" ? -16 : 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: mode === "employee" ? -16 : 16 }}
              transition={{ duration: 0.2 }}
            >
              {mode === "employee" ? (
                <EmployeeForm token={token} triesLeft={page.tries_left} onDone={setDone} onDead={setDead} />
              ) : (
                <VisitorForm token={token} onDone={setDone} onDead={setDead} />
              )}
            </motion.div>
          </AnimatePresence>
        </Reveal>
      )}
    </div>
  );
}

function EmployeeForm({
  token,
  triesLeft,
  onDone,
  onDead,
}: {
  token: string;
  triesLeft: number;
  onDone: (trip: StartConfirmed["trip"]) => void;
  onDead: (code: string) => void;
}) {
  const t = useTranslations("passenger");
  const errorText = useErrorText();
  const [id, setId] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  async function check(e?: React.FormEvent) {
    e?.preventDefault();
    const value = id.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await passengerApi.lookup(token, value);
      setName(res.name);
    } catch (err) {
      setError(errorText(err, onDead));
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await passengerApi.confirmEmployee(token, id.trim());
      navigator.vibrate?.(40);
      onDone(res.trip);
    } catch (err) {
      setError(errorText(err, onDead));
      setBusy(false);
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {name ? (
        <motion.div key="name" className="flex flex-col gap-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <div className="flex items-center gap-3 rounded-card border-[1.5px] border-ok-dot/40 bg-ok-bg p-4">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }} className="text-ok-dot">
              <CheckCircleIcon size={32} weight="fill" />
            </motion.span>
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-ok-fg">{t("isThisYou")}</span>
              <span className="truncate font-display text-xl font-bold text-ok-fg">{name}</span>
              <span className="font-mono text-sm text-ok-fg/80">{id.trim().toUpperCase()}</span>
            </div>
          </div>
          <ErrorText text={error} />
          <Button size="xl" lift onClick={() => void confirm()} disabled={busy} aria-busy={busy}>
            {busy ? <CircleNotchIcon size={22} className="animate-spin" /> : t("confirmStart")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setName(null);
              setError(null);
            }}
            disabled={busy}
          >
            <ArrowLeftIcon size={16} weight="bold" />
            {t("notMe")}
          </Button>
        </motion.div>
      ) : (
        <motion.form key="id" onSubmit={check} className="flex flex-col gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -8 }}>
          <Shake shake={shake}>
            <Field label={t("yourId")} htmlFor="p-id" hint={error ? undefined : triesLeft < 5 ? t("triesLeft", { left: triesLeft }) : t("idHint")}>
              <Input
                id="p-id"
                mono
                autoFocus
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="EMP-0000"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setError(null);
                }}
                invalid={Boolean(error)}
                maxLength={40}
              />
            </Field>
          </Shake>
          <ErrorText text={error} />
          <Button type="submit" size="xl" lift disabled={!id.trim() || busy} aria-busy={busy}>
            {busy ? <CircleNotchIcon size={22} className="animate-spin" /> : t("next")}
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}

function VisitorForm({
  token,
  onDone,
  onDead,
}: {
  token: string;
  onDone: (trip: StartConfirmed["trip"]) => void;
  onDead: (code: string) => void;
}) {
  const t = useTranslations("passenger");
  const errorText = useErrorText();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = name.trim().length >= 2;
  const phoneOk = PHONE_RE.test(phone.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!nameOk || !phoneOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await passengerApi.confirmVisitor(token, { name: name.trim(), phone: phone.trim(), reason: reason.trim() });
      navigator.vibrate?.(40);
      onDone(res.trip);
    } catch (err) {
      setError(errorText(err, onDead));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={t("visitorName")} htmlFor="v-name" error={tried && !nameOk ? t("nameNeeded") : undefined}>
        <Input id="v-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} invalid={tried && !nameOk} maxLength={120} placeholder={t("visitorNamePlaceholder")} />
      </Field>
      <Field
        label={t("visitorPhone")}
        htmlFor="v-phone"
        error={tried && !phoneOk ? t("phoneNeeded") : undefined}
        hint={tried && !phoneOk ? undefined : t("phoneHint")}
      >
        <Input id="v-phone" type="tel" inputMode="tel" autoComplete="tel" mono value={phone} onChange={(e) => setPhone(e.target.value)} invalid={tried && !phoneOk} maxLength={21} placeholder="01XXX XXXXXX" />
      </Field>
      <Field label={t("visitorReason")} htmlFor="v-reason">
        <Input id="v-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder={t("visitorReasonPlaceholder")} />
      </Field>
      <ErrorText text={error} />
      <Button type="submit" size="xl" lift disabled={busy} aria-busy={busy}>
        {busy ? <CircleNotchIcon size={22} className="animate-spin" /> : t("confirmStart")}
      </Button>
    </form>
  );
}

function StartDone({ trip }: { trip: StartConfirmed["trip"] }) {
  const t = useTranslations("passenger");
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-5 pt-4 text-center">
      <SuccessMark />
      <Reveal delay={0.2} className="flex flex-col gap-1.5">
        <h1 className="font-display text-3xl font-bold text-title">{t("startDoneTitle")}</h1>
        <p className="text-muted">{t("startDoneBody", { name: trip.passenger_name })}</p>
      </Reveal>
      <Reveal delay={0.3}>
        <TripCard
          carCode={trip.car_code}
          carModel={trip.trip_no}
          driver={trip.driver_name}
          from={trip.start_place}
          to={trip.destination}
          time={trip.journey_start_time}
        />
      </Reveal>
      <Reveal delay={0.4}>
        <p className="rounded-2xl bg-soft px-4 py-3.5 text-left text-sm text-title">
          {trip.is_visitor ? t("atTheEndVisitor") : t("atTheEnd")}
        </p>
      </Reveal>
      <p className="text-xs text-muted">
        {t("startedAt", { time: format.dateTime(new Date(trip.journey_start_time), { hour: "numeric", minute: "2-digit" }) })} · {t("canClose")}
      </p>
    </div>
  );
}
