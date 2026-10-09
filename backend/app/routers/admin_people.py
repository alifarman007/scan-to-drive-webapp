"""Drivers and Passengers pages (PDF 11.2): list, add, edit, deactivate, reset a driver's PIN, import passengers
from Excel. Admins and viewers may look; only admins may change anything."""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import current_admin_user, get_db, require_admin
from app.errors import api_error
from app.models import AdminUser, Driver, OPEN_TRIP_STATUSES, Passenger, RecordStatus, Trip, TripStatus
from app.routers.admin_views import DONE
from app.services.audit import log_event
from app.services.people_import import ImportFileError, parse_passenger_xlsx

drivers = APIRouter(prefix="/admin/drivers", tags=["admin: drivers"])
passengers = APIRouter(prefix="/admin/passengers", tags=["admin: passengers"])

MAX_UPLOAD_MB = 5


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class _Person(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("employee_id", "name", check_fields=False)
    @classmethod
    def _required_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v


class DriverCreate(_Person):
    employee_id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    license_no: str | None = Field(default=None, max_length=60)


class DriverUpdate(_Person):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    license_no: str | None = Field(default=None, max_length=60)
    status: RecordStatus | None = None


class PassengerCreate(_Person):
    employee_id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)


class PassengerUpdate(_Person):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    status: RecordStatus | None = None


def _exists(db: Session, model, employee_id: str, exclude_id: int | None = None) -> bool:
    stmt = select(model.id).where(func.lower(model.employee_id) == employee_id.lower())
    if exclude_id:
        stmt = stmt.where(model.id != exclude_id)
    return db.scalar(stmt) is not None


def _apply(person, changes: dict) -> tuple[dict, dict]:
    """Set the fields, return (before, after) for the audit log. Empty text clears an optional field."""
    before, after = {}, {}
    for k, v in changes.items():
        if k in ("phone", "license_no", "department"):
            v = _clean(v)
        old = getattr(person, k)
        old = old.value if isinstance(old, RecordStatus) else old
        setattr(person, k, v)
        new = getattr(person, k)
        new = new.value if isinstance(new, RecordStatus) else new
        if old != new:
            before[k], after[k] = old, new
    return before, after


def _check_changes(body: BaseModel) -> dict:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise api_error(422, "NOTHING_TO_CHANGE", "Send at least one field to change")
    if any(changes.get(k) is None for k in ("name", "status") if k in changes):
        raise api_error(422, "FIELD_REQUIRED", "Name and status cannot be empty")
    return changes


# ================= drivers =================

def _driver_stats(db: Session, ids: list[int]) -> dict[int, dict]:
    rows = db.execute(
        select(
            Trip.driver_id,
            func.count().filter(Trip.status != TripStatus.cancelled),
            func.coalesce(func.sum(Trip.distance_km).filter(Trip.status.in_(DONE)), 0),
            func.count().filter(Trip.status == TripStatus.cancelled),
            func.max(Trip.start_time),
        ).where(Trip.driver_id.in_(ids)).group_by(Trip.driver_id)
    )
    return {d: {"total_trips": n, "total_km": int(km), "cancelled_trips": c, "last_trip_at": last} for d, n, km, c, last in rows}


def driver_out(d: Driver, stats: dict | None, open_trip: Trip | None) -> dict:
    s = stats or {"total_trips": 0, "total_km": 0, "cancelled_trips": 0, "last_trip_at": None}
    return {
        "id": d.id, "employee_id": d.employee_id, "name": d.name, "phone": d.phone, "license_no": d.license_no,
        "status": d.status.value, "has_pin": d.pin_hash is not None, **s,
        "open_trip": None if open_trip is None else {"id": open_trip.id, "trip_no": open_trip.trip_no,
                                                     "status": open_trip.status.value},
        "created_at": d.created_at,
    }


def _open_trip_of(db: Session, driver_id: int) -> Trip | None:
    return db.scalar(select(Trip).where(Trip.driver_id == driver_id, Trip.status.in_(OPEN_TRIP_STATUSES)))


def _get_driver(db: Session, driver_id: int, lock: bool = False) -> Driver:
    stmt = select(Driver).where(Driver.id == driver_id)
    d = db.scalar(stmt.with_for_update() if lock else stmt)
    if d is None:
        raise api_error(404, "DRIVER_NOT_FOUND", "Driver not found")
    return d


def _full_driver(db: Session, d: Driver) -> dict:
    return driver_out(d, _driver_stats(db, [d.id]).get(d.id), _open_trip_of(db, d.id))


@drivers.get("")
def list_drivers(
    q: str | None = Query(None, max_length=80, description="search employee ID, name, phone"),
    status: RecordStatus | None = None,
    _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db),
):
    where = []
    if status:
        where.append(Driver.status == status)
    if q and q.strip():
        t = q.strip()
        where.append(Driver.employee_id.icontains(t, autoescape=True) | Driver.name.icontains(t, autoescape=True)
                     | Driver.phone.icontains(t, autoescape=True))
    rows = db.scalars(select(Driver).where(*where).order_by(Driver.name, Driver.id)).all()
    stats = _driver_stats(db, [d.id for d in rows])
    open_trips = {t.driver_id: t for t in db.scalars(select(Trip).where(Trip.status.in_(OPEN_TRIP_STATUSES)))}
    return {"total": len(rows), "drivers": [driver_out(d, stats.get(d.id), open_trips.get(d.id)) for d in rows]}


@drivers.get("/{driver_id}")
def driver_detail(driver_id: int, _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db)):
    """The driver's trip history: GET /admin/trips?driver_id=."""
    return {"driver": _full_driver(db, _get_driver(db, driver_id))}


@drivers.post("", status_code=201)
def create_driver(
    body: DriverCreate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Add a driver. No PIN is set here: the driver chooses a 4-digit PIN at the first sign-in."""
    if _exists(db, Driver, body.employee_id):
        raise api_error(409, "EMPLOYEE_ID_EXISTS", f"A driver with employee ID {body.employee_id} already exists")
    d = Driver(employee_id=body.employee_id, name=body.name, phone=_clean(body.phone), license_no=_clean(body.license_no))
    db.add(d)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "EMPLOYEE_ID_EXISTS", "A driver with this employee ID already exists")
    log_event(db, request, "driver_created", f"admin:{admin.username}",
              detail={"driver_id": d.id, "employee_id": d.employee_id, "name": d.name})
    db.commit()
    return {"driver": driver_out(d, None, None)}


@drivers.patch("/{driver_id}")
def update_driver(
    driver_id: int, body: DriverUpdate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Edit name, phone, licence number, or set status inactive / active. The employee ID cannot be changed.
    A driver with an open trip cannot be deactivated: close or finish the trip first."""
    changes = _check_changes(body)
    d = _get_driver(db, driver_id, lock=True)
    if changes.get("status") == RecordStatus.inactive and d.status == RecordStatus.active and _open_trip_of(db, d.id):
        raise api_error(409, "DRIVER_HAS_OPEN_TRIP", "This driver has an open trip. Close or finish it first.")
    before, after = _apply(d, changes)
    if before:
        log_event(db, request, "driver_updated", f"admin:{admin.username}",
                  detail={"driver_id": d.id, "employee_id": d.employee_id, "before": before, "after": after})
    db.commit()
    return {"driver": _full_driver(db, d)}


@drivers.post("/{driver_id}/reset-pin")
def reset_pin(
    driver_id: int, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Forgotten PIN: remove it. At the next sign-in the driver is asked to choose a new one."""
    d = _get_driver(db, driver_id, lock=True)
    d.pin_hash = None
    log_event(db, request, "driver_pin_reset", f"admin:{admin.username}",
              detail={"driver_id": d.id, "employee_id": d.employee_id})
    db.commit()
    return {"driver": _full_driver(db, d)}


# ================= passengers =================

def _passenger_stats(db: Session, ids: list[int]) -> dict[int, dict]:
    rows = db.execute(
        select(Trip.passenger_id, func.count().filter(Trip.status != TripStatus.cancelled),
               func.coalesce(func.sum(Trip.distance_km).filter(Trip.status.in_(DONE)), 0))
        .where(Trip.passenger_id.in_(ids)).group_by(Trip.passenger_id)
    )
    return {p: {"total_trips": n, "total_km": int(km)} for p, n, km in rows}


def passenger_out(p: Passenger, stats: dict | None) -> dict:
    s = stats or {"total_trips": 0, "total_km": 0}
    return {"id": p.id, "employee_id": p.employee_id, "name": p.name, "department": p.department, "phone": p.phone,
            "status": p.status.value, **s, "created_at": p.created_at}


def _get_passenger(db: Session, pid: int, lock: bool = False) -> Passenger:
    stmt = select(Passenger).where(Passenger.id == pid)
    p = db.scalar(stmt.with_for_update() if lock else stmt)
    if p is None:
        raise api_error(404, "PASSENGER_NOT_FOUND", "Passenger not found")
    return p


@passengers.get("")
def list_passengers(
    q: str | None = Query(None, max_length=80, description="search employee ID, name, department, phone"),
    department: str | None = Query(None, max_length=120),
    status: RecordStatus | None = None,
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
    _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db),
):
    where = []
    if status:
        where.append(Passenger.status == status)
    if department:
        where.append(func.lower(Passenger.department) == department.strip().lower())
    if q and q.strip():
        t = q.strip()
        where.append(Passenger.employee_id.icontains(t, autoescape=True) | Passenger.name.icontains(t, autoescape=True)
                     | Passenger.department.icontains(t, autoescape=True) | Passenger.phone.icontains(t, autoescape=True))
    total = db.scalar(select(func.count()).select_from(Passenger).where(*where))
    rows = db.scalars(select(Passenger).where(*where).order_by(Passenger.name, Passenger.id).limit(limit).offset(offset)).all()
    stats = _passenger_stats(db, [p.id for p in rows])
    return {"total": total, "limit": limit, "offset": offset, "passengers": [passenger_out(p, stats.get(p.id)) for p in rows]}


@passengers.get("/departments")
def list_departments(_: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db)):
    """For the department filter."""
    names = db.scalars(select(Passenger.department).where(Passenger.department.is_not(None)).distinct()
                       .order_by(Passenger.department)).all()
    return {"departments": names}


@passengers.get("/{passenger_id}")
def passenger_detail(passenger_id: int, _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db)):
    p = _get_passenger(db, passenger_id)
    return {"passenger": passenger_out(p, _passenger_stats(db, [p.id]).get(p.id))}


@passengers.post("", status_code=201)
def create_passenger(
    body: PassengerCreate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    if _exists(db, Passenger, body.employee_id):
        raise api_error(409, "EMPLOYEE_ID_EXISTS", f"A passenger with employee ID {body.employee_id} already exists")
    p = Passenger(employee_id=body.employee_id, name=body.name, department=_clean(body.department), phone=_clean(body.phone))
    db.add(p)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "EMPLOYEE_ID_EXISTS", "A passenger with this employee ID already exists")
    log_event(db, request, "passenger_created", f"admin:{admin.username}",
              detail={"passenger_id": p.id, "employee_id": p.employee_id, "name": p.name})
    db.commit()
    return {"passenger": passenger_out(p, None)}


@passengers.patch("/{passenger_id}")
def update_passenger(
    passenger_id: int, body: PassengerUpdate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Edit name, department, phone, or set status inactive / active. The employee ID cannot be changed.
    An inactive employee can no longer be named as a passenger (the passenger page says "ID not found")."""
    changes = _check_changes(body)
    p = _get_passenger(db, passenger_id, lock=True)
    before, after = _apply(p, changes)
    if before:
        log_event(db, request, "passenger_updated", f"admin:{admin.username}",
                  detail={"passenger_id": p.id, "employee_id": p.employee_id, "before": before, "after": after})
    db.commit()
    return {"passenger": passenger_out(p, _passenger_stats(db, [p.id]).get(p.id))}


@passengers.post("/import")
def import_passengers(
    request: Request,
    file: Annotated[UploadFile, File(description="Excel file (.xlsx) with the headings Employee ID, Name, Department, Phone")],
    dry_run: bool = Query(False, description="true = only show what would happen, change nothing"),
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Add and update employees from an Excel sheet. A row whose employee ID already exists updates that person's
    name, department and phone (blank cells in the file leave the old department / phone alone). Nobody is deleted
    or deactivated because they are missing from the file. Rows with problems are skipped and listed; the rest
    are saved."""
    limit = MAX_UPLOAD_MB * 1024 * 1024
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise api_error(413, "FILE_TOO_LARGE", f"The file is larger than {MAX_UPLOAD_MB} MB")
    try:
        parsed = parse_passenger_xlsx(data)
    except ImportFileError as e:
        raise api_error(422, "BAD_IMPORT_FILE", str(e))

    existing = {p.employee_id.lower(): p for p in db.scalars(
        select(Passenger).where(func.lower(Passenger.employee_id).in_([r.employee_id.lower() for r in parsed.rows]))
        .with_for_update()
    )}
    created = updated = unchanged = 0
    for r in parsed.rows:
        p = existing.get(r.employee_id.lower())
        if p is None:
            created += 1
            if not dry_run:
                db.add(Passenger(employee_id=r.employee_id, name=r.name, department=r.department, phone=r.phone))
            continue
        new = {"name": r.name, "department": r.department or p.department, "phone": r.phone or p.phone}
        if all(getattr(p, k) == v for k, v in new.items()):
            unchanged += 1
            continue
        updated += 1
        if not dry_run:
            for k, v in new.items():
                setattr(p, k, v)
    result = {"dry_run": dry_run, "created": created, "updated": updated, "unchanged": unchanged,
              "skipped": len(parsed.errors), "errors": parsed.errors}
    if not dry_run:
        log_event(db, request, "passengers_imported", f"admin:{admin.username}",
                  detail={"file": (file.filename or "")[:120], **{k: result[k] for k in ("created", "updated", "unchanged", "skipped")}})
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise api_error(409, "IMPORT_CONFLICT", "Someone changed the list while importing. Please try again.")
    return result
