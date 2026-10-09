"""Cars & QR (PDF 11.2): car list, add / edit, maintenance, new sticker version, printable sticker PDF.

Everyone with an admin sign-in may look; only admins may change things or print stickers (PDF section 4)."""
import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import current_admin_user, get_db, require_admin
from app.errors import api_error
from app.models import AdminUser, OPEN_TRIP_STATUSES, Trip, TripStatus, Vehicle, VehicleStatus
from app.routers.admin_views import DONE, _live_trip
from app.services.audit import log_event
from app.services.stickers import car_qr_link, sticker_pdf

router = APIRouter(prefix="/admin/cars", tags=["admin: cars"])

MAX_KM = 9_999_999
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,19}$")


class CarCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    car_code: str = Field(description="For example CAR-11. Letters, digits and dashes. Cannot be changed later.")
    reg_number: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=80)
    current_km: int = Field(default=0, ge=0, le=MAX_KM)
    status: VehicleStatus = VehicleStatus.active

    @field_validator("car_code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = v.strip().upper()
        if not CODE_RE.match(v):
            raise ValueError("Car code must be 2-20 letters, digits or dashes, for example CAR-11")
        return v

    @field_validator("reg_number", "model")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v


class CarUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reg_number: str | None = Field(default=None, min_length=1, max_length=40)
    model: str | None = Field(default=None, min_length=1, max_length=80)
    status: VehicleStatus | None = None
    current_km: int | None = Field(default=None, ge=0, le=MAX_KM)
    reason: str | None = Field(default=None, max_length=500, description="Required when current_km is corrected")

    @field_validator("reg_number", "model")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v


def _stats(db: Session, vehicle_ids: list[int] | None = None) -> dict[int, dict]:
    stmt = select(
        Trip.vehicle_id,
        func.count().filter(Trip.status != TripStatus.cancelled),
        func.coalesce(func.sum(Trip.distance_km).filter(Trip.status.in_(DONE)), 0),
        func.max(Trip.start_time),
    ).group_by(Trip.vehicle_id)
    if vehicle_ids is not None:
        stmt = stmt.where(Trip.vehicle_id.in_(vehicle_ids))
    return {vid: {"total_trips": n, "total_km": int(km), "last_trip_at": last} for vid, n, km, last in db.execute(stmt)}


def _open_trips(db: Session) -> dict[int, Trip]:
    return {t.vehicle_id: t for t in db.scalars(select(Trip).where(Trip.status.in_(OPEN_TRIP_STATUSES)))}


def car_out(v: Vehicle, stats: dict | None, open_trip: Trip | None) -> dict:
    s = stats or {"total_trips": 0, "total_km": 0, "last_trip_at": None}
    return {
        "id": v.id, "car_code": v.car_code, "reg_number": v.reg_number, "model": v.model,
        "current_km": v.current_km, "status": v.status.value, "qr_version": v.qr_version,
        "qr_link": car_qr_link(v.car_code, v.qr_version), **s,
        "open_trip": None if open_trip is None else {
            "id": open_trip.id, "trip_no": open_trip.trip_no, "status": open_trip.status.value,
            "driver_name": open_trip.driver.name},
        "created_at": v.created_at,
    }


def _get_car(db: Session, car_id: int, lock: bool = False) -> Vehicle:
    stmt = select(Vehicle).where(Vehicle.id == car_id)
    if lock:
        stmt = stmt.with_for_update()
    v = db.scalar(stmt)
    if v is None:
        raise api_error(404, "CAR_NOT_FOUND", "Car not found")
    return v


def _check_unique(db: Session, *, car_code: str | None = None, reg_number: str | None = None, exclude_id: int | None = None):
    if car_code is not None:
        stmt = select(Vehicle.id).where(Vehicle.car_code == car_code)
        if exclude_id:
            stmt = stmt.where(Vehicle.id != exclude_id)
        if db.scalar(stmt) is not None:
            raise api_error(409, "CAR_CODE_EXISTS", f"A car with code {car_code} already exists")
    if reg_number is not None:
        stmt = select(Vehicle.id).where(func.lower(Vehicle.reg_number) == reg_number.lower())
        if exclude_id:
            stmt = stmt.where(Vehicle.id != exclude_id)
        if db.scalar(stmt) is not None:
            raise api_error(409, "REG_NUMBER_EXISTS", f"A car with registration number {reg_number} already exists")


@router.get("")
def list_cars(
    q: str | None = Query(None, max_length=80, description="search code, registration number, model"),
    status: VehicleStatus | None = None,
    _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db),
):
    where = []
    if status:
        where.append(Vehicle.status == status)
    if q and q.strip():
        t = q.strip()
        where.append(Vehicle.car_code.icontains(t, autoescape=True) | Vehicle.reg_number.icontains(t, autoescape=True)
                     | Vehicle.model.icontains(t, autoescape=True))
    cars = db.scalars(select(Vehicle).where(*where).order_by(Vehicle.car_code)).all()
    stats, open_trips = _stats(db, [c.id for c in cars]), _open_trips(db)
    return {"total": len(cars), "cars": [car_out(c, stats.get(c.id), open_trips.get(c.id)) for c in cars]}


@router.post("", status_code=201)
def create_car(
    body: CarCreate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    _check_unique(db, car_code=body.car_code, reg_number=body.reg_number)
    car = Vehicle(car_code=body.car_code, reg_number=body.reg_number, model=body.model,
                  current_km=body.current_km, status=body.status)
    db.add(car)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "CAR_EXISTS", "A car with this code or registration number already exists")
    log_event(db, request, "car_created", f"admin:{admin.username}",
              detail={"car_id": car.id, "car_code": car.car_code, "reg_number": car.reg_number, "status": car.status.value})
    db.commit()
    return {"car": car_out(car, None, None)}


@router.get("/{car_id}")
def car_detail(car_id: int, _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db)):
    """One car with its totals, open trip and last 10 trips. The full history: GET /admin/trips?car_id=."""
    car = _get_car(db, car_id)
    last = db.scalars(select(Trip).where(Trip.vehicle_id == car.id).order_by(Trip.start_time.desc(), Trip.id.desc()).limit(10)).all()
    now = datetime.now(timezone.utc)
    return {
        "car": car_out(car, _stats(db, [car.id]).get(car.id), _open_trips(db).get(car.id)),
        "recent_trips": [_live_trip(t, now) for t in last],
    }


@router.patch("/{car_id}")
def update_car(
    car_id: int, body: CarUpdate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Change registration number, model or status (set maintenance / inactive), or correct the km (needs a reason).

    The car code cannot be changed (it is printed on the sticker). A car with an open trip cannot be set to
    maintenance or inactive: close or finish the trip first."""
    changes = body.model_dump(exclude_unset=True)
    reason = (changes.pop("reason", None) or "").strip()
    if not changes:
        raise api_error(422, "NOTHING_TO_CHANGE", "Send at least one field to change")
    if any(v is None for v in changes.values()):
        raise api_error(422, "FIELD_REQUIRED", "A field cannot be set to null")
    if "current_km" in changes and not reason:
        raise api_error(422, "REASON_REQUIRED", "Please give a reason for correcting the km")

    car = _get_car(db, car_id, lock=True)
    if "reg_number" in changes:
        _check_unique(db, reg_number=changes["reg_number"], exclude_id=car.id)
    if changes.get("status") in (VehicleStatus.maintenance, VehicleStatus.inactive) and car.status == VehicleStatus.active:
        if _open_trips(db).get(car.id) is not None:
            raise api_error(409, "CAR_HAS_OPEN_TRIP", "This car has an open trip. Close or finish it first.")

    before = {k: (getattr(car, k).value if k == "status" else getattr(car, k)) for k in changes}
    for k, v in changes.items():
        setattr(car, k, v)
    after = {k: (getattr(car, k).value if k == "status" else getattr(car, k)) for k in changes}
    log_event(db, request, "car_updated", f"admin:{admin.username}",
              detail={"car_id": car.id, "car_code": car.car_code, "before": before, "after": after, "reason": reason or None})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "REG_NUMBER_EXISTS", "A car with this registration number already exists")
    return {"car": car_out(car, _stats(db, [car.id]).get(car.id), _open_trips(db).get(car.id))}


@router.post("/{car_id}/new-sticker")
def new_sticker(
    car_id: int, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Sticker lost or damaged: bump the QR version. The OLD sticker stops working at once (PDF section 8).
    Print the new one with GET /admin/cars/{id}/qr.pdf."""
    car = _get_car(db, car_id, lock=True)
    old = car.qr_version
    car.qr_version = old + 1
    log_event(db, request, "car_sticker_renewed", f"admin:{admin.username}",
              detail={"car_id": car.id, "car_code": car.car_code, "old_version": old, "new_version": car.qr_version})
    db.commit()
    return {"car": car_out(car, _stats(db, [car.id]).get(car.id), _open_trips(db).get(car.id))}


@router.get("/{car_id}/qr.pdf")
def sticker(
    car_id: int, request: Request,
    layout: Literal["sticker", "a4"] = "sticker",
    inline: bool = Query(False, description="true = show in the browser; default = download as a file"),
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Printable sticker: 6 x 6 cm page (layout=sticker) or an A4 page with the sticker at the top left (layout=a4)."""
    car = _get_car(db, car_id)
    pdf = sticker_pdf(car.car_code, car.qr_version, layout)
    log_event(db, request, "car_sticker_printed", f"admin:{admin.username}",
              detail={"car_id": car.id, "car_code": car.car_code, "version": car.qr_version, "layout": layout})
    db.commit()
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{car.car_code}-sticker.pdf"', "Cache-Control": "no-store"})
