"""Seed development data. Safe to run more than once (existing rows are kept).

Run from the backend folder:   python -m app.seed
The data is SAMPLE data (names and numbers come from the PDF sketches).
Do not run this against the live database.
"""
import os
import secrets

import bcrypt
from sqlalchemy.dialects.postgresql import insert

from app.db import SessionLocal
from app.models import AdminUser, Driver, Passenger, Setting, Vehicle

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

CAR_MODELS = ["Toyota Axio", "Toyota Allion", "Toyota Noah", "Toyota Premio", "Honda Grace"]
START_KM = [41880, 22415, 45230, 30902, 18377, 9640, 12000, 27500, 33100, 15800]

DRIVERS = [
    ("EMP-1021", "Rahim Uddin"),
    ("EMP-1034", "Karim Hossain"),
    ("EMP-1048", "Sohel Rana"),
    ("EMP-1052", "Jamal Sheikh"),
]

PASSENGERS = [
    ("EMP-2210", "Nadia Islam", "HR"),
    ("EMP-2211", "Faruk Ahmed", "Merchandising"),
    ("EMP-2212", "Tania Akter", "Accounts"),
    ("EMP-2213", "Imran Khan", "Production"),
    ("EMP-2214", "Shirin Sultana", "Compliance"),
    ("EMP-2215", "Mahbub Alam", "Commercial"),
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

        cars = []
        for i in range(10):
            cars.append(
                {
                    "car_code": f"CAR-{i + 1:02d}",
                    "reg_number": f"DM-GA 12-{3450 + i}",
                    "model": CAR_MODELS[i % len(CAR_MODELS)],
                    "current_km": START_KM[i],
                    "status": "maintenance" if i == 6 else "active",  # CAR-07 in workshop
                }
            )
        db.execute(insert(Vehicle).values(cars).on_conflict_do_nothing(index_elements=["car_code"]))

        # Drivers have no PIN yet: they set one on first sign-in (PDF 6.1).
        db.execute(
            insert(Driver).values(
                [
                    {"employee_id": e, "name": n, "phone": f"01700-0000{i}", "license_no": f"LIC-{i + 1:04d}"}
                    for i, (e, n) in enumerate(DRIVERS)
                ]
            ).on_conflict_do_nothing(index_elements=["employee_id"])
        )

        db.execute(
            insert(Passenger).values(
                [{"employee_id": e, "name": n, "department": d} for e, n, d in PASSENGERS]
            ).on_conflict_do_nothing(index_elements=["employee_id"])
        )

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
