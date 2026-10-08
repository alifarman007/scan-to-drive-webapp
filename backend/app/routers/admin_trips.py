"""Admin actions on stuck trips: close a trip and unlock a trip blocked by wrong IDs
(PDF 6.5 'Admin closes a trip', section 13 wrong-ID limit). Admin role only."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.deps import get_db, require_admin
from app.errors import api_error
from app.models import (
    AdminUser, Alert, AlertStatus, AlertType, Trip, TripStage, TripStatus, TripToken, Vehicle,
)
from app.models.enums import OPEN_TRIP_STATUSES
from app.schemas import trip_out
from app.services.audit import log_event
from app.services.qr_access import is_locked
from app.services.tokens import revoke_open_tokens

router = APIRouter(prefix="/admin/trips", tags=["admin: trips"])

MAX_KM = 9_999_999
# The QR stage each waiting status belongs to (a lock only exists in these two).
LOCK_STAGE = {
    TripStatus.waiting_for_passenger: TripStage.start,
    TripStatus.waiting_for_end_confirm: TripStage.end,
}


class CloseBody(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)
    # Only for a trip that has no end km yet (driver forgot or never ended it).
    end_km: int | None = Field(default=None, ge=0, le=MAX_KM)


class UnlockBody(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


def _locked_trip(db: Session, trip_id: int) -> Trip:
    trip = db.scalar(select(Trip).where(Trip.id == trip_id).with_for_update())
    if trip is None:
        raise api_error(404, "TRIP_NOT_FOUND", "Trip not found")
    return trip


@router.post("/{trip_id}/close")
def close_trip(
    trip_id: int, body: CloseBody, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Close any open trip (waiting for passenger, in progress, waiting for end confirmation).

    Status becomes Closed by admin, marked for review, all QR codes stop working and the car and
    driver are free again. A reason is required. If an end km is known (the driver already sent it,
    or the admin types it for a trip without one), it is kept and the car's current km moves forward
    (never backwards)."""
    reason = body.reason.strip()
    if not reason:
        raise api_error(422, "REASON_REQUIRED", "Please give a reason")

    trip = _locked_trip(db, trip_id)
    if trip.status not in OPEN_TRIP_STATUSES:
        raise api_error(409, "TRIP_NOT_OPEN", "Only an open trip can be closed", status=trip.status.value)

    if body.end_km is not None:
        if trip.end_km is not None:
            raise api_error(422, "END_KM_ALREADY_SET", "This trip already has an end km", end_km=trip.end_km)
        if body.end_km <= trip.start_km:
            raise api_error(422, "END_KM_TOO_LOW",
                            f"End km must be more than the start km ({trip.start_km}).", start_km=trip.start_km)
        trip.end_km = body.end_km
        trip.distance_km = body.end_km - trip.start_km
        trip.end_time = datetime.now(timezone.utc)

    if trip.end_km is not None:
        vehicle = db.scalar(select(Vehicle).where(Vehicle.id == trip.vehicle_id).with_for_update())
        if trip.end_km > vehicle.current_km:
            vehicle.current_km = trip.end_km

    previous = trip.status.value
    trip.status = TripStatus.closed_by_admin
    trip.close_reason = reason
    trip.needs_review = True
    revoke_open_tokens(db, trip.id)

    # Any open wrong-ID alert for this trip is finished by the close.
    now = datetime.now(timezone.utc)
    db.execute(
        update(Alert)
        .where(Alert.trip_id == trip.id, Alert.status == AlertStatus.open, Alert.type == AlertType.wrong_ids)
        .values(status=AlertStatus.solved, resolved_by=admin.id, resolved_at=now, note=f"Trip closed: {reason}")
    )
    # PDF alert type 'admin_closed': a record for the exceptions list, already handled by the admin.
    db.add(Alert(
        trip_id=trip.id, vehicle_id=trip.vehicle_id, type=AlertType.admin_closed,
        message=f"Trip {trip.trip_no} was closed by {admin.username}: {reason}",
        status=AlertStatus.solved, resolved_by=admin.id, resolved_at=now,
    ))
    log_event(db, request, "trip_closed_by_admin", f"admin:{admin.username}", trip_id=trip.id,
              detail={"reason": reason, "previous_status": previous, "end_km": trip.end_km})
    db.commit()
    return {"trip": trip_out(trip)}


@router.post("/{trip_id}/unlock")
def unlock_trip(
    trip_id: int, body: UnlockBody, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Give a trip that was blocked by wrong IDs a fresh set of tries.

    Resets the wrong-ID count of the current stage and solves its alert. The driver can then make
    a new QR. The history stays in the audit log. (The trip can also be closed instead.)"""
    reason = body.reason.strip()
    if not reason:
        raise api_error(422, "REASON_REQUIRED", "Please give a reason")

    trip = _locked_trip(db, trip_id)
    stage = LOCK_STAGE.get(trip.status)
    if stage is None or not is_locked(db, trip.id, stage):
        raise api_error(409, "NOT_LOCKED", "This trip is not blocked by wrong IDs", status=trip.status.value)

    db.execute(
        update(TripToken).where(TripToken.trip_id == trip.id, TripToken.kind == stage).values(failed_attempts=0)
    )
    now = datetime.now(timezone.utc)
    db.execute(
        update(Alert)
        .where(Alert.trip_id == trip.id, Alert.status == AlertStatus.open, Alert.type == AlertType.wrong_ids)
        .values(status=AlertStatus.solved, resolved_by=admin.id, resolved_at=now, note=f"Unlocked: {reason}")
    )
    log_event(db, request, "trip_unlocked", f"admin:{admin.username}", trip_id=trip.id,
              detail={"reason": reason, "stage": stage.value})
    db.commit()
    return {"trip": trip_out(trip), "stage": stage.value, "next": "The driver can now make a new QR."}
