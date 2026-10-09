"""Start a trip and manage the waiting state (PDF 6.2, 6.4, 6.5, section 12)."""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import current_driver, current_principal, get_db
from app.errors import api_error
from app.models import (
    Alert, AlertType, AdminRole, AdminUser, Driver, Trip, TripPhoto, TripStage,
    TripStatus, Vehicle,
)
from app.schemas import trip_out
from app.services import settings as app_settings
from app.services.audit import log_event
from app.services.qr_access import is_locked
from app.services.tokens import create_trip_token, revoke_open_tokens
from app.services.trips import open_trip_for_driver, start_blocker
from app.storage import PhotoStorage, detect_image_type, get_storage

router = APIRouter(prefix="/trips", tags=["trips"])

MAX_KM = 9_999_999


def _read_photo(photo: UploadFile) -> tuple[bytes, str]:
    limit = settings.max_photo_mb * 1024 * 1024
    data = photo.file.read(limit + 1)
    if len(data) > limit:
        raise api_error(413, "PHOTO_TOO_LARGE", f"Photo is larger than {settings.max_photo_mb} MB")
    ext = detect_image_type(data)
    if ext is None:
        raise api_error(400, "INVALID_PHOTO", "The dashboard photo must be a JPEG, PNG or WebP picture")
    return data, ext


@router.post("", status_code=201)
def start_trip(
    request: Request,
    car_code: Annotated[str, Form(min_length=1, max_length=20)],
    qr_version: Annotated[int, Form(ge=1)],
    start_km: Annotated[int, Form(ge=0, le=MAX_KM)],
    start_place: Annotated[str, Form(min_length=1, max_length=255)],
    destination: Annotated[str, Form(min_length=1, max_length=255)],
    with_passenger: Annotated[bool, Form()],
    photo: Annotated[UploadFile, File(description="Live dashboard photo")],
    purpose: Annotated[str | None, Form(max_length=500)] = None,
    start_lat: Annotated[float | None, Form(ge=-90, le=90)] = None,
    start_lng: Annotated[float | None, Form(ge=-180, le=180)] = None,
    driver: Driver = Depends(current_driver),
    db: Session = Depends(get_db),
    storage: PhotoStorage = Depends(get_storage),
):
    """Start form + dashboard photo in ONE request, so a trip is never saved without its photo."""
    start_place, destination = start_place.strip(), destination.strip()
    purpose = (purpose or "").strip() or None
    if not start_place or not destination:
        raise api_error(422, "FIELD_REQUIRED", "Start place and destination are required")
    if not with_passenger and purpose is None:
        raise api_error(422, "PURPOSE_REQUIRED", "Purpose is required for trips without a passenger")

    data, ext = _read_photo(photo)  # fail fast before touching the database

    # Lock the car row so two drivers cannot start on it at the same moment.
    vehicle = db.scalar(select(Vehicle).where(Vehicle.car_code == car_code).with_for_update())
    if vehicle is None:
        raise api_error(404, "CAR_NOT_FOUND", "This car is not registered")
    if qr_version != vehicle.qr_version:
        raise api_error(410, "STICKER_OUTDATED", "This sticker is out of date. Ask the admin for a new one.")

    blocker = start_blocker(db, vehicle, driver)
    if blocker:
        raise api_error(409, blocker["code"], blocker["message"], **{k: v for k, v in blocker.items() if k not in ("code", "message")})

    if start_km < vehicle.current_km:
        raise api_error(
            422, "START_KM_TOO_LOW",
            f"Start km is lower than the last end km of {vehicle.car_code} ({vehicle.current_km}). Please check the odometer.",
            last_end_km=vehicle.current_km,
        )

    now = datetime.now(timezone.utc)
    trip = Trip(
        vehicle_id=vehicle.id, driver_id=driver.id, with_passenger=with_passenger, purpose=purpose,
        start_km=start_km, start_place=start_place, start_lat=start_lat, start_lng=start_lng,
        destination=destination,
        status=TripStatus.waiting_for_passenger if with_passenger else TripStatus.in_progress,
        # No passenger: the journey starts right away (PDF 6.4).
        journey_start_time=None if with_passenger else now,
    )
    db.add(trip)
    photo_key = None
    try:
        db.flush()
        db.refresh(trip)  # picks up the generated trip number

        photo_key = f"trips/{trip.id}/start.{ext}"
        storage.save(photo_key, data)
        db.add(TripPhoto(trip_id=trip.id, kind=TripStage.start, file_url=photo_key))

        qr = None
        if with_passenger:
            url, expires_at = create_trip_token(
                db, trip.id, TripStage.start, app_settings.get_int(db, "qr_expiry_minutes")
            )
            qr = {"url": url, "expires_at": expires_at}

        gap = start_km - vehicle.current_km
        if gap > app_settings.get_int(db, "km_gap_limit_km"):
            db.add(Alert(
                trip_id=trip.id, vehicle_id=vehicle.id, type=AlertType.km_gap,
                message=(f"{vehicle.car_code} trip {trip.trip_no} started {gap} km above its last end km "
                         f"({vehicle.current_km}). Check the photos."),
            ))

        log_event(db, request, "trip_started", f"driver:{driver.employee_id}", trip_id=trip.id,
                  lat=start_lat, lng=start_lng,
                  detail={"car": vehicle.car_code, "start_km": start_km, "with_passenger": with_passenger})
        db.commit()
    except IntegrityError:
        db.rollback()
        if photo_key:
            storage.delete(photo_key)
        raise api_error(409, "OPEN_TRIP_EXISTS", "This car or driver already has an open trip")
    except OSError:
        db.rollback()
        raise api_error(503, "PHOTO_SAVE_FAILED", "The photo could not be saved. Please try again.")
    except Exception:
        db.rollback()
        if photo_key:
            storage.delete(photo_key)
        raise

    return {"trip": trip_out(trip), "start_qr": qr}


@router.get("/active")
def active_trip(driver: Driver = Depends(current_driver), db: Session = Depends(get_db)):
    """The driver's open trip (also after signing in on another phone), or null."""
    trip = open_trip_for_driver(db, driver.id)
    blocked = bool(
        trip and trip.status == TripStatus.waiting_for_passenger and is_locked(db, trip.id, TripStage.start)
    )
    end_blocked = bool(
        trip and trip.status == TripStatus.waiting_for_end_confirm and is_locked(db, trip.id, TripStage.end)
    )
    return {"trip": trip_out(trip) if trip else None, "start_qr_blocked": blocked, "end_qr_blocked": end_blocked}


def _own_waiting_trip(db: Session, trip_id: int, driver: Driver) -> Trip:
    trip = db.get(Trip, trip_id)
    if trip is None or trip.driver_id != driver.id:
        raise api_error(404, "TRIP_NOT_FOUND", "Trip not found")
    if trip.status != TripStatus.waiting_for_passenger:
        raise api_error(409, "TRIP_NOT_WAITING", "This trip is not waiting for a passenger")
    return trip


@router.post("/{trip_id}/start-qr")
def new_start_qr(
    trip_id: int, request: Request,
    driver: Driver = Depends(current_driver), db: Session = Depends(get_db),
):
    """'Make new QR': the old Start QR stops working."""
    trip = _own_waiting_trip(db, trip_id, driver)
    if is_locked(db, trip.id, TripStage.start):
        raise api_error(423, "TRIP_LOCKED", "Too many wrong IDs were entered. Cancel this trip or ask the admin.")
    revoke_open_tokens(db, trip.id, TripStage.start)
    url, expires_at = create_trip_token(db, trip.id, TripStage.start, app_settings.get_int(db, "qr_expiry_minutes"))
    log_event(db, request, "start_qr_renewed", f"driver:{driver.employee_id}", trip_id=trip.id)
    db.commit()
    return {"start_qr": {"url": url, "expires_at": expires_at}}


class CancelBody(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.post("/{trip_id}/cancel")
def cancel_trip(
    trip_id: int, body: CancelBody, request: Request,
    principal: Driver | AdminUser = Depends(current_principal), db: Session = Depends(get_db),
):
    """Before the passenger confirms the start: the driver (own trip) or an admin may cancel."""
    reason = body.reason.strip()
    if not reason:
        raise api_error(422, "REASON_REQUIRED", "Please give a reason")

    if isinstance(principal, Driver):
        trip = _own_waiting_trip(db, trip_id, principal)
        actor = f"driver:{principal.employee_id}"
    else:
        if principal.role != AdminRole.admin:
            raise api_error(403, "ADMIN_ROLE_REQUIRED", "Admin role required")
        trip = db.get(Trip, trip_id)
        if trip is None:
            raise api_error(404, "TRIP_NOT_FOUND", "Trip not found")
        if trip.status != TripStatus.waiting_for_passenger:
            raise api_error(409, "TRIP_NOT_WAITING", "Only trips waiting for a passenger can be cancelled")
        actor = f"admin:{principal.username}"

    trip.status = TripStatus.cancelled
    trip.close_reason = reason
    revoke_open_tokens(db, trip.id)
    log_event(db, request, "trip_cancelled", actor, trip_id=trip.id, detail={"reason": reason})
    db.commit()
    return {"trip": trip_out(trip)}


def _own_trip_in_state(db: Session, trip_id: int, driver: Driver, status: TripStatus, lock: bool = False) -> Trip:
    stmt = select(Trip).where(Trip.id == trip_id)
    if lock:
        stmt = stmt.with_for_update()
    trip = db.scalar(stmt)
    if trip is None or trip.driver_id != driver.id:  # only the driver of this trip (PDF D6)
        raise api_error(404, "TRIP_NOT_FOUND", "Trip not found")
    if trip.status != status:
        names = {
            TripStatus.waiting_for_passenger: ("TRIP_NOT_WAITING", "This trip is not waiting for a passenger"),
            TripStatus.in_progress: ("TRIP_NOT_IN_PROGRESS", "This trip is not in progress"),
            TripStatus.waiting_for_end_confirm: ("TRIP_NOT_WAITING_END", "This trip is not waiting for the end confirmation"),
        }
        code, message = names[status]
        raise api_error(409, code, message, status=trip.status.value)
    return trip


@router.post("/{trip_id}/end")
def end_trip(
    trip_id: int,
    request: Request,
    end_km: Annotated[int, Form(ge=0, le=MAX_KM)],
    end_place: Annotated[str, Form(min_length=1, max_length=255)],
    photo: Annotated[UploadFile, File(description="Live dashboard photo at the end")],
    end_lat: Annotated[float | None, Form(ge=-90, le=90)] = None,
    end_lng: Annotated[float | None, Form(ge=-180, le=180)] = None,
    driver: Driver = Depends(current_driver),
    db: Session = Depends(get_db),
    storage: PhotoStorage = Depends(get_storage),
):
    """End form + end dashboard photo in ONE request (PDF 6.3 steps D6-D8, S5).

    With a passenger: status Waiting for end confirm, and a one-time End QR is made.
    Without a passenger: the trip is completed right away (PDF 6.4)."""
    end_place = end_place.strip()
    if not end_place:
        raise api_error(422, "FIELD_REQUIRED", "End place is required")
    data, ext = _read_photo(photo)  # fail fast before touching the database

    trip = _own_trip_in_state(db, trip_id, driver, TripStatus.in_progress, lock=True)
    if end_km <= trip.start_km:
        raise api_error(422, "END_KM_TOO_LOW",
                        f"End km must be more than the start km ({trip.start_km}). Please check the odometer.",
                        start_km=trip.start_km)

    now = datetime.now(timezone.utc)
    distance = end_km - trip.start_km
    trip.end_km, trip.end_place, trip.end_lat, trip.end_lng = end_km, end_place, end_lat, end_lng
    trip.end_time = now
    trip.distance_km = distance

    photo_key = None
    qr = None
    try:
        photo_key = f"trips/{trip.id}/end.{ext}"
        storage.save(photo_key, data)
        db.add(TripPhoto(trip_id=trip.id, kind=TripStage.end, file_url=photo_key))

        if trip.with_passenger:
            trip.status = TripStatus.waiting_for_end_confirm
            url, expires_at = create_trip_token(
                db, trip.id, TripStage.end, app_settings.get_int(db, "qr_expiry_minutes")
            )
            qr = {"url": url, "expires_at": expires_at}
        else:
            trip.status = TripStatus.completed
            vehicle = db.scalar(select(Vehicle).where(Vehicle.id == trip.vehicle_id).with_for_update())
            vehicle.current_km = end_km

        if distance > app_settings.get_int(db, "high_km_limit_km"):
            db.add(Alert(
                trip_id=trip.id, vehicle_id=trip.vehicle_id, type=AlertType.high_km,
                message=f"{trip.vehicle.car_code} trip {trip.trip_no} covered {distance} km. Check the photos and the route.",
            ))

        log_event(db, request, "trip_end_submitted" if trip.with_passenger else "trip_completed",
                  f"driver:{driver.employee_id}", trip_id=trip.id, lat=end_lat, lng=end_lng,
                  detail={"end_km": end_km, "distance_km": distance, "with_passenger": trip.with_passenger})
        db.commit()
    except OSError:
        db.rollback()
        raise api_error(503, "PHOTO_SAVE_FAILED", "The photo could not be saved. Please try again.")
    except Exception:
        db.rollback()
        if photo_key:
            storage.delete(photo_key)
        raise

    return {"trip": trip_out(trip), "end_qr": qr}


@router.post("/{trip_id}/end-qr")
def new_end_qr(
    trip_id: int, request: Request,
    driver: Driver = Depends(current_driver), db: Session = Depends(get_db),
):
    """'Make new QR' at the end: the old End QR stops working (also after a restart or on another phone)."""
    trip = _own_trip_in_state(db, trip_id, driver, TripStatus.waiting_for_end_confirm)
    if is_locked(db, trip.id, TripStage.end):
        raise api_error(423, "TRIP_LOCKED", "Too many wrong IDs were entered. Please ask the admin.")
    revoke_open_tokens(db, trip.id, TripStage.end)
    url, expires_at = create_trip_token(db, trip.id, TripStage.end, app_settings.get_int(db, "qr_expiry_minutes"))
    log_event(db, request, "end_qr_renewed", f"driver:{driver.employee_id}", trip_id=trip.id)
    db.commit()
    return {"end_qr": {"url": url, "expires_at": expires_at}}


# ---- "Passenger can't scan" (PDF section 8): the driver skips a confirmation, the admin approves later ----

class CantScanBody(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _check_cant_scan(db: Session, reason: str) -> str:
    if not app_settings.get_int(db, "allow_cant_scan"):
        raise api_error(403, "CANT_SCAN_NOT_ALLOWED", "This option is switched off. Please ask the admin.")
    reason = reason.strip()
    if not reason:
        raise api_error(422, "REASON_REQUIRED", "Please say why the passenger cannot scan")
    return reason


@router.post("/{trip_id}/cant-scan")
def start_cant_scan(
    trip_id: int, body: CantScanBody, request: Request,
    driver: Driver = Depends(current_driver), db: Session = Depends(get_db),
):
    """'Passenger can't scan' at the start: the trip begins without the passenger's confirmation.

    It is marked for review and waits for an admin approval. The Start QR stops working."""
    reason = _check_cant_scan(db, body.reason)
    trip = _own_trip_in_state(db, trip_id, driver, TripStatus.waiting_for_passenger, lock=True)
    trip.status = TripStatus.in_progress
    trip.journey_start_time = datetime.now(timezone.utc)
    trip.start_no_scan_reason = reason
    trip.approval_status = "pending"
    trip.needs_review = True
    revoke_open_tokens(db, trip.id, TripStage.start)
    log_event(db, request, "trip_started_unconfirmed", f"driver:{driver.employee_id}", trip_id=trip.id,
              detail={"reason": reason})
    db.commit()
    return {"trip": trip_out(trip)}


@router.post("/{trip_id}/end-cant-scan")
def end_cant_scan(
    trip_id: int, body: CantScanBody, request: Request,
    driver: Driver = Depends(current_driver), db: Session = Depends(get_db),
):
    """'Passenger can't scan' at the end: the trip completes without the passenger's confirmation.

    It is marked for review and waits for an admin approval. The car's km moves forward as usual."""
    reason = _check_cant_scan(db, body.reason)
    trip = _own_trip_in_state(db, trip_id, driver, TripStatus.waiting_for_end_confirm, lock=True)
    trip.status = TripStatus.completed  # end_confirm_time stays empty: nobody confirmed
    trip.end_no_scan_reason = reason
    trip.approval_status = "pending"
    trip.needs_review = True
    revoke_open_tokens(db, trip.id, TripStage.end)
    vehicle = db.scalar(select(Vehicle).where(Vehicle.id == trip.vehicle_id).with_for_update())
    vehicle.current_km = trip.end_km
    log_event(db, request, "trip_completed_unconfirmed", f"driver:{driver.employee_id}", trip_id=trip.id,
              detail={"reason": reason, "end_km": trip.end_km})
    db.commit()
    return {"trip": trip_out(trip)}
