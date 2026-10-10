"""Car page, opened by scanning the sticker in the car (PDF 6.2 steps D1 and S1), or by typing the car code."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import current_driver, get_db
from app.errors import api_error
from app.models import Driver, Trip, TripStatus, Vehicle
from app.services import settings as app_settings
from app.services.trips import open_trip_for_driver, start_blocker

router = APIRouter(prefix="/cars", tags=["cars"])


@router.get("/{car_code}")
def car_page(
    car_code: str,
    v: int | None = Query(None, description="Sticker version printed in the QR link. Left out when the driver typed the car code."),
    driver: Driver = Depends(current_driver),
    db: Session = Depends(get_db),
):
    vehicle = db.scalar(select(Vehicle).where(func.upper(Vehicle.car_code) == car_code.strip().upper()))
    if vehicle is None:
        raise api_error(404, "CAR_NOT_FOUND", "This car is not registered")
    if v is not None and v != vehicle.qr_version:
        raise api_error(410, "STICKER_OUTDATED", "This sticker is out of date. Ask the admin for a new one.")

    blocker = start_blocker(db, vehicle, driver)
    mine = open_trip_for_driver(db, driver.id)
    # Where the car's last finished trip ended: the usual start place for the next one.
    last_end_place = db.scalar(
        select(Trip.end_place)
        .where(Trip.vehicle_id == vehicle.id, Trip.status.in_((TripStatus.completed, TripStatus.closed_by_admin)),
               Trip.end_place.is_not(None))
        .order_by(Trip.end_time.desc().nulls_last(), Trip.id.desc()).limit(1)
    )
    return {
        "car": {
            "car_code": vehicle.car_code,
            "reg_number": vehicle.reg_number,
            "model": vehicle.model,
            "status": vehicle.status.value,
            "last_end_km": vehicle.current_km,  # shown as a hint in the start form
            "qr_version": vehicle.qr_version,
            "last_end_place": last_end_place,
        },
        # The start form warns before sending when the start km is this far above the last end km.
        "km_gap_limit_km": app_settings.get_int(db, "km_gap_limit_km"),
        "driver": {"employee_id": driver.employee_id, "name": driver.name},
        "can_start": blocker is None,
        "blocked": blocker,
        "my_open_trip": {"id": mine.id, "trip_no": mine.trip_no, "status": mine.status.value,
                         "car_code": mine.vehicle.car_code} if mine else None,
    }
