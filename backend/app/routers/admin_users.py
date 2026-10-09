"""Admin users page (PDF 11.2): add admin and viewer accounts, change role, deactivate, reset a password.
Admin role only. Accounts are never deleted, only deactivated. A signed-in person can also change their own
password."""
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import current_admin_user, get_db, require_admin
from app.errors import api_error
from app.models import AdminRole, AdminUser, RecordStatus
from app.security import hash_secret, verify_secret
from app.services.audit import log_event

router = APIRouter(prefix="/admin/users", tags=["admin: users"])


def _check_password(v: str) -> str:
    if len(v.encode()) > 72:  # bcrypt limit
        raise ValueError("password is too long (72 bytes at most)")
    if not v.strip():
        raise ValueError("password must not be blank")
    return v


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=60, pattern=r"^[A-Za-z0-9._-]+$")
    role: AdminRole
    password: str = Field(min_length=8)

    _pw = field_validator("password")(_check_password)


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: AdminRole | None = None
    status: RecordStatus | None = None


class PasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_password: str = Field(min_length=8)

    _pw = field_validator("new_password")(_check_password)


class PasswordChange(PasswordReset):
    current_password: str


def user_out(u: AdminUser) -> dict:
    return {"id": u.id, "username": u.username, "role": u.role.value, "status": u.status.value,
            "created_at": u.created_at}


def _get_user(db: Session, user_id: int) -> AdminUser:
    u = db.scalar(select(AdminUser).where(AdminUser.id == user_id).with_for_update())
    if u is None:
        raise api_error(404, "USER_NOT_FOUND", "Admin user not found")
    return u


def _active_admin_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(AdminUser).where(
        AdminUser.role == AdminRole.admin, AdminUser.status == RecordStatus.active))


@router.get("")
def list_users(_: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.scalars(select(AdminUser).order_by(AdminUser.username)).all()
    return {"total": len(users), "items": [user_out(u) for u in users]}


@router.post("", status_code=201)
def add_user(body: UserCreate, request: Request, admin: AdminUser = Depends(require_admin),
             db: Session = Depends(get_db)):
    username = body.username.strip()
    if db.scalar(select(AdminUser.id).where(func.lower(AdminUser.username) == username.lower())):
        raise api_error(409, "USERNAME_TAKEN", "This username is already used")
    user = AdminUser(username=username, role=body.role, password_hash=hash_secret(body.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "USERNAME_TAKEN", "This username is already used")
    log_event(db, request, "admin_user_added", f"admin:{admin.username}",
              detail={"username": username, "role": body.role.value})
    db.commit()
    return {"user": user_out(user)}


@router.patch("/{user_id}")
def edit_user(user_id: int, body: UserUpdate, request: Request, admin: AdminUser = Depends(require_admin),
              db: Session = Depends(get_db)):
    """Change role or switch an account on/off. You cannot lock yourself out, and the last active admin
    cannot be demoted or deactivated."""
    changes = body.model_dump(exclude_unset=True)
    if not changes or any(v is None for v in changes.values()):
        raise api_error(422, "NOTHING_TO_CHANGE", "Send a role and/or status to change")
    user = _get_user(db, user_id)

    new_role = changes.get("role", user.role)
    new_status = changes.get("status", user.status)
    loses_admin = user.role == AdminRole.admin and user.status == RecordStatus.active and (
        new_role != AdminRole.admin or new_status != RecordStatus.active)
    if loses_admin:
        if user.id == admin.id:
            raise api_error(409, "CANNOT_CHANGE_SELF", "You cannot remove your own admin access")
        if _active_admin_count(db) <= 1:
            raise api_error(409, "LAST_ADMIN", "There must be at least one active admin")

    before = {"role": user.role.value, "status": user.status.value}
    user.role, user.status = new_role, new_status
    after = {"role": user.role.value, "status": user.status.value}
    if before != after:
        log_event(db, request, "admin_user_changed", f"admin:{admin.username}",
                  detail={"username": user.username, "before": before, "after": after})
    db.commit()
    return {"user": user_out(user)}


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, body: PasswordReset, request: Request,
                   admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db)):
    user = _get_user(db, user_id)
    user.password_hash = hash_secret(body.new_password)
    log_event(db, request, "admin_password_reset", f"admin:{admin.username}", detail={"username": user.username})
    db.commit()
    return {"user": user_out(user)}


@router.post("/me/password")
def change_my_password(body: PasswordChange, request: Request, me: AdminUser = Depends(current_admin_user),
                       db: Session = Depends(get_db)):
    """Any signed-in admin or viewer changes their own password."""
    if not verify_secret(body.current_password, me.password_hash):
        raise api_error(401, "WRONG_PASSWORD", "Current password is wrong")
    me.password_hash = hash_secret(body.new_password)
    log_event(db, request, "admin_password_changed", f"admin:{me.username}")
    db.commit()
    return {"changed": True}
