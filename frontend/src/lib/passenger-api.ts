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
  expires_at: string;
  tries_left: number;
  opened_by_driver: boolean;
};

export type PassengerPage = StartPage | EndPage;

export type StartConfirmed = {
  trip: { trip_no: string; journey_start_time: string; car_code: string; driver_name: string; passenger_name: string; is_visitor: boolean; start_place: string; destination: string };
};
export type EndConfirmed = {
  trip: { trip_no: string; car_code: string; start_km: number; end_km: number; distance_km: number; journey_minutes: number | null; end_confirm_time: string };
};

const at = (token: string) => `/p/${encodeURIComponent(token)}`;

export const passengerApi = {
  lookup: (token: string, employeeId: string) => api<{ name: string }>(`${at(token)}/lookup`, { json: { employee_id: employeeId } }),
  confirmEmployee: (token: string, employeeId: string) =>
    api<StartConfirmed>(`${at(token)}/confirm-start`, { json: { passenger_type: "employee", employee_id: employeeId } }),
  confirmVisitor: (token: string, v: { name: string; phone: string; reason?: string }) =>
    api<StartConfirmed>(`${at(token)}/confirm-start`, { json: { passenger_type: "visitor", ...v, reason: v.reason || undefined } }),
  confirmEnd: (token: string, as: "employee" | "visitor", value: string) =>
    api<EndConfirmed>(`${at(token)}/confirm-end`, {
      json: as === "employee" ? { passenger_type: "employee", employee_id: value } : { passenger_type: "visitor", phone: value },
    }),
  /** End QR when nobody confirmed the start: a visitor gives name and phone (and a reason) here. */
  identifyVisitorAtEnd: (token: string, v: { name: string; phone: string; reason?: string }) =>
    api<EndConfirmed>(`${at(token)}/confirm-end`, { json: { passenger_type: "visitor", ...v, reason: v.reason || undefined } }),
};

/** Errors after which this code cannot be used any more: the page switches to a full-screen notice. */
export const DEAD_CODES = new Set([
  "QR_INVALID", "WRONG_QR", "QR_USED", "TRIP_CANCELLED", "QR_BLOCKED", "QR_REPLACED", "QR_EXPIRED", "TRIP_NOT_WAITING",
  "TOO_MANY_LOOKUPS",
]);

/** Same rule as the backend: digits, spaces and dashes, optional leading +, 7 to 21 characters. */
export const PHONE_RE = /^\+?[0-9][0-9 \-]{5,19}$/;
