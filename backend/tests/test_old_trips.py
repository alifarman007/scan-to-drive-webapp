"""Importing trips from the old Driver / Passenger Travel Log forms (CSV)."""
import csv
import io
import json
import random

from sqlalchemy import select

from app.models import AdminRole, Driver, Passenger, Trip, TripReview, Vehicle
from app.services.old_trips import match_driver, read_old_logs
from tests.test_admin_trips import hdr, make_admin
from tests.test_end_trip import client  # noqa: F401  (client fixture)

DRV_HEAD = ["Auto ID", "Driver Name", "Vehicle Number", "Journey Status", "Start Location", "Destination Location",
            "Current Location", "Start KM", "End KM", "Submission Date", "Form Name", "ID"]
PAX_HEAD = ["Auto ID", "Passenger Type", "Employee ID", "Driver Name", "Vehicle Number", "Commute Status",
            "Submission Date", "Driver Rating", "Driver Comment", "Driver Record ID"]


def csv_bytes(head, rows):
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=head)
    w.writeheader()
    for r in rows:
        w.writerow({k: r.get(k, "") for k in head})
    return out.getvalue().encode("utf-8-sig")


def start(id_, name, plate, when, km, frm="House", to="Office"):
    return {"ID": id_, "Driver Name": name, "Vehicle Number": plate, "Journey Status": "Start Trip",
            "Start Location": frm, "Destination Location": to, "Start KM": f"{km:,}", "Submission Date": when}


def end(id_, name, plate, when, km, at="Office"):
    return {"ID": id_, "Driver Name": name, "Vehicle Number": plate, "Journey Status": "End Trip",
            "Current Location": at, "End KM": f"{km:,}", "Submission Date": when}


def setup_fleet(db, name="Md. Kamrul Hasan (Babu)"):
    n = random.randint(10, 99)
    car = Vehicle(car_code=f"OLD-{random.randint(1000, 9999)}", reg_number=f"DM-GA {n}-{random.randint(1000, 9999)}",
                  model="Toyota", current_km=0)
    driver = Driver(employee_id=str(random.randint(3_000_000, 3_999_999)), name=name)
    db.add_all([car, driver])
    db.flush()
    return car, driver


def raw_plate(car):  # the way the old form wrote it: "DM GA -27-6992"
    city, rest = car.reg_number.split(" ")
    return f"DM {city.split('-')[1]} -{rest}"


# ---- reading the forms ------------------------------------------------------------------------------

def test_starts_and_ends_are_paired_per_car_by_plate(db):
    car, driver = setup_fleet(db)
    p = raw_plate(car)
    data = csv_bytes(DRV_HEAD, [
        start("10", "Babu", p, "10/13/2026 6:32 AM", 59299),
        end("12", "Babu", p, "10/13/2026 9:19 PM", 59403, at="House"),
        end("13", "Babu", p, "10/13/2026 9:30 PM", 59410),                  # an end without its start
        start("14", "Babu", p, "10/14/2026 6:04 AM", 59403),                # never ended
        start("15", "Babu", p, "10/14/2026 7:00 AM", 59410, frm="test"),
        end("16", "Babu", p, "10/14/2026 7:01 AM", 61000),                  # a form test
    ])
    pv = read_old_logs(db, data)
    by_key = {t.key: t for t in pv.trips}
    good = by_key["drv:10-12"]
    assert good.car.id == car.id and good.driver.id == driver.id and good.distance == 104 and good.importable
    assert not good.looks_like_test and good.end_place == "House"
    assert good.start_time.isoformat() == "2026-10-13T00:32:00+00:00"  # Bangladesh time in the form, UTC here
    assert "Started but never ended in the form" in by_key["drv:14-open"].problems
    test = by_key["drv:15-16"]
    assert test.looks_like_test and test.importable and any("test" in w for w in test.warnings)
    assert [s["row"] for s in pv.skipped] == ["13"]


def test_unknown_plate_and_backwards_km_are_problems(db):
    car, _ = setup_fleet(db)
    data = csv_bytes(DRV_HEAD, [
        start("1", "Babu", "TBD", "10/9/2026 6:00 AM", 5000), end("2", "Babu", "TBD", "10/9/2026 8:00 AM", 5050),
        start("3", "Babu", raw_plate(car), "10/9/2026 6:00 AM", 338890),
        end("4", "Babu", raw_plate(car), "10/9/2026 8:00 AM", 338845),
    ])
    trips = {t.key: t for t in read_old_logs(db, data).trips}
    assert any("No car with the number plate TBD" in p for p in trips["drv:1-2"].problems)
    assert any("is not above start km" in p for p in trips["drv:3-4"].problems)


def test_passenger_form_links_by_driver_record_id(db):
    car, _ = setup_fleet(db)
    p = raw_plate(car)
    drv = csv_bytes(DRV_HEAD, [start("40", "Babu", p, "10/13/2026 6:32 AM", 1000),
                               end("41", "Babu", p, "10/13/2026 8:32 AM", 1060)])
    pax = csv_bytes(PAX_HEAD, [
        {"Passenger Type": "Epic Employee", "Employee ID": "HK", "Commute Status": "Start Trip", "Driver Record ID": "40"},
        {"Passenger Type": "Epic Employee", "Employee ID": "5240209", "Commute Status": "Start Trip", "Driver Record ID": "40"},
        {"Passenger Type": "Epic Employee", "Employee ID": "5240209", "Commute Status": "End Trip", "Driver Rating": "4",
         "Driver Comment": "Very good", "Driver Record ID": "40"},
    ])
    t = read_old_logs(db, drv, pax).trips[0]
    assert t.passenger.employee_id == "5240209" and t.passenger.typed_ids == ["HK", "5240209"]
    assert t.passenger.rating == 4 and t.passenger.comment == "Very good"


def test_bad_file_is_refused(client, db):
    admin = make_admin(db)
    r = client.post("/api/admin/import/old-trips/preview", headers=hdr(admin),
                    files={"driver_log": ("x.csv", b"a,b\n1,2\n", "text/csv")})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "BAD_OLD_LOG"


# ---- matching driver names ------------------------------------------------------------------------

def people(*names):
    return [Driver(id=i + 1, employee_id=str(1239001 + i), name=n) for i, n in enumerate(names)]


def test_driver_names_from_the_old_form():
    ds = people("Md. Sirajul Islam (Liton)", "Md. Mizanur Rahman", "Md. ShaAlam", "Md. Salim Hossain", "Selim-2",
                "Md. Dainul Haque")
    pick = lambda old: (match_driver(old, None, ds)[0] or Driver(name="-")).name
    assert pick("Liton") == "Md. Sirajul Islam (Liton)"   # the name in brackets
    assert pick("Mizan") == "Md. Mizanur Rahman"          # short form
    assert pick("ShaAlom") == "Md. ShaAlam"               # small spelling difference
    assert pick("Dainul") == "Md. Dainul Haque"           # "Md." ignored
    assert pick("Salim (1)") == "Md. Salim Hossain"
    assert pick("Salim (2)") == "Selim-2"
    assert match_driver("Nobody", None, ds) == (None, [])


def test_same_name_is_settled_by_the_usual_car_or_left_to_choose():
    ds = people("Md. Shariful Islam", "Md. Shariful Islam")
    ds[1].employee_id = "1239005"
    chosen, cands = match_driver("Shariful", "DM-CHA 53-2042", ds)  # CAR-05 in the transport office's list
    assert chosen is ds[1] and len(cands) == 2
    chosen, cands = match_driver("Shariful", "DM-GA 99-9999", ds)
    assert chosen is None and len(cands) == 2


# ---- importing -------------------------------------------------------------------------------------

def post_import(client, admin, drv, include, drivers=None, pax=None):
    files = {"driver_log": ("Driver_Travel_Log.csv", drv, "text/csv")}
    if pax:
        files["passenger_log"] = ("Passenger_Travel_Log.csv", pax, "text/csv")
    return client.post("/api/admin/import/old-trips", headers=hdr(admin), files=files,
                       data={"choices": json.dumps({"include": include, "drivers": drivers or {}})})


def test_import_saves_completed_trips_moves_km_forward_and_can_be_undone(client, db):
    admin = make_admin(db)
    car, driver = setup_fleet(db)
    car.current_km = 1000
    db.flush()
    p = raw_plate(car)
    emp = str(random.randint(6_000_000, 6_999_999))
    drv = csv_bytes(DRV_HEAD, [start("70", "Babu", p, "10/13/2026 6:32 AM", 59299),
                               end("71", "Babu", p, "10/13/2026 9:19 PM", 59403),
                               start("72", "Babu", p, "10/14/2026 6:32 AM", 59403),
                               end("73", "Babu", p, "10/14/2026 9:00 PM", 59489)])
    pax = csv_bytes(PAX_HEAD, [{"Passenger Type": "Epic Employee", "Employee ID": emp, "Commute Status": "End Trip",
                                "Driver Rating": "5", "Driver Comment": "Good", "Driver Record ID": "70"}])

    prev = client.post("/api/admin/import/old-trips/preview", headers=hdr(admin), files={
        "driver_log": ("d.csv", drv, "text/csv"), "passenger_log": ("p.csv", pax, "text/csv")}).json()
    assert [t["key"] for t in prev["trips"]] == ["drv:70-71", "drv:72-73"]
    assert prev["trips"][0]["car"]["car_code"] == car.car_code and prev["trips"][0]["driver"]["id"] == driver.id

    r = post_import(client, admin, drv, ["drv:70-71", "drv:72-73"], pax=pax)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 2 and body["km"] == 104 + 86
    trips = db.scalars(select(Trip).where(Trip.import_batch == body["batch"]).order_by(Trip.start_time)).all()
    first = trips[0]
    assert first.status.value == "completed" and first.end_km == 59403 and first.distance_km == 104
    assert first.passenger.employee_id == emp and first.with_passenger and trips[1].with_passenger is False
    assert db.scalar(select(TripReview).where(TripReview.trip_id == first.id)).rating == 5
    db.refresh(car)
    assert car.current_km == 59489  # moved forward to the last end km

    detail = client.get(f"/api/admin/trips/{first.id}", headers=hdr(admin)).json()
    assert detail["trip"]["imported"] is True

    # the same rows again: refused, nothing doubled
    again = post_import(client, admin, drv, ["drv:70-71"])
    assert again.status_code == 422 and "Already imported" in again.json()["detail"]["refused"][0]["reason"]
    listed = client.get("/api/admin/import/batches", headers=hdr(admin)).json()["batches"]
    assert any(b["batch"] == body["batch"] and b["trips"] == 2 for b in listed)

    # undo: trips and rating gone, km back
    r = client.delete(f"/api/admin/import/batches/{body['batch']}", headers=hdr(admin))
    assert r.status_code == 200 and r.json()["removed"] == 2
    assert db.scalars(select(Trip).where(Trip.import_batch == body["batch"])).all() == []
    db.refresh(car)
    assert car.current_km == 1000
    assert db.scalar(select(Passenger).where(Passenger.employee_id == emp)) is not None  # the employee stays


def test_admin_chooses_the_driver_when_the_name_is_unclear(client, db):
    admin = make_admin(db)
    car, d1 = setup_fleet(db, "Md. Zahid Molla")
    d2 = Driver(employee_id=str(random.randint(3_000_000, 3_999_999)), name="Zahid Molla")
    db.add(d2)
    db.flush()
    p = raw_plate(car)
    drv = csv_bytes(DRV_HEAD, [start("80", "Zahid", p, "10/15/2026 6:00 AM", 2000), end("81", "Zahid", p, "10/15/2026 7:00 AM", 2030)])
    prev = client.post("/api/admin/import/old-trips/preview", headers=hdr(admin), files={"driver_log": ("d.csv", drv, "text/csv")}).json()
    row = prev["trips"][0]
    assert row["driver"] is None and {c["id"] for c in row["driver_choices"]} >= {d1.id, d2.id}
    assert post_import(client, admin, drv, ["drv:80-81"]).status_code == 422  # not without a choice
    r = post_import(client, admin, drv, ["drv:80-81"], drivers={"drv:80-81": d2.id})
    assert r.status_code == 200 and db.scalar(select(Trip).where(Trip.import_key == "drv:80-81")).driver_id == d2.id


def test_old_trip_at_the_same_time_as_an_app_trip_is_refused(db):
    from datetime import datetime, timezone
    from app.models import TripStatus
    car, driver = setup_fleet(db)
    db.add(Trip(vehicle_id=car.id, driver_id=driver.id, with_passenger=False, purpose="Errand", start_km=5000,
                start_place="Office", destination="Factory", status=TripStatus.in_progress,
                start_time=datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)))  # 8:00 AM in Dhaka, still running
    db.flush()
    p = raw_plate(car)
    drv = csv_bytes(DRV_HEAD, [start("90", "Babu", p, "10/15/2026 9:00 AM", 4000), end("91", "Babu", p, "10/15/2026 10:00 AM", 4050)])
    t = read_old_logs(db, drv).trips[0]
    assert any("already in the app" in x for x in t.problems) and not t.importable


def test_only_admins_import(client, db):
    viewer = make_admin(db, role=AdminRole.viewer)
    files = {"driver_log": ("d.csv", csv_bytes(DRV_HEAD, []), "text/csv")}
    assert client.post("/api/admin/import/old-trips/preview", headers=hdr(viewer), files=files).status_code == 403
    assert client.get("/api/admin/import/batches", headers=hdr(viewer)).status_code == 403


def test_made_up_km_marks_a_test(db):
    car, _ = setup_fleet(db)
    p = raw_plate(car)
    data = csv_bytes(DRV_HEAD, [start("1", "Babu", p, "10/9/2026 6:11 PM", 123456, frm="doyagonj", to="GTL"),
                                end("2", "Babu", p, "10/9/2026 6:20 PM", 123520, at="GTL")])
    t = read_old_logs(db, data).trips[0]
    assert t.looks_like_test and t.importable and any("looks typed for a test" in w for w in t.warnings)
