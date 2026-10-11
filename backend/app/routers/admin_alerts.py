"""Alerts list for the admin (PDF 11.3, section 15): open and solved alerts, with a note when solving."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import current_admin_user, get_db, require_admin
from app.errors import api_error
from app.models import AdminUser, Alert, AlertStatus, AlertType, Driver, Trip, Vehicle
from app.services.audit import log_event

router = APIRouter(prefix="/admin/alerts", tags=["admin: alerts"])


class SolveBody(BaseModel):
    note: str = Field(default="", max_length=1000)


def alert_out(a: Alert, trip_no: str | None, car_code: str | None, resolved_by_name: str | None = None,
              driver_name: str | None = None) -> dict:
    return {
        "id": a.id, "type": a.type.value, "message": a.message, "status": a.status.value,
        "trip_id": a.trip_id, "trip_no": trip_no, "vehicle_id": a.vehicle_id, "car_code": car_code,
        "driver_name": driver_name,
        "note": a.note, "resolved_by": a.resolved_by, "resolved_by_name": resolved_by_name,
        "resolved_at": a.resolved_at, "created_at": a.created_at,
    }


@router.get("")
def list_alerts(
    status: Literal["open", "solved", "all"] = "open",
    type: AlertType | None = None,
    car_id: int | None = None,
    q: str | None = Query(None, max_length=80, description="search the message, trip number, car code"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db),
):
    """Newest first. Admins and viewers may look. `counts`: open / solved for the same type, car and search,
    and `by_type`: open alerts per type (for the filter chips)."""
    base = []
    if type is not None:
        base.append(Alert.type == type)
    if car_id is not None:
        base.append(Alert.vehicle_id == car_id)
    if q and q.strip():
        t = q.strip()
        base.append(Alert.message.icontains(t, autoescape=True) | Trip.trip_no.icontains(t, autoescape=True)
                    | Vehicle.car_code.icontains(t, autoescape=True))
    where = list(base)
    if status != "all":
        where.append(Alert.status == AlertStatus(status))

    def joined(stmt):
        return stmt.outerjoin(Trip, Trip.id == Alert.trip_id).outerjoin(Vehicle, Vehicle.id == Alert.vehicle_id)

    total = db.scalar(joined(select(func.count()).select_from(Alert)).where(*where))
    counts = dict(db.execute(joined(select(Alert.status, func.count()).select_from(Alert)).where(*base).group_by(Alert.status)).all())
    by_type = dict(db.execute(select(Alert.type, func.count()).where(Alert.status == AlertStatus.open).group_by(Alert.type)).all())
    rows = db.execute(
        joined(select(Alert, Trip.trip_no, Vehicle.car_code, AdminUser.username, Driver.name))
        .outerjoin(AdminUser, AdminUser.id == Alert.resolved_by)
        .outerjoin(Driver, Driver.id == Trip.driver_id)
        .where(*where).order_by(Alert.created_at.desc(), Alert.id.desc()).limit(limit).offset(offset)
    ).all()
    return {
        "total": total,
        "counts": {"open": counts.get(AlertStatus.open, 0), "solved": counts.get(AlertStatus.solved, 0)},
        "by_type": {k.value: v for k, v in by_type.items()},
        "alerts": [alert_out(a, t, c, u, dn) for a, t, c, u, dn in rows],
    }


@router.post("/{alert_id}/solve")
def solve_alert(
    alert_id: int, body: SolveBody, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Mark an alert as solved, with an optional note (admin only)."""
    alert = db.scalar(select(Alert).where(Alert.id == alert_id).with_for_update())
    if alert is None:
        raise api_error(404, "ALERT_NOT_FOUND", "Alert not found")
    if alert.status == AlertStatus.solved:
        raise api_error(409, "ALREADY_SOLVED", "This alert is already solved")
    alert.status = AlertStatus.solved
    alert.note = body.note.strip() or None
    alert.resolved_by = admin.id
    alert.resolved_at = datetime.now(timezone.utc)
    log_event(db, request, "alert_solved", f"admin:{admin.username}", trip_id=alert.trip_id,
              detail={"alert_id": alert.id, "type": alert.type.value, "note": alert.note})
    db.commit()
    trip = db.get(Trip, alert.trip_id) if alert.trip_id else None
    car = db.scalar(select(Vehicle.car_code).where(Vehicle.id == alert.vehicle_id)) if alert.vehicle_id else None
    return {"alert": alert_out(alert, trip.trip_no if trip else None, car, admin.username, trip.driver.name if trip else None)}
