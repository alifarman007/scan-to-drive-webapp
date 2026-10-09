"""Background worker: runs the alert checks every minute (PDF section 17: APScheduler worker).

Run it as a separate process next to the API, from backend/:   python -m app.worker
Run exactly ONE worker. (It is safe if two run by accident, but they would only repeat work.)
"""
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.blocking import BlockingScheduler

from app.db import SessionLocal
from app.services.jobs import run_checks

log = logging.getLogger("worker")


def tick() -> None:
    with SessionLocal() as db:
        try:
            raised = run_checks(db)
            if any(raised.values()):
                log.info("alerts raised: %s", raised)
        except Exception:  # never stop the scheduler because of one bad run
            db.rollback()
            log.exception("alert checks failed")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    scheduler = BlockingScheduler(timezone="UTC")
    # first run right away, then every minute
    scheduler.add_job(tick, "interval", minutes=1, next_run_time=datetime.now(timezone.utc),
                      max_instances=1, coalesce=True, id="alert-checks")
    log.info("worker started: alert checks every minute")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("worker stopped")


if __name__ == "__main__":
    main()
