"use client";

import {
  ArrowRightIcon,
  CalendarDotsIcon,
  CarProfileIcon,
  CheckIcon,
  CircleNotchIcon,
  FilePdfIcon,
  FileXlsIcon,
  FunnelSimpleXIcon,
  GaugeIcon,
  ListBulletsIcon,
  SteeringWheelIcon,
  UsersThreeIcon,
  WarningDiamondIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import type { ReportData } from "@/lib/admin-api";
import { useScrollFade } from "@/lib/hooks";
import {
  NO_DEPT,
  RANGES,
  REPORT_NAMES,
  hasNarrowing,
  reportHref,
  reportQuery,
  type ReportFilters,
  type ReportName,
} from "@/lib/report-filters";
import { cn } from "@/lib/utils";

import { ReportView } from "./report-view";

export type ReportOptions = {
  cars: { id: number; car_code: string; model: string; owner?: "epic" | "vendor" }[];
  drivers: { id: number; name: string; employee_id: string }[];
  departments: string[];
};

export const REPORT_ICON: Record<ReportName, Icon> = {
  monthly_summary: CalendarDotsIcon,
  car_usage: CarProfileIcon,
  drivers: SteeringWheelIcon,
  passenger_department: UsersThreeIcon,
  exceptions: WarningDiamondIcon,
  km_continuity: GaugeIcon,
  trip_log: ListBulletsIcon,
};

const EASE = [0.22, 1, 0.36, 1] as const;

/** Reports: pick a report, narrow it down, read it on screen, or take it away as Excel or PDF. */
export function Reports({ filters, data, options }: { filters: ReportFilters; data: ReportData; options: ReportOptions }) {
  const t = useTranslations("reports");
  const format = useFormatter();
  const router = useRouter();
  const [loading, startTransition] = useTransition();

  function go(next: Partial<ReportFilters>) {
    startTransition(() => router.replace(reportHref({ ...filters, ...next }), { scroll: false }));
  }

  const day = (iso: string, withYear: boolean) =>
    format.dateTime(new Date(`${iso}T12:00:00+06:00`), { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  const sameYear = data.period.from.slice(0, 4) === data.period.to.slice(0, 4);
  const period =
    data.period.from === data.period.to
      ? day(data.period.from, true)
      : t("period", { from: day(data.period.from, !sameYear), to: day(data.period.to, true) });

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-3xl font-bold text-title">{t("title")}</h1>
          <p className="text-sm text-muted" aria-live="polite">
            <span className="font-semibold text-title">{t(`names.${filters.r}.title`)}</span>
            <span className="px-1.5" aria-hidden="true">
              ·
            </span>
            {period}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Download name={filters.r} query={reportQuery(filters)} kind="xlsx" />
          <Download name={filters.r} query={reportQuery(filters)} kind="pdf" />
        </div>
      </div>

      <Picker active={filters.r} onPick={(r) => go({ r })} />

      <Card className="flex flex-col gap-3 p-3 sm:p-4">
        <RangePicker filters={filters} onChange={go} />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t("filter.car")}
            value={filters.car}
            active={Boolean(filters.car)}
            onChange={(e) => go({ car: e.target.value })}
            className="w-[calc(50%-0.25rem)] sm:w-44"
          >
            <option value="">{t("filter.allCars")}</option>
            {(["epic", "vendor"] as const).map((o) => {
              const group = options.cars.filter((c) => (c.owner ?? "epic") === o);
              return group.length ? (
                <optgroup key={o} label={t(`filter.carGroup.${o}`)}>
                  {group.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.car_code} · {c.model}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </Select>
          <Select
            aria-label={t("filter.driver")}
            value={filters.driver}
            active={Boolean(filters.driver)}
            onChange={(e) => go({ driver: e.target.value })}
            className="w-[calc(50%-0.25rem)] sm:w-48"
          >
            <option value="">{t("filter.allDrivers")}</option>
            {options.drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {options.departments.length && !NO_DEPT.includes(filters.r) ? (
            <Select
              aria-label={t("filter.department")}
              value={filters.dept}
              active={Boolean(filters.dept)}
              onChange={(e) => go({ dept: e.target.value })}
              className="w-full sm:w-48"
            >
              <option value="">{t("filter.allDepartments")}</option>
              {options.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          ) : null}
          <AnimatePresence>
            {hasNarrowing(filters) ? (
              <motion.button
                type="button"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                onClick={() => go({ car: "", driver: "", dept: "" })}
                className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-[0.7rem] px-3 text-sm font-bold text-accent hover:bg-soft"
              >
                <FunnelSimpleXIcon size={16} weight="bold" />
                {t("filter.clear")}
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </Card>

      <div className="relative">
        {/* a thin bar runs along the top while the next report loads */}
        <AnimatePresence>
          {loading ? (
            <motion.span
              key="bar"
              className="absolute inset-x-0 -top-3 z-10 h-0.5 origin-left rounded-full bg-signal"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 0.85, transition: { duration: 1.2, ease: "easeOut" } }}
              exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.25 } }}
            />
          ) : null}
        </AnimatePresence>
        <motion.div
          key={`${data.name}|${data.period.from}|${data.period.to}|${JSON.stringify(data.filters)}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className={cn("transition-opacity duration-200", loading && "opacity-55")}
        >
          <ReportView data={data} name={filters.r} onNarrow={go} />
        </motion.div>
      </div>
    </div>
  );
}

/** The seven reports as tiles; the chosen one is filled in navy, and the fill glides to the next one. */
function Picker({ active, onPick }: { active: ReportName; onPick: (r: ReportName) => void }) {
  const t = useTranslations("reports");
  const [fadeRef, fadeStyle] = useScrollFade<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  // on a phone the strip scrolls: keep the chosen report in sight (also when opened from a dashboard link)
  useEffect(() => {
    const el = activeRef.current;
    const strip = fadeRef.current;
    if (!el || !strip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [active, fadeRef]);

  return (
    <div
      ref={fadeRef}
      style={fadeStyle}
      role="radiogroup"
      aria-label={t("pick")}
      className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pt-1 pb-2 [scrollbar-width:none] xl:grid xl:grid-cols-7 xl:overflow-visible"
    >
      {REPORT_NAMES.map((r, i) => {
        const on = r === active;
        const ReportIcon = REPORT_ICON[r];
        return (
          <motion.button
            key={r}
            ref={on ? activeRef : undefined}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(r)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.04 * i, ease: EASE }}
            whileHover={on ? undefined : { y: -3 }}
            whileTap={{ scale: 0.97 }}
            className={cn(
              "group relative flex w-40 shrink-0 snap-start flex-col gap-2 rounded-[1.1rem] border p-3 text-left outline-none sm:w-44 xl:w-auto",
              "focus-visible:shadow-[0_0_0_4px_var(--ring-soft)]",
              on ? "border-transparent" : "border-border bg-card hover:border-border-strong hover:shadow-lift",
            )}
          >
            {on ? (
              <motion.span
                layoutId="report-tile"
                className="absolute inset-0 rounded-[1.1rem] bg-[linear-gradient(140deg,var(--color-accent),color-mix(in_oklab,var(--color-accent)_70%,#0f1a3d))] shadow-[0_14px_30px_-14px_rgb(21_93_252/0.7)]"
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
              />
            ) : null}
            <span
              className={cn(
                "relative inline-flex size-9 items-center justify-center rounded-xl transition-colors",
                on ? "bg-white/15 text-white" : "bg-soft text-accent group-hover:bg-accent group-hover:text-accent-text",
              )}
            >
              <ReportIcon size={20} weight="duotone" />
            </span>
            <span className={cn("relative text-sm leading-tight font-bold", on ? "text-white" : "text-title")}>
              {t(`names.${r}.title`)}
            </span>
            <span className={cn("relative line-clamp-2 text-xs leading-snug", on ? "text-white/75" : "text-muted")}>
              {t(`names.${r}.hint`)}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** Today / This week / This month / Last month / Pick dates; picking dates shows two date boxes. */
function RangePicker({ filters, onChange }: { filters: ReportFilters; onChange: (f: Partial<ReportFilters>) => void }) {
  const t = useTranslations("reports.range");
  const [fadeRef, fadeStyle] = useScrollFade<HTMLDivElement>();
  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
      <div
        ref={fadeRef}
        style={fadeStyle}
        role="radiogroup"
        aria-label={t("label")}
        className="flex max-w-full gap-0.5 overflow-x-auto rounded-[0.8rem] bg-soft p-1 [scrollbar-width:none]"
      >
        {RANGES.map((r) => {
          const active = filters.range === r;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(r === "custom" ? { range: r } : { range: r, from: "", to: "" })}
              className={cn(
                "relative h-8 shrink-0 rounded-[0.6rem] px-3 text-sm font-semibold whitespace-nowrap transition-colors",
                active ? "text-title" : "text-muted hover:text-title",
              )}
            >
              {active ? <motion.span layoutId="report-range-pill" className="absolute inset-0 rounded-[0.6rem] bg-card shadow-sm" /> : null}
              <span className="relative">{t(r)}</span>
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

type DownloadState = "idle" | "busy" | "done" | "failed" | "tooMany";

/** Excel or PDF of exactly what is on screen. The file is fetched first, so a problem can be said in words. */
function Download({ name, query, kind }: { name: ReportName; query: string; kind: "xlsx" | "pdf" }) {
  const t = useTranslations("reports.download");
  const [state, setState] = useState<DownloadState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function run() {
    if (state === "busy") return;
    setState("busy");
    clearTimeout(timer.current);
    let next: DownloadState = "done";
    try {
      const res = await fetch(`/api/admin/reports/${name}?${query}&format=${kind}`, {
        headers: { "X-S2D": "1" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: { code?: string } } | null;
        throw new ApiError(res.status, body?.detail?.code ?? `HTTP_${res.status}`, "download failed");
      }
      const blob = await res.blob();
      const fileName =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `scan-to-drive-${name}.${kind}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const here = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/admin/login?next=${encodeURIComponent(here)}&expired=1`);
        return;
      }
      next = err instanceof ApiError && err.code === "TOO_MANY_ROWS" ? "tooMany" : "failed";
    }
    setState(next);
    timer.current = setTimeout(() => setState("idle"), next === "done" ? 2200 : 5000);
  }

  const FileIcon = kind === "xlsx" ? FileXlsIcon : FilePdfIcon;
  const label = kind === "xlsx" ? t("xlsx") : t("pdf");
  const bad = state === "failed" || state === "tooMany";

  return (
    <div className="relative">
      <motion.button
        type="button"
        onClick={() => void run()}
        whileTap={{ scale: 0.96 }}
        aria-label={t("aria", { kind: label })}
        aria-busy={state === "busy"}
        className={cn(
          "inline-flex h-10 items-center gap-2 overflow-hidden rounded-[0.8rem] border-[1.5px] px-3.5 text-sm font-bold transition-colors",
          state === "done"
            ? "border-ok-dot bg-ok-bg text-ok-fg"
            : bad
              ? "border-bad-dot bg-bad-bg text-bad-fg"
              : kind === "xlsx"
                ? "border-accent bg-accent text-accent-text hover:brightness-110"
                : "border-border-strong bg-card text-title hover:bg-soft",
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state === "busy" ? "busy" : state === "done" ? "done" : bad ? "bad" : "idle"}
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -14, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="inline-flex"
          >
            {state === "busy" ? (
              <CircleNotchIcon size={18} weight="bold" className="animate-spin" />
            ) : state === "done" ? (
              <CheckIcon size={18} weight="bold" />
            ) : bad ? (
              <WarningIcon size={18} weight="bold" />
            ) : (
              <FileIcon size={18} weight="duotone" />
            )}
          </motion.span>
        </AnimatePresence>
        {label}
      </motion.button>
      <AnimatePresence>
        {bad ? (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-12 right-0 z-20 w-60 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-bad-fg shadow-lift"
          >
            {state === "tooMany" ? t("tooMany") : t("failed")}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
