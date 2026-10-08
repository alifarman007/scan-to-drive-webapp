"""One-time Start/End QR codes. Only a SHA-256 hash of the code is stored."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import TripStage, TripToken


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def qr_url(raw: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/p/{raw}"


def create_trip_token(db: Session, trip_id: int, kind: TripStage, minutes: int) -> tuple[str, datetime]:
    """Returns (QR link, expiry). The raw code cannot be read back later."""
    raw = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    db.add(TripToken(trip_id=trip_id, kind=kind, token_hash=hash_token(raw), expires_at=expires_at))
    return qr_url(raw), expires_at


def revoke_open_tokens(db: Session, trip_id: int, kind: TripStage | None = None) -> None:
    """Stop every unused code of the trip (new QR, cancel, ...)."""
    stmt = (
        update(TripToken)
        .where(TripToken.trip_id == trip_id, TripToken.used_at.is_(None), TripToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    if kind is not None:
        stmt = stmt.where(TripToken.kind == kind)
    db.execute(stmt)
