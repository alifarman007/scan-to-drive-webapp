"""Admin dashboard, trip history, trip detail with photos and timeline, audit log (PDF 11.1, 11.2, section 15).

Read-only. Admins and viewers may use everything here except the audit log (admin only, as in the PDF API table)."""
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import Date, Text, and_, cast, func, or_, select
from sqlalchemy.orm import Session, contains_eager

from app.deps import current_admin_user, get_db, require_admin
from app.errors import api_error
from app.models import (
    AdminUser, Alert, AlertStatus, Driver, OPEN_TRIP_STATUSES, Passenger, Trip, TripEvent, TripPhoto,
    TripStage, TripStatus, Vehicle, VehicleStatus,
)
from app.routers.admin_alerts import alert_out
from app.routers.passenger import _send_photo
from app.schemas import trip_out
from app.security import photo_link_valid, sign_photo_link
from app.services.timeutil import SQL_TZ, day_start_utc, preset_range, range_bounds, today_local
from app.storage import PhotoStorage, get_storage

router = APIRouter(prefix="/admin", tags=["admin: dashboard and history"])

DONE = (TripStatus.completed, TripStatus.closed_by_admin)  # trips whose km count in the totals
WAITING = (TripStatus.waiting_for_passenger, TripStatus.waiting_for_end_confirm)

EVENT_LABELS = {
    "trip_started": "Driver started the trip",
    "trip_started_unconfirmed": "Driver started the trip (passenger could not scan)",
    "journey_started": "Passenger confirmed the start",
    "trip_end_submitted": "Driver ended the trip",
    "trip_completed": "Trip completed",
    "trip_completed_unconfirmed": "Trip completed (passenger could not scan)",
    "trip_cancelled": "Trip cancelled",
    "trip_closed_by_admin": "Admin closed the trip",
    "trip_unlocked": "Admin unlocked the trip",
    "trip_approved": "Admin approved the trip",
    "trip_rejected": "Admin rejected the trip",
    "start_qr_renewed": "New Start QR made",
    "end_qr_renewed": "New End QR made",
    "passenger_lookup": "Passenger looked up an employee ID",
    "passenger_wrong_id": "Wrong ID entered",
    "qr_blocked": "QR blocked after too many wrong IDs",
    "alert_solved": "Alert marked as solved",
}


def _minutes_since(t: datetime | None, now: datetime) -> int | None:
    return int((now - t).total_seconds() // 60) if t else None


def _live_trip(t: Trip, now: datetime) -> dict:
    row = trip_out(t)
    row.update(
        vehicle_id=t.vehicle_id, driver_id=t.driver_id, driver_phone=t.driver.phone,
        department=t.passenger.department if t.passenger else None,
        minutes_running=_minutes_since(t.start_time, now),
    )
    return row


# ---- dashboard ---------------------------------------------------------------------------------

@router.get("/dashboard")
def dashboard(_: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db)):
    """Home page: summary cards, car status board, live trips, open alerts and two charts."""
    now = datetime.now(timezone.utc)
    today = today_local(now)
    day_start, day_end = range_bounds(today, today)
    month_start = day_start_utc(today.replace(day=1))

    open_trips = db.scalars(
        select(Trip).where(Trip.status.in_(OPEN_TRIP_STATUSES)).order_by(Trip.start_time, Trip.id)
    ).all()
    by_vehicle = {t.vehicle_id: t for t in open_trips}
    vehicles = db.scalars(select(Vehicle).order_by(Vehicle.car_code)).all()

    board = []
    for v in vehicles:
        t = by_vehicle.get(v.id)
        if t is not None:
            state = "on_trip" if t.status == TripStatus.in_progress else "waiting"
        elif v.status == VehicleStatus.maintenance:
            state = "maintenance"
        elif v.status == VehicleStatus.inactive:
            state = "inactive"
        else:
            state = "available"
        board.append({
            "id": v.id, "car_code": v.car_code, "model": v.model, "reg_number": v.reg_number,
            "current_km": v.current_km, "state": state, "vehicle_status": v.status.value,
            "trip": None if t is None else {
                "id": t.id, "trip_no": t.trip_no, "status": t.status.value, "driver_name": t.driver.name,
                "destination": t.destination, "start_time": t.start_time,
            },
        })

    trips_today = db.scalar(select(func.count()).select_from(Trip).where(
        Trip.start_time >= day_start, Trip.start_time < day_end, Trip.status != TripStatus.cancelled))
    km_today = db.scalar(select(func.coalesce(func.sum(Trip.distance_km), 0)).where(
        Trip.end_time >= day_start, Trip.end_time < day_end, Trip.status.in_(DONE)))
    open_alerts = db.scalar(select(func.count()).select_from(Alert).where(Alert.status == AlertStatus.open))

    cards = {
        "cars_on_trip": sum(1 for b in board if b["state"] == "on_trip"),
        "cars_available": sum(1 for b in board if b["state"] == "available"),
        "trips_waiting_confirm": sum(1 for t in open_trips if t.status in WAITING),
        "trips_today": trips_today, "km_today": km_today, "open_alerts": open_alerts,
    }

    recent_alerts = db.execute(
        select(Alert, Trip.trip_no, Vehicle.car_code)
        .outerjoin(Trip, Trip.id == Alert.trip_id).outerjoin(Vehicle, Vehicle.id == Alert.vehicle_id)
        .where(Alert.status == AlertStatus.open).order_by(Alert.created_at.desc(), Alert.id.desc()).limit(10)
    ).all()

    km_rows = dict(db.execute(
        select(Vehicle.car_code, func.coalesce(func.sum(Trip.distance_km), 0))
        .join(Trip, and_(Trip.vehicle_id == Vehicle.id, Trip.end_time >= month_start, Trip.status.in_(DONE)), isouter=True)
        .group_by(Vehicle.car_code)
    ).all())
    local_day = cast(func.timezone(SQL_TZ, Trip.start_time), Date)
    per_day = dict(db.execute(
        select(local_day, func.count()).where(Trip.start_time >= month_start, Trip.status != TripStatus.cancelled)
        .group_by(local_day)
    ).all())
    days = [today.replace(day=1).fromordinal(today.replace(day=1).toordinal() + i) for i in range(today.day)]

    return {
        "as_of": now, "today": today.isoformat(), "cards": cards, "car_board": board,
        "live_trips": [_live_trip(t, now) for t in open_trips],
        "alerts": [alert_out(a, tn, cc) for a, tn, cc in recent_alerts],
        "charts": {
            "km_per_car_this_month": [{"car_code": c, "km": int(km_rows.get(c, 0))} for c in sorted(km_rows)],
            "trips_per_day_this_month": [{"date": d.isoformat(), "trips": per_day.get(d, 0)} for d in days],
        },
    }


# ---- trip history ------------------------------------------------------------------------------

def _filtered(stmt, *, q, status, car_id, driver_id, department, approval, needs_review, start, end):
    if start is not None:
        stmt = stmt.where(Trip.start_time >= start)
    if end is not None:
        stmt = stmt.where(Trip.start_time < end)
    if status:
        stmt = stmt.where(Trip.status == status)
    if car_id:
        stmt = stmt.where(Trip.vehicle_id == car_id)
    if driver_id:
        stmt = stmt.where(Trip.driver_id == driver_id)
    if department:
        stmt = stmt.where(func.lower(Passenger.department) == department.strip().lower())
    if approval:
        stmt = stmt.where(Trip.approval_status == approval)
    if needs_review is not None:
        stmt = stmt.where(Trip.needs_review == needs_review)
    if q and q.strip():
        term = q.strip()
        stmt = stmt.where(or_(*[c.icontains(term, autoescape=True) for c in (
            Trip.trip_no, Driver.name, Driver.employee_id, Vehicle.car_code, Vehicle.reg_number,
            Passenger.name, Passenger.employee_id, Trip.visitor_name, Trip.visitor_phone,
            Trip.start_place, Trip.destination, Trip.purpose)]))
    return stmt


@router.get("/trips")
def trip_history(
    q: str | None = Query(None, max_length=100, description="search trip no, car, driver, passenger, visitor, places, purpose"),
    range: Literal["today", "week", "month"] | None = None,
    date_from: date | None = None, date_to: date | None = None,
    status: TripStatus | None = None, car_id: int | None = None, driver_id: int | None = None,
    department: str | None = Query(None, max_length=120),
    approval: Literal["pending", "approved", "rejected"] | None = None,
    needs_review: bool | None = None,
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
    _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db),
):
    """Trip history, newest first, with filters. Dates are Bangladesh dates and apply to the trip's start time;
    `range` is a shortcut (week starts on Sunday) and is ignored when date_from / date_to are given."""
    if date_from and date_to and date_from > date_to:
        raise api_error(422, "BAD_DATE_RANGE", "date_from must not be after date_to")
    if range and not (date_from or date_to):
        date_from, date_to = preset_range(range, today_local())
    start, end = range_bounds(date_from, date_to)
    flt = dict(q=q, status=status, car_id=car_id, driver_id=driver_id, department=department,
               approval=approval, needs_review=needs_review, start=start, end=end)

    base = select(Trip).join(Driver, Driver.id == Trip.driver_id).join(Vehicle, Vehicle.id == Trip.vehicle_id) \
        .outerjoin(Passenger, Passenger.id == Trip.passenger_id)
    sums = _filtered(
        select(func.count(), func.coalesce(func.sum(Trip.distance_km), 0)).select_from(Trip)
        .join(Driver, Driver.id == Trip.driver_id).join(Vehicle, Vehicle.id == Trip.vehicle_id)
        .outerjoin(Passenger, Passenger.id == Trip.passenger_id), **flt)
    total, total_km = db.execute(sums).one()

    rows = db.scalars(
        _filtered(base, **flt)
        .options(contains_eager(Trip.driver), contains_eager(Trip.vehicle), contains_eager(Trip.passenger))
        .order_by(Trip.start_time.desc(), Trip.id.desc()).limit(limit).offset(offset)
    ).unique().all()
    now = datetime.now(timezone.utc)
    return {"total": total, "total_km": int(total_km), "limit": limit, "offset": offset,
            "trips": [_live_trip(t, now) for t in rows]}


@router.get("/trips/{trip_id}")
def trip_detail(
    trip_id: int, _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db),
):
    """Everything about one trip: details, people, map points, start/end photo links (valid 10 minutes),
    timeline of every step, and its alerts."""
    t = db.get(Trip, trip_id)
    if t is None:
        raise api_error(404, "TRIP_NOT_FOUND", "Trip not found")
    now = datetime.now(timezone.utc)

    kinds = set(db.scalars(select(TripPhoto.kind).where(TripPhoto.trip_id == t.id)).all())
    photos = {k.value: {"url": sign_photo_link(t.id, k.value) if k in kinds else None} for k in TripStage}

    events = db.scalars(
        select(TripEvent).where(TripEvent.trip_id == t.id).order_by(TripEvent.created_at, TripEvent.id)
    ).all()
    alerts = db.execute(
        select(Alert, Trip.trip_no, Vehicle.car_code)
        .outerjoin(Trip, Trip.id == Alert.trip_id).outerjoin(Vehicle, Vehicle.id == Alert.vehicle_id)
        .where(Alert.trip_id == t.id).order_by(Alert.created_at, Alert.id)
    ).all()

    row = _live_trip(t, now)
    if t.status not in OPEN_TRIP_STATUSES:
        row["minutes_running"] = None
    row.update(
        driver={"id": t.driver.id, "employee_id": t.driver.employee_id, "name": t.driver.name, "phone": t.driver.phone},
        passenger=None if t.passenger is None else {
            "id": t.passenger.id, "employee_id": t.passenger.employee_id, "name": t.passenger.name,
            "department": t.passenger.department},
        visitor=None if not t.is_visitor else {"name": t.visitor_name, "phone": t.visitor_phone, "reason": t.visitor_reason},
        vehicle={"id": t.vehicle.id, "car_code": t.vehicle.car_code, "model": t.vehicle.model,
                 "reg_number": t.vehicle.reg_number},
        map_points={
            "start": None if t.start_lat is None else {"lat": float(t.start_lat), "lng": float(t.start_lng)},
            "end": None if t.end_lat is None else {"lat": float(t.end_lat), "lng": float(t.end_lng)},
        },
        photos=photos,
        approved_by=t.approved_by,
    )
    return {
        "trip": row,
        "timeline": [{
            "id": e.id, "at": e.created_at, "event": e.event, "label": EVENT_LABELS.get(e.event, e.event),
            "actor": e.actor, "ip": e.ip, "device": e.device,
            "lat": None if e.lat is None else float(e.lat), "lng": None if e.lng is None else float(e.lng),
            "detail": e.detail,
        } for e in events],
        "alerts": [alert_out(a, tn, cc) for a, tn, cc in alerts],
    }


@router.get("/photos/{trip_id}/{kind}")
def admin_photo(
    trip_id: int, kind: TripStage, exp: int, sig: str,
    db: Session = Depends(get_db), storage: PhotoStorage = Depends(get_storage),
):
    """Dashboard photo behind a short-lived signed link (made by the trip detail). No sign-in header needed,
    so it works in an <img> tag; the link stops working after 10 minutes."""
    if not photo_link_valid(trip_id, kind.value, exp, sig):
        raise api_error(403, "LINK_EXPIRED", "This photo link is not valid any more. Open the trip again.")
    return _send_photo(db, storage, trip_id, kind)


# ---- audit log ---------------------------------------------------------------------------------

def audit_filters(q, event, actor, trip_id, date_from, date_to) -> list:
    """WHERE parts shared by the audit log list and its Excel/PDF export."""
    if date_from and date_to and date_from > date_to:
        raise api_error(422, "BAD_DATE_RANGE", "date_from must not be after date_to")
    start, end = range_bounds(date_from, date_to)
    where = []
    if start is not None:
        where.append(TripEvent.created_at >= start)
    if end is not None:
        where.append(TripEvent.created_at < end)
    if event:
        where.append(TripEvent.event == event)
    if actor:
        where.append(TripEvent.actor.icontains(actor.strip(), autoescape=True))
    if trip_id:
        where.append(TripEvent.trip_id == trip_id)
    if q and q.strip():
        term = q.strip()
        where.append(or_(
            TripEvent.event.icontains(term, autoescape=True), TripEvent.actor.icontains(term, autoescape=True),
            TripEvent.ip.icontains(term, autoescape=True), TripEvent.device.icontains(term, autoescape=True),
            cast(TripEvent.detail, Text).icontains(term, autoescape=True)))
    return where


@router.get("/audit")
def audit_log(
    q: str | None = Query(None, max_length=100, description="search event, actor, IP, device and details"),
    event: str | None = Query(None, max_length=80), actor: str | None = Query(None, max_length=120),
    trip_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
    _: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Every action in the system, newest first (read only, admin only). Dates are Bangladesh dates."""
    where = audit_filters(q, event, actor, trip_id, date_from, date_to)
    total = db.scalar(select(func.count()).select_from(TripEvent).where(*where))
    rows = db.execute(
        select(TripEvent, Trip.trip_no).outerjoin(Trip, Trip.id == TripEvent.trip_id).where(*where)
        .order_by(TripEvent.created_at.desc(), TripEvent.id.desc()).limit(limit).offset(offset)
    ).all()
    return {"total": total, "limit": limit, "offset": offset, "events": [{
        "id": e.id, "at": e.created_at, "event": e.event, "label": EVENT_LABELS.get(e.event, e.event),
        "actor": e.actor, "trip_id": e.trip_id, "trip_no": tn, "ip": e.ip, "device": e.device,
        "lat": None if e.lat is None else float(e.lat), "lng": None if e.lng is None else float(e.lng),
        "detail": e.detail,
    } for e, tn in rows]}
