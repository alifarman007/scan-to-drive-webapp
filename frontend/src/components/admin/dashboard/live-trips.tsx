"use client";

import { ArrowRightIcon, CarSimpleIcon, FlagIcon, IdentificationBadgeIcon, UserIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import type { LiveTrip } from "@/lib/admin-api";
import { useNowSeconds } from "@/lib/hooks";

import { PanelTitle, secondsSince, tripChip, useDuration } from "./bits";

/** Open trips: waiting for the passenger, driving, or waiting for the end confirmation. */
export function LiveTrips({ trips, asOf }: { trips: LiveTrip[]; asOf: string }) {
  const t = useTranslations("dashboard");
  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <PanelTitle title={t("live.title")} hint={trips.length ? t("live.hint", { count: trips.length }) : undefined} />
      {trips.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-bay px-4 py-10 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-card text-accent shadow-sm">
            <CarSimpleIcon size={24} weight="duotone" />
          </span>
          <p className="font-semibold text-title">{t("live.emptyTitle")}</p>
          <p className="text-sm text-muted">{t("live.emptyBody")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          <AnimatePresence initial={false}>
            {trips.map((trip) => (
              <motion.li
                key={trip.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <Row trip={trip} asOf={asOf} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}

function Row({ trip, asOf }: { trip: LiveTrip; asOf: string }) {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const duration = useDuration();
  const now = useNowSeconds() ?? Math.floor(new Date(asOf).getTime() / 1000);
  const status = tripChip(trip.status);

  const who = !trip.with_passenger ? (
    <span className="flex min-w-0 items-center gap-1.5 text-muted">
      <FlagIcon size={15} className="shrink-0" />
      <span className="truncate">{trip.purpose || t("live.noPassenger")}</span>
    </span>
  ) : trip.passenger_name ? (
    <span className="flex min-w-0 items-center gap-1.5 text-text">
      {trip.is_visitor ? <UserIcon size={15} className="shrink-0 text-muted" /> : <IdentificationBadgeIcon size={15} className="shrink-0 text-muted" />}
      <span className="truncate">
        {trip.passenger_name}
        {trip.is_visitor ? <span className="text-muted"> · {t("live.visitor")}</span> : trip.department ? <span className="text-muted"> · {trip.department}</span> : null}
      </span>
    </span>
  ) : (
    <span className="text-wait-fg">{t("live.passengerNotYet")}</span>
  );

  return (
    <Link
      href={`/admin/trips/${trip.id}`}
      className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-xl px-2 py-3 transition-colors hover:bg-bay/70 focus-visible:bg-ring-soft md:grid-cols-[7.5rem_minmax(0,1.1fr)_minmax(0,1.3fr)_11rem_6.5rem]"
    >
      <div className="flex flex-col">
        <span className="font-display font-bold text-title">{trip.car_code}</span>
        <span className="font-mono text-xs text-muted">{trip.trip_no}</span>
      </div>
      <div className="order-3 col-span-2 flex min-w-0 flex-col gap-0.5 text-sm md:order-none md:col-span-1">
        <span className="truncate font-semibold text-text">{trip.driver_name}</span>
        {who}
      </div>
      <div className="order-4 col-span-2 flex min-w-0 items-center gap-1.5 text-sm text-muted md:order-none md:col-span-1">
        <span className="truncate">{trip.start_place}</span>
        <ArrowRightIcon size={14} className="shrink-0" />
        <span className="truncate font-semibold text-text">{trip.destination}</span>
      </div>
      <div className="flex flex-col items-end gap-1 md:items-start">
        <StatusChip status={status} size="sm" live={status === "on_trip"}>
          {t(`tripStatus.${trip.status}`)}
        </StatusChip>
        {trip.needs_review ? <span className="text-xs font-semibold text-wait-fg">{t("live.officeCheck")}</span> : null}
      </div>
      <div className="order-5 col-span-2 flex items-baseline gap-2 text-sm md:order-none md:col-span-1 md:flex-col md:items-end md:gap-0">
        <span className="font-mono font-semibold text-title tabular-nums">{duration(secondsSince(trip.start_time, now))}</span>
        <span className="text-xs text-muted">{t("live.since", { time: format.dateTime(new Date(trip.start_time), { hour: "numeric", minute: "2-digit" }) })}</span>
      </div>
    </Link>
  );
}
