/** Types and calls used by the driver screens (backend: app/routers/cars.py and trips.py). */
import { api } from "./api";

export type TripStatus =
  | "waiting_for_passenger"
  | "in_progress"
  | "waiting_for_end_confirm"
  | "completed"
  | "cancelled"
  | "closed_by_admin";

export type Trip = {
  id: number;
  trip_no: string;
  status: TripStatus;
  with_passenger: boolean;
  car_code: string;
  car_model: string;
  reg_number: string;
  driver_name: string;
  passenger_name: string | null;
  is_visitor: boolean;
  start_km: number;
  end_km: number | null;
  distance_km: number | null;
  start_place: string;
  destination: string;
  end_place: string | null;
  purpose: string | null;
  start_time: string;
  journey_start_time: string | null;
  end_time: string | null;
  end_confirm_time: string | null;
  close_reason: string | null;
  needs_review: boolean;
  approval_status: "pending" | "approved" | "rejected" | null;
  start_no_scan_reason: string | null;
  end_no_scan_reason: string | null;
};

export type Qr = { url: string; expires_at: string };

export type ActiveTrip = {
  trip: Trip | null;
  start_qr_blocked: boolean;
  end_qr_blocked: boolean;
  reminders: { type: string; message: string; since: string }[];
  allow_cant_scan: boolean;
  qr_expiry_minutes: number;
};

export type CarPage = {
  car: {
    car_code: string;
    reg_number: string;
    model: string;
    status: "active" | "maintenance" | "inactive";
    last_end_km: number;
    qr_version: number;
    last_end_place: string | null;
  };
  driver: { employee_id: string; name: string };
  km_gap_limit_km: number;
  can_start: boolean;
  blocked: null | { code: string; message: string; trip_id?: number; trip_no?: string };
  my_open_trip: null | { id: number; trip_no: string; status: TripStatus; car_code: string };
};

export const OPEN_STATUSES: TripStatus[] = ["waiting_for_passenger", "in_progress", "waiting_for_end_confirm"];

export const driverApi = {
  active: (signal?: AbortSignal) => api<ActiveTrip>("/trips/active", { signal }),
  trip: (id: number) => api<{ trip: Trip }>(`/trips/${id}`),
  start: (form: FormData) => api<{ trip: Trip; start_qr: Qr | null }>("/trips", { form }),
  newStartQr: (id: number) => api<{ start_qr: Qr }>(`/trips/${id}/start-qr`, { method: "POST" }),
  cancel: (id: number, reason: string) => api<{ trip: Trip }>(`/trips/${id}/cancel`, { json: { reason } }),
  cantScanStart: (id: number, reason: string) => api<{ trip: Trip }>(`/trips/${id}/cant-scan`, { json: { reason } }),
  end: (id: number, form: FormData) => api<{ trip: Trip; end_qr: Qr | null }>(`/trips/${id}/end`, { form }),
  newEndQr: (id: number) => api<{ end_qr: Qr }>(`/trips/${id}/end-qr`, { method: "POST" }),
  cantScanEnd: (id: number, reason: string) => api<{ trip: Trip }>(`/trips/${id}/end-cant-scan`, { json: { reason } }),
  purposes: () => api<{ purposes: string[] }>("/purposes"),
};

// ---- the current QR is kept for this browser tab, so a reload shows the same code ---------------------------
// (the server only keeps a fingerprint of each code, so it cannot hand the same one out twice)

type Stage = "start" | "end";
const qrKey = (tripId: number, stage: Stage) => `s2d.qr.${tripId}.${stage}`;

export function saveQr(tripId: number, stage: Stage, qr: Qr) {
  try {
    sessionStorage.setItem(qrKey(tripId, stage), JSON.stringify(qr));
  } catch {
    /* private mode: the driver just makes a new QR after a reload */
  }
}

export function loadQr(tripId: number, stage: Stage): Qr | null {
  try {
    const raw = sessionStorage.getItem(qrKey(tripId, stage));
    if (!raw) return null;
    const qr = JSON.parse(raw) as Qr;
    return new Date(qr.expires_at).getTime() > Date.now() ? qr : null;
  } catch {
    return null;
  }
}

export function clearQr(tripId: number) {
  try {
    sessionStorage.removeItem(qrKey(tripId, "start"));
    sessionStorage.removeItem(qrKey(tripId, "end"));
  } catch {
    /* nothing to clear */
  }
}

/** Car code and sticker version from a scanned QR, or null if it is not one of our car stickers. */
export function parseCarSticker(text: string): { code: string; v: string | null } | null {
  const raw = text.trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const m = url.pathname.match(/^\/c\/([A-Za-z0-9_-]{1,20})\/?$/);
    if (!m) return null;
    const v = url.searchParams.get("v");
    return { code: m[1].toUpperCase(), v: v && /^\d{1,6}$/.test(v) ? v : null };
  } catch {
    return null;
  }
}
