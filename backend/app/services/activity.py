"""Small per-car / per-driver numbers for the admin detail pages: km per day (last 30 days) and passenger ratings."""
from datetime import timedelta

from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.models import Trip, TripReview, TripStatus
from app.services.timeutil import SQL_TZ, day_start_utc, today_local

DONE = (TripStatus.completed, TripStatus.closed_by_admin)


def km_by_day(db: Session, *where, days: int = 30) -> list[dict]:
    """Km driven and trips per local day for the last `days` days (today included), oldest first. Every day is listed."""
    today = today_local()
    first = today - timedelta(days=days - 1)
    local_day = cast(func.timezone(SQL_TZ, Trip.start_time), Date)
    rows = db.execute(
        select(local_day, func.count(), func.coalesce(func.sum(Trip.distance_km).filter(Trip.status.in_(DONE)), 0))
        .where(*where, Trip.start_time >= day_start_utc(first), Trip.status != TripStatus.cancelled)
        .group_by(local_day)
    ).all()
    found = {d: (n, int(km)) for d, n, km in rows}
    out = []
    for i in range(days):
        d = first + timedelta(days=i)
        n, km = found.get(d, (0, 0))
        out.append({"date": d.isoformat(), "trips": n, "km": km})
    return out


def ratings_by(db: Session, column, ids: list[int]) -> dict[int, dict]:
    """Average passenger rating and count per car or driver (column = Trip.vehicle_id or Trip.driver_id)."""
    if not ids:
        return {}
    rows = db.execute(
        select(column, func.avg(TripReview.rating), func.count())
        .select_from(TripReview).join(Trip, Trip.id == TripReview.trip_id)
        .where(column.in_(ids)).group_by(column)
    ).all()
    return {k: {"average": round(float(avg), 1), "count": n} for k, avg, n in rows}
