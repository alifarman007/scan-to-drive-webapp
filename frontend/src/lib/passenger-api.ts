/** Types and calls for the passenger pages (backend: app/routers/passenger.py). No sign-in: the token is the key. */
import { api } from "./api";

type TripBase = {
  trip_no: string;
  car_code: string;
  car_model: string;
  reg_number: string;
  driver_name: string;
  start_km: number;
  start_place: string;
  destination: string;
  start_time: string;
};

export type StartPage = {
  kind: "start";
  trip: TripBase;
  photo_url: string;
  expires_at: string;
  allow_visitors: boolean;
  tries_left: number;
  opened_by_driver: boolean;
  /** the shape an employee ID must have (a regular expression, letter case does not matter) */
  id_pattern: string;
};

export type EndPage = {
  kind: "end";
  trip: TripBase & {
    end_km: number;
    end_place: string;
    distance_km: number;
    journey_start_time: string | null;
    end_time: string;
    journey_minutes: number | null;
  };
  photos: { start: string; end: string };
  confirm_as: "employee" | "visitor";
  /** nobody confirmed the start ("Passenger can't scan"): the passenger says who they are here */
  identify: boolean;
  allow_visitors: boolean;
  /** this phone confirmed the start: the end is one tap, nothing to type */
  remembered: boolean;
  /** who confirmed the start (name and ID, or the visitor's name); only sent to the remembered phone */
  you: string | null;
  id_pattern: string;
  expires_at: string;
  tries_left: number;
  opened_by_driver: boolean;
};

export type PassengerPage = StartPage | EndPage;

export type StartConfirmed = {
  trip: { trip_no: string; journey_start_time: string; car_code: string; driver_name: string; passenger_name: string; is_visitor: boolean; start_place: string; destination: string };
};
export type EndConfirmed = {
  trip: {
    trip_no: string;
    car_code: string;
    start_km: number;
    end_km: number;
    distance_km: number;
    journey_minutes: number | null;
    end_confirm_time: string;
    driver_name: string;
  };
  /** lets this phone rate the trip for a while (one review per trip) */
  review_token: string;
};

export type Employee = { employeeId: string; name: string };

/** Quick tags on the review: good ones for 4-5 stars, the others for 1-3 stars (same list as the backend). */
export const GOOD_TAGS = ["safe_driving", "on_time", "clean_car", "polite_driver", "smooth_ride"] as const;
export const BAD_TAGS = ["rough_driving", "late", "dirty_car", "impolite", "phone_while_driving"] as const;
export type ReviewTag = (typeof GOOD_TAGS)[number] | (typeof BAD_TAGS)[number];

const at = (token: string) => `/p/${encodeURIComponent(token)}`;

const employee = (e: Employee) => ({ passenger_type: "employee", employee_id: e.employeeId, name: e.name.trim() || undefined });

export const passengerApi = {
  confirmEmployee: (token: string, e: Employee) => api<StartConfirmed>(`${at(token)}/confirm-start`, { json: employee(e) }),
  confirmVisitor: (token: string, v: { name: string; phone: string; reason?: string }) =>
    api<StartConfirmed>(`${at(token)}/confirm-start`, { json: { passenger_type: "visitor", ...v, reason: v.reason || undefined } }),
  confirmEnd: (token: string, as: "employee" | "visitor", value: string) =>
    api<EndConfirmed>(`${at(token)}/confirm-end`, {
      json: as === "employee" ? { passenger_type: "employee", employee_id: value } : { passenger_type: "visitor", phone: value },
    }),
  /** The phone that confirmed the start: its cookie is the proof, nothing to type. */
  confirmEndRemembered: (token: string) => api<EndConfirmed>(`${at(token)}/confirm-end`, { json: { passenger_type: "remembered" } }),
  /** End QR when nobody confirmed the start: an employee gives the ID (and maybe a name) here. */
  identifyEmployeeAtEnd: (token: string, e: Employee) => api<EndConfirmed>(`${at(token)}/confirm-end`, { json: employee(e) }),
  /** End QR when nobody confirmed the start: a visitor gives name and phone (and a reason) here. */
  identifyVisitorAtEnd: (token: string, v: { name: string; phone: string; reason?: string }) =>
    api<EndConfirmed>(`${at(token)}/confirm-end`, { json: { passenger_type: "visitor", ...v, reason: v.reason || undefined } }),
  review: (r: { token: string; rating: number; tags: ReviewTag[]; comment: string }) => api<unknown>("/p/review", { json: r }),
};

/** Errors after which this code cannot be used any more: the page switches to a full-screen notice. */
export const DEAD_CODES = new Set([
  "QR_INVALID", "WRONG_QR", "QR_USED", "TRIP_CANCELLED", "QR_BLOCKED", "QR_REPLACED", "QR_EXPIRED", "TRIP_NOT_WAITING",
]);

/** The ID as it is stored: capitals, no spaces or dashes ("emp-2210" becomes "EMP2210"). */
export const cleanId = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Does the ID have the agreed shape? The pattern comes from the backend (it is not final yet). */
export function idLooksRight(id: string, pattern: string) {
  try {
    return new RegExp(pattern, "i").test(id);
  } catch {
    return id.length > 0;
  }
}

/**
 * This phone has a trip going (started here, not ended yet). Lets a page opened later offer "Scan the end QR".
 * Only the trip number and car, kept in this browser for a day.
 */
const OPEN_TRIP_KEY = "s2d.pax.trip";
const DAY_MS = 24 * 3600 * 1000;

export const openTripOnThisPhone = {
  set(trip: { trip_no: string; car_code: string }) {
    try {
      localStorage.setItem(OPEN_TRIP_KEY, JSON.stringify({ ...trip, at: Date.now() }));
    } catch {
      /* private window: the button just does not show later */
    }
  },
  /** the stored text as it is (a stable value for useSyncExternalStore) */
  raw(): string | null {
    try {
      return localStorage.getItem(OPEN_TRIP_KEY);
    } catch {
      return null;
    }
  },
  parse(raw: string | null): { trip_no: string; car_code: string } | null {
    try {
      const v = JSON.parse(raw ?? "null") as { trip_no: string; car_code: string; at: number } | null;
      return v && Date.now() - v.at < DAY_MS ? v : null;
    } catch {
      return null;
    }
  },
  clear() {
    try {
      localStorage.removeItem(OPEN_TRIP_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

/** A scanned passenger QR (".../p/<code>"), as a link on this site. Anything else: null. */
export function parsePassengerLink(text: string): string | null {
  try {
    const url = new URL(text.trim(), window.location.origin);
    const m = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{10,200})\/?$/);
    return m ? `/p/${m[1]}` : null;
  } catch {
    return null;
  }
}

/** Same rule as the backend: digits, spaces and dashes, optional leading +, 7 to 21 characters. */
export const PHONE_RE = /^\+?[0-9][0-9 \-]{5,19}$/;
