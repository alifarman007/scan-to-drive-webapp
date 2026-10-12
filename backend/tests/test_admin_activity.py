"""Admin lists (step 7): km per day and ratings on car and driver pages, the next driver ID, alert filters."""

from sqlalchemy import select

from app.models import Alert, AlertStatus, AlertType, Driver, Trip, TripReview
from tests.test_admin_trips import hdr, make_admin
from tests.test_cant_scan import cant_scan
from tests.test_end_trip import (  # noqa: F401  (client fixture comes from there)
    client, end, running_trip,
)


def test_car_and_driver_pages_show_km_per_day_and_rating(client, db):
    admin = make_admin(db)
    driver, car, _, t = running_trip(client, db)
    end(client, driver, t)
    cant_scan(client, driver, t, end_stage=True)
    db.add(TripReview(trip_id=t, rating=4, tags=["on_time"]))
    db.commit()

    c = client.get(f"/api/admin/cars/{car.id}", headers=hdr(admin)).json()
    days = c["km_by_day"]
    assert len(days) == 30
    assert sum(d["km"] for d in days) == 38 and sum(d["trips"] for d in days) == 1
    assert c["car"]["rating"] == {"average": 4.0, "count": 1} and c["car"]["open_alerts"] >= 0

    d = client.get(f"/api/admin/drivers/{driver.id}", headers=hdr(admin)).json()
    assert d["driver"]["rating"]["average"] == 4.0 and [x["id"] for x in d["recent_trips"]] == [t]
    assert sum(x["km"] for x in d["km_by_day"]) == 38
    row = next(x for x in client.get("/api/admin/drivers", params={"q": driver.employee_id}, headers=hdr(admin)).json()["drivers"])
    assert row["rating"]["count"] == 1


def test_next_driver_id_is_the_next_seven_digit_number(client, db):
    admin = make_admin(db)
    numbers = [int(e) for e in db.scalars(select(Driver.employee_id)) if len(e) == 7 and e.isdigit()]
    expected = str(max(numbers, default=1239000) + 1)
    assert client.get("/api/admin/drivers", headers=hdr(admin)).json()["next_employee_id"] == expected
    r = client.post("/api/admin/drivers", json={"employee_id": f" {expected} ", "name": "New Driver"}, headers=hdr(admin))
    assert r.status_code == 201 and r.json()["driver"]["employee_id"] == expected
    assert client.get("/api/admin/drivers", headers=hdr(admin)).json()["next_employee_id"] == str(int(expected) + 1)


def test_alert_filters_counts_and_names(client, db):
    admin = make_admin(db)
    driver, car, _, t = running_trip(client, db)
    a = Alert(type=AlertType.long_trip, message="Trip running for 7 hours", trip_id=t, vehicle_id=car.id)
    db.add(a)
    db.commit()
    r = client.get("/api/admin/alerts", params={"car_id": car.id, "status": "all"}, headers=hdr(admin)).json()
    assert r["total"] == 1 and r["counts"] == {"open": 1, "solved": 0} and r["by_type"]["long_trip"] >= 1
    assert r["alerts"][0]["driver_name"] == driver.name and r["alerts"][0]["car_code"] == car.car_code
    trip_no = db.get(Trip, t).trip_no
    assert client.get("/api/admin/alerts", params={"q": trip_no}, headers=hdr(admin)).json()["total"] == 1
    s = client.post(f"/api/admin/alerts/{a.id}/solve", json={"note": "Called the driver"}, headers=hdr(admin)).json()["alert"]
    assert s["status"] == "solved" and s["resolved_by_name"] == admin.username
    r = client.get("/api/admin/alerts", params={"car_id": car.id, "status": "solved"}, headers=hdr(admin)).json()
    assert r["counts"] == {"open": 0, "solved": 1} and r["alerts"][0]["resolved_by_name"] == admin.username
    assert db.get(Alert, a.id).status == AlertStatus.solved
