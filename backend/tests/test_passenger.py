"""Passenger side: open the Start QR, look up the name, confirm with an employee ID or as a
visitor, and the wrong-ID limit. Run through the real API, rolled back after each test."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.deps import get_db
from app.main import app
from app.models import (
    Alert, Driver, Passenger, RecordStatus, Setting, Trip, TripEvent, TripToken,
)
from app.security import hash_secret
from app.storage import LocalStorage, get_storage
from tests.test_trips import JPEG, auth, make_car, make_driver, start, stored


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def emp_id() -> str:
    """A random employee ID in the Epic shape (7 digits), e.g. 1236421."""
    import random
    return str(random.randint(1_000_000, 9_999_999))


@pytest.fixture()
def client(db, tmp_path):
    storage = LocalStorage(tmp_path)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_storage] = lambda: storage
    yield TestClient(app)
    app.dependency_overrides.clear()


def make_passenger(db, name="Nadia Islam", **kw):
    p = Passenger(employee_id=emp_id(), name=name, department="HR", phone="01711-000000", **kw)
    db.add(p)
    db.flush()
    return p


def set_setting(db, key, value):
    db.merge(Setting(key=key, value=str(value)))
    db.flush()


def new_trip(client, db, **kw):
    """Driver starts a trip with a passenger. Returns (driver, car, trip_id, token_path)."""
    car, driver = make_car(db), make_driver(db)
    body = start(client, driver, car, **kw).json()
    raw = body["start_qr"]["url"].rsplit("/p/", 1)[1]
    return driver, car, body["trip"]["id"], raw


def confirm_employee(client, raw, employee_id, **kw):
    return client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": employee_id}, **kw)


def confirm_visitor(client, raw, **fields):
    body = {"passenger_type": "visitor", "name": "John Smith", "phone": "+880 1712 345678"}
    body.update(fields)
    return client.post(f"/api/p/{raw}/confirm-start", json=body)


def events(db, name, trip_id):
    return db.scalars(select(TripEvent).where(TripEvent.event == name, TripEvent.trip_id == trip_id)).all()


# ---- opening the Start QR (P1 / S3) ----------------------------------------------------------

def test_open_start_qr_shows_trip_details(client, db):
    driver, car, trip_id, raw = new_trip(client, db)
    r = client.get(f"/api/p/{raw}")
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "start" and body["allow_visitors"] is True and body["tries_left"] == 5
    t = body["trip"]
    assert t["car_code"] == car.car_code and t["driver_name"] == driver.name
    assert t["start_km"] == car.current_km and t["destination"] == "Factory, Gazipur"
    assert "phone" not in str(body).lower() and "employee_id" not in body["trip"]  # no private data
    assert body["photo_url"] == f"/api/p/{raw}/photo"


def test_start_photo_is_served_while_qr_is_valid(client, db):
    _, _, _, raw = new_trip(client, db)
    r = client.get(f"/api/p/{raw}/photo")
    assert r.status_code == 200 and r.content == stored(JPEG)
    assert r.headers["content-type"] == "image/jpeg" and r.headers["cache-control"] == "no-store"
    assert client.get("/api/p/not-a-real-token/photo").status_code == 404


def test_unknown_qr(client):
    r = client.get("/api/p/" + "x" * 43)
    assert r.status_code == 404 and r.json()["detail"]["code"] == "QR_INVALID"


def test_expired_qr(client, db):
    _, _, trip_id, raw = new_trip(client, db)
    tok = db.scalar(select(TripToken).where(TripToken.trip_id == trip_id))
    tok.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.flush()
    r = client.get(f"/api/p/{raw}")
    assert r.status_code == 410 and r.json()["detail"]["code"] == "QR_EXPIRED"
    assert confirm_visitor(client, raw).status_code == 410


def test_new_qr_replaces_the_old_one(client, db):
    driver, _, trip_id, old = new_trip(client, db)
    new = client.post(f"/api/trips/{trip_id}/start-qr", headers=auth("driver", driver.id)).json()["start_qr"]["url"].rsplit("/p/", 1)[1]
    r = client.get(f"/api/p/{old}")
    assert r.status_code == 410 and r.json()["detail"]["code"] == "QR_REPLACED"
    assert client.get(f"/api/p/{new}").status_code == 200


def test_cancelled_trip_qr_is_dead(client, db):
    driver, _, trip_id, raw = new_trip(client, db)
    client.post(f"/api/trips/{trip_id}/cancel", json={"reason": "Wrong car"}, headers=auth("driver", driver.id))
    r = client.get(f"/api/p/{raw}")
    assert r.status_code == 410 and r.json()["detail"]["code"] == "TRIP_CANCELLED"


# ---- typed employee IDs (no staff list) --------------------------------------------------------

def test_any_well_formed_id_is_accepted_and_added(client, db):
    _, _, trip_id, raw = new_trip(client, db)
    r = client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": "  1237788 ", "name": "Rafiq Hasan"})
    assert r.status_code == 200 and r.json()["trip"]["passenger_name"] == "Rafiq Hasan"
    p = db.scalar(select(Passenger).where(Passenger.employee_id == "1237788"))
    assert p is not None and p.name == "Rafiq Hasan"
    assert db.get(Trip, trip_id).passenger_id == p.id


def test_name_is_optional_and_the_id_is_shown_instead(client, db):
    _, _, _, raw = new_trip(client, db)
    eid = emp_id()
    r = confirm_employee(client, raw, eid)
    assert r.status_code == 200 and r.json()["trip"]["passenger_name"] == eid


def test_badly_formed_id_is_refused_but_not_counted(client, db):
    _, _, _, raw = new_trip(client, db)
    for bad in ("EMP2210", "123456", "12345678", "123-4567", "123 4567"):
        r = confirm_employee(client, raw, bad)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "BAD_ID_FORMAT"
    assert client.get(f"/api/p/{raw}").json()["tries_left"] == 5


def test_turned_off_employee_is_refused(client, db):
    _, _, _, raw = new_trip(client, db)
    p = make_passenger(db, status=RecordStatus.inactive)
    r = confirm_employee(client, raw, p.employee_id)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "PASSENGER_INACTIVE"


def test_no_name_lookup_any_more(client, db):
    """Privacy: the page must not tell who an employee ID belongs to."""
    _, _, _, raw = new_trip(client, db)
    p = make_passenger(db)
    assert client.post(f"/api/p/{raw}/lookup", json={"employee_id": p.employee_id}).status_code in (404, 405)


def test_start_remembers_this_phone(client, db):
    _, _, trip_id, raw = new_trip(client, db)
    r = confirm_employee(client, raw, make_passenger(db).employee_id)
    cookie = r.headers["set-cookie"]
    assert f"s2d_pax{trip_id}=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert db.get(Trip, trip_id).passenger_key_hash  # only the hash is kept


# ---- confirm start: employee -----------------------------------------------------------------

def test_employee_confirms_the_start(client, db):
    driver, _, trip_id, raw = new_trip(client, db)
    p = make_passenger(db)
    r = confirm_employee(client, raw, p.employee_id)
    assert r.status_code == 200
    # the passenger's page shows only what was typed (here just the ID), never the name stored for that ID
    assert r.json()["trip"]["status"] == "in_progress" and r.json()["trip"]["passenger_name"] == p.employee_id

    trip = db.get(Trip, trip_id)
    db.refresh(trip)
    assert trip.passenger_id == p.id and trip.is_visitor is False
    assert trip.journey_start_time is not None and trip.status.value == "in_progress"
    tok = db.scalar(select(TripToken).where(TripToken.trip_id == trip_id))
    assert tok.used_at is not None

    ev = events(db, "journey_started", trip_id)[0]
    assert ev.actor == f"passenger:{p.employee_id}" and ev.ip

    # the driver's screen now shows the running trip
    active = client.get("/api/trips/active", headers=auth("driver", driver.id)).json()
    assert active["trip"]["status"] == "in_progress" and active["trip"]["passenger_name"] == "Nadia Islam"


def test_start_qr_works_only_once(client, db):
    _, _, _, raw = new_trip(client, db)
    p = make_passenger(db)
    assert confirm_employee(client, raw, p.employee_id).status_code == 200
    again = confirm_employee(client, raw, p.employee_id)
    assert again.status_code == 410 and again.json()["detail"]["code"] == "QR_USED"
    assert client.get(f"/api/p/{raw}").status_code == 410


def test_employee_id_is_trimmed_and_case_insensitive(client, db):
    _, _, _, raw = new_trip(client, db)
    p = make_passenger(db)
    assert confirm_employee(client, raw, f" {p.employee_id.lower()} ").status_code == 200


def test_driver_cannot_confirm_from_own_signed_in_phone(client, db):
    driver, _, trip_id, raw = new_trip(client, db)
    p = make_passenger(db)
    r = confirm_employee(client, raw, p.employee_id, headers=auth("driver", driver.id))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "DRIVER_CANNOT_CONFIRM"
    trip = db.get(Trip, trip_id)
    db.refresh(trip)
    assert trip.status.value == "waiting_for_passenger" and trip.passenger_id is None
    assert db.scalar(select(TripToken.used_at).where(TripToken.trip_id == trip_id)) is None
    # a garbage token is ignored, the passenger is not blocked by it
    assert confirm_employee(client, raw, p.employee_id, headers={"Authorization": "Bearer junk"}).status_code == 200


def test_driver_is_not_blocked_from_other_drivers_trip_check_is_per_trip(client, db):
    _, _, _, raw = new_trip(client, db)
    other_driver = make_driver(db, "Other Driver")
    p = make_passenger(db)
    assert confirm_employee(client, raw, p.employee_id, headers=auth("driver", other_driver.id)).status_code == 200


def test_driver_cannot_be_the_passenger_of_own_trip(client, db):
    driver, _, trip_id, raw = new_trip(client, db)
    db.add(Passenger(employee_id=driver.employee_id, name=driver.name))
    db.flush()
    r = confirm_employee(client, raw, driver.employee_id)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "PASSENGER_IS_DRIVER"
    assert client.get(f"/api/p/{raw}").json()["tries_left"] == 5  # not counted as a wrong try


# (The wrong-ID limit now only applies at the end, on a phone that is not the one that started: see test_end_trip.)


# ---- visitors ("Other") -----------------------------------------------------------------------

def test_visitor_confirms_with_name_and_phone(client, db):
    driver, _, trip_id, raw = new_trip(client, db)
    r = confirm_visitor(client, raw, reason="Factory audit")
    assert r.status_code == 200
    assert r.json()["trip"]["passenger_name"] == "John Smith" and r.json()["trip"]["is_visitor"] is True

    trip = db.get(Trip, trip_id)
    db.refresh(trip)
    assert trip.is_visitor and trip.passenger_id is None and trip.needs_review is True
    assert (trip.visitor_name, trip.visitor_phone, trip.visitor_reason) == ("John Smith", "+880 1712 345678", "Factory audit")
    assert trip.status.value == "in_progress" and trip.journey_start_time is not None
    assert events(db, "journey_started", trip_id)[0].actor == "visitor:+880 1712 345678"
    active = client.get("/api/trips/active", headers=auth("driver", driver.id)).json()["trip"]
    assert active["passenger_name"] == "John Smith" and active["is_visitor"] is True


def test_visitor_reason_is_optional(client, db):
    _, _, trip_id, raw = new_trip(client, db)
    assert confirm_visitor(client, raw).status_code == 200
    assert db.get(Trip, trip_id).visitor_reason is None


@pytest.mark.parametrize("fields", [
    {"name": "J"}, {"name": "   "}, {"phone": "12"}, {"phone": "abcdefgh"}, {"phone": ""},
])
def test_visitor_details_are_validated(client, db, fields):
    _, _, trip_id, raw = new_trip(client, db)
    assert confirm_visitor(client, raw, **fields).status_code == 422
    assert db.scalar(select(TripToken.used_at).where(TripToken.trip_id == trip_id)) is None


def test_visitor_option_can_be_switched_off(client, db):
    set_setting(db, "allow_visitors", 0)
    _, _, _, raw = new_trip(client, db)
    assert client.get(f"/api/p/{raw}").json()["allow_visitors"] is False
    r = confirm_visitor(client, raw)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "VISITORS_NOT_ALLOWED"


def test_driver_cannot_confirm_a_visitor_from_own_phone(client, db):
    driver, _, _, raw = new_trip(client, db)
    r = client.post(f"/api/p/{raw}/confirm-start", headers=auth("driver", driver.id),
                    json={"passenger_type": "visitor", "name": "John Smith", "phone": "01712345678"})
    assert r.status_code == 403


def test_unknown_passenger_type_is_rejected(client, db):
    _, _, _, raw = new_trip(client, db)
    assert client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "robot"}).status_code == 422
    assert client.post(f"/api/p/{raw}/confirm-start", json={"employee_id": "EMP-1"}).status_code == 422
