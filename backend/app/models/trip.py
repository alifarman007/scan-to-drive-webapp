from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Sequence,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import TripStage, TripStatus, pg_enum

# Trip numbers look like T-000458. The sequence is created in the first migration.
trip_no_seq = Sequence("trip_no_seq", metadata=Base.metadata)

_OPEN = "status IN ('waiting_for_passenger','in_progress','waiting_for_end_confirm')"


class Trip(Base):
    __tablename__ = "trips"
    __table_args__ = (
        CheckConstraint("start_km >= 0", name="start_km_nonneg"),
        CheckConstraint("end_km IS NULL OR end_km > start_km", name="end_after_start"),
        CheckConstraint(
            "distance_km IS NULL OR distance_km >= 0", name="distance_nonneg"
        ),
        # PDF 6.4: purpose is required for trips without a passenger.
        CheckConstraint(
            "with_passenger OR (purpose IS NOT NULL AND length(btrim(purpose)) > 0)",
            name="purpose_required_without_passenger",
        ),
        # PDF 6.5: cancelling or admin-closing a trip needs a reason.
        CheckConstraint(
            "status NOT IN ('cancelled','closed_by_admin') "
            "OR (close_reason IS NOT NULL AND length(btrim(close_reason)) > 0)",
            name="reason_required_when_stopped",
        ),
        CheckConstraint(
            "status NOT IN ('waiting_for_end_confirm','completed') "
            "OR (end_km IS NOT NULL AND end_time IS NOT NULL)",
            name="ended_trip_has_end_data",
        ),
        # PDF rules 1 and 3: one open trip per car and per driver, enforced by the DB.
        Index(
            "uq_trips_one_open_per_vehicle",
            "vehicle_id",
            unique=True,
            postgresql_where=text(_OPEN),
        ),
        Index(
            "uq_trips_one_open_per_driver",
            "driver_id",
            unique=True,
            postgresql_where=text(_OPEN),
        ),
        Index("ix_trips_status", "status"),
        Index("ix_trips_vehicle_id", "vehicle_id"),
        Index("ix_trips_driver_id", "driver_id"),
        Index("ix_trips_passenger_id", "passenger_id"),
        Index("ix_trips_start_time", "start_time"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_no: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        server_default=text("'T-' || lpad(nextval('trip_no_seq')::text, 6, '0')"),
    )
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"))
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"))
    # NULL until the passenger confirms the start (or always NULL without passenger).
    passenger_id: Mapped[int | None] = mapped_column(ForeignKey("passengers.id"))
    with_passenger: Mapped[bool] = mapped_column(Boolean)
    purpose: Mapped[str | None] = mapped_column(Text)

    start_km: Mapped[int] = mapped_column(Integer)
    end_km: Mapped[int | None] = mapped_column(Integer)
    start_place: Mapped[str] = mapped_column(String(255))
    start_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    start_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    end_place: Mapped[str | None] = mapped_column(String(255))
    end_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    end_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    destination: Mapped[str] = mapped_column(String(255))

    # All times are server times, stored in UTC (show as UTC+6 in the UI).
    start_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    journey_start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_confirm_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    distance_km: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[TripStatus] = mapped_column(pg_enum(TripStatus, "trip_status"))
    close_reason: Mapped[str | None] = mapped_column(Text)
    # "Marked for review" (admin-closed trips, passenger could not scan, no passenger).
    needs_review: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TripPhoto(Base):
    __tablename__ = "trip_photos"
    __table_args__ = (UniqueConstraint("trip_id", "kind", name="uq_trip_photos_trip_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id"))
    kind: Mapped[TripStage] = mapped_column(pg_enum(TripStage, "trip_photo_kind"))
    # Path of the file in Azure Blob Storage (or the local folder in dev).
    file_url: Mapped[str] = mapped_column(String(500))
    taken_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TripToken(Base):
    """One-time Start/End QR codes. Only a hash of the code is stored."""

    __tablename__ = "trip_tokens"
    __table_args__ = (
        CheckConstraint("failed_attempts >= 0", name="failed_attempts_nonneg"),
        Index("ix_trip_tokens_trip_id", "trip_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id"))
    kind: Mapped[TripStage] = mapped_column(pg_enum(TripStage, "trip_token_kind"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # SHA-256 hex
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when the driver taps "Make new QR"; the old code stops working.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Wrong passenger-ID tries; the QR is blocked at the admin-set limit.
    failed_attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
