"""Shared FastAPI dependencies: database session and who is calling."""
from collections.abc import Iterator

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import AdminRole, AdminUser, Driver, RecordStatus
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)

# The web app keeps the sign-in in httpOnly cookies (page scripts cannot read them, so a bad script
# cannot steal the session). Swagger, tests and scripts can still send "Authorization: Bearer <token>".
DRIVER_COOKIE = "s2d_driver"
ADMIN_COOKIE = "s2d_admin"
# Cookies are sent by the browser on its own, so any request that changes something must also carry
# this header. Other websites cannot add it, which blocks cross-site request forgery.
CSRF_HEADER = "x-s2d"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


def _token(request: Request, creds: HTTPAuthorizationCredentials | None, cookie: str) -> str | None:
    """The Bearer header if there is one, else the session cookie (with the CSRF header check)."""
    if creds is not None:
        return creds.credentials
    token = request.cookies.get(cookie)
    if token and request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "CSRF_CHECK_FAILED", "message": "Request blocked. Reload the page and try again."},
        )
    return token


def _claims(token: str | None) -> dict:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    try:
        return decode_access_token(token)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please sign in again")


def _driver_from_claims(claims: dict, db: Session) -> Driver:
    if claims.get("kind") != "driver":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Drivers only")
    driver = db.get(Driver, int(claims["sub"].split(":")[1]))
    if driver is None or driver.status != RecordStatus.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is not active")
    return driver


def _admin_from_claims(claims: dict, db: Session) -> AdminUser:
    if claims.get("kind") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin users only")
    user = db.get(AdminUser, int(claims["sub"].split(":")[1]))
    if user is None or user.status != RecordStatus.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is not active")
    return user


def current_driver(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Driver:
    return _driver_from_claims(_claims(_token(request, creds, DRIVER_COOKIE)), db)


def current_admin_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> AdminUser:
    """Admin or viewer (read-only)."""
    return _admin_from_claims(_claims(_token(request, creds, ADMIN_COOKIE)), db)


def require_admin(user: AdminUser = Depends(current_admin_user)) -> AdminUser:
    if user.role != AdminRole.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return user


def current_principal(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Driver | AdminUser:
    """Driver or admin user. With cookies only, the admin session wins if a browser holds both."""
    if creds is None and not request.cookies.get(ADMIN_COOKIE) and request.cookies.get(DRIVER_COOKIE):
        claims = _claims(_token(request, None, DRIVER_COOKIE))
    else:
        claims = _claims(_token(request, creds, ADMIN_COOKIE))
    if claims.get("kind") == "driver":
        return _driver_from_claims(claims, db)
    return _admin_from_claims(claims, db)


def optional_driver_id(
    request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer)
) -> int | None:
    """Id of the driver whose session is attached to this request, if any.

    Used on public passenger pages to notice when the request comes from a driver's own
    signed-in browser. A bad or missing token simply means "no driver".
    """
    token = creds.credentials if creds is not None else request.cookies.get(DRIVER_COOKIE)
    if not token:
        return None
    try:
        claims = decode_access_token(token)
    except jwt.PyJWTError:
        return None
    if claims.get("kind") != "driver":
        return None
    try:
        return int(claims["sub"].split(":")[1])
    except (KeyError, ValueError, IndexError):
        return None
