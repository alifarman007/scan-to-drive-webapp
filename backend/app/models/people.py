from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import AdminRole, RecordStatus, pg_enum


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30))
    license_no: Mapped[str | None] = mapped_column(String(60))
    # NULL until the driver sets a 4-digit PIN on first sign-in. bcrypt hash only.
    pin_hash: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[RecordStatus] = mapped_column(
        pg_enum(RecordStatus, "driver_status"), server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Passenger(Base):
    __tablename__ = "passengers"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    department: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[RecordStatus] = mapped_column(
        pg_enum(RecordStatus, "passenger_status"), server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True)
    role: Mapped[AdminRole] = mapped_column(pg_enum(AdminRole, "admin_role"))
    password_hash: Mapped[str] = mapped_column(String(255))  # bcrypt
    status: Mapped[RecordStatus] = mapped_column(
        pg_enum(RecordStatus, "admin_user_status"), server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
