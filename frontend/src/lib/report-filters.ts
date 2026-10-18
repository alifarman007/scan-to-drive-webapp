/**
 * Reports page state lives in the address (/admin/reports?r=car_usage&range=week&car=3), so a report can be
 * bookmarked, shared with another admin, reloaded, and opened from the dashboard. Used by the server page
 * (to ask the API) and by the filter bar.
 */

export const REPORT_NAMES = [
  "monthly_summary",
  "car_usage",
  "drivers",
  "passenger_department",
  "exceptions",
  "km_continuity",
  "trip_log",
] as const;

export type ReportName = (typeof REPORT_NAMES)[number];

export const RANGES = ["today", "week", "month", "last_month", "custom"] as const;
export type ReportRange = (typeof RANGES)[number];

export type ReportFilters = {
  r: ReportName;
  range: ReportRange;
  from: string; // yyyy-mm-dd, only with range "custom"
  to: string;
  car: string;
  driver: string;
  dept: string;
};

export const DEFAULT_REPORT: ReportFilters = { r: "monthly_summary", range: "month", from: "", to: "", car: "", driver: "", dept: "" };

/** Reports where the filter makes no difference (km continuity follows a car's odometer, whoever the passenger was). */
export const NO_DEPT: ReportName[] = ["km_continuity"];

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v: string) => /^\d{1,9}$/.test(v);

export function readReportFilters(sp: Params): ReportFilters {
  const r = one(sp.r);
  const range = one(sp.range);
  const from = one(sp.from);
  const to = one(sp.to);
  return {
    r: (REPORT_NAMES as readonly string[]).includes(r) ? (r as ReportName) : DEFAULT_REPORT.r,
    range: (RANGES as readonly string[]).includes(range) ? (range as ReportRange) : "month",
    from: isDate(from) ? from : "",
    to: isDate(to) ? to : "",
    car: isId(one(sp.car)) ? one(sp.car) : "",
    driver: isId(one(sp.driver)) ? one(sp.driver) : "",
    dept: one(sp.dept).slice(0, 120),
  };
}

/** Today's date in Bangladesh (yyyy-mm-dd), whatever the computer's own time zone. */
export function todayInDhaka(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** First and last day of the month before the one `today` is in. */
export function lastMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** The query for GET /api/admin/reports/{name} (without `format`). */
export function reportQuery(f: ReportFilters, today = todayInDhaka()) {
  const q = new URLSearchParams();
  if (f.range === "custom") {
    if (f.from) q.set("date_from", f.from);
    if (f.to) q.set("date_to", f.to);
    if (!f.from && !f.to) q.set("range", "month");
  } else if (f.range === "last_month") {
    const { from, to } = lastMonth(today);
    q.set("date_from", from);
    q.set("date_to", to);
  } else {
    q.set("range", f.range);
  }
  if (f.car) q.set("car_id", f.car);
  if (f.driver) q.set("driver_id", f.driver);
  if (f.dept && !NO_DEPT.includes(f.r)) q.set("department", f.dept);
  return q.toString();
}

/** The page address for these filters (defaults left out, so links stay short). */
export function reportHref(f: ReportFilters) {
  const q = new URLSearchParams();
  if (f.r !== DEFAULT_REPORT.r) q.set("r", f.r);
  if (f.range !== "month") q.set("range", f.range);
  if (f.range === "custom") {
    if (f.from) q.set("from", f.from);
    if (f.to) q.set("to", f.to);
  }
  if (f.car) q.set("car", f.car);
  if (f.driver) q.set("driver", f.driver);
  if (f.dept) q.set("dept", f.dept);
  const s = q.toString();
  return s ? `/admin/reports?${s}` : "/admin/reports";
}

export function hasNarrowing(f: ReportFilters) {
  return Boolean(f.car || f.driver || f.dept);
}

/** The same key the backend makes for a label ("Total km" -> "total_km"), for the Bangla wording. */
export function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
