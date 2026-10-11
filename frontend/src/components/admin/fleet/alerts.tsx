"use client";

import { CheckCircleIcon, ChatCircleTextIcon, GaugeIcon, SealCheckIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { ALERT_ICON, SolveButton } from "@/components/admin/dashboard/alerts-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { Select } from "@/components/ui/select";
import { useNowSeconds } from "@/lib/hooks";
import type { Alert, AlertPage, AlertType } from "@/lib/admin-api";
import { ALERT_TYPES, ALERTS_PER_PAGE, type AlertFilters } from "@/lib/alert-filters";
import { cn } from "@/lib/utils";

import { PageHeader, SearchBox, Segmented, useFlash } from "./shared";


const SERIOUS = new Set<AlertType>(["wrong_ids", "high_km", "km_gap", "admin_closed"]);

function href(f: AlertFilters) {
  const p = new URLSearchParams();
  if (f.status !== "open") p.set("status", f.status);
  if (f.type) p.set("type", f.type);
  if (f.car) p.set("car", f.car);
  if (f.q) p.set("q", f.q);
  if (f.n > 1) p.set("n", String(f.n));
  const s = p.toString();
  return `/admin/alerts${s ? `?${s}` : ""}`;
}

/**
 * Every alert from the background checks: open first by default, or solved, or all. Filter by kind and car,
 * search, grouped by day. Admins solve with a note; solved ones show who solved them, when, and the note.
 */
export function AlertsView({ data, filters, cars }: { data: AlertPage; filters: AlertFilters; cars: { id: number; car_code: string }[] }) {
  const t = useTranslations("alertsPage");
  const ta = useTranslations("dashboard.alerts");
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(filters.q);
  const [gone, setGone] = useState<number[]>([]);
  const [flash, showFlash] = useFlash();

  const go = (next: Partial<AlertFilters>) => {
    const f = { ...filters, n: 1, ...next };
    start(() => router.replace(href(f), { scroll: false }));
  };

  // search after a short pause
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typeSearch = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() }), 350);
  };

  const shown = data.alerts.filter((a) => !gone.includes(a.id));
  const groups = useMemo(() => {
    const out: { day: string; label: string; alerts: Alert[] }[] = [];
    const today = new Date();
    const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
    const todayKey = key(today);
    const yesterdayKey = key(new Date(today.getTime() - 86_400_000));
    for (const a of shown) {
      const k = key(new Date(a.created_at));
      let g = out.find((x) => x.day === k);
      if (!g) {
        const label =
          k === todayKey ? t("today") : k === yesterdayKey ? t("yesterday") : format.dateTime(new Date(a.created_at), { weekday: "long", day: "numeric", month: "long" });
        g = { day: k, label, alerts: [] };
        out.push(g);
      }
      g.alerts.push(a);
    }
    return out;
  }, [shown, t, format]);

  const more = data.total > filters.n * ALERTS_PER_PAGE;

  return (
    <div className="flex flex-col gap-section">
      <Reveal>
        <PageHeader title={t("title")} summary={t("summary", { open: data.counts.open, solved: data.counts.solved })} />
      </Reveal>

      <Reveal delay={0.05} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Segmented
            id="alerts-status"
            label={t("statusLabel")}
            value={filters.status}
            onChange={(status) => go({ status })}
            options={[
              { value: "open", label: t("status.open"), count: data.counts.open, dot: "bg-bad-dot" },
              { value: "solved", label: t("status.solved"), count: data.counts.solved, dot: "bg-ok-dot" },
              { value: "all", label: t("status.all"), count: data.counts.open + data.counts.solved },
            ]}
          />
          <SearchBox value={q} onChange={typeSearch} label={t("searchLabel")} placeholder={t("searchHint")} className="lg:w-72" />
          <Select aria-label={t("carLabel")} value={filters.car} active={Boolean(filters.car)} onChange={(e) => go({ car: e.target.value })} className="lg:w-44">
            <option value="">{t("allCars")}</option>
            {cars.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.car_code}
              </option>
            ))}
          </Select>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label={t("typeLabel")}>
          {ALERT_TYPES.map((type) => {
            const Icon = ALERT_ICON[type] ?? GaugeIcon;
            const on = filters.type === type;
            const n = data.by_type[type] ?? 0;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={on}
                onClick={() => go({ type: on ? "" : type })}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm font-semibold transition-colors",
                  on ? "border-accent bg-accent text-white" : "border-border-strong bg-card text-title hover:bg-soft",
                )}
              >
                <Icon size={16} weight={on ? "fill" : "duotone"} className={on ? "" : SERIOUS.has(type) ? "text-bad-fg" : "text-wait-fg"} />
                {ta(`type.${type}`)}
                {n ? <span className={cn("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-white/20" : "bg-bad-bg text-bad-fg")}>{n}</span> : null}
              </button>
            );
          })}
        </div>
      </Reveal>

      <div className={cn("flex flex-col gap-section transition-opacity", pending && "opacity-60")}>
        {shown.length === 0 ? (
          <AllClear solvedView={filters.status !== "open"} filtered={Boolean(filters.type || filters.car || filters.q)} />
        ) : (
          groups.map((g, gi) => (
            <Reveal key={g.day} delay={0.08 + gi * 0.04} className="flex flex-col gap-2.5">
              <h2 className="text-xs font-bold tracking-wide text-muted uppercase">{g.label}</h2>
              <ul className="flex flex-col gap-2.5">
                <AnimatePresence initial={false}>
                  {g.alerts.map((a) => (
                    <motion.li
                      key={a.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 60, transition: { duration: 0.28 } }}
                    >
                      <AlertCard
                        alert={a}
                        onSolved={() => {
                          if (filters.status === "open") setGone((x) => [...x, a.id]);
                          showFlash(t("solvedFlash"));
                          router.refresh();
                        }}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </Reveal>
          ))
        )}
        {more ? (
          <div className="flex justify-center">
            <Button variant="secondary" size="md" onClick={() => go({ n: filters.n + 1 })} disabled={pending}>
              {t("showMore", { left: data.total - filters.n * ALERTS_PER_PAGE })}
            </Button>
          </div>
        ) : null}
      </div>
      {flash}
    </div>
  );
}

function AlertCard({ alert, onSolved }: { alert: Alert; onSolved: () => void }) {
  const t = useTranslations("alertsPage");
  const ta = useTranslations("dashboard.alerts");
  const format = useFormatter();
  const user = useAdminUser();
  const nowSec = useNowSeconds();
  const now = nowSec === null ? new Date(alert.created_at) : new Date(nowSec * 1000);
  const Icon = ALERT_ICON[alert.type] ?? GaugeIcon;
  const solved = alert.status === "solved";
  const serious = SERIOUS.has(alert.type);

  return (
    <Card className={cn("relative flex gap-3.5 overflow-hidden p-4 transition-colors sm:p-5", solved && "bg-bay/50")}>
      {!solved ? <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", serious ? "bg-bad-dot" : "bg-wait-dot")} /> : null}
      <span
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-2xl",
          solved ? "bg-ok-bg text-ok-fg" : serious ? "bg-bad-bg text-bad-fg" : "bg-wait-bg text-wait-fg",
        )}
      >
        <Icon size={22} weight="duotone" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="font-display text-base font-semibold text-title">{ta(`type.${alert.type}`)}</span>
          <time
            dateTime={alert.created_at}
            className="text-xs text-muted"
            title={format.dateTime(new Date(alert.created_at), { dateStyle: "medium", timeStyle: "short" })}
          >
            {format.relativeTime(new Date(alert.created_at), now)}
          </time>
        </div>
        <p className="text-sm leading-snug text-text">{alert.message}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {alert.car_code && alert.vehicle_id ? (
              <Link href={`/admin/cars/${alert.vehicle_id}`} className="rounded-full bg-soft px-2.5 py-1 font-mono font-semibold text-title hover:bg-border">
                {alert.car_code}
              </Link>
            ) : null}
            {alert.trip_no && alert.trip_id ? (
              <Link href={`/admin/trips/${alert.trip_id}`} className="rounded-full bg-soft px-2.5 py-1 font-mono font-semibold text-accent hover:bg-border">
                {alert.trip_no}
              </Link>
            ) : null}
            {alert.driver_name ? <span className="px-1 font-semibold text-muted">{alert.driver_name}</span> : null}
          </div>
          {!solved && user.role === "admin" ? <SolveButton alert={alert} onSolved={onSolved} /> : null}
        </div>
        {solved ? (
          <div className="mt-1 flex flex-col gap-1 rounded-xl border border-ok-dot/25 bg-ok-bg/50 px-3 py-2 text-xs text-ok-fg">
            <span className="flex items-center gap-1.5 font-bold">
              <SealCheckIcon size={14} weight="fill" />
              {t("solvedBy", {
                name: alert.resolved_by_name ?? "–",
                time: alert.resolved_at ? format.dateTime(new Date(alert.resolved_at), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "",
              })}
            </span>
            {alert.note ? (
              <span className="flex items-start gap-1.5 text-text">
                <ChatCircleTextIcon size={14} weight="duotone" className="mt-px shrink-0 text-ok-fg" />
                {alert.note}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function AllClear({ solvedView, filtered }: { solvedView: boolean; filtered: boolean }) {
  const t = useTranslations("alertsPage");
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="relative mb-2 flex size-20 items-center justify-center">
        {!solvedView && !filtered ? (
          <motion.span
            className="absolute inset-0 rounded-full bg-ok-dot/20"
            initial={{ scale: 0.6, opacity: 0.9 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.2, ease: "easeOut" }}
          />
        ) : null}
        <motion.span
          initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 16 }}
          className="relative inline-flex size-20 items-center justify-center rounded-full bg-ok-bg text-ok-dot"
        >
          <CheckCircleIcon size={44} weight="fill" />
        </motion.span>
      </div>
      <p className="font-display text-xl font-semibold text-title">{filtered ? t("noneFilteredTitle") : solvedView ? t("noneSolvedTitle") : t("clearTitle")}</p>
      <p className="max-w-sm text-sm text-muted">{filtered ? t("noneFilteredBody") : solvedView ? t("noneSolvedBody") : t("clearBody")}</p>
    </Card>
  );
}
