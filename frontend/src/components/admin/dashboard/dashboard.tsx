"use client";

import { ArrowClockwiseIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { LiveDot } from "@/components/ui/live-dot";
import { Reveal } from "@/components/ui/reveal";
import { adminApi, isSignedOut, toSignIn, type Dashboard as Data } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { AlertsPanel } from "./alerts-panel";
import { CarBoard } from "./car-board";
import { KmPerCar, TripsPerDay } from "./charts";
import { LiveTrips } from "./live-trips";
import { RatingsPanel } from "./ratings";
import { StatCards } from "./stat-cards";

/** Asks the server again this often while the page is on screen (and straight away when it comes back). */
const POLL_MS = 15_000;

function partOfDay(iso: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Dhaka" }).format(new Date(iso)));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/** The transport office home: live numbers, every car, open trips, alerts and this month's charts. */
export function Dashboard({ initial }: { initial: Data }) {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const user = useAdminUser();
  const [data, setData] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      setData(await adminApi.dashboard());
      setOffline(false);
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setOffline(true); // keep showing the last numbers, try again on the next round
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const asOf = new Date(data.as_of);

  return (
    <div className="flex flex-col gap-section">
      <Reveal className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold text-muted">
            {format.dateTime(asOf, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <h1 className="font-display text-3xl font-bold text-title">
            {t(`greeting.${partOfDay(data.as_of)}`, { name: user.username })}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <AnimatePresence mode="wait" initial={false}>
            {offline ? (
              <motion.span
                key="off"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="inline-flex items-center gap-2 rounded-full bg-wait-bg px-3 py-1.5 text-xs font-bold text-wait-fg"
              >
                <WifiSlashIcon size={14} weight="bold" />
                {t("offline", { time: format.dateTime(asOf, { hour: "numeric", minute: "2-digit" }) })}
              </motion.span>
            ) : (
              <motion.span
                key="live"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="inline-flex items-center gap-2 rounded-full bg-ok-bg px-3 py-1.5 text-xs font-bold text-ok-fg"
              >
                <LiveDot className="bg-ok-dot" />
                {t("live.updated", { time: format.dateTime(asOf, { hour: "numeric", minute: "2-digit", second: "2-digit" }) })}
              </motion.span>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={() => void load()}
            aria-label={t("refresh")}
            title={t("refresh")}
            className="inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-soft hover:text-title"
          >
            <ArrowClockwiseIcon size={18} weight="bold" className={cn(loading && "animate-spin")} />
          </button>
        </div>
      </Reveal>

      <StatCards cards={data.cards} />

      <div className="grid gap-section xl:grid-cols-[minmax(0,1fr)_23rem]">
        <Reveal delay={0.1} className="min-w-0">
          <CarBoard cars={data.car_board} asOf={data.as_of} />
        </Reveal>
        <Reveal delay={0.16} className="flex min-w-0 flex-col gap-section">
          <AlertsPanel alerts={data.alerts} total={data.cards.open_alerts} asOf={data.as_of} onChanged={() => void load()} />
          <RatingsPanel ratings={data.ratings} asOf={data.as_of} />
        </Reveal>
      </div>

      <Reveal delay={0.2}>
        <LiveTrips trips={data.live_trips} asOf={data.as_of} />
      </Reveal>

      <div className="grid gap-section lg:grid-cols-2">
        <Reveal delay={0.24} className="min-w-0">
          <TripsPerDay rows={data.charts.trips_per_day_this_month} today={data.today} />
        </Reveal>
        <Reveal delay={0.28} className="min-w-0">
          <KmPerCar rows={data.charts.km_per_car_this_month} />
        </Reveal>
      </div>
    </div>
  );
}
