"""Business rules shared by the car page and the trip endpoints (PDF sections 6 and 12)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import OPEN_TRIP_STATUSES, Driver, Trip, Vehicle, VehicleStatus


def open_trip_for_vehicle(db: Session, vehicle_id: int) -> Trip | None:
    return db.scalar(
        select(Trip).where(Trip.vehicle_id == vehicle_id, Trip.status.in_(OPEN_TRIP_STATUSES))
    )


def open_trip_for_driver(db: Session, driver_id: int) -> Trip | None:
    return db.scalar(
        select(Trip).where(Trip.driver_id == driver_id, Trip.status.in_(OPEN_TRIP_STATUSES))
    )


def start_blocker(db: Session, vehicle: Vehicle, driver: Driver) -> dict | None:
    """Why this driver cannot start a trip on this car right now, or None if they can.

    Returns {"code", "message", ...} so the app can show a clear message.
    """
    if vehicle.status == VehicleStatus.maintenance:
        return {"code": "CAR_IN_MAINTENANCE", "message": f"{vehicle.car_code} is in maintenance"}
    if vehicle.status != VehicleStatus.active:
        return {"code": "CAR_INACTIVE", "message": f"{vehicle.car_code} is not active"}

    on_car = open_trip_for_vehicle(db, vehicle.id)
    if on_car is not None:
        if on_car.driver_id == driver.id:
            return {
                "code": "DRIVER_HAS_OPEN_TRIP",
                "message": f"You already have an open trip ({on_car.trip_no}) on this car",
                "trip_id": on_car.id,
                "trip_no": on_car.trip_no,
            }
        return {
            "code": "CAR_IN_USE",
            "message": f"{vehicle.car_code} is in use by {on_car.driver.name}",
        }

    mine = open_trip_for_driver(db, driver.id)
    if mine is not None:
        return {
            "code": "DRIVER_HAS_OPEN_TRIP",
            "message": f"You already have an open trip ({mine.trip_no}) on {mine.vehicle.car_code}",
            "trip_id": mine.id,
            "trip_no": mine.trip_no,
        }
    return None
