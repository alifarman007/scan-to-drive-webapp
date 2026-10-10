"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const noop = () => () => {};

/** false while rendering on the server and during hydration, true afterwards (no setState in effects). */
export function useIsClient() {
  return useSyncExternalStore(noop, () => true, () => false);
}

function subscribeSecond(cb: () => void) {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}

/** Current time in whole seconds, updated every second; null on the server. */
export function useNowSeconds(): number | null {
  return useSyncExternalStore(subscribeSecond, () => Math.floor(Date.now() / 1000), () => null);
}

export type GeoState =
  | { status: "locating" }
  | { status: "ok"; lat: number; lng: number; accuracy: number }
  | { status: "denied" | "unavailable" | "insecure" };

/**
 * The phone's location for the start / end place (GPS needs https on phones). Starts looking right away;
 * `retry` looks again. State only changes inside the browser's callbacks.
 */
export function useGeolocation(): { geo: GeoState; retry: () => void } {
  const [geo, setGeo] = useState<GeoState>({ status: "locating" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!("geolocation" in navigator)) {
      queueMicrotask(() => alive && setGeo({ status: "unavailable" }));
      return () => {
        alive = false;
      };
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        alive &&
        setGeo({
          status: "ok",
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
          accuracy: Math.round(pos.coords.accuracy),
        }),
      (err) => {
        if (!alive) return;
        if (!window.isSecureContext) setGeo({ status: "insecure" });
        else setGeo({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  return {
    geo,
    retry: () => {
      setGeo({ status: "locating" });
      setAttempt((n) => n + 1);
    },
  };
}

/** Keep the screen on while a QR code is shown (phones dim and lock otherwise). Needs https; ignored if missing. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const request = () => {
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (released) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    request();
    // the lock is dropped when the tab is hidden; take it again when the driver comes back
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}
