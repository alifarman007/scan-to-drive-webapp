"""Import trips from the old travel-log forms (hidden admin page /admin/import).

1. POST .../preview with the Driver Travel Log CSV (and the Passenger Travel Log CSV): every trip found, with what
   is wrong or worth a look. Nothing is saved.
2. POST ... with the same files and the admin's choices (which trips, and the driver where the name was not clear):
   saves them as completed trips marked "imported" (no photos, no QR confirmations, no alerts).
3. An import can be undone as a whole (DELETE .../batches/{batch}).

Admins only. Every import and undo is in the audit log."""
import json
import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import get_db, require_admin
from app.errors import api_error
from app.models import AdminUser, Driver, Passenger, Trip, TripEvent, TripReview, TripStatus, Vehicle
from app.services.audit import log_event
from app.services.old_trips import MAX_BYTES, OldLogError, OldTrip, read_old_logs

router = APIRouter(prefix="/admin/import", tags=["admin: import old trips"])


def _read(upload: UploadFile | None) -> bytes | None:
    if upload is None:
        return None
    data = upload.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise api_error(413, "FILE_TOO_LARGE", "The file is larger than 5 MB")
    return data


def _preview(db: Session, driver_log: UploadFile, passenger_log: UploadFile | None):
    try:
        return read_old_logs(db, _read(driver_log) or b"", _read(passenger_log))
    except OldLogError as e:
        raise api_error(422, "BAD_OLD_LOG", str(e))


def _person(d: Driver | None) -> dict | None:
    return None if d is None else {"id": d.id, "name": d.name, "employee_id": d.employee_id}


def _trip_row(t: OldTrip) -> dict:
    p = t.passenger
    return {
        "key": t.key, "rows": [t.start_row, t.end_row],
        "car": None if t.car is None else {"id": t.car.id, "car_code": t.car.car_code, "reg_number": t.car.reg_number,
                                           "owner": t.car.owner.value},
        "plate_text": t.plate_text,
        "driver_text": t.driver_text, "driver": _person(t.driver), "driver_choices": [_person(d) for d in t.driver_choices],
        "start_time": t.start_time, "end_time": t.end_time,
        "start_place": t.start_place, "destination": t.destination, "end_place": t.end_place,
        "start_km": t.start_km, "end_km": t.end_km, "distance": t.distance,
        "passenger": None if p is None else {"kind": p.kind, "employee_id": p.employee_id, "typed": p.typed_ids,
                                             "rating": p.rating, "comment": p.comment},
        "problems": t.problems, "warnings": t.warnings, "looks_like_test": t.looks_like_test, "already": t.already,
    }


@router.post("/old-trips/preview")
def preview(
    driver_log: Annotated[UploadFile, File(description="Driver Travel Log, exported as CSV")],
    passenger_log: Annotated[UploadFile | None, File(description="Passenger Travel Log, exported as CSV (optional)")] = None,
    _: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    pv = _preview(db, driver_log, passenger_log)
    drivers = db.scalars(select(Driver).order_by(Driver.name)).all()
    return {
        "trips": [_trip_row(t) for t in pv.trips],
        "skipped": pv.skipped,
        "drivers": [_person(d) for d in drivers],  # for choosing the driver where the name was not clear
    }


def _note(t: OldTrip) -> str | None:
    """What the trip's purpose says about a passenger the app cannot link (no valid 7-digit ID)."""
    p = t.passenger
    if p is None:
        return None
    others = [x for x in p.typed_ids if x != p.employee_id]
    if p.employee_id:
        return f"Old form. Also typed: {', '.join(others)}" if others else None
    if others:
        return f"Old form. Passenger ID typed: {', '.join(others)}"
    return "Old form. Passenger: not an Epic employee" if p.kind.lower().startswith("other") else "Old form. Passenger not named"


@router.post("/old-trips")
def import_trips(
    request: Request,
    driver_log: Annotated[UploadFile, File()],
    choices: Annotated[str, Form(description='JSON: {"include": ["drv:154-168", ...], "drivers": {"drv:44-45": 12}}')],
    passenger_log: Annotated[UploadFile | None, File()] = None,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    try:
        picked = json.loads(choices)
        include = set(picked.get("include") or [])
        chosen = {str(k): int(v) for k, v in (picked.get("drivers") or {}).items()}
    except (ValueError, TypeError, AttributeError):
        raise api_error(422, "BAD_CHOICES", "choices must be JSON with include and drivers")
    if not include:
        raise api_error(422, "NOTHING_CHOSEN", "Choose at least one trip to import")

    pv = _preview(db, driver_log, passenger_log)
    drivers = {d.id: d for d in db.scalars(select(Driver))}
    batch = datetime.now(timezone.utc).strftime("%Y%m%d%H%M") + "-" + secrets.token_hex(3)
    km_before: dict[int, int] = {}
    made, refused = [], []

    for t in pv.trips:
        if t.key not in include:
            continue
        if t.key in chosen:  # the admin chose the driver for an unclear name
            d = drivers.get(chosen[t.key])
            if d is None:
                refused.append({"key": t.key, "reason": "Driver not found"})
                continue
            t.driver = d
            t.problems = [x for x in t.problems if "could be" not in x and "not found" not in x]
        if t.already:
            refused.append({"key": t.key, "reason": f"Already imported as {t.already}"})
            continue
        if t.problems:
            refused.append({"key": t.key, "reason": "; ".join(t.problems)})
            continue

        p = t.passenger
        passenger = None
        if p and p.employee_id:
            passenger = db.scalar(select(Passenger).where(func.upper(Passenger.employee_id) == p.employee_id.upper()))
            if passenger is None:
                passenger = Passenger(employee_id=p.employee_id)
                db.add(passenger)
                db.flush()
        with_passenger = p is not None
        note = _note(t)
        trip = Trip(
            vehicle_id=t.car.id, driver_id=t.driver.id, passenger_id=passenger.id if passenger else None,
            with_passenger=with_passenger,
            purpose=note if with_passenger else "Not recorded (old form)",
            start_km=t.start_km, end_km=t.end_km, distance_km=t.distance,
            start_place=t.start_place[:255], destination=(t.destination or t.end_place or "-")[:255], end_place=t.end_place[:255] or None,
            start_time=t.start_time, journey_start_time=t.start_time, end_time=t.end_time,
            status=TripStatus.completed, import_batch=batch, import_key=t.key,
        )
        db.add(trip)
        db.flush()
        if p and p.rating:
            db.add(TripReview(trip_id=trip.id, rating=p.rating, comment=(p.comment or None), created_at=t.end_time))
        car = db.get(Vehicle, t.car.id)
        km_before.setdefault(car.id, car.current_km)
        if t.end_km > car.current_km:  # the car's km only moves forward
            car.current_km = t.end_km
        made.append(trip)

    if not made:  # nothing was added (passengers are only saved together with their trip)
        raise api_error(422, "NOTHING_IMPORTED", "None of the chosen trips could be imported", refused=refused)
    log_event(db, request, "old_trips_imported", f"admin:{admin.username}", detail={
        "batch": batch, "file": (driver_log.filename or "")[:120], "trips": len(made),
        "km_before": {str(k): v for k, v in km_before.items()}, "refused": len(refused)})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "IMPORT_CONFLICT", "Some of these trips were imported at the same moment. Load the preview again.")
    return {"batch": batch, "imported": len(made), "km": sum(x.distance_km or 0 for x in made),
            "first": min(x.start_time for x in made), "last": max(x.start_time for x in made), "refused": refused}


@router.get("/batches")
def batches(_: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    """Earlier imports that still have trips, newest first."""
    rows = db.execute(
        select(Trip.import_batch, func.count(), func.coalesce(func.sum(Trip.distance_km), 0), func.min(Trip.start_time), func.max(Trip.start_time))
        .where(Trip.import_batch.is_not(None)).group_by(Trip.import_batch)
    ).all()
    events = {e.detail.get("batch"): e for e in db.scalars(select(TripEvent).where(TripEvent.event == "old_trips_imported"))}
    out = []
    for b, n, km, first, last in rows:
        e = events.get(b)
        out.append({"batch": b, "trips": n, "km": int(km), "first": first, "last": last,
                    "at": e.created_at if e else None, "by": (e.actor or "").removeprefix("admin:") if e else None,
                    "file": e.detail.get("file") if e else None})
    out.sort(key=lambda x: x["at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return {"batches": out}


@router.delete("/batches/{batch}")
def undo(batch: str, request: Request, admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    """Remove every trip of one import (and their ratings). Each car's km goes back to what it was before, or to
    the highest end km of the trips it still has."""
    trips = db.scalars(select(Trip).where(Trip.import_batch == batch).with_for_update()).all()
    if not trips:
        raise api_error(404, "BATCH_NOT_FOUND", "No trips from this import")
    ev = db.scalar(select(TripEvent).where(TripEvent.event == "old_trips_imported", TripEvent.detail["batch"].astext == batch))
    before = {int(k): v for k, v in ((ev.detail if ev else {}).get("km_before") or {}).items()}
    car_ids = {t.vehicle_id for t in trips}
    ids = [t.id for t in trips]
    db.execute(TripReview.__table__.delete().where(TripReview.trip_id.in_(ids)))
    db.execute(Trip.__table__.delete().where(Trip.id.in_(ids)))
    for cid in car_ids:
        car = db.get(Vehicle, cid)
        highest = db.scalar(select(func.max(Trip.end_km)).where(Trip.vehicle_id == cid)) or 0
        car.current_km = max(before.get(cid, 0), highest)
    log_event(db, request, "old_trips_undone", f"admin:{admin.username}", detail={"batch": batch, "trips": len(ids)})
    db.commit()
    return {"batch": batch, "removed": len(ids)}
