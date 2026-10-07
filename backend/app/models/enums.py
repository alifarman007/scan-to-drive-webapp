"""Python enums behind the PostgreSQL enum types (values match the PDF)."""
import enum

from sqlalchemy import Enum


class VehicleStatus(str, enum.Enum):
    active = "active"
    maintenance = "maintenance"
    inactive = "inactive"


class RecordStatus(str, enum.Enum):
    """Used for drivers, passengers and admin users. Never delete, only deactivate."""

    active = "active"
    inactive = "inactive"


class AdminRole(str, enum.Enum):
    admin = "admin"
    viewer = "viewer"


class TripStatus(str, enum.Enum):
    waiting_for_passenger = "waiting_for_passenger"
    in_progress = "in_progress"
    waiting_for_end_confirm = "waiting_for_end_confirm"
    completed = "completed"
    cancelled = "cancelled"
    closed_by_admin = "closed_by_admin"


# Statuses where a trip still holds the car and the driver.
OPEN_TRIP_STATUSES = (
    TripStatus.waiting_for_passenger,
    TripStatus.in_progress,
    TripStatus.waiting_for_end_confirm,
)


class TripStage(str, enum.Enum):
    start = "start"
    end = "end"


class AlertType(str, enum.Enum):
    km_gap = "km_gap"
    long_trip = "long_trip"
    waiting_too_long = "waiting_too_long"
    wrong_ids = "wrong_ids"
    high_km = "high_km"
    admin_closed = "admin_closed"


class AlertStatus(str, enum.Enum):
    open = "open"
    solved = "solved"


def pg_enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    """Native PostgreSQL enum that stores the member *values*."""
    return Enum(
        enum_cls,
        name=name,
        values_callable=lambda e: [m.value for m in e],
    )
