"""End of the trip: the driver's end form, the End QR, and the passenger's end confirmation
(PDF 6.3, 6.4, section 8). Run through the real API, rolled back after each test."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.deps import get_db
from app.main import app
from app.models import Alert, Passenger, Setting, Trip, TripEvent, TripPhoto, TripToken
from app.services.phones import normalize_phone
from app.storage import LocalStorage, get_storage
from tests.test_trips import JPEG, auth, make_car, make_driver, start

END_JPEG = b"\xff\xd8\xff" + b"1" * 3000


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def client(db, tmp_path):
    storage = LocalStorage(tmp_path)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_storage] = lambda: storage
    c = TestClient(app)
    c.storage_dir = tmp_path
    yield c
    app.dependency_overrides.clear()


def make_passenger(db, name="Nadia Islam"):
    p = Passenger(employee_id=f"EMP-{_uid()}", name=name)
    db.add(p)
    db.flush()
    return p


def set_setting(db, key, value):
    db.merge(Setting(key=key, value=str(value)))
    db.flush()


def token_of(body):
    return body["url"].rsplit("/p/", 1)[1]


def running_trip(client, db, *, visitor_phone=None, with_passenger=True, km=45000):
    """A trip that is In progress. Returns (driver, car, passenger_or_None, trip_id)."""
    car, driver = make_car(db, km=km), make_driver(db)
    if not with_passenger:
        body = start(client, driver, car, with_passenger="false", purpose="Fuel the car").json()
        return driver, car, None, body["trip"]["id"]
    body = start(client, driver, car).json()
    raw = token_of(body["start_qr"])
    if visitor_phone:
        r = client.post(f"/api/p/{raw}/confirm-start", json={
            "passenger_type": "visitor", "name": "John Smith", "phone": visitor_phone})
        passenger = None
    else:
        passenger = make_passenger(db)
        r = client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": passenger.employee_id})
    assert r.status_code == 200, r.text
    return driver, car, passenger, body["trip"]["id"]


def end(client, driver, trip_id, photo=END_JPEG, **kw):
    form = {"end_km": 45038, "end_place": "Factory, Gazipur"}
    form.update(kw)
    files = {"photo": ("end.jpg", photo, "image/jpeg")} if photo is not None else None
    return client.post(f"/api/trips/{trip_id}/end", data={k: v for k, v in form.items() if v is not None},
                       files=files, headers=auth("driver", driver.id))


def confirm_end(client, raw, **fields):
    headers = fields.pop("headers", None)
    body = {"passenger_type": "employee"}
    body.update(fields)
    return client.post(f"/api/p/{raw}/confirm-end", json=body, headers=headers)


def events(db, name, trip_id):
    return db.scalars(select(TripEvent).where(TripEvent.event == name, TripEvent.trip_id == trip_id)).all()


# ---- driver ends the trip (D6-D8, S5) ------------------------------------------------------------

def test_driver_ends_the_trip_and_gets_an_end_qr(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    r = end(client, driver, trip_id, start_lat=None, end_lat="23.9", end_lng="90.4")
    assert r.status_code == 200
    t = r.json()["trip"]
    assert t["status"] == "waiting_for_end_confirm" and t["end_km"] == 45038 and t["distance_km"] == 38
    assert t["end_place"] == "Factory, Gazipur" and t["end_time"]

    # one-time End QR; only the hash is stored
    raw = token_of(r.json()["end_qr"])
    tok = db.scalar(select(TripToken).where(TripToken.trip_id == trip_id, TripToken.kind == "end"))
    assert tok.used_at is None and tok.revoked_at is None and raw not in tok.token_hash

    # end photo saved next to the start photo
    photo = db.scalar(select(TripPhoto).where(TripPhoto.trip_id == trip_id, TripPhoto.kind == "end"))
    assert (client.storage_dir / photo.file_url).read_bytes() == END_JPEG

    # car stays busy and its km does NOT move until the passenger confirms (PDF S7)
    db.refresh(car)
    assert car.current_km == 45000
    page = client.get(f"/api/cars/{car.car_code}", params={"v": 1}, headers=auth("driver", driver.id)).json()
    assert page["can_start"] is False
    assert events(db, "trip_end_submitted", trip_id)[0].actor == f"driver:{driver.employee_id}"
    active = client.get("/api/trips/active", headers=auth("driver", driver.id)).json()
    assert active["trip"]["status"] == "waiting_for_end_confirm" and active["end_qr_blocked"] is False


def test_end_km_must_be_more_than_start_km(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    for km in (45000, 44990):
        r = end(client, driver, trip_id, end_km=km)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "END_KM_TOO_LOW"
        assert r.json()["detail"]["start_km"] == 45000
    assert db.get(Trip, trip_id).status.value == "in_progress"
    assert end(client, driver, trip_id, end_km=45001).status_code == 200


def test_end_photo_is_required_and_must_be_an_image(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    assert end(client, driver, trip_id, photo=None).status_code == 422
    r = end(client, driver, trip_id, photo=b"%PDF-1.4 nope")
    assert r.status_code == 400 and r.json()["detail"]["code"] == "INVALID_PHOTO"
    assert end(client, driver, trip_id, end_place="  ").status_code == 422
    t = db.get(Trip, trip_id)
    db.refresh(t)
    assert t.status.value == "in_progress" and t.end_km is None


def test_nothing_is_saved_if_the_end_photo_cannot_be_stored(client, db):
    class Broken:
        def save(self, key, data): raise OSError("disk full")
        def delete(self, key): pass
        def read(self, key): raise OSError

    driver, _, _, trip_id = running_trip(client, db)
    app.dependency_overrides[get_storage] = lambda: Broken()
    r = end(client, driver, trip_id)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "PHOTO_SAVE_FAILED"
    t = db.get(Trip, trip_id)
    db.refresh(t)
    assert t.status.value == "in_progress" and t.end_km is None and t.distance_km is None


def test_only_the_trips_driver_can_end_it_and_only_once(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    other = make_driver(db, "Other")
    assert end(client, other, trip_id).status_code == 404
    assert end(client, driver, trip_id).status_code == 200
    again = end(client, driver, trip_id)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "TRIP_NOT_IN_PROGRESS"


def test_cannot_end_a_trip_that_is_still_waiting_for_the_passenger(client, db):
    car, driver = make_car(db), make_driver(db)
    trip_id = start(client, driver, car).json()["trip"]["id"]
    r = end(client, driver, trip_id)
    assert r.status_code == 409 and r.json()["detail"]["status"] == "waiting_for_passenger"


def test_high_km_raises_an_alert(client, db):
    set_setting(db, "high_km_limit_km", 100)
    driver, car, _, trip_id = running_trip(client, db)
    assert end(client, driver, trip_id, end_km=45250).status_code == 200
    a = db.scalar(select(Alert).where(Alert.trip_id == trip_id))
    assert a.type.value == "high_km" and "250 km" in a.message and a.vehicle_id == car.id


def test_normal_distance_raises_no_alert(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    end(client, driver, trip_id)
    assert db.scalar(select(func.count()).select_from(Alert).where(Alert.trip_id == trip_id)) == 0


# ---- trips without a passenger (PDF 6.4) ---------------------------------------------------------

def test_trip_without_passenger_completes_at_once(client, db):
    driver, car, _, trip_id = running_trip(client, db, with_passenger=False)
    r = end(client, driver, trip_id)
    assert r.status_code == 200 and r.json()["end_qr"] is None
    assert r.json()["trip"]["status"] == "completed" and r.json()["trip"]["distance_km"] == 38
    db.refresh(car)
    assert car.current_km == 45038  # the car's km moves forward
    assert db.scalar(select(func.count()).select_from(TripToken).where(TripToken.trip_id == trip_id)) == 0  # no passenger, so no QR codes at all
    assert client.get("/api/trips/active", headers=auth("driver", driver.id)).json()["trip"] is None
    assert start(client, driver, car, start_km=45038).status_code == 201  # car and driver free again


# ---- passenger opens the End QR (P3/S6) ----------------------------------------------------------

def test_passenger_sees_the_trip_summary(client, db):
    driver, car, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    r = client.get(f"/api/p/{raw}")
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "end" and body["confirm_as"] == "employee" and body["tries_left"] == 5
    t = body["trip"]
    assert (t["start_km"], t["end_km"], t["distance_km"]) == (45000, 45038, 38)
    assert t["journey_minutes"] is not None and t["end_place"] == "Factory, Gazipur"
    assert "phone" not in str(body).lower() and p.name not in str(body)  # no personal data
    assert client.get(f"/api/p/{raw}/photo/start").content == JPEG
    assert client.get(f"/api/p/{raw}/photo/end").content == END_JPEG


def test_visitor_trip_asks_for_the_phone_number(client, db):
    driver, _, _, trip_id = running_trip(client, db, visitor_phone="+880 1712 345678")
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    assert client.get(f"/api/p/{raw}").json()["confirm_as"] == "visitor"


def test_start_and_end_qr_cannot_be_swapped(client, db):
    car, driver = make_car(db), make_driver(db)
    start_raw = token_of(start(client, driver, car).json()["start_qr"])
    r = confirm_end(client, start_raw, employee_id="EMP-1")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "WRONG_QR"

    d2, _, p2, trip2 = running_trip(client, db)
    end_raw = token_of(end(client, d2, trip2).json()["end_qr"])
    r = client.post(f"/api/p/{end_raw}/confirm-start", json={"passenger_type": "employee", "employee_id": p2.employee_id})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "WRONG_QR"
    assert client.post(f"/api/p/{end_raw}/lookup", json={"employee_id": p2.employee_id}).status_code == 409


# ---- passenger confirms the end (P4/S7) ----------------------------------------------------------

def test_same_employee_confirms_the_end(client, db):
    driver, car, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    r = confirm_end(client, raw, employee_id=f" {p.employee_id.lower()} ")  # trimmed, any case
    assert r.status_code == 200 and r.json()["trip"]["status"] == "completed"
    assert r.json()["trip"]["distance_km"] == 38

    t = db.get(Trip, trip_id)
    db.refresh(t)
    assert t.status.value == "completed" and t.end_confirm_time is not None
    db.refresh(car)
    assert car.current_km == 45038  # the car's km moves forward now
    assert db.scalar(select(TripToken.used_at).where(TripToken.trip_id == trip_id, TripToken.kind == "end")) is not None
    assert events(db, "trip_completed", trip_id)[0].actor == f"passenger:{p.employee_id}"

    # the End QR works once, the trip is locked, and the car and driver are free
    again = confirm_end(client, raw, employee_id=p.employee_id)
    assert again.status_code == 410 and again.json()["detail"]["code"] == "QR_USED"
    assert client.get("/api/trips/active", headers=auth("driver", driver.id)).json()["trip"] is None
    assert start(client, driver, car, start_km=45038).status_code == 201


def test_a_different_employee_cannot_end_the_trip(client, db):
    driver, _, p, trip_id = running_trip(client, db)
    other = make_passenger(db, "Faruk Ahmed")
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    r = confirm_end(client, raw, employee_id=other.employee_id)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "ID_MISMATCH" and r.json()["detail"]["tries_left"] == 4
    unknown = confirm_end(client, raw, employee_id="NOPE")  # same answer, nothing revealed
    assert unknown.json()["detail"]["code"] == "ID_MISMATCH" and unknown.json()["detail"]["tries_left"] == 3
    assert db.get(Trip, trip_id).status.value == "waiting_for_end_confirm"
    assert confirm_end(client, raw, employee_id=p.employee_id).status_code == 200  # the right person still can


def test_five_wrong_ids_at_the_end_block_the_end_qr(client, db):
    driver, _, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    lefts = [confirm_end(client, raw, employee_id="NOPE").json()["detail"]["tries_left"] for _ in range(5)]
    assert lefts == [4, 3, 2, 1, 0]
    r = confirm_end(client, raw, employee_id=p.employee_id)
    assert r.status_code == 423 and r.json()["detail"]["code"] == "QR_BLOCKED"

    alert = db.scalar(select(Alert).where(Alert.trip_id == trip_id, Alert.type == "wrong_ids"))
    assert alert is not None and alert.status.value == "open"
    # a new End QR does not reset the count; the driver is told the trip is locked
    r = client.post(f"/api/trips/{trip_id}/end-qr", headers=auth("driver", driver.id))
    assert r.status_code == 423 and r.json()["detail"]["code"] == "TRIP_LOCKED"
    assert client.get("/api/trips/active", headers=auth("driver", driver.id)).json()["end_qr_blocked"] is True


def test_wrong_tries_at_the_start_do_not_use_up_the_end_tries(client, db):
    car, driver = make_car(db), make_driver(db)
    body = start(client, driver, car).json()
    raw = token_of(body["start_qr"])
    for _ in range(3):
        client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": "NOPE"})
    p = make_passenger(db)
    assert client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": p.employee_id}).status_code == 200
    end_raw = token_of(end(client, driver, body["trip"]["id"]).json()["end_qr"])
    assert client.get(f"/api/p/{end_raw}").json()["tries_left"] == 5


def test_driver_cannot_confirm_the_end_from_own_phone(client, db):
    driver, _, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    r = confirm_end(client, raw, employee_id=p.employee_id, headers=auth("driver", driver.id))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "DRIVER_CANNOT_CONFIRM"
    assert db.get(Trip, trip_id).status.value == "waiting_for_end_confirm"


def test_wrong_passenger_type_is_rejected_without_counting(client, db):
    driver, _, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    r = client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "visitor", "phone": "01712345678"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "WRONG_PASSENGER_TYPE"
    assert client.get(f"/api/p/{raw}").json()["tries_left"] == 5


# ---- visitors end with the same phone number -----------------------------------------------------

@pytest.mark.parametrize("typed", ["+880 1712 345678", "01712345678", "+8801712345678", "880-1712-345678", "01712 345 678"])
def test_visitor_ends_with_the_same_phone_in_any_format(client, db, typed):
    driver, car, _, trip_id = running_trip(client, db, visitor_phone="+880 1712 345678")
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    r = client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "visitor", "phone": typed})
    assert r.status_code == 200 and r.json()["trip"]["status"] == "completed"
    assert events(db, "trip_completed", trip_id)[0].actor.startswith("visitor:")
    t = db.get(Trip, trip_id)
    db.refresh(t)
    assert t.is_visitor and t.needs_review is True  # still listed for review


def test_visitor_with_another_phone_is_rejected_and_counted(client, db):
    driver, _, _, trip_id = running_trip(client, db, visitor_phone="01712345678")
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    r = client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "visitor", "phone": "01812345678"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "ID_MISMATCH" and r.json()["detail"]["tries_left"] == 4
    assert db.get(Trip, trip_id).status.value == "waiting_for_end_confirm"


def test_foreign_visitor_number_matches_by_digits(client, db):
    driver, _, _, trip_id = running_trip(client, db, visitor_phone="+44 7700 900123")
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    assert client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "visitor", "phone": "447700900123"}).status_code == 200


def test_normalize_phone():
    assert normalize_phone("+880 1712-345678") == normalize_phone("01712345678") == "01712345678"
    assert normalize_phone("00 880 1712 345678") == "01712345678"
    assert normalize_phone("+44 7700 900123") == "447700900123"
    assert normalize_phone("") == ""


# ---- new End QR, expiry --------------------------------------------------------------------------

def test_new_end_qr_replaces_the_old_one(client, db):
    driver, _, p, trip_id = running_trip(client, db)
    old = token_of(end(client, driver, trip_id).json()["end_qr"])
    new = token_of(client.post(f"/api/trips/{trip_id}/end-qr", headers=auth("driver", driver.id)).json()["end_qr"])
    r = confirm_end(client, old, employee_id=p.employee_id)
    assert r.status_code == 410 and r.json()["detail"]["code"] == "QR_REPLACED"
    assert confirm_end(client, new, employee_id=p.employee_id).status_code == 200


def test_end_qr_expires(client, db):
    driver, _, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    tok = db.scalar(select(TripToken).where(TripToken.trip_id == trip_id, TripToken.kind == "end"))
    tok.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.flush()
    r = confirm_end(client, raw, employee_id=p.employee_id)
    assert r.status_code == 410 and r.json()["detail"]["code"] == "QR_EXPIRED"
    new = token_of(client.post(f"/api/trips/{trip_id}/end-qr", headers=auth("driver", driver.id)).json()["end_qr"])
    assert confirm_end(client, new, employee_id=p.employee_id).status_code == 200


def test_new_end_qr_only_while_waiting_for_the_end_confirmation(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    r = client.post(f"/api/trips/{trip_id}/end-qr", headers=auth("driver", driver.id))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TRIP_NOT_WAITING_END"
    other = make_driver(db, "Other")
    end(client, driver, trip_id)
    assert client.post(f"/api/trips/{trip_id}/end-qr", headers=auth("driver", other.id)).status_code == 404
