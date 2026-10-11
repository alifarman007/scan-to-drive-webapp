"use client";

import { ArrowRightIcon, CheckCircleIcon, MagnifyingGlassIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { TripStatusChip } from "@/components/admin/trip-status";
import { Card } from "@/components/ui/card";
import type { DayActivity, HistoryTrip, RatingSummary } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

/*
 * Pieces shared by the Cars, Drivers and Alerts pages: page header, search box, a segmented switch with a
 * sliding pill, number plate, avatar, 30-day activity chart, recent trips, a confirmation toast.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

export function PageHeader({ title, summary, children }: { title: string; summary?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-3xl font-bold text-title">{title}</h1>
        {summary ? <p className="text-sm text-muted">{summary}</p> : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Search box: filters as you type, Esc or the X clears it. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const t = useTranslations("fleet");
  return (
    <div
      className={cn(
        "flex h-11 min-w-0 items-center gap-2.5 rounded-control border-[1.5px] border-border-strong bg-card px-3.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_4px_var(--ring-soft)]",
        className,
      )}
    >
      <MagnifyingGlassIcon size={18} className="shrink-0 text-muted" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        className="min-w-0 flex-1 bg-transparent text-[0.95rem] text-text outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      <AnimatePresence>
        {value ? (
          <motion.button
            type="button"
            aria-label={t("clearSearch")}
            onClick={() => onChange("")}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            className="inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-title"
          >
            <XIcon size={14} weight="bold" />
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export type SegmentOption<T extends string> = { value: T; label: string; count?: number; dot?: string };

/** A few choices side by side; the chosen one sits on a pill that slides across. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  id,
  label,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** unique per page, for the sliding pill */
  id: string;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex max-w-full overflow-x-auto rounded-control bg-soft p-1 [scrollbar-width:none]", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex h-9 shrink-0 items-center gap-2 rounded-[0.65rem] px-3.5 text-sm font-bold whitespace-nowrap transition-colors",
              on ? "text-title" : "text-muted hover:text-title",
            )}
          >
            {on ? (
              <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[0.65rem] bg-card shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
            ) : null}
            {o.dot ? <span className={cn("relative size-2 rounded-full", o.dot)} /> : null}
            <span className="relative">{o.label}</span>
            {o.count !== undefined ? (
              <span className={cn("relative rounded-full px-1.5 text-xs tabular-nums", on ? "bg-soft text-title" : "bg-card/60 text-muted")}>{o.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A Bangladeshi number plate: white plate, thin dark frame, the registration in bold. */
export function Plate({ reg, size = "md", className }: { reg: string; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[0.4rem] border-[1.5px] border-[#1b2338] bg-white font-mono font-bold tracking-wide whitespace-nowrap text-[#1b2338] shadow-[inset_0_0_0_2px_#fff,inset_0_0_0_3px_rgb(27_35_56/0.25)] dark:border-[#cfd6e8]",
        size === "sm" ? "h-6 px-1.5 text-[0.7rem]" : "h-8 px-2.5 text-sm",
        className,
      )}
    >
      {reg}
    </span>
  );
}

const AVATAR_TONES = [
  "from-[#284dae] to-[#155dfc]",
  "from-[#1c2e6f] to-[#3f66d8]",
  "from-[#0e8a5f] to-[#2bb683]",
  "from-[#8a4b08] to-[#e59a1a]",
  "from-[#5b3fd1] to-[#8f7cf0]",
  "from-[#a3182f] to-[#e2566f]",
];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Initials on a soft gradient; the colour comes from the name, so a person always has the same one. */
export function Avatar({ name, size = 48, dim, className }: { name: string; size?: number; dim?: boolean; className?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-display font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]",
        dim ? "from-[#8a93a8] to-[#aeb6cc] grayscale" : AVATAR_TONES[h % AVATAR_TONES.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** "★ 4.6 (12)", or nothing when there are no ratings yet. */
export function RatingBadge({ rating, className }: { rating: RatingSummary; className?: string }) {
  const t = useTranslations("fleet");
  if (!rating) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full bg-star-soft/70 px-2 py-0.5 text-xs font-bold text-title tabular-nums", className)}
      title={t("ratingTitle", { avg: rating.average, count: rating.count })}
    >
      <StarIcon size={12} weight="fill" className="text-star" />
      {rating.average.toFixed(1)}
      <span className="font-semibold text-muted">({rating.count})</span>
    </span>
  );
}

/** A number with a small label under it. */
export function Stat({ label, value, unit, className }: { label: string; value: React.ReactNode; unit?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="truncate font-display text-xl font-bold text-title tabular-nums">
        {value}
        {unit ? <span className="ml-1 text-sm font-semibold text-muted">{unit}</span> : null}
      </span>
    </div>
  );
}

/** Last 30 days: one column per day (km), today on the right, a label on hover or tap. */
export function ActivityChart({ days }: { days: DayActivity[] }) {
  const t = useTranslations("fleet.activity");
  const format = useFormatter();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.km));
  const totalKm = days.reduce((s, d) => s + d.km, 0);
  const totalTrips = days.reduce((s, d) => s + d.trips, 0);
  const activeDays = days.filter((d) => d.trips > 0).length;
  const label = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00+06:00`), { day: "numeric", month: "short" });
  const shown = hover !== null ? days[hover] : null;

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-lg font-semibold text-title">{t("title")}</h2>
          <p className="text-sm text-muted">{t("hint", { km: totalKm.toLocaleString("en-US"), trips: totalTrips, days: activeDays })}</p>
        </div>
        <div className="h-10 text-right">
          <AnimatePresence mode="wait">
            {shown ? (
              <motion.div key={shown.date} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex flex-col">
                <span className="text-xs font-semibold text-muted">{label(shown.date)}</span>
                <span className="text-sm font-bold text-title tabular-nums">
                  {t("dayValue", { km: shown.km.toLocaleString("en-US"), trips: shown.trips })}
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      {totalTrips === 0 ? (
        <p className="rounded-2xl bg-bay px-4 py-8 text-center text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex h-28 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
            {days.map((d, i) => {
              const last = i === days.length - 1;
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-label={`${label(d.date)}: ${t("dayValue", { km: d.km, trips: d.trips })}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onClick={() => setHover(i)}
                  className="group relative flex h-full min-w-0 flex-1 items-end outline-none"
                >
                  <motion.span
                    className={cn(
                      "block w-full rounded-t-[3px] transition-colors",
                      d.km === 0 ? (d.trips ? "bg-sky/60" : "bg-border") : last ? "bg-signal" : hover === i ? "bg-signal" : "bg-accent",
                    )}
                    initial={{ height: 0 }}
                    animate={{ height: d.km === 0 ? (d.trips ? 6 : 2) : `${Math.max(6, (d.km / max) * 100)}%` }}
                    transition={{ duration: 0.6, ease: EASE, delay: 0.012 * i }}
                  />
                </button>
              );
            })}
          </div>
          <div className="flex justify-between text-[0.7rem] font-semibold text-muted">
            <span>{label(days[0].date)}</span>
            <span className="text-signal">{t("today")}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

/** The last trips of a car or driver, each opening the trip; "All trips" goes to the filtered history. */
export function RecentTrips({ trips, allHref, show }: { trips: HistoryTrip[]; allHref: string; show: "driver" | "car" }) {
  const t = useTranslations("fleet.recent");
  const format = useFormatter();
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-title">{t("title")}</h2>
        {trips.length ? (
          <Link href={allHref} className="inline-flex items-center gap-1 text-sm font-bold text-accent hover:underline">
            {t("all")}
            <ArrowRightIcon size={14} weight="bold" />
          </Link>
        ) : null}
      </div>
      {trips.length === 0 ? (
        <p className="rounded-2xl bg-bay px-4 py-8 text-center text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link
                href={`/admin/trips/${trip.id}`}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-2xl px-2 py-2.5 transition-colors hover:bg-bay sm:grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_auto]"
              >
                <span className="flex flex-col">
                  <span className="font-mono text-sm font-semibold text-title">{trip.trip_no}</span>
                  <span className="text-xs text-muted">
                    {format.dateTime(new Date(trip.start_time), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  </span>
                </span>
                <span className="hidden min-w-0 flex-col sm:flex">
                  <span className="truncate text-sm font-semibold text-text">{trip.destination}</span>
                  <span className="truncate text-xs text-muted">
                    {show === "driver" ? trip.driver_name : trip.car_code}
                    {trip.passenger_name ? ` · ${trip.passenger_name}` : ""}
                  </span>
                </span>
                <span className="hidden text-right text-sm font-semibold text-title tabular-nums sm:block">
                  {trip.distance_km !== null ? `${trip.distance_km} km` : "–"}
                </span>
                <span className="justify-self-end">
                  <TripStatusChip status={trip.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A short "Saved" message at the bottom of the screen after an action. */
export function useFlash() {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((t: string) => {
    setText(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 lg:bottom-8">
      <AnimatePresence>
        {text ? (
          <motion.p
            key={text}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 480, damping: 34 }}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-2xl ring-1 ring-white/10"
          >
            <CheckCircleIcon size={18} weight="fill" className="text-[#2bb683]" />
            {text}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
  return [node, show] as const;
}

/** Nothing matches the search / filter. */
export function EmptyList({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 border-dashed px-6 py-12 text-center">
      <span className="mb-1 inline-flex size-14 items-center justify-center rounded-2xl bg-soft text-accent">{icon}</span>
      <p className="font-display text-lg font-semibold text-title">{title}</p>
      <p className="max-w-sm text-sm text-muted">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </Card>
  );
}

/** Keeps a search box and a status switch in the address (?q=&status=), without reloading the page. */
export function useUrlState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      const url = new URL(window.location.href);
      if (v) url.searchParams.set(key, v);
      else url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url);
    },
    [key],
  );
  return [value, set];
}

/** "?new=1" (just added) shows a note once; take it out of the address so a refresh or the back button does not show it again. */
export function useDropNewParam(isNew: boolean) {
  useEffect(() => {
    if (!isNew) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url);
  }, [isNew]);
}
