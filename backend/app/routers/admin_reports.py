"""Reports page (PDF 11.3, section 15): seven ready reports as data, Excel or PDF, and the audit log export.
Admins and viewers may use reports; the audit export is admin only."""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import current_admin_user, get_db, require_admin
from app.errors import api_error
from app.models import AdminUser, TripEvent, Trip
from app.routers.admin_views import EVENT_LABELS, audit_filters
from app.services import report_export as export
from app.services import reports as rep
from app.services.reports import Column, Report, Section, default_dates, fmt_dt

router = APIRouter(prefix="/admin", tags=["admin: reports"])

MAX_ROWS = 20000  # an export bigger than this asks for a smaller date range


def _respond(report: Report, fmt: str, filename: str):
    if report.row_count > MAX_ROWS:
        raise api_error(422, "TOO_MANY_ROWS", f"This report has more than {MAX_ROWS} rows. Choose fewer days.",
                        rows=report.row_count)
    if fmt == "xlsx":
        body, media, ext = export.to_xlsx(report), export.XLSX_TYPE, "xlsx"
    else:
        body, media, ext = export.to_pdf(report), export.PDF_TYPE, "pdf"
    return Response(body, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}.{ext}"'})


@router.get("/reports")
def list_reports(_: AdminUser = Depends(current_admin_user)):
    """The ready reports. Use the `name` in /admin/reports/{name}."""
    return {"reports": [{"name": n, "title": t, "description": d} for n, (t, d, _f) in rep.REPORTS.items()]}


@router.get("/reports/{name}")
def get_report(
    name: str,
    format: Literal["json", "xlsx", "pdf"] = "json",
    range: Literal["today", "week", "month"] | None = None,
    date_from: date | None = None, date_to: date | None = None,
    car_id: int | None = None, driver_id: int | None = None,
    department: str | None = Query(None, max_length=120),
    _: AdminUser = Depends(current_admin_user), db: Session = Depends(get_db),
):
    """One report. Dates are Bangladesh dates on the trip's start time; with no dates it is the current month.
    `range` is a shortcut (week starts on Sunday) used when no date is given. `format=xlsx` or `pdf` downloads a file."""
    if name not in rep.REPORTS:
        raise api_error(404, "REPORT_NOT_FOUND", "Unknown report", available=list(rep.REPORTS))
    if date_from and date_to and date_from > date_to:
        raise api_error(422, "BAD_DATE_RANGE", "date_from must not be after date_to")
    if range and not (date_from or date_to):
        from app.services.timeutil import preset_range, today_local
        date_from, date_to = preset_range(range, today_local())
    d_from, d_to = default_dates(date_from, date_to)
    f = rep.Filters(d_from, d_to, car_id, driver_id, (department or "").strip() or None)
    report = rep.build(db, name, f)
    if format == "json":
        return report.to_json()
    return _respond(report, format, f"scan-to-drive-{name}-{d_from.isoformat()}_{d_to.isoformat()}")


@router.get("/audit/export")
def export_audit(
    format: Literal["xlsx", "pdf"] = "xlsx",
    q: str | None = Query(None, max_length=100), event: str | None = Query(None, max_length=80),
    actor: str | None = Query(None, max_length=120), trip_id: int | None = None,
    date_from: date | None = None, date_to: date | None = None,
    _: AdminUser = Depends(require_admin), db: Session = Depends(get_db),
):
    """The audit log as an Excel or PDF file, with the same filters as /admin/audit. With no dates it is the current month."""
    d_from, d_to = default_dates(date_from, date_to)
    where = audit_filters(q, event, actor, trip_id, d_from, d_to)
    rows = db.execute(
        select(TripEvent, Trip.trip_no).outerjoin(Trip, Trip.id == TripEvent.trip_id).where(*where)
        .order_by(TripEvent.created_at.desc(), TripEvent.id.desc()).limit(MAX_ROWS + 1)
    ).all()
    data = [{
        "time": fmt_dt(e.created_at), "event": EVENT_LABELS.get(e.event, e.event), "code": e.event, "actor": e.actor,
        "trip_no": tn or "", "ip": e.ip or "", "device": e.device or "",
        "lat": None if e.lat is None else float(e.lat), "lng": None if e.lng is None else float(e.lng),
        "detail": "" if not e.detail else str(e.detail),
    } for e, tn in rows]
    filters = {k: v for k, v in (("Search", q), ("Event", event), ("Actor", actor),
                                 ("Trip id", trip_id and str(trip_id))) if v}
    report = Report(name="audit", title="Audit log", date_from=d_from, date_to=d_to, filters=filters,
                    summary=[("Events", len(data))],
                    sections=[Section(None, [
                        Column("time", "Time"), Column("event", "What happened"), Column("actor", "Who"),
                        Column("trip_no", "Trip"), Column("ip", "IP", pdf=False), Column("device", "Device", pdf=False),
                        Column("lat", "Lat", pdf=False), Column("lng", "Lng", pdf=False),
                        Column("detail", "Details"), Column("code", "Event code", pdf=False),
                    ], data)])
    return _respond(report, format, f"scan-to-drive-audit-{d_from.isoformat()}_{d_to.isoformat()}")
