"use client";

import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretUpIcon,
  ColumnsIcon,
  MagnifyingGlassIcon,
  TrayIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CountUp } from "@/components/admin/dashboard/bits";
import { TripStatusChip } from "@/components/admin/trip-status";
import { Card } from "@/components/ui/card";
import { LiveDot } from "@/components/ui/live-dot";
import { StatusChip, type Status } from "@/components/ui/status-chip";
import type { ReportCell, ReportData, ReportSection, TripStatus } from "@/lib/admin-api";
import { useScrollFade } from "@/lib/hooks";
import { slug, type ReportFilters, type ReportName } from "@/lib/report-filters";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const STEP = 50; // table rows shown at a time
/** Columns the backend marks as main (they fit the PDF) but that are better tucked away on screen. */
const SCREEN_EXTRA: Partial<Record<ReportName, string[]>> = { km_continuity: ["previous_trip_no", "driver"] };
const TRIP_STATUSES = new Set(["waiting_for_passenger", "in_progress", "waiting_for_end_confirm", "completed", "cancelled", "closed_by_admin"]);

/** A label from the backend in the chosen language (the backend writes English; the key is the same slug). */
function useLabel() {
  const t = useTranslations("reports.label");
  return (english: string) => {
    const k = slug(english);
    return k && t.has(k) ? t(k) : english;
  };
}

const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** The headline numbers, the picture for this report, then its tables. */
export function ReportView({
  data,
  name,
  onNarrow,
}: {
  data: ReportData;
  name: ReportName;
  onNarrow: (f: Partial<ReportFilters>) => void;
}) {
  const t = useTranslations("reports");
  const label = useLabel();
  const rows = data.sections.reduce((n, s) => n + s.rows.length, 0);
  const nothing = rows === 0 || (name === "car_usage" && data.sections[0].rows.every((r) => !r.trips));

  return (
    <div className="flex flex-col gap-section">
      <Summary data={data} />

      {Object.keys(data.filters).length ? (
        <p className="-mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {t("narrowedTo")}
          {Object.entries(data.filters).map(([k, v]) => (
            <span key={k} className="rounded-full bg-soft px-2.5 py-1 font-semibold text-title">
              {label(k)}: {v}
            </span>
          ))}
        </p>
      ) : null}

      {nothing && name !== "monthly_summary" ? (
        <EmptyReport />
      ) : (
        <>
          <Highlights data={data} name={name} onNarrow={onNarrow} />
          {name === "monthly_summary"
            ? null
            : data.sections.map((s, i) => <ReportTable key={`${s.key ?? i}`} section={s} name={name} delay={0.1 + i * 0.08} />)}
        </>
      )}
    </div>
  );
}

/* ---- headline numbers ---------------------------------------------------------------------------- */

function Summary({ data }: { data: ReportData }) {
  const label = useLabel();
  const t = useTranslations("reports");
  const items = data.summary;
  if (!items.length) return null;
  // the monthly summary has "... now" numbers too: they describe this moment, not the period, so they get a live dot
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", items.length > 4 ? "lg:grid-cols-4 xl:grid-cols-6" : "lg:grid-cols-4")}>
      {items.map((s, i) => {
        const first = i === 0;
        const now = s.key.endsWith("_now");
        const isKm = /(^|_)km($|_)/.test(s.key);
        return (
          <motion.div
            key={s.key}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.035 * i, ease: EASE }}
            className={cn(
              "relative flex min-w-0 flex-col justify-between gap-2 overflow-hidden rounded-card border p-4",
              first
                ? "border-transparent bg-[linear-gradient(140deg,var(--color-navy),var(--color-epic))] text-white shadow-[0_18px_40px_-22px_rgb(28_46_111/0.9)]"
                : "border-border bg-card",
            )}
          >
            {first ? <span aria-hidden="true" className="pointer-events-none absolute -top-10 -right-8 size-32 rounded-full bg-white/10 blur-2xl" /> : null}
            <span className={cn("flex items-center gap-1.5 text-xs leading-snug font-semibold", first ? "text-white/75" : "text-muted")}>
              {now ? <LiveDot className="bg-ok-dot" /> : null}
              {label(s.label)}
            </span>
            <span className={cn("font-display text-2xl leading-none font-bold tabular-nums sm:text-[1.7rem]", first ? "text-white" : "text-title")}>
              {typeof s.value === "number" ? (
                <>
                  <CountUp value={s.value} />
                  {isKm && !/per_trip/.test(s.key) ? (
                    <span className={cn("ml-1 text-sm font-semibold", first ? "text-white/70" : "text-muted")}>{t("km")}</span>
                  ) : null}
                </>
              ) : (
                s.value
              )}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---- the picture for each report -------------------------------------------------------------- */

type Bar = { label: string; value: number; sub?: string; href?: string; onClick?: () => void; mono?: boolean };

function Highlights({ data, name, onNarrow }: { data: ReportData; name: ReportName; onNarrow: (f: Partial<ReportFilters>) => void }) {
  const t = useTranslations("reports.chart");
  const label = useLabel();
  const s0 = data.sections[0];
  const trips = (n: ReportCell) => t("trips", { count: Number(n) || 0 });

  if (name === "monthly_summary") {
    const [cars, depts] = data.sections;
    return (
      <div className="grid gap-section lg:grid-cols-2">
        <BarCard
          title={label(cars?.title ?? "Busiest cars")}
          empty={t("noKm")}
          bars={(cars?.rows ?? []).map((r) => ({ label: String(r.car_code), value: Number(r.km) || 0, sub: trips(r.trips), mono: true }))}
          delay={0.1}
        />
        <BarCard
          title={label(depts?.title ?? "Top departments")}
          empty={t("noKm")}
          bars={(depts?.rows ?? []).map((r) => ({ label: label(String(r.department)), value: Number(r.km) || 0, sub: trips(r.trips) }))}
          delay={0.18}
        />
      </div>
    );
  }
  if (name === "car_usage") {
    const used = s0.rows.filter((r) => Number(r.km) > 0);
    if (!used.length) return null;
    return (
      <BarCard
        title={t("kmByCar")}
        hint={t("tapToNarrow")}
        bars={used.slice(0, 8).map((r) => ({
          label: String(r.car_code),
          value: Number(r.km),
          sub: trips(r.trips),
          mono: true,
          onClick: r.car_id ? () => onNarrow({ car: String(r.car_id) }) : undefined,
        }))}
        more={used.length > 8 ? t("more", { count: used.length - 8 }) : undefined}
        delay={0.08}
      />
    );
  }
  if (name === "drivers") {
    const used = s0.rows.filter((r) => Number(r.km) > 0);
    if (!used.length) return null;
    return (
      <BarCard
        title={t("kmByDriver")}
        hint={t("tapToNarrow")}
        bars={used.slice(0, 8).map((r) => ({
          label: String(r.name),
          value: Number(r.km),
          sub: trips(r.trips),
          onClick: r.driver_ref ? () => onNarrow({ driver: String(r.driver_ref) }) : undefined,
        }))}
        more={used.length > 8 ? t("more", { count: used.length - 8 }) : undefined}
        delay={0.08}
      />
    );
  }
  if (name === "passenger_department") {
    const parts = s0.rows.filter((r) => Number(r.km) > 0);
    if (!parts.length) return null;
    return <ShareCard rows={parts.map((r) => ({ label: label(String(r.department)), km: Number(r.km), share: Number(r.km_share_percent) }))} />;
  }
  if (name === "km_continuity") {
    const counts: Record<string, number> = {};
    for (const r of s0.rows) counts[String(r.result_code)] = (counts[String(r.result_code)] ?? 0) + 1;
    return <ContinuityStrip counts={counts} total={s0.rows.length} />;
  }
  return null;
}

/** Horizontal bars, longest first, value at the end. A bar can narrow the report to that car or driver. */
function BarCard({
  title,
  hint,
  bars,
  empty,
  more,
  delay = 0,
}: {
  title: string;
  hint?: string;
  bars: Bar[];
  empty?: string;
  more?: string;
  delay?: number;
}) {
  const t = useTranslations("reports");
  const max = Math.max(1, ...bars.map((b) => b.value));
  const has = bars.some((b) => b.value > 0);
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay, ease: EASE }}>
      <Card className="flex h-full flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-lg font-semibold text-title">{title}</h2>
          {hint && has ? <p className="text-xs text-muted">{hint}</p> : null}
        </div>
        {!has ? (
          <p className="rounded-2xl bg-bay px-4 py-8 text-center text-sm text-muted">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {bars.map((b, i) => {
              const inner = (
                <>
                  <span className={cn("truncate text-sm font-semibold text-title", b.mono && "font-mono text-xs")}>{b.label}</span>
                  <span className="relative h-2.5 overflow-hidden rounded-full bg-bay">
                    <motion.span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full",
                        i === 0 ? "bg-[linear-gradient(90deg,var(--color-accent),var(--color-ring))]" : "bg-accent/70 group-hover:bg-accent",
                      )}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, (b.value / max) * 100)}%` }}
                      transition={{ duration: 0.8, delay: delay + 0.15 + 0.05 * i, ease: EASE }}
                    />
                  </span>
                  <span className="flex flex-col items-end leading-tight">
                    <span className="text-sm font-bold text-title tabular-nums">
                      {num(b.value)}
                      <span className="ml-0.5 text-xs font-normal text-muted">{t("km")}</span>
                    </span>
                    {b.sub ? <span className="text-[0.7rem] text-muted">{b.sub}</span> : null}
                  </span>
                </>
              );
              const cls = "group grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_4.75rem] items-center gap-3 rounded-xl px-2 py-1.5 text-left";
              return (
                <li key={`${b.label}-${i}`}>
                  {b.onClick ? (
                    <button type="button" onClick={b.onClick} className={cn(cls, "transition-colors hover:bg-soft focus-visible:bg-soft focus-visible:outline-none")}>
                      {inner}
                    </button>
                  ) : (
                    <div className={cls}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {more ? <p className="px-2 text-xs text-muted">{more}</p> : null}
      </Card>
    </motion.div>
  );
}

const SHARE_COLOURS = ["#284dae", "#155dfc", "#5b8def", "#0e8a5f", "#e59a1a", "#8a93a8", "#d93250", "#7c5cdb"];

/** Departments' share of the km as one long bar, with a legend. */
function ShareCard({ rows }: { rows: { label: string; km: number; share: number }[] }) {
  const t = useTranslations("reports.chart");
  const top = rows.slice(0, 7);
  const rest = rows.slice(7);
  const parts = rest.length
    ? [...top, { label: t("others"), km: rest.reduce((s, r) => s + r.km, 0), share: Math.round(rest.reduce((s, r) => s + r.share, 0) * 10) / 10 }]
    : top;
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08, ease: EASE }}>
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <h2 className="font-display text-lg font-semibold text-title">{t("deptShare")}</h2>
        <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-bay" role="img" aria-label={t("deptShare")}>
          {parts.map((p, i) => (
            <motion.span
              key={p.label}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ background: SHARE_COLOURS[i % SHARE_COLOURS.length] }}
              initial={{ width: 0 }}
              animate={{ width: `${p.share}%` }}
              transition={{ duration: 0.8, delay: 0.2 + i * 0.06, ease: EASE }}
              title={`${p.label}: ${p.share}%`}
            />
          ))}
        </div>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {parts.map((p, i) => (
            <li key={p.label} className="flex min-w-0 items-center gap-2 text-sm">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SHARE_COLOURS[i % SHARE_COLOURS.length] }} />
              <span className="min-w-0 flex-1 truncate font-semibold text-title">{p.label}</span>
              <span className="text-muted tabular-nums">{p.share}%</span>
            </li>
          ))}
        </ul>
      </Card>
    </motion.div>
  );
}

const RESULT_TONE: Record<string, Status> = {
  ok: "available",
  unrecorded: "waiting",
  went_back: "alert",
  first: "inactive",
  no_previous_end: "inactive",
};

/** Km continuity at a glance: how many trips matched the last reading, how many had a gap. */
function ContinuityStrip({ counts, total }: { counts: Record<string, number>; total: number }) {
  const t = useTranslations("reports.result");
  if (!total) return null;
  const order = ["ok", "unrecorded", "went_back", "first", "no_previous_end"].filter((k) => counts[k]);
  const colour: Record<string, string> = {
    ok: "var(--ok-dot)",
    unrecorded: "var(--wait-dot)",
    went_back: "var(--bad-dot)",
    first: "var(--off-dot)",
    no_previous_end: "var(--border-strong)",
  };
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08, ease: EASE }}>
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-bay">
          {order.map((k, i) => (
            <motion.span
              key={k}
              className="h-full"
              style={{ background: colour[k] }}
              initial={{ width: 0 }}
              animate={{ width: `${(counts[k] / total) * 100}%` }}
              transition={{ duration: 0.8, delay: 0.2 + i * 0.08, ease: EASE }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {order.map((k) => (
            <StatusChip key={k} status={RESULT_TONE[k]} size="sm">
              {t(`${k}Count`, { count: counts[k] })}
            </StatusChip>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}

/* ---- tables -------------------------------------------------------------------------------------- */

type Sort = { key: string; dir: 1 | -1 } | null;

/** One table of the report: search, sort by any column, main or all columns, 50 rows at a time. */
function ReportTable({ section, name, delay }: { section: ReportSection; name: ReportName; delay: number }) {
  const t = useTranslations("reports.table");
  const label = useLabel();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [shown, setShown] = useState(STEP);
  const [all, setAll] = useState(false);
  const [fadeRef, fadeStyle] = useScrollFade<HTMLDivElement>();

  const extra = SCREEN_EXTRA[name] ?? [];
  const main = section.columns.filter((c) => c.main && !extra.includes(c.key));
  const hidden = section.columns.length - main.length;
  const columns = all ? section.columns : main;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = section.rows;
    if (needle) {
      out = out.filter((r) => section.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(needle)));
    }
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (x === y) return 0;
        if (x === null || x === "") return 1; // empty cells always last
        if (y === null || y === "") return -1;
        if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
        return String(x).localeCompare(String(y), "en", { numeric: true }) * sort.dir;
      });
    }
    return out;
  }, [section, q, sort]);

  const numeric = useMemo(() => {
    const set = new Set<string>();
    for (const c of section.columns) {
      const sample = section.rows.find((r) => r[c.key] !== null && r[c.key] !== "");
      if (sample && typeof sample[c.key] === "number" && !/(_id|_no)$/.test(c.key)) set.add(c.key);
    }
    return set;
  }, [section]);

  function toggleSort(key: string) {
    setSort((s) => (s?.key !== key ? { key, dir: numeric.has(key) ? -1 : 1 } : s.dir === (numeric.has(key) ? -1 : 1) ? { key, dir: s.dir === 1 ? -1 : 1 } : null));
  }

  const visible = rows.slice(0, shown);
  const searchable = section.rows.length > 8;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay, ease: EASE }}>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="font-display text-lg font-semibold text-title">{section.title ? label(section.title) : t("details")}</h2>
            <span className="text-sm text-muted tabular-nums">{t("rows", { count: rows.length })}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {searchable ? (
              <label className="relative flex h-9 w-full min-w-0 items-center sm:w-56">
                <MagnifyingGlassIcon size={16} className="pointer-events-none absolute left-3 text-muted" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setShown(STEP);
                  }}
                  placeholder={t("search")}
                  aria-label={t("search")}
                  className="h-full w-full rounded-[0.7rem] border-[1.5px] border-border-strong bg-card pr-8 pl-9 text-sm text-text outline-none placeholder:text-muted focus-visible:border-ring [&::-webkit-search-cancel-button]:hidden"
                />
                {q ? (
                  <button type="button" onClick={() => setQ("")} aria-label={t("clearSearch")} className="absolute right-2 text-muted hover:text-title">
                    <XIcon size={14} weight="bold" />
                  </button>
                ) : null}
              </label>
            ) : null}
            {hidden ? (
              <button
                type="button"
                aria-pressed={all}
                onClick={() => setAll((v) => !v)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-[0.7rem] border-[1.5px] px-3 text-sm font-semibold transition-colors",
                  all ? "border-accent bg-accent text-accent-text" : "border-border-strong bg-card text-text hover:bg-soft",
                )}
              >
                <ColumnsIcon size={16} weight="bold" />
                {all ? t("mainColumns") : t("allColumns", { count: hidden })}
              </button>
            ) : null}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{q ? t("noMatch", { q }) : t("empty")}</p>
        ) : (
          <div ref={fadeRef} style={fadeStyle} className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="bg-bay/70">
                  {columns.map((c) => {
                    const on = sort?.key === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                        className={cn("px-4 py-2.5 text-xs font-bold whitespace-nowrap text-muted first:pl-5 last:pr-5", numeric.has(c.key) ? "text-right" : "text-left")}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={cn("inline-flex items-center gap-1 rounded-md hover:text-title", on && "text-title", numeric.has(c.key) && "flex-row-reverse")}
                        >
                          {label(c.label)}
                          <span className={cn("transition-opacity", on ? "opacity-100" : "opacity-0")}>
                            {on && sort.dir === 1 ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((r, i) => (
                  <motion.tr
                    key={`${r.trip_id ?? ""}-${r.car_code ?? ""}-${r.employee_id ?? ""}-${r.department ?? ""}-${r.type ?? ""}-${i}`}
                    initial={i < 24 ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(i, 24) * 0.015 }}
                    className="transition-colors hover:bg-bay/60"
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-4 py-2.5 whitespace-nowrap text-text first:pl-5 last:pr-5",
                          numeric.has(c.key) && "text-right tabular-nums",
                          (c.key === "details" || c.key === "note" || c.key === "purpose") && "max-w-[22rem] truncate",
                        )}
                        title={c.key === "details" || c.key === "note" || c.key === "purpose" ? String(r[c.key] ?? "") : undefined}
                      >
                        <Cell column={c.key} row={r} name={name} />
                      </td>
                    ))}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AnimatePresence>
          {rows.length > shown ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-t border-border p-3 text-center">
              <button
                type="button"
                onClick={() => setShown((n) => n + STEP)}
                className="inline-flex h-9 items-center gap-1.5 rounded-[0.7rem] px-4 text-sm font-bold text-accent hover:bg-soft"
              >
                <CaretDownIcon size={14} weight="bold" />
                {t("showMore", { count: Math.min(STEP, rows.length - shown), left: rows.length - shown })}
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

/** One cell: links for trips, cars and drivers; chips for statuses and results; numbers with separators. */
function Cell({ column, row, name }: { column: string; row: Record<string, ReportCell>; name: ReportName }) {
  const t = useTranslations("reports");
  const label = useLabel();
  const v = row[column];

  if (column === "details_link") {
    return row.trip_id ? (
      <Link href={`/admin/trips/${row.trip_id}`} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
        {t("table.open")}
        <ArrowSquareOutIcon size={14} weight="bold" />
      </Link>
    ) : null;
  }
  if (v === null || v === "") return <span className="text-muted">—</span>;

  if (column === "trip_no" && row.trip_id) {
    return (
      <Link href={`/admin/trips/${row.trip_id}`} className="font-mono text-xs font-semibold text-accent hover:underline">
        {String(v)}
      </Link>
    );
  }
  if (column === "car_code") {
    return row.car_id ? (
      <Link href={`/admin/cars/${row.car_id}`} className="font-mono text-xs font-semibold text-title hover:text-accent hover:underline">
        {String(v)}
      </Link>
    ) : (
      <span className="font-mono text-xs font-semibold text-title">{String(v)}</span>
    );
  }
  if (column === "name" && name === "drivers" && row.driver_ref) {
    return (
      <Link href={`/admin/drivers/${row.driver_ref}`} className="font-semibold text-title hover:text-accent hover:underline">
        {String(v)}
      </Link>
    );
  }
  if (column === "status") {
    const s = String(v);
    if (TRIP_STATUSES.has(s)) return <TripStatusChip status={s as TripStatus} />;
    if (s === "open") return <StatusChip status="alert" size="sm">{label("open")}</StatusChip>;
    if (s === "solved") return <StatusChip status="available" size="sm">{label("solved")}</StatusChip>;
    if (s === "pending") return <StatusChip status="waiting" size="sm">{label("pending")}</StatusChip>;
    return <>{label(s)}</>;
  }
  if (column === "result" && row.result_code) {
    const code = String(row.result_code);
    const gap = Math.abs(Number(row.gap_km) || 0);
    return (
      <StatusChip status={RESULT_TONE[code] ?? "inactive"} size="sm">
        {t(`result.${code}`, { km: num(gap) })}
      </StatusChip>
    );
  }
  if (column === "gap_km" && typeof v === "number") {
    return <span className={cn("font-semibold", v > 0 ? "text-wait-fg" : v < 0 ? "text-bad-fg" : "text-muted")}>{v > 0 ? `+${num(v)}` : num(v)}</span>;
  }
  if (column === "km_share_percent" && typeof v === "number") return <>{num(v)}%</>;
  if (typeof v === "number") return <>{/(_id|_no)$/.test(column) ? String(v) : num(v)}</>;
  if (column === "type" || column === "department" || column === "passenger" || column === "needs_review" || column === "approval") {
    return <>{label(String(v))}</>;
  }
  return <>{String(v)}</>;
}

function EmptyReport() {
  const t = useTranslations("reports.empty");
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: EASE }}>
      <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <motion.span
          className="inline-flex size-16 items-center justify-center rounded-3xl bg-soft text-accent"
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          <TrayIcon size={32} weight="duotone" />
        </motion.span>
        <p className="font-display text-xl font-semibold text-title">{t("title")}</p>
        <p className="max-w-md text-sm text-muted">{t("body")}</p>
      </Card>
    </motion.div>
  );
}
