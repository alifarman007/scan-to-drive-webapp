from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import VehicleStatus, pg_enum


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        CheckConstraint("current_km >= 0", name="current_km_nonneg"),
        CheckConstraint("qr_version >= 1", name="qr_version_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    car_code: Mapped[str] = mapped_column(String(20), unique=True)  # CAR-01 ...
    reg_number: Mapped[str] = mapped_column(String(40), unique=True)
    model: Mapped[str] = mapped_column(String(80))
    current_km: Mapped[int] = mapped_column(Integer, server_default="0")
    status: Mapped[VehicleStatus] = mapped_column(
        pg_enum(VehicleStatus, "vehicle_status"), server_default="active"
    )
    # Bumped when a sticker is lost; old car QR codes stop working.
    qr_version: Mapped[int] = mapped_column(Integer, server_default="1")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
