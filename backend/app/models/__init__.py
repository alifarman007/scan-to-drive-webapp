"""Import every model so Alembic and Base.metadata can see all tables."""
from app.models.audit import Alert, Setting, TripEvent
from app.models.enums import (
    OPEN_TRIP_STATUSES,
    AdminRole,
    AlertStatus,
    AlertType,
    RecordStatus,
    TripStage,
    TripStatus,
    VehicleStatus,
)
from app.models.people import AdminUser, Driver, Passenger
from app.models.trip import Trip, TripPhoto, TripToken
from app.models.vehicle import Vehicle

__all__ = [
    "Alert", "Setting", "TripEvent", "OPEN_TRIP_STATUSES", "AdminRole",
    "AlertStatus", "AlertType", "RecordStatus", "TripStage", "TripStatus",
    "VehicleStatus", "AdminUser", "Driver", "Passenger", "Trip", "TripPhoto",
    "TripToken", "Vehicle",
]
