"""Background alert checks, driver reminders and the admin alerts list (PDF 11.3, 11.4)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import AdminRole, Alert, Trip
from app.services.jobs import run_checks
from tests.test_admin_trips import hdr, make_admin
from tests.test_cant_scan import cant_scan
from tests.test_end_trip import (  # noqa: F401  (client fixture comes from there)
    client, end, events, running_trip, set_setting, token_of,
)
from tests.test_trips import auth, make_car, make_driver, start


def later(**kw):
    return datetime.now(timezone.utc) + timedelta(**kw)


def alerts_for(db, trip_id, kind=None):
    stmt = select(Alert).where(Alert.trip_id == trip_id)
    if kind:
        stmt = stmt.where(Alert.type == kind)
    return db.scalars(stmt).all()


def reminders(client, driver):
    return client.get("/api/trips/active", headers=auth("driver", driver.id)).json()["reminders"]


# ---- long trip ----------------------------------------------------------------------------------

def test_long_trip_alert_after_the_set_hours(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    set_setting(db, "long_trip_hours", 6)
    run_checks(db, now=later(hours=5, minutes=50))
    assert alerts_for(db, trip_id, "long_trip") == []
    assert reminders(client, driver) == []

    run_checks(db, now=later(hours=6, minutes=5))
    [a] = alerts_for(db, trip_id, "long_trip")
    assert a.status.value == "open" and car.car_code in a.message and a.vehicle_id == car.id
    [r] = reminders(client, driver)
    assert r["type"] == "long_trip" and "end it" in r["message"]


def test_the_same_alert_is_not_raised_twice(client, db):
    _, _, _, trip_id = running_trip(client, db)
    run_checks(db, now=later(hours=7))
    run_checks(db, now=later(hours=8))
    assert len(alerts_for(db, trip_id, "long_trip")) == 1


def test_long_trip_limit_comes_from_the_settings(client, db):
    _, _, _, trip_id = running_trip(client, db)
    set_setting(db, "long_trip_hours", 1)
    run_checks(db, now=later(hours=1, minutes=1))
    assert len(alerts_for(db, trip_id, "long_trip")) == 1


def test_finished_trips_get_no_long_trip_alert(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    end(client, driver, trip_id)
    run_checks(db, now=later(hours=9))
    assert alerts_for(db, trip_id, "long_trip") == []


def test_reminder_stops_when_the_admin_solves_the_alert_or_the_trip_ends(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    run_checks(db, now=later(hours=7))
    assert len(reminders(client, driver)) == 1
    admin = make_admin(db)
    [a] = alerts_for(db, trip_id, "long_trip")
    assert client.post(f"/api/admin/alerts/{a.id}/solve", json={"note": "Driver called"}, headers=hdr(admin)).status_code == 200
    assert reminders(client, driver) == []


# ---- waiting too long ---------------------------------------------------------------------------

def test_waiting_for_the_passenger_too_long(client, db):
    car, driver = make_car(db), make_driver(db)
    trip_id = start(client, driver, car).json()["trip"]["id"]
    set_setting(db, "waiting_too_long_minutes", 30)
    run_checks(db, now=later(minutes=29))
    assert alerts_for(db, trip_id, "waiting_too_long") == []
    run_checks(db, now=later(minutes=31))
    [a] = alerts_for(db, trip_id, "waiting_too_long")
    assert "confirm the start" in a.message
    [r] = reminders(client, driver)
    assert r["type"] == "waiting_too_long" and "waiting for the passenger" in r["message"].lower()


def test_waiting_for_the_end_confirmation_too_long_is_a_separate_alert(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    end(client, driver, trip_id)
    run_checks(db, now=later(minutes=45))
    [a] = alerts_for(db, trip_id, "waiting_too_long")
    assert "confirm the end" in a.message
    run_checks(db, now=later(minutes=90))
    assert len(alerts_for(db, trip_id, "waiting_too_long")) == 1


def test_an_old_start_alert_does_not_hide_the_end_alert(client, db):
    car, driver = make_car(db), make_driver(db)
    body = start(client, driver, car).json()
    trip_id = body["trip"]["id"]
    run_checks(db, now=later(minutes=40))  # alert for the start stage
    from tests.test_end_trip import make_passenger
    p = make_passenger(db)
    client.post(f"/api/p/{token_of(body['start_qr'])}/confirm-start",
                json={"passenger_type": "employee", "employee_id": p.employee_id})
    end(client, driver, trip_id)
    trip = db.get(Trip, trip_id)
    trip.end_time = later(minutes=60)  # the end happened after the start alert (we cannot wait in a test)
    db.flush()
    run_checks(db, now=later(minutes=120))
    assert len(alerts_for(db, trip_id, "waiting_too_long")) == 2


def test_no_waiting_alert_once_the_trip_moves_on(client, db):
    car, driver = make_car(db), make_driver(db)
    trip_id = start(client, driver, car).json()["trip"]["id"]
    cant_scan(client, driver, trip_id)
    run_checks(db, now=later(minutes=50))
    assert alerts_for(db, trip_id, "waiting_too_long") == []


# ---- admin alerts list --------------------------------------------------------------------------

def test_admin_lists_filters_and_solves_alerts(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    run_checks(db, now=later(hours=7))
    admin, viewer = make_admin(db), make_admin(db, AdminRole.viewer)

    for who in (admin, viewer):
        r = client.get("/api/admin/alerts", params={"type": "long_trip"}, headers=hdr(who))
        assert r.status_code == 200
        mine = [a for a in r.json()["alerts"] if a["trip_id"] == trip_id]
        assert len(mine) == 1 and mine[0]["car_code"] == car.car_code and mine[0]["trip_no"] and mine[0]["status"] == "open"
    assert client.get("/api/admin/alerts", headers=auth("driver", driver.id)).status_code == 403
    assert client.get("/api/admin/alerts").status_code in (401, 403)

    alert_id = mine[0]["id"]
    assert client.post(f"/api/admin/alerts/{alert_id}/solve", json={}, headers=hdr(viewer)).status_code == 403
    r = client.post(f"/api/admin/alerts/{alert_id}/solve", json={"note": "  Driver was at the workshop "}, headers=hdr(admin))
    assert r.status_code == 200
    a = r.json()["alert"]
    assert a["status"] == "solved" and a["note"] == "Driver was at the workshop" and a["resolved_by"] == admin.id and a["resolved_at"]
    assert events(db, "alert_solved", trip_id)[0].actor == f"admin:{admin.username}"

    open_ids = [x["id"] for x in client.get("/api/admin/alerts", params={"limit": 200}, headers=hdr(admin)).json()["alerts"]]
    assert alert_id not in open_ids
    solved = client.get("/api/admin/alerts", params={"status": "solved", "limit": 200}, headers=hdr(admin)).json()["alerts"]
    assert alert_id in [x["id"] for x in solved]
    everything = client.get("/api/admin/alerts", params={"status": "all", "limit": 200}, headers=hdr(admin)).json()
    assert everything["total"] >= 1


def test_solving_twice_or_an_unknown_alert(client, db):
    _, _, _, trip_id = running_trip(client, db)
    run_checks(db, now=later(hours=7))
    admin = make_admin(db)
    [a] = alerts_for(db, trip_id, "long_trip")
    assert client.post(f"/api/admin/alerts/{a.id}/solve", json={}, headers=hdr(admin)).status_code == 200
    r = client.post(f"/api/admin/alerts/{a.id}/solve", json={}, headers=hdr(admin))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ALREADY_SOLVED"
    assert client.post("/api/admin/alerts/999999/solve", json={}, headers=hdr(admin)).status_code == 404


def test_alerts_list_rejects_bad_filters(client, db):
    admin = make_admin(db)
    assert client.get("/api/admin/alerts", params={"status": "weird"}, headers=hdr(admin)).status_code == 422
    assert client.get("/api/admin/alerts", params={"type": "nope"}, headers=hdr(admin)).status_code == 422
