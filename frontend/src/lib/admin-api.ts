/** Types and calls for the admin pages (backend: app/routers/admin_*.py). Cookie session, 8 hours. */
import { ApiError, api } from "./api";

export type AdminUser = { id: number; username: string; role: "admin" | "viewer" };

export type BoardState = "on_trip" | "waiting" | "available" | "maintenance" | "inactive";
export type TripStatus =
  | "waiting_for_passenger" | "in_progress" | "waiting_for_end_confirm" | "completed" | "cancelled" | "closed_by_admin";
export type AlertType = "km_gap" | "long_trip" | "waiting_too_long" | "wrong_ids" | "high_km" | "admin_closed";

export type BoardCar = {
  id: number;
  car_code: string;
  model: string;
  reg_number: string;
  current_km: number;
  state: BoardState;
  vehicle_status: "active" | "maintenance" | "inactive";
  trip: null | { id: number; trip_no: string; status: TripStatus; driver_name: string; destination: string; start_time: string };
};

export type LiveTrip = {
  id: number;
  trip_no: string;
  status: TripStatus;
  with_passenger: boolean;
  car_code: string;
  car_model: string;
  driver_name: string;
  driver_phone: string | null;
  passenger_name: string | null;
  is_visitor: boolean;
  department: string | null;
  start_km: number;
  start_place: string;
  destination: string;
  purpose: string | null;
  start_time: string;
  journey_start_time: string | null;
  end_time: string | null;
  minutes_running: number | null;
  needs_review: boolean;
  approval_status: string | null;
};

export type Alert = {
  id: number;
  type: AlertType;
  message: string;
  status: "open" | "solved";
  trip_id: number | null;
  trip_no: string | null;
  vehicle_id: number | null;
  car_code: string | null;
  note: string | null;
  created_at: string;
};

export type Dashboard = {
  as_of: string;
  today: string;
  cards: {
    cars_on_trip: number;
    cars_available: number;
    trips_waiting_confirm: number;
    trips_today: number;
    km_today: number;
    open_alerts: number;
  };
  car_board: BoardCar[];
  live_trips: LiveTrip[];
  alerts: Alert[];
  charts: {
    km_per_car_this_month: { car_code: string; km: number }[];
    trips_per_day_this_month: { date: string; trips: number }[];
  };
};

/** A row of the trip history (same fields as a live trip, plus the end). */
export type HistoryTrip = LiveTrip & {
  end_km: number | null;
  distance_km: number | null;
  end_place: string | null;
  end_confirm_time: string | null;
  close_reason: string | null;
  start_no_scan_reason: string | null;
  end_no_scan_reason: string | null;
  approval_note: string | null;
  approved_at: string | null;
  reg_number: string;
};

export type TripPage = { total: number; total_km: number; limit: number; offset: number; trips: HistoryTrip[] };

export type TimelineEvent = {
  id: number;
  at: string;
  event: string;
  label: string;
  actor: string;
  who: { kind: "driver" | "passenger" | "visitor" | "admin" | "system"; ref: string | null; name: string | null };
  ip: string | null;
  device: string | null;
  lat: number | null;
  lng: number | null;
  detail: Record<string, unknown> | null;
};

export type TripDetail = {
  trip: HistoryTrip & {
    driver: { id: number; employee_id: string; name: string; phone: string | null };
    passenger: { id: number; employee_id: string; name: string; department: string | null } | null;
    visitor: { name: string; phone: string; reason: string | null } | null;
    vehicle: { id: number; car_code: string; model: string; reg_number: string };
    map_points: { start: { lat: number; lng: number } | null; end: { lat: number; lng: number } | null };
    photos: { start: { url: string | null }; end: { url: string | null } };
    approved_by_name: string | null;
    lock: { stage: "start" | "end"; locked: boolean; tries_left: number } | null;
  };
  timeline: TimelineEvent[];
  alerts: Alert[];
};

export const adminApi = {
  dashboard: (signal?: AbortSignal) => api<Dashboard>("/admin/dashboard", { signal }),
  solveAlert: (id: number, note: string) => api<{ alert: Alert }>(`/admin/alerts/${id}/solve`, { json: { note } }),
  signOut: () => api("/auth/logout", { method: "POST", query: { who: "admin" } }),
  closeTrip: (id: number, reason: string, endKm?: number) =>
    api(`/admin/trips/${id}/close`, { json: { reason, ...(endKm ? { end_km: endKm } : {}) } }),
  unlockTrip: (id: number, reason: string) => api(`/admin/trips/${id}/unlock`, { json: { reason } }),
  decideApproval: (id: number, decision: "approved" | "rejected", note: string) =>
    api(`/admin/trips/${id}/approval`, { json: { decision, note } }),
};

/** The session ended (8 hours, or the account was turned off): back to sign-in, then back to this page. */
export function toSignIn() {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/admin/login?next=${encodeURIComponent(here)}&expired=1`);
}

export function isSignedOut(err: unknown) {
  return err instanceof ApiError && err.status === 401;
}
