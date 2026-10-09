"""Checks that the database itself enforces the PDF business rules.

Needs a migrated database:  alembic upgrade head
Each test runs inside a transaction that is rolled back, so nothing is kept.
Run from the backend folder:  pytest -q
"""
import uuid

import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models import (
    Alert, AlertStatus, AlertType, Driver, Passenger, Trip, TripEvent,
    TripPhoto, TripStage, TripStatus, TripToken, Vehicle,
)


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def make_vehicle(db):
    v = Vehicle(car_code=f"T-{_uid()}", reg_number=f"REG-{_uid()}", model="Test", current_km=1000)
    db.add(v)
    db.flush()
    return v


def make_driver(db):
    d = Driver(employee_id=f"D-{_uid()}", name="Test Driver")
    db.add(d)
    db.flush()
    return d


def make_passenger(db):
    p = Passenger(employee_id=f"P-{_uid()}", name="Test Passenger")
    db.add(p)
    db.flush()
    return p


def make_trip(db, vehicle, driver, **kw):
    fields = dict(
        vehicle_id=vehicle.id, driver_id=driver.id, with_passenger=True,
        start_km=1000, start_place="Head Office", destination="Factory",
        status=TripStatus.waiting_for_passenger,
    )
    fields.update(kw)
    t = Trip(**fields)
    db.add(t)
    db.flush()
    return t


def test_trip_number_is_generated(db):
    t = make_trip(db, make_vehicle(db), make_driver(db))
    db.refresh(t)
    assert t.trip_no.startswith("T-") and len(t.trip_no) == 8


def test_one_open_trip_per_vehicle(db):
    v = make_vehicle(db)
    make_trip(db, v, make_driver(db))
    with pytest.raises(IntegrityError):
        make_trip(db, v, make_driver(db))


def test_one_open_trip_per_driver(db):
    d = make_driver(db)
    make_trip(db, make_vehicle(db), d)
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), d)


def test_car_is_free_again_after_trip_completes(db):
    v, d = make_vehicle(db), make_driver(db)
    t = make_trip(db, v, d)
    t.status, t.end_km, t.end_time = TripStatus.completed, 1038, t.start_time
    db.flush()
    make_trip(db, v, d)  # no error: the first trip is no longer open


def test_end_km_must_be_greater_than_start_km(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), end_km=1000)


def test_purpose_required_without_passenger(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), with_passenger=False,
                  status=TripStatus.in_progress)


def test_purpose_given_without_passenger_is_ok(db):
    make_trip(db, make_vehicle(db), make_driver(db), with_passenger=False,
              purpose="Fuel the car", status=TripStatus.in_progress)


def test_cancelled_trip_needs_reason(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), status=TripStatus.cancelled)


def test_completed_trip_needs_end_data(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), status=TripStatus.completed)


def test_one_photo_per_stage_per_trip(db):
    t = make_trip(db, make_vehicle(db), make_driver(db))
    db.add(TripPhoto(trip_id=t.id, kind=TripStage.start, file_url="a.jpg"))
    db.flush()
    db.add(TripPhoto(trip_id=t.id, kind=TripStage.start, file_url="b.jpg"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_token_hash_is_unique(db):
    t = make_trip(db, make_vehicle(db), make_driver(db))
    h = _uid() * 8
    db.add(TripToken(trip_id=t.id, kind=TripStage.start, token_hash=h, expires_at=t.start_time))
    db.flush()
    db.add(TripToken(trip_id=t.id, kind=TripStage.end, token_hash=h, expires_at=t.start_time))
    with pytest.raises(IntegrityError):
        db.flush()


def test_solved_alert_needs_resolver(db):
    db.add(Alert(type=AlertType.km_gap, message="gap", status=AlertStatus.solved))
    with pytest.raises(IntegrityError):
        db.flush()


def test_audit_log_cannot_be_changed_or_deleted(db):
    ev = TripEvent(event="trip_started", actor="driver:test")
    db.add(ev)
    db.flush()
    with pytest.raises(DBAPIError):
        db.execute(TripEvent.__table__.update().values(event="tampered"))
    db.rollback()
    ev = TripEvent(event="trip_started", actor="driver:test")
    db.add(ev)
    db.flush()
    with pytest.raises(DBAPIError):
        db.execute(TripEvent.__table__.delete())


def test_visitor_needs_name_and_phone(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), is_visitor=True)


def test_visitor_with_name_but_no_phone_is_rejected(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), is_visitor=True, visitor_name="John")


def test_visitor_trip_cannot_also_have_an_employee(db):
    p = make_passenger(db)
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), is_visitor=True,
                  visitor_name="John", visitor_phone="0171234567", passenger_id=p.id)


def test_visitor_fields_only_for_visitors(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), visitor_name="John")


def test_valid_visitor_trip_is_saved(db):
    make_trip(db, make_vehicle(db), make_driver(db), is_visitor=True,
              visitor_name="John", visitor_phone="0171234567")


def test_approval_status_needs_a_skipped_step(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), approval_status="pending")


def test_skipped_step_needs_an_approval_status(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), start_no_scan_reason="No phone")


def test_approval_status_must_be_a_known_value(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), start_no_scan_reason="No phone", approval_status="maybe")


def test_decided_approval_needs_the_admin(db):
    with pytest.raises(IntegrityError):
        make_trip(db, make_vehicle(db), make_driver(db), start_no_scan_reason="No phone", approval_status="approved")
