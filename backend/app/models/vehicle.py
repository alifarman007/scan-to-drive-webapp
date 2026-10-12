from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import VehicleOwner, VehicleStatus, pg_enum


class Vendor(Base):
    """A company that rents cars to Epic (for example Lanka Bangla Enterprise). The name can be changed later."""
    __tablename__ = "vendors"
    __table_args__ = (Index("uq_vendors_name_lower", func.lower("name"), unique=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        CheckConstraint("current_km >= 0", name="current_km_nonneg"),
        CheckConstraint("qr_version >= 1", name="qr_version_positive"),
        # A vendor car always names its vendor; an Epic car never does.
        CheckConstraint("(owner = 'vendor') = (vendor_id IS NOT NULL)", name="vendor_matches_owner"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    car_code: Mapped[str] = mapped_column(String(20), unique=True)  # CAR-01 ...
    reg_number: Mapped[str] = mapped_column(String(40), unique=True)
    model: Mapped[str] = mapped_column(String(80))
    # 0 = not recorded yet: the first trip's start km becomes the car's km (no km-gap alert for it).
    current_km: Mapped[int] = mapped_column(Integer, server_default="0")
    status: Mapped[VehicleStatus] = mapped_column(
        pg_enum(VehicleStatus, "vehicle_status"), server_default="active"
    )
    owner: Mapped[VehicleOwner] = mapped_column(
        pg_enum(VehicleOwner, "vehicle_owner"), server_default="epic"
    )
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id", ondelete="RESTRICT"), index=True)
    # Bumped when a sticker is lost; old car QR codes stop working.
    qr_version: Mapped[int] = mapped_column(Integer, server_default="1")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    vendor: Mapped[Vendor | None] = relationship(lazy="selectin")  # not "joined": cars are locked FOR UPDATE
