"""Sign-in tests, run through the real API against the migrated database.
Everything is rolled back after each test (see conftest.py)."""
import uuid
from datetime import timedelta

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.deps import get_db, require_admin
from app.main import app
from app.models import AdminRole, AdminUser, Driver, RecordStatus, TripEvent
from app.security import create_access_token, hash_secret


@pytest.fixture()
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def make_driver(db, pin=None, **kw):
    d = Driver(employee_id=f"E-{_uid()}", name="Test Driver",
               pin_hash=hash_secret(pin) if pin else None, **kw)
    db.add(d)
    db.flush()
    return d


def make_admin(db, password="correct-horse", role=AdminRole.admin, **kw):
    u = AdminUser(username=f"u-{_uid()}", role=role, password_hash=hash_secret(password), **kw)
    db.add(u)
    db.flush()
    return u


def events(db, name):
    return db.scalars(select(TripEvent).where(TripEvent.event == name)).all()


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["database"] == "ok"


# ---- admin ----------------------------------------------------------------

def test_admin_login_and_me(client, db):
    u = make_admin(db)
    r = client.post("/api/auth/admin/login", json={"username": u.username, "password": "correct-horse"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json() == {"kind": "admin", "id": u.id, "username": u.username, "role": "admin"}
    assert events(db, "admin_login")


def test_admin_wrong_password_is_rejected_and_logged(client, db):
    u = make_admin(db)
    r = client.post("/api/auth/admin/login", json={"username": u.username, "password": "nope"})
    assert r.status_code == 401
    assert events(db, "admin_login_failed")


def test_unknown_admin_gets_same_error(client):
    r = client.post("/api/auth/admin/login", json={"username": "ghost", "password": "whatever1"})
    assert r.status_code == 401 and r.json()["detail"] == "Invalid credentials"


def test_inactive_admin_cannot_sign_in(client, db):
    u = make_admin(db, status=RecordStatus.inactive)
    r = client.post("/api/auth/admin/login", json={"username": u.username, "password": "correct-horse"})
    assert r.status_code == 401


def test_admin_locked_after_too_many_wrong_tries(client, db):
    u = make_admin(db)
    for _ in range(5):
        assert client.post("/api/auth/admin/login", json={"username": u.username, "password": "bad"}).status_code == 401
    r = client.post("/api/auth/admin/login", json={"username": u.username, "password": "correct-horse"})
    assert r.status_code == 429


def test_admin_username_ignores_letter_case_and_lockout_counts_it_once(client, db):
    u = make_admin(db)
    r = client.post("/api/auth/admin/login", json={"username": f"  {u.username.upper()} ", "password": "correct-horse"})
    assert r.status_code == 200 and r.json()["user"]["username"] == u.username
    # wrong tries with different letter cases all count toward the same lockout
    for name in (u.username, u.username.upper(), u.username.title(), u.username, u.username.upper()):
        assert client.post("/api/auth/admin/login", json={"username": name, "password": "bad"}).status_code == 401
    assert client.post("/api/auth/admin/login", json={"username": u.username, "password": "correct-horse"}).status_code == 429


def test_role_guard_admin_vs_viewer_vs_driver(db):
    guarded = FastAPI()
    guarded.dependency_overrides[get_db] = lambda: db

    @guarded.get("/only-admin")
    def only_admin(user=Depends(require_admin)):
        return {"ok": True}

    c = TestClient(guarded)
    admin, viewer, driver = make_admin(db), make_admin(db, role=AdminRole.viewer), make_driver(db, pin="1234")
    tok = lambda kind, id_, role=None: {"Authorization": "Bearer " + create_access_token(kind, id_, timedelta(minutes=5), role)}

    assert c.get("/only-admin", headers=tok("admin", admin.id, "admin")).status_code == 200
    assert c.get("/only-admin", headers=tok("admin", viewer.id, "viewer")).status_code == 403
    assert c.get("/only-admin", headers=tok("driver", driver.id)).status_code == 403
    assert c.get("/only-admin").status_code == 401


def test_expired_or_garbage_token_is_rejected(client, db):
    u = make_admin(db)
    expired = create_access_token("admin", u.id, timedelta(seconds=-5), "admin")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


# ---- driver ---------------------------------------------------------------

def test_driver_first_sign_in_sets_pin_then_logs_in(client, db):
    d = make_driver(db)  # no PIN yet
    first = client.post("/api/auth/driver/login", json={"employee_id": d.employee_id, "pin": "1234"})
    assert first.status_code == 409 and first.json()["detail"]["code"] == "PIN_NOT_SET"

    bad = client.post("/api/auth/driver/set-pin", json={"employee_id": d.employee_id, "pin": "12ab"})
    assert bad.status_code == 422  # PIN must be exactly 4 digits

    ok = client.post("/api/auth/driver/set-pin", json={"employee_id": d.employee_id, "pin": "4821"})
    assert ok.status_code == 200 and ok.json()["driver"]["employee_id"] == d.employee_id
    db.refresh(d)
    assert d.pin_hash and d.pin_hash != "4821"  # stored as a hash

    again = client.post("/api/auth/driver/set-pin", json={"employee_id": d.employee_id, "pin": "0000"})
    assert again.status_code == 409  # cannot overwrite an existing PIN

    login = client.post("/api/auth/driver/login", json={"employee_id": d.employee_id, "pin": "4821"})
    assert login.status_code == 200
    token = login.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["kind"] == "driver" and me.json()["name"] == "Test Driver"


def test_driver_wrong_pin_and_lockout(client, db):
    d = make_driver(db, pin="1234")
    body = {"employee_id": d.employee_id, "pin": "0000"}
    before = len(events(db, "driver_login_failed"))  # the dev database may already hold real failed logins
    for _ in range(5):
        assert client.post("/api/auth/driver/login", json=body).status_code == 401
    assert len(events(db, "driver_login_failed")) - before == 5
    right = client.post("/api/auth/driver/login", json={"employee_id": d.employee_id, "pin": "1234"})
    assert right.status_code == 429


def test_successful_login_resets_the_failure_count(client, db):
    d = make_driver(db, pin="1234")
    for _ in range(4):
        client.post("/api/auth/driver/login", json={"employee_id": d.employee_id, "pin": "0000"})
    assert client.post("/api/auth/driver/login", json={"employee_id": d.employee_id, "pin": "1234"}).status_code == 200
    for _ in range(4):
        assert client.post("/api/auth/driver/login", json={"employee_id": d.employee_id, "pin": "0000"}).status_code == 401


def test_inactive_or_unknown_driver_cannot_sign_in(client, db):
    d = make_driver(db, pin="1234", status=RecordStatus.inactive)
    assert client.post("/api/auth/driver/login", json={"employee_id": d.employee_id, "pin": "1234"}).status_code == 401
    assert client.post("/api/auth/driver/login", json={"employee_id": "NOPE", "pin": "1234"}).status_code == 401
    assert client.post("/api/auth/driver/set-pin", json={"employee_id": "NOPE", "pin": "1234"}).status_code == 401
