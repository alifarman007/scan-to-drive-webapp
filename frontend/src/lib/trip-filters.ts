/**
 * Trip history filters live in the address (/admin/trips?status=completed&car=3&page=2), so the back button,
 * reloads and links from the dashboard all work. Used by the server page (to ask the API) and the filter bar.
 */

export const PAGE_SIZE = 25;

export const STATUSES = [
  "waiting_for_passenger",
  "in_progress",
  "waiting_for_end_confirm",
  "completed",
  "cancelled",
  "closed_by_admin",
] as const;

export type Range = "" | "today" | "week" | "month" | "custom";

export type Filters = {
  q: string;
  range: Range;
  from: string; // yyyy-mm-dd, only with range "custom"
  to: string;
  status: string;
  car: string;
  driver: string;
  dept: string;
  approval: string; // "pending" | "approved" | "rejected" | ""
  review: boolean;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v: string) => /^\d{1,9}$/.test(v);

export function readFilters(sp: Params): Filters {
  const range = one(sp.range);
  const from = one(sp.from);
  const to = one(sp.to);
  const status = one(sp.status);
  const approval = one(sp.approval);
  const page = Number(one(sp.page));
  return {
    q: one(sp.q).slice(0, 100),
    range: (["today", "week", "month", "custom"] as const).find((r) => r === range) ?? "",
    from: isDate(from) ? from : "",
    to: isDate(to) ? to : "",
    status: (STATUSES as readonly string[]).includes(status) ? status : "",
    car: isId(one(sp.car)) ? one(sp.car) : "",
    driver: isId(one(sp.driver)) ? one(sp.driver) : "",
    dept: one(sp.dept).slice(0, 120),
    approval: ["pending", "approved", "rejected"].includes(approval) ? approval : "",
    review: one(sp.review) === "1",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The query for GET /api/admin/trips. */
export function apiQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.range === "custom") {
    if (f.from) p.set("date_from", f.from);
    if (f.to) p.set("date_to", f.to);
  } else if (f.range) {
    p.set("range", f.range);
  }
  if (f.status) p.set("status", f.status);
  if (f.car) p.set("car_id", f.car);
  if (f.driver) p.set("driver_id", f.driver);
  if (f.dept) p.set("department", f.dept);
  if (f.approval) p.set("approval", f.approval);
  if (f.review) p.set("needs_review", "true");
  p.set("limit", String(PAGE_SIZE));
  p.set("offset", String((f.page - 1) * PAGE_SIZE));
  return p.toString();
}

/** The page address for these filters (only what is set, so links stay short). */
export function pageHref(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.range) p.set("range", f.range);
  if (f.range === "custom" && f.from) p.set("from", f.from);
  if (f.range === "custom" && f.to) p.set("to", f.to);
  if (f.status) p.set("status", f.status);
  if (f.car) p.set("car", f.car);
  if (f.driver) p.set("driver", f.driver);
  if (f.dept) p.set("dept", f.dept);
  if (f.approval) p.set("approval", f.approval);
  if (f.review) p.set("review", "1");
  if (f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `/admin/trips?${s}` : "/admin/trips";
}

export function hasFilters(f: Filters) {
  return Boolean(f.q || f.range || f.status || f.car || f.driver || f.dept || f.approval || f.review);
}

export const NO_FILTERS: Filters = {
  q: "", range: "", from: "", to: "", status: "", car: "", driver: "", dept: "", approval: "", review: false, page: 1,
};
