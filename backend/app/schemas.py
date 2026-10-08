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
        "start_place": trip.start_place,
        "destination": trip.destination,
        "purpose": trip.purpose,
        "start_time": trip.start_time,
        "journey_start_time": trip.journey_start_time,
        "end_time": trip.end_time,
        "close_reason": trip.close_reason,
    }
