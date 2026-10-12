"""Go live with the real fleet: remove ALL test data and load the real cars and drivers (app/fleet_data.py).

    python -m app.load_fleet            # shows what would be removed and added, changes nothing
    python -m app.load_fleet --apply    # does it (cannot be undone: take a database backup first if unsure)

Once loaded it refuses to run again (that would delete real trips) unless --again is added as well.

Removed: every trip (with its photos, QR codes, reviews and alerts), the audit log, all cars, drivers, employees
(passengers) and vendors. Trip numbers start again at T-000001.
Kept: admin and viewer accounts, settings and trip purposes.
Added: the vendor Lanka Bangla Enterprise, 24 cars (CAR-01 ... CAR-14 Epic, CAR-15 ... CAR-24 Lanka Bangla) and
24 drivers (1239001 ...), all without a PIN (each driver chooses one at the first sign-in, as before).

Phones signed in as a test driver are signed out (their account is gone). Employees are not added: there is no
real list yet, and a passenger is saved the first time they type their ID on the passenger page.
"""
import sys

from sqlalchemy import func, select, text

from app.db import SessionLocal
from app.fleet_data import VENDOR_NAME, fleet
from app.models import (Alert, Driver, Passenger, Trip, TripEvent, TripPhoto, TripReview, TripToken, Vehicle,
                        VehicleOwner, Vendor)
from app.storage import get_storage

# Every table with test data. Listed one by one (no CASCADE), so nothing else can be emptied by accident.
TABLES = ["trip_events", "alerts", "trip_reviews", "trip_photos", "trip_tokens", "trips",
          "passengers", "drivers", "vehicles", "vendors"]


def main() -> None:
    do_it = "--apply" in sys.argv
    cars, drivers = fleet()
    with SessionLocal() as db:
        count = lambda model: db.scalar(select(func.count()).select_from(model))
        now = {
            "trips": count(Trip), "dashboard photos": count(TripPhoto), "QR codes": count(TripToken),
            "reviews": count(TripReview), "alerts": count(Alert), "audit log lines": count(TripEvent),
            "cars": count(Vehicle), "drivers": count(Driver), "employees (passengers)": count(Passenger),
            "vendors": count(Vendor),
        }
        print("Remove (test data):")
        for k, v in now.items():
            print(f"  {v:>6}  {k}")
        print("Keep: admin / viewer accounts, settings, trip purposes.")
        print(f"\nAdd: vendor {VENDOR_NAME!r}, {len(cars)} cars and {len(drivers)} drivers:")
        for c, d in zip(cars, drivers):
            owner = VENDOR_NAME if c["vendor"] else "Epic"
            print(f"  {c['car_code']}  {c['reg_number']:<16} {c['model']:<15} {owner:<24} driver {d['employee_id']} {d['name']}")

        loaded = db.scalar(select(TripEvent.created_at).where(TripEvent.event == "real_fleet_loaded").order_by(TripEvent.id).limit(1))
        if loaded is not None:
            print(f"\nCareful: the real fleet was already loaded on {loaded:%d %b %Y}. Everything since then (real trips!) would be removed.")
            if do_it and "--again" not in sys.argv:
                print("Nothing changed. If you really want this, run: python -m app.load_fleet --apply --again")
                return
        if not do_it:
            print("\nNothing changed. Run again with --apply to do it.")
            return

        storage = get_storage()
        files = db.scalars(select(TripPhoto.file_url)).all()
        db.execute(text(f"TRUNCATE {', '.join(TABLES)}"))  # TRUNCATE skips the audit log's no-delete trigger
        db.execute(text("ALTER SEQUENCE trip_no_seq RESTART WITH 1"))

        vendor = Vendor(name=VENDOR_NAME)
        db.add(vendor)
        db.flush()
        for c in cars:
            db.add(Vehicle(car_code=c["car_code"], reg_number=c["reg_number"], model=c["model"], current_km=0,
                           owner=VehicleOwner.vendor if c["vendor"] else VehicleOwner.epic,
                           vendor_id=vendor.id if c["vendor"] else None))
        for d in drivers:
            db.add(Driver(employee_id=d["employee_id"], name=d["name"], phone=d["phone"]))
        db.add(TripEvent(event="real_fleet_loaded", actor="system",
                         detail={"vendor": VENDOR_NAME, "cars": len(cars), "drivers": len(drivers), "removed": now}))
        db.commit()

    gone = 0
    for key in files:  # after the commit: a failed run never leaves trips without their photos
        try:
            storage.delete(key)
            gone += 1
        except (OSError, ValueError):
            pass
    print(f"\nDone. {len(cars)} cars and {len(drivers)} drivers loaded, {gone} test photo files deleted.")
    print("Next: print the car stickers on the Cars page and put them in the cars.")


if __name__ == "__main__":
    main()
