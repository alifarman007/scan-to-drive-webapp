"""Checks for the one-time QR codes passengers open (PDF sections 8 and 13).

A code can be: unknown, already used, replaced (driver made a new one), expired, or blocked
because of too many wrong employee IDs on the trip. Each case gets its own clear message.
"""
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import api_error
from app.models import (
    Alert, AlertStatus, AlertType, Trip, TripEvent, TripStage, TripStatus, TripToken,
)
from app.services import settings as app_settings
from app.services.audit import log_event
from app.services.tokens import hash_token, revoke_open_tokens

# Status the trip must be in for each kind of QR code.
REQUIRED_STATUS = {
    TripStage.start: TripStatus.waiting_for_passenger,
    TripStage.end: TripStatus.waiting_for_end_confirm,
}

# Limit on name look-ups per trip, so a QR holder cannot list employee names by trying IDs.
MAX_LOOKUPS_PER_TRIP = 15


def failures_for_trip(db: Session, trip_id: int, kind: TripStage) -> int:
    """Wrong-ID tries on this trip for this stage, over ALL its codes (a new QR does not reset it)."""
    return db.scalar(
        select(func.coalesce(func.sum(TripToken.failed_attempts), 0)).where(
            TripToken.trip_id == trip_id, TripToken.kind == kind
        )
    )


def is_locked(db: Session, trip_id: int, kind: TripStage) -> bool:
    return failures_for_trip(db, trip_id, kind) >= app_settings.get_int(db, "wrong_id_limit")


def tries_left(db: Session, trip_id: int, kind: TripStage) -> int:
    return max(0, app_settings.get_int(db, "wrong_id_limit") - failures_for_trip(db, trip_id, kind))


def lookups_for_trip(db: Session, trip_id: int) -> int:
    return db.scalar(
        select(func.count()).select_from(TripEvent).where(
            TripEvent.trip_id == trip_id,
            TripEvent.event.in_(("passenger_lookup", "passenger_wrong_id")),
        )
    )


def resolve_token(db: Session, raw: str, kind: TripStage, *, lock: bool = False) -> tuple[TripToken, Trip]:
    """Return (token, trip) if the QR can be used now, otherwise raise a clear error.

    lock=True keeps the rows locked until the end of the request, so two phones cannot
    confirm the same trip at the same moment.
    """
    stmt = select(TripToken).where(TripToken.token_hash == hash_token(raw), TripToken.kind == kind)
    if lock:
        stmt = stmt.with_for_update()
    token = db.scalar(stmt)
    if token is None:
        raise api_error(404, "QR_INVALID", "This QR code is not valid")

    trip_stmt = select(Trip).where(Trip.id == token.trip_id)
    if lock:
        trip_stmt = trip_stmt.with_for_update()
    trip = db.scalar(trip_stmt)

    if token.used_at is not None:
        raise api_error(410, "QR_USED", "This QR code was already used")
    if trip.status == TripStatus.cancelled:
        raise api_error(410, "TRIP_CANCELLED", "This trip was cancelled")
    if is_locked(db, trip.id, kind):
        raise api_error(423, "QR_BLOCKED", "Too many wrong IDs. This QR is blocked, please ask the driver.")
    if token.revoked_at is not None:
        raise api_error(410, "QR_REPLACED", "This QR code was replaced. Ask the driver to show the new one.")
    if token.expires_at <= datetime.now(timezone.utc):
        raise api_error(410, "QR_EXPIRED", "QR expired. Ask the driver to make a new one.")
    if trip.status != REQUIRED_STATUS[kind]:
        raise api_error(410, "TRIP_NOT_WAITING", "This trip is not waiting for confirmation")
    return token, trip


def register_wrong_try(db: Session, request: Request, token: TripToken, trip: Trip, typed_id: str) -> int:
    """Count a wrong ID, block the QR and alert the admin at the limit. Commits. Returns tries left."""
    limit = app_settings.get_int(db, "wrong_id_limit")
    token.failed_attempts += 1
    db.flush()
    total = failures_for_trip(db, trip.id, token.kind)
    log_event(db, request, "passenger_wrong_id", "passenger:unknown", trip_id=trip.id,
              detail={"typed_id": typed_id[:40], "wrong_tries": total})

    if total >= limit:
        revoke_open_tokens(db, trip.id, token.kind)
        already = db.scalar(
            select(Alert.id).where(
                Alert.trip_id == trip.id, Alert.type == AlertType.wrong_ids, Alert.status == AlertStatus.open
            )
        )
        if already is None:
            db.add(Alert(
                trip_id=trip.id, vehicle_id=trip.vehicle_id, type=AlertType.wrong_ids,
                message=f"Trip {trip.trip_no}: {total} wrong employee IDs entered. The QR is blocked.",
            ))
        log_event(db, request, "qr_blocked", "system", trip_id=trip.id, detail={"stage": token.kind.value})
    db.commit()  # commit now: the count must be saved even though an error is raised next
    return max(0, limit - total)
