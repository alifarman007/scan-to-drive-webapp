"""Cars & QR (PDF 11.2): car list, add / edit, maintenance, new sticker version, printable sticker PDF.
Cars are Epic-owned or rented from a vendor; vendors can be added and renamed.

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
from app.models import (Alert, AlertStatus, AdminUser, OPEN_TRIP_STATUSES, Trip, TripStatus, Vehicle, VehicleOwner,
                        VehicleStatus, Vendor)
from app.routers.admin_views import DONE, _live_trip
from app.services.activity import km_by_day, ratings_by
from app.services.audit import log_event
from app.services.stickers import car_qr_link, sticker_pdf

router = APIRouter(prefix="/admin/cars", tags=["admin: cars"])
vendors = APIRouter(prefix="/admin/vendors", tags=["admin: cars"])

MAX_KM = 9_999_999
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,19}$")


class CarCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    car_code: str = Field(description="For example CAR-11. Letters, digits and dashes. Cannot be changed later.")
    reg_number: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=80)
    current_km: int = Field(default=0, ge=0, le=MAX_KM, description="0 = not known yet; the first trip sets it")
    status: VehicleStatus = VehicleStatus.active
    owner: VehicleOwner = VehicleOwner.epic
    vendor_id: int | None = Field(default=None, description="Required for a vendor car, empty for an Epic car")

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
    owner: VehicleOwner | None = None
    vendor_id: int | None = Field(default=None, description="Send with owner=vendor (or alone to move a vendor car to another vendor)")
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


def car_out(v: Vehicle, stats: dict | None, open_trip: Trip | None, rating: dict | None = None,
            open_alerts: int = 0) -> dict:
    s = stats or {"total_trips": 0, "total_km": 0, "last_trip_at": None}
    return {
        "id": v.id, "car_code": v.car_code, "reg_number": v.reg_number, "model": v.model,
        "current_km": v.current_km, "km_known": v.current_km > 0, "status": v.status.value, "qr_version": v.qr_version,
        "owner": v.owner.value, "vendor": None if v.vendor is None else {"id": v.vendor.id, "name": v.vendor.name},
        "qr_link": car_qr_link(v.car_code, v.qr_version), **s,
        "open_trip": None if open_trip is None else {
            "id": open_trip.id, "trip_no": open_trip.trip_no, "status": open_trip.status.value,
            "driver_name": open_trip.driver.name},
        "rating": rating,  # passengers' average stars for trips in this car, or null
        "open_alerts": open_alerts,
        "created_at": v.created_at,
    }


def _open_alerts(db: Session, ids: list[int]) -> dict[int, int]:
    return dict(db.execute(select(Alert.vehicle_id, func.count()).where(
        Alert.vehicle_id.in_(ids), Alert.status == AlertStatus.open).group_by(Alert.vehicle_id)).all())


def _full_car(db: Session, car: Vehicle) -> dict:
    return car_out(car, _stats(db, [car.id]).get(car.id), _open_trips(db).get(car.id),
                   ratings_by(db, Trip.vehicle_id, [car.id]).get(car.id), _open_alerts(db, [car.id]).get(car.id, 0))


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


def _vendor_list(db: Session) -> list[dict]:
    counts = dict(db.execute(select(Vehicle.vendor_id, func.count()).where(Vehicle.vendor_id.is_not(None))
                             .group_by(Vehicle.vendor_id)).all())
    return [{"id": v.id, "name": v.name, "cars": counts.get(v.id, 0)}
            for v in db.scalars(select(Vendor).order_by(func.lower(Vendor.name)))]


def _owner_fields(db: Session, owner: VehicleOwner, vendor_id: int | None) -> dict:
    """Check owner and vendor go together; returns the two columns to save."""
    if owner == VehicleOwner.epic:
        if vendor_id is not None:
            raise api_error(422, "VENDOR_FOR_EPIC_CAR", "An Epic car has no vendor. Set owner to vendor to choose one.")
        return {"owner": owner, "vendor_id": None}
    if vendor_id is None:
        raise api_error(422, "VENDOR_REQUIRED", "Choose the vendor of this car")
    if db.get(Vendor, vendor_id) is None:
        raise api_error(404, "VENDOR_NOT_FOUND", "Vendor not found")
    return {"owner": owner, "vendor_id": vendor_id}


@router.get("")
def list_cars(
    q: str | None = Query(None, max_length=80, description="search code, registration number, model, vendor"),
    status: VehicleStatus | None = None,
    owner: VehicleOwner | None = Query(None, description="epic or vendor"),
    vendor_id: int | None = None,
    _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db),
):
    where = []
    if status:
        where.append(Vehicle.status == status)
    if owner:
        where.append(Vehicle.owner == owner)
    if vendor_id:
        where.append(Vehicle.vendor_id == vendor_id)
    if q and q.strip():
        t = q.strip()
        where.append(Vehicle.car_code.icontains(t, autoescape=True) | Vehicle.reg_number.icontains(t, autoescape=True)
                     | Vehicle.model.icontains(t, autoescape=True)
                     | Vehicle.vendor_id.in_(select(Vendor.id).where(Vendor.name.icontains(t, autoescape=True))))
    cars = db.scalars(select(Vehicle).where(*where).order_by(Vehicle.car_code)).all()
    ids = [c.id for c in cars]
    stats, open_trips = _stats(db, ids), _open_trips(db)
    ratings, alerts = ratings_by(db, Trip.vehicle_id, ids), _open_alerts(db, ids)
    return {"total": len(cars), "cars": [car_out(c, stats.get(c.id), open_trips.get(c.id), ratings.get(c.id), alerts.get(c.id, 0))
                                         for c in cars],
            "vendors": _vendor_list(db)}


@router.post("", status_code=201)
def create_car(
    body: CarCreate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    _check_unique(db, car_code=body.car_code, reg_number=body.reg_number)
    car = Vehicle(car_code=body.car_code, reg_number=body.reg_number, model=body.model,
                  current_km=body.current_km, status=body.status, **_owner_fields(db, body.owner, body.vendor_id))
    db.add(car)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "CAR_EXISTS", "A car with this code or registration number already exists")
    log_event(db, request, "car_created", f"admin:{admin.username}",
              detail={"car_id": car.id, "car_code": car.car_code, "reg_number": car.reg_number, "status": car.status.value,
                      "owner": car.owner.value, "vendor_id": car.vendor_id})
    db.commit()
    db.refresh(car)
    return {"car": car_out(car, None, None)}


@router.get("/{car_id}")
def car_detail(car_id: int, _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db)):
    """One car with its totals, open trip, last 10 trips and km per day (30 days). Full history: GET /admin/trips?car_id=."""
    car = _get_car(db, car_id)
    last = db.scalars(select(Trip).where(Trip.vehicle_id == car.id).order_by(Trip.start_time.desc(), Trip.id.desc()).limit(10)).all()
    now = datetime.now(timezone.utc)
    return {
        "car": _full_car(db, car),
        "recent_trips": [_live_trip(t, now) for t in last],
        "km_by_day": km_by_day(db, Trip.vehicle_id == car.id),
        "vendors": _vendor_list(db),  # for the edit form
    }


@router.patch("/{car_id}")
def update_car(
    car_id: int, body: CarUpdate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Change registration number, model, owner (Epic or a vendor) or status (set maintenance / inactive), or
    correct the km (needs a reason).

    The car code cannot be changed (it is printed on the sticker). A car with an open trip cannot be set to
    maintenance or inactive: close or finish the trip first."""
    changes = body.model_dump(exclude_unset=True)
    reason = (changes.pop("reason", None) or "").strip()
    if not changes:
        raise api_error(422, "NOTHING_TO_CHANGE", "Send at least one field to change")
    if any(v is None for k, v in changes.items() if k != "vendor_id"):
        raise api_error(422, "FIELD_REQUIRED", "A field cannot be set to null")
    if "current_km" in changes and not reason:
        raise api_error(422, "REASON_REQUIRED", "Please give a reason for correcting the km")

    car = _get_car(db, car_id, lock=True)
    if "owner" in changes or "vendor_id" in changes:
        owner = changes.get("owner", car.owner)
        vendor_id = changes.get("vendor_id", car.vendor_id if owner == car.owner else None)
        changes.update(_owner_fields(db, owner, vendor_id))
    if "reg_number" in changes:
        _check_unique(db, reg_number=changes["reg_number"], exclude_id=car.id)
    if changes.get("status") in (VehicleStatus.maintenance, VehicleStatus.inactive) and car.status == VehicleStatus.active:
        if _open_trips(db).get(car.id) is not None:
            raise api_error(409, "CAR_HAS_OPEN_TRIP", "This car has an open trip. Close or finish it first.")

    plain = lambda k: getattr(car, k).value if k in ("status", "owner") else getattr(car, k)
    before = {k: plain(k) for k in changes}
    for k, v in changes.items():
        setattr(car, k, v)
    after = {k: plain(k) for k in changes}
    log_event(db, request, "car_updated", f"admin:{admin.username}",
              detail={"car_id": car.id, "car_code": car.car_code, "before": before, "after": after, "reason": reason or None})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "REG_NUMBER_EXISTS", "A car with this registration number already exists")
    db.refresh(car)
    return {"car": _full_car(db, car)}


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
    return {"car": _full_car(db, car)}


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


# ================= vendors =================

class VendorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("must not be empty")
        return v


def _name_taken(db: Session, name: str, exclude_id: int | None = None) -> None:
    stmt = select(Vendor.id).where(func.lower(Vendor.name) == name.lower())
    if exclude_id:
        stmt = stmt.where(Vendor.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise api_error(409, "VENDOR_EXISTS", f"There is already a vendor called {name}")


def _get_vendor(db: Session, vendor_id: int) -> Vendor:
    v = db.get(Vendor, vendor_id, with_for_update=True)
    if v is None:
        raise api_error(404, "VENDOR_NOT_FOUND", "Vendor not found")
    return v


@vendors.get("")
def list_vendors(_: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db)):
    """Vendors with how many cars each one has."""
    return {"vendors": _vendor_list(db)}


@vendors.post("", status_code=201)
def create_vendor(body: VendorBody, request: Request, admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    _name_taken(db, body.name)
    v = Vendor(name=body.name)
    db.add(v)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "VENDOR_EXISTS", f"There is already a vendor called {body.name}")
    log_event(db, request, "vendor_created", f"admin:{admin.username}", detail={"vendor_id": v.id, "name": v.name})
    db.commit()
    return {"vendor": {"id": v.id, "name": v.name, "cars": 0}}


@vendors.patch("/{vendor_id}")
def rename_vendor(vendor_id: int, body: VendorBody, request: Request,
                  admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    """Change the vendor's name; its cars keep their vendor."""
    v = _get_vendor(db, vendor_id)
    _name_taken(db, body.name, exclude_id=v.id)
    old = v.name
    v.name = body.name
    if old != v.name:
        log_event(db, request, "vendor_renamed", f"admin:{admin.username}", detail={"vendor_id": v.id, "before": old, "after": v.name})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "VENDOR_EXISTS", f"There is already a vendor called {body.name}")
    cars = db.scalar(select(func.count()).select_from(Vehicle).where(Vehicle.vendor_id == v.id))
    return {"vendor": {"id": v.id, "name": v.name, "cars": cars}}


@vendors.delete("/{vendor_id}", status_code=204)
def delete_vendor(vendor_id: int, request: Request, admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    """Only a vendor without cars (for example one added by mistake). Move or change its cars first."""
    v = _get_vendor(db, vendor_id)
    if db.scalar(select(func.count()).select_from(Vehicle).where(Vehicle.vendor_id == v.id)):
        raise api_error(409, "VENDOR_HAS_CARS", "This vendor still has cars. Move them to another vendor or to Epic first.")
    log_event(db, request, "vendor_deleted", f"admin:{admin.username}", detail={"vendor_id": v.id, "name": v.name})
    db.delete(v)
    db.commit()
    return Response(status_code=204)
