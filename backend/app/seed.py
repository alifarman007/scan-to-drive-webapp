"""Fill a new, empty database: settings, the admin and viewer accounts, and the real fleet (app/fleet_data.py:
vendor Lanka Bangla Enterprise, 24 cars, 24 drivers). Safe to run more than once (existing rows are kept; cars
and drivers are only added to an empty database).

Run from the backend folder:   python -m app.seed
A database that still has the old test data: use python -m app.load_fleet instead.
"""
import os
import secrets

import bcrypt
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.db import SessionLocal
from app.fleet_data import VENDOR_NAME, fleet
from app.models import AdminUser, Driver, Setting, Vehicle, VehicleOwner, Vendor

# Defaults for the admin-changeable settings (PDF section 11.2 "Settings").
SETTINGS = [
    ("qr_expiry_minutes", "15", "Minutes before a Start/End QR expires (PDF example: 15)"),
    ("wrong_id_limit", "5", "Wrong passenger-ID tries before the QR is blocked (PDF: 5)"),
    ("long_trip_hours", "6", "Hours in progress before a long-trip alert (PDF sketch: 6)"),
    ("km_gap_limit_km", "20", "Km gap over last end km that raises an alert (placeholder)"),
    ("waiting_too_long_minutes", "30", "Minutes waiting for a passenger before an alert (placeholder)"),
    ("high_km_limit_km", "300", "Trip distance in km above which a high-km alert is raised (placeholder)"),
    ("allow_cant_scan", "1", "1 = driver may tap 'Passenger can't scan' and the admin approves later; 0 = off"),
    ("allow_visitors", "1", "1 = passenger page offers 'Other' (visitor) besides EPIC employee; 0 = employee ID only"),
]

def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt()).decode()


def main() -> None:
    admin_password = os.environ.get("SEED_ADMIN_PASSWORD") or secrets.token_urlsafe(10)
    viewer_password = os.environ.get("SEED_VIEWER_PASSWORD") or secrets.token_urlsafe(10)

    with SessionLocal() as db:
        db.execute(
            insert(Setting).values(
                [{"key": k, "value": v, "description": d} for k, v, d in SETTINGS]
            ).on_conflict_do_nothing(index_elements=["key"])
        )

        # The real fleet, only into an empty database. Drivers have no PIN yet: they set one on first sign-in
        # (PDF 6.1). Employees (passengers) are saved when they first type their ID on the passenger page.
        if not db.scalar(select(func.count()).select_from(Vehicle)) and not db.scalar(select(func.count()).select_from(Driver)):
            vendor = db.scalar(select(Vendor).where(func.lower(Vendor.name) == VENDOR_NAME.lower())) or Vendor(name=VENDOR_NAME)
            db.add(vendor)
            db.flush()
            cars, drivers = fleet()
            for c in cars:
                db.add(Vehicle(car_code=c["car_code"], reg_number=c["reg_number"], model=c["model"],
                               owner=VehicleOwner.vendor if c["vendor"] else VehicleOwner.epic,
                               vendor_id=vendor.id if c["vendor"] else None))
            for d in drivers:
                db.add(Driver(employee_id=d["employee_id"], name=d["name"], phone=d["phone"]))

        created = []
        for username, role, pw in (("admin", "admin", admin_password), ("viewer", "viewer", viewer_password)):
            res = db.execute(
                insert(AdminUser)
                .values(username=username, role=role, password_hash=hash_password(pw))
                .on_conflict_do_nothing(index_elements=["username"])
                .returning(AdminUser.id)
            ).first()
            if res:
                created.append((username, pw))

        db.commit()

    print("Seed finished.")
    for username, pw in created:
        print(f"  created user '{username}' with password: {pw}   (dev only, change it)")
    if not created:
        print("  admin/viewer already existed, passwords unchanged.")


if __name__ == "__main__":
    main()
