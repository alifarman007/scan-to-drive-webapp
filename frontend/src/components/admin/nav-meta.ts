// Plain data about the admin pages (no icons), safe to import from server components.

export type NavKey =
  | "dashboard" | "trips" | "cars" | "drivers" | "passengers" | "reports" | "alerts" | "audit" | "overtime"
  | "users" | "settings";

/** Which build step each admin page arrives in (shown on the placeholder pages until then). */
export const PAGE_STEP: Partial<Record<NavKey, number>> = {
  cars: 7, drivers: 7, passengers: 7, alerts: 7, audit: 7, reports: 8, users: 8, settings: 8,
};
