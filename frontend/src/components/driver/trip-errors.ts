import { ApiError, NETWORK_ERROR } from "@/lib/api";

/** Translation key (under "tripErrors") for an error from the trip API. */
export function tripErrorKey(err: unknown): string {
  if (!(err instanceof ApiError)) return "generic";
  if (err.code === NETWORK_ERROR || err.code === "BACKEND_DOWN") return "network";
  const known = [
    "START_KM_TOO_LOW", "END_KM_TOO_LOW", "PURPOSE_REQUIRED", "PHOTO_TOO_LARGE", "INVALID_PHOTO", "PHOTO_SAVE_FAILED",
    "STICKER_OUTDATED", "CAR_NOT_FOUND", "CAR_IN_USE", "CAR_IN_MAINTENANCE", "CAR_INACTIVE", "DRIVER_HAS_OPEN_TRIP",
    "OPEN_TRIP_EXISTS", "TRIP_LOCKED", "TRIP_NOT_WAITING", "TRIP_NOT_IN_PROGRESS", "TRIP_NOT_WAITING_END",
    "CANT_SCAN_NOT_ALLOWED", "FIELD_REQUIRED", "CSRF_CHECK_FAILED",
  ];
  if (known.includes(err.code)) return err.code;
  if (err.status === 401) return "signedOut";
  return "generic";
}
