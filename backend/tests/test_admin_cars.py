"""Admin: cars and QR stickers."""
import re
import shutil
import subprocess
import uuid

import pytest
from sqlalchemy import select

from app.models import AdminRole, Trip, TripEvent, Vehicle
from tests.test_admin_trips import hdr, make_admin
from tests.test_cant_scan import cant_scan
from tests.test_end_trip import (  # noqa: F401  (client fixture comes from there)
    client, end, events, running_trip,
)
from tests.test_trips import auth, make_car, make_driver, start


def uid():
    return uuid.uuid4().hex[:6].upper()


def new_car_body(**kw):
    body = {"car_code": f"T-{uid()}", "reg_number": f"DHAKA-{uid()}", "model": "Toyota Axio", "current_km": 1200}
    body.update(kw)
    return body


def create(client, admin, **kw):
    return client.post("/api/admin/cars", json=new_car_body(**kw), headers=hdr(admin))


def patch(client, admin, car_id, **body):
    return client.patch(f"/api/admin/cars/{car_id}", json=body, headers=hdr(admin))


def audit(db, name, car_id):
    return [e for e in db.scalars(select(TripEvent).where(TripEvent.event == name)) if e.detail.get("car_id") == car_id]


# ---- create -------------------------------------------------------------------------------------

def test_admin_adds_a_car(client, db):
    admin = make_admin(db)
    body = new_car_body(car_code=" t-" + uid().lower() + " ")
    r = client.post("/api/admin/cars", json=body, headers=hdr(admin))
    assert r.status_code == 201
    car = r.json()["car"]
    assert car["car_code"] == body["car_code"].strip().upper() and car["status"] == "active"
    assert car["current_km"] == 1200 and car["qr_version"] == 1 and car["total_trips"] == 0 and car["open_trip"] is None
    assert car["qr_link"].endswith(f"/c/{car['car_code']}?v=1")
    assert audit(db, "car_created", car["id"])[0].actor == f"admin:{admin.username}"


def test_new_car_can_start_a_trip_straight_away(client, db):
    admin, driver = make_admin(db), make_driver(db)
    car = create(client, admin, current_km=5000).json()["car"]
    r = client.get(f"/api/cars/{car['car_code']}", params={"v": 1}, headers=auth("driver", driver.id))
    assert r.status_code == 200 and r.json()["can_start"] is True and r.json()["car"]["last_end_km"] == 5000


@pytest.mark.parametrize("code", ["", "x", "CAR 11", "CAR_11", "-CAR", "A" * 21, "CAR/11"])
def test_bad_car_codes_are_rejected(client, db, code):
    assert create(client, make_admin(db), car_code=code).status_code == 422


def test_duplicates_are_rejected(client, db):
    admin = make_admin(db)
    first = create(client, admin).json()["car"]
    r = create(client, admin, car_code=first["car_code"].lower())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CAR_CODE_EXISTS"
    r = create(client, admin, reg_number=first["reg_number"].lower())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "REG_NUMBER_EXISTS"


def test_create_checks_the_fields(client, db):
    admin = make_admin(db)
    for bad in ({"reg_number": "  "}, {"model": ""}, {"current_km": -1}, {"status": "broken"}, {"current_km": 10**8}):
        assert create(client, admin, **bad).status_code == 422, bad
    r = client.post("/api/admin/cars", json={**new_car_body(), "qr_version": 9}, headers=hdr(admin))
    assert r.status_code == 422  # unknown fields are refused, so nobody sets the sticker version by hand


def test_only_admins_change_cars_viewers_look(client, db):
    admin, viewer = make_admin(db), make_admin(db, AdminRole.viewer)
    driver = make_driver(db)
    car = create(client, admin).json()["car"]
    assert create(client, viewer).status_code == 403
    assert patch(client, viewer, car["id"], model="X").status_code == 403
    assert client.post(f"/api/admin/cars/{car['id']}/new-sticker", headers=hdr(viewer)).status_code == 403
    assert client.get(f"/api/admin/cars/{car['id']}/qr.pdf", headers=hdr(viewer)).status_code == 403
    assert client.get("/api/admin/cars", headers=hdr(viewer)).status_code == 200
    assert client.get(f"/api/admin/cars/{car['id']}", headers=hdr(viewer)).status_code == 200
    for r in (client.get("/api/admin/cars"), client.get("/api/admin/cars", headers=auth("driver", driver.id))):
        assert r.status_code in (401, 403)


# ---- list and detail ----------------------------------------------------------------------------

def test_list_search_and_filter(client, db):
    admin = make_admin(db)
    a = create(client, admin, model="Unique Model Zed").json()["car"]
    b = create(client, admin, status="maintenance").json()["car"]
    cars = lambda **p: [c["id"] for c in client.get("/api/admin/cars", params=p, headers=hdr(admin)).json()["cars"]]
    assert cars(q="unique model zed") == [a["id"]]
    assert cars(q=a["reg_number"].lower()) == [a["id"]]
    assert cars(q=b["car_code"].lower()) == [b["id"]]
    assert b["id"] in cars(status="maintenance") and a["id"] not in cars(status="maintenance")
    assert cars(q="%") == []
    assert client.get("/api/admin/cars", params={"status": "weird"}, headers=hdr(admin)).status_code == 422


def test_list_and_detail_show_totals_and_open_trip(client, db):
    admin = make_admin(db)
    driver, car, _, t = running_trip(client, db)
    row = next(c for c in client.get("/api/admin/cars", params={"q": car.car_code}, headers=hdr(admin)).json()["cars"])
    assert row["open_trip"]["id"] == t and row["open_trip"]["driver_name"] == driver.name
    assert row["total_trips"] == 1 and row["total_km"] == 0  # km count once the trip is finished

    end(client, driver, t)
    cant_scan(client, driver, t, end_stage=True)
    d = client.get(f"/api/admin/cars/{car.id}", headers=hdr(admin)).json()
    assert d["car"]["total_km"] == 38 and d["car"]["current_km"] == 45038 and d["car"]["open_trip"] is None
    assert d["car"]["last_trip_at"] and [x["id"] for x in d["recent_trips"]] == [t]
    assert client.get("/api/admin/cars/999999", headers=hdr(admin)).status_code == 404


def test_cancelled_trips_are_not_counted(client, db):
    admin = make_admin(db)
    car, driver = make_car(db), make_driver(db)
    t = start(client, driver, car).json()["trip"]["id"]
    client.post(f"/api/trips/{t}/cancel", json={"reason": "wrong car"}, headers=auth("driver", driver.id))
    assert client.get(f"/api/admin/cars/{car.id}", headers=hdr(admin)).json()["car"]["total_trips"] == 0


# ---- edit ---------------------------------------------------------------------------------------

def test_edit_registration_and_model(client, db):
    admin = make_admin(db)
    car = create(client, admin).json()["car"]
    r = patch(client, admin, car["id"], reg_number="  DHAKA-NEW-1 ", model="Honda Civic")
    assert r.status_code == 200 and r.json()["car"]["reg_number"] == "DHAKA-NEW-1" and r.json()["car"]["model"] == "Honda Civic"
    ev = audit(db, "car_updated", car["id"])[0]
    assert ev.detail["before"]["model"] == "Toyota Axio" and ev.detail["after"]["model"] == "Honda Civic"
    assert r.json()["car"]["car_code"] == car["car_code"]


def test_car_code_cannot_be_changed(client, db):
    admin = make_admin(db)
    car = create(client, admin).json()["car"]
    assert patch(client, admin, car["id"], car_code="NEW-CODE").status_code == 422
    assert patch(client, admin, car["id"], qr_version=5).status_code == 422


def test_edit_checks(client, db):
    admin = make_admin(db)
    a, b = create(client, admin).json()["car"], create(client, admin).json()["car"]
    r = patch(client, admin, b["id"], reg_number=a["reg_number"].lower())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "REG_NUMBER_EXISTS"
    assert patch(client, admin, a["id"], reg_number=a["reg_number"]).status_code == 200  # its own number is fine
    assert patch(client, admin, a["id"]).json()["detail"]["code"] == "NOTHING_TO_CHANGE"
    assert patch(client, admin, a["id"], model=None).status_code == 422
    assert patch(client, admin, a["id"], model="  ").status_code == 422
    assert patch(client, admin, 999999, model="X").status_code == 404


def test_km_correction_needs_a_reason_and_is_logged(client, db):
    admin = make_admin(db)
    car = create(client, admin, current_km=100).json()["car"]
    r = patch(client, admin, car["id"], current_km=90000)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "REASON_REQUIRED"
    assert patch(client, admin, car["id"], current_km=90000, reason="  ").status_code == 422
    r = patch(client, admin, car["id"], current_km=90000, reason="Odometer replaced")
    assert r.status_code == 200 and r.json()["car"]["current_km"] == 90000
    ev = audit(db, "car_updated", car["id"])[0]
    assert ev.detail["before"]["current_km"] == 100 and ev.detail["reason"] == "Odometer replaced"


def test_maintenance_blocks_new_trips_and_active_brings_the_car_back(client, db):
    admin, driver = make_admin(db), make_driver(db)
    car = create(client, admin).json()["car"]
    code = car["car_code"]
    assert patch(client, admin, car["id"], status="maintenance").json()["car"]["status"] == "maintenance"
    r = client.get(f"/api/cars/{code}", params={"v": 1}, headers=auth("driver", driver.id)).json()
    assert r["can_start"] is False
    patch(client, admin, car["id"], status="inactive")
    assert client.get(f"/api/cars/{code}", params={"v": 1}, headers=auth("driver", driver.id)).json()["can_start"] is False
    patch(client, admin, car["id"], status="active")
    assert client.get(f"/api/cars/{code}", params={"v": 1}, headers=auth("driver", driver.id)).json()["can_start"] is True


def test_car_with_an_open_trip_cannot_go_to_maintenance(client, db):
    admin = make_admin(db)
    _, car, _, t = running_trip(client, db)
    r = patch(client, admin, car.id, status="maintenance")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CAR_HAS_OPEN_TRIP"
    assert patch(client, admin, car.id, model="Still editable").status_code == 200
    assert client.post(f"/api/admin/trips/{t}/close", json={"reason": "stuck"}, headers=hdr(admin)).status_code == 200
    assert patch(client, admin, car.id, status="maintenance").status_code == 200


# ---- stickers -----------------------------------------------------------------------------------

def test_new_sticker_stops_the_old_one(client, db):
    admin, driver = make_admin(db), make_driver(db)
    car = create(client, admin).json()["car"]
    code, h = car["car_code"], auth("driver", driver.id)
    assert client.get(f"/api/cars/{code}", params={"v": 1}, headers=h).status_code == 200
    r = client.post(f"/api/admin/cars/{car['id']}/new-sticker", headers=hdr(admin))
    assert r.status_code == 200 and r.json()["car"]["qr_version"] == 2 and r.json()["car"]["qr_link"].endswith("?v=2")
    old = client.get(f"/api/cars/{code}", params={"v": 1}, headers=h)
    assert old.status_code == 410 and old.json()["detail"]["code"] == "STICKER_OUTDATED"
    assert client.get(f"/api/cars/{code}", params={"v": 2}, headers=h).status_code == 200
    ev = audit(db, "car_sticker_renewed", car["id"])[0]
    assert ev.detail["old_version"] == 1 and ev.detail["new_version"] == 2


def test_sticker_pdf(client, db):
    admin = make_admin(db)
    car = create(client, admin).json()["car"]
    r = client.get(f"/api/admin/cars/{car['id']}/qr.pdf", headers=hdr(admin))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert r.headers["content-disposition"].startswith("attachment") and car["car_code"] in r.headers["content-disposition"]
    shown = client.get(f"/api/admin/cars/{car['id']}/qr.pdf", params={"inline": "true"}, headers=hdr(admin))
    assert shown.headers["content-disposition"].startswith("inline")
    # 6 x 6 cm = 170.08 points
    box = re.search(rb"/MediaBox \[ ?0 0 ([\d.]+) ([\d.]+) ?\]", r.content)
    assert box and abs(float(box.group(1)) - 170.08) < 0.5 and abs(float(box.group(2)) - 170.08) < 0.5

    a4 = client.get(f"/api/admin/cars/{car['id']}/qr.pdf", params={"layout": "a4"}, headers=hdr(admin))
    assert a4.status_code == 200 and re.search(rb"/MediaBox \[ ?0 0 595", a4.content)
    assert client.get(f"/api/admin/cars/{car['id']}/qr.pdf", params={"layout": "x"}, headers=hdr(admin)).status_code == 422
    assert client.get("/api/admin/cars/999999/qr.pdf", headers=hdr(admin)).status_code == 404
    assert len(audit(db, "car_sticker_printed", car["id"])) == 3


@pytest.mark.skipif(shutil.which("pdftotext") is None, reason="pdftotext is not installed")
def test_sticker_shows_the_car_code_and_text(client, db):
    admin = make_admin(db)
    car = create(client, admin).json()["car"]
    pdf = client.get(f"/api/admin/cars/{car['id']}/qr.pdf", headers=hdr(admin)).content
    text = subprocess.run(["pdftotext", "-", "-"], input=pdf, capture_output=True).stdout.decode()
    assert car["car_code"] in text and "Scan to start trip" in text


def test_the_qr_holds_only_the_car_link():
    from app.services.stickers import car_qr_link
    assert car_qr_link("CAR-03", 4).endswith("/c/CAR-03?v=4")


# ---- Epic and vendor cars -------------------------------------------------------------------------

def add_vendor(client, admin, name=None):
    return client.post("/api/admin/vendors", json={"name": name or f"Vendor {uid()}"}, headers=hdr(admin))


def test_cars_are_epic_unless_given_a_vendor(client, db):
    admin = make_admin(db)
    car = create(client, admin).json()["car"]
    assert car["owner"] == "epic" and car["vendor"] is None
    r = create(client, admin, owner="vendor")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "VENDOR_REQUIRED"
    assert create(client, admin, owner="vendor", vendor_id=999999).json()["detail"]["code"] == "VENDOR_NOT_FOUND"
    v = add_vendor(client, admin).json()["vendor"]
    assert create(client, admin, vendor_id=v["id"]).json()["detail"]["code"] == "VENDOR_FOR_EPIC_CAR"
    car = create(client, admin, owner="vendor", vendor_id=v["id"]).json()["car"]
    assert car["owner"] == "vendor" and car["vendor"] == {"id": v["id"], "name": v["name"]}
    assert audit(db, "car_created", car["id"])[0].detail["vendor_id"] == v["id"]


def test_a_car_moves_between_epic_and_vendors(client, db):
    admin = make_admin(db)
    v1, v2 = add_vendor(client, admin).json()["vendor"], add_vendor(client, admin).json()["vendor"]
    car = create(client, admin).json()["car"]
    assert patch(client, admin, car["id"], owner="vendor").json()["detail"]["code"] == "VENDOR_REQUIRED"
    r = patch(client, admin, car["id"], owner="vendor", vendor_id=v1["id"])
    assert r.status_code == 200 and r.json()["car"]["vendor"]["id"] == v1["id"]
    r = patch(client, admin, car["id"], vendor_id=v2["id"])  # another vendor
    assert r.json()["car"]["vendor"]["id"] == v2["id"]
    r = patch(client, admin, car["id"], owner="epic")  # back to Epic: the vendor goes with it
    assert r.json()["car"]["owner"] == "epic" and r.json()["car"]["vendor"] is None
    ev = audit(db, "car_updated", car["id"])[-1]
    assert ev.detail["before"]["owner"] == "vendor" and ev.detail["after"] == {"owner": "epic", "vendor_id": None}
    assert db.get(Vehicle, car["id"]).vendor_id is None


def test_list_filters_by_owner_and_vendor_and_lists_vendors(client, db):
    admin = make_admin(db)
    name = f"Lanka {uid()}"
    v = add_vendor(client, admin, name).json()["vendor"]
    mine = create(client, admin, owner="vendor", vendor_id=v["id"]).json()["car"]
    epic = create(client, admin).json()["car"]
    body = client.get("/api/admin/cars", params={"owner": "vendor"}, headers=hdr(admin)).json()
    codes = [c["car_code"] for c in body["cars"]]
    assert mine["car_code"] in codes and epic["car_code"] not in codes
    assert {"id": v["id"], "name": name, "cars": 1} in body["vendors"]
    by_vendor = client.get("/api/admin/cars", params={"vendor_id": v["id"]}, headers=hdr(admin)).json()["cars"]
    assert [c["car_code"] for c in by_vendor] == [mine["car_code"]]
    found = client.get("/api/admin/cars", params={"q": name.lower()}, headers=hdr(admin)).json()["cars"]  # search by vendor name
    assert [c["car_code"] for c in found] == [mine["car_code"]]


def test_vendors_are_added_renamed_and_removed_only_without_cars(client, db):
    admin = make_admin(db)
    name = f"Lanka {uid()}"
    r = add_vendor(client, admin, f"  {name}  ")
    assert r.status_code == 201 and r.json()["vendor"]["name"] == name
    v = r.json()["vendor"]
    assert add_vendor(client, admin, name.upper()).json()["detail"]["code"] == "VENDOR_EXISTS"
    assert add_vendor(client, admin, "  ").status_code == 422
    car = create(client, admin, owner="vendor", vendor_id=v["id"]).json()["car"]

    new = f"Lanka Bangla {uid()}"
    r = client.patch(f"/api/admin/vendors/{v['id']}", json={"name": new}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["vendor"] == {"id": v["id"], "name": new, "cars": 1}
    assert client.get(f"/api/admin/cars/{car['id']}", headers=hdr(admin)).json()["car"]["vendor"]["name"] == new
    ev = [e for e in db.scalars(select(TripEvent).where(TripEvent.event == "vendor_renamed")) if e.detail["vendor_id"] == v["id"]]
    assert ev[0].detail == {"vendor_id": v["id"], "before": name, "after": new}

    r = client.delete(f"/api/admin/vendors/{v['id']}", headers=hdr(admin))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "VENDOR_HAS_CARS"
    patch(client, admin, car["id"], owner="epic")
    assert client.delete(f"/api/admin/vendors/{v['id']}", headers=hdr(admin)).status_code == 204
    assert client.patch(f"/api/admin/vendors/{v['id']}", json={"name": "X"}, headers=hdr(admin)).status_code == 404


def test_viewers_see_vendors_but_cannot_change_them(client, db):
    admin, viewer = make_admin(db), make_admin(db, role=AdminRole.viewer)
    v = add_vendor(client, admin).json()["vendor"]
    assert any(x["id"] == v["id"] for x in client.get("/api/admin/vendors", headers=hdr(viewer)).json()["vendors"])
    assert client.post("/api/admin/vendors", json={"name": "X"}, headers=hdr(viewer)).status_code == 403
    assert client.patch(f"/api/admin/vendors/{v['id']}", json={"name": "X"}, headers=hdr(viewer)).status_code == 403
    assert client.delete(f"/api/admin/vendors/{v['id']}", headers=hdr(viewer)).status_code == 403


def test_a_new_car_without_km_takes_the_first_trip_start_km_without_a_gap_alert(client, db):
    from app.models import Alert
    admin, driver = make_admin(db), make_driver(db)
    car = create(client, admin, current_km=0).json()["car"]
    assert car["km_known"] is False
    page = client.get(f"/api/cars/{car['car_code']}", headers=auth("driver", driver.id)).json()
    assert page["car"]["last_end_km"] is None  # nothing to hint yet
    r = start(client, driver, db.get(Vehicle, car["id"]), start_km=48210, with_passenger="false", purpose="Office errand")
    assert r.status_code == 201, r.text
    trip_id = r.json()["trip"]["id"]
    assert db.scalars(select(Alert).where(Alert.trip_id == trip_id)).all() == []
