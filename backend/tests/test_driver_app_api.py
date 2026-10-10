"""Small API additions for the driver screens: car page without sticker version, last end place,
the driver's own trip by id, and app hints in /trips/active."""
from tests.test_end_trip import client, end, running_trip, set_setting  # noqa: F401  (client fixture)
from tests.test_trips import auth, make_car, make_driver, start


def car_page(client, driver, code, **params):
    return client.get(f"/api/cars/{code}", params=params, headers=auth("driver", driver.id))


def test_typed_car_code_needs_no_sticker_version(client, db):
    car, driver = make_car(db), make_driver(db)
    r = car_page(client, driver, car.car_code.lower())  # typed, in small letters, no ?v=
    assert r.status_code == 200 and r.json()["car"]["car_code"] == car.car_code
    assert r.json()["car"]["qr_version"] == car.qr_version
    # a scanned sticker still has its version checked
    assert car_page(client, driver, car.car_code, v=car.qr_version + 1).json()["detail"]["code"] == "STICKER_OUTDATED"


def test_car_page_gives_last_end_place_and_gap_limit(client, db):
    driver, car, _, trip_id = running_trip(client, db, with_passenger=False)
    assert car_page(client, driver, car.car_code).json()["car"]["last_end_place"] is None
    assert end(client, driver, trip_id, end_place="Factory, Gazipur").status_code == 200
    page = car_page(client, make_driver(db), car.car_code).json()
    assert page["car"]["last_end_place"] == "Factory, Gazipur"
    assert isinstance(page["km_gap_limit_km"], int)


def test_my_open_trip_names_its_car(client, db):
    driver, car, _, trip_id = running_trip(client, db)
    other = make_car(db)
    page = car_page(client, driver, other.car_code).json()
    assert page["can_start"] is False
    assert page["my_open_trip"] == {"id": trip_id, "trip_no": page["my_open_trip"]["trip_no"],
                                    "status": "in_progress", "car_code": car.car_code}


def test_driver_reads_own_trip_by_id_in_any_status(client, db):
    driver, _, _, trip_id = running_trip(client, db, with_passenger=False)
    end(client, driver, trip_id)
    r = client.get(f"/api/trips/{trip_id}", headers=auth("driver", driver.id))
    assert r.status_code == 200 and r.json()["trip"]["status"] == "completed"
    assert r.json()["trip"]["distance_km"] == 38
    # someone else's trip, or one that does not exist: not found
    assert client.get(f"/api/trips/{trip_id}", headers=auth("driver", make_driver(db).id)).status_code == 404
    assert client.get("/api/trips/99999999", headers=auth("driver", driver.id)).status_code == 404


def test_active_trip_tells_the_app_what_it_may_show(client, db):
    driver = make_driver(db)
    start(client, driver, make_car(db))
    set_setting(db, "allow_cant_scan", 0)
    set_setting(db, "qr_expiry_minutes", 12)
    body = client.get("/api/trips/active", headers=auth("driver", driver.id)).json()
    assert body["allow_cant_scan"] is False and body["qr_expiry_minutes"] == 12
    assert body["trip"]["status"] == "waiting_for_passenger"


def test_passenger_page_knows_it_was_opened_by_the_driver(client, db):
    from tests.test_end_trip import token_of
    driver = make_driver(db)
    raw = token_of(start(client, driver, make_car(db)).json()["start_qr"])
    assert client.get(f"/api/p/{raw}").json()["opened_by_driver"] is False
    assert client.get(f"/api/p/{raw}", headers=auth("driver", driver.id)).json()["opened_by_driver"] is True
    other = make_driver(db)
    assert client.get(f"/api/p/{raw}", headers=auth("driver", other.id)).json()["opened_by_driver"] is False

