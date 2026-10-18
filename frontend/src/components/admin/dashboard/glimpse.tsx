"use client";

import { ArrowRightIcon, ChartLineUpIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useId, useState } from "react";

import { REPORT_ICON } from "@/components/admin/reports/reports";
import { Card } from "@/components/ui/card";
import type { Dashboard } from "@/lib/admin-api";
import type { ReportName } from "@/lib/report-filters";
import { cn } from "@/lib/utils";

import { CountUp } from "./bits";

const EASE = [0.22, 1, 0.36, 1] as const;
const QUICK: ReportName[] = ["monthly_summary", "car_usage", "drivers", "exceptions"];

/**
 * This month at a glance, taken from the reports: trips and km so far, how the days went, the busiest cars,
 * and a door into the full Reports page.
 */
export function ReportsGlimpse({ charts, today }: { charts: Dashboard["charts"]; today: string }) {
  const t = useTranslations("dashboard.glimpse");
  const tr = useTranslations("reports");
  const format = useFormatter();
  const days = charts.trips_per_day_this_month;
  const trips = days.reduce((s, d) => s + d.trips, 0);
  const km = charts.km_per_car_this_month.reduce((s, r) => s + r.km, 0);
  const carsUsed = charts.km_per_car_this_month.filter((r) => r.km > 0).length;
  const busiest = [...charts.km_per_car_this_month].filter((r) => r.km > 0).sort((a, b) => b.km - a.km).slice(0, 3);
  const month = format.dateTime(new Date(`${today}T12:00:00+06:00`), { month: "long", year: "numeric" });

  return (
    <Card className="relative overflow-hidden p-0">
      {/* soft light in the corner */}
      <span aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-soft text-accent">
            <ChartLineUpIcon size={22} weight="duotone" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="font-display text-lg leading-tight font-semibold text-title">{t("title")}</h2>
            <p className="text-sm text-muted">{t("hint", { month })}</p>
          </div>
        </div>
        <Link
          href="/admin/reports"
          className="group inline-flex h-10 items-center gap-2 rounded-[0.8rem] bg-accent px-4 text-sm font-bold text-accent-text shadow-[0_10px_24px_-12px_rgb(40_77_174/0.8)] transition-[filter] hover:brightness-110"
        >
          {t("open")}
          <ArrowRightIcon size={16} weight="bold" className="transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      </div>

      <div className="relative grid gap-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* left: three numbers and the month's days */}
        <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-5 lg:border-r lg:border-border">
          <dl className="grid grid-cols-3 gap-3">
            <Stat label={t("trips")} value={trips} />
            <Stat label={t("km")} value={km} unit={tr("km")} />
            <Stat label={t("carsUsed")} value={carsUsed} />
          </dl>
          <Spark days={days} today={today} />
        </div>

        {/* right: busiest cars and the quick doors */}
        <div className="flex min-w-0 flex-col gap-4 border-t border-border p-4 sm:p-5 lg:border-t-0">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold tracking-wide text-muted uppercase">{t("busiest")}</p>
            {busiest.length === 0 ? (
              <p className="rounded-2xl bg-bay px-4 py-5 text-center text-sm text-muted">{t("noKm")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {busiest.map((c, i) => (
                  <li key={c.car_code} className="grid grid-cols-[1.4rem_4.5rem_minmax(0,1fr)_4.25rem] items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex size-5 items-center justify-center rounded-full text-[0.65rem] font-bold",
                        i === 0 ? "bg-accent text-accent-text" : "bg-soft text-title",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="font-mono text-xs font-semibold text-title">{c.car_code}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-bay">
                      <motion.span
                        className="block h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-ring))]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(c.km / busiest[0].km) * 100}%` }}
                        transition={{ duration: 0.9, delay: 0.35 + i * 0.1, ease: EASE }}
                      />
                    </span>
                    <span className="text-right text-sm font-bold text-title tabular-nums">
                      {c.km.toLocaleString("en-US")}
                      <span className="ml-0.5 text-xs font-normal text-muted">{tr("km")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <p className="text-xs font-bold tracking-wide text-muted uppercase">{t("quick")}</p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK.map((r, i) => {
                const ReportIcon = REPORT_ICON[r];
                return (
                  <motion.div
                    key={r}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.3 + i * 0.06, ease: EASE }}
                  >
                    <Link
                      href={r === "monthly_summary" ? "/admin/reports" : `/admin/reports?r=${r}`}
                      className="group flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-title transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-lift"
                    >
                      <ReportIcon size={18} weight="duotone" className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 py-1.5 leading-tight">{tr(`names.${r}.title`)}</span>
                      <ArrowRightIcon size={14} weight="bold" className="shrink-0 -translate-x-1 text-accent opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-bay/70 px-3 py-2.5">
      <dt className="truncate text-xs font-semibold text-muted">{label}</dt>
      <dd className="font-display text-xl leading-none font-bold text-title tabular-nums sm:text-2xl">
        <CountUp value={value} />
        {unit ? <span className="ml-1 text-xs font-semibold text-muted">{unit}</span> : null}
      </dd>
    </div>
  );
}

/** Trips per day this month as a soft line with a filled area; today is the bright dot. Hover a day to read it. */
function Spark({ days, today }: { days: Dashboard["charts"]["trips_per_day_this_month"]; today: string }) {
  const t = useTranslations("dashboard.glimpse");
  const format = useFormatter();
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 120;
  const PAD = 8;
  const max = Math.max(1, ...days.map((d) => d.trips));
  const n = days.length;
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2));
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2 - 6);
  const pts = days.map((d, i) => [x(i), y(d.trips)] as const);

  // a smooth line through the points (monotone, so it never dips below zero between two quiet days)
  let line = "";
  pts.forEach(([px, py], i) => {
    if (i === 0) {
      line = `M${px},${py}`;
      return;
    }
    const [qx, qy] = pts[i - 1];
    const mx = (qx + px) / 2;
    line += ` C${mx},${qy} ${mx},${py} ${px},${py}`;
  });
  const area = n ? `${line} L${pts[n - 1][0]},${H} L${pts[0][0]},${H} Z` : "";
  const last = pts[n - 1];
  const dayLabel = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00+06:00`), { weekday: "short", day: "numeric", month: "short" });

  if (!n) return null;
  return (
    <div className="relative">
      <p className="mb-1.5 text-xs font-bold tracking-wide text-muted uppercase">{t("perDay")}</p>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-28 w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ring)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--color-ring)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`stroke-${id}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--color-accent)" />
              <stop offset="100%" stopColor="var(--color-ring)" />
            </linearGradient>
          </defs>
          <line x1="0" x2={W} y1={H - PAD} y2={H - PAD} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <motion.path
            d={area}
            fill={`url(#fill-${id})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.6 }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke={`url(#stroke-${id})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.3, delay: 0.25, ease: EASE }}
          />
          {hover !== null ? (
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={0} y2={H - PAD} stroke="var(--color-border-strong)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
        {/* dots are HTML so they stay round while the chart stretches */}
        {last && days[n - 1].date === today ? (
          <motion.span
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal ring-4 ring-signal/20"
            style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 1.4, type: "spring", stiffness: 400, damping: 18 }}
          />
        ) : null}
        {hover !== null ? (
          <span
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent"
            style={{ left: `${(pts[hover][0] / W) * 100}%`, top: `${(pts[hover][1] / H) * 100}%` }}
          />
        ) : null}
        {/* invisible columns for hovering / tapping a day */}
        <div className="absolute inset-0 flex">
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="h-full flex-1 cursor-default"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            />
          ))}
        </div>
        <AnimatePresence>
          {hover !== null ? (
            <motion.div
              key="tip"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-card px-3 py-1.5 text-xs whitespace-nowrap shadow-lift"
              style={{ left: `clamp(3.5rem, ${(pts[hover][0] / W) * 100}%, calc(100% - 3.5rem))` }}
            >
              <span className="text-muted">{dayLabel(days[hover].date)}</span>{" "}
              <span className="font-semibold text-title">{t("tripsCount", { count: days[hover].trips })}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <div className="mt-1 flex justify-between text-[0.7rem] text-muted tabular-nums">
        <span>{Number(days[0].date.slice(8))}</span>
        <span className={cn(days[n - 1].date === today && "font-bold text-signal")}>{days[n - 1].date === today ? t("today") : Number(days[n - 1].date.slice(8))}</span>
      </div>
      {/* the same numbers as a table, for screen readers */}
      <table className="sr-only">
        <caption>{t("perDay")}</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{d.trips}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
