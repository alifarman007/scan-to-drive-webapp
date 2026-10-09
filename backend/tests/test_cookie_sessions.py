"""Web app sessions: httpOnly cookies, the CSRF header, sign-out, both roles in one browser, weak PINs."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app import config
from app.deps import ADMIN_COOKIE, DRIVER_COOKIE, get_db
from app.main import app
from app.models import AdminRole, AdminUser
from app.security import create_access_token, hash_secret
from tests.test_passenger import client as passenger_client  # noqa: F401  (fixture with photo storage)
from tests.test_passenger import confirm_employee, make_passenger, new_trip
from tests.test_trips import make_driver

CSRF = {"X-S2D": "1"}


@pytest.fixture()
def browser(db):
    """A client that behaves like one browser: it keeps cookies between calls."""
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def make_admin(db, password="correct-horse", role=AdminRole.admin):
    import uuid
    u = AdminUser(username=f"c-{uuid.uuid4().hex[:8]}", role=role, password_hash=hash_secret(password))
    db.add(u)
    db.flush()
    return u


def driver_login(browser, driver, pin="1234"):
    return browser.post("/api/auth/driver/login", json={"employee_id": driver.employee_id, "pin": pin})


def admin_login(browser, admin, password="correct-horse"):
    return browser.post("/api/auth/admin/login", json={"username": admin.username, "password": password})


def cookie_header(response, name):
    return next(h for h in response.headers.get_list("set-cookie") if h.startswith(f"{name}="))


def test_driver_login_sets_a_safe_cookie(browser, db):
    d = make_driver(db)
    r = driver_login(browser, d)
    assert r.status_code == 200 and r.json()["access_token"]  # still in the body for Swagger
    header = cookie_header(r, DRIVER_COOKIE).lower()
    assert "httponly" in header and "samesite=lax" in header and "path=/" in header
    assert "max-age=2592000" in header  # 30 days
    assert "secure" not in header  # development: plain http on the LAN works

    me = browser.get("/api/auth/driver/me")
    assert me.status_code == 200 and me.json()["employee_id"] == d.employee_id
    assert browser.get("/api/trips/active").status_code == 200


def test_cookie_is_secure_in_production(browser, db, monkeypatch):
    monkeypatch.setattr(config.settings, "environment", "production")
    r = driver_login(browser, make_driver(db))
    assert "secure" in cookie_header(r, DRIVER_COOKIE).lower()


def test_changes_need_the_csrf_header(browser, db):
    admin = make_admin(db)
    assert admin_login(browser, admin).status_code == 200
    body = {"values": {"qr_expiry_minutes": 14}}
    blocked = browser.patch("/api/admin/settings", json=body)
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "CSRF_CHECK_FAILED"
    assert browser.patch("/api/admin/settings", json=body, headers=CSRF).status_code == 200
    # reading needs no header
    assert browser.get("/api/admin/settings").status_code == 200


def test_bearer_header_needs_no_csrf_header(browser, db):
    admin = make_admin(db)
    tok = create_access_token("admin", admin.id, timedelta(minutes=5), "admin")
    r = browser.patch("/api/admin/settings", json={"values": {"qr_expiry_minutes": 13}},
                      headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200


def test_driver_cookie_does_not_open_admin_pages(browser, db):
    driver_login(browser, make_driver(db))
    assert browser.get("/api/admin/dashboard").status_code == 401
    assert browser.get("/api/auth/admin/me").status_code == 401


def test_driver_and_admin_in_one_browser(browser, db):
    d, admin = make_driver(db), make_admin(db)
    driver_login(browser, d)
    admin_login(browser, admin)
    assert browser.get("/api/auth/driver/me").json()["employee_id"] == d.employee_id
    assert browser.get("/api/auth/admin/me").json()["username"] == admin.username
    assert browser.get("/api/trips/active").status_code == 200
    assert browser.get("/api/admin/dashboard").status_code == 200
    assert browser.get("/api/auth/me").json()["kind"] == "admin"  # admin wins on the shared endpoint

    out = browser.post("/api/auth/logout", params={"who": "driver"})
    assert out.status_code == 200
    assert browser.get("/api/auth/driver/me").status_code == 401
    assert browser.get("/api/auth/admin/me").status_code == 200
    browser.post("/api/auth/logout")
    assert browser.get("/api/auth/admin/me").status_code == 401


def test_shared_endpoint_with_driver_cookie_only(browser, db):
    d = make_driver(db)
    driver_login(browser, d)
    assert browser.get("/api/auth/me").json()["kind"] == "driver"
    assert browser.get("/api/purposes").status_code == 200


def test_bad_cookie_means_signed_out(browser, db):
    browser.cookies.set(DRIVER_COOKIE, "not-a-token")
    assert browser.get("/api/auth/driver/me").status_code == 401
    browser.cookies.set(ADMIN_COOKIE, "nope")
    assert browser.get("/api/auth/admin/me").status_code == 401


def test_first_sign_in_sets_pin_and_cookie_weak_pins_refused(browser, db):
    d = make_driver(db)
    d.pin_hash = None
    db.flush()
    assert driver_login(browser, d).json()["detail"]["code"] == "PIN_NOT_SET"
    for weak in ("0000", "7777", "1234", "6789", "9876", "3210"):
        r = browser.post("/api/auth/driver/set-pin", json={"employee_id": d.employee_id, "pin": weak})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "WEAK_PIN", weak
    r = browser.post("/api/auth/driver/set-pin", json={"employee_id": d.employee_id, "pin": "2580"})
    assert r.status_code == 200 and DRIVER_COOKIE in r.cookies
    assert browser.get("/api/auth/driver/me").status_code == 200


def test_driver_cookie_blocks_confirming_own_trip(passenger_client, db):
    driver, _, _, raw = new_trip(passenger_client, db)
    passenger_client.cookies.set(DRIVER_COOKIE, create_access_token("driver", driver.id, timedelta(minutes=5)))
    p = make_passenger(db)
    r = confirm_employee(passenger_client, raw, p.employee_id)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "DRIVER_CANNOT_CONFIRM"


def test_employee_id_case_and_spaces_do_not_matter(browser, db):
    d = make_driver(db)
    r = browser.post("/api/auth/driver/login", json={"employee_id": f"  {d.employee_id.upper()} ", "pin": "1234"})
    assert r.status_code == 200 and r.json()["driver"]["employee_id"] == d.employee_id


def test_lockout_cannot_be_dodged_with_letter_case(browser, db):
    d = make_driver(db)
    variants = [d.employee_id.upper(), d.employee_id.lower(), f" {d.employee_id} "]
    for i in range(5):
        r = browser.post("/api/auth/driver/login", json={"employee_id": variants[i % 3], "pin": "0000"})
        assert r.status_code == 401
    r = browser.post("/api/auth/driver/login", json={"employee_id": d.employee_id, "pin": "1234"})
    assert r.status_code == 429
