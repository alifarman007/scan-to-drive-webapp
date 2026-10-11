"""Rename employee IDs to the new style, keeping every trip and record.

    python -m app.rename_ids            # shows what would change, changes nothing
    python -m app.rename_ids --apply    # does it

Drivers get DR9001, DR9002 ... in the order of their current IDs (a driver who already has a DRnnnn ID keeps it).
Passengers lose the dash: EMP-2210 becomes EMP2210 (capitals). Trips point to people by number, not by ID,
so they need no change. The audit log is append-only and keeps the old IDs in its old lines; the script adds one
line ("employee_ids_renamed") with the old -> new list, which the trip timeline uses to still show the names.
Safe to run again: IDs that already have the new style are left alone. Sign-in afterwards with the new driver ID
and the same PIN (letter case does not matter).
"""
import re
import sys

from sqlalchemy import func, select, update

from app.db import SessionLocal
from app.models import Driver, Passenger, TripEvent

NEW_DRIVER = re.compile(r"^DR\d{4}$", re.I)
OLD_PASSENGER = re.compile(r"^([A-Za-z]{3})-(\d{4})$")


def plan(db) -> tuple[dict[str, str], dict[str, str]]:
    drivers = db.scalars(select(Driver).order_by(Driver.employee_id)).all()
    taken = [int(d.employee_id[2:]) for d in drivers if NEW_DRIVER.match(d.employee_id)]
    next_no = max(taken, default=9000) + 1
    driver_map = {}
    for d in drivers:
        if NEW_DRIVER.match(d.employee_id):
            if d.employee_id != d.employee_id.upper():
                driver_map[d.employee_id] = d.employee_id.upper()
            continue
        driver_map[d.employee_id] = f"DR{next_no}"
        next_no += 1
    passenger_map = {}
    for p in db.scalars(select(Passenger).order_by(Passenger.employee_id)):
        m = OLD_PASSENGER.match(p.employee_id)
        if m:
            passenger_map[p.employee_id] = f"{m.group(1)}{m.group(2)}".upper()
    return driver_map, passenger_map


def apply(db, driver_map: dict[str, str], passenger_map: dict[str, str]) -> int:
    clash = [new for new in passenger_map.values()
             if db.scalar(select(Passenger.id).where(func.upper(Passenger.employee_id) == new))]
    if clash:
        raise SystemExit(f"Stopped: these passenger IDs already exist: {', '.join(clash)}")
    for old, new in driver_map.items():
        db.execute(update(Driver).where(Driver.employee_id == old).values(employee_id=new))
    for old, new in passenger_map.items():
        db.execute(update(Passenger).where(Passenger.employee_id == old).values(employee_id=new))
    # the audit log cannot be changed (append-only): record the renaming in it instead
    db.add(TripEvent(event="employee_ids_renamed", actor="system", detail={"drivers": driver_map, "passengers": passenger_map}))
    db.commit()
    return len(driver_map) + len(passenger_map)


def main() -> None:
    do_it = "--apply" in sys.argv
    with SessionLocal() as db:
        driver_map, passenger_map = plan(db)
        if not driver_map and not passenger_map:
            print("Nothing to change: all IDs already have the new style.")
            return
        print("Drivers:")
        for old, new in driver_map.items():
            print(f"  {old:>12}  ->  {new}")
        print("Passengers:")
        for old, new in passenger_map.items():
            print(f"  {old:>12}  ->  {new}")
        if not do_it:
            print("\nNothing changed yet. Run again with --apply to rename.")
            return
        n = apply(db, driver_map, passenger_map)
        print(f"\nDone. {len(driver_map)} drivers and {len(passenger_map)} passengers renamed ({n} in all).")
        print("Drivers now sign in with the new ID and the same PIN.")


if __name__ == "__main__":
    main()
