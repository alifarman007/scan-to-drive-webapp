"""Car page, opened by scanning the sticker in the car (PDF 6.2 steps D1 and S1)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import current_driver, get_db
from app.errors import api_error
from app.models import Driver, Vehicle
from app.services.trips import open_trip_for_driver, start_blocker

router = APIRouter(prefix="/cars", tags=["cars"])


@router.get("/{car_code}")
def car_page(
    car_code: str,
    v: int = Query(description="Sticker version printed in the QR link"),
    driver: Driver = Depends(current_driver),
    db: Session = Depends(get_db),
):
    vehicle = db.scalar(select(Vehicle).where(Vehicle.car_code == car_code))
    if vehicle is None:
        raise api_error(404, "CAR_NOT_FOUND", "This car is not registered")
    if v != vehicle.qr_version:
        raise api_error(410, "STICKER_OUTDATED", "This sticker is out of date. Ask the admin for a new one.")

    blocker = start_blocker(db, vehicle, driver)
    mine = open_trip_for_driver(db, driver.id)
    return {
        "car": {
            "car_code": vehicle.car_code,
            "reg_number": vehicle.reg_number,
            "model": vehicle.model,
            "status": vehicle.status.value,
            "last_end_km": vehicle.current_km,  # shown as a hint in the start form
            "qr_version": vehicle.qr_version,
        },
        "driver": {"employee_id": driver.employee_id, "name": driver.name},
        "can_start": blocker is None,
        "blocked": blocker,
        "my_open_trip": {"id": mine.id, "trip_no": mine.trip_no, "status": mine.status.value} if mine else None,
    }
