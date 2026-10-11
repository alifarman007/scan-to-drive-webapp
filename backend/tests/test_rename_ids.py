"""app/rename_ids.py: drivers become DRnnnn, passengers lose the dash, trips and the audit log stay intact."""
import uuid

from sqlalchemy import select

from app import rename_ids
from app.models import Driver, Passenger, TripEvent
from app.routers.admin_views import _who


def test_rename_keeps_people_and_names_old_audit_lines(db):
    tag = uuid.uuid4().hex[:4].upper()
    # isolate from whatever is already in the database: only rename our own rows
    d = Driver(employee_id=f"ZZ-{tag}1", name="Old Style Driver")
    p = Passenger(employee_id="QQQ-4321", name="Old Style Passenger")
    db.add_all([d, p])
    db.flush()
    old_line = TripEvent(event="trip_started", actor=f"driver:{d.employee_id}")
    db.add(old_line)
    db.flush()
    driver_map, passenger_map = rename_ids.plan(db)
    driver_map = {k: v for k, v in driver_map.items() if k == d.employee_id}
    passenger_map = {k: v for k, v in passenger_map.items() if k == p.employee_id}
    assert passenger_map == {"QQQ-4321": "QQQ4321"} and driver_map[d.employee_id].startswith("DR")
    rename_ids.apply(db, driver_map, passenger_map)
    db.refresh(d)
    db.refresh(p)
    assert d.employee_id == driver_map[f"ZZ-{tag}1"] and p.employee_id == "QQQ4321"
    # the old audit line is untouched, but the timeline still finds the driver's name
    assert db.get(TripEvent, old_line.id).actor == f"driver:ZZ-{tag}1"
    who = _who(db, [old_line])[old_line.actor]
    assert who["name"] == "Old Style Driver" and who["ref"] == d.employee_id
    assert db.scalar(select(TripEvent).where(TripEvent.event == "employee_ids_renamed").order_by(TripEvent.id.desc()))
