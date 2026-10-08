"""Car page and start-trip tests (PDF 6.2, 6.4, 6.5, section 12), through the real API."""
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import settings
from app.deps import get_db
from app.main import app
from app.models import (
    Alert, AdminRole, AdminUser, Driver, Setting, Trip, TripEvent, TripPhoto,
    TripToken, Vehicle, VehicleStatus,
)
from app.security import create_access_token, hash_secret
from app.services.tokens import hash_token
from app.storage import LocalStorage, get_storage

JPEG = b"\xff\xd8\xff" + b"0" * 2000


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def storage(tmp_path):
    return LocalStorage(tmp_path)


@pytest.fixture()
def client(db, storage):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_storage] = lambda: storage
    yield TestClient(app)
    app.dependency_overrides.clear()


def make_car(db, km=45000, **kw):
    v = Vehicle(car_code=f"C-{_uid()}", reg_number=f"R-{_uid()}", model="Axio", current_km=km, **kw)
    db.add(v)
    db.flush()
    return v


def make_driver(db, name="Rahim Uddin"):
    d = Driver(employee_id=f"E-{_uid()}", name=name, pin_hash=hash_secret("1234"))
    db.add(d)
    db.flush()
    return d


def auth(kind, id_, role=None):
    tok = create_access_token(kind, id_, timedelta(minutes=10), role)
    return {"Authorization": f"Bearer {tok}"}


def start_form(car, **kw):
    form = {"car_code": car.car_code, "qr_version": car.qr_version, "start_km": car.current_km,
            "start_place": "Head Office", "destination": "Factory, Gazipur",
            "with_passenger": "true", "purpose": "Office visit"}
    form.update(kw)
    return {k: v for k, v in form.items() if v is not None}


def start(client, driver, car, photo=JPEG, **kw):
    files = {"photo": ("dash.jpg", photo, "image/jpeg")} if photo is not None else None
    return client.post("/api/trips", data=start_form(car, **kw), files=files, headers=auth("driver", driver.id))


def set_setting(db, key, value):
    db.merge(Setting(key=key, value=str(value)))
    db.flush()


# ---- car page -----------------------------------------------------------------

def test_car_page_for_a_free_car(client, db):
    car, d = make_car(db, km=45230), make_driver(db)
    r = client.get(f"/api/cars/{car.car_code}", params={"v": 1}, headers=auth("driver", d.id))
    body = r.json()
    assert r.status_code == 200
    assert body["can_start"] is True and body["blocked"] is None
    assert body["car"]["last_end_km"] == 45230 and body["driver"]["name"] == "Rahim Uddin"


def test_car_page_needs_a_driver_login(client, db):
    car = make_car(db)
    assert client.get(f"/api/cars/{car.car_code}", params={"v": 1}).status_code == 401
    admin = AdminUser(username=f"a-{_uid()}", role=AdminRole.admin, password_hash="x")
    db.add(admin); db.flush()
    assert client.get(f"/api/cars/{car.car_code}", params={"v": 1}, headers=auth("admin", admin.id, "admin")).status_code == 403


def test_unknown_car_and_old_sticker(client, db):
    car, d = make_car(db), make_driver(db)
    assert client.get("/api/cars/NOPE", params={"v": 1}, headers=auth("driver", d.id)).status_code == 404
    car.qr_version = 2
    db.flush()
    r = client.get(f"/api/cars/{car.car_code}", params={"v": 1}, headers=auth("driver", d.id))
    assert r.status_code == 410 and r.json()["detail"]["code"] == "STICKER_OUTDATED"


def test_car_in_maintenance_cannot_start(client, db):
    car, d = make_car(db, status=VehicleStatus.maintenance), make_driver(db)
    r = client.get(f"/api/cars/{car.car_code}", params={"v": 1}, headers=auth("driver", d.id))
    assert r.json()["can_start"] is False and r.json()["blocked"]["code"] == "CAR_IN_MAINTENANCE"
    assert start(client, d, car).status_code == 409


def test_car_in_use_by_someone_else(client, db):
    car, karim, rahim = make_car(db), make_driver(db, "Karim H."), make_driver(db)
    assert start(client, karim, car).status_code == 201
    r = client.get(f"/api/cars/{car.car_code}", params={"v": 1}, headers=auth("driver", rahim.id))
    assert r.json()["blocked"]["code"] == "CAR_IN_USE"
    assert f"{car.car_code} is in use by Karim H." == r.json()["blocked"]["message"]
    again = start(client, rahim, car)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "CAR_IN_USE"


# ---- start trip: with passenger ---------------------------------------------------

def test_start_trip_with_passenger(client, db, storage, tmp_path):
    car, d = make_car(db, km=45230), make_driver(db)
    r = start(client, d, car, start_lat="23.8103", start_lng="90.4125")
    assert r.status_code == 201
    body = r.json()
    trip = body["trip"]
    assert trip["status"] == "waiting_for_passenger" and trip["trip_no"].startswith("T-")
    assert trip["journey_start_time"] is None and trip["passenger_name"] is None

    # one-time Start QR: a link, and only its hash is stored
    url = body["start_qr"]["url"]
    assert "/p/" in url
    raw = url.rsplit("/p/", 1)[1]
    tok = db.scalar(select(TripToken).where(TripToken.trip_id == trip["id"]))
    assert tok.token_hash == hash_token(raw) and raw not in tok.token_hash
    assert tok.used_at is None and tok.revoked_at is None and tok.kind.value == "start"

    # photo saved and recorded
    photo = db.scalar(select(TripPhoto).where(TripPhoto.trip_id == trip["id"]))
    assert photo.kind.value == "start" and (tmp_path / photo.file_url).read_bytes() == JPEG

    # audit record with GPS, and the car is now held
    ev = db.scalar(select(TripEvent).where(TripEvent.trip_id == trip["id"], TripEvent.event == "trip_started"))
    assert ev.actor == f"driver:{d.employee_id}" and float(ev.lat) == pytest.approx(23.8103)
    check = client.get(f"/api/cars/{car.car_code}", params={"v": 1}, headers=auth("driver", d.id)).json()
    assert check["blocked"]["code"] == "DRIVER_HAS_OPEN_TRIP"
    assert client.get("/api/trips/active", headers=auth("driver", d.id)).json()["trip"]["trip_no"] == trip["trip_no"]


def test_qr_expiry_uses_the_setting(client, db):
    set_setting(db, "qr_expiry_minutes", 7)
    car, d = make_car(db), make_driver(db)
    body = start(client, d, car).json()
    tok = db.scalar(select(TripToken).where(TripToken.trip_id == body["trip"]["id"]))
    minutes = (tok.expires_at - tok.created_at).total_seconds() / 60
    assert 6.5 < minutes < 7.5


# ---- start trip: without passenger ------------------------------------------------

def test_trip_without_passenger_goes_straight_to_in_progress(client, db):
    car, d = make_car(db), make_driver(db)
    r = start(client, d, car, with_passenger="false", purpose="Fuel the car")
    assert r.status_code == 201
    assert r.json()["trip"]["status"] == "in_progress" and r.json()["start_qr"] is None
    assert r.json()["trip"]["journey_start_time"] is not None
    assert db.scalar(select(func.count()).select_from(TripToken).where(TripToken.trip_id == r.json()["trip"]["id"])) == 0


def test_purpose_required_without_passenger(client, db):
    car, d = make_car(db), make_driver(db)
    r = start(client, d, car, with_passenger="false", purpose=None)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "PURPOSE_REQUIRED"
    assert start(client, d, car, with_passenger="false", purpose="   ").status_code == 422


# ---- km rules ----------------------------------------------------------------------

def test_start_km_below_last_end_km_is_blocked(client, db):
    car, d = make_car(db, km=45230), make_driver(db)
    r = start(client, d, car, start_km=45229)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "START_KM_TOO_LOW"
    assert r.json()["detail"]["last_end_km"] == 45230
    assert start(client, d, car, start_km=45230).status_code == 201  # equal is fine


def test_big_km_gap_raises_an_alert_but_is_allowed(client, db):
    set_setting(db, "km_gap_limit_km", 20)
    car, d = make_car(db, km=45000), make_driver(db)
    r = start(client, d, car, start_km=45120)
    assert r.status_code == 201
    alert = db.scalar(select(Alert).where(Alert.trip_id == r.json()["trip"]["id"]))
    assert alert.type.value == "km_gap" and alert.status.value == "open" and "120 km" in alert.message


def test_small_km_gap_raises_no_alert(client, db):
    set_setting(db, "km_gap_limit_km", 20)
    car, d = make_car(db, km=45000), make_driver(db)
    r = start(client, d, car, start_km=45015)
    assert r.status_code == 201
    assert db.scalar(select(func.count()).select_from(Alert).where(Alert.trip_id == r.json()["trip"]["id"])) == 0


# ---- photo rules -------------------------------------------------------------------

def test_photo_is_required(client, db):
    car, d = make_car(db), make_driver(db)
    assert start(client, d, car, photo=None).status_code == 422
    assert db.scalar(select(func.count()).select_from(Trip).where(Trip.vehicle_id == car.id)) == 0


def test_photo_must_be_a_real_image(client, db):
    car, d = make_car(db), make_driver(db)
    r = start(client, d, car, photo=b"%PDF-1.4 not an image")
    assert r.status_code == 400 and r.json()["detail"]["code"] == "INVALID_PHOTO"


def test_photo_size_limit(client, db, monkeypatch):
    monkeypatch.setattr(settings, "max_photo_mb", 1)
    car, d = make_car(db), make_driver(db)
    r = start(client, d, car, photo=b"\xff\xd8\xff" + b"0" * (1024 * 1024 + 10))
    assert r.status_code == 413 and r.json()["detail"]["code"] == "PHOTO_TOO_LARGE"


def test_nothing_is_saved_if_the_photo_cannot_be_stored(client, db):
    class BrokenStorage:
        def save(self, key, data): raise OSError("disk full")
        def delete(self, key): pass

    app.dependency_overrides[get_storage] = lambda: BrokenStorage()
    car, d = make_car(db), make_driver(db)
    r = start(client, d, car)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "PHOTO_SAVE_FAILED"
    assert db.scalar(select(func.count()).select_from(Trip).where(Trip.vehicle_id == car.id)) == 0
    assert start_ok_after_fix(client, db)


def start_ok_after_fix(client, db):
    app.dependency_overrides[get_storage] = lambda: LocalStorage("/tmp/s2d-test-uploads")
    car, d = make_car(db), make_driver(db)
    return start(client, d, car).status_code == 201


# ---- one open trip rules -------------------------------------------------------------

def test_driver_cannot_start_a_second_trip(client, db):
    car1, car2, d = make_car(db), make_car(db), make_driver(db)
    assert start(client, d, car1).status_code == 201
    r = start(client, d, car2)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "DRIVER_HAS_OPEN_TRIP"
    assert db.scalar(select(func.count()).select_from(Trip).where(Trip.vehicle_id == car2.id)) == 0


def test_wrong_sticker_version_cannot_start(client, db):
    car, d = make_car(db), make_driver(db)
    car.qr_version = 3
    db.flush()
    r = start(client, d, car, qr_version=1)
    assert r.status_code == 410


def test_form_validation(client, db):
    car, d = make_car(db), make_driver(db)
    assert start(client, d, car, start_km="-5").status_code == 422
    assert start(client, d, car, start_place="   ").status_code == 422
    assert start(client, d, car, start_lat="95").status_code == 422
    assert client.post("/api/trips", data=start_form(car), files={"photo": ("a.jpg", JPEG)}).status_code == 401


# ---- new QR and cancel -----------------------------------------------------------------

def test_make_new_start_qr_kills_the_old_one(client, db):
    car, d = make_car(db), make_driver(db)
    body = start(client, d, car).json()
    trip_id = body["trip"]["id"]
    r = client.post(f"/api/trips/{trip_id}/start-qr", headers=auth("driver", d.id))
    assert r.status_code == 200 and r.json()["start_qr"]["url"] != body["start_qr"]["url"]
    toks = db.scalars(select(TripToken).where(TripToken.trip_id == trip_id).order_by(TripToken.id)).all()
    assert len(toks) == 2 and toks[0].revoked_at is not None and toks[1].revoked_at is None


def test_only_the_trips_driver_can_renew_the_qr(client, db):
    car, d, other = make_car(db), make_driver(db), make_driver(db, "Other")
    trip_id = start(client, d, car).json()["trip"]["id"]
    assert client.post(f"/api/trips/{trip_id}/start-qr", headers=auth("driver", other.id)).status_code == 404


def test_driver_cancels_before_passenger_confirms(client, db):
    car, d = make_car(db), make_driver(db)
    trip_id = start(client, d, car).json()["trip"]["id"]
    assert client.post(f"/api/trips/{trip_id}/cancel", json={"reason": " "}, headers=auth("driver", d.id)).status_code == 422
    r = client.post(f"/api/trips/{trip_id}/cancel", json={"reason": "Wrong car"}, headers=auth("driver", d.id))
    assert r.status_code == 200 and r.json()["trip"]["status"] == "cancelled"
    assert r.json()["trip"]["close_reason"] == "Wrong car"
    assert db.scalar(select(TripToken.revoked_at).where(TripToken.trip_id == trip_id)) is not None
    assert client.get("/api/trips/active", headers=auth("driver", d.id)).json()["trip"] is None
    assert start(client, d, car).status_code == 201  # the car is free again


def test_cannot_cancel_after_the_journey_started(client, db):
    car, d = make_car(db), make_driver(db)
    trip_id = start(client, d, car, with_passenger="false", purpose="Fuel").json()["trip"]["id"]
    r = client.post(f"/api/trips/{trip_id}/cancel", json={"reason": "oops"}, headers=auth("driver", d.id))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TRIP_NOT_WAITING"


def test_admin_can_cancel_but_viewer_cannot(client, db):
    car, d = make_car(db), make_driver(db)
    trip_id = start(client, d, car).json()["trip"]["id"]
    viewer = AdminUser(username=f"v-{_uid()}", role=AdminRole.viewer, password_hash="x")
    admin = AdminUser(username=f"a-{_uid()}", role=AdminRole.admin, password_hash="x")
    db.add_all([viewer, admin]); db.flush()
    body = {"reason": "Passenger not found"}
    assert client.post(f"/api/trips/{trip_id}/cancel", json=body, headers=auth("admin", viewer.id, "viewer")).status_code == 403
    assert client.post(f"/api/trips/{trip_id}/cancel", json=body, headers=auth("admin", admin.id, "admin")).status_code == 200
    ev = db.scalar(select(TripEvent).where(TripEvent.trip_id == trip_id, TripEvent.event == "trip_cancelled"))
    assert ev.actor == f"admin:{admin.username}"
