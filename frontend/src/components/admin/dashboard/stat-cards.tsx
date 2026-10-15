"use client";

import {
  ArrowUpRightIcon,
  BellRingingIcon,
  CarIcon,
  CarProfileIcon,
  HourglassMediumIcon,
  PathIcon,
  RoadHorizonIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { LiveDot } from "@/components/ui/live-dot";
import type { Dashboard } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { CountUp } from "./bits";

type Tone = "trip" | "ok" | "wait" | "bad" | "plain";

const TONE: Record<Tone, string> = {
  trip: "bg-trip-bg text-trip-fg",
  ok: "bg-ok-bg text-ok-fg",
  wait: "bg-wait-bg text-wait-fg",
  bad: "bg-bad-bg text-bad-fg",
  plain: "bg-soft text-title",
};

const EASE = [0.22, 1, 0.36, 1] as const;
const row: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.07, delayChildren: 0.18 } } };
const card: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.97 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.7, ease: EASE } },
};

/** The cars page view that holds most of these cars (the other view links to the rest). */
function ownerFor(board: Dashboard["car_board"], match: (c: Dashboard["car_board"][number]) => boolean) {
  const cars = board.filter(match);
  const vendor = cars.filter((c) => c.owner === "vendor").length;
  return vendor > cars.length - vendor ? "&owner=vendor" : "";
}

/** Six numbers at the top: what is happening right now, and today so far. Each one opens the page behind it. */
export function StatCards({ cards, board }: { cards: Dashboard["cards"]; board: Dashboard["car_board"] }) {
  const t = useTranslations("dashboard.cards");
  const reduce = useReducedMotion();
  const onlyEndWaiting = board.some((c) => c.trip?.status === "waiting_for_end_confirm") && !board.some((c) => c.trip?.status === "waiting_for_passenger");

  const items: { key: string; value: number; icon: typeof CarIcon; tone: Tone; live?: boolean; unit?: string; href: string }[] = [
    {
      key: "onTrip", value: cards.cars_on_trip, icon: CarProfileIcon, tone: "trip", live: cards.cars_on_trip > 0,
      href: `/admin/cars?state=on_trip${ownerFor(board, (c) => c.state === "on_trip" || c.state === "waiting")}`,
    },
    {
      key: "available", value: cards.cars_available, icon: CarIcon, tone: "ok",
      href: `/admin/cars?state=available${ownerFor(board, (c) => c.state === "available")}`,
    },
    {
      key: "waiting", value: cards.trips_waiting_confirm, icon: HourglassMediumIcon, tone: cards.trips_waiting_confirm ? "wait" : "plain",
      href: `/admin/trips?status=${onlyEndWaiting ? "waiting_for_end_confirm" : "waiting_for_passenger"}`,
    },
    { key: "tripsToday", value: cards.trips_today, icon: PathIcon, tone: "plain", href: "/admin/trips?range=today" },
    { key: "kmToday", value: cards.km_today, icon: RoadHorizonIcon, tone: "plain", unit: "km", href: "/admin/trips?range=today&status=completed" },
    { key: "alerts", value: cards.open_alerts, icon: BellRingingIcon, tone: cards.open_alerts ? "bad" : "plain", href: "/admin/alerts" },
  ];

  return (
    <motion.div variants={row} initial="hidden" animate="shown" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map(({ key, value, icon: Icon, tone, live, unit, href }, i) => (
        <motion.div key={key} variants={card} className="min-w-0">
          <Link
            href={href}
            aria-label={`${value.toLocaleString("en-US")}${unit ? ` ${unit}` : ""} · ${t(key)}`}
            className={cn(
              "group relative flex h-full flex-col gap-3 overflow-hidden rounded-card border border-border bg-card p-4 outline-none",
              "transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-border-strong hover:shadow-lift",
              "focus-visible:shadow-[0_0_0_4px_var(--ring-soft)] active:translate-y-0 active:scale-[0.985]",
            )}
          >
            {/* one soft light passing over the card as it settles */}
            {reduce ? null : (
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent dark:via-white/[0.07]"
                initial={{ x: "0%", opacity: 0 }}
                animate={{ x: "420%", opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1.3, delay: 0.75 + i * 0.09, ease: "easeInOut" }}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <span className={cn("inline-flex size-9 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110", TONE[tone])}>
                <Icon size={19} weight="duotone" />
              </span>
              {live ? <LiveDot className="bg-trip-dot" /> : null}
            </div>
            <div className="flex items-baseline gap-1.5">
              <CountUp value={value} className="font-display text-3xl font-bold text-title tabular-nums" />
              {unit ? <span className="text-sm font-semibold text-muted">{unit}</span> : null}
            </div>
            <span className="flex items-end justify-between gap-2">
              <span className="text-sm leading-snug font-semibold text-muted transition-colors group-hover:text-title">{t(key)}</span>
              <ArrowUpRightIcon
                size={16}
                weight="bold"
                className="mb-0.5 shrink-0 text-accent opacity-35 transition-[opacity,transform] duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
              />
            </span>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
