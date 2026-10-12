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
  owner: CarOwner;
  vendor_name: string | null;
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
  driver_name?: string | null;
  note: string | null;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  created_at: string;
};

export type AlertPage = {
  total: number;
  counts: { open: number; solved: number };
  by_type: Partial<Record<AlertType, number>>;
  alerts: Alert[];
};

/** Passengers' average stars for a car or driver. */
export type RatingSummary = { average: number; count: number } | null;

/** Km and trips per day, last 30 days (oldest first). */
export type DayActivity = { date: string; trips: number; km: number };

export type CarStatus = "active" | "maintenance" | "inactive";
/** Epic Group's own car, or rented from a vendor (with the vendor's driver). */
export type CarOwner = "epic" | "vendor";

export type Vendor = { id: number; name: string; cars: number };

export type Car = {
  id: number;
  car_code: string;
  reg_number: string;
  model: string;
  current_km: number;
  /** false: the km was never recorded (a new car); the first trip sets it */
  km_known: boolean;
  status: CarStatus;
  owner: CarOwner;
  vendor: { id: number; name: string } | null;
  qr_version: number;
  qr_link: string;
  total_trips: number;
  total_km: number;
  last_trip_at: string | null;
  open_trip: null | { id: number; trip_no: string; status: TripStatus; driver_name: string };
  rating: RatingSummary;
  open_alerts: number;
  created_at: string;
};

export type CarDetail = { car: Car; recent_trips: HistoryTrip[]; km_by_day: DayActivity[]; vendors: Vendor[] };
export type CarList = { total: number; cars: Car[]; vendors: Vendor[] };

export type Driver = {
  id: number;
  employee_id: string;
  name: string;
  phone: string | null;
  license_no: string | null;
  status: "active" | "inactive";
  has_pin: boolean;
  total_trips: number;
  total_km: number;
  cancelled_trips: number;
  last_trip_at: string | null;
  open_trip: null | { id: number; trip_no: string; status: TripStatus; car_code: string };
  rating: RatingSummary;
  created_at: string;
};

export type AdminAccount = AdminUser & {
  status: "active" | "inactive";
  created_at: string;
  last_sign_in: string | null;
  is_me: boolean;
};

export type SettingKey =
  | "qr_expiry_minutes" | "wrong_id_limit" | "long_trip_hours" | "km_gap_limit_km"
  | "waiting_too_long_minutes" | "high_km_limit_km" | "allow_cant_scan" | "allow_visitors";

export type SettingRow = {
  key: SettingKey;
  value: number;
  default: number;
  min: number;
  max: number;
  label: string;
  updated_at: string | null;
  updated_by_name: string | null;
};

export type SettingsChange = {
  at: string;
  by: string;
  event: "settings_changed" | "purposes_changed";
  detail: Record<string, { from: number; to: number }> | { from: string[]; to: string[] } | null;
};

export type SettingsPage = { settings: SettingRow[]; purposes: string[]; history: SettingsChange[] };

export type DriverDetail = { driver: Driver; recent_trips: HistoryTrip[]; km_by_day: DayActivity[] };

export type ReviewTagKey =
  | "safe_driving" | "on_time" | "clean_car" | "polite_driver" | "smooth_ride"
  | "rough_driving" | "late" | "dirty_car" | "impolite" | "phone_while_driving";

/** A passenger's rating of a finished trip. */
export type Review = { rating: number; tags: ReviewTagKey[]; comment: string | null; at: string };

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
  ratings: {
    average_this_month: number | null;
    count_this_month: number;
    /** how many 1-star ... 5-star ratings this month */
    stars_this_month: number[];
    recent: (Review & { trip_id: number; trip_no: string; driver_name: string })[];
  };
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
  /** the passenger's star rating, if they gave one */
  rating?: number | null;
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

/** A dashboard photo: signed link (10 minutes) and what the server stored. `reused_on`: the same picture is on another trip. */
export type TripPhotoInfo = {
  url: string | null;
  width?: number | null;
  height?: number | null;
  size_bytes?: number | null;
  original_bytes?: number | null;
  reused_on?: { id: number; trip_no: string } | null;
};

export type TripDetail = {
  trip: HistoryTrip & {
    driver: { id: number; employee_id: string; name: string; phone: string | null };
    passenger: { id: number; employee_id: string; name: string | null; department: string | null } | null;
    visitor: { name: string; phone: string; reason: string | null } | null;
    vehicle: { id: number; car_code: string; model: string; reg_number: string; owner: CarOwner; vendor_name: string | null };
    map_points: { start: { lat: number; lng: number } | null; end: { lat: number; lng: number } | null };
    photos: { start: TripPhotoInfo; end: TripPhotoInfo };
    approved_by_name: string | null;
    lock: { stage: "start" | "end"; locked: boolean; tries_left: number } | null;
    review: Review | null;
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

  addCar: (car: {
    car_code: string; reg_number: string; model: string; current_km: number; status: CarStatus; owner: CarOwner; vendor_id: number | null;
  }) => api<{ car: Car }>("/admin/cars", { json: car }),
  updateCar: (
    id: number,
    changes: Partial<Pick<Car, "reg_number" | "model" | "status" | "current_km" | "owner">> & { vendor_id?: number | null; reason?: string },
  ) => api<{ car: Car }>(`/admin/cars/${id}`, { method: "PATCH", json: changes }),
  vendors: () => api<{ vendors: Vendor[] }>("/admin/vendors"),
  addVendor: (name: string) => api<{ vendor: Vendor }>("/admin/vendors", { json: { name } }),
  renameVendor: (id: number, name: string) => api<{ vendor: Vendor }>(`/admin/vendors/${id}`, { method: "PATCH", json: { name } }),
  removeVendor: (id: number) => api(`/admin/vendors/${id}`, { method: "DELETE" }),
  newSticker: (id: number) => api<{ car: Car }>(`/admin/cars/${id}/new-sticker`, { method: "POST" }),

  addDriver: (d: { employee_id: string; name: string; phone?: string; license_no?: string }) =>
    api<{ driver: Driver }>("/admin/drivers", { json: d }),
  updateDriver: (id: number, changes: Partial<Pick<Driver, "employee_id" | "name" | "phone" | "license_no" | "status">>) =>
    api<{ driver: Driver }>(`/admin/drivers/${id}`, { method: "PATCH", json: changes }),
  resetPin: (id: number) => api<{ driver: Driver }>(`/admin/drivers/${id}/reset-pin`, { method: "POST" }),

  addUser: (u: { username: string; role: AdminUser["role"]; password: string }) => api<{ user: AdminAccount }>("/admin/users", { json: u }),
  updateUser: (id: number, changes: { role?: AdminUser["role"]; status?: "active" | "inactive" }) =>
    api<{ user: AdminAccount }>(`/admin/users/${id}`, { method: "PATCH", json: changes }),
  resetPassword: (id: number, newPassword: string) =>
    api(`/admin/users/${id}/reset-password`, { json: { new_password: newPassword } }),
  changeMyPassword: (current: string, next: string) =>
    api("/admin/users/me/password", { json: { current_password: current, new_password: next } }),

  saveSettings: (values: Partial<Record<SettingKey, number>>) =>
    api<{ changed: Record<string, { from: number; to: number }> } & SettingsPage>("/admin/settings", { method: "PATCH", json: { values } }),
  savePurposes: (purposes: string[]) => api<{ purposes: string[] }>("/admin/settings/purposes", { method: "PUT", json: { purposes } }),
};

/** The printable sticker (PDF). `inline`: open in the browser instead of downloading. */
export function stickerHref(carId: number, layout: "sticker" | "a4", inline = true) {
  return `/api/admin/cars/${carId}/qr.pdf?layout=${layout}${inline ? "&inline=true" : ""}`;
}

/** The session ended (8 hours, or the account was turned off): back to sign-in, then back to this page. */
export function toSignIn() {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/admin/login?next=${encodeURIComponent(here)}&expired=1`);
}

export function isSignedOut(err: unknown) {
  return err instanceof ApiError && err.status === 401;
}
