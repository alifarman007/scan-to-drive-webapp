"""Write rows to the audit log (trip_events)."""
from decimal import Decimal

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import TripEvent


def log_event(
    db: Session,
    request: Request,
    event: str,
    actor: str,
    *,
    trip_id: int | None = None,
    lat: float | Decimal | None = None,
    lng: float | Decimal | None = None,
    detail: dict | None = None,
    commit: bool = False,
) -> None:
    """Who, what, when, which device, IP and GPS (PDF section 9)."""
    db.add(
        TripEvent(
            trip_id=trip_id,
            event=event,
            actor=actor[:120],
            device=(request.headers.get("user-agent") or "")[:255] or None,
            ip=request.client.host if request.client else None,
            lat=lat,
            lng=lng,
            detail=detail,
        )
    )
    if commit:
        db.commit()
