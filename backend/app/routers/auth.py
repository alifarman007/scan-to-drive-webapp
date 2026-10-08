"""Sign-in endpoints (PDF sections 4 and 15).

Drivers: employee ID + 4-digit PIN. The PIN is set on the first sign-in.
Admins and viewers: username + password.
Every attempt is written to the audit log (trip_events), and repeated wrong
tries pause sign-in for that account (PDF section 13: rate limits on sign-in).
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import current_principal, get_db
from app.models import AdminUser, Driver, RecordStatus, TripEvent
from app.services.audit import log_event
from app.security import (
    burn_time,
    create_access_token,
    hash_secret,
    verify_secret,
)

router = APIRouter(prefix="/auth", tags=["auth"])

PIN_PATTERN = r"^\d{4}$"
BAD_CREDENTIALS = "Invalid credentials"


class DriverLogin(BaseModel):
    employee_id: str = Field(min_length=1, max_length=40)
    pin: str = Field(pattern=PIN_PATTERN)


class DriverSetPin(DriverLogin):
    pass


class AdminLogin(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=72)


def _log(db: Session, request: Request, event: str, actor: str, detail: dict | None = None) -> None:
    # Commit now: failed attempts must be saved even though we raise an error next.
    log_event(db, request, event, actor, detail=detail, commit=True)


def _check_not_locked(db: Session, actor: str, ok_event: str, fail_event: str) -> None:
    """Pause sign-in after too many wrong tries since the last good sign-in."""
    last_ok_id = db.scalar(
        select(func.max(TripEvent.id)).where(TripEvent.event == ok_event, TripEvent.actor == actor)
    ) or 0
    since = func.now() - timedelta(minutes=settings.login_lockout_minutes)
    failures = db.scalar(
        select(func.count())
        .select_from(TripEvent)
        .where(
            TripEvent.event == fail_event,
            TripEvent.actor == actor,
            TripEvent.id > last_ok_id,
            TripEvent.created_at > since,
        )
    )
    if failures >= settings.login_max_failures:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many wrong tries. Try again in {settings.login_lockout_minutes} minutes or ask the admin.",
        )


def _driver_response(driver: Driver) -> dict:
    expires = timedelta(days=settings.driver_token_days)
    return {
        "access_token": create_access_token("driver", driver.id, expires),
        "token_type": "bearer",
        "expires_in": int(expires.total_seconds()),
        "driver": {"id": driver.id, "employee_id": driver.employee_id, "name": driver.name},
    }


@router.post("/driver/login")
def driver_login(body: DriverLogin, request: Request, db: Session = Depends(get_db)):
    actor = f"driver:{body.employee_id}"
    _check_not_locked(db, actor, "driver_login", "driver_login_failed")

    driver = db.scalar(select(Driver).where(Driver.employee_id == body.employee_id))
    if driver is None or driver.status != RecordStatus.active:
        burn_time()
        _log(db, request, "driver_login_failed", actor, {"reason": "unknown or inactive"})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)

    if driver.pin_hash is None:
        # First sign-in: the app should now ask the driver to choose a PIN.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": "PIN_NOT_SET", "message": "Choose a 4-digit PIN to finish setup"},
        )

    if not verify_secret(body.pin, driver.pin_hash):
        _log(db, request, "driver_login_failed", actor, {"reason": "wrong pin"})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)

    _log(db, request, "driver_login", actor)
    return _driver_response(driver)


@router.post("/driver/set-pin")
def driver_set_pin(body: DriverSetPin, request: Request, db: Session = Depends(get_db)):
    """First sign-in only. Once a PIN exists, only the admin can reset it."""
    actor = f"driver:{body.employee_id}"
    driver = db.scalar(select(Driver).where(Driver.employee_id == body.employee_id))
    if driver is None or driver.status != RecordStatus.active:
        burn_time()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)
    if driver.pin_hash is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "PIN already set. Ask the admin to reset it.")

    driver.pin_hash = hash_secret(body.pin)
    db.commit()
    _log(db, request, "driver_pin_set", actor)
    return _driver_response(driver)


@router.post("/admin/login")
def admin_login(body: AdminLogin, request: Request, db: Session = Depends(get_db)):
    actor = f"admin:{body.username}"
    _check_not_locked(db, actor, "admin_login", "admin_login_failed")

    user = db.scalar(select(AdminUser).where(AdminUser.username == body.username))
    if user is None or user.status != RecordStatus.active:
        burn_time()
        _log(db, request, "admin_login_failed", actor, {"reason": "unknown or inactive"})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)
    if not verify_secret(body.password, user.password_hash):
        _log(db, request, "admin_login_failed", actor, {"reason": "wrong password"})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)

    _log(db, request, "admin_login", actor)
    expires = timedelta(minutes=settings.admin_token_minutes)
    return {
        "access_token": create_access_token("admin", user.id, expires, role=user.role.value),
        "token_type": "bearer",
        "expires_in": int(expires.total_seconds()),
        "user": {"id": user.id, "username": user.username, "role": user.role.value},
    }


@router.get("/me")
def me(principal: Driver | AdminUser = Depends(current_principal)):
    if isinstance(principal, Driver):
        return {"kind": "driver", "id": principal.id, "employee_id": principal.employee_id, "name": principal.name}
    return {"kind": "admin", "id": principal.id, "username": principal.username, "role": principal.role.value}
