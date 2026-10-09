"""Settings page (PDF 11.2): see the current values, change them (admin only). Every change is logged
with the old and new value."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import current_admin_user, get_db, require_admin
from app.errors import api_error
from app.models import AdminUser, Setting
from app.services.audit import log_event
from app.services.settings import DEFAULTS, SPECS, get_int

router = APIRouter(prefix="/admin/settings", tags=["admin: settings"])


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # {"qr_expiry_minutes": 10, "wrong_id_limit": 3}
    values: dict[str, int]


def _rows(db: Session) -> list[dict]:
    saved = {s.key: s for s in db.scalars(select(Setting))}
    out = []
    for key, default in DEFAULTS.items():
        lo, hi, label = SPECS[key]
        row = saved.get(key)
        out.append({
            "key": key, "value": get_int(db, key), "default": default, "min": lo, "max": hi, "label": label,
            "updated_at": row.updated_at if row else None,
            "updated_by": row.updated_by if row else None,
        })
    return out


@router.get("")
def list_settings(_: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db)):
    """All settings with current value, default and allowed range. Viewers may look."""
    return {"settings": _rows(db)}


@router.patch("")
def change_settings(
    body: SettingsUpdate, request: Request,
    admin: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """Change one or more settings at once. Nothing is saved if any value is invalid."""
    if not body.values:
        raise api_error(422, "NOTHING_TO_CHANGE", "Send at least one setting to change")
    for key, value in body.values.items():
        if key not in SPECS:
            raise api_error(422, "UNKNOWN_SETTING", f"Unknown setting: {key}", key=key)
        lo, hi, _label = SPECS[key]
        if not lo <= value <= hi:
            raise api_error(422, "SETTING_OUT_OF_RANGE", f"{key} must be between {lo} and {hi}",
                            key=key, min=lo, max=hi)

    changed = {}
    for key, value in body.values.items():
        old = get_int(db, key)
        if old == value:
            continue
        row = db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=str(value), updated_by=admin.id))
        else:
            row.value = str(value)
            row.updated_by = admin.id
        changed[key] = {"from": old, "to": value}
    if changed:
        log_event(db, request, "settings_changed", f"admin:{admin.username}", detail=changed)
    db.commit()
    return {"changed": changed, "settings": _rows(db)}
