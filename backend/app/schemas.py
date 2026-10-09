"""Shapes of the data the API sends back."""
from app.models import Trip


def trip_out(trip: Trip) -> dict:
    return {
        "id": trip.id,
        "trip_no": trip.trip_no,
        "status": trip.status.value,
        "with_passenger": trip.with_passenger,
        "car_code": trip.vehicle.car_code,
        "car_model": trip.vehicle.model,
        "reg_number": trip.vehicle.reg_number,
        "driver_name": trip.driver.name,
        "passenger_name": trip.passenger.name if trip.passenger else trip.visitor_name,
        "is_visitor": trip.is_visitor,
        "start_km": trip.start_km,
        "end_km": trip.end_km,
        "distance_km": trip.distance_km,
        "end_place": trip.end_place,
        "end_confirm_time": trip.end_confirm_time,
        "needs_review": trip.needs_review,
        "start_place": trip.start_place,
        "destination": trip.destination,
        "purpose": trip.purpose,
        "start_time": trip.start_time,
        "journey_start_time": trip.journey_start_time,
        "end_time": trip.end_time,
        "close_reason": trip.close_reason,
        "approval_status": trip.approval_status,
        "start_no_scan_reason": trip.start_no_scan_reason,
        "end_no_scan_reason": trip.end_no_scan_reason,
        "approval_note": trip.approval_note,
        "approved_at": trip.approved_at,
    }
