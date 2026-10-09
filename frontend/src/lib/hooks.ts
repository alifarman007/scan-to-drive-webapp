"use client";

import { useSyncExternalStore } from "react";

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
