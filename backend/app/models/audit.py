from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import AlertStatus, AlertType, pg_enum


class TripEvent(Base):
    """Audit log. Append-only: a database trigger blocks UPDATE and DELETE."""

    __tablename__ = "trip_events"
    __table_args__ = (
        Index("ix_trip_events_trip_id", "trip_id"),
        Index("ix_trip_events_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # NULL for system-wide actions (editing a car, changing settings, sign-ins).
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id"))
    event: Mapped[str] = mapped_column(String(80))
    actor: Mapped[str | None] = mapped_column(String(120))
    device: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(45))
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    # Extra context, for example the reason for an admin correction.
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint(
            "status <> 'solved' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)",
            name="solved_has_resolver",
        ),
        Index("ix_alerts_status", "status"),
        Index("ix_alerts_trip_id", "trip_id"),
        Index("ix_alerts_vehicle_id", "vehicle_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id"))
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"))
    type: Mapped[AlertType] = mapped_column(pg_enum(AlertType, "alert_type"))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[AlertStatus] = mapped_column(
        pg_enum(AlertStatus, "alert_status"), server_default="open"
    )
    note: Mapped[str | None] = mapped_column(Text)  # admin note
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Setting(Base):
    """Admin-changeable values: QR expiry, km gap limit, long-trip hours, ..."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"))
