"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

import type { TripStatus } from "@/lib/driver-api";
import { cn } from "@/lib/utils";

/** Start → Passenger → Drive → End, with the current step lit. Without a passenger the second step is left out. */
export function TripProgress({ status, withPassenger, tone = "onDark" }: { status: TripStatus; withPassenger: boolean; tone?: "onDark" | "onLight" }) {
  const t = useTranslations("tripProgress");
  const steps = withPassenger ? ["start", "passenger", "drive", "end"] : ["start", "drive", "end"];
  const at: Record<string, number> = withPassenger
    ? { waiting_for_passenger: 1, in_progress: 2, waiting_for_end_confirm: 3, completed: 4 }
    : { in_progress: 1, completed: 3 };
  const current = at[status] ?? 0;
  return (
    <ol className="flex items-center gap-1.5" aria-label={t("label")}>
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s} className="flex flex-1 flex-col gap-1.5" aria-current={now ? "step" : undefined}>
            <span className={cn("relative h-1.5 overflow-hidden rounded-full", tone === "onDark" ? "bg-white/15" : "bg-soft")}>
              <motion.span
                className={cn("absolute inset-y-0 left-0 rounded-full", tone === "onDark" ? "bg-sky" : "bg-accent")}
                initial={false}
                animate={{ width: done ? "100%" : now ? "45%" : "0%" }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
              {now ? (
                <span className={cn("absolute inset-y-0 left-0 w-[45%] rounded-full motion-safe:animate-pulse", tone === "onDark" ? "bg-white/40" : "bg-accent/40")} />
              ) : null}
            </span>
            <span
              className={cn(
                "text-[0.7rem] font-bold tracking-wide uppercase",
                done || now ? (tone === "onDark" ? "text-white" : "text-title") : tone === "onDark" ? "text-white/45" : "text-muted",
              )}
            >
              {t(s)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
