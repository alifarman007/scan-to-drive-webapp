"use client";

import { ArrowRightIcon, SteeringWheelIcon } from "@phosphor-icons/react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import type { BoardCar, BoardState } from "@/lib/admin-api";
import { useNowSeconds } from "@/lib/hooks";
import { cn } from "@/lib/utils";

import { PanelTitle, secondsSince, useDuration } from "./bits";

type Filter = "all" | BoardState;

const EDGE: Record<BoardState, string> = {
  on_trip: "before:bg-trip-dot",
  waiting: "before:bg-wait-dot",
  available: "before:bg-ok-dot",
  maintenance: "before:bg-off-dot",
  inactive: "before:bg-off-dot",
};

/** Every car as a parking bay: what it is doing now, who is driving and for how long. */
export function CarBoard({ cars, asOf }: { cars: BoardCar[]; asOf: string }) {
  const t = useTranslations("dashboard");
  const ts = useTranslations("status");
  const [filter, setFilter] = useState<Filter>("all");

  const count = (s: BoardState) => cars.filter((c) => c.state === s).length;
  const filters: Filter[] = [
    "all",
    "on_trip",
    "waiting",
    "available",
    "maintenance",
  ];
  const shown =
    filter === "all"
      ? cars
      : cars.filter(
          (c) =>
            c.state === filter ||
            (filter === "maintenance" && c.state === "inactive"),
        );

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <PanelTitle
        title={t("board.title")}
        hint={t("board.hint", { count: cars.length })}
      />
      <LayoutGroup id="board-filter">
        <div
          role="tablist"
          aria-label={t("board.filter")}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {filters.map((f) => {
            const n =
              f === "all"
                ? cars.length
                : f === "maintenance"
                  ? count("maintenance") + count("inactive")
                  : count(f);
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={cn(
                  "relative inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition-colors",
                  active
                    ? "text-white"
                    : "text-muted hover:bg-soft hover:text-title",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="board-pill"
                    className="absolute inset-0 rounded-full bg-navy dark:bg-accent"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                ) : null}
                <span className="relative">
                  {f === "all" ? t("board.all") : ts(f)}
                </span>
                <span
                  className={cn(
                    "relative rounded-full px-1.5 text-xs tabular-nums",
                    active ? "bg-white/20" : "bg-soft",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <motion.ul
        layout
        className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2.5 rounded-2xl bg-bay p-2 sm:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] sm:gap-3 sm:p-3"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((car) => (
            <motion.li
              key={car.id}
              layout
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.22 }}
            >
              <Bay car={car} asOf={asOf} />
            </motion.li>
          ))}
        </AnimatePresence>
        {shown.length === 0 ? (
          <li className="col-span-full py-8 text-center text-sm text-muted">
            {t("board.none")}
          </li>
        ) : null}
      </motion.ul>
    </Card>
  );
}

function Bay({ car, asOf }: { car: BoardCar; asOf: string }) {
  const t = useTranslations("dashboard");
  const ts = useTranslations("status");
  const duration = useDuration();
  const now = useNowSeconds() ?? Math.floor(new Date(asOf).getTime() / 1000);
  const trip = car.trip;
  const waitingWhat =
    trip?.status === "waiting_for_end_confirm"
      ? t("board.waitingEnd")
      : t("board.waitingStart");

  const cls = cn(
    "relative flex h-full min-h-32 flex-col gap-2 overflow-hidden rounded-[0.875rem] border border-border bg-card p-3 pl-4",
    "before:absolute before:inset-y-0 before:left-0 before:w-1",
    EDGE[car.state],
  );
  const content = (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="shrink-0 font-display text-lg leading-tight font-bold text-title">
            {car.car_code}
          </span>
          <StatusChip
            status={car.state}
            size="sm"
            live={car.state === "on_trip"}
          >
            {ts(car.state)}
          </StatusChip>
        </div>
        <span className="truncate text-xs text-muted">{car.model}</span>
      </div>
      {trip ? (
        <div className="mt-auto flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1.5 font-semibold text-text">
            <SteeringWheelIcon size={15} className="shrink-0 text-muted" />
            <span className="truncate">{trip.driver_name}</span>
          </span>
          <span className="flex items-center gap-1.5 text-muted">
            <ArrowRightIcon size={15} className="shrink-0" />
            <span className="truncate">{trip.destination}</span>
          </span>
          <span
            className={cn(
              "font-mono text-xs font-semibold",
              car.state === "waiting" ? "text-wait-fg" : "text-trip-fg",
            )}
          >
            {car.state === "waiting" ? `${waitingWhat} · ` : ""}
            {duration(secondsSince(trip.start_time, now))}
          </span>
        </div>
      ) : (
        <div className="mt-auto flex items-baseline gap-1">
          <span className="font-mono text-sm font-semibold text-text tabular-nums">
            {car.current_km.toLocaleString("en-US")}
          </span>
          <span className="text-xs text-muted">km</span>
        </div>
      )}
    </>
  );
  // a bay with a trip opens that trip
  return trip ? (
    <Link
      href={`/admin/trips/${trip.id}`}
      className={cn(
        cls,
        "transition-[box-shadow,border-color] hover:border-border-strong hover:shadow-lift focus-visible:border-ring",
      )}
    >
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}
