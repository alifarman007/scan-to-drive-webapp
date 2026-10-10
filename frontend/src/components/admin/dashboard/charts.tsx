"use client";

import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations, type DateTimeFormatOptions } from "next-intl";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import type { Dashboard } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { PanelTitle } from "./bits";

const EASE = [0.22, 1, 0.36, 1] as const;

/** A tidy top of the scale (5, 10, 20, 50 ...) so the gridlines land on round numbers. */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  // even steps only, so the middle gridline is a whole number too
  const step = [1, 2, 4, 6, 8, 10].find((s) => s * pow >= v) ?? 10;
  const top = step * pow;
  return top % 2 === 0 ? top : top + 1;
}

/** Km per car this month: one horizontal bar per car, longest first, the value written at the end. */
export function KmPerCar({ rows }: { rows: Dashboard["charts"]["km_per_car_this_month"] }) {
  const t = useTranslations("dashboard.charts");
  const sorted = [...rows].sort((a, b) => b.km - a.km || a.car_code.localeCompare(b.car_code));
  const max = Math.max(1, ...sorted.map((r) => r.km));
  const total = sorted.reduce((s, r) => s + r.km, 0);

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <PanelTitle title={t("kmTitle")} hint={t("kmHint", { km: total.toLocaleString("en-US") })} />
      {total === 0 ? (
        <Empty text={t("noKm")} />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label={t("kmTitle")}>
          {sorted.map((r, i) => (
            <li key={r.car_code} className="group grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-3" title={`${r.car_code}: ${r.km.toLocaleString("en-US")} km`}>
              <span className="font-mono text-xs font-semibold text-muted group-hover:text-title">{r.car_code}</span>
              <span className="relative h-3 rounded-r-[4px]">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-accent group-hover:bg-signal"
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.km / max) * 100}%` }}
                  transition={{ duration: 0.7, ease: EASE, delay: 0.05 * i }}
                  style={{ minWidth: r.km > 0 ? 3 : 0 }}
                />
              </span>
              <span className="text-right text-sm font-semibold text-title tabular-nums">
                {r.km.toLocaleString("en-US")}
                <span className="ml-0.5 text-xs font-normal text-muted">km</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Trips started per day this month: thin columns, today marked, a tooltip on hover or tap. */
export function TripsPerDay({ rows, today }: { rows: Dashboard["charts"]["trips_per_day_this_month"]; today: string }) {
  const t = useTranslations("dashboard.charts");
  const format = useFormatter();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...rows.map((r) => r.trips)));
  const total = rows.reduce((s, r) => s + r.trips, 0);
  const grid = [max, max / 2, 0];
  const H = 160;
  const dayLabel = (iso: string, opts: DateTimeFormatOptions) => format.dateTime(new Date(`${iso}T12:00:00+06:00`), opts);

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <PanelTitle title={t("tripsTitle")} hint={t("tripsHint", { count: total })} />
      {total === 0 ? (
        <Empty text={t("noTrips")} />
      ) : (
        <div className="relative flex gap-2" onMouseLeave={() => setHover(null)}>
          {/* y axis: three round numbers */}
          <div className="flex flex-col justify-between pb-6 text-right text-[0.7rem] text-muted tabular-nums" style={{ height: H + 24 }}>
            {grid.map((g) => (
              <span key={g} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
                {g}
              </span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: H }}>
              {grid.map((g) => (
                <span key={g} className={cn("h-px w-full", g === 0 ? "bg-border-strong" : "bg-border/70")} />
              ))}
            </div>
            <div className="relative flex items-end gap-[2px]" style={{ height: H }} role="list" aria-label={t("tripsTitle")}>
              {rows.map((r, i) => {
                const isToday = r.date === today;
                return (
                  <button
                    key={r.date}
                    type="button"
                    role="listitem"
                    aria-label={`${dayLabel(r.date, { day: "numeric", month: "long" })}: ${t("tripsCount", { count: r.trips })}`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    onClick={() => setHover(i)}
                    className="group relative flex h-full min-w-0 flex-1 items-end justify-center outline-none"
                  >
                    <motion.span
                      className={cn(
                        "w-full max-w-4 rounded-t-[4px] transition-colors",
                        isToday ? "bg-signal" : "bg-accent/75 group-hover:bg-accent group-focus-visible:bg-accent",
                        r.trips === 0 && "bg-transparent",
                      )}
                      initial={{ height: 0 }}
                      animate={{ height: r.trips ? Math.max(3, (r.trips / max) * H) : 0 }}
                      transition={{ duration: 0.6, ease: EASE, delay: 0.015 * i }}
                    />
                  </button>
                );
              })}
            </div>
            {/* x axis: 1, 5, 10 ... and today */}
            <div className="relative mt-1.5 h-4 text-[0.7rem] text-muted">
              {rows.map((r, i) => {
                const day = Number(r.date.slice(8));
                const isToday = r.date === today;
                if (!(isToday || day === 1 || (day % 5 === 0 && Math.abs(rows.length - day) > 1))) return null;
                return (
                  <span
                    key={r.date}
                    className={cn("absolute -translate-x-1/2 tabular-nums", isToday && "font-bold text-signal")}
                    style={{ left: `${((i + 0.5) / rows.length) * 100}%` }}
                  >
                    {isToday ? t("today") : day}
                  </span>
                );
              })}
            </div>
            <AnimatePresence>
              {hover !== null && rows[hover] ? (
                <motion.div
                  key="tip"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-xl border border-border bg-card px-3 py-2 text-xs whitespace-nowrap shadow-lift"
                  style={{
                    left: `clamp(3.5rem, ${((hover + 0.5) / rows.length) * 100}%, calc(100% - 3.5rem))`,
                    bottom: Math.min(H, (rows[hover].trips / max) * H) + 34,
                  }}
                >
                  <span className="block text-muted">{dayLabel(rows[hover].date, { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="font-semibold text-title">{t("tripsCount", { count: rows[hover].trips })}</span>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      )}
      {/* the same numbers as a table, for screen readers */}
      <table className="sr-only">
        <caption>{t("tripsTitle")}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <th scope="row">{r.date}</th>
              <td>{r.trips}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl bg-bay px-4 py-10 text-center text-sm text-muted">{text}</p>;
}
