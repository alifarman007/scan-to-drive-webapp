"""Background checks that raise alerts (PDF 11.4). Run once a minute by the worker (app/worker.py).

Each check is safe to run again and again: it raises an alert only once per trip (and once per waiting stage).
The 'reminder to the driver' is shown in the driver's app: GET /trips/active lists the open reminders of the trip.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Alert, AlertStatus, AlertType, Trip, TripStatus
from app.services import settings as app_settings


def _already_alerted(db: Session, trip_id: int, kind: AlertType, since: datetime | None = None) -> bool:
    stmt = select(Alert.id).where(Alert.trip_id == trip_id, Alert.type == kind)
    if since is not None:  # waiting alerts: one per waiting stage, so only count alerts made in this stage
        stmt = stmt.where(Alert.created_at >= since)
    return db.scalar(stmt.limit(1)) is not None


def _minutes(delta: timedelta) -> int:
    return int(delta.total_seconds() // 60)


def _long_trips(db: Session, now: datetime) -> int:
    limit = timedelta(hours=app_settings.get_int(db, "long_trip_hours"))
    began = func.coalesce(Trip.journey_start_time, Trip.start_time)
    trips = db.scalars(
        select(Trip).where(Trip.status == TripStatus.in_progress, began <= now - limit).with_for_update(skip_locked=True)
    ).all()
    raised = 0
    for t in trips:
        if _already_alerted(db, t.id, AlertType.long_trip):
            continue
        since = t.journey_start_time or t.start_time
        db.add(Alert(
            trip_id=t.id, vehicle_id=t.vehicle_id, type=AlertType.long_trip, created_at=now,
            message=f"{t.vehicle.car_code} trip {t.trip_no} ({t.driver.name}) has been in progress for "
                    f"{_minutes(now - since) // 60} h {_minutes(now - since) % 60} min. Has the driver forgotten to end it?",
        ))
        raised += 1
    return raised


def _waiting_too_long(db: Session, now: datetime) -> int:
    limit = timedelta(minutes=app_settings.get_int(db, "waiting_too_long_minutes"))
    raised = 0
    stages = (
        (TripStatus.waiting_for_passenger, Trip.start_time, "the passenger to confirm the start"),
        (TripStatus.waiting_for_end_confirm, Trip.end_time, "the passenger to confirm the end"),
    )
    for status, since_col, what in stages:
        trips = db.scalars(
            select(Trip).where(Trip.status == status, since_col <= now - limit).with_for_update(skip_locked=True)
        ).all()
        for t in trips:
            since = t.start_time if status == TripStatus.waiting_for_passenger else t.end_time
            if _already_alerted(db, t.id, AlertType.waiting_too_long, since):
                continue
            db.add(Alert(
                trip_id=t.id, vehicle_id=t.vehicle_id, type=AlertType.waiting_too_long, created_at=now,
                message=f"{t.vehicle.car_code} trip {t.trip_no} ({t.driver.name}) has been waiting for {what} "
                        f"for {_minutes(now - since)} minutes.",
            ))
            raised += 1
    return raised


def run_checks(db: Session, now: datetime | None = None) -> dict:
    """Run every check and commit. Returns how many alerts each check raised."""
    now = now or datetime.now(timezone.utc)
    result = {"long_trip": _long_trips(db, now), "waiting_too_long": _waiting_too_long(db, now)}
    db.commit()
    return result


def driver_reminders(db: Session, trip: Trip) -> list[dict]:
    """Open reminders for the driver's trip (shown in the app until the trip moves on or the admin solves the alert)."""
    out = []
    if trip.status == TripStatus.in_progress:
        kind, since, text = AlertType.long_trip, None, "This trip has been running for a long time. Please end it when you arrive."
    elif trip.status == TripStatus.waiting_for_passenger:
        kind, since, text = AlertType.waiting_too_long, trip.start_time, "Still waiting for the passenger. Make a new QR, or tap 'Passenger can't scan', or cancel."
    elif trip.status == TripStatus.waiting_for_end_confirm:
        kind, since, text = AlertType.waiting_too_long, trip.end_time, "Still waiting for the passenger to confirm the end. Make a new QR or tap 'Passenger can't scan'."
    else:
        return out
    stmt = select(Alert).where(Alert.trip_id == trip.id, Alert.type == kind, Alert.status == AlertStatus.open)
    if since is not None:
        stmt = stmt.where(Alert.created_at >= since)
    alert = db.scalar(stmt.order_by(Alert.created_at.desc()).limit(1))
    if alert is not None:
        out.append({"type": kind.value, "message": text, "since": alert.created_at})
    return out
