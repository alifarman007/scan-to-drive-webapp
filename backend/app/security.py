"""Hashing of PINs/passwords (bcrypt) and signing of login tokens (JWT)."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

ALGORITHM = "HS256"


def hash_secret(raw: str) -> str:
    # bcrypt only looks at the first 72 bytes, so longer input is rejected.
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt()).decode()


def verify_secret(raw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except ValueError:  # too long or malformed hash
        return False


_dummy_hash: str | None = None


def burn_time() -> None:
    """Spend the same time as a real check, so unknown users are not detectable by speed."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_secret("not-a-real-secret")
    verify_secret("wrong", _dummy_hash)


def create_access_token(kind: str, subject_id: int, expires: timedelta, role: str | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"{kind}:{subject_id}",
        "kind": kind,  # "driver" or "admin"
        "role": role,  # "admin" / "viewer" for admin users
        "iat": now,
        "exp": now + expires,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError if the token is invalid or expired."""
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])


# ---- short-lived photo links (PDF: "short-lived links"). An <img> tag cannot send a sign-in header, so the
# admin API hands out links that carry their own signature and expire after a few minutes.

import hashlib
import hmac
import time as _time

PHOTO_LINK_SECONDS = 600


def _photo_sig(trip_id: int, kind: str, exp: int) -> str:
    msg = f"photo:{trip_id}:{kind}:{exp}".encode()
    return hmac.new(settings.secret_key.encode(), msg, hashlib.sha256).hexdigest()


def sign_photo_link(trip_id: int, kind: str, seconds: int = PHOTO_LINK_SECONDS) -> str:
    exp = int(_time.time()) + seconds
    return f"/api/admin/photos/{trip_id}/{kind}?exp={exp}&sig={_photo_sig(trip_id, kind, exp)}"


def photo_link_valid(trip_id: int, kind: str, exp: int, sig: str) -> bool:
    return exp >= _time.time() and hmac.compare_digest(_photo_sig(trip_id, kind, exp), sig)
