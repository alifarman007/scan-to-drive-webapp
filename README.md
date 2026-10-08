# Scan-to-Drive (web app)

QR-based vehicle trip authorization for company cars (about 9-10 cars). The driver
scans a QR sticker in the car, records start/end km with live dashboard photos, and the
passenger confirms the start and end of the trip on their own phone with an employee ID.
Admins and viewers get a live dashboard, alerts and reports.

Also known as RideLog / Scan2Drive. The earlier prototype (Next.js + Supabase + local JSON)
is **superseded** by this project.

**Source of truth:** `docs/Scan-to-Drive_Phase_One_Project_Plan.pdf` (v1.0, 5 Oct 2026).
Decision: **follow the PDF exactly for Phase One.** Ideas such as all-day duty sessions, a seat QR
and multi-passenger trips are deliberately postponed, but should not be blocked by the design.

## Decisions so far

- Browser-based web app (PWA), nothing to install. React Native was considered and dropped,
  because passengers must be able to confirm with just a phone camera and no install.
- Stack from the PDF: Next.js (React, TypeScript) frontend, FastAPI backend, PostgreSQL 16.
- Hosting: company Azure (the company wants Microsoft products). PDF plan is one Ubuntu VM in
  Southeast Asia running Docker Compose (Nginx, Next.js, FastAPI, PostgreSQL, worker) plus Azure Blob
  Storage for photos. Open point: ask IT whether Azure-hosted Linux + open-source software is acceptable.
- Vercel and Supabase are **not** used any more.
- Build order: database, then backend, then frontend.
- The PDF's Section 21 "Points to confirm" are still open (passenger-less trip approval, language, photo
  retention, domain name, and so on).

## Environment (developer machine)

- Windows, PowerShell. Repo: `D:\Dev\Web Projects\scan-to-drive-webapp` (path contains a space, so quote it).
- Python 3.14.8 locally (PDF says 3.12). Keep local and production versions the same; pin the
  Docker image to the version used locally. Not every library has been checked on 3.14 yet.
- PostgreSQL 16 installed natively with pgAdmin 4. Database `scan2drive` and app user
  `scan2drive_app` created. Passwords are never stored in this repo.

## Progress log

2026-10-07 (database)
- [x] Plan reviewed (PDF v1.0) and stack/hosting questions settled.
- [x] PostgreSQL 16 installed; `scan2drive` database exists (confirmed in pgAdmin).
- [x] Python 3.14.8 installed; empty git repo created on D drive.
- [x] SQLAlchemy 2 models for every table in PDF section 16 (`backend/app/models/`).
- [x] Alembic set up; first migration `0001_initial_schema` written.
- [x] Seed script (`python -m app.seed`) and 13 database-rule tests (`pytest`).
- [x] Tested in a Linux sandbox (PostgreSQL 16.15, Python 3.12.3, SQLAlchemy 2.1.3, Alembic 1.20.0):
      upgrade, `alembic check` (no drift), downgrade (leaves no leftover types), upgrade again.
- [x] **Verified on the developer machine** (Windows, Python 3.14.8): migration, seed and tests ran with no errors
      (reported by the developer).

2026-10-07 (backend skeleton and sign-in)
- [x] FastAPI app (`app/main.py`) with `/api/health`, Swagger docs at `/api/docs`, CORS for the Next.js dev server.
- [x] Sign-in per PDF sections 4, 13 and 15 (`app/routers/auth.py`): driver (employee ID + 4-digit PIN, PIN set on
      first sign-in), admin and viewer (username + password). Signed JWT tokens (PyJWT), bcrypt hashes.
- [x] Role guards in `app/deps.py`: `current_driver`, `current_admin_user` (admin or viewer), `require_admin`.
- [x] Every sign-in attempt is written to the audit log (`trip_events`, no trip). After 5 wrong tries (since the last
      good sign-in) sign-in for that account pauses for 15 minutes (HTTP 429). Limits are in `app/config.py`.
- [x] `python -m app.set_password <username>` changes an admin/viewer password (hidden prompt); `--create --role ...`
      adds a user.
- [x] 12 sign-in tests (25 tests in total pass in the sandbox) and a manual check against a running server
      (health, admin login, `/auth/me`, old password rejected).
- [ ] **To verify on the developer machine:** `pip install pyjwt httpx`, add `SECRET_KEY` to `backend/.env`, run
      `pytest -q`, start `uvicorn app.main:app --reload`, open `http://localhost:8000/api/docs`.
- [ ] Git commits for the database part and the sign-in part.

## Database (PDF section 16)

Tables: `vehicles`, `drivers`, `passengers`, `admin_users`, `trips`, `trip_photos`, `trip_tokens`,
`trip_events` (audit log), `alerts`, `settings`.

Rules enforced **in the database**:
- One open trip per car and one per driver (partial unique indexes on `trips`). Open means
  `waiting_for_passenger`, `in_progress` or `waiting_for_end_confirm`.
- `end_km > start_km`; purpose required when there is no passenger; a reason is required for
  `cancelled` / `closed_by_admin`; ended trips must have end km and end time.
- One photo per stage (start/end) per trip; QR token hashes are unique.
- `trip_events` is append-only: a trigger blocks UPDATE and DELETE.
- Trip numbers come from a sequence: `T-000001`, `T-000002`, ... (6 digits, so no overflow).

Rules that the **backend must still enforce** (not in the database): start km not below the car's
last end km; km-gap alert; server-side times only; same passenger ID at start and end; confirmation
not allowed from the driver's own session; QR one-time use and expiry; wrong-ID limit; role checks;
completed trips locked except admin corrections with a reason; never delete cars/people, only deactivate.

### Additions beyond the PDF tables (small, all implied by PDF behaviour)

- `trips.needs_review` (marked for review), `trips.start_lat/lng` and `end_lat/lng` ("text + GPS"),
  `trips.updated_at`.
- `trip_tokens.failed_attempts` (wrong-ID limit), `trip_tokens.revoked_at` ("Make new QR" kills the old one).
- `trip_events.trip_id` is nullable (so admin actions and settings changes can be logged) and
  `trip_events.detail` (JSONB) holds reasons or changes.
- `alerts.note`, `alerts.resolved_at`; `admin_users.status`; `vehicles.reg_number` is unique.
- `created_at` / `updated_at` columns on most tables.

### Assumptions to confirm

- Default settings seeded: `qr_expiry_minutes=15`, `wrong_id_limit=5`, `long_trip_hours=6` come from the PDF;
  `km_gap_limit_km=20` and `waiting_too_long_minutes=30` are **placeholders** chosen by the author.
- Drivers are seeded **without** a PIN; they set one on first sign-in (PDF 6.1). Admin and viewer
  passwords are random, printed once by the seed script (dev only).

## How to run (from `backend/`, PowerShell)

```powershell
.\.venv\Scripts\Activate.ps1
pip install fastapi "uvicorn[standard]" sqlalchemy alembic "psycopg[binary]" pydantic-settings bcrypt pyjwt httpx pytest
copy .env.example .env        # first time only, then edit DATABASE_URL and SECRET_KEY
alembic upgrade head          # create/update tables
python -m app.seed            # sample cars, drivers, passengers, admin, settings (prints admin/viewer passwords once)
pytest -q                     # database rule tests and sign-in tests
uvicorn app.main:app --reload # API at http://localhost:8000, docs at /api/docs
pip freeze > requirements.txt
```

`backend/.env` values: `DATABASE_URL`, `SECRET_KEY` (generate with
`python -c "import secrets; print(secrets.token_urlsafe(48))"`), `ENVIRONMENT` (`development` or `production`;
production refuses to start with a weak key). Optional: `DRIVER_TOKEN_DAYS` (30), `ADMIN_TOKEN_MINUTES` (480),
`LOGIN_MAX_FAILURES` (5), `LOGIN_LOCKOUT_MINUTES` (15), `CORS_ORIGINS`.

Change an admin password: `python -m app.set_password admin` (hidden prompt, 8-72 characters).
Create a user: `python -m app.set_password mary --create --role viewer`.

New migration after changing models: `alembic revision --autogenerate -m "message"`, then **review it**
(autogenerate does not handle sequences, triggers or dropping enum types), and run `alembic check`.

## API so far

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/health` | anyone | API and database check |
| POST | `/api/auth/driver/login` | driver | employee ID + PIN; `409 PIN_NOT_SET` means ask for a new PIN |
| POST | `/api/auth/driver/set-pin` | driver | first sign-in only; returns a token |
| POST | `/api/auth/admin/login` | admin / viewer | username + password |
| GET | `/api/auth/me` | signed in | who am I |

Send the token as `Authorization: Bearer <token>`. Drivers stay signed in 30 days, admins 8 hours.

### Security notes and known gaps

- **First-PIN claim:** whoever opens a driver's account first can set its PIN (the PDF's "driver sets a PIN on first
  sign-in"). Suggested hardening for later: an admin-issued one-time setup code. The admin "reset PIN" action
  should set `drivers.pin_hash` back to NULL (not built yet).
- A 4-digit PIN is weak by itself; the 5-tries pause is what protects it. Behind Nginx the client IP will be the proxy's
  until forwarded headers are configured (the IP is stored in the audit log).
- Unknown employee IDs get the same 401 as a wrong PIN, but a known driver without a PIN gets 409 (reveals that the ID exists).
- Tests may show a Starlette deprecation warning about `httpx`; it is harmless.

## Repo layout

```
README.md                  this file
docs/                      the project plan PDF
backend/
  alembic.ini, alembic/    migrations (versions/0001_initial_schema.py)
  app/config.py            settings from backend/.env
  app/db.py                engine, session, Base, naming convention
  app/models/              SQLAlchemy models (enums, vehicle, people, trip, audit)
  app/main.py              FastAPI app (health, CORS, routers)
  app/security.py          bcrypt hashing and JWT tokens
  app/deps.py              DB session and role guards
  app/routers/auth.py      driver and admin sign-in
  app/seed.py              development seed data
  app/set_password.py      command to change/create admin passwords
  tests/test_db_rules.py   checks that the DB enforces the business rules
  tests/test_auth.py       sign-in, lockout and role-guard tests
frontend/                  not started
```

## Next steps

1. Verify the sign-in part on the developer machine (unchecked items above) and commit.
2. Backend, next pieces in this order: car page (`GET /cars/{car_code}`) and start trip (`POST /trips`) with the
   business rules; photo upload behind a storage interface (local folder in dev, Azure Blob later); one-time
   Start/End QR tokens (store only the hash) and the passenger confirm endpoints; end trip, cancel and admin close;
   alerts and background jobs; admin CRUD, import, reports and Excel/PDF export. Endpoint list: PDF section 15.
3. Frontend (Next.js + Tailwind + shadcn/ui, Bangla/English): driver, passenger and admin screens
   (PDF sections 10-11). Test the phone camera over HTTPS (Microsoft Dev Tunnels or mkcert).
4. Docker Compose setup, then Azure deployment (needs the company's Azure access and a sub-domain).

## Conventions for whoever continues

- Times are stored in UTC (`timestamptz`) and shown in Bangladesh time (UTC+6); always use server time.
- Never store raw QR tokens, PINs or passwords; only hashes.
- Never commit `.env`, the virtual environment, uploads or real data.
- Keep the data layer behind interfaces (storage, database) so the hosting can change.
