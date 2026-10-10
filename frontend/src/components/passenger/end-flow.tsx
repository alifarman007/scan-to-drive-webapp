"use client";

import { CircleNotchIcon, FlagCheckeredIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Odometer } from "@/components/ui/odometer";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { PHONE_RE, passengerApi, type EndConfirmed, type EndPage } from "@/lib/passenger-api";

import { CodeTimer, DeadCode, ErrorText, PhotoButton, Shake, SuccessMark, TripCard, useErrorText } from "./pieces";

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
 * photos) and confirms with the SAME employee ID as at the start, or the same phone number for a visitor.
 */
export function EndFlow({ token, page }: { token: string; page: EndPage }) {
  const t = useTranslations("passenger");
  const [dead, setDead] = useState<string | null>(null);
  const [done, setDone] = useState<EndConfirmed["trip"] | null>(null);
  const onExpired = useCallback(() => setDead((d) => d ?? "QR_EXPIRED"), []);
  const { trip } = page;

  if (done) return <EndDone trip={done} />;
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
      ) : (
        <Reveal delay={0.14}>
          <EndForm token={token} as={page.confirm_as} triesLeft={page.tries_left} onDone={setDone} onDead={setDead} />
        </Reveal>
      )}
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
  onDone,
  onDead,
}: {
  token: string;
  as: EndPage["confirm_as"];
  triesLeft: number;
  onDone: (trip: EndConfirmed["trip"]) => void;
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
      onDone(res.trip);
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
            autoComplete={isPhone ? "tel" : "off"}
            autoCapitalize={isPhone ? undefined : "characters"}
            spellCheck={false}
            type={isPhone ? "tel" : "text"}
            inputMode={isPhone ? "tel" : "text"}
            placeholder={isPhone ? "01XXX XXXXXX" : "EMP-0000"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            invalid={Boolean(error || formatError)}
            maxLength={isPhone ? 21 : 40}
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

function EndDone({ trip }: { trip: EndConfirmed["trip"] }) {
  const t = useTranslations("passenger");
  const format = useFormatter();
  const duration = useMinutes();
  return (
    <div className="flex flex-col gap-5 pt-4 text-center">
      <SuccessMark />
      <Reveal delay={0.2} className="flex flex-col gap-1.5">
        <h1 className="font-display text-3xl font-bold text-title">{t("endDoneTitle")}</h1>
        <p className="text-muted">{t("endDoneBody")}</p>
      </Reveal>
      <Reveal delay={0.3}>
        <Card className="flex flex-col items-center gap-2 border-0 p-5 shadow-lift">
          <span className="text-sm font-semibold text-muted">{t("odometer")}</span>
          <Odometer value={trip.end_km} from={trip.start_km} size="lg" unit="km" />
        </Card>
      </Reveal>
      <Stagger className="grid grid-cols-2 gap-3 text-left">
        <StaggerItem>
          <Card className="flex h-full flex-col gap-1 p-4">
            <span className="text-xs font-bold tracking-wide text-muted uppercase">{t("distance")}</span>
            <span className="font-display text-2xl font-bold text-title">{format.number(trip.distance_km, LATIN)} km</span>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card className="flex h-full flex-col gap-1 p-4">
            <span className="text-xs font-bold tracking-wide text-muted uppercase">{t("journeyTime")}</span>
            <span className="font-display text-2xl font-bold text-title">{duration(trip.journey_minutes)}</span>
          </Card>
        </StaggerItem>
      </Stagger>
      <p className="text-xs text-muted">
        <span className="font-mono">
          {trip.trip_no} · {trip.car_code}
        </span>
        <br />
        {t("endedAt", { time: format.dateTime(new Date(trip.end_confirm_time), { hour: "numeric", minute: "2-digit" }) })} · {t("canClose")}
      </p>
    </div>
  );
}
