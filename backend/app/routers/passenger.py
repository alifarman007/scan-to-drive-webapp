"""Passenger pages. No sign-in: access comes from the one-time QR code on the driver's phone
(PDF 6.2 steps P1-P2, 6.3 steps P3-P4, sections 8 and 13).

Start QR: open the page, confirm the start with an employee ID (name optional) or visitor details.
          There is no staff list to check IDs against: the ID only has to look right (see passenger_id_pattern),
          and a new ID is added to the passengers table. The phone is remembered for this trip (cookie).
End QR:   open the summary and confirm. The same phone confirms with one tap; another phone types the SAME
          employee ID (or the same phone number for a visitor). Then the passenger can rate the trip.
"""
import re
import secrets
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import cookies_secure, settings
from app.deps import get_db, optional_driver_id
from app.errors import api_error
from app.models import (
    Passenger, RecordStatus, Trip, TripEvent, TripPhoto, TripReview, TripStage, TripStatus, Vehicle,
)
from app.security import (
    PASSENGER_COOKIE_DAYS, hash_key, passenger_cookie_name, review_token_trip, sign_review_token,
)
from app.services import settings as app_settings
from app.services.audit import log_event
from app.services.phones import normalize_phone
from app.services.qr_access import register_wrong_try, resolve_token, tries_left
from app.storage import PhotoStorage, get_storage

router = APIRouter(prefix="/p", tags=["passenger"])

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
EmployeeId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[0-9][0-9 \-]{5,19}$")]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]

IMAGE_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


class EmployeeConfirm(BaseModel):
    passenger_type: Literal["employee"]
    employee_id: EmployeeId
    name: Name | None = None  # optional: there is no staff list to take it from


class VisitorConfirm(BaseModel):
    """Someone who is not an EPIC employee (visitor, expat, guest)."""
    passenger_type: Literal["visitor"]
    name: Name
    phone: Phone
    reason: Reason | None = None  # reason of travel, optional


ConfirmStartBody = Annotated[EmployeeConfirm | VisitorConfirm, Field(discriminator="passenger_type")]


class EndEmployeeConfirm(BaseModel):
    passenger_type: Literal["employee"]
    employee_id: EmployeeId
    name: Name | None = None  # only used when nobody confirmed the start


class EndRemembered(BaseModel):
    """The same phone that confirmed the start: its cookie is the proof, nothing to type."""
    passenger_type: Literal["remembered"]


class EndVisitorConfirm(BaseModel):
    """A visitor proves it is the same person by repeating the phone number given at the start.
    `name` and `reason` are only used when nobody confirmed the start (see `_start_unconfirmed`)."""
    passenger_type: Literal["visitor"]
    phone: Phone
    name: Name | None = None
    reason: Reason | None = None


ConfirmEndBody = Annotated[EndEmployeeConfirm | EndVisitorConfirm | EndRemembered, Field(discriminator="passenger_type")]

# Quick tags on the review. Good ones are offered for 4-5 stars, the others for 1-3 stars.
REVIEW_TAGS = {
    "safe_driving", "on_time", "clean_car", "polite_driver", "smooth_ride",
    "rough_driving", "late", "dirty_car", "impolite", "phone_while_driving",
}


class ReviewBody(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    rating: int = Field(ge=1, le=5)
    tags: list[str] = Field(default_factory=list, max_length=10)
    comment: str = Field(default="", max_length=500)


def _find_passenger(db: Session, employee_id: str) -> Passenger | None:
    return db.scalar(select(Passenger).where(func.upper(Passenger.employee_id) == employee_id.strip().upper()))


def _valid_id(employee_id: str) -> str:
    """The typed ID in capitals, if it has the agreed shape (letter case does not matter)."""
    value = employee_id.strip().upper()
    if not re.fullmatch(settings.passenger_id_pattern, value):
        raise api_error(422, "BAD_ID_FORMAT", "This does not look like an employee ID", example="1236001")
    return value


def _remember_phone(response: Response, trip) -> None:
    """After the start: remember this phone for this trip, so it can confirm the end with one tap."""
    key = secrets.token_urlsafe(24)
    trip.passenger_key_hash = hash_key(key)
    response.set_cookie(
        passenger_cookie_name(trip.id), key, max_age=PASSENGER_COOKIE_DAYS * 86400, httponly=True,
        samesite="lax", secure=cookies_secure(), path="/",
    )


def _is_remembered(request: Request, trip) -> bool:
    raw = request.cookies.get(passenger_cookie_name(trip.id))
    return bool(raw and trip.passenger_key_hash and secrets.compare_digest(hash_key(raw), trip.passenger_key_hash))


def _who_started(db: Session, trip) -> str | None:
    """Who confirmed the start, as typed on that phone: "Name · ID", or just the ID (or the visitor's name).
    The name comes from this trip's own start record, not from the passengers table."""
    if trip.passenger is not None:
        detail = db.scalar(select(TripEvent.detail).where(
            TripEvent.trip_id == trip.id, TripEvent.event == "journey_started").order_by(TripEvent.id.desc()).limit(1))
        name = (detail or {}).get("name")
        return f"{name} · {trip.passenger.employee_id}" if name else trip.passenger.employee_id
    return trip.visitor_name


def _reject_drivers_own_phone(driver_id: int | None, trip) -> None:
    """PDF rule 9: not accepted from the driver's own signed-in phone (best effort)."""
    if driver_id is not None and driver_id == trip.driver_id:
        raise api_error(403, "DRIVER_CANNOT_CONFIRM",
                        "The driver cannot confirm for the passenger. Ask the passenger to scan with their own phone.")


def _start_unconfirmed(trip) -> bool:
    """The driver used "Passenger can't scan" at the start: the trip has a passenger, but nobody is on record.
    The End QR then asks the passenger who they are (instead of matching against nobody)."""
    return trip.with_passenger and trip.passenger_id is None and not trip.is_visitor


def _identify(db: Session, request: Request, row, trip, body) -> tuple[str, str, dict]:
    """Put the passenger on the trip: an employee by ID, or a visitor by name and phone.
    Returns (name to show, audit actor, audit detail). Raises the same errors as the start page."""
    if body.passenger_type == "employee":
        if body.employee_id.strip().upper() == trip.driver.employee_id.upper():
            raise api_error(403, "PASSENGER_IS_DRIVER", "The driver cannot be the passenger of the same trip")
        employee_id = _valid_id(body.employee_id)  # a typo in the shape is not counted as a wrong try
        passenger = _find_passenger(db, employee_id)
        if passenger is not None and passenger.status != RecordStatus.active:
            raise api_error(403, "PASSENGER_INACTIVE", "This employee ID is turned off. Ask the transport office.")
        if passenger is None:  # first trip of this employee: add them
            passenger = Passenger(employee_id=employee_id, name=body.name or None)
            db.add(passenger)
            db.flush()
        elif body.name:
            passenger.name = body.name  # the latest name the employee typed
        trip.passenger_id = passenger.id
        detail = {"passenger": passenger.employee_id, **({"name": body.name} if body.name else {})}
        # Privacy: the page only ever shows back what was typed here, never a name stored for this ID
        return body.name or passenger.employee_id, f"passenger:{passenger.employee_id}", detail
    if not app_settings.get_int(db, "allow_visitors"):
        raise api_error(403, "VISITORS_NOT_ALLOWED", "Please use your employee ID")
    if not body.name:
        raise api_error(422, "NAME_REQUIRED", "Please type your name")
    trip.is_visitor = True
    trip.visitor_name, trip.visitor_phone, trip.visitor_reason = body.name, body.phone, body.reason or None
    trip.needs_review = True  # visitor trips are listed for the admin to review
    return body.name, f"visitor:{body.phone}", {"visitor": body.name, "phone": body.phone, "reason": body.reason or None}


def _minutes(start: datetime | None, end: datetime | None) -> int | None:
    return int((end - start).total_seconds() // 60) if start and end else None


@router.get("/{token}")
def open_qr(
    token: str, request: Request, db: Session = Depends(get_db), driver_id: int | None = Depends(optional_driver_id),
):
    """P1/S3 (Start QR) and P3/S6 (End QR): what the passenger sees after scanning.

    `opened_by_driver`: the page was opened on the trip driver's own signed-in phone, so it can say straight
    away that the passenger must scan with their own phone (confirming from there is refused anyway)."""
    row, trip = resolve_token(db, token)
    left = tries_left(db, trip.id, row.kind)
    opened_by_driver = driver_id is not None and driver_id == trip.driver_id
    common = {
        "trip_no": trip.trip_no,
        "car_code": trip.vehicle.car_code,
        "car_model": trip.vehicle.model,
        "reg_number": trip.vehicle.reg_number,
        "driver_name": trip.driver.name,
        "start_km": trip.start_km,
        "start_place": trip.start_place,
        "destination": trip.destination,
        "start_time": trip.start_time,
    }
    remembered = row.kind == TripStage.end and _is_remembered(request, trip)
    if row.kind == TripStage.start:
        return {
            "kind": "start",
            "trip": common,
            "photo_url": f"/api/p/{token}/photo",
            "expires_at": row.expires_at,
            "allow_visitors": bool(app_settings.get_int(db, "allow_visitors")),
            "tries_left": left,
            "opened_by_driver": opened_by_driver,
            "id_pattern": settings.passenger_id_pattern,
        }
    return {
        "kind": "end",
        "trip": {
            **common,
            "end_km": trip.end_km,
            "end_place": trip.end_place,
            "distance_km": trip.distance_km,
            "journey_start_time": trip.journey_start_time,
            "end_time": trip.end_time,
            "journey_minutes": _minutes(trip.journey_start_time, trip.end_time),
        },
        "photos": {"start": f"/api/p/{token}/photo/start", "end": f"/api/p/{token}/photo/end"},
        "confirm_as": "visitor" if trip.is_visitor else "employee",  # which box the page shows
        # nobody confirmed the start: the page asks who the passenger is (employee ID or visitor details)
        "identify": _start_unconfirmed(trip),
        "allow_visitors": bool(app_settings.get_int(db, "allow_visitors")),
        # this phone confirmed the start: one tap is enough (nothing to type)
        "remembered": remembered,
        # who is confirming, shown only to the phone that confirmed the start
        "you": _who_started(db, trip) if remembered else None,
        "id_pattern": settings.passenger_id_pattern,
        "expires_at": row.expires_at,
        "tries_left": left,
        "opened_by_driver": opened_by_driver,
    }


def _send_photo(db: Session, storage: PhotoStorage, trip_id: int, kind: TripStage) -> Response:
    photo = db.scalar(select(TripPhoto).where(TripPhoto.trip_id == trip_id, TripPhoto.kind == kind))
    if photo is None:
        raise api_error(404, "PHOTO_MISSING", "Photo not found")
    try:
        data = storage.read(photo.file_url)
    except (OSError, ValueError):
        raise api_error(404, "PHOTO_MISSING", "Photo not found")
    media = IMAGE_TYPES.get(photo.file_url.rsplit(".", 1)[-1], "application/octet-stream")
    return Response(data, media_type=media, headers={"Cache-Control": "no-store"})


@router.get("/{token}/photo")
def start_photo(token: str, db: Session = Depends(get_db), storage: PhotoStorage = Depends(get_storage)):
    """The start dashboard photo, only while the QR is valid."""
    _, trip = resolve_token(db, token)
    return _send_photo(db, storage, trip.id, TripStage.start)


@router.get("/{token}/photo/{kind}")
def trip_photo(
    token: str, kind: Literal["start", "end"],
    db: Session = Depends(get_db), storage: PhotoStorage = Depends(get_storage),
):
    """Start or end dashboard photo (the end photo exists once the driver has ended the trip)."""
    _, trip = resolve_token(db, token)
    return _send_photo(db, storage, trip.id, TripStage(kind))


@router.post("/{token}/confirm-start")
def confirm_start(
    token: str,
    body: ConfirmStartBody,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    driver_id: int | None = Depends(optional_driver_id),
):
    """P2/S4: the passenger confirms the start. Status becomes In progress. The phone is remembered for the end."""
    row, trip = resolve_token(db, token, TripStage.start, lock=True)
    _reject_drivers_own_phone(driver_id, trip)

    who, actor, detail = _identify(db, request, row, trip, body)

    now = datetime.now(timezone.utc)
    trip.status = TripStatus.in_progress
    trip.journey_start_time = now
    row.used_at = now
    _remember_phone(response, trip)
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


@router.post("/{token}/confirm-end")
def confirm_end(
    token: str,
    body: ConfirmEndBody,
    request: Request,
    db: Session = Depends(get_db),
    driver_id: int | None = Depends(optional_driver_id),
):
    """P4/S7: the passenger confirms the end with the SAME ID (or phone, for a visitor). Trip is completed.
    If nobody confirmed the start, the passenger identifies here instead (employee ID, or visitor name + phone)."""
    row, trip = resolve_token(db, token, TripStage.end, lock=True)
    _reject_drivers_own_phone(driver_id, trip)

    identified = None
    if _start_unconfirmed(trip):
        # Nobody confirmed the start ("Passenger can't scan"): the passenger says who they are now.
        # The trip still waits for the office's approval, because the start itself was not confirmed.
        if body.passenger_type == "remembered":
            raise api_error(422, "WRONG_PASSENGER_TYPE", "Please say who you are")
        identified = _identify(db, request, row, trip, body)
        actor = identified[1]
    elif body.passenger_type == "remembered":
        # the phone that confirmed the start: nothing to type. Not counted as a wrong try when it fails
        # (the cookie may simply have been cleared); the page then asks for the ID.
        if not _is_remembered(request, trip):
            raise api_error(403, "NOT_REMEMBERED", "This phone is not the one that confirmed the start")
        actor = f"passenger:{trip.passenger.employee_id}" if trip.passenger else f"visitor:{trip.visitor_phone}"
    else:
        expected = "visitor" if trip.is_visitor else "employee"
        if body.passenger_type != expected:
            raise api_error(422, "WRONG_PASSENGER_TYPE", f"This trip must be confirmed as: {expected}")
        if isinstance(body, EndEmployeeConfirm):
            same = trip.passenger is not None and trip.passenger.employee_id.upper() == body.employee_id.strip().upper()
            typed, actor = body.employee_id, f"passenger:{trip.passenger.employee_id}" if trip.passenger else "passenger:unknown"
            message = "This ID does not match the passenger who started the trip"
        else:
            same = normalize_phone(body.phone) == normalize_phone(trip.visitor_phone or "")
            typed, actor = body.phone, f"visitor:{trip.visitor_phone}"
            message = "This phone number does not match the one given at the start of the trip"
        if not same:
            left = register_wrong_try(db, request, row, trip, typed)
            raise api_error(403, "ID_MISMATCH", message, tries_left=left)

    now = datetime.now(timezone.utc)
    trip.status = TripStatus.completed
    trip.end_confirm_time = now
    row.used_at = now
    # The car's current km moves forward only when the trip is completed (PDF S7).
    vehicle = db.scalar(select(Vehicle).where(Vehicle.id == trip.vehicle_id).with_for_update())
    vehicle.current_km = trip.end_km
    detail = {"end_km": trip.end_km, "distance_km": trip.distance_km}
    if identified is not None:
        detail.update(identified[2], identified_at_end=True)
    if body.passenger_type == "remembered":
        detail["same_phone"] = True
    log_event(db, request, "trip_completed", actor, trip_id=trip.id, detail=detail)
    db.commit()

    return {
        "message": "Trip completed",
        "trip": {
            "trip_no": trip.trip_no,
            "status": trip.status.value,
            "car_code": trip.vehicle.car_code,
            "start_km": trip.start_km,
            "end_km": trip.end_km,
            "distance_km": trip.distance_km,
            "journey_minutes": _minutes(trip.journey_start_time, trip.end_time),
            "end_confirm_time": trip.end_confirm_time,
            "driver_name": trip.driver.name,
        },
        # lets this phone rate the trip for the next 2 hours (one review per trip)
        "review_token": sign_review_token(trip.id),
    }


@router.post("/review", status_code=201)
def review_trip(body: ReviewBody, request: Request, db: Session = Depends(get_db)):
    """The passenger rates the finished trip: 1-5 stars, quick tags, an optional comment. Once per trip."""
    trip_id = review_token_trip(body.token)
    if trip_id is None:
        raise api_error(403, "REVIEW_LINK_EXPIRED", "This review link is not valid any more")
    trip = db.get(Trip, trip_id)
    if trip is None or trip.status != TripStatus.completed:
        raise api_error(404, "TRIP_NOT_FOUND", "Trip not found")
    if db.scalar(select(TripReview.id).where(TripReview.trip_id == trip_id)) is not None:
        raise api_error(409, "ALREADY_REVIEWED", "This trip has already been rated")
    tags = sorted({t for t in body.tags if t in REVIEW_TAGS})
    comment = body.comment.strip() or None
    db.add(TripReview(trip_id=trip_id, rating=body.rating, tags=tags, comment=comment))
    actor = f"passenger:{trip.passenger.employee_id}" if trip.passenger else f"visitor:{trip.visitor_phone}" if trip.is_visitor else "passenger:unknown"
    log_event(db, request, "trip_reviewed", actor, trip_id=trip_id, detail={"rating": body.rating, "tags": tags})
    db.commit()
    return {"rating": body.rating, "tags": tags, "comment": comment}
