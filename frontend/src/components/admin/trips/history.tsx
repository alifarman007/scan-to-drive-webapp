"use client";

import {
  ArrowRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  EyeIcon,
  FunnelSimpleXIcon,
  MagnifyingGlassIcon,
  SealCheckIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { TripStatusChip } from "@/components/admin/trip-status";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { HistoryTrip, TripPage } from "@/lib/admin-api";
import { NO_FILTERS, PAGE_SIZE, STATUSES, hasFilters, pageHref, type Filters, type Range } from "@/lib/trip-filters";
import { cn } from "@/lib/utils";

import { useDuration } from "../dashboard/bits";

export type FilterOptions = {
  cars: { id: number; car_code: string; model: string }[];
  drivers: { id: number; name: string; employee_id: string }[];
  departments: string[];
};

const RANGES: Range[] = ["", "today", "week", "month", "custom"];

/** Trip history: one filter bar (search, dates, status, car, driver, department), quick chips, the list, pages. */
export function TripHistory({
  filters,
  data,
  options,
  pendingApprovals,
}: {
  filters: Filters;
  data: TripPage;
  options: FilterOptions;
  pendingApprovals: number;
}) {
  const t = useTranslations("trips");
  const ts = useTranslations("dashboard.tripStatus");
  const router = useRouter();
  const [loading, startTransition] = useTransition();

  function go(next: Partial<Filters>) {
    const merged = { ...filters, page: 1, ...next };
    startTransition(() => router.replace(pageHref(merged), { scroll: false }));
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const firstRow = data.total === 0 ? 0 : data.offset + 1;
  const lastRow = Math.min(data.total, data.offset + data.trips.length);

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-bold text-title">{t("title")}</h1>
          <p className="text-sm text-muted" aria-live="polite">
            {t("summary", { count: data.total, km: data.total_km.toLocaleString("en-US") })}
          </p>
        </div>
      </div>

      <Card className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchBox value={filters.q} onSearch={(q) => go({ q })} />
          <RangePicker filters={filters} onChange={go} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t("filter.status")}
            value={filters.status}
            active={Boolean(filters.status)}
            onChange={(e) => go({ status: e.target.value })}
            className="w-full sm:w-40"
          >
            <option value="">{t("filter.allStatuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("filter.car")}
            value={filters.car}
            active={Boolean(filters.car)}
            onChange={(e) => go({ car: e.target.value })}
            className="w-[calc(50%-0.25rem)] sm:w-40"
          >
            <option value="">{t("filter.allCars")}</option>
            {options.cars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.car_code} · {c.model}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("filter.driver")}
            value={filters.driver}
            active={Boolean(filters.driver)}
            onChange={(e) => go({ driver: e.target.value })}
            className="w-[calc(50%-0.25rem)] sm:w-40"
          >
            <option value="">{t("filter.allDrivers")}</option>
            {options.drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {options.departments.length ? (
            <Select
              aria-label={t("filter.department")}
              value={filters.dept}
              active={Boolean(filters.dept)}
              onChange={(e) => go({ dept: e.target.value })}
              className="w-full sm:w-44"
            >
              <option value="">{t("filter.allDepartments")}</option>
              {options.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          ) : null}
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <Toggle
            pressed={filters.approval === "pending"}
            onClick={() => go({ approval: filters.approval === "pending" ? "" : "pending" })}
            icon={<SealCheckIcon size={16} weight="bold" />}
            label={t("filter.needsApproval")}
            count={pendingApprovals}
            tone="wait"
          />
          <Toggle
            pressed={filters.review}
            onClick={() => go({ review: !filters.review })}
            icon={<EyeIcon size={16} weight="bold" />}
            label={t("filter.officeCheck")}
          />
          <AnimatePresence>
            {hasFilters(filters) ? (
              <motion.button
                type="button"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                onClick={() => go(NO_FILTERS)}
                className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-[0.7rem] px-3 text-sm font-bold text-accent hover:bg-soft"
              >
                <FunnelSimpleXIcon size={16} weight="bold" />
                {t("filter.clear")}
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </Card>

      <Card className="relative overflow-hidden p-0">
        {/* a thin bar runs along the top while the next page of results loads */}
        <AnimatePresence>
          {loading ? (
            <motion.span
              key="bar"
              className="absolute inset-x-0 top-0 z-10 h-0.5 origin-left bg-signal"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 0.85, transition: { duration: 1.2, ease: "easeOut" } }}
              exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.25 } }}
            />
          ) : null}
        </AnimatePresence>
        <div className={cn("transition-opacity duration-200", loading && "opacity-55")}>
          {data.trips.length === 0 ? (
            <Empty filtered={hasFilters(filters)} onClear={() => go(NO_FILTERS)} />
          ) : (
            <>
              <HeaderRow />
              <ul className="divide-y divide-border">
                {data.trips.map((trip) => (
                  <li key={trip.id}>
                    <TripRow trip={trip} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Card>

      {data.total > PAGE_SIZE ? (
        <nav aria-label={t("pages.label")} className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{t("pages.showing", { from: firstRow, to: lastRow, total: data.total })}</p>
          <div className="flex items-center gap-2">
            <PageLink filters={filters} page={filters.page - 1} disabled={filters.page <= 1} label={t("pages.previous")}>
              <CaretLeftIcon size={16} weight="bold" />
            </PageLink>
            <span className="min-w-24 text-center text-sm font-semibold text-title tabular-nums">
              {t("pages.of", { page: filters.page, pages })}
            </span>
            <PageLink filters={filters} page={filters.page + 1} disabled={filters.page >= pages} label={t("pages.next")}>
              <CaretRightIcon size={16} weight="bold" />
            </PageLink>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

/** Typing searches by itself after a short pause; Enter searches straight away; Esc clears. */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const t = useTranslations("trips");
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the address changed from outside (top bar search, "Clear"): show that text
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function later(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next.trim() !== value) onSearch(next.trim());
    }, 380);
  }

  return (
    <form
      role="search"
      className="flex h-10 min-w-0 flex-[1_1_16rem] items-center gap-2 rounded-[0.7rem] border-[1.5px] border-border-strong bg-card px-3 transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_4px_var(--ring-soft)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        onSearch(text.trim());
      }}
    >
      <MagnifyingGlassIcon size={17} className="shrink-0 text-muted" />
      <input
        type="search"
        id="trip-search"
        aria-label={t("searchLabel")}
        placeholder={t("searchHint")}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          later(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            setText("");
            onSearch("");
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {text ? (
        <button
          type="button"
          aria-label={t("clearSearch")}
          onClick={() => {
            setText("");
            onSearch("");
          }}
          className="inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-title"
        >
          <XIcon size={14} weight="bold" />
        </button>
      ) : null}
    </form>
  );
}

/** All time / Today / This week / This month / Pick dates; picking dates shows two date boxes. */
function RangePicker({ filters, onChange }: { filters: Filters; onChange: (f: Partial<Filters>) => void }) {
  const t = useTranslations("trips.range");
  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label={t("label")} className="flex max-w-full gap-0.5 overflow-x-auto rounded-[0.8rem] bg-soft p-1 [scrollbar-width:none]">
        {RANGES.map((r) => {
          const active = filters.range === r;
          return (
            <button
              key={r || "all"}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(r === "custom" ? { range: r, from: filters.from, to: filters.to } : { range: r, from: "", to: "" })}
              className={cn(
                "relative h-8 shrink-0 rounded-[0.6rem] px-3 text-sm font-semibold whitespace-nowrap transition-colors",
                active ? "text-title" : "text-muted hover:text-title",
              )}
            >
              {active ? <motion.span layoutId="range-pill" className="absolute inset-0 rounded-[0.6rem] bg-card shadow-sm" /> : null}
              <span className="relative">{t(r || "all")}</span>
            </button>
          );
        })}
      </div>
      <AnimatePresence initial={false}>
        {filters.range === "custom" ? (
          <motion.div
            key="dates"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            className="flex items-center gap-1.5 overflow-hidden"
          >
            <input
              type="date"
              aria-label={t("from")}
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => onChange({ from: e.target.value })}
              className="h-10 rounded-[0.7rem] border-[1.5px] border-border-strong bg-card px-2.5 font-mono text-sm text-text outline-none focus-visible:border-ring"
            />
            <ArrowRightIcon size={14} className="shrink-0 text-muted" />
            <input
              type="date"
              aria-label={t("to")}
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => onChange({ to: e.target.value })}
              className="h-10 rounded-[0.7rem] border-[1.5px] border-border-strong bg-card px-2.5 font-mono text-sm text-text outline-none focus-visible:border-ring"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Toggle({
  pressed,
  onClick,
  icon,
  label,
  count,
  tone,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  tone?: "wait";
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[0.7rem] border-[1.5px] px-3 text-sm font-semibold transition-colors",
        pressed ? "border-accent bg-accent text-accent-text" : "border-border-strong bg-card text-text hover:bg-soft",
      )}
    >
      {icon}
      {label}
      {count ? (
        <span
          className={cn(
            "rounded-full px-1.5 text-xs font-bold tabular-nums",
            pressed ? "bg-white/20" : tone === "wait" ? "bg-wait-bg text-wait-fg" : "bg-soft",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

const GRID = "lg:grid lg:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)_5.5rem_10.5rem] lg:items-center lg:gap-4";

function HeaderRow() {
  const t = useTranslations("trips.columns");
  return (
    <div className={cn("hidden border-b border-border bg-bay/60 px-5 py-2.5 text-xs font-bold text-muted", GRID)}>
      <span>{t("trip")}</span>
      <span>{t("car")}</span>
      <span>{t("driver")}</span>
      <span>{t("passenger")}</span>
      <span>{t("route")}</span>
      <span className="text-right">{t("km")}</span>
      <span>{t("status")}</span>
    </div>
  );
}

function TripRow({ trip }: { trip: HistoryTrip }) {
  const t = useTranslations("trips");
  const format = useFormatter();
  const duration = useDuration();
  const started = new Date(trip.start_time);
  const seconds = trip.end_time ? (new Date(trip.end_time).getTime() - new Date(trip.journey_start_time ?? trip.start_time).getTime()) / 1000 : null;
  const pending = trip.approval_status === "pending";

  const passenger = !trip.with_passenger ? (
    <span className="truncate text-muted italic">{trip.purpose || t("noPassenger")}</span>
  ) : trip.passenger_name ? (
    <span className="flex min-w-0 items-center gap-1.5">
      {trip.is_visitor ? <UserIcon size={14} className="shrink-0 text-muted" aria-label={t("visitor")} /> : null}
      <span className="truncate">{trip.passenger_name}</span>
    </span>
  ) : trip.status === "cancelled" ? (
    <span className="text-muted">–</span>
  ) : (
    <span className="truncate text-wait-fg">{t("passengerUnknown")}</span>
  );

  return (
    <Link
      href={`/admin/trips/${trip.id}`}
      className={cn(
        "group relative block px-4 py-3.5 transition-colors outline-none hover:bg-bay/70 focus-visible:bg-ring-soft sm:px-5",
        GRID,
      )}
    >
      {/* phones: a compact card */}
      <div className="flex flex-col gap-1.5 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <span className="font-display text-base font-bold text-title">{trip.car_code}</span>
            <span className="font-mono text-xs text-muted">{trip.trip_no}</span>
          </span>
          <TripStatusChip status={trip.status} />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="shrink-0 font-semibold text-text">{trip.driver_name}</span>
          <span className="text-muted">·</span>
          <span className="min-w-0 truncate text-sm">{passenger}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
          <span className="truncate">{trip.start_place}</span>
          <ArrowRightIcon size={13} className="shrink-0" />
          <span className="truncate text-text">{trip.end_place ?? trip.destination}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{format.dateTime(started, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
          {trip.distance_km !== null ? <span className="font-semibold text-title tabular-nums">{trip.distance_km} km</span> : null}
          {seconds !== null ? <span>{duration(seconds)}</span> : null}
          <Flags pending={pending} review={trip.needs_review} />
        </div>
      </div>

      {/* laptops: one line per trip */}
      <span className="hidden flex-col lg:flex">
        <span className="font-mono text-sm font-semibold text-title">{trip.trip_no}</span>
        <span className="text-xs text-muted">{format.dateTime(started, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
      </span>
      <span className="hidden flex-col lg:flex">
        <span className="font-display font-bold text-title">{trip.car_code}</span>
        <span className="truncate text-xs text-muted">{trip.car_model}</span>
      </span>
      <span className="hidden truncate text-sm font-semibold text-text lg:block">{trip.driver_name}</span>
      <span className="hidden min-w-0 text-sm lg:flex">{passenger}</span>
      <span className="hidden min-w-0 flex-col lg:flex">
        <span className="truncate text-sm text-text">{trip.end_place ?? trip.destination}</span>
        <span className="truncate text-xs text-muted">{t("fromPlace", { place: trip.start_place })}</span>
      </span>
      <span className="hidden flex-col items-end lg:flex">
        <span className="text-sm font-semibold text-title tabular-nums">{trip.distance_km !== null ? `${trip.distance_km} km` : "–"}</span>
        <span className="text-xs text-muted">{seconds !== null ? duration(seconds) : ""}</span>
      </span>
      <span className="hidden flex-col items-start gap-1 lg:flex">
        <TripStatusChip status={trip.status} />
        <Flags pending={pending} review={trip.needs_review} />
      </span>
    </Link>
  );
}

function Flags({ pending, review }: { pending: boolean; review: boolean }) {
  const t = useTranslations("trips");
  if (!pending && !review) return null;
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold">
      {pending ? (
        <span className="inline-flex items-center gap-1 text-wait-fg">
          <SealCheckIcon size={13} weight="bold" />
          {t("flags.approval")}
        </span>
      ) : review ? (
        <span className="inline-flex items-center gap-1 text-muted">
          <EyeIcon size={13} weight="bold" />
          {t("flags.check")}
        </span>
      ) : null}
    </span>
  );
}

function PageLink({
  filters,
  page,
  disabled,
  label,
  children,
}: {
  filters: Filters;
  page: number;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const cls = "inline-flex size-10 items-center justify-center rounded-[0.7rem] border-[1.5px] border-border-strong bg-card text-title";
  if (disabled)
    return (
      <span aria-disabled="true" className={cn(cls, "opacity-40")}>
        {children}
      </span>
    );
  return (
    <Link href={pageHref({ ...filters, page })} aria-label={label} scroll={false} className={cn(cls, "hover:bg-soft")}>
      {children}
    </Link>
  );
}

function Empty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  const t = useTranslations("trips.empty");
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <span className="mb-1 inline-flex size-12 items-center justify-center rounded-2xl bg-soft text-accent">
        <MagnifyingGlassIcon size={24} weight="duotone" />
      </span>
      <p className="font-display text-lg font-semibold text-title">{filtered ? t("filteredTitle") : t("title")}</p>
      <p className="max-w-sm text-sm text-muted">{filtered ? t("filteredBody") : t("body")}</p>
      {filtered ? (
        <button type="button" onClick={onClear} className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-[0.7rem] px-3 text-sm font-bold text-accent hover:bg-soft">
          <FunnelSimpleXIcon size={16} weight="bold" />
          {t("clear")}
        </button>
      ) : null}
    </div>
  );
}
