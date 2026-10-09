"""The seven ready reports (PDF 11.3). Each report is built in Python from the trip rows, so the same
numbers go to the screen (JSON), to Excel and to PDF.

Dates are Bangladesh dates and apply to the trip's start time (alerts: the time the alert was made).
If no date is given the report covers the current month. Times in the rows are already written in
Bangladesh time, ready to show."""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.config import settings as app_settings
from app.models import (
    Alert, AlertStatus, AlertType, Driver, OPEN_TRIP_STATUSES, Passenger, Trip, TripStatus, Vehicle,
)
from app.services.timeutil import LOCAL_TZ, range_bounds, today_local

DONE = (TripStatus.completed, TripStatus.closed_by_admin)  # trips whose km count


@dataclass
class Column:
    key: str
    label: str
    pdf: bool = True  # False = too wide for the PDF page, kept in Excel / JSON only


@dataclass
class Section:
    title: str | None
    columns: list[Column]
    rows: list[dict]


@dataclass
class Report:
    name: str
    title: str
    date_from: date
    date_to: date
    filters: dict[str, str] = field(default_factory=dict)
    summary: list[tuple[str, object]] = field(default_factory=list)
    sections: list[Section] = field(default_factory=list)

    @property
    def row_count(self) -> int:
        return sum(len(s.rows) for s in self.sections)

    def to_json(self) -> dict:
        return {
            "name": self.name, "title": self.title,
            "period": {"from": self.date_from.isoformat(), "to": self.date_to.isoformat()},
            "filters": self.filters,
            "summary": [{"label": k, "value": v} for k, v in self.summary],
            "sections": [{
                "title": s.title, "columns": [{"key": c.key, "label": c.label} for c in s.columns],
                "rows": s.rows,
            } for s in self.sections],
        }


@dataclass
class Filters:
    date_from: date
    date_to: date
    car_id: int | None = None
    driver_id: int | None = None
    department: str | None = None

    @property
    def bounds(self):
        return range_bounds(self.date_from, self.date_to)

    def describe(self, db: Session) -> dict[str, str]:
        out = {}
        if self.car_id:
            v = db.get(Vehicle, self.car_id)
            out["Car"] = v.car_code if v else f"#{self.car_id}"
        if self.driver_id:
            d = db.get(Driver, self.driver_id)
            out["Driver"] = f"{d.name} ({d.employee_id})" if d else f"#{self.driver_id}"
        if self.department:
            out["Department"] = self.department
        return out


def default_dates(date_from: date | None, date_to: date | None, today: date | None = None) -> tuple[date, date]:
    today = today or today_local()
    if date_from is None and date_to is None:
        return today.replace(day=1), today
    if date_from is None:
        return date_to.replace(day=1), date_to
    return date_from, date_to or today


# ---- small helpers ---------------------------------------------------------------------------------

def fmt_dt(t: datetime | None) -> str:
    return t.astimezone(LOCAL_TZ).strftime("%Y-%m-%d %H:%M") if t else ""


def _minutes(t: Trip) -> int | None:
    if t.end_time is None:
        return None
    return int((t.end_time - t.start_time).total_seconds() // 60)


def _who(t: Trip) -> tuple[str, str, str]:
    """(passenger name, passenger id, department) for a trip; visitors and 'no passenger' are named as such."""
    if t.is_visitor:
        return f"{t.visitor_name} (visitor)", "VISITOR", "Visitor"
    if t.passenger is not None:
        return t.passenger.name, t.passenger.employee_id, t.passenger.department or "(no department)"
    return "(no passenger)", "", "(no passenger)"


def _trips(db: Session, f: Filters) -> list[Trip]:
    start, end = f.bounds
    stmt = (
        select(Trip).join(Driver, Driver.id == Trip.driver_id).join(Vehicle, Vehicle.id == Trip.vehicle_id)
        .outerjoin(Passenger, Passenger.id == Trip.passenger_id)
        .options(joinedload(Trip.driver), joinedload(Trip.vehicle), joinedload(Trip.passenger))
        .where(Trip.start_time >= start, Trip.start_time < end)
        .order_by(Trip.start_time, Trip.id)
    )
    if f.car_id:
        stmt = stmt.where(Trip.vehicle_id == f.car_id)
    if f.driver_id:
        stmt = stmt.where(Trip.driver_id == f.driver_id)
    if f.department:
        stmt = stmt.where(func.lower(Passenger.department) == f.department.strip().lower())
    return list(db.scalars(stmt).unique())


def _new(name: str, title: str, f: Filters, db: Session) -> Report:
    return Report(name=name, title=title, date_from=f.date_from, date_to=f.date_to, filters=f.describe(db))


def _pct(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


# ---- 1. car usage ------------------------------------------------------------------------------------

def car_usage(db: Session, f: Filters) -> Report:
    r = _new("car_usage", "Car usage", f, db)
    trips = [t for t in _trips(db, f) if t.status != TripStatus.cancelled]
    by_car = defaultdict(list)
    for t in trips:
        by_car[t.vehicle_id].append(t)
    last_day = min(f.date_to, today_local())
    days_in_period = max((last_day - f.date_from).days + 1, 0)

    cars = db.scalars(select(Vehicle).order_by(Vehicle.car_code)).all()
    rows = []
    for v in cars:
        if f.car_id and v.id != f.car_id:
            continue
        ts = by_car.get(v.id, [])
        done = [t for t in ts if t.status in DONE]
        km = sum(t.distance_km or 0 for t in done)
        minutes = sum(_minutes(t) or 0 for t in done)
        active_days = {t.start_time.astimezone(LOCAL_TZ).date() for t in ts}
        rows.append({
            "car_code": v.car_code, "reg_number": v.reg_number, "model": v.model, "trips": len(ts), "km": km,
            "hours_used": round(minutes / 60, 1), "days_used": len(active_days),
            "idle_days": max(days_in_period - len(active_days), 0),
            "km_per_trip": round(km / len(done), 1) if done else 0,
        })
    rows.sort(key=lambda x: (-x["km"], x["car_code"]))
    r.summary = [("Cars", len(rows)), ("Trips", sum(x["trips"] for x in rows)), ("Total km", sum(x["km"] for x in rows))]
    r.sections = [Section(None, [
        Column("car_code", "Car"), Column("reg_number", "Reg. number"), Column("model", "Model"),
        Column("trips", "Trips"), Column("km", "Total km"), Column("hours_used", "Hours used"),
        Column("days_used", "Days used"), Column("idle_days", "Idle days"), Column("km_per_trip", "Km per trip"),
    ], rows)]
    return r


# ---- 2. drivers --------------------------------------------------------------------------------------

def driver_report(db: Session, f: Filters) -> Report:
    r = _new("drivers", "Driver report", f, db)
    trips = _trips(db, f)
    by_driver = defaultdict(list)
    for t in trips:
        by_driver[t.driver_id].append(t)
    alert_counts: dict[int, int] = defaultdict(int)
    ids = [t.id for t in trips]
    if ids:
        for trip_id in db.scalars(select(Alert.trip_id).where(Alert.trip_id.in_(ids))):
            alert_counts[trip_id] += 1
    trip_driver = {t.id: t.driver_id for t in trips}
    per_driver_alerts: dict[int, int] = defaultdict(int)
    for tid, n in alert_counts.items():
        per_driver_alerts[trip_driver[tid]] += n

    rows = []
    for d in db.scalars(select(Driver).order_by(Driver.name)):
        if f.driver_id and d.id != f.driver_id:
            continue
        ts = by_driver.get(d.id, [])
        real = [t for t in ts if t.status != TripStatus.cancelled]
        done = [t for t in real if t.status in DONE]
        mins = [m for m in (_minutes(t) for t in done) if m is not None]
        rows.append({
            "employee_id": d.employee_id, "name": d.name, "trips": len(real),
            "km": sum(t.distance_km or 0 for t in done),
            "avg_trip_minutes": round(sum(mins) / len(mins)) if mins else 0,
            "cancelled": len(ts) - len(real), "alerts": per_driver_alerts.get(d.id, 0),
        })
    rows = [x for x in rows if x["trips"] or x["cancelled"] or not (f.car_id or f.department)]
    rows.sort(key=lambda x: (-x["km"], x["name"]))
    r.summary = [("Drivers", len(rows)), ("Trips", sum(x["trips"] for x in rows)), ("Total km", sum(x["km"] for x in rows))]
    r.sections = [Section(None, [
        Column("employee_id", "Employee ID"), Column("name", "Driver"), Column("trips", "Trips"),
        Column("km", "Total km"), Column("avg_trip_minutes", "Average trip (min)"),
        Column("cancelled", "Cancelled trips"), Column("alerts", "Alerts"),
    ], rows)]
    return r


# ---- 3. passenger / department -----------------------------------------------------------------------

def passenger_department(db: Session, f: Filters) -> Report:
    r = _new("passenger_department", "Passenger and department", f, db)
    trips = [t for t in _trips(db, f) if t.status != TripStatus.cancelled]
    by_dept: dict[str, list[Trip]] = defaultdict(list)
    by_person: dict[tuple, list[Trip]] = defaultdict(list)
    for t in trips:
        name, emp, dept = _who(t)
        by_dept[dept].append(t)
        if t.passenger is not None:
            by_person[(emp, name, dept)].append(t)
        elif t.is_visitor:
            by_person[("VISITOR", f"{t.visitor_name} ({t.visitor_phone})", "Visitor")].append(t)

    def km(ts):
        return sum(t.distance_km or 0 for t in ts if t.status in DONE)

    total_km = sum(km(ts) for ts in by_dept.values())
    dept_rows = sorted(({
        "department": d, "trips": len(ts), "km": km(ts), "km_share_percent": _pct(km(ts), total_km)}
        for d, ts in by_dept.items()), key=lambda x: (-x["km"], x["department"]))
    person_rows = sorted(({
        "employee_id": e, "name": n, "department": d, "trips": len(ts), "km": km(ts)}
        for (e, n, d), ts in by_person.items()), key=lambda x: (-x["km"], x["name"]))
    r.summary = [("Trips", len(trips)), ("Total km", total_km), ("Departments", len(dept_rows))]
    r.sections = [
        Section("By department", [
            Column("department", "Department"), Column("trips", "Trips"), Column("km", "Total km"),
            Column("km_share_percent", "Share of km (%)")], dept_rows),
        Section("By passenger", [
            Column("employee_id", "Employee ID"), Column("name", "Passenger"), Column("department", "Department"),
            Column("trips", "Trips"), Column("km", "Total km")], person_rows),
    ]
    return r


# ---- 4. trip log -------------------------------------------------------------------------------------

def trip_log(db: Session, f: Filters) -> Report:
    r = _new("trip_log", "Trip log", f, db)
    base = app_settings.public_base_url.rstrip("/")
    rows = []
    for t in _trips(db, f):
        name, emp, dept = _who(t)
        rows.append({
            "trip_no": t.trip_no, "date": fmt_dt(t.start_time)[:10], "car_code": t.vehicle.car_code,
            "reg_number": t.vehicle.reg_number, "driver": t.driver.name, "driver_id": t.driver.employee_id,
            "passenger": name, "passenger_id": emp, "department": dept, "purpose": t.purpose or "",
            "start_place": t.start_place, "destination": t.destination, "end_place": t.end_place or "",
            "start_km": t.start_km, "end_km": t.end_km, "distance_km": t.distance_km,
            "start_time": fmt_dt(t.start_time), "end_time": fmt_dt(t.end_time), "minutes": _minutes(t),
            "status": t.status.value, "needs_review": "yes" if t.needs_review else "",
            "approval": t.approval_status or "", "note": t.close_reason or t.approval_note or "",
            "details_link": f"{base}/admin/trips/{t.id}",
        })
    done_km = sum(x["distance_km"] or 0 for x in rows)
    r.summary = [("Trips", len(rows)), ("Total km", done_km)]
    r.sections = [Section(None, [
        Column("trip_no", "Trip"), Column("date", "Date"), Column("car_code", "Car"),
        Column("reg_number", "Reg. number", pdf=False), Column("driver", "Driver"),
        Column("driver_id", "Driver ID", pdf=False), Column("passenger", "Passenger"),
        Column("passenger_id", "Passenger ID", pdf=False), Column("department", "Department"),
        Column("purpose", "Purpose", pdf=False), Column("start_place", "From", pdf=False),
        Column("destination", "Destination"), Column("end_place", "Ended at", pdf=False),
        Column("start_km", "Start km"), Column("end_km", "End km"), Column("distance_km", "Km"),
        Column("start_time", "Start time", pdf=False), Column("end_time", "End time", pdf=False),
        Column("minutes", "Minutes", pdf=False), Column("status", "Status"),
        Column("needs_review", "Review", pdf=False), Column("approval", "Approval", pdf=False),
        Column("note", "Note", pdf=False), Column("details_link", "Photos and details (admin page)", pdf=False),
    ], rows)]
    return r


# ---- 5. exceptions -----------------------------------------------------------------------------------

ALERT_LABELS = {
    AlertType.km_gap: "Km gap", AlertType.long_trip: "Long trip", AlertType.high_km: "High km",
    AlertType.wrong_ids: "Wrong IDs (QR blocked)", AlertType.waiting_too_long: "Waiting too long",
}


def exceptions(db: Session, f: Filters) -> Report:
    r = _new("exceptions", "Exceptions", f, db)
    rows = []
    for t in _trips(db, f):
        name, _, _ = _who(t)
        base = {"trip_no": t.trip_no, "car_code": t.vehicle.car_code, "driver": t.driver.name,
                "sort": t.start_time, "time": fmt_dt(t.start_time)}
        if t.status == TripStatus.cancelled:
            rows.append({**base, "type": "Cancelled trip", "details": t.close_reason or "", "status": t.status.value})
        elif t.status == TripStatus.closed_by_admin:
            rows.append({**base, "type": "Closed by admin", "details": t.close_reason or "", "status": t.status.value})
        elif t.needs_review:
            why = "; ".join(x for x in (t.start_no_scan_reason and f"start: {t.start_no_scan_reason}",
                                        t.end_no_scan_reason and f"end: {t.end_no_scan_reason}") if x)
            rows.append({**base, "type": "Needs review (passenger could not scan)", "details": why,
                         "status": t.approval_status or t.status.value})
        if t.status != TripStatus.cancelled and not t.with_passenger:
            rows.append({**base, "type": "No passenger", "details": t.purpose or "", "status": t.status.value})

    start, end = f.bounds
    stmt = (
        select(Alert, Trip, Vehicle).outerjoin(Trip, Trip.id == Alert.trip_id)
        .outerjoin(Vehicle, Vehicle.id == Alert.vehicle_id).outerjoin(Passenger, Passenger.id == Trip.passenger_id)
        .options(joinedload(Trip.driver))
        .where(Alert.created_at >= start, Alert.created_at < end, Alert.type != AlertType.admin_closed)
    )
    if f.car_id:
        stmt = stmt.where(Alert.vehicle_id == f.car_id)
    if f.driver_id:
        stmt = stmt.where(Trip.driver_id == f.driver_id)
    if f.department:
        stmt = stmt.where(func.lower(Passenger.department) == f.department.strip().lower())
    for a, t, v in db.execute(stmt).unique():
        rows.append({
            "type": ALERT_LABELS.get(a.type, a.type.value), "time": fmt_dt(a.created_at), "sort": a.created_at,
            "trip_no": t.trip_no if t else "", "car_code": v.car_code if v else "",
            "driver": t.driver.name if t else "", "details": a.message,
            "status": "open" if a.status == AlertStatus.open else "solved",
        })
    rows.sort(key=lambda x: x["sort"], reverse=True)
    for x in rows:
        del x["sort"]
    counts: dict[str, int] = defaultdict(int)
    for x in rows:
        counts[x["type"]] += 1
    r.summary = [("Exceptions", len(rows))] + sorted(counts.items())
    r.sections = [Section(None, [
        Column("type", "Type"), Column("time", "Time"), Column("trip_no", "Trip"), Column("car_code", "Car"),
        Column("driver", "Driver"), Column("status", "Status"), Column("details", "Details"),
    ], rows)]
    return r


# ---- 6. km continuity --------------------------------------------------------------------------------

def km_continuity(db: Session, f: Filters) -> Report:
    """Each trip's start km against the previous trip's end km of the same car (unrecorded use shows as a gap)."""
    r = _new("km_continuity", "Km continuity", f, db)
    start, end = f.bounds
    stmt = (
        select(Trip).options(joinedload(Trip.vehicle), joinedload(Trip.driver))
        .where(Trip.status != TripStatus.cancelled, Trip.start_time < end).order_by(Trip.vehicle_id, Trip.start_time, Trip.id)
    )
    if f.car_id:
        stmt = stmt.where(Trip.vehicle_id == f.car_id)
    rows, problems = [], 0
    prev: Trip | None = None
    for t in db.scalars(stmt).unique():
        if prev is not None and prev.vehicle_id != t.vehicle_id:
            prev = None
        in_range = t.start_time >= start and (not f.driver_id or t.driver_id == f.driver_id)
        if in_range:
            gap = result = None
            if prev is None:
                result = "First record for this car"
            elif prev.end_km is None:
                result = "Previous trip has no end km"
            else:
                gap = t.start_km - prev.end_km
                if gap == 0:
                    result = "OK"
                elif gap > 0:
                    result = f"Unrecorded use: {gap} km"
                else:
                    result = f"Odometer went back by {-gap} km"
            if gap:
                problems += 1
            rows.append({
                "car_code": t.vehicle.car_code, "trip_no": t.trip_no, "start_time": fmt_dt(t.start_time),
                "driver": t.driver.name, "previous_trip_no": prev.trip_no if prev else "",
                "previous_end_km": prev.end_km if prev else None, "start_km": t.start_km, "gap_km": gap,
                "result": result,
            })
        prev = t
    r.summary = [("Trips checked", len(rows)), ("Trips with a gap", problems)]
    r.sections = [Section(None, [
        Column("car_code", "Car"), Column("trip_no", "Trip"), Column("start_time", "Start time"),
        Column("driver", "Driver"), Column("previous_trip_no", "Previous trip"),
        Column("previous_end_km", "Previous end km"), Column("start_km", "Start km"), Column("gap_km", "Gap km"),
        Column("result", "Result"),
    ], rows)]
    return r


# ---- 7. monthly summary ------------------------------------------------------------------------------

def monthly_summary(db: Session, f: Filters) -> Report:
    r = _new("monthly_summary", "Monthly summary", f, db)
    trips = _trips(db, f)
    real = [t for t in trips if t.status != TripStatus.cancelled]
    done = [t for t in real if t.status in DONE]
    km = sum(t.distance_km or 0 for t in done)

    car_km: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    dept: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for t in real:
        car_km[t.vehicle.car_code][0] += 1
        car_km[t.vehicle.car_code][1] += t.distance_km or 0 if t.status in DONE else 0
        d = dept[_who(t)[2]]
        d[0] += 1
        d[1] += t.distance_km or 0 if t.status in DONE else 0

    open_alerts = db.scalar(select(func.count()).select_from(Alert).where(Alert.status == AlertStatus.open))
    needs_review = db.scalar(select(func.count()).select_from(Trip).where(Trip.needs_review.is_(True), or_(
        Trip.approval_status == "pending", Trip.approval_status.is_(None))))
    pending = db.scalar(select(func.count()).select_from(Trip).where(Trip.approval_status == "pending"))
    open_trips = db.scalar(select(func.count()).select_from(Trip).where(Trip.status.in_(OPEN_TRIP_STATUSES)))

    r.summary = [
        ("Trips (not cancelled)", len(real)), ("Completed", sum(t.status == TripStatus.completed for t in real)),
        ("Closed by admin", sum(t.status == TripStatus.closed_by_admin for t in real)),
        ("Cancelled", len(trips) - len(real)), ("Total km", km),
        ("Average km per trip", round(km / len(done), 1) if done else 0),
        ("Trips without a passenger", sum(not t.with_passenger for t in real)),
        ("Visitor trips", sum(t.is_visitor for t in real)),
        ("Open alerts now", open_alerts), ("Trips waiting for admin approval now", pending),
        ("Trips running now", open_trips),
    ]
    top_cars = sorted(car_km.items(), key=lambda kv: (-kv[1][1], kv[0]))[:5]
    top_depts = sorted(dept.items(), key=lambda kv: (-kv[1][1], kv[0]))[:5]
    r.sections = [
        Section("Busiest cars", [Column("car_code", "Car"), Column("trips", "Trips"), Column("km", "Total km")],
                [{"car_code": c, "trips": v[0], "km": v[1]} for c, v in top_cars]),
        Section("Top departments", [Column("department", "Department"), Column("trips", "Trips"), Column("km", "Total km")],
                [{"department": c, "trips": v[0], "km": v[1]} for c, v in top_depts]),
    ]
    return r


REPORTS = {
    "car_usage": ("Car usage", "Per car: trips, total km, hours used, idle days, km per trip", car_usage),
    "drivers": ("Driver report", "Per driver: trips, km, average trip time, cancelled trips, alerts", driver_report),
    "passenger_department": ("Passenger and department", "Trips and km by passenger and by department", passenger_department),
    "trip_log": ("Trip log", "Every trip with all fields and a link to its photos", trip_log),
    "exceptions": ("Exceptions", "Cancelled, admin-closed, km gaps, long trips, no-passenger trips and other alerts", exceptions),
    "km_continuity": ("Km continuity", "Each trip's start km against the previous end km, to find unrecorded use", km_continuity),
    "monthly_summary": ("Monthly summary", "One page for management", monthly_summary),
}


def build(db: Session, name: str, f: Filters) -> Report:
    return REPORTS[name][2](db, f)
