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
from tests.test_trips import JPEG, auth, make_car, make_driver, start


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def client(db, tmp_path):
    storage = LocalStorage(tmp_path)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_storage] = lambda: storage
    yield TestClient(app)
    app.dependency_overrides.clear()


def make_passenger(db, name="Nadia Islam", **kw):
    p = Passenger(employee_id=f"EMP-{_uid()}", name=name, department="HR", phone="01711-000000", **kw)
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
    assert r.status_code == 200 and r.content == JPEG
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


# ---- name look-up ---------------------------------------------------------------------------

def test_lookup_returns_the_name_only(client, db):
    _, _, _, raw = new_trip(client, db)
    p = make_passenger(db)
    r = client.post(f"/api/p/{raw}/lookup", json={"employee_id": f"  {p.employee_id.lower()} "})  # trimmed, any case
    assert r.status_code == 200 and r.json() == {"name": "Nadia Islam"}  # no department, phone or id


def test_lookup_of_unknown_or_inactive_id_counts_as_wrong(client, db):
    _, _, _, raw = new_trip(client, db)
    inactive = make_passenger(db, status=RecordStatus.inactive)
    r = client.post(f"/api/p/{raw}/lookup", json={"employee_id": inactive.employee_id})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "ID_NOT_FOUND" and r.json()["detail"]["tries_left"] == 4
    r = client.post(f"/api/p/{raw}/lookup", json={"employee_id": "NOPE"})
    assert r.json()["detail"]["tries_left"] == 3
    assert client.get(f"/api/p/{raw}").json()["tries_left"] == 3


def test_lookup_is_limited_so_names_cannot_be_listed(client, db):
    _, _, _, raw = new_trip(client, db)
    p = make_passenger(db)
    for _ in range(15):
        assert client.post(f"/api/p/{raw}/lookup", json={"employee_id": p.employee_id}).status_code == 200
    r = client.post(f"/api/p/{raw}/lookup", json={"employee_id": p.employee_id})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "TOO_MANY_LOOKUPS"


# ---- confirm start: employee -----------------------------------------------------------------

def test_employee_confirms_the_start(client, db):
    driver, _, trip_id, raw = new_trip(client, db)
    p = make_passenger(db)
    r = confirm_employee(client, raw, p.employee_id)
    assert r.status_code == 200
    assert r.json()["trip"]["status"] == "in_progress" and r.json()["trip"]["passenger_name"] == "Nadia Islam"

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


# ---- the wrong-ID limit -----------------------------------------------------------------------

def test_five_wrong_ids_block_the_qr_and_alert_the_admin(client, db):
    driver, car, trip_id, raw = new_trip(client, db)
    p = make_passenger(db)
    lefts = [confirm_employee(client, raw, "WRONG").json()["detail"]["tries_left"] for _ in range(5)]
    assert lefts == [4, 3, 2, 1, 0]

    for r in (client.get(f"/api/p/{raw}"), confirm_employee(client, raw, p.employee_id)):
        assert r.status_code == 423 and r.json()["detail"]["code"] == "QR_BLOCKED"

    alert = db.scalar(select(Alert).where(Alert.trip_id == trip_id))
    assert alert.type.value == "wrong_ids" and alert.status.value == "open" and alert.vehicle_id == car.id
    assert len(events(db, "passenger_wrong_id", trip_id)) == 5 and events(db, "qr_blocked", trip_id)
    assert db.scalar(select(func.count()).select_from(Alert).where(Alert.trip_id == trip_id)) == 1


def test_making_a_new_qr_does_not_reset_the_wrong_id_count(client, db):
    driver, _, trip_id, raw = new_trip(client, db)
    for _ in range(5):
        confirm_employee(client, raw, "WRONG")
    r = client.post(f"/api/trips/{trip_id}/start-qr", headers=auth("driver", driver.id))
    assert r.status_code == 423 and r.json()["detail"]["code"] == "TRIP_LOCKED"
    active = client.get("/api/trips/active", headers=auth("driver", driver.id)).json()
    assert active["start_qr_blocked"] is True
    # the driver can still cancel and start again
    assert client.post(f"/api/trips/{trip_id}/cancel", json={"reason": "Passenger typed wrong IDs"},
                       headers=auth("driver", driver.id)).status_code == 200


def test_wrong_tries_are_counted_across_new_qr_codes(client, db):
    driver, _, trip_id, raw1 = new_trip(client, db)
    for _ in range(3):
        confirm_employee(client, raw1, "WRONG")
    raw2 = client.post(f"/api/trips/{trip_id}/start-qr", headers=auth("driver", driver.id)).json()["start_qr"]["url"].rsplit("/p/", 1)[1]
    assert client.get(f"/api/p/{raw2}").json()["tries_left"] == 2
    assert confirm_employee(client, raw2, "WRONG").json()["detail"]["tries_left"] == 1


def test_limit_follows_the_admin_setting(client, db):
    set_setting(db, "wrong_id_limit", 2)
    _, _, trip_id, raw = new_trip(client, db)
    confirm_employee(client, raw, "WRONG")
    assert confirm_employee(client, raw, "WRONG").json()["detail"]["tries_left"] == 0
    assert client.get(f"/api/p/{raw}").status_code == 423


def test_a_correct_id_before_the_limit_still_works(client, db):
    _, _, _, raw = new_trip(client, db)
    p = make_passenger(db)
    for _ in range(4):
        confirm_employee(client, raw, "WRONG")
    assert confirm_employee(client, raw, p.employee_id).status_code == 200


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
