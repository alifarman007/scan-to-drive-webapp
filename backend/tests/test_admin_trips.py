"""Admin close of a stuck trip and unlock of a trip blocked by wrong IDs."""
import pytest
from sqlalchemy import select

from app.models import AdminRole, AdminUser, Alert, TripToken
from tests.test_end_trip import (  # noqa: F401  (client fixture comes from there)
    _uid, client, confirm_end, end, events, make_passenger, running_trip, token_of,
)
from tests.test_trips import auth, make_car, make_driver, start


def make_admin(db, role=AdminRole.admin):
    a = AdminUser(username=f"a-{_uid()}", role=role, password_hash="x")
    db.add(a)
    db.flush()
    return a


def hdr(a):
    return auth("admin", a.id, a.role.value)


def close(client, admin, trip_id, **body):
    body.setdefault("reason", "Driver forgot to end the trip")
    return client.post(f"/api/admin/trips/{trip_id}/close", json=body, headers=hdr(admin))


def unlock(client, admin, trip_id, reason="Passenger was in a hurry"):
    return client.post(f"/api/admin/trips/{trip_id}/unlock", json={"reason": reason}, headers=hdr(admin))


def block_end(client, db):
    driver, car, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    for _ in range(5):
        confirm_end(client, raw, employee_id="NOPE")
    return driver, car, p, trip_id


# ---- close ----------------------------------------------------------------------------------

def test_admin_closes_a_trip_waiting_for_the_end_confirmation(client, db):
    driver, car, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    admin = make_admin(db)
    r = close(client, admin, trip_id)
    assert r.status_code == 200
    t = r.json()["trip"]
    assert t["status"] == "closed_by_admin" and t["needs_review"] is True
    assert t["close_reason"] == "Driver forgot to end the trip" and t["end_km"] == 45038
    db.refresh(car)
    assert car.current_km == 45038  # the driver's end km is kept
    # the old End QR is dead, and car + driver are free again
    assert confirm_end(client, raw, employee_id=p.employee_id).status_code == 410
    assert client.get("/api/trips/active", headers=auth("driver", driver.id)).json()["trip"] is None
    assert start(client, driver, car, start_km=45038).status_code == 201
    ev = events(db, "trip_closed_by_admin", trip_id)[0]
    assert ev.actor == f"admin:{admin.username}"
    alert = db.scalar(select(Alert).where(Alert.trip_id == trip_id, Alert.type == "admin_closed"))
    assert alert.status.value == "solved" and alert.resolved_by == admin.id


def test_admin_closes_a_running_trip_and_may_type_the_end_km(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    r = close(client, make_admin(db), trip_id, end_km=45120)
    assert r.status_code == 200
    t = r.json()["trip"]
    assert t["end_km"] == 45120 and t["distance_km"] == 120 and t["end_time"]
    db.refresh(car)
    assert car.current_km == 45120


def test_closing_without_an_end_km_leaves_the_car_km_alone(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    t = close(client, make_admin(db), trip_id).json()["trip"]
    assert t["end_km"] is None and t["distance_km"] is None
    db.refresh(car)
    assert car.current_km == 45000


def test_admin_closes_a_trip_still_waiting_for_the_passenger(client, db):
    car, driver = make_car(db), make_driver(db)
    trip_id = start(client, driver, car).json()["trip"]["id"]
    assert close(client, make_admin(db), trip_id).status_code == 200


def test_close_end_km_checks(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    admin = make_admin(db)
    r = close(client, admin, trip_id, end_km=45000)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "END_KM_TOO_LOW"
    end(client, driver, trip_id)
    r = close(client, admin, trip_id, end_km=46000)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "END_KM_ALREADY_SET"


def test_close_needs_a_reason(client, db):
    _, _, _, trip_id = running_trip(client, db)
    admin = make_admin(db)
    assert close(client, admin, trip_id, reason="").status_code == 422
    assert close(client, admin, trip_id, reason="   ").status_code == 422


def test_cannot_close_a_finished_trip_twice(client, db):
    _, _, _, trip_id = running_trip(client, db)
    admin = make_admin(db)
    assert close(client, admin, trip_id).status_code == 200
    r = close(client, admin, trip_id)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TRIP_NOT_OPEN"


def test_close_unknown_trip(client, db):
    assert close(client, make_admin(db), 999999).status_code == 404


def test_only_an_admin_may_close_or_unlock(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    viewer = make_admin(db, AdminRole.viewer)
    assert close(client, viewer, trip_id).status_code == 403
    assert unlock(client, viewer, trip_id).status_code == 403
    r = client.post(f"/api/admin/trips/{trip_id}/close", json={"reason": "x"}, headers=auth("driver", driver.id))
    assert r.status_code in (401, 403)
    assert client.post(f"/api/admin/trips/{trip_id}/close", json={"reason": "x"}).status_code in (401, 403)


def test_close_solves_the_open_wrong_id_alert(client, db):
    _, _, _, trip_id = block_end(client, db)
    close(client, make_admin(db), trip_id)
    alert = db.scalar(select(Alert).where(Alert.trip_id == trip_id, Alert.type == "wrong_ids"))
    assert alert.status.value == "solved"


# ---- unlock ---------------------------------------------------------------------------------

def test_unlock_gives_fresh_tries_at_the_end(client, db):
    driver, _, p, trip_id = block_end(client, db)
    assert client.post(f"/api/trips/{trip_id}/end-qr", headers=auth("driver", driver.id)).status_code == 423
    admin = make_admin(db)
    r = unlock(client, admin, trip_id)
    assert r.status_code == 200 and r.json()["stage"] == "end"
    assert events(db, "trip_unlocked", trip_id)[0].actor == f"admin:{admin.username}"
    alert = db.scalar(select(Alert).where(Alert.trip_id == trip_id, Alert.type == "wrong_ids"))
    assert alert.status.value == "solved" and alert.resolved_by == admin.id

    r = client.post(f"/api/trips/{trip_id}/end-qr", headers=auth("driver", driver.id))
    assert r.status_code == 200
    raw = token_of(r.json()["end_qr"])
    assert client.get(f"/api/p/{raw}").json()["tries_left"] == 5
    assert confirm_end(client, raw, employee_id=p.employee_id).status_code == 200


def test_unlock_works_at_the_start_too(client, db):
    car, driver = make_car(db), make_driver(db)
    body = start(client, driver, car).json()
    trip_id, raw = body["trip"]["id"], token_of(body["start_qr"])
    for _ in range(5):
        client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": "NOPE"})
    assert client.post(f"/api/trips/{trip_id}/start-qr", headers=auth("driver", driver.id)).status_code == 423
    r = unlock(client, make_admin(db), trip_id)
    assert r.status_code == 200 and r.json()["stage"] == "start"
    r = client.post(f"/api/trips/{trip_id}/start-qr", headers=auth("driver", driver.id))
    assert r.status_code == 200


def test_unlock_only_resets_the_blocked_stage(client, db):
    car, driver = make_car(db), make_driver(db)
    body = start(client, driver, car).json()
    trip_id, raw = body["trip"]["id"], token_of(body["start_qr"])
    for _ in range(2):
        client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": "NOPE"})
    p = make_passenger(db)
    client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": p.employee_id})
    end_raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    for _ in range(5):
        confirm_end(client, end_raw, employee_id="NOPE")
    unlock(client, make_admin(db), trip_id)
    start_fails = db.scalar(select(TripToken.failed_attempts).where(TripToken.trip_id == trip_id, TripToken.kind == "start"))
    assert start_fails == 2  # the earlier start-stage tries stay in the record


def test_unlock_a_trip_that_is_not_blocked(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    admin = make_admin(db)
    r = unlock(client, admin, trip_id)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_LOCKED"
    end(client, driver, trip_id)
    assert unlock(client, admin, trip_id).status_code == 409


def test_unlock_needs_a_reason(client, db):
    _, _, _, trip_id = block_end(client, db)
    assert unlock(client, make_admin(db), trip_id, reason=" ").status_code == 422


def test_close_ignores_end_km_zero_and_a_repeated_value(client, db):
    # Swagger sends "end_km": 0 in its example body; that must not block the close.
    driver, car, _, trip_id = running_trip(client, db)
    end(client, driver, trip_id)
    r = close(client, make_admin(db), trip_id, end_km=0)
    assert r.status_code == 200 and r.json()["trip"]["end_km"] == 45038


def test_close_accepts_the_same_end_km_again(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    end(client, driver, trip_id)
    assert close(client, make_admin(db), trip_id, end_km=45038).status_code == 200
