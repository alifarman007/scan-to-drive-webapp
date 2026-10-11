"""The passenger's phone is remembered after the start (one tap at the end), and the passenger can rate the trip."""
from sqlalchemy import select

from app.models import Trip, TripReview
from tests.test_admin_trips import hdr, make_admin
from tests.test_end_trip import (  # noqa: F401  (client fixture comes from there)
    client, confirm_end, emp_id, end, events, token_of,
)
from tests.test_passenger import make_passenger
from tests.test_trips import auth, make_car, make_driver, start


def started_on_this_phone(client, db, visitor=False):
    """Driver starts, the passenger confirms on `client` (which keeps the cookie). Returns (driver, trip_id)."""
    car, driver = make_car(db), make_driver(db)
    raw = token_of(start(client, driver, car).json()["start_qr"])
    body = ({"passenger_type": "visitor", "name": "John Smith", "phone": "01712345678"} if visitor
            else {"passenger_type": "employee", "employee_id": emp_id()})
    r = client.post(f"/api/p/{raw}/confirm-start", json=body)
    assert r.status_code == 200
    return driver, r.json()["trip"]["trip_no"], db.scalar(select(Trip.id).where(Trip.trip_no == r.json()["trip"]["trip_no"]))


def end_qr(client, driver, trip_id):
    return token_of(end(client, driver, trip_id).json()["end_qr"])


def test_same_phone_confirms_the_end_with_one_tap(client, db):
    driver, _, trip_id = started_on_this_phone(client, db)
    raw = end_qr(client, driver, trip_id)
    page = client.get(f"/api/p/{raw}").json()
    assert page["remembered"] is True and page["you"] == db.get(Trip, trip_id).passenger.employee_id  # no name typed
    r = client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "remembered"})
    assert r.status_code == 200 and r.json()["review_token"]
    assert events(db, "trip_completed", trip_id)[0].detail["same_phone"] is True


def test_visitor_phone_is_remembered_too(client, db):
    driver, _, trip_id = started_on_this_phone(client, db, visitor=True)
    raw = end_qr(client, driver, trip_id)
    assert client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "remembered"}).status_code == 200


def test_another_phone_is_not_remembered_and_types_the_id(client, db):
    driver, _, trip_id = started_on_this_phone(client, db)
    raw = end_qr(client, driver, trip_id)
    client.cookies.clear()  # a different phone, or the browser was cleared
    page = client.get(f"/api/p/{raw}").json()
    assert page["remembered"] is False and page["you"] is None  # nothing about the passenger for another phone
    r = client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "remembered"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "NOT_REMEMBERED"
    assert client.get(f"/api/p/{raw}").json()["tries_left"] == 5  # not counted as a wrong try
    p_id = db.get(Trip, trip_id).passenger.employee_id
    assert confirm_end(client, raw, employee_id=p_id.lower()).status_code == 200


def test_a_cookie_from_another_trip_does_not_count(client, db):
    _, _, first = started_on_this_phone(client, db)
    driver2, _, second = started_on_this_phone(client, db)
    raw = end_qr(client, driver2, second)
    key = client.cookies.get(f"s2d_pax{first}")
    client.cookies.clear()
    client.cookies.set(f"s2d_pax{second}", key)  # right name, wrong key
    assert client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "remembered"}).status_code == 403


def finished(client, db):
    driver, _, trip_id = started_on_this_phone(client, db)
    raw = end_qr(client, driver, trip_id)
    return trip_id, client.post(f"/api/p/{raw}/confirm-end", json={"passenger_type": "remembered"}).json()["review_token"]


def test_passenger_rates_the_trip_once(client, db):
    trip_id, token = finished(client, db)
    r = client.post("/api/p/review", json={"token": token, "rating": 5, "tags": ["safe_driving", "on_time", "made_up"],
                                           "comment": "  Very careful driver  "})
    assert r.status_code == 201 and r.json() == {"rating": 5, "tags": ["on_time", "safe_driving"], "comment": "Very careful driver"}
    review = db.scalar(select(TripReview).where(TripReview.trip_id == trip_id))
    assert review.rating == 5 and events(db, "trip_reviewed", trip_id)
    again = client.post("/api/p/review", json={"token": token, "rating": 1})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ALREADY_REVIEWED"


def test_review_needs_a_valid_token_and_rating(client, db):
    trip_id, token = finished(client, db)
    assert client.post("/api/p/review", json={"token": token, "rating": 6}).status_code == 422
    forged = f"{trip_id}.9999999999.{'0' * 64}"
    r = client.post("/api/p/review", json={"token": forged, "rating": 4})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "REVIEW_LINK_EXPIRED"


def test_admin_sees_the_review(client, db):
    admin = make_admin(db)
    trip_id, token = finished(client, db)
    client.post("/api/p/review", json={"token": token, "rating": 2, "tags": ["late"], "comment": "20 minutes late"})
    trip = client.get(f"/api/admin/trips/{trip_id}", headers=hdr(admin)).json()["trip"]
    assert trip["review"]["rating"] == 2 and trip["review"]["tags"] == ["late"] and trip["review"]["comment"] == "20 minutes late"
    rows = client.get("/api/admin/trips", params={"limit": 200}, headers=hdr(admin)).json()["trips"]
    assert next(r for r in rows if r["id"] == trip_id)["rating"] == 2
    ratings = client.get("/api/admin/dashboard", headers=hdr(admin)).json()["ratings"]
    assert ratings["count_this_month"] >= 1 and ratings["recent"][0]["trip_id"] == trip_id
    assert len(ratings["stars_this_month"]) == 5 and sum(ratings["stars_this_month"]) == ratings["count_this_month"]


def test_end_page_without_a_remembered_phone_identifies_with_name(client, db):
    """Start skipped ("Passenger can't scan"): the passenger types the ID and may add a name at the end."""
    car, driver = make_car(db), make_driver(db)
    trip_id = start(client, driver, car).json()["trip"]["id"]
    client.post(f"/api/trips/{trip_id}/cant-scan", json={"reason": "Phone battery dead"}, headers=auth("driver", driver.id))
    raw = end_qr(client, driver, trip_id)
    r = confirm_end(client, raw, employee_id="Qwe1234", name="Mita Rani")
    assert r.status_code == 200
    t = db.get(Trip, trip_id)
    db.refresh(t)
    assert t.passenger.employee_id == "QWE1234" and t.passenger.name == "Mita Rani"


def test_a_stored_name_is_never_shown_to_whoever_types_the_id(client, db):
    """Privacy: typing someone's ID must not reveal the name they gave on an earlier trip."""
    p = make_passenger(db)  # "Nadia Islam", stored from an earlier trip
    car, driver = make_car(db), make_driver(db)
    raw = token_of(start(client, driver, car).json()["start_qr"])
    r = client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": p.employee_id.lower()})
    assert r.status_code == 200 and r.json()["trip"]["passenger_name"] == p.employee_id and "Nadia" not in r.text
    trip_id = db.scalar(select(Trip.id).where(Trip.trip_no == r.json()["trip"]["trip_no"]))
    page = client.get(f"/api/p/{end_qr(client, driver, trip_id)}").json()
    assert page["remembered"] is True and page["you"] == p.employee_id and "Nadia" not in str(page)


def test_the_remembered_phone_sees_the_name_it_typed(client, db):
    car, driver = make_car(db), make_driver(db)
    raw = token_of(start(client, driver, car).json()["start_qr"])
    r = client.post(f"/api/p/{raw}/confirm-start", json={"passenger_type": "employee", "employee_id": "Emp1100", "name": "Sadia Rahman"})
    assert r.json()["trip"]["passenger_name"] == "Sadia Rahman"
    trip_id = db.scalar(select(Trip.id).where(Trip.trip_no == r.json()["trip"]["trip_no"]))
    assert client.get(f"/api/p/{end_qr(client, driver, trip_id)}").json()["you"] == "Sadia Rahman · EMP1100"
