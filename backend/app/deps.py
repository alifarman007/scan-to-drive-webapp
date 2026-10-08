"""Shared FastAPI dependencies: database session and who is calling."""
from collections.abc import Iterator

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import AdminRole, AdminUser, Driver, RecordStatus
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


def _claims(creds: HTTPAuthorizationCredentials | None) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    try:
        return decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please sign in again")


def current_driver(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Driver:
    claims = _claims(creds)
    if claims.get("kind") != "driver":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Drivers only")
    driver = db.get(Driver, int(claims["sub"].split(":")[1]))
    if driver is None or driver.status != RecordStatus.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is not active")
    return driver


def current_admin_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> AdminUser:
    """Admin or viewer (read-only)."""
    claims = _claims(creds)
    if claims.get("kind") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin users only")
    user = db.get(AdminUser, int(claims["sub"].split(":")[1]))
    if user is None or user.status != RecordStatus.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is not active")
    return user


def require_admin(user: AdminUser = Depends(current_admin_user)) -> AdminUser:
    if user.role != AdminRole.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return user


def current_principal(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Driver | AdminUser:
    claims = _claims(creds)
    if claims.get("kind") == "driver":
        return current_driver(creds, db)
    return current_admin_user(creds, db)


def optional_driver_id(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> int | None:
    """Id of the driver whose session is attached to this request, if any.

    Used on public passenger pages to notice when the request comes from a driver's own
    signed-in browser. A bad or missing token simply means "no driver".
    """
    if creds is None:
        return None
    try:
        claims = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        return None
    if claims.get("kind") != "driver":
        return None
    try:
        return int(claims["sub"].split(":")[1])
    except (KeyError, ValueError, IndexError):
        return None
