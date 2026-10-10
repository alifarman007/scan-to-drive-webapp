"use client";

import { BellRingingIcon, CarIcon, CarProfileIcon, HourglassMediumIcon, PathIcon, RoadHorizonIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { LiveDot } from "@/components/ui/live-dot";
import { Stagger, StaggerItem } from "@/components/ui/reveal";
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

/** Six numbers at the top: what is happening right now, and today so far. */
export function StatCards({ cards }: { cards: Dashboard["cards"] }) {
  const t = useTranslations("dashboard.cards");
  const items: { key: string; value: number; icon: typeof CarIcon; tone: Tone; live?: boolean; unit?: string; href?: string }[] = [
    { key: "onTrip", value: cards.cars_on_trip, icon: CarProfileIcon, tone: "trip", live: cards.cars_on_trip > 0 },
    { key: "available", value: cards.cars_available, icon: CarIcon, tone: "ok" },
    { key: "waiting", value: cards.trips_waiting_confirm, icon: HourglassMediumIcon, tone: cards.trips_waiting_confirm ? "wait" : "plain" },
    { key: "tripsToday", value: cards.trips_today, icon: PathIcon, tone: "plain" },
    { key: "kmToday", value: cards.km_today, icon: RoadHorizonIcon, tone: "plain", unit: "km" },
    { key: "alerts", value: cards.open_alerts, icon: BellRingingIcon, tone: cards.open_alerts ? "bad" : "plain", href: "/admin/alerts" },
  ];

  return (
    <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map(({ key, value, icon: Icon, tone, live, unit, href }) => {
        const body = (
          <Card
            className={cn(
              "flex h-full flex-col gap-3 p-4 transition-[transform,box-shadow] duration-200",
              href && "hover:-translate-y-0.5 hover:shadow-lift",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={cn("inline-flex size-9 items-center justify-center rounded-xl", TONE[tone])}>
                <Icon size={19} weight="duotone" />
              </span>
              {live ? <LiveDot className="bg-trip-dot" /> : null}
            </div>
            <div className="flex items-baseline gap-1.5">
              <CountUp value={value} className="font-display text-3xl font-bold text-title tabular-nums" />
              {unit ? <span className="text-sm font-semibold text-muted">{unit}</span> : null}
            </div>
            <span className="text-sm leading-snug font-semibold text-muted">{t(key)}</span>
          </Card>
        );
        return (
          <StaggerItem key={key}>
            {href ? (
              <Link href={href} className="block h-full rounded-card">
                {body}
              </Link>
            ) : (
              body
            )}
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
