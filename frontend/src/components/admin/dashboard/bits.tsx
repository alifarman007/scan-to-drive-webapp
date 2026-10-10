"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import type { BoardState, TripStatus } from "@/lib/admin-api";
import type { Status } from "@/components/ui/status-chip";

/** A number that counts up to its new value (km today, trips today ...). */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en-US"));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, mv, reduce]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** "1 h 12 min" / "8 min" from seconds. */
export function useDuration() {
  const t = useTranslations("time");
  return (seconds: number) => {
    const s = Math.max(0, seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? t("hoursMinutes", { h, m }) : t("minutes", { m });
  };
}

export function secondsSince(iso: string, nowSeconds: number) {
  return nowSeconds - Math.floor(new Date(iso).getTime() / 1000);
}

/** Board state and trip status mapped to the app's five status colours. */
export function chipStatus(state: BoardState): Status {
  return state;
}

export function tripChip(status: TripStatus): Status {
  if (status === "in_progress") return "on_trip";
  if (status === "waiting_for_passenger" || status === "waiting_for_end_confirm") return "waiting";
  if (status === "cancelled") return "inactive";
  return "available";
}

/** Card heading used by the dashboard panels. */
export function PanelTitle({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="font-display text-lg font-semibold text-title">{title}</h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
