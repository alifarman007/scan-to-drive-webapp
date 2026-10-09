"""Admin: drivers, passengers and the Excel import."""
import io
import uuid

import pytest
from openpyxl import Workbook
from sqlalchemy import select

from app.models import AdminRole, Driver, Passenger, TripEvent
from tests.test_admin_trips import hdr, make_admin
from tests.test_auth import make_driver as make_driver_with_pin
from tests.test_cant_scan import cant_scan
from tests.test_end_trip import (  # noqa: F401  (client fixture comes from there)
    client, end, make_passenger, running_trip,
)
from tests.test_trips import auth, make_car, make_driver, start


def uid():
    return uuid.uuid4().hex[:6].upper()


def audit(db, name, key, value):
    return [e for e in db.scalars(select(TripEvent).where(TripEvent.event == name)) if e.detail.get(key) == value]


def req(client, admin, method, path, **kw):
    return client.request(method, f"/api/admin{path}", headers=hdr(admin), **kw)


# ================= drivers =================

def add_driver(client, admin, **kw):
    body = {"employee_id": f"D-{uid()}", "name": "Abdul Karim", "phone": "01711000000", "license_no": "LIC-77"}
    body.update(kw)
    return req(client, admin, "POST", "/drivers", json=body)


def test_admin_adds_a_driver_who_then_chooses_a_pin(client, db):
    admin = make_admin(db)
    r = add_driver(client, admin, employee_id="  D-NEW-1 ")
    assert r.status_code == 201
    d = r.json()["driver"]
    assert d["employee_id"] == "D-NEW-1" and d["status"] == "active" and d["has_pin"] is False and d["total_trips"] == 0
    assert audit(db, "driver_created", "driver_id", d["id"])[0].actor == f"admin:{admin.username}"
    # the new driver signs in: PIN not set yet, then sets one, then signs in with it
    assert client.post("/api/auth/driver/login", json={"employee_id": "D-NEW-1", "pin": "1234"}).status_code == 409
    assert client.post("/api/auth/driver/set-pin", json={"employee_id": "D-NEW-1", "pin": "1234"}).status_code == 200
    assert client.post("/api/auth/driver/login", json={"employee_id": "D-NEW-1", "pin": "1234"}).status_code == 200
    assert req(client, admin, "GET", f"/drivers/{d['id']}").json()["driver"]["has_pin"] is True


def test_driver_checks(client, db):
    admin = make_admin(db)
    first = add_driver(client, admin).json()["driver"]
    r = add_driver(client, admin, employee_id=first["employee_id"].lower())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "EMPLOYEE_ID_EXISTS"
    for bad in ({"employee_id": " "}, {"name": ""}, {"phone": "1" * 31}, {"pin": "1234"}):
        assert add_driver(client, admin, **bad).status_code == 422, bad
    # optional fields may be left out or blank
    r = req(client, admin, "POST", "/drivers", json={"employee_id": f"D-{uid()}", "name": "No Phone", "phone": "  "})
    assert r.status_code == 201 and r.json()["driver"]["phone"] is None


def test_edit_driver(client, db):
    admin = make_admin(db)
    d = add_driver(client, admin).json()["driver"]
    r = req(client, admin, "PATCH", f"/drivers/{d['id']}", json={"name": " Abdul K. ", "phone": "", "license_no": "LIC-99"})
    assert r.status_code == 200
    out = r.json()["driver"]
    assert out["name"] == "Abdul K." and out["phone"] is None and out["license_no"] == "LIC-99"
    ev = audit(db, "driver_updated", "driver_id", d["id"])[0]
    assert ev.detail["before"]["name"] == "Abdul Karim" and ev.detail["after"]["phone"] is None
    assert req(client, admin, "PATCH", f"/drivers/{d['id']}", json={"employee_id": "X"}).status_code == 422  # not changeable
    assert req(client, admin, "PATCH", f"/drivers/{d['id']}", json={}).json()["detail"]["code"] == "NOTHING_TO_CHANGE"
    assert req(client, admin, "PATCH", f"/drivers/{d['id']}", json={"name": None}).status_code == 422
    assert req(client, admin, "PATCH", "/drivers/999999", json={"name": "X"}).status_code == 404


def test_reset_pin(client, db):
    admin = make_admin(db)
    driver = make_driver_with_pin(db, pin="1234")
    assert client.post("/api/auth/driver/login", json={"employee_id": driver.employee_id, "pin": "1234"}).status_code == 200
    r = req(client, admin, "POST", f"/drivers/{driver.id}/reset-pin")
    assert r.status_code == 200 and r.json()["driver"]["has_pin"] is False
    assert client.post("/api/auth/driver/login", json={"employee_id": driver.employee_id, "pin": "1234"}).status_code == 409
    assert client.post("/api/auth/driver/set-pin", json={"employee_id": driver.employee_id, "pin": "5678"}).status_code == 200
    assert client.post("/api/auth/driver/login", json={"employee_id": driver.employee_id, "pin": "5678"}).status_code == 200
    assert audit(db, "driver_pin_reset", "driver_id", driver.id)
    assert req(client, admin, "POST", "/drivers/999999/reset-pin").status_code == 404


def test_deactivated_driver_is_locked_out_and_can_return(client, db):
    admin = make_admin(db)
    driver = make_driver_with_pin(db, pin="1234")
    token = auth("driver", driver.id)
    assert client.get("/api/trips/active", headers=token).status_code == 200
    assert req(client, admin, "PATCH", f"/drivers/{driver.id}", json={"status": "inactive"}).status_code == 200
    assert client.get("/api/trips/active", headers=token).status_code == 401  # the saved sign-in stops working
    assert client.post("/api/auth/driver/login", json={"employee_id": driver.employee_id, "pin": "1234"}).status_code == 401
    assert req(client, admin, "PATCH", f"/drivers/{driver.id}", json={"status": "active"}).status_code == 200
    assert client.get("/api/trips/active", headers=token).status_code == 200


def test_driver_with_an_open_trip_cannot_be_deactivated(client, db):
    admin = make_admin(db)
    driver, _, _, t = running_trip(client, db)
    r = req(client, admin, "PATCH", f"/drivers/{driver.id}", json={"status": "inactive"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "DRIVER_HAS_OPEN_TRIP"
    assert client.post(f"/api/admin/trips/{t}/close", json={"reason": "stuck"}, headers=hdr(admin)).status_code == 200
    assert req(client, admin, "PATCH", f"/drivers/{driver.id}", json={"status": "inactive"}).status_code == 200


def test_driver_list_search_and_totals(client, db):
    admin = make_admin(db)
    driver, car, _, t = running_trip(client, db)
    end(client, driver, t)
    cant_scan(client, driver, t, end_stage=True)
    d = req(client, admin, "GET", f"/drivers/{driver.id}").json()["driver"]
    assert d["total_trips"] == 1 and d["total_km"] == 38 and d["last_trip_at"] and d["open_trip"] is None
    rows = lambda **p: [x["id"] for x in req(client, admin, "GET", "/drivers", params=p).json()["drivers"]]
    assert driver.id in rows(q=driver.employee_id.lower()) and driver.id in rows(q=driver.name[:4].lower())
    assert rows(q="%") == []
    assert driver.id not in rows(status="inactive") and driver.id in rows(status="active")
    assert req(client, admin, "GET", "/drivers", params={"status": "weird"}).status_code == 422
    assert req(client, admin, "GET", "/drivers/999999").status_code == 404


def test_cancelled_trips_are_counted_separately(client, db):
    admin = make_admin(db)
    car, driver = make_car(db), make_driver(db)
    t = start(client, driver, car).json()["trip"]["id"]
    client.post(f"/api/trips/{t}/cancel", json={"reason": "wrong car"}, headers=auth("driver", driver.id))
    d = req(client, admin, "GET", f"/drivers/{driver.id}").json()["driver"]
    assert d["total_trips"] == 0 and d["cancelled_trips"] == 1


# ================= passengers =================

def add_passenger(client, admin, **kw):
    body = {"employee_id": f"E-{uid()}", "name": "Tania Akter", "department": "Accounts", "phone": "01911000000"}
    body.update(kw)
    return req(client, admin, "POST", "/passengers", json=body)


def test_admin_adds_edits_and_deactivates_a_passenger(client, db):
    admin = make_admin(db)
    r = add_passenger(client, admin)
    assert r.status_code == 201
    p = r.json()["passenger"]
    assert p["status"] == "active" and p["department"] == "Accounts" and p["total_trips"] == 0
    assert audit(db, "passenger_created", "passenger_id", p["id"])

    r = req(client, admin, "PATCH", f"/passengers/{p['id']}", json={"department": "Compliance", "phone": ""})
    assert r.json()["passenger"]["department"] == "Compliance" and r.json()["passenger"]["phone"] is None
    ev = audit(db, "passenger_updated", "passenger_id", p["id"])[0]
    assert ev.detail["before"]["department"] == "Accounts"
    assert req(client, admin, "PATCH", f"/passengers/{p['id']}", json={"employee_id": "X"}).status_code == 422
    assert req(client, admin, "PATCH", "/passengers/999999", json={"name": "X"}).status_code == 404


def test_inactive_passenger_is_not_found_on_the_passenger_page(client, db):
    admin = make_admin(db)
    car, driver = make_car(db), make_driver(db)
    raw = start(client, driver, car).json()["start_qr"]["url"].rsplit("/p/", 1)[1]
    p = add_passenger(client, admin).json()["passenger"]
    req(client, admin, "PATCH", f"/passengers/{p['id']}", json={"status": "inactive"})
    r = client.post(f"/api/p/{raw}/lookup", json={"employee_id": p["employee_id"]})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "ID_NOT_FOUND"
    req(client, admin, "PATCH", f"/passengers/{p['id']}", json={"status": "active"})
    assert client.post(f"/api/p/{raw}/lookup", json={"employee_id": p["employee_id"]}).status_code == 200


def test_passenger_duplicates_and_checks(client, db):
    admin = make_admin(db)
    p = add_passenger(client, admin).json()["passenger"]
    r = add_passenger(client, admin, employee_id=p["employee_id"].lower())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "EMPLOYEE_ID_EXISTS"
    for bad in ({"employee_id": ""}, {"name": "  "}, {"department": "x" * 121}):
        assert add_passenger(client, admin, **bad).status_code == 422, bad


def test_passenger_list_filters_and_paging(client, db):
    admin = make_admin(db)
    dept = f"Dept-{uid()}"
    ids = [add_passenger(client, admin, name=f"Person {i}", department=dept).json()["passenger"]["id"] for i in range(3)]
    other = add_passenger(client, admin, department="Elsewhere-" + uid()).json()["passenger"]
    body = req(client, admin, "GET", "/passengers", params={"department": dept.lower()}).json()
    assert [p["id"] for p in body["passengers"]] == ids and body["total"] == 3
    page = req(client, admin, "GET", "/passengers", params={"department": dept, "limit": 2, "offset": 2}).json()
    assert [p["id"] for p in page["passengers"]] == ids[2:] and page["total"] == 3
    assert req(client, admin, "GET", "/passengers", params={"q": other["employee_id"].lower()}).json()["total"] == 1
    assert req(client, admin, "GET", "/passengers", params={"q": "%"}).json()["total"] == 0
    assert dept in req(client, admin, "GET", "/passengers/departments").json()["departments"]
    assert req(client, admin, "GET", "/passengers", params={"limit": 500}).status_code == 422
    assert req(client, admin, "GET", f"/passengers/{ids[0]}").json()["passenger"]["name"] == "Person 0"


def test_passenger_totals(client, db):
    admin = make_admin(db)
    driver, _, p, t = running_trip(client, db)
    end(client, driver, t)
    cant_scan(client, driver, t, end_stage=True)
    row = req(client, admin, "GET", f"/passengers/{p.id}").json()["passenger"]
    assert row["total_trips"] == 1 and row["total_km"] == 38


# ================= Excel import =================

def xlsx(rows, headings=("Employee ID", "Name", "Department", "Phone")):
    wb = Workbook()
    ws = wb.active
    if headings:
        ws.append(list(headings))
    for r in rows:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def do_import(client, admin, data, dry_run=False, name="staff.xlsx"):
    return client.post("/api/admin/passengers/import", params={"dry_run": str(dry_run).lower()}, headers=hdr(admin),
                       files={"file": (name, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})


def test_import_adds_and_updates(client, db):
    admin = make_admin(db)
    a, b = f"IMP-{uid()}", f"IMP-{uid()}"
    r = do_import(client, admin, xlsx([(a, "Alice One", "HR", "01711111111"), (b, "Bob Two", None, None)]))
    assert r.status_code == 200
    assert (r.json()["created"], r.json()["updated"], r.json()["skipped"]) == (2, 0, 0)
    pa = db.scalar(select(Passenger).where(Passenger.employee_id == a))
    assert pa.name == "Alice One" and pa.department == "HR" and pa.phone == "01711111111"
    assert db.scalar(select(Passenger.department).where(Passenger.employee_id == b)) is None

    # again: one changed, one the same, one new; a blank department keeps the old one
    c = f"IMP-{uid()}"
    r = do_import(client, admin, xlsx([(a, "Alice Renamed", "Finance", None), (b, "Bob Two", "", ""), (c, "Carol", "IT", "")]))
    body = r.json()
    assert (body["created"], body["updated"], body["unchanged"]) == (1, 1, 1)
    db.refresh(pa)
    assert pa.name == "Alice Renamed" and pa.department == "Finance" and pa.phone == "01711111111"
    ev = audit(db, "passengers_imported", "file", "staff.xlsx")[-1]
    assert ev.detail["created"] == 1 and ev.actor == f"admin:{admin.username}"


def test_import_dry_run_changes_nothing(client, db):
    admin = make_admin(db)
    a = f"IMP-{uid()}"
    r = do_import(client, admin, xlsx([(a, "Alice", "HR", None)]), dry_run=True)
    assert r.json()["dry_run"] is True and r.json()["created"] == 1
    assert db.scalar(select(Passenger).where(Passenger.employee_id == a)) is None


def test_import_headings_in_any_order_and_numbers(client, db):
    admin = make_admin(db)
    n = 880000 + int(uid(), 16) % 100000
    data = xlsx([("Rina", float(n), "Sales", 1711223344)], headings=("full name", " Emp-ID ", "DEPT", "Mobile No"))
    r = do_import(client, admin, data)
    assert r.status_code == 200 and r.json()["created"] == 1, r.text
    p = db.scalar(select(Passenger).where(Passenger.employee_id == str(n)))  # 880123.0 is stored as 880123
    assert p.name == "Rina" and p.department == "Sales" and p.phone == "1711223344"


def test_import_skips_bad_rows_and_saves_the_rest(client, db):
    admin = make_admin(db)
    a, d = f"IMP-{uid()}", f"IMP-{uid()}"
    r = do_import(client, admin, xlsx([
        (a, "Good", "HR", None),
        ("", "No ID", None, None),
        (f"IMP-{uid()}", "", None, None),
        (a.lower(), "Duplicate in file", None, None),
        (None, None, None, None),            # empty line, ignored
        ("X" * 41, "Long id", None, None),
        (d, "Also good", None, None),
    ]))
    body = r.json()
    assert (body["created"], body["skipped"]) == (2, 4)
    assert [e["row"] for e in body["errors"]] == [3, 4, 5, 7]
    assert "row 2" in body["errors"][2]["problem"]
    assert db.scalar(select(Passenger).where(Passenger.employee_id == d)) is not None


def test_import_rejects_unusable_files(client, db):
    admin = make_admin(db)
    for data, code in ((b"not an excel file", "BAD_IMPORT_FILE"), (xlsx([("a", "b")], headings=("Foo", "Bar")), "BAD_IMPORT_FILE"),
                       (xlsx([("E1", "Name")], headings=("Employee ID",)), "BAD_IMPORT_FILE"), (xlsx([], headings=None), "BAD_IMPORT_FILE")):
        r = do_import(client, admin, data)
        assert r.status_code == 422 and r.json()["detail"]["code"] == code
    assert client.post("/api/admin/passengers/import", headers=hdr(admin)).status_code == 422  # no file at all


def test_import_does_not_deactivate_or_reactivate_anyone(client, db):
    admin = make_admin(db)
    p = add_passenger(client, admin).json()["passenger"]
    req(client, admin, "PATCH", f"/passengers/{p['id']}", json={"status": "inactive"})
    do_import(client, admin, xlsx([(p["employee_id"], "New Name", None, None)]))
    row = req(client, admin, "GET", f"/passengers/{p['id']}").json()["passenger"]
    assert row["name"] == "New Name" and row["status"] == "inactive"


# ================= permissions =================

def test_viewers_look_but_do_not_change_and_others_are_refused(client, db):
    admin, viewer = make_admin(db), make_admin(db, AdminRole.viewer)
    driver = make_driver(db)
    p = add_passenger(client, admin).json()["passenger"]
    for method, path, kw in (
        ("POST", "/drivers", {"json": {"employee_id": "V1", "name": "X"}}),
        ("PATCH", f"/drivers/{driver.id}", {"json": {"name": "X"}}),
        ("POST", f"/drivers/{driver.id}/reset-pin", {}),
        ("POST", "/passengers", {"json": {"employee_id": "V2", "name": "X"}}),
        ("PATCH", f"/passengers/{p['id']}", {"json": {"name": "X"}}),
    ):
        assert req(client, viewer, method, path, **kw).status_code == 403, path
    assert do_import(client, viewer, xlsx([("A1", "B")])).status_code == 403
    for path in ("/drivers", f"/drivers/{driver.id}", "/passengers", f"/passengers/{p['id']}", "/passengers/departments"):
        assert req(client, viewer, "GET", path).status_code == 200, path
        assert client.get(f"/api/admin{path}", headers=auth("driver", driver.id)).status_code == 403
        assert client.get(f"/api/admin{path}").status_code in (401, 403)
