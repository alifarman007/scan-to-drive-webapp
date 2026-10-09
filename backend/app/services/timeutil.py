"""Local time for dashboards and filters. Everything is stored in UTC; "today" means a Bangladesh day (UTC+6, no daylight saving)."""
from datetime import date, datetime, time, timedelta, timezone

LOCAL_TZ = timezone(timedelta(hours=6))
SQL_TZ = "Asia/Dhaka"  # the same zone, for SQL date grouping


def today_local(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(LOCAL_TZ).date()


def day_start_utc(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=LOCAL_TZ).astimezone(timezone.utc)


def range_bounds(d_from: date | None, d_to: date | None) -> tuple[datetime | None, datetime | None]:
    """Local dates (both ends included) -> [start, end) in UTC."""
    start = day_start_utc(d_from) if d_from else None
    end = day_start_utc(d_to + timedelta(days=1)) if d_to else None
    return start, end


def preset_range(name: str, today: date) -> tuple[date, date]:
    """today / week (Sunday to today) / month (1st to today)."""
    if name == "today":
        return today, today
    if name == "week":
        return today - timedelta(days=(today.weekday() + 1) % 7), today  # Sunday is the first day
    if name == "month":
        return today.replace(day=1), today
    raise ValueError(name)
