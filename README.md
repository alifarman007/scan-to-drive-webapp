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
- [x] **Verified on the developer machine:** the developer reported everything working, including the Swagger checks
      (start a trip with a photo, second trip blocked by the one-open-trip rule).

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

### 2026-10-08 (passenger side: open the Start QR, confirm, wrong-ID limit, visitors)

- [x] `GET /api/p/{token}`: what the passenger sees after scanning the Start QR (car, driver, start km, places, time,
      tries left, whether visitors are allowed). `GET /api/p/{token}/photo` serves the start dashboard photo while the QR is valid.
- [x] `POST /api/p/{token}/lookup`: shows the employee's **name only** for a typed ID (PDF sketch P1), so a typo is caught.
- [x] `POST /api/p/{token}/confirm-start`: body is either `{"passenger_type":"employee","employee_id":...}` or
      `{"passenger_type":"visitor","name":...,"phone":...,"reason":...}`. Sets status `in_progress` and the journey start time
      (server time), marks the QR used, writes the audit log. The QR works once.
- [x] Wrong-ID limit (setting `wrong_id_limit`, default 5): at the limit the QR is blocked, the admin gets a `wrong_ids` alert.
- [x] Migration `0002_visitor_passengers`: columns `trips.is_visitor`, `visitor_name`, `visitor_phone`, `visitor_reason`, plus two
      CHECK constraints (a visitor needs name and phone and no employee link; visitor fields only on visitor trips).
      New setting `allow_visitors` (1 or 0).
- [x] 35 new tests (84 in total pass in the sandbox) and a live run against a real server.
- [ ] **To verify on the developer machine:** unzip over the repo, `alembic upgrade head` (applies 0002), `python -m app.seed`
      (adds the `allow_visitors` setting row; optional because the code defaults to 1), `pytest -q` (expect 84 passed), then in Swagger:
      start a trip as a driver, copy the token part of `start_qr.url` (after `/p/`), call `GET /api/p/{token}`, `POST .../lookup`
      with `EMP-2210`, then `POST .../confirm-start`. Try 5 wrong IDs on another trip to see the block.

#### Decisions made in this step (from the developer's answers)

- **Passenger page has two choices:** "Employee of EPIC" (employee ID only) or "Others" (name, phone number, reason of travel
  optional). **The passenger chooses**, not the driver, because the driver may not know who is who. The front end must build
  this choice; the API takes the `passenger_type` field.
- **Visitor trips are marked `needs_review`** and shown in the exceptions report later. Visitor details are stored on the trip
  (not added to the employee list). An admin setting `allow_visitors = 0` turns the "Others" option off without code changes.
- **Wrong-ID limit is counted per trip and per stage** (start / end), over all of the trip's QR codes: making a new QR does **not**
  give new tries. At the limit: tokens revoked, `wrong_ids` alert, `POST /trips/{id}/start-qr` returns `423 TRIP_LOCKED`,
  `GET /trips/active` returns `start_qr_blocked: true`. The driver can still cancel the trip (reason required) and start again.
  Start and end are counted separately, so typos at the start do not strand a running trip at the end.
- **Name shown before confirming** (developer chose yes, name only). Wrong IDs in a lookup count toward the limit, and a trip allows at most
  15 lookups (`429 TOO_MANY_LOOKUPS`) so a QR holder cannot list employee names by trying IDs.
- **Not from the driver's own phone (PDF rule 9):** if the request carries a valid session token of the **trip's own driver**, it is
  rejected (`403 DRIVER_CANNOT_CONFIRM`). This is best-effort: the passenger page has no login, so a driver using a second device
  cannot be detected. The PDF accepts this limit. A driver also cannot be the passenger of the same trip (same employee ID,
  `403 PASSENGER_IS_DRIVER`, not counted as a wrong try).
- Employee IDs are matched trimmed and case-insensitively. An inactive employee gets the same "ID not found" as an unknown one.
- The "short-lived link" for the start photo is the QR token itself (valid only while the QR is valid and unused).
- Error codes the front end can react to: `QR_INVALID` 404, `QR_USED` 410, `QR_REPLACED` 410, `QR_EXPIRED` 410, `TRIP_CANCELLED` 410,
  `TRIP_NOT_WAITING` 410, `QR_BLOCKED` 423, `ID_NOT_FOUND` 404 (with `tries_left`), `TOO_MANY_LOOKUPS` 429,
  `DRIVER_CANNOT_CONFIRM` 403, `PASSENGER_IS_DRIVER` 403, `VISITORS_NOT_ALLOWED` 403.

#### Weak points and open questions from this step

- **Anyone holding the Start QR can choose "Others" and type any name and phone.** Nothing verifies a visitor. Mitigations in place: the
  trip is marked for review, everything is in the audit log, and `allow_visitors` can be switched off. Ask the company whether this is acceptable.
- The proposal that a visitor confirms the end with the **same phone number** given at the start is now built (see the next section).
- A blocked trip can only be cancelled for now. An admin "unlock" or "reset tries" action is not built.
- Name look-ups show an employee's name to anyone who holds a valid QR (limited to 15 per trip). Behind Nginx the client IP will be the
  proxy's until forwarded headers are configured.
- The employee list import and admin screens are not built yet; passengers exist only from the seed script until then.

### 2026-10-08 (end of trip: driver end form, End QR, passenger end confirmation)

- [x] `POST /api/trips/{id}/end` (driver, multipart): `end_km`, `end_place`, `photo` (end dashboard), optional `end_lat`/`end_lng`.
      Trip must be `in_progress`; `end_km` must be greater than `start_km` (`422 END_KM_TOO_LOW`). Saves the photo as `trips/{id}/end.{ext}`.
      Sets `end_time` (server time) and `distance_km`.
      - **With a passenger:** status becomes `waiting_for_end_confirm` and the response carries a one-time **End QR**.
      - **Without a passenger:** the trip completes at once (no tokens), and the car's `current_km` is updated.
      - If `distance_km` is above the setting `high_km_limit_km`, a `high_km` alert is raised.
- [x] `POST /api/trips/{id}/end-qr` (driver): new End QR (the old one stops). `409 TRIP_NOT_WAITING_END`, `423 TRIP_LOCKED` after too many wrong IDs.
- [x] `GET /api/p/{token}` now handles **both** QR kinds. For an End QR it returns the summary: start/end km, distance, journey minutes,
      both photos, and `confirm_as` (`employee` or `visitor`), so the page knows which box to show. `GET /api/p/{token}/photo/{kind}` serves
      `start` or `end`. `GET /api/p/{token}/photo` still means the start photo.
- [x] `POST /api/p/{token}/confirm-end`: body `{"passenger_type":"employee","employee_id":"EMP-2210"}` or
      `{"passenger_type":"visitor","phone":"01712345678"}`. Must match the person who confirmed the start. Success: status `completed`,
      `end_confirm_time` set, End QR used, car `current_km = end_km`, audit event `trip_completed`.
- [x] A Start QR cannot be used on the End endpoint and the other way round (`409 WRONG_QR`).
- [x] 29 new tests, **113 in total pass** in the sandbox.
- [ ] **To verify on the developer machine:** unzip over the repo (keep `.env`), `python -m app.seed` (adds `high_km_limit_km`), `pytest -q`
      (expect 113 passed). In Swagger: sign in as the driver, `POST /api/trips/{id}/end` for the running trip (with photo), copy the token from
      `end_qr.url`, **log out of the driver token first**, then `GET /api/p/{token}` and `POST /api/p/{token}/confirm-end`.

#### Decisions made in this step

- **Visitor phone rule:** phones are compared after normalizing (digits only, a leading `00` dropped, `880...` turned into `0...`), so
  `+880 1712-345678` equals `01712345678`. Implemented in `app/services/phones.py`.
- **Wrong tries at the end** use the same limit (`wrong_id_limit`) but are counted separately from the start. A wrong employee ID or phone gives
  `403 ID_MISMATCH` with `tries_left`. Using the wrong type of confirmation (an employee box for a visitor trip) is `422 WRONG_PASSENGER_TYPE`
  and is not counted. At the limit the End QR is revoked, a `wrong_ids` alert is raised and the driver gets `423 TRIP_LOCKED`.
- **No name lookup at the end:** the passenger must already know their ID, so the End QR cannot be used to list names.
- The driver's own session is blocked from confirming the end too (`DRIVER_CANNOT_CONFIRM`, best effort as at the start).
- The car's `current_km` changes **only when the trip completes** (PDF section 7). Locking the vehicle row when confirming avoids two
  trips racing on it.
- Error codes added: `END_KM_TOO_LOW` 422, `TRIP_NOT_WAITING_END` 409, `WRONG_QR` 409, `WRONG_PASSENGER_TYPE` 422, `ID_MISMATCH` 403,
  `PHOTO_SAVE_FAILED` 503. `GET /trips/active` also returns `end_qr_blocked`.
- `high_km_limit_km` (default 300) is a **placeholder**: the PDF names a high-km alert but no number. Ask the company.

#### Weak points and open questions from this step

- **If the passenger never confirms the end,** the trip stays in `waiting_for_end_confirm` and the driver and car stay blocked. Only an admin can
  close it, and that action is not built yet. Same for a trip locked by wrong IDs at the end. Next piece, with the waiting-too-long alert.
- A visitor's phone is not verified, so the end only proves the person knows the phone number typed at the start (which the driver may also know).
- The driver can end a trip from anywhere; the optional GPS fields are stored but never checked.

## Database (PDF section 16)

Tables: `vehicles`, `drivers`, `passengers`, `admin_users`, `trips`, `trip_photos`, `trip_tokens`,
`trip_events` (audit log), `alerts`, `settings`.

Rules enforced **in the database**:
- One open trip per car and one per driver (partial unique indexes on `trips`). Open means
  `waiting_for_passenger`, `in_progress` or `waiting_for_end_confirm`.
- `end_km > start_km`; purpose required when there is no passenger; a reason is required for
  `cancelled` / `closed_by_admin`; ended trips must have end km and end time.
- One photo per stage (start/end) per trip; QR token hashes are unique.
- Visitor trips need a name and phone and no employee link; visitor fields are only allowed on visitor trips.
- `trip_events` is append-only: a trigger blocks UPDATE and DELETE.
- Trip numbers come from a sequence: `T-000001`, `T-000002`, ... (6 digits, so no overflow).

Rules that the **backend must still enforce** (not in the database): start km not below the car's
last end km; km-gap alert; server-side times only; same passenger ID at start and end (end step not built yet); confirmation
not allowed from the driver's own session; QR one-time use and expiry; wrong-ID limit; role checks;
completed trips locked except admin corrections with a reason; never delete cars/people, only deactivate.

### Additions beyond the PDF tables (small, all implied by PDF behaviour)

- `trips.needs_review` (marked for review), `trips.start_lat/lng` and `end_lat/lng` ("text + GPS"),
  `trips.updated_at`.
- `trip_tokens.failed_attempts` (wrong-ID limit), `trip_tokens.revoked_at` ("Make new QR" kills the old one).
- `trip_events.trip_id` is nullable (so admin actions and settings changes can be logged) and
  `trip_events.detail` (JSONB) holds reasons or changes.
- `alerts.note`, `alerts.resolved_at`; `admin_users.status`; `vehicles.reg_number` is unique.
- `trips.is_visitor`, `visitor_name`, `visitor_phone`, `visitor_reason` (migration 0002, for passengers who are not EPIC employees).
- `created_at` / `updated_at` columns on most tables.

### Assumptions to confirm

- Default settings seeded: `qr_expiry_minutes=15`, `wrong_id_limit=5`, `long_trip_hours=6` come from the PDF;
  `km_gap_limit_km=20` and `waiting_too_long_minutes=30` are **placeholders** chosen by the author.
  `allow_visitors=1` is the developer's choice (visitors allowed).
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
| GET | `/api/trips/active` | driver | the driver's open trip or null, plus `start_qr_blocked` |
| POST | `/api/trips/{id}/start-qr` | driver | new Start QR (old one stops working; `423` if the trip is locked by wrong IDs) |
| POST | `/api/trips/{id}/cancel` | driver / admin | cancel before the passenger confirms (reason required) |
| POST | `/api/trips/{id}/end` | driver | end the trip (multipart form + end photo); returns the End QR, or completes at once with no passenger |
| POST | `/api/trips/{id}/end-qr` | driver | new End QR (old one stops working; `423` if locked) |
| GET | `/api/p/{token}` | anyone with the QR | passenger page data after scanning a Start QR (trip details) or an End QR (summary) |
| GET | `/api/p/{token}/photo` | anyone with the QR | start dashboard photo (only while the QR is valid) |
| GET | `/api/p/{token}/photo/{kind}` | anyone with the QR | `start` or `end` dashboard photo |
| POST | `/api/p/{token}/lookup` | anyone with the QR | name for a typed employee ID (Start QR only; wrong IDs count toward the limit) |
| POST | `/api/p/{token}/confirm-start` | anyone with the QR | confirm start as `employee` or `visitor`; not from the driver's own session |
| POST | `/api/p/{token}/confirm-end` | anyone with the QR | confirm end with the same employee ID, or the same phone for a visitor; completes the trip |

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
  alembic.ini, alembic/    migrations (0001_initial_schema, 0002_visitor_passengers)
  app/config.py            settings from backend/.env
  app/db.py                engine, session, Base, naming convention
  app/models/              SQLAlchemy models (enums, vehicle, people, trip, audit)
  app/main.py              FastAPI app (health, CORS, routers)
  app/security.py          bcrypt hashing and JWT tokens
  app/deps.py              DB session and role guards
  app/routers/auth.py      driver and admin sign-in
  app/routers/cars.py      car page
  app/routers/trips.py     start trip, active trip, new Start QR, cancel, end trip, new End QR
  app/routers/passenger.py passenger pages: open QR (start or end), photos, lookup, confirm start, confirm end
  app/services/            audit log, settings lookup, QR tokens, QR checks and wrong-ID lock (qr_access.py), trip rules,
                           phone normalizing (phones.py)
  app/storage.py           photo storage (local folder now, Azure Blob later)
  app/errors.py            error format helper; app/schemas.py response shapes
  app/seed.py              development seed data
  app/set_password.py      command to change/create admin passwords
  tests/test_db_rules.py   checks that the DB enforces the business rules
  tests/test_auth.py       sign-in, lockout and role-guard tests
  tests/test_trips.py      car page and start-trip tests
  tests/test_passenger.py  passenger page, wrong-ID limit and visitor tests
  tests/test_end_trip.py   end form, End QR, end confirmation, visitor phone rule
frontend/                  not started
```

## Next steps

1. Verify the end-of-trip part on the developer machine (unchecked item above) and commit.
2. Backend, next pieces in this order: admin close of a stuck trip and unlock of a blocked trip (start or end);
   "Passenger can't scan" approval; alerts and background jobs (long trip, waiting too long, reminders);
   admin CRUD, passenger import, reports and Excel/PDF export; admin photo access. Endpoint list: PDF section 15.
3. Frontend (Next.js + Tailwind + shadcn/ui, Bangla/English): driver, passenger (with the Employee / Others choice) and admin
   screens (PDF sections 10-11). Test the phone camera over HTTPS (Microsoft Dev Tunnels or mkcert).
4. Docker Compose setup, then Azure deployment (needs the company's Azure access and a sub-domain).

## Conventions for whoever continues

- Times are stored in UTC (`timestamptz`) and shown in Bangladesh time (UTC+6); always use server time.
- Never store raw QR tokens, PINs or passwords; only hashes.
- Never commit `.env`, the virtual environment, uploads or real data.
- Keep the data layer behind interfaces (storage, database) so the hosting can change.
