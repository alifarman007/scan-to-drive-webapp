"use client";

import { ArrowClockwiseIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { LiveDot } from "@/components/ui/live-dot";
import { adminApi, isSignedOut, toSignIn, type Dashboard as Data } from "@/lib/admin-api";
import { useIntroPlaying } from "@/lib/hooks";
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

/**
 * The transport office home. Right after signing in the opening screen plays first; the page waits under it and
 * makes its entrance as the curtain lifts (greeting, then the numbers one by one, then the panels).
 */
export function Dashboard({ initial }: { initial: Data }) {
  const playing = useIntroPlaying();
  if (playing) return <div aria-hidden="true" className="min-h-[70dvh]" />;
  return <DashboardBody initial={initial} />;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** "Good evening, admin": the words drift in one after another, coming into focus. */
function Greeting({ text, date }: { text: string; date: string }) {
  const words = text.split(" ");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <motion.p
        className="text-sm font-semibold text-muted"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        {date}
      </motion.p>
      <h1 className="font-display text-3xl font-bold text-title" aria-label={text}>
        {words.map((w, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="inline-block whitespace-pre"
            initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.7, delay: 0.08 + i * 0.09, ease: EASE }}
          >
            {i < words.length - 1 ? `${w} ` : w}
          </motion.span>
        ))}
      </h1>
    </div>
  );
}

/** Live numbers, the latest cars, open trips, alerts and this month's charts. */
function DashboardBody({ initial }: { initial: Data }) {
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
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Greeting
          text={t(`greeting.${partOfDay(data.as_of)}`, { name: user.username })}
          date={format.dateTime(asOf, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        />
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
        >
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
        </motion.div>
      </div>

      <StatCards cards={data.cards} board={data.car_board} />

      <div className="grid gap-section xl:grid-cols-[minmax(0,1fr)_23rem]">
        <Rise delay={0.42} className="min-w-0">
          <CarBoard cars={data.car_board} asOf={data.as_of} />
        </Rise>
        <Rise delay={0.52} className="flex min-w-0 flex-col gap-section">
          <AlertsPanel alerts={data.alerts} total={data.cards.open_alerts} asOf={data.as_of} onChanged={() => void load()} />
          <RatingsPanel ratings={data.ratings} asOf={data.as_of} />
        </Rise>
      </div>

      <Rise delay={0.62}>
        <LiveTrips trips={data.live_trips} asOf={data.as_of} />
      </Rise>

      <div className="grid gap-section lg:grid-cols-2">
        <Rise delay={0.7} className="min-w-0">
          <TripsPerDay rows={data.charts.trips_per_day_this_month} today={data.today} />
        </Rise>
        <Rise delay={0.76} className="min-w-0">
          <KmPerCar rows={data.charts.km_per_car_this_month} />
        </Rise>
      </div>
    </div>
  );
}

/** A panel floating up into place, slow and soft. */
function Rise({ delay, className, children }: { delay: number; className?: string; children: React.ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.85, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
