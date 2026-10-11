"use client";

import { ArrowRightIcon, CircleNotchIcon, DeviceMobileIcon, FlagCheckeredIcon, InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Odometer } from "@/components/ui/odometer";
import { Reveal } from "@/components/ui/reveal";
import { ApiError } from "@/lib/api";
import { PHONE_RE, cleanId, openTripOnThisPhone, passengerApi, type EndConfirmed, type EndPage } from "@/lib/passenger-api";

import { EmployeeForm, SlideSwap, VisitorForm, WhoPicker, type Mode } from "./identity-forms";
import { CodeTimer, DeadCode, ErrorText, PhotoButton, Shake, SuccessMark, TripCard, useErrorText } from "./pieces";
import { ReviewCard } from "./review";

/** Km in the digits printed on the car's odometer, also in Bangla. */
const LATIN = { numberingSystem: "latn" } as const;

function useMinutes() {
  const t = useTranslations("time");
  return (minutes: number | null) => {
    if (minutes === null) return "–";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? t("hoursMinutes", { h, m }) : t("minutes", { m });
  };
}

/**
 * End QR page (PDF 6.2 P3-P4): the passenger checks the finished trip (km, distance, time, both dashboard
 * photos) and confirms. The phone that confirmed the start does it with one tap; another phone types the SAME
 * employee ID as at the start (or the same phone number for a visitor). Then: rate the ride.
 */
export function EndFlow({ token, page }: { token: string; page: EndPage }) {
  const t = useTranslations("passenger");
  const [dead, setDead] = useState<string | null>(null);
  const [done, setDone] = useState<EndConfirmed | null>(null);
  // the remembered phone can still choose to type the ID (or has to, if the browser forgot it meanwhile)
  const [typing, setTyping] = useState<"no" | "chosen" | "forgotten">("no");
  const onExpired = useCallback(() => setDead((d) => d ?? "QR_EXPIRED"), []);
  const finished = useCallback((res: EndConfirmed) => {
    openTripOnThisPhone.clear();
    setDone(res);
  }, []);
  const { trip } = page;

  if (done) return <EndDone result={done} />;
  if (dead) return <DeadCode code={dead} />;

  return (
    <div className="flex flex-col gap-4">
      <Reveal className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">{t("endEyebrow")}</p>
        <h1 className="font-display text-[1.7rem] leading-tight font-bold text-title">{t("endTitle")}</h1>
        <CodeTimer expiresAt={page.expires_at} onExpired={onExpired} />
      </Reveal>

      <Reveal delay={0.06}>
        <TripCard
          carCode={trip.car_code}
          carModel={trip.car_model}
          driver={trip.driver_name}
          from={trip.start_place}
          to={trip.end_place}
          time={trip.end_time}
          timeLabel={t("ended")}
        >
          <div className="flex flex-wrap gap-2">
            <PhotoButton src={`/api/p/${encodeURIComponent(token)}/photo/start`} label={t("startPhoto")} alt={t("startPhotoAlt")} />
            <PhotoButton src={`/api/p/${encodeURIComponent(token)}/photo/end`} label={t("endPhoto")} alt={t("endPhotoAlt")} />
          </div>
        </TripCard>
      </Reveal>

      <Reveal delay={0.1}>
        <TripNumbers startKm={trip.start_km} endKm={trip.end_km} distance={trip.distance_km} minutes={trip.journey_minutes} />
      </Reveal>

      {page.opened_by_driver ? (
        <Reveal delay={0.14}>
          <p className="flex items-start gap-2.5 rounded-2xl bg-wait-bg px-4 py-3.5 text-sm font-semibold text-wait-fg">
            <WarningCircleIcon size={20} weight="fill" className="mt-px shrink-0" />
            {t("driversPhone")}
          </p>
        </Reveal>
      ) : page.identify ? (
        <Reveal delay={0.14}>
          <IdentifyAtEnd token={token} page={page} onDone={finished} onDead={setDead} />
        </Reveal>
      ) : (
        <Reveal delay={0.14}>
          <AnimatePresence mode="wait" initial={false}>
            {page.remembered && typing === "no" ? (
              <motion.div key="tap" exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                <OneTapEnd
                  token={token}
                  you={page.you}
                  onDone={finished}
                  onDead={setDead}
                  onType={(why) => setTyping(why)}
                />
              </motion.div>
            ) : (
              <motion.div key="type" initial={page.remembered ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
                {typing === "forgotten" ? (
                  <p className="flex items-start gap-2.5 rounded-2xl bg-wait-bg px-4 py-3.5 text-sm font-semibold text-wait-fg">
                    <InfoIcon size={20} weight="fill" className="mt-px shrink-0" />
                    {page.confirm_as === "visitor" ? t("forgottenVisitor") : t("forgotten")}
                  </p>
                ) : null}
                <EndForm
                  token={token}
                  as={page.confirm_as}
                  triesLeft={page.tries_left}
                  focus={typing !== "no"}
                  onDone={finished}
                  onDead={setDead}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </Reveal>
      )}
    </div>
  );
}

/**
 * The driver used "Passenger can't scan" at the start, so there is nobody to match. The passenger says who they
 * are now (same as on the Start QR) and that confirms the end. The office still checks the trip.
 */
function IdentifyAtEnd({
  token,
  page,
  onDone,
  onDead,
}: {
  token: string;
  page: EndPage;
  onDone: (result: EndConfirmed) => void;
  onDead: (code: string) => void;
}) {
  const t = useTranslations("passenger");
  const [mode, setMode] = useState<Mode>("employee");
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2.5 rounded-2xl bg-soft px-4 py-3.5 text-sm text-title">
        <InfoIcon size={20} weight="fill" className="mt-px shrink-0 text-accent" />
        {t("identifyNote")}
      </p>
      {page.allow_visitors ? <WhoPicker mode={mode} onChange={setMode} pillId="who-pill-end" /> : null}
      <SlideSwap mode={mode}>
        {mode === "employee" ? (
          <EmployeeForm
            idPattern={page.id_pattern}
            triesLeft={page.tries_left}
            confirm={(e) => passengerApi.identifyEmployeeAtEnd(token, e)}
            confirmLabel={t("confirmEnd")}
            onDone={onDone}
            onDead={onDead}
          />
        ) : (
          <VisitorForm
            confirm={(v) => passengerApi.identifyVisitorAtEnd(token, v)}
            confirmLabel={t("confirmEnd")}
            phoneHint={t("phoneHintEnd")}
            onDone={onDone}
            onDead={onDead}
          />
        )}
      </SlideSwap>
    </div>
  );
}

/** Odometer rolling from the start km to the end km, then distance and time side by side. */
function TripNumbers({ startKm, endKm, distance, minutes }: { startKm: number; endKm: number; distance: number; minutes: number | null }) {
  const t = useTranslations("passenger");
  const duration = useMinutes();
  const format = useFormatter();
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold tracking-wide text-muted uppercase">{t("odometer")}</span>
          <Odometer value={endKm} from={startKm} size="md" />
        </div>
        <span className="pb-1 text-right text-xs text-muted">{t("startedAtKm", { km: format.number(startKm, LATIN) })}</span>
      </div>
      <div className="grid grid-cols-2 border-t border-border pt-3">
        <div className="flex flex-col gap-0.5 pr-3">
          <span className="text-xs font-bold tracking-wide text-muted uppercase">{t("distance")}</span>
          <span className="font-display text-2xl font-bold text-title">{format.number(distance, LATIN)} km</span>
        </div>
        <div className="flex flex-col gap-0.5 border-l border-border pl-4">
          <span className="text-xs font-bold tracking-wide text-muted uppercase">{t("journeyTime")}</span>
          <span className="font-display text-2xl font-bold text-title">{duration(minutes)}</span>
        </div>
      </div>
    </Card>
  );
}

function EndForm({
  token,
  as,
  triesLeft,
  focus = false,
  onDone,
  onDead,
}: {
  token: string;
  as: EndPage["confirm_as"];
  triesLeft: number;
  /** put the cursor in the box straight away (the remembered phone chose, or had, to type) */
  focus?: boolean;
  onDone: (result: EndConfirmed) => void;
  onDead: (code: string) => void;
}) {
  const t = useTranslations("passenger");
  const isPhone = as === "visitor";
  const errorText = useErrorText(isPhone ? "phone" : "id");
  const [value, setValue] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  const valid = isPhone ? PHONE_RE.test(value.trim()) : value.trim().length > 0;
  const formatError = tried && !valid && isPhone ? t("phoneNeeded") : null;
  const hint = error || formatError ? undefined : triesLeft < 5 ? t("triesLeft", { left: triesLeft }) : isPhone ? t("endPhoneHint") : t("endIdHint");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!valid) {
      setShake((n) => n + 1);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await passengerApi.confirmEnd(token, as, value.trim());
      navigator.vibrate?.(40);
      onDone(res);
    } catch (err) {
      setError(errorText(err, onDead));
      setShake((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Shake shake={shake}>
        <Field label={isPhone ? t("endPhoneLabel") : t("yourId")} htmlFor="end-value" hint={hint} error={formatError ?? undefined}>
          <Input
            id="end-value"
            mono
            autoFocus={focus}
            autoComplete={isPhone ? "tel" : "off"}
            autoCapitalize={isPhone ? undefined : "characters"}
            spellCheck={false}
            type={isPhone ? "tel" : "text"}
            inputMode={isPhone ? "tel" : "text"}
            placeholder={isPhone ? "01XXX XXXXXX" : "EMP2210"}
            value={value}
            onChange={(e) => {
              setValue(isPhone ? e.target.value : cleanId(e.target.value));
              setError(null);
            }}
            invalid={Boolean(error || formatError)}
            maxLength={isPhone ? 21 : 20}
          />
        </Field>
      </Shake>
      <ErrorText text={error} />
      <Button type="submit" size="xl" lift disabled={busy || !value.trim()} aria-busy={busy}>
        {busy ? (
          <CircleNotchIcon size={22} className="animate-spin" />
        ) : (
          <>
            <FlagCheckeredIcon size={22} weight="bold" />
            {t("confirmEnd")}
          </>
        )}
      </Button>
    </form>
  );
}

/**
 * The phone that confirmed the start: who is confirming, and one big button. Nothing to type.
 * If the browser forgot this phone in the meantime, the page falls back to typing the ID.
 */
function OneTapEnd({
  token,
  you,
  onDone,
  onDead,
  onType,
}: {
  token: string;
  you: string | null;
  onDone: (result: EndConfirmed) => void;
  onDead: (code: string) => void;
  onType: (why: "chosen" | "forgotten") => void;
}) {
  const t = useTranslations("passenger");
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await passengerApi.confirmEndRemembered(token);
      navigator.vibrate?.(40);
      onDone(res);
    } catch (err) {
      if (err instanceof ApiError && err.code === "NOT_REMEMBERED") return onType("forgotten");
      setError(errorText(err, onDead));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-card border-[1.5px] border-ok-dot/35 bg-ok-bg p-4">
        <span className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ok-dot text-white">
          <DeviceMobileIcon size={24} weight="duotone" />
          <motion.span
            className="absolute inset-0 rounded-2xl ring-2 ring-ok-dot"
            initial={{ scale: 1, opacity: 0.8 }}
            animate={{ scale: 1.35, opacity: 0 }}
            transition={{ duration: 1.4, repeat: 2, ease: "easeOut", delay: 0.5 }}
          />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-semibold text-ok-fg">{t("samePhone")}</span>
          {you ? <span className="truncate font-display text-lg font-bold text-ok-fg">{you}</span> : null}
          <span className="text-sm text-ok-fg/85">{t("oneTapNote")}</span>
        </div>
      </div>
      <ErrorText text={error} />
      <Button size="xl" lift onClick={() => void confirm()} disabled={busy} aria-busy={busy}>
        {busy ? (
          <CircleNotchIcon size={22} className="animate-spin" />
        ) : (
          <>
            <FlagCheckeredIcon size={22} weight="bold" />
            {t("confirmEnd")}
          </>
        )}
      </Button>
      <button
        type="button"
        onClick={() => onType("chosen")}
        disabled={busy}
        className="mx-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-accent hover:underline disabled:opacity-50"
      >
        {t("notYouType")}
        <ArrowRightIcon size={14} weight="bold" />
      </button>
    </div>
  );
}

/** Done: a tick, the trip in one line, then "How was your ride?". */
function EndDone({ result }: { result: EndConfirmed }) {
  const t = useTranslations("passenger");
  const format = useFormatter();
  const duration = useMinutes();
  const { trip } = result;
  return (
    <div className="flex flex-col gap-5 pt-4 text-center">
      <SuccessMark />
      <Reveal delay={0.2} className="flex flex-col items-center gap-2">
        <h1 className="font-display text-3xl font-bold text-title">{t("endDoneTitle")}</h1>
        <p className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm font-semibold text-muted">
          <span className="font-display text-base font-bold text-title">{format.number(trip.distance_km, LATIN)} km</span>
          <span aria-hidden="true">·</span>
          <span>{duration(trip.journey_minutes)}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{trip.car_code}</span>
        </p>
      </Reveal>
      <Reveal delay={0.32}>
        <ReviewCard token={result.review_token} driver={trip.driver_name} />
      </Reveal>
      <p className="text-xs text-muted">
        <span className="font-mono">{trip.trip_no}</span> ·{" "}
        {t("endedAt", { time: format.dateTime(new Date(trip.end_confirm_time), { hour: "numeric", minute: "2-digit" }) })}
        <br />
        {t("canClose")}
      </p>
    </div>
  );
}
