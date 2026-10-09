"""Admin users and Settings pages, through the real API. Rolled back after each test."""
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.deps import get_db
from app.main import app
from app.models import AdminRole, AdminUser, RecordStatus, Setting, TripEvent
from app.security import create_access_token, hash_secret
from app.services.settings import DEFAULTS, get_int


@pytest.fixture()
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _uid():
    return uuid.uuid4().hex[:8]


def make_user(db, role=AdminRole.admin, password="correct-horse", **kw):
    u = AdminUser(username=f"u-{_uid()}", role=role, password_hash=hash_secret(password), **kw)
    db.add(u)
    db.flush()
    return u


def auth(u):
    return {"Authorization": "Bearer " + create_access_token("admin", u.id, timedelta(minutes=5), u.role.value)}


def last_event(db, name):
    return db.scalars(select(TripEvent).where(TripEvent.event == name).order_by(TripEvent.id.desc())).first()


# ---- users ----------------------------------------------------------------

def test_only_admin_role_can_use_users_page(client, db):
    admin, viewer = make_user(db), make_user(db, AdminRole.viewer)
    assert client.get("/api/admin/users", headers=auth(admin)).status_code == 200
    assert client.get("/api/admin/users", headers=auth(viewer)).status_code == 403
    assert client.get("/api/admin/users").status_code == 401
    body = {"username": "newperson", "role": "viewer", "password": "longenough1"}
    assert client.post("/api/admin/users", json=body, headers=auth(viewer)).status_code == 403


def test_add_user_then_sign_in(client, db):
    admin = make_user(db)
    name = f"new-{_uid()}"
    r = client.post("/api/admin/users", headers=auth(admin),
                    json={"username": name, "role": "viewer", "password": "viewer-pass-1"})
    assert r.status_code == 201 and r.json()["user"]["role"] == "viewer"
    assert "password" not in str(r.json()) and "hash" not in str(r.json())
    login = client.post("/api/auth/admin/login", json={"username": name, "password": "viewer-pass-1"})
    assert login.status_code == 200
    assert last_event(db, "admin_user_added").detail["username"] == name


def test_add_user_rules(client, db):
    admin = make_user(db)
    h = auth(admin)
    short = client.post("/api/admin/users", headers=h, json={"username": "abc", "role": "admin", "password": "short"})
    assert short.status_code == 422
    spaces = client.post("/api/admin/users", headers=h, json={"username": "has space", "role": "admin", "password": "longenough1"})
    assert spaces.status_code == 422
    toolong = client.post("/api/admin/users", headers=h, json={"username": "abcd", "role": "admin", "password": "x" * 73})
    assert toolong.status_code == 422
    dup = client.post("/api/admin/users", headers=h,
                      json={"username": admin.username.upper(), "role": "viewer", "password": "longenough1"})
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "USERNAME_TAKEN"


def test_change_role_and_deactivate(client, db):
    admin, viewer = make_user(db), make_user(db, AdminRole.viewer)
    r = client.patch(f"/api/admin/users/{viewer.id}", headers=auth(admin), json={"role": "admin"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "admin"
    r = client.patch(f"/api/admin/users/{viewer.id}", headers=auth(admin), json={"status": "inactive"})
    assert r.json()["user"]["status"] == "inactive"
    # a deactivated account's existing token stops working and sign-in is refused
    assert client.get("/api/auth/me", headers=auth(viewer)).status_code == 401
    assert client.post("/api/auth/admin/login", json={"username": viewer.username, "password": "correct-horse"}).status_code == 401
    assert last_event(db, "admin_user_changed").detail["after"]["status"] == "inactive"


def test_cannot_lock_yourself_out(client, db):
    admin = make_user(db)
    for body in ({"role": "viewer"}, {"status": "inactive"}):
        r = client.patch(f"/api/admin/users/{admin.id}", headers=auth(admin), json=body)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "CANNOT_CHANGE_SELF"
    # changing something that keeps you an active admin is fine
    assert client.patch(f"/api/admin/users/{admin.id}", headers=auth(admin), json={"role": "admin"}).status_code == 200
    # another admin can switch you off
    other = make_user(db)
    assert client.patch(f"/api/admin/users/{admin.id}", headers=auth(other), json={"status": "inactive"}).status_code == 200


def test_empty_or_unknown_edit(client, db):
    admin = make_user(db)
    assert client.patch(f"/api/admin/users/{admin.id}", headers=auth(admin), json={}).status_code == 422
    assert client.patch("/api/admin/users/99999999", headers=auth(admin), json={"role": "viewer"}).status_code == 404


def test_reset_password_by_admin(client, db):
    admin, other = make_user(db), make_user(db, AdminRole.viewer)
    r = client.post(f"/api/admin/users/{other.id}/reset-password", headers=auth(admin),
                    json={"new_password": "brand-new-pass"})
    assert r.status_code == 200
    assert client.post("/api/auth/admin/login", json={"username": other.username, "password": "correct-horse"}).status_code == 401
    assert client.post("/api/auth/admin/login", json={"username": other.username, "password": "brand-new-pass"}).status_code == 200
    assert "brand-new-pass" not in str(last_event(db, "admin_password_reset").detail)
    assert client.post(f"/api/admin/users/{other.id}/reset-password", headers=auth(other),
                       json={"new_password": "another-pass1"}).status_code == 403


def test_change_own_password(client, db):
    viewer = make_user(db, AdminRole.viewer)
    h = auth(viewer)
    wrong = client.post("/api/admin/users/me/password", headers=h,
                        json={"current_password": "nope", "new_password": "fresh-pass-1"})
    assert wrong.status_code == 401 and wrong.json()["detail"]["code"] == "WRONG_PASSWORD"
    ok = client.post("/api/admin/users/me/password", headers=h,
                     json={"current_password": "correct-horse", "new_password": "fresh-pass-1"})
    assert ok.status_code == 200
    assert client.post("/api/auth/admin/login", json={"username": viewer.username, "password": "fresh-pass-1"}).status_code == 200


# ---- settings -------------------------------------------------------------

def test_settings_list_for_admin_and_viewer(client, db):
    admin, viewer = make_user(db), make_user(db, AdminRole.viewer)
    for u in (admin, viewer):
        r = client.get("/api/admin/settings", headers=auth(u))
        assert r.status_code == 200
        keys = {s["key"] for s in r.json()["settings"]}
        assert keys == set(DEFAULTS)
    assert client.get("/api/admin/settings").status_code == 401


def test_change_settings_is_used_and_logged(client, db):
    admin = make_user(db)
    before = get_int(db, "qr_expiry_minutes")
    new = before + 7
    r = client.patch("/api/admin/settings", headers=auth(admin),
                     json={"values": {"qr_expiry_minutes": new, "allow_visitors": 0}})
    assert r.status_code == 200
    assert get_int(db, "qr_expiry_minutes") == new and get_int(db, "allow_visitors") == 0
    assert r.json()["changed"]["qr_expiry_minutes"] == {"from": before, "to": new}
    row = db.get(Setting, "qr_expiry_minutes")
    assert row.updated_by == admin.id
    ev = last_event(db, "settings_changed")
    assert ev.actor == f"admin:{admin.username}" and ev.detail["qr_expiry_minutes"]["to"] == new
    # same value again changes nothing and writes no new log line
    count = db.query(TripEvent).filter(TripEvent.event == "settings_changed").count()
    again = client.patch("/api/admin/settings", headers=auth(admin), json={"values": {"qr_expiry_minutes": new}})
    assert again.json()["changed"] == {}
    assert db.query(TripEvent).filter(TripEvent.event == "settings_changed").count() == count


def test_settings_validation_and_viewer_blocked(client, db):
    admin, viewer = make_user(db), make_user(db, AdminRole.viewer)
    h = auth(admin)
    keep = get_int(db, "wrong_id_limit")
    assert client.patch("/api/admin/settings", headers=auth(viewer), json={"values": {"wrong_id_limit": 3}}).status_code == 403
    assert client.patch("/api/admin/settings", headers=h, json={"values": {"nonsense": 1}}).json()["detail"]["code"] == "UNKNOWN_SETTING"
    assert client.patch("/api/admin/settings", headers=h, json={"values": {"allow_visitors": 5}}).json()["detail"]["code"] == "SETTING_OUT_OF_RANGE"
    assert client.patch("/api/admin/settings", headers=h, json={"values": {}}).status_code == 422
    # one bad value means nothing is saved
    bad = client.patch("/api/admin/settings", headers=h, json={"values": {"wrong_id_limit": keep + 1, "qr_expiry_minutes": 0}})
    assert bad.status_code == 422 and get_int(db, "wrong_id_limit") == keep
