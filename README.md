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
- [x] **Verified on the developer machine:** all 25 tests pass, admin login returns 200, Swagger UI works
      (reported by the developer).
- [ ] Git commits for the database part and the sign-in part (commands were given in chat).

2026-10-08 (car page and start trip)
- [x] `GET /api/cars/{car_code}?v=<sticker version>`: car page for the signed-in driver. Returns the car, the
      last end km (hint for the start form), `can_start`, and the reason if blocked (maintenance, inactive, in use by
      someone else, driver already has an open trip). Old sticker (wrong version) gives 410, unknown car 404.
- [x] `POST /api/trips` (multipart form + photo): starts a trip. Enforces PDF rules 1-6: car active and free, driver has
      no other open trip, start km not below the car's last end km, purpose required without passenger, live photo
      required (must really be JPEG/PNG/WebP, max 5 MB). Big km gap (over `km_gap_limit_km`) is allowed but raises a
      `km_gap` alert. With passenger: status `waiting_for_passenger` and a one-time Start QR link (only the hash is
      stored, expiry from the `qr_expiry_minutes` setting). Without passenger: straight to `in_progress`, no QR.
      The car row is locked during the start, and the database unique indexes are the final safety net (409).
- [x] `GET /api/trips/active` (the driver's open trip), `POST /api/trips/{id}/start-qr` ("Make new QR", the old QR is
      revoked), `POST /api/trips/{id}/cancel` (reason required; driver for own trip, or admin; only before the passenger
      confirms).
- [x] Photo storage behind an interface (`app/storage.py`, local `uploads/` folder in dev, Azure Blob later).
- [x] Every step is written to the audit log with device, IP and GPS.
- [x] 24 new tests (49 in total pass in the sandbox) and a live check with a real file upload.
- [ ] To verify on the developer machine: `pip install python-multipart`, `pytest -q` (expect 49 passed), then try the
      new endpoints in Swagger (`/api/docs`): sign in as a driver, **Authorize**, GET a car, POST a trip with a photo.

### Decisions made while building the start-trip step

- **The start photo travels in the same request as the start form** (`POST /trips` is multipart). The PDF says the step
  is "not saved until the photo is uploaded", and a single request guarantees a trip never exists without its photo.
  The PDF's separate `POST /trips/{id}/photos` endpoint is therefore not needed for the start photo.
- **The car sticker QR link carries the sticker version:** `{app}/c/CAR-03?v=1`. The PDF says a replaced sticker must
  stop working ("QR version number") but not how; the API rejects a link whose `v` differs from `vehicles.qr_version`.
- **The raw Start QR code cannot be read back** (only its hash is stored). The app keeps the link it got from
  `POST /trips`; after a restart or on another phone it calls `POST /trips/{id}/start-qr` to make a new one.
- Error replies have the form `{"detail": {"code": "CAR_IN_USE", "message": "CAR-03 is in use by Karim H."}}` so the
  app can react to the code and show the message.
- `needs_review` is not set for no-passenger trips; reports will filter them by `with_passenger = false`.

### Gaps in the PDF to confirm

- A driver cannot cancel a **no-passenger** trip started by mistake (rule 11 only allows cancel before the passenger
  confirms, and these trips have no confirmation). Today only an admin can close it.
- "Purposes list" (PDF 11.2 Settings) is not built; purpose is free text for now.
- Server-side code cannot prove a photo came from the live camera; the app must use the camera capture and the admin
  compares photo and typed km.

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
pip install fastapi "uvicorn[standard]" sqlalchemy alembic "psycopg[binary]" pydantic-settings bcrypt pyjwt httpx python-multipart pytest
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
`LOGIN_MAX_FAILURES` (5), `LOGIN_LOCKOUT_MINUTES` (15), `CORS_ORIGINS`, `PUBLIC_BASE_URL` (QR links, default
`http://localhost:3000`), `STORAGE_DIR` (photos, default `uploads`), `MAX_PHOTO_MB` (5).

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
| GET | `/api/cars/{car_code}?v=` | driver | car page: details, last end km, can start or why not |
| POST | `/api/trips` | driver | start a trip (multipart form + dashboard photo) |
| GET | `/api/trips/active` | driver | the driver's open trip or null |
| POST | `/api/trips/{id}/start-qr` | driver | new Start QR (old one stops working) |
| POST | `/api/trips/{id}/cancel` | driver / admin | cancel before the passenger confirms (reason required) |

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
  app/routers/cars.py      car page
  app/routers/trips.py     start trip, active trip, new Start QR, cancel
  app/services/            audit log, settings lookup, QR tokens, trip business rules
  app/storage.py           photo storage (local folder now, Azure Blob later)
  app/errors.py            error format helper; app/schemas.py response shapes
  app/seed.py              development seed data
  app/set_password.py      command to change/create admin passwords
  tests/test_db_rules.py   checks that the DB enforces the business rules
  tests/test_auth.py       sign-in, lockout and role-guard tests
  tests/test_trips.py      car page and start-trip tests
frontend/                  not started
```

## Next steps

1. Verify the start-trip part on the developer machine (unchecked item above) and commit.
2. Backend, next pieces in this order: passenger pages `GET /p/{token}`, `POST /p/{token}/confirm-start`
   (employee ID, wrong-ID limit, not from the driver's own session, sets `in_progress` and `journey_start_time`);
   end trip `POST /trips/{id}/end` (end km > start km, end photo, End QR); `confirm-end` (same ID, completes the trip,
   updates the car's current km, calculates distance); admin close; alerts and background jobs; admin CRUD, import,
   reports and Excel/PDF export; serving photos through short-lived links. Endpoint list: PDF section 15.
3. Frontend (Next.js + Tailwind + shadcn/ui, Bangla/English): driver, passenger and admin screens
   (PDF sections 10-11). Test the phone camera over HTTPS (Microsoft Dev Tunnels or mkcert).
4. Docker Compose setup, then Azure deployment (needs the company's Azure access and a sub-domain).

## Conventions for whoever continues

- Times are stored in UTC (`timestamptz`) and shown in Bangladesh time (UTC+6); always use server time.
- Never store raw QR tokens, PINs or passwords; only hashes.
- Never commit `.env`, the virtual environment, uploads or real data.
- Keep the data layer behind interfaces (storage, database) so the hosting can change.
