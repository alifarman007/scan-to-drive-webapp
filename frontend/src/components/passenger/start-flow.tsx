"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Reveal } from "@/components/ui/reveal";
import { passengerApi, type StartConfirmed, type StartPage } from "@/lib/passenger-api";

import { EmployeeForm, SlideSwap, VisitorForm, WhoPicker, type Mode } from "./identity-forms";
import { CodeTimer, DeadCode, PhotoButton, SuccessMark, TripCard } from "./pieces";

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
          {page.allow_visitors ? <WhoPicker mode={mode} onChange={setMode} pillId="who-pill" /> : null}
          <SlideSwap mode={mode}>
            {mode === "employee" ? (
              <EmployeeForm
                token={token}
                triesLeft={page.tries_left}
                confirm={(id) => passengerApi.confirmEmployee(token, id).then((r) => r.trip)}
                confirmLabel={t("confirmStart")}
                onDone={setDone}
                onDead={setDead}
              />
            ) : (
              <VisitorForm
                confirm={(v) => passengerApi.confirmVisitor(token, v).then((r) => r.trip)}
                confirmLabel={t("confirmStart")}
                onDone={setDone}
                onDead={setDead}
              />
            )}
          </SlideSwap>
        </Reveal>
      )}
    </div>
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

