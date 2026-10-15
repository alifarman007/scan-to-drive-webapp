"use client";

import { ArrowRightIcon, CarProfileIcon, HandshakeIcon, SteeringWheelIcon } from "@phosphor-icons/react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import type { BoardCar, BoardState } from "@/lib/admin-api";
import { useNowSeconds, useScrollFade } from "@/lib/hooks";
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

const PREVIEW = 4;
const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

/** Most recent first: cars on a trip (latest start first), then the idle cars used most recently. */
function latestFirst(a: BoardCar, b: BoardCar) {
  const busy = (c: BoardCar) => (c.trip ? 1 : 0);
  if (busy(a) !== busy(b)) return busy(b) - busy(a);
  const ta = a.trip ? time(a.trip.start_time) : time(a.last_used_at);
  const tb = b.trip ? time(b.trip.start_time) : time(b.last_used_at);
  return tb - ta || a.car_code.localeCompare(b.car_code, "en", { numeric: true });
}

/** The same choice on the Cars page (its "on a trip" also holds the cars waiting for a passenger). */
const CARS_STATE: Record<Filter, string> = { all: "", on_trip: "on_trip", waiting: "on_trip", available: "available", maintenance: "maintenance", inactive: "inactive" };

/** The four cars that matter now (on a trip, or idle and used most recently) as parking bays; "See all" opens the Cars page. */
export function CarBoard({ cars, asOf }: { cars: BoardCar[]; asOf: string }) {
  const t = useTranslations("dashboard");
  const ts = useTranslations("status");
  const [filter, setFilter] = useState<Filter>("all");
  const [fadeRef, fadeStyle] = useScrollFade<HTMLDivElement>();

  const count = (s: BoardState) => cars.filter((c) => c.state === s).length;
  const filters: Filter[] = [
    "all",
    "on_trip",
    "waiting",
    "available",
    "maintenance",
  ];
  const matching =
    filter === "all"
      ? cars
      : cars.filter(
          (c) =>
            c.state === filter ||
            (filter === "maintenance" && c.state === "inactive"),
        );
  // "All" previews only cars that are moving or ready to go (idle); the workshop ones wait on the Cars page
  const pool = filter === "all" ? matching.filter((c) => c.state === "on_trip" || c.state === "waiting" || c.state === "available") : matching;
  const shown = [...pool].sort(latestFirst).slice(0, PREVIEW);
  const rest = matching.filter((c) => !shown.includes(c));
  const state = CARS_STATE[filter];

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <PanelTitle
        title={t("board.title")}
        hint={t("board.hint", { count: cars.length })}
      />
      <LayoutGroup id="board-filter">
        <div
          ref={fadeRef}
          style={fadeStyle}
          role="tablist"
          aria-label={t("board.filter")}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
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

      <div className="flex flex-col gap-2.5 rounded-2xl bg-bay p-2 sm:gap-3 sm:p-3">
        <motion.ul layout className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((car, i) => (
              <motion.li
                key={car.id}
                layout
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] } }}
                exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
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
        <SeeAll
          href={`/admin/cars${state ? `?state=${state}` : ""}`}
          total={matching.length}
          more={rest.length}
          peek={rest.slice(0, 3).map((c) => c.car_code)}
          label={filter === "all" ? t("board.seeAll", { count: cars.length }) : t(`board.seeAllOf.${filter === "inactive" ? "maintenance" : filter}`)}
        />
      </div>
    </Card>
  );
}

/**
 * "See all cars": a strip of road with a little car parked at the start. On hover the car drives along and the
 * hidden car codes fan out; on click it speeds off the edge and the Cars page opens.
 */
function SeeAll({ href, total, more, peek, label }: { href: string; total: number; more: number; peek: string[]; label: string }) {
  const t = useTranslations("dashboard.board");
  const router = useRouter();
  const reduce = useReducedMotion();
  const [go, setGo] = useState(false);

  useEffect(() => {
    router.prefetch(href);
  }, [href, router]);

  function open(e: React.MouseEvent) {
    if (reduce || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab etc.: as a plain link
    e.preventDefault();
    if (go) return;
    setGo(true);
    window.setTimeout(() => router.push(href), 560);
  }

  return (
    <Link
      href={href}
      onClick={open}
      aria-label={label}
      className={cn(
        "group relative flex min-h-[4.5rem] items-center gap-4 overflow-hidden rounded-[0.875rem] border border-dashed border-border-strong bg-card/70 pt-2.5 pr-3 pb-5 pl-4 outline-none",
        "transition-[border-color,background-color,box-shadow] duration-300 hover:border-solid hover:border-accent/50 hover:bg-card hover:shadow-lift",
        "focus-visible:shadow-[0_0_0_4px_var(--ring-soft)]",
        go && "border-solid border-accent/60 bg-card",
      )}
    >
      {/* a soft wash that fills the strip as it opens */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 origin-left bg-gradient-to-r from-soft via-soft to-accent/15"
        initial={false}
        animate={{ scaleX: go ? 1 : 0, opacity: go ? 1 : 0 }}
        transition={{ duration: 0.5, ease: [0.65, 0, 0.35, 1] }}
      />
      {/* the road and the little car */}
      <svg aria-hidden="true" className="pointer-events-none absolute inset-x-4 bottom-[6px] h-[2px] w-[calc(100%-2rem)] overflow-visible">
        <line
          x1="0"
          y1="1"
          x2="100%"
          y2="1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="6 9"
          className="road-dash text-border-strong transition-colors duration-300 group-hover:text-accent/50"
        />
      </svg>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute bottom-[1px] left-4 text-accent transition-[left,transform,opacity] ease-[cubic-bezier(0.65,0,0.35,1)]",
          go ? "left-[calc(100%+1rem)] duration-500" : "duration-[1600ms] group-hover:left-[calc(100%-4.75rem)] group-focus-visible:left-[calc(100%-4.75rem)]",
        )}
      >
        <CarProfileIcon size={16} weight="fill" className="-scale-x-100" />
      </span>

      {peek.length ? (
        // the hidden cars as a little deck of number plates; it fans out on hover
        <span aria-hidden="true" className="relative flex shrink-0 items-center py-1">
          {peek.map((code, i) => (
            <span
              key={code}
              style={{ zIndex: peek.length - i }}
              className={cn(
                "relative w-[3.6rem] rounded-lg border border-border bg-card py-1 text-center font-mono text-[0.68rem] font-bold text-title shadow-sm",
                "transition-[margin,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                i > 0 && "-ml-[3.25rem] group-hover:-ml-1 group-focus-visible:-ml-1",
                i === 1 && "translate-y-[-3px] rotate-[7deg] group-hover:translate-y-0 group-hover:rotate-0",
                i === 2 && "translate-y-[3px] -rotate-[7deg] group-hover:translate-y-0 group-hover:rotate-0",
              )}
            >
              {code}
            </span>
          ))}
        </span>
      ) : null}

      <span className="relative flex min-w-0 flex-1 flex-col">
        <span className="truncate font-display text-[0.95rem] font-bold text-title">{label}</span>
        <span className="truncate text-xs text-muted">{more ? t("moreOnCars", { count: more }) : t("allOnCars", { count: total })}</span>
      </span>

      <motion.span
        aria-hidden="true"
        className="relative grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white shadow-[0_8px_18px_-8px_var(--accent)] transition-transform duration-300 group-hover:translate-x-0.5"
        animate={go ? { scale: [1, 0.86, 1.12], rotate: [0, 0, -8] } : { scale: 1, rotate: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <ArrowRightIcon size={18} weight="bold" />
      </motion.span>
    </Link>
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
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted">
          {car.vendor_name ? (
            <HandshakeIcon size={13} weight="fill" className="shrink-0 text-accent" aria-label={t("vendorCar", { vendor: car.vendor_name })}>
              <title>{t("vendorCar", { vendor: car.vendor_name })}</title>
            </HandshakeIcon>
          ) : null}
          <span className="truncate">{car.model}</span>
        </span>
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
          {car.current_km ? (
            <>
              <span className="font-mono text-sm font-semibold text-text tabular-nums">
                {car.current_km.toLocaleString("en-US")}
              </span>
              <span className="text-xs text-muted">km</span>
            </>
          ) : (
            <span className="text-xs text-muted">{t("kmUnknown")}</span>
          )}
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
