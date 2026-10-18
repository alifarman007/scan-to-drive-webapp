"""Read the old travel-log forms (CSV exports of "Driver Travel Log" and "Passenger Travel Log") and turn them into
trips for the app.

The old driver form saved one row when a trip started and another when it ended, with no link between them. Here
the rows of each car are put in time order and every "End" is paired with the "Start" just before it on the same
car. The car is found by its number plate (the old "Car 01" numbers do not match the app's codes); the driver by
name ("Md." and such are ignored, "Liton" finds "Md. Sirajul Islam (Liton)", small spelling differences are
allowed) and, when two drivers share a name, by the car they usually drive. The passenger form is linked through
its "Driver Record ID" (the start row): it gives the passenger's employee ID and the rating at the end.

Nothing is saved here: `read_old_logs` returns a preview with a reason for every row that cannot be used, and
which rows look like the tests made while the forms were being set up.
"""
import csv
import difflib
import io
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.fleet_data import fleet, plate
from app.models import OPEN_TRIP_STATUSES, Driver, Trip, TripStatus, Vehicle

BD = timezone(timedelta(hours=6))
MAX_BYTES = 5 * 1024 * 1024
MAX_TRIP_KM = 1500        # longer than this in one trip: almost surely a typing mistake
MIN_ODOMETER = 1000       # a real car's odometer; the form tests typed 1, 85, 100 ...
TITLES = {"md", "mohammad", "mohammed", "muhammad", "mohd", "mst", "mosammat", "sk", "sheikh"}


class OldLogError(ValueError):
    """The file cannot be read as the expected form export."""


# ---------------------------------------------------------------- reading the files


def _rows(data: bytes, need: set[str], what: str) -> list[dict]:
    if len(data) > MAX_BYTES:
        raise OldLogError(f"The {what} file is larger than 5 MB")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    heads = {(h or "").strip() for h in (reader.fieldnames or [])}
    missing = need - heads
    if missing:
        raise OldLogError(f"This does not look like the {what}: missing columns {', '.join(sorted(missing))}")
    return [{(k or "").strip(): " ".join((v or "").split()) for k, v in r.items()} for r in reader]


def _when(raw: str) -> datetime | None:
    """'10/13/2026 5:51 AM' (Bangladesh time) -> UTC."""
    for fmt in ("%m/%d/%Y %I:%M %p", "%m/%d/%Y %H:%M", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).replace(tzinfo=BD).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _km(raw: str) -> int | None:
    digits = raw.replace(",", "").strip()
    return int(digits) if digits.isdigit() else None


def _plate(raw: str) -> str | None:
    try:
        return plate(raw)
    except ValueError:
        return None


# ---------------------------------------------------------------- matching drivers


def _words(name: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", name.lower()) if w and w not in TITLES]


# who drives which car in the transport office's lists (used when two drivers share a name): plate -> (ID, name)
USUAL_DRIVER = {c["reg_number"]: (d["employee_id"], d["name"]) for c, d in zip(*fleet())}


def _name_score(old: str, driver_name: str) -> float:
    """How well a name typed in the old form fits a driver: 1 = same word, ~0.8 = small spelling difference."""
    old_words = [w for w in _words(old) if not w.isdigit()]
    if not old_words:
        return 0
    best = 0.0
    for o in old_words[:1]:  # the given name typed in the form
        for w in _words(driver_name):
            if w.isdigit():
                continue
            if o == w:
                s = 1.0
            elif len(o) >= 4 and (w.startswith(o) or o.startswith(w)):
                s = 0.9  # "Mizan" / "Mizanur"
            else:
                s = difflib.SequenceMatcher(None, o, w).ratio()
            best = max(best, s)
    return best


def match_driver(old_name: str, car_plate: str | None, drivers: list[Driver]) -> tuple[Driver | None, list[Driver]]:
    """(the driver, or None when not sure; the candidates found)."""
    if not old_name.strip():
        return None, []
    scored = [(d, _name_score(old_name, d.name)) for d in drivers]
    top = max((s for _, s in scored), default=0)
    if top < 0.78:
        return None, []
    # "Salim (2)": the driver whose name ends in -2 (the form numbered drivers with the same name)
    m = re.search(r"\((\d)\)", old_name)
    if m and m.group(1) != "1":
        numbered = [d for d, s in scored if s >= 0.78 and re.search(rf"[-\s]{m.group(1)}$", d.name.strip())]
        if len(numbered) == 1:
            return numbered[0], numbered
    cands = [d for d, s in scored if s >= max(0.78, top - 0.05)]
    if m and m.group(1) == "1":
        plain = [d for d in cands if not re.search(r"[-\s]\d$", d.name.strip())]
        cands = plain or cands
    if len(cands) == 1:
        return cands[0], cands
    # two drivers with the same name: the one who usually drives this car
    usual_id, usual_name = USUAL_DRIVER.get(car_plate or "", (None, None))
    by_id = [d for d in cands if d.employee_id == usual_id]
    if len(by_id) == 1:
        return by_id[0], cands
    by_name = [d for d in cands if " ".join(d.name.split()) == usual_name]
    if len(by_name) == 1:
        return by_name[0], cands
    exact = [d for d, s in scored if s == 1.0]
    if len(exact) == 1:
        return exact[0], cands
    return None, cands


# ---------------------------------------------------------------- the preview


@dataclass
class Passenger:
    kind: str = ""                 # "Epic Employee" / "Others"
    employee_id: str | None = None  # a valid 7-digit ID, or None
    typed_ids: list[str] = field(default_factory=list)  # everything typed, valid or not
    rating: int | None = None
    comment: str | None = None


@dataclass
class OldTrip:
    key: str                    # "drv:154-168": start row and end row of the old driver form
    start_row: str
    end_row: str | None
    plate_text: str
    car: Vehicle | None
    driver_text: str
    driver: Driver | None
    driver_choices: list[Driver]
    start_time: datetime | None
    end_time: datetime | None
    start_place: str
    destination: str
    end_place: str
    start_km: int | None
    end_km: int | None
    passenger: Passenger | None
    problems: list[str] = field(default_factory=list)   # cannot be imported as it is
    warnings: list[str] = field(default_factory=list)   # can be imported, but look first
    looks_like_test: bool = False
    already: str | None = None   # trip number if this row was imported before

    @property
    def distance(self) -> int | None:
        return None if self.start_km is None or self.end_km is None else self.end_km - self.start_km

    @property
    def importable(self) -> bool:
        return not self.problems and self.already is None


@dataclass
class Preview:
    trips: list[OldTrip]
    skipped: list[dict]   # rows that are not trips at all (an end without a start ...)


DRIVER_COLS = {"Driver Name", "Vehicle Number", "Journey Status", "Start KM", "End KM", "Submission Date", "ID"}
PASSENGER_COLS = {"Employee ID", "Vehicle Number", "Commute Status", "Submission Date", "Driver Record ID"}


def _passengers(rows: list[dict]) -> dict[str, Passenger]:
    """Passenger form rows by the driver start row they belong to."""
    out: dict[str, Passenger] = {}
    for r in rows:
        ref = r.get("Driver Record ID", "").strip()
        if not ref:
            continue
        p = out.setdefault(ref, Passenger())
        typed = r.get("Employee ID", "").strip()
        kind = r.get("Passenger Type", "").strip()
        if kind and not p.kind:
            p.kind = kind
        if typed and typed not in p.typed_ids:
            p.typed_ids.append(typed)
        if typed and p.employee_id is None and re.fullmatch(settings.passenger_id_pattern, typed):
            p.employee_id = typed
        if "end" in r.get("Commute Status", "").lower():
            rating = r.get("Driver Rating", "").strip()
            if rating.isdigit() and 1 <= int(rating) <= 5:
                p.rating = int(rating)
                p.comment = r.get("Driver Comment", "").strip() or None
    return out


def read_old_logs(db: Session, driver_csv: bytes, passenger_csv: bytes | None = None) -> Preview:
    rows = _rows(driver_csv, DRIVER_COLS, "Driver Travel Log")
    pax = _passengers(_rows(passenger_csv, PASSENGER_COLS, "Passenger Travel Log")) if passenger_csv else {}

    cars = {v.reg_number: v for v in db.scalars(select(Vehicle))}
    cars_by_plate = {}
    for reg, v in cars.items():
        cars_by_plate[_plate(reg) or reg] = v
    drivers = list(db.scalars(select(Driver)))
    done = dict(db.execute(select(Trip.import_key, Trip.trip_no).where(Trip.import_key.is_not(None))).all())

    # each car's rows in time order (row ID breaks ties: the form numbered rows as they came in)
    by_car: dict[str, list[dict]] = {}
    skipped: list[dict] = []
    for r in rows:
        status = r.get("Journey Status", "").lower()
        if "start" not in status and "end" not in status:
            skipped.append({"row": r.get("ID"), "reason": "No Start / End in the row"})
            continue
        p = _plate(r.get("Vehicle Number", ""))
        r["_plate"] = p
        r["_when"] = _when(r.get("Submission Date", ""))
        r["_kind"] = "start" if "start" in status else "end"
        by_car.setdefault(p or f"?{r.get('Vehicle Number')}", []).append(r)

    pairs: list[tuple[dict, dict | None]] = []
    for key, items in by_car.items():
        items.sort(key=lambda r: (r["_when"] or datetime.min.replace(tzinfo=timezone.utc), int(r["ID"]) if r["ID"].isdigit() else 0))
        open_start = None
        for r in items:
            if r["_kind"] == "start":
                if open_start is not None:
                    pairs.append((open_start, None))
                open_start = r
            elif open_start is not None:
                pairs.append((open_start, r))
                open_start = None
            else:
                skipped.append({"row": r.get("ID"), "reason": f"End of a trip on {r.get('Vehicle Number')} without a start before it"})
        if open_start is not None:
            pairs.append((open_start, None))

    trips: list[OldTrip] = []
    for s, e in pairs:
        car = cars_by_plate.get(s["_plate"]) if s["_plate"] else None
        driver, choices = match_driver(s.get("Driver Name", ""), s["_plate"], drivers)
        t = OldTrip(
            key=f"drv:{s['ID']}-{e['ID'] if e else 'open'}",
            start_row=s["ID"], end_row=e["ID"] if e else None,
            plate_text=s.get("Vehicle Number", ""), car=car,
            driver_text=s.get("Driver Name", ""), driver=driver, driver_choices=choices,
            start_time=s["_when"], end_time=e["_when"] if e else None,
            start_place=s.get("Start Location", ""), destination=s.get("Destination Location", ""),
            end_place=(e.get("Current Location", "") if e else ""),
            start_km=_km(s.get("Start KM", "")), end_km=_km(e.get("End KM", "")) if e else None,
            passenger=pax.get(s["ID"]),
        )
        _check(t)
        t.already = done.get(t.key)
        trips.append(t)

    _check_against_app(db, trips)
    trips.sort(key=lambda t: (t.start_time or datetime.min.replace(tzinfo=timezone.utc), t.start_row))
    return Preview(trips, skipped)


def _made_up(km: int) -> bool:
    """123456, 12345, 1234567, 99999, 55555555 ...: numbers people type to try a form."""
    s = str(km)
    if len(s) >= 4 and (s in "1234567890" or s in "9876543210"):
        return True
    return len(s) >= 4 and len(set(s)) == 1


def _check(t: OldTrip) -> None:
    if t.car is None:
        t.problems.append(f"No car with the number plate {t.plate_text or '(empty)'}")
    if t.driver is None:
        t.problems.append(f"Driver \"{t.driver_text}\" not found" if not t.driver_choices
                          else f"\"{t.driver_text}\" could be {' or '.join(f'{d.name} ({d.employee_id})' for d in t.driver_choices)}: choose")
    if t.end_row is None:
        t.problems.append("Started but never ended in the form")
    if t.start_time is None or (t.end_row and t.end_time is None):
        t.problems.append("Date cannot be read")
    if t.start_km is None or (t.end_row and t.end_km is None):
        t.problems.append("Km missing")
    elif t.end_km is not None and t.end_km <= t.start_km:
        t.problems.append(f"End km {t.end_km:,} is not above start km {t.start_km:,}")
    if t.start_time and t.end_time and t.end_time < t.start_time:
        t.problems.append("Ends before it starts")
    if not t.start_place.strip():
        t.problems.append("Start place empty")

    texts = " ".join([t.start_place, t.destination, t.end_place, (t.passenger.comment if t.passenger else "") or ""]).lower()
    if "test" in texts:
        t.looks_like_test = True
        t.warnings.append("Says \"test\"")
    if t.start_km is not None and t.start_km < MIN_ODOMETER:
        t.looks_like_test = True
        t.warnings.append(f"Start km {t.start_km} is too low for a real odometer")
    made_up = [k for k in (t.start_km, t.end_km) if k is not None and _made_up(k)]
    if made_up:
        t.looks_like_test = True
        t.warnings.append(f"Km {made_up[0]:,} looks typed for a test")
    d = t.distance
    if d is not None and d > MAX_TRIP_KM:
        t.looks_like_test = True
        t.warnings.append(f"{d:,} km in one trip")
    if t.start_time and t.end_time and t.end_time - t.start_time < timedelta(minutes=2) and d is not None and d > 5:
        t.looks_like_test = True
        t.warnings.append("Ended within 2 minutes of the start")
    if t.passenger and t.passenger.typed_ids and not t.passenger.employee_id:
        t.warnings.append(f"Passenger ID {', '.join(t.passenger.typed_ids)} is not 7 digits: kept as a note")


def _check_against_app(db: Session, trips: list[OldTrip]) -> None:
    """Old trips that overlap a trip already in the app for the same car, and km that go backwards."""
    for t in trips:
        if t.car is None or t.start_time is None or t.end_time is None:
            continue
        clash = db.scalar(select(Trip.trip_no).where(
            Trip.vehicle_id == t.car.id, Trip.import_key.is_(None), Trip.status != TripStatus.cancelled,
            Trip.start_time < t.end_time,
            (Trip.end_time.is_(None) & Trip.status.in_(OPEN_TRIP_STATUSES)) | (Trip.end_time > t.start_time),
        ).limit(1))
        if clash:
            t.problems.append(f"Same time as trip {clash} already in the app")
    # km going backwards between consecutive old trips of the same car
    last: dict[int, OldTrip] = {}
    for t in sorted((x for x in trips if x.car and x.start_time and not x.looks_like_test and not x.problems),
                    key=lambda x: x.start_time):
        prev = last.get(t.car.id)
        if prev and prev.end_km and t.start_km is not None and t.start_km < prev.end_km:
            t.warnings.append(f"Starts at {t.start_km:,} km, below the {prev.end_km:,} km the trip before ended")
        last[t.car.id] = t
