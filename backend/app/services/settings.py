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
    "allow_cant_scan": 1,  # 1 = driver may tap "Passenger can't scan" (admin approves later); 0 = off
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


# What the Settings page may change: allowed range and a plain-language label for each key.
# (min, max, label). Yes/no settings use 0 and 1.
SPECS = {
    "qr_expiry_minutes": (1, 1440, "Minutes before a Start/End QR expires"),
    "wrong_id_limit": (1, 20, "Wrong passenger-ID tries before the QR is blocked"),
    "long_trip_hours": (1, 72, "Hours in progress before a long-trip alert"),
    "km_gap_limit_km": (0, 100000, "Km gap over the last end km that raises an alert"),
    "waiting_too_long_minutes": (1, 1440, "Minutes waiting for a passenger before an alert"),
    "high_km_limit_km": (1, 10000, "Trip distance in km above which a high-km alert is raised"),
    "allow_cant_scan": (0, 1, "1 = driver may tap 'Passenger can't scan' (admin approves later); 0 = off"),
    "allow_visitors": (0, 1, "1 = passenger page offers 'Other' (visitor); 0 = employee ID only"),
}
