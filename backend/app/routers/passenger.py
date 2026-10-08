"""Passenger pages. No sign-in: access comes from the one-time Start QR on the driver's phone
(PDF 6.2 steps P1 and P2, sections 8 and 13). The end of the trip is added in the next step."""
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import get_db, optional_driver_id
from app.errors import api_error
from app.models import Passenger, RecordStatus, TripPhoto, TripStage, TripStatus
from app.services import settings as app_settings
from app.services.audit import log_event
from app.services.qr_access import (
    MAX_LOOKUPS_PER_TRIP, lookups_for_trip, register_wrong_try, resolve_token, tries_left,
)
from app.storage import PhotoStorage, get_storage

router = APIRouter(prefix="/p", tags=["passenger"])

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
EmployeeId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[0-9][0-9 \-]{5,19}$")]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]

IMAGE_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


class LookupBody(BaseModel):
    employee_id: EmployeeId


class EmployeeConfirm(BaseModel):
    passenger_type: Literal["employee"]
    employee_id: EmployeeId


class VisitorConfirm(BaseModel):
    """Someone who is not an EPIC employee (visitor, expat, guest)."""
    passenger_type: Literal["visitor"]
    name: Name
    phone: Phone
    reason: Reason | None = None  # reason of travel, optional


ConfirmBody = Annotated[EmployeeConfirm | VisitorConfirm, Field(discriminator="passenger_type")]


def _find_passenger(db: Session, employee_id: str) -> Passenger | None:
    return db.scalar(
        select(Passenger).where(
            func.upper(Passenger.employee_id) == employee_id.strip().upper(),
            Passenger.status == RecordStatus.active,
        )
    )


@router.get("/{token}")
def open_start_qr(token: str, db: Session = Depends(get_db)):
    """P1/S3: what the passenger sees after scanning the Start QR."""
    row, trip = resolve_token(db, token, TripStage.start)
    return {
        "kind": "start",
        "trip": {
            "trip_no": trip.trip_no,
            "car_code": trip.vehicle.car_code,
            "car_model": trip.vehicle.model,
            "reg_number": trip.vehicle.reg_number,
            "driver_name": trip.driver.name,
            "start_km": trip.start_km,
            "start_place": trip.start_place,
            "destination": trip.destination,
            "start_time": trip.start_time,
        },
        "photo_url": f"/api/p/{token}/photo",
        "expires_at": row.expires_at,
        "allow_visitors": bool(app_settings.get_int(db, "allow_visitors")),
        "tries_left": tries_left(db, trip.id, TripStage.start),
    }


@router.get("/{token}/photo")
def start_photo(token: str, db: Session = Depends(get_db), storage: PhotoStorage = Depends(get_storage)):
    """The start dashboard photo, only while the QR is valid."""
    _, trip = resolve_token(db, token, TripStage.start)
    photo = db.scalar(select(TripPhoto).where(TripPhoto.trip_id == trip.id, TripPhoto.kind == TripStage.start))
    if photo is None:
        raise api_error(404, "PHOTO_MISSING", "Photo not found")
    try:
        data = storage.read(photo.file_url)
    except (OSError, ValueError):
        raise api_error(404, "PHOTO_MISSING", "Photo not found")
    media = IMAGE_TYPES.get(photo.file_url.rsplit(".", 1)[-1], "application/octet-stream")
    return Response(data, media_type=media, headers={"Cache-Control": "no-store"})


@router.post("/{token}/lookup")
def lookup_employee(token: str, body: LookupBody, request: Request, db: Session = Depends(get_db)):
    """Show the employee's NAME (only) for the typed ID, so a typo is noticed before confirming.
    A wrong ID counts toward the wrong-ID limit of the trip."""
    row, trip = resolve_token(db, token, TripStage.start, lock=True)
    if lookups_for_trip(db, trip.id) >= MAX_LOOKUPS_PER_TRIP:
        raise api_error(429, "TOO_MANY_LOOKUPS", "Too many tries. Please ask the driver or the admin.")

    passenger = _find_passenger(db, body.employee_id)
    if passenger is None:
        left = register_wrong_try(db, request, row, trip, body.employee_id)
        raise api_error(404, "ID_NOT_FOUND", "ID not found", tries_left=left)

    log_event(db, request, "passenger_lookup", "passenger:unknown", trip_id=trip.id)
    db.commit()
    return {"name": passenger.name}


@router.post("/{token}/confirm-start")
def confirm_start(
    token: str,
    body: ConfirmBody,
    request: Request,
    db: Session = Depends(get_db),
    driver_id: int | None = Depends(optional_driver_id),
):
    """P2/S4: the passenger confirms the start. Status becomes In progress."""
    row, trip = resolve_token(db, token, TripStage.start, lock=True)

    # PDF rule 9: not accepted from the driver's own signed-in phone.
    if driver_id is not None and driver_id == trip.driver_id:
        raise api_error(403, "DRIVER_CANNOT_CONFIRM",
                        "The driver cannot confirm for the passenger. Ask the passenger to scan with their own phone.")

    if isinstance(body, EmployeeConfirm):
        passenger = _find_passenger(db, body.employee_id)
        if passenger is None:
            left = register_wrong_try(db, request, row, trip, body.employee_id)
            raise api_error(404, "ID_NOT_FOUND", "ID not found", tries_left=left)
        if passenger.employee_id.upper() == trip.driver.employee_id.upper():
            raise api_error(403, "PASSENGER_IS_DRIVER", "The driver cannot be the passenger of the same trip")
        trip.passenger_id = passenger.id
        who, actor = passenger.name, f"passenger:{passenger.employee_id}"
        detail = {"passenger": passenger.employee_id}
    else:
        if not app_settings.get_int(db, "allow_visitors"):
            raise api_error(403, "VISITORS_NOT_ALLOWED", "Please use your employee ID")
        trip.is_visitor = True
        trip.visitor_name, trip.visitor_phone, trip.visitor_reason = body.name, body.phone, body.reason or None
        trip.needs_review = True  # visitor trips are listed for the admin to review
        who, actor = body.name, f"visitor:{body.phone}"
        detail = {"visitor": body.name, "phone": body.phone, "reason": body.reason or None}

    now = datetime.now(timezone.utc)
    trip.status = TripStatus.in_progress
    trip.journey_start_time = now
    row.used_at = now
    log_event(db, request, "journey_started", actor, trip_id=trip.id, detail=detail)
    db.commit()

    return {
        "message": "Journey started",
        "trip": {
            "trip_no": trip.trip_no,
            "status": trip.status.value,
            "journey_start_time": trip.journey_start_time,
            "car_code": trip.vehicle.car_code,
            "driver_name": trip.driver.name,
            "passenger_name": who,
            "is_visitor": trip.is_visitor,
            "start_place": trip.start_place,
            "destination": trip.destination,
        },
    }
