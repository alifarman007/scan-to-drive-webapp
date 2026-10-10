"use client";

import { AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { clearQr, driverApi, type ActiveTrip, type Trip } from "@/lib/driver-api";
import { useIsClient } from "@/lib/hooks";

import { QrView } from "./qr-view";
import { ClosedView, ConfirmedOverlay, EndForm, InProgressView, SummaryView } from "./trip-views";

/** How often to ask the server about the trip: often while a passenger may be confirming, rarely while driving. */
const POLL_MS: Record<string, number> = {
  waiting_for_passenger: 3000,
  waiting_for_end_confirm: 3000,
  in_progress: 20000,
};

/**
 * The driver's open trip, from the Start QR to the summary. The server is asked again every few seconds
 * (and when the phone comes back to the app), so the screen moves on by itself when the passenger confirms.
 */
export function TripScreen({ initial }: { initial: ActiveTrip & { trip: Trip } }) {
  const router = useRouter();
  const client = useIsClient();
  const [active, setActive] = useState<ActiveTrip>(initial);
  const [ending, setEnding] = useState(false);
  const [finished, setFinished] = useState<Trip | null>(null);
  const [confirmed, setConfirmed] = useState<{ name: string | null } | null>(null);
  const tripId = useRef(initial.trip.id);
  const lastStatus = useRef(initial.trip.status);

  const finish = useCallback((trip: Trip) => {
    clearQr(trip.id);
    setEnding(false);
    setFinished(trip);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await driverApi.active();
      if (next.trip && next.trip.id === tripId.current) {
        const was = lastStatus.current;
        lastStatus.current = next.trip.status;
        if (was === "waiting_for_passenger" && next.trip.status === "in_progress" && !next.trip.start_no_scan_reason) {
          navigator.vibrate?.([40, 60, 40]);
          setConfirmed({ name: next.trip.passenger_name });
        }
        setActive(next);
        return;
      }
      // No open trip any more: completed by the passenger, closed by the office, or cancelled. Show what happened.
      const { trip } = await driverApi.trip(tripId.current);
      if (trip.status === "completed" && lastStatus.current === "waiting_for_end_confirm") navigator.vibrate?.([40, 60, 40]);
      finish(trip);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/driver/login?next=/driver/trip");
      // other errors (a moment without Wi-Fi): try again on the next round
    }
  }, [finish, router]);

  const status = finished ? null : active.trip?.status ?? null;
  useEffect(() => {
    if (!status) return;
    const id = setInterval(() => void refresh(), POLL_MS[status] ?? 15000);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, refresh]);

  // close the "passenger confirmed" moment by itself after a short while
  useEffect(() => {
    if (!confirmed) return;
    const id = setTimeout(() => setConfirmed(null), 2400);
    return () => clearTimeout(id);
  }, [confirmed]);

  // A full page load, not a client-side route change: the trip is over, the home page must load fresh, and a
  // route change that stalls on a phone (seen on the LAN dev server) would leave "Done" doing nothing.
  const goHome = useCallback((notice?: string) => {
    window.location.replace(notice ? `/driver?notice=${notice}` : "/driver");
  }, []);

  if (!client) {
    // the QR is kept in this tab's storage, which only exists in the browser: render after hydration
    return <div className="min-h-dvh bg-navy" aria-busy="true" />;
  }

  let view: React.ReactNode;
  if (finished) {
    view =
      finished.status === "completed" ? (
        <SummaryView trip={finished} onDone={() => goHome()} />
      ) : (
        <ClosedView trip={finished} onDone={() => goHome()} />
      );
  } else if (!active.trip) {
    view = null;
  } else {
    const withTrip = active as ActiveTrip & { trip: Trip };
    switch (active.trip.status) {
      case "waiting_for_passenger":
        view = (
          <QrView
            key={`start-${active.trip.id}`}
            stage="start"
            active={withTrip}
            onRefresh={refresh}
            onFinished={finish}
            onCancelled={() => {
              clearQr(tripId.current);
              goHome("cancelled");
            }}
          />
        );
        break;
      case "in_progress":
        view = ending ? (
          <EndForm
            trip={active.trip}
            onBack={() => setEnding(false)}
            onEnded={({ trip, hasQr }) => {
              if (!hasQr) {
                finish(trip);
              } else {
                lastStatus.current = trip.status;
                setEnding(false);
                setActive((a) => ({ ...a, trip, reminders: [] }));
              }
            }}
          />
        ) : (
          <InProgressView
            active={withTrip}
            onEnd={() => {
              setEnding(true);
              window.scrollTo({ top: 0 });
            }}
          />
        );
        break;
      case "waiting_for_end_confirm":
        view = <QrView key={`end-${active.trip.id}`} stage="end" active={withTrip} onRefresh={refresh} onFinished={finish} onCancelled={() => goHome()} />;
        break;
      default:
        view = null;
    }
  }

  return (
    <>
      {view}
      <AnimatePresence>{confirmed ? <ConfirmedOverlay name={confirmed.name} onDone={() => setConfirmed(null)} /> : null}</AnimatePresence>
    </>
  );
}
