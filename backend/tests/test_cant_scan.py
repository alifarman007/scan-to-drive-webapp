"""'Passenger can't scan' (PDF section 8): the driver skips a confirmation, the admin approves later."""
from sqlalchemy import select

from app.models import Trip
from tests.test_admin_trips import hdr, make_admin
from tests.test_end_trip import (  # noqa: F401  (client fixture comes from there)
    client, confirm_end, end, events, make_passenger, running_trip, set_setting, token_of,
)
from tests.test_trips import auth, make_car, make_driver, start
from app.models import AdminRole


def cant_scan(client, driver, trip_id, reason="Passenger's phone battery is dead", end_stage=False):
    path = "end-cant-scan" if end_stage else "cant-scan"
    return client.post(f"/api/trips/{trip_id}/{path}", json={"reason": reason}, headers=auth("driver", driver.id))


def decide(client, admin, trip_id, decision="approved", note=""):
    return client.post(f"/api/admin/trips/{trip_id}/approval", json={"decision": decision, "note": note}, headers=hdr(admin))


def waiting_trip(client, db):
    car, driver = make_car(db), make_driver(db)
    body = start(client, driver, car).json()
    return driver, car, body["trip"]["id"], token_of(body["start_qr"])


# ---- start ------------------------------------------------------------------------------------

def test_cant_scan_at_the_start_begins_the_trip_for_review(client, db):
    driver, car, trip_id, raw = waiting_trip(client, db)
    r = cant_scan(client, driver, trip_id)
    assert r.status_code == 200
    t = r.json()["trip"]
    assert t["status"] == "in_progress" and t["needs_review"] is True and t["approval_status"] == "pending"
    assert t["start_no_scan_reason"] == "Passenger's phone battery is dead" and t["journey_start_time"]
    assert events(db, "trip_started_unconfirmed", trip_id)[0].actor.startswith("driver:")
    # the Start QR no longer works, and the driver can end the trip as usual
    assert client.get(f"/api/p/{raw}").status_code == 410
    assert end(client, driver, trip_id).status_code == 200


def test_cant_scan_needs_a_reason(client, db):
    driver, _, trip_id, _ = waiting_trip(client, db)
    assert cant_scan(client, driver, trip_id, reason="   ").status_code == 422
    assert client.post(f"/api/trips/{trip_id}/cant-scan", json={}, headers=auth("driver", driver.id)).status_code == 422


def test_cant_scan_only_for_the_trips_driver_and_only_while_waiting(client, db):
    driver, _, trip_id, _ = waiting_trip(client, db)
    other = make_driver(db)
    assert cant_scan(client, other, trip_id).status_code == 404
    assert cant_scan(client, driver, trip_id).status_code == 200
    r = cant_scan(client, driver, trip_id)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TRIP_NOT_WAITING"


def test_cant_scan_works_after_the_trip_is_locked_by_wrong_ids(client, db):
    driver, _, trip_id, raw = waiting_trip(client, db)
    for _ in range(5):
        client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": "NOPE"})
    assert client.post(f"/api/trips/{trip_id}/start-qr", headers=auth("driver", driver.id)).status_code == 423
    assert cant_scan(client, driver, trip_id).status_code == 200  # still flagged for the admin


def test_cant_scan_can_be_switched_off(client, db):
    driver, _, trip_id, _ = waiting_trip(client, db)
    set_setting(db, "allow_cant_scan", 0)
    r = cant_scan(client, driver, trip_id)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "CANT_SCAN_NOT_ALLOWED"


# ---- end --------------------------------------------------------------------------------------

def test_cant_scan_at_the_end_completes_the_trip_for_review(client, db):
    driver, car, p, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    r = cant_scan(client, driver, trip_id, end_stage=True)
    assert r.status_code == 200
    t = r.json()["trip"]
    assert t["status"] == "completed" and t["approval_status"] == "pending" and t["needs_review"] is True
    assert t["end_no_scan_reason"] and t["end_confirm_time"] is None and t["passenger_name"] == p.name
    db.refresh(car)
    assert car.current_km == 45038
    assert confirm_end(client, raw, employee_id=p.employee_id).status_code == 410  # End QR is dead
    assert client.get("/api/trips/active", headers=auth("driver", driver.id)).json()["trip"] is None
    assert events(db, "trip_completed_unconfirmed", trip_id)


def test_end_cant_scan_only_while_waiting_for_the_end_confirmation(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    r = cant_scan(client, driver, trip_id, end_stage=True)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TRIP_NOT_WAITING_END"


def test_end_cant_scan_works_after_the_end_qr_is_locked(client, db):
    driver, _, _, trip_id = running_trip(client, db)
    raw = token_of(end(client, driver, trip_id).json()["end_qr"])
    for _ in range(5):
        confirm_end(client, raw, employee_id="NOPE")
    assert cant_scan(client, driver, trip_id, end_stage=True).status_code == 200


def test_both_stages_skipped(client, db):
    driver, car, trip_id, _ = waiting_trip(client, db)
    cant_scan(client, driver, trip_id)
    end(client, driver, trip_id)
    t = cant_scan(client, driver, trip_id, reason="Still no phone", end_stage=True).json()["trip"]
    assert t["start_no_scan_reason"] and t["end_no_scan_reason"] and t["status"] == "completed"


# ---- start skipped, passenger confirms the end ------------------------------------------------

def unconfirmed_trip_at_end(client, db):
    """Start skipped with "Passenger can't scan", driver ended: returns (driver, trip_id, raw End QR)."""
    driver, car, trip_id, _ = waiting_trip(client, db)
    cant_scan(client, driver, trip_id)
    return driver, trip_id, token_of(end(client, driver, trip_id).json()["end_qr"])


def test_end_page_asks_who_the_passenger_is_when_the_start_was_skipped(client, db):
    _, _, raw = unconfirmed_trip_at_end(client, db)
    page = client.get(f"/api/p/{raw}").json()
    assert page["identify"] is True and page["allow_visitors"] is True
    # a normal trip does not ask
    driver, car, p, trip_id = running_trip(client, db)
    normal = token_of(end(client, driver, trip_id).json()["end_qr"])
    assert client.get(f"/api/p/{normal}").json()["identify"] is False
    assert client.post(f"/api/p/{normal}/lookup", json={"employee_id": p.employee_id}).status_code == 409


def test_employee_identifies_at_the_end_and_the_trip_still_waits_for_approval(client, db):
    _, trip_id, raw = unconfirmed_trip_at_end(client, db)
    p = make_passenger(db, name="Faruk Ahmed")
    # the name check works on the End QR too, and a wrong ID counts as a wrong try
    r = client.post(f"/api/p/{raw}/lookup", json={"employee_id": "EMP-NOPE"})
    assert r.status_code == 404 and r.json()["detail"]["tries_left"] == 4
    assert client.post(f"/api/p/{raw}/lookup", json={"employee_id": p.employee_id.lower()}).json() == {"name": "Faruk Ahmed"}
    r = confirm_end(client, raw, employee_id=p.employee_id)
    assert r.status_code == 200
    t = db.get(Trip, trip_id)
    db.refresh(t)
    assert t.status.value == "completed" and t.passenger_id == p.id and t.end_confirm_time is not None
    assert t.approval_status == "pending" and t.needs_review is True  # the skipped start is still for the office
    assert events(db, "trip_completed", trip_id)[0].detail["identified_at_end"] is True


def test_visitor_identifies_at_the_end(client, db):
    _, trip_id, raw = unconfirmed_trip_at_end(client, db)
    no_name = client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "visitor", "phone": "01711 223344"})
    assert no_name.status_code == 422 and no_name.json()["detail"]["code"] == "NAME_REQUIRED"
    r = client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "visitor", "phone": "01711 223344",
                                                      "name": "Rahim Uddin", "reason": "Audit"})
    assert r.status_code == 200
    t = db.get(Trip, trip_id)
    db.refresh(t)
    assert t.is_visitor and t.visitor_name == "Rahim Uddin" and t.visitor_phone == "01711 223344"


def test_driver_cannot_identify_as_the_passenger_at_the_end(client, db):
    driver, _, raw = unconfirmed_trip_at_end(client, db)
    from app.models import Passenger
    db.add(Passenger(employee_id=driver.employee_id, name=driver.name))  # drivers are often in the staff list too
    db.flush()
    r = confirm_end(client, raw, employee_id=driver.employee_id)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "PASSENGER_IS_DRIVER"


# ---- admin approval ---------------------------------------------------------------------------

def test_admin_sees_and_approves_pending_trips(client, db):
    driver, _, trip_id, _ = waiting_trip(client, db)
    cant_scan(client, driver, trip_id)
    admin, viewer = make_admin(db), make_admin(db, AdminRole.viewer)

    for who in (admin, viewer):  # the viewer may look
        r = client.get("/api/admin/trips/approvals", headers=hdr(who))
        assert r.status_code == 200 and trip_id in [t["id"] for t in r.json()["trips"]]
    assert client.get("/api/admin/trips/approvals", headers=auth("driver", driver.id)).status_code == 403

    assert decide(client, viewer, trip_id).status_code == 403  # but cannot decide
    r = decide(client, admin, trip_id, "approved", "Checked with the driver")
    assert r.status_code == 200 and r.json()["trip"]["approval_status"] == "approved"
    trip = db.get(Trip, trip_id)
    assert trip.approved_by == admin.id and trip.approved_at and trip.approval_note == "Checked with the driver"
    assert events(db, "trip_approved", trip_id)[0].actor == f"admin:{admin.username}"
    assert trip_id not in [t["id"] for t in client.get("/api/admin/trips/approvals", headers=hdr(admin)).json()["trips"]]


def test_rejection_needs_a_note_and_keeps_the_trip(client, db):
    driver, _, trip_id, _ = waiting_trip(client, db)
    cant_scan(client, driver, trip_id)
    admin = make_admin(db)
    r = decide(client, admin, trip_id, "rejected", " ")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "NOTE_REQUIRED"
    r = decide(client, admin, trip_id, "rejected", "Nobody saw a passenger")
    assert r.status_code == 200
    t = r.json()["trip"]
    assert t["approval_status"] == "rejected" and t["status"] == "in_progress" and t["needs_review"] is True


def test_cannot_decide_twice_or_on_a_normal_trip(client, db):
    driver, _, trip_id, _ = waiting_trip(client, db)
    admin = make_admin(db)
    r = decide(client, admin, trip_id)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NO_PENDING_APPROVAL"  # nothing to approve
    cant_scan(client, driver, trip_id)
    assert decide(client, admin, trip_id).status_code == 200
    assert decide(client, admin, trip_id, "rejected", "changed my mind").status_code == 409
    assert decide(client, admin, 999999).status_code == 404


def test_normal_trips_have_no_approval_status(client, db):
    driver, _, p, trip_id = running_trip(client, db)
    t = end(client, driver, trip_id).json()["trip"]
    assert t["approval_status"] is None and t["start_no_scan_reason"] is None
