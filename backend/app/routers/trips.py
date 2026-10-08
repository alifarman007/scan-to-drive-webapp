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
    return {"trip": trip_out(trip) if trip else None}


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
