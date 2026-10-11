/** Alerts page filters, in the address (/admin/alerts?status=solved&type=km_gap&car=3&n=2). Shared by the server page and the list. */
import type { AlertType } from "./admin-api";

export type AlertFilters = { status: "open" | "solved" | "all"; type: AlertType | ""; car: string; q: string; n: number };

export const ALERT_TYPES: AlertType[] = ["km_gap", "long_trip", "waiting_too_long", "wrong_ids", "high_km", "admin_closed"];
export const ALERTS_PER_PAGE = 30;
