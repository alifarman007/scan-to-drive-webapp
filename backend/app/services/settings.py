"""Read the admin-changeable settings (table `settings`), with safe defaults."""
from sqlalchemy.orm import Session

from app.models import Setting

DEFAULTS = {
    "qr_expiry_minutes": 15,
    "wrong_id_limit": 5,
    "long_trip_hours": 6,
    "km_gap_limit_km": 20,
    "waiting_too_long_minutes": 30,
    "high_km_limit_km": 300,  # trip distance above this raises a high_km alert (placeholder)
    "allow_visitors": 1,  # 1 = passengers may choose "Other" (visitor); 0 = employee ID only
}


def get_int(db: Session, key: str) -> int:
    row = db.get(Setting, key)
    if row is not None:
        try:
            return int(row.value)
        except ValueError:
            pass
    return DEFAULTS[key]
