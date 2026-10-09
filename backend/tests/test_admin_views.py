"""Admin dashboard, trip history, trip detail (photos, timeline) and audit log."""
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from app.models import AdminRole, Passenger, Trip, Vehicle, VehicleStatus
from app.security import photo_link_valid, sign_photo_link
from tests.test_admin_trips import close, hdr, make_admin
from tests.test_cant_scan import cant_scan
from tests.test_end_trip import (  # noqa: F401  (client fixture comes from there)
    END_JPEG, client, confirm_end, end, make_passenger, running_trip, token_of,
)
from tests.test_trips import JPEG, auth, make_car, make_driver, start


def get(client, admin, path, **params):
    return client.get(f"/api/admin{path}", params=params, headers=hdr(admin))


def board_entry(body, car):
    return next(c for c in body["car_board"] if c["car_code"] == car.car_code)


# ---- dashboard ----------------------------------------------------------------------------------

def test_car_board_shows_each_state(client, db):
    admin = make_admin(db)
    available = make_car(db)
    maint = make_car(db)
    maint.status = VehicleStatus.maintenance
    db.flush()
    waiting_car, d1 = make_car(db), make_driver(db)
    start(client, d1, waiting_car)
    _, on_trip_car, _, _ = running_trip(client, db)

    body = get(client, admin, "/dashboard").json()
    assert board_entry(body, available)["state"] == "available" and board_entry(body, available)["trip"] is None
    assert board_entry(body, maint)["state"] == "maintenance"
    w = board_entry(body, waiting_car)
    assert w["state"] == "waiting" and w["trip"]["driver_name"] == d1.name and w["trip"]["destination"]
    o = board_entry(body, on_trip_car)
    assert o["state"] == "on_trip" and o["current_km"] == 45000 and o["trip"]["status"] == "in_progress"


def test_ended_trip_waiting_for_confirmation_shows_as_waiting(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    end(client, driver, trip_id)
    body = get(client, make_admin(db), "/dashboard").json()
    assert board_entry(body, car)["state"] == "waiting"


def test_dashboard_cards_count_up(client, db):
    admin = make_admin(db)
    before = get(client, admin, "/dashboard").json()["cards"]
    driver, car, _, trip_id = running_trip(client, db)
    mid = get(client, admin, "/dashboard").json()["cards"]
    assert mid["cars_on_trip"] == before["cars_on_trip"] + 1
    assert mid["trips_today"] == before["trips_today"] + 1
    assert mid["cars_available"] == before["cars_available"]  # the new car was taken straight away

    end(client, driver, trip_id)  # 38 km, now waiting for the end confirmation
    waiting = get(client, admin, "/dashboard").json()["cards"]
    assert waiting["trips_waiting_confirm"] == before["trips_waiting_confirm"] + 1
    assert waiting["km_today"] == before["km_today"]  # km only count once the trip is finished

    assert cant_scan(client, driver, trip_id, end_stage=True).status_code == 200
    done = get(client, admin, "/dashboard").json()["cards"]
    assert done["km_today"] == before["km_today"] + 38
    assert done["cars_on_trip"] == before["cars_on_trip"]
    assert done["trips_today"] == before["trips_today"] + 1


def test_cancelled_trips_are_not_counted_today(client, db):
    admin = make_admin(db)
    before = get(client, admin, "/dashboard").json()["cards"]["trips_today"]
    car, driver = make_car(db), make_driver(db)
    trip_id = start(client, driver, car).json()["trip"]["id"]
    client.post(f"/api/trips/{trip_id}/cancel", json={"reason": "wrong car"}, headers=auth("driver", driver.id))
    assert get(client, admin, "/dashboard").json()["cards"]["trips_today"] == before


def test_live_trips_and_charts(client, db):
    admin = make_admin(db)
    driver, car, p, trip_id = running_trip(client, db)
    body = get(client, admin, "/dashboard").json()
    live = next(t for t in body["live_trips"] if t["id"] == trip_id)
    assert live["car_code"] == car.car_code and live["driver_phone"] == driver.phone
    assert live["passenger_name"] == p.name and live["minutes_running"] in (0, 1)

    assert cant_scan(client, driver, trip_id, end_stage=True).status_code == 409  # not yet ended
    end(client, driver, trip_id)
    cant_scan(client, driver, trip_id, end_stage=True)
    body = get(client, admin, "/dashboard").json()
    km = {c["car_code"]: c["km"] for c in body["charts"]["km_per_car_this_month"]}
    assert km[car.car_code] == 38
    days = body["charts"]["trips_per_day_this_month"]
    assert days[-1]["date"] == body["today"] and days[-1]["trips"] >= 1
    assert days[0]["date"].endswith("-01")


def test_dashboard_alerts_listed(client, db):
    from app.services.jobs import run_checks
    from tests.test_alerts import later
    _, _, _, trip_id = running_trip(client, db)
    run_checks(db, now=later(hours=7))
    body = get(client, make_admin(db), "/dashboard").json()
    assert body["cards"]["open_alerts"] >= 1
    assert any(a["trip_id"] == trip_id and a["type"] == "long_trip" for a in body["alerts"])


def test_admin_pages_need_an_admin_sign_in(client, db):
    driver = make_driver(db)
    for path in ("/dashboard", "/trips", "/trips/1"):
        assert client.get(f"/api/admin{path}").status_code in (401, 403)
        assert client.get(f"/api/admin{path}", headers=auth("driver", driver.id)).status_code == 403
    viewer = make_admin(db, AdminRole.viewer)
    assert get(client, viewer, "/dashboard").status_code == 200  # viewers may look
    assert get(client, viewer, "/trips").status_code == 200


# ---- trip history -------------------------------------------------------------------------------

def ids(body):
    return [t["id"] for t in body["trips"]]


def test_history_filters(client, db):
    admin = make_admin(db)
    d1, c1, p1, t1 = running_trip(client, db)
    d2, c2, p2, t2 = running_trip(client, db, with_passenger=False)
    p1.department = "Compliance Dept X"
    db.flush()

    assert t1 in ids(get(client, admin, "/trips", range="today").json())
    assert ids(get(client, admin, "/trips", car_id=c1.id).json()) == [t1]
    assert ids(get(client, admin, "/trips", driver_id=d2.id).json()) == [t2]
    assert ids(get(client, admin, "/trips", department="compliance dept x").json()) == [t1]
    assert ids(get(client, admin, "/trips", car_id=c1.id, status="completed").json()) == []
    assert ids(get(client, admin, "/trips", car_id=c1.id, status="in_progress").json()) == [t1]
    _, v_car, _, t3 = running_trip(client, db, visitor_phone="01711111111")  # visitor trips are marked for review
    assert ids(get(client, admin, "/trips", car_id=v_car.id, needs_review=True).json()) == [t3]
    assert ids(get(client, admin, "/trips", car_id=c1.id, needs_review=True).json()) == []
    assert ids(get(client, admin, "/trips", car_id=c1.id, needs_review=False).json()) == [t1]


def test_history_search(client, db):
    admin = make_admin(db)
    d, c, p, t = running_trip(client, db)
    trip_no = db.get(Trip, t).trip_no
    for term in (trip_no, c.car_code, d.name, p.name, p.employee_id, "gazipur", trip_no.lower()):
        assert t in ids(get(client, admin, "/trips", q=term).json()), term
    assert ids(get(client, admin, "/trips", q="no-such-thing-xyz").json()) == []
    assert ids(get(client, admin, "/trips", q="%").json()) == []  # a % is searched literally, not as a wildcard


def test_history_searches_visitors(client, db):
    admin = make_admin(db)
    _, _, _, t = running_trip(client, db, visitor_phone="01712345678")
    assert t in ids(get(client, admin, "/trips", q="John Smith").json())
    assert t in ids(get(client, admin, "/trips", q="01712345678").json())
    row = next(r for r in get(client, admin, "/trips", q="01712345678").json()["trips"] if r["id"] == t)
    assert row["is_visitor"] is True and row["passenger_name"] == "John Smith"


def test_history_date_filters_use_bangladesh_days(client, db):
    admin = make_admin(db)
    _, car, _, t = running_trip(client, db)
    trip = db.get(Trip, t)
    from app.services.timeutil import LOCAL_TZ
    local = trip.start_time.astimezone(LOCAL_TZ).date()
    q = dict(car_id=car.id)
    assert ids(get(client, admin, "/trips", date_from=local.isoformat(), date_to=local.isoformat(), **q).json()) == [t]
    assert ids(get(client, admin, "/trips", date_from=(local + timedelta(days=1)).isoformat(), **q).json()) == []
    assert ids(get(client, admin, "/trips", date_to=(local - timedelta(days=1)).isoformat(), **q).json()) == []
    # 23:30 on the 5th in Bangladesh is 17:30 UTC on the 5th; 00:30 on the 6th is 18:30 UTC on the 5th
    from datetime import datetime, timezone
    trip.start_time = datetime(2026, 3, 5, 18, 30, tzinfo=timezone.utc)  # = 6 March, 00:30 in Bangladesh
    db.flush()
    assert ids(get(client, admin, "/trips", date_from="2026-03-06", date_to="2026-03-06", **q).json()) == [t]
    assert ids(get(client, admin, "/trips", date_from="2026-03-05", date_to="2026-03-05", **q).json()) == []
    r = get(client, admin, "/trips", date_from="2026-03-07", date_to="2026-03-06")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "BAD_DATE_RANGE"


def test_history_totals_and_paging(client, db):
    admin = make_admin(db)
    driver, car, _, t1 = running_trip(client, db)
    end(client, driver, t1)
    cant_scan(client, driver, t1, end_stage=True)
    body = get(client, admin, "/trips", car_id=car.id).json()
    assert body["total"] == 1 and body["total_km"] == 38
    d2, c2, _, t2 = running_trip(client, db)
    page = get(client, admin, "/trips", limit=1, offset=0).json()
    assert len(page["trips"]) == 1 and page["total"] >= 2
    assert page["trips"][0]["id"] == t2  # newest first
    assert get(client, admin, "/trips", limit=500).status_code == 422
    assert get(client, admin, "/trips", status="weird").status_code == 422


def test_history_approval_filter(client, db):
    admin = make_admin(db)
    car, driver = make_car(db), make_driver(db)
    t = start(client, driver, car).json()["trip"]["id"]
    cant_scan(client, driver, t)
    assert ids(get(client, admin, "/trips", approval="pending", car_id=car.id).json()) == [t]
    assert ids(get(client, admin, "/trips", approval="approved", car_id=car.id).json()) == []


# ---- trip detail --------------------------------------------------------------------------------

def test_trip_detail_with_timeline_and_photos(client, db):
    admin = make_admin(db)
    driver, car, p, t = running_trip(client, db)
    end(client, driver, t, end_lat="23.9", end_lng="90.4")
    body = get(client, admin, f"/trips/{t}").json()
    trip = body["trip"]
    assert trip["driver"]["name"] == driver.name and trip["passenger"]["employee_id"] == p.employee_id
    assert trip["vehicle"]["car_code"] == car.car_code and trip["visitor"] is None
    assert trip["map_points"]["end"] == {"lat": 23.9, "lng": 90.4}
    assert trip["distance_km"] == 38 and trip["minutes_running"] is not None

    events = [e["event"] for e in body["timeline"]]
    assert events[:3] == ["trip_started", "journey_started", "trip_end_submitted"]
    first = body["timeline"][0]
    assert first["label"] == "Driver started the trip" and first["actor"].startswith("driver:") and first["ip"]
    assert body["alerts"] == []

    for kind, data in (("start", JPEG), ("end", END_JPEG)):
        url = trip["photos"][kind]["url"]
        r = client.get(url)  # no sign-in header: it is for an <img> tag
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content == data


def test_detail_shows_visitor_and_missing_end_photo(client, db):
    _, _, _, t = running_trip(client, db, visitor_phone="01712345678")
    trip = get(client, make_admin(db), f"/trips/{t}").json()["trip"]
    assert trip["visitor"]["name"] == "John Smith" and trip["visitor"]["phone"] == "01712345678"
    assert trip["passenger"] is None
    assert trip["photos"]["start"]["url"] and trip["photos"]["end"]["url"] is None
    assert trip["minutes_running"] is not None


def test_detail_of_a_finished_trip_includes_admin_close_and_alerts(client, db):
    admin = make_admin(db)
    driver, _, _, t = running_trip(client, db)
    close(client, admin, t, reason="forgot to end")
    body = get(client, admin, f"/trips/{t}").json()
    assert body["trip"]["status"] == "closed_by_admin" and body["trip"]["minutes_running"] is None
    assert "trip_closed_by_admin" in [e["event"] for e in body["timeline"]]
    assert [a["type"] for a in body["alerts"]] == ["admin_closed"]


def test_detail_unknown_trip(client, db):
    assert get(client, make_admin(db), "/trips/999999").status_code == 404


def test_approvals_route_is_not_shadowed_by_trip_detail(client, db):
    assert get(client, make_admin(db), "/trips/approvals").status_code == 200


# ---- photo links --------------------------------------------------------------------------------

def parts(link):
    u = urlparse(link)
    q = parse_qs(u.query)
    return u.path, int(q["exp"][0]), q["sig"][0]


def test_photo_links_expire_and_cannot_be_forged(client, db):
    driver, _, _, t = running_trip(client, db)
    path, exp, sig = parts(sign_photo_link(t, "start"))
    assert client.get(path, params={"exp": exp, "sig": sig}).status_code == 200
    # another trip, another photo kind, a changed expiry or a bad signature are all refused
    other = path.replace(f"/{t}/", f"/{t + 1}/")
    for url, prm in ((other, {"exp": exp, "sig": sig}), (path.replace("start", "end"), {"exp": exp, "sig": sig}),
                     (path, {"exp": exp + 1, "sig": sig}), (path, {"exp": exp, "sig": "0" * 64})):
        r = client.get(url, params=prm)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "LINK_EXPIRED"
    path, exp, sig = parts(sign_photo_link(t, "start", seconds=-5))
    assert client.get(path, params={"exp": exp, "sig": sig}).status_code == 403
    assert not photo_link_valid(t, "start", exp, sig)
    assert client.get(path).status_code == 422  # missing parameters


def test_signed_link_for_a_missing_photo(client, db):
    _, _, _, t = running_trip(client, db)
    path, exp, sig = parts(sign_photo_link(t, "end"))
    r = client.get(path, params={"exp": exp, "sig": sig})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "PHOTO_MISSING"


# ---- audit log ----------------------------------------------------------------------------------

def test_audit_log_is_admin_only(client, db):
    driver, _, _, t = running_trip(client, db)
    assert get(client, make_admin(db, AdminRole.viewer), "/audit").status_code == 403
    assert client.get("/api/admin/audit", headers=auth("driver", driver.id)).status_code == 403
    assert get(client, make_admin(db), "/audit").status_code == 200


def test_audit_search_and_filters(client, db):
    admin = make_admin(db)
    driver, car, p, t = running_trip(client, db)
    end(client, driver, t)
    confirm_end(client, token_of(client.post(f"/api/trips/{t}/end-qr", headers=auth("driver", driver.id)).json()["end_qr"]),
                employee_id="NOPE-123")

    body = get(client, admin, "/audit", trip_id=t).json()
    names = [e["event"] for e in body["events"]]
    assert names[0] == "passenger_wrong_id" and "trip_started" in names  # newest first
    assert all(e["trip_no"] for e in body["events"]) and body["total"] == len(body["events"])

    assert {e["event"] for e in get(client, admin, "/audit", trip_id=t, event="trip_started").json()["events"]} == {"trip_started"}
    by_actor = get(client, admin, "/audit", actor=driver.employee_id.lower(), trip_id=t).json()["events"]
    assert by_actor and all(driver.employee_id in e["actor"] for e in by_actor)
    wrong = get(client, admin, "/audit", q="NOPE-123").json()["events"]  # found inside the details
    assert wrong and wrong[0]["trip_id"] == t and wrong[0]["detail"]["typed_id"] == "NOPE-123"
    assert get(client, admin, "/audit", q="NOPE-123", date_from="2020-01-01", date_to="2020-01-02").json()["events"] == []
    assert get(client, admin, "/audit", date_from="2026-05-02", date_to="2026-05-01").status_code == 422


def test_audit_paging(client, db):
    admin = make_admin(db)
    _, _, _, t = running_trip(client, db)
    page = get(client, admin, "/audit", trip_id=t, limit=1, offset=1).json()
    assert len(page["events"]) == 1 and page["total"] >= 2
    assert get(client, admin, "/audit", limit=0).status_code == 422
