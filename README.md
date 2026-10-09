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

#### Decisions in this step

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

### 2026-10-08 (admin: close a stuck trip, unlock a blocked trip)

- [x] `POST /api/admin/trips/{id}/close` (admin role only; body `reason`, optional `end_km`): any open trip (waiting for passenger, in progress,
      waiting for end confirmation) becomes `closed_by_admin`, `needs_review = true`, all QR codes stop, the car and driver are free again.
      Reason is required (`REASON_REQUIRED`). `409 TRIP_NOT_OPEN` if already finished.
- [x] `POST /api/admin/trips/{id}/unlock` (admin only; body `reason`): resets the wrong-ID count of the blocked stage (start or end), solves the
      `wrong_ids` alert; the driver can then make a new QR. `409 NOT_LOCKED` if the trip is not blocked. The history stays in the audit log
      (`passenger_wrong_id` events).
- [x] 15 new tests (`tests/test_admin_trips.py`), **130 in total pass**.
- [ ] **To verify:** unzip over the repo, `pytest -q` (expect 130). In Swagger as admin: lock a trip with 5 wrong IDs, call `unlock`; or
      end a trip, then call `close` and check the car is free for a new trip.

Decisions: if an end km is known (driver sent it, or the admin types `end_km` for a trip without one) the trip keeps it and the car's
`current_km` moves forward, never backwards; with no end km the car's km is unchanged. Closing writes an `admin_closed` alert that is already
solved (a record for the exceptions list) and solves any open `wrong_ids` alert. Unlock only resets the blocked stage. Not built: a list of
stuck trips for the admin (comes with the admin dashboard API), and "Passenger can't scan".

### 2026-10-09 ("Passenger can't scan": driver skips a confirmation, admin approves later)

PDF section 8: *passenger has no phone or no internet -> driver taps "Passenger can't scan", the admin approves later, the trip is marked for review.*

- [x] Migration `0003_cant_scan_approval`: `trips.start_no_scan_reason`, `end_no_scan_reason`, `approval_status` (`pending` / `approved` / `rejected`, empty
      when nothing was skipped), `approved_by`, `approved_at`, `approval_note`, three CHECK constraints (a status needs a skipped step, a skipped step
      needs a status, a decided status needs the admin), index on `approval_status`. Tested upgrade, `alembic check`, downgrade, upgrade.
- [x] `POST /api/trips/{id}/cant-scan` (driver, body `reason`): at the start, trip goes to `in_progress` without a passenger, Start QR stops, journey start time set,
      `needs_review = true`, `approval_status = pending`.
- [x] `POST /api/trips/{id}/end-cant-scan` (driver, body `reason`): at the end, trip goes to `completed` without confirmation (`end_confirm_time` stays empty),
      End QR stops, the car's `current_km` moves forward as usual, same flags.
- [x] `GET /api/admin/trips/approvals` (admin or viewer): trips waiting for a decision, oldest first.
- [x] `POST /api/admin/trips/{id}/approval` (admin only, body `decision` = `approved` / `rejected`, `note`; a rejection needs a note). The trip itself is not
      changed (it already happened); the decision is kept for the exceptions report. `409 NO_PENDING_APPROVAL` if there is nothing to decide.
- [x] Setting `allow_cant_scan` (1 or 0, default 1) switches the driver option off. New error codes: `CANT_SCAN_NOT_ALLOWED` 403, `REASON_REQUIRED` 422.
- [x] 19 new tests (147 in total pass in the sandbox).
- [ ] **To verify:** unzip over the repo, `alembic upgrade head` (applies 0003), `python -m app.seed` (adds `allow_cant_scan`), `pytest -q` (expect 147).
      In Swagger: start a trip as a driver, call `cant-scan`, end it, call `end-cant-scan`, then as admin `GET /admin/trips/approvals` and `POST .../approval`.

Decisions: the reason is required and free text (the driver may name the passenger there, nothing is verified). A trip locked by wrong IDs may still use
"can't scan" (it is flagged for review anyway, and the admin sees the `wrong_ids` alert). `needs_review` is **not** cleared by an approval, because it can
also come from a visitor trip; `approval_status` is the separate field for this decision. No alert type was added (that would need an enum migration): the
admin finds these trips with the approvals list. Possible later hardening: a daily limit per driver on "can't scan", to spot misuse.

### 2026-10-09 (background alerts, driver reminders, admin alerts list)

PDF 11.4 and section 17 (APScheduler worker). **No database change in this step.**

- [x] `app/services/jobs.py`: `run_checks()` raises **long trip** (trip In progress longer than setting `long_trip_hours`, default 6) and **waiting too long**
      (Waiting for passenger since the trip started, or Waiting for end confirm since the driver ended it, longer than `waiting_too_long_minutes`, default 30)
      alerts. Each is raised once (waiting: once per stage), so running every minute does not repeat them.
- [x] `app/worker.py`: `python -m app.worker` runs the checks every minute (APScheduler, a separate process next to the API; run only one). New package: `apscheduler`.
- [x] Driver reminder: `GET /api/trips/active` now returns `reminders: [{type, message, since}]` while the matching alert is open and the trip is still in that state. It
      stops when the admin solves the alert or the trip moves on. The app shows it as a banner. (No SMS or push in Phase One.)
- [x] `GET /api/admin/alerts?status=open|solved|all&type=&limit=&offset=` (admin or viewer), newest first, with trip number and car code.
- [x] `POST /api/admin/alerts/{id}/solve` (admin only, optional `note`). `409 ALREADY_SOLVED`, audit event `alert_solved`.
- [x] 12 new tests (`tests/test_alerts.py`), **159 in total pass**. The worker was started and ran its first check.
- [ ] **To verify:** `pip install apscheduler`, `pytest -q` (expect 159). Run `python -m app.worker` in a second window. In Swagger: to see a long-trip alert quickly, set
      `long_trip_hours` to 0 or `waiting_too_long_minutes` to 0 in the `settings` table (pgAdmin: `UPDATE settings SET value='0' WHERE key='waiting_too_long_minutes';`),
      start a trip, wait a minute, then `GET /api/trips/active` (driver, see `reminders`) and `GET /api/admin/alerts` (admin). **Set the values back afterwards** (30 and 6).

Alert types already raised elsewhere: `km_gap` (start trip), `high_km` (end trip), `wrong_ids` (passenger side), `admin_closed` (admin close).
Decisions: the admin "reminder" is the alert itself; the driver reminder is an in-app banner. A solved alert is never raised again for the same trip/stage. Not built:
the PDF's reminder for maintenance, and the nightly backup job (belongs to deployment).

### 2026-10-09 (admin dashboard, trip history, trip detail, audit log)

PDF 11.1, 11.2 and section 15. Read only, **no database change**. Admin and viewer may use everything except the audit log (admin only, as in the PDF API table).

- [x] `GET /api/admin/dashboard`: `cards` (cars on trip, cars available, trips waiting for confirm, trips today, km today, open alerts), `car_board` (every car with
      `state` = `on_trip` / `waiting` / `available` / `maintenance` / `inactive`, current km and its open trip), `live_trips` (open trips with driver phone and minutes running),
      the 10 newest open `alerts`, and `charts` (km per car this month, trips per day this month).
- [x] `GET /api/admin/trips`: trip history, newest first. Filters: `q` (search trip no, car, driver, passenger, visitor name/phone, places, purpose), `range` = `today` / `week` / `month`,
      `date_from` / `date_to`, `status`, `car_id`, `driver_id`, `department`, `approval`, `needs_review`, `limit` (max 200), `offset`. Returns `total` and `total_km` of the filtered set.
      Click a car on the board = this list with `car_id`.
- [x] `GET /api/admin/trips/{id}`: full detail: driver, passenger or visitor, car, GPS map points, `photos.start` / `photos.end` links, `timeline` (every audit event with a readable `label`,
      actor, IP, device, GPS, details) and the trip's alerts.
- [x] `GET /api/admin/photos/{trip_id}/{kind}?exp=&sig=`: the photo behind a **short-lived signed link** (10 minutes, HMAC with `SECRET_KEY`). An `<img>` tag cannot send a sign-in header,
      so the trip detail hands out these links. Open the trip again for fresh links.
- [x] `GET /api/admin/audit`: audit log search (admin only). Filters: `q` (event, actor, IP, device and the details text), `event`, `actor`, `trip_id`, `date_from`, `date_to`, `limit`, `offset`.
- [x] 23 new tests (`tests/test_admin_views.py`), **182 in total pass**.
- [ ] **To verify:** unzip over the repo, `pytest -q` (expect 182). In Swagger as admin: `GET /api/admin/dashboard`, `GET /api/admin/trips?range=today`, copy a trip id, `GET /api/admin/trips/{id}`,
      paste a `photos.start.url` into the browser address bar after `http://localhost:8000` (it shows the photo), then `GET /api/admin/audit?trip_id={id}`.

Decisions: "today", "this month" and the date filters use **Bangladesh days (UTC+6)**; the week starts on **Sunday** (change in `services/timeutil.py` if the company counts differently). Km totals count
only finished trips (completed, closed by admin), by the day the trip ended; "trips today" counts trips started today except cancelled ones. A car with a trip waiting for confirmation shows as `waiting`
(also after the driver ended it), a car in maintenance without an open trip shows `maintenance`. Not built here: CSV/Excel/PDF export of the audit log and trip log (comes with the reports step), the
single-car detail page (comes with cars CRUD; use the history filter for the car's trips meanwhile), live push updates (the front end can poll the dashboard every 15-30 seconds).

### 2026-10-09 (admin: cars and QR stickers)

PDF 8, 11.2 (Cars & QR) and section 15. **No database change.** New packages: `qrcode`, `reportlab`, `pillow`.
Admins and viewers may look; only admins may change cars or print stickers (PDF section 4).

- [x] `GET /api/admin/cars` (filters `q`, `status`): code, registration, model, current km, status, sticker version and link, total trips, total km, last trip, open trip.
- [x] `GET /api/admin/cars/{id}`: the same plus the last 10 trips (full history: `GET /admin/trips?car_id=`).
- [x] `POST /api/admin/cars`: add a car (`car_code` such as `CAR-11`, letters/digits/dashes, stored upper case; `reg_number`, `model`, `current_km`, `status`).
      `409 CAR_CODE_EXISTS` / `REG_NUMBER_EXISTS` (registration compared ignoring case).
- [x] `PATCH /api/admin/cars/{id}`: change `reg_number`, `model`, `status` (active / maintenance / inactive), or correct `current_km` (needs a `reason`; logged with before and after).
      The car code and the sticker version cannot be set here. A car with an open trip cannot be set to maintenance or inactive (`409 CAR_HAS_OPEN_TRIP`).
- [x] `POST /api/admin/cars/{id}/new-sticker`: lost sticker: sticker version +1, the **old sticker stops working at once** (`410 STICKER_OUTDATED` on the car page).
- [x] `GET /api/admin/cars/{id}/qr.pdf?layout=sticker|a4`: printable sticker, 6 x 6 cm with the car code and "Scan to start trip" under the QR (`sticker`, one small page for a label printer),
      or an A4 page with the sticker at the top left and a dotted cut line (`a4`, for an office printer). The response is a file download (`Content-Disposition: attachment`); add `inline=true` to show it in the browser instead. The QR holds only `{PUBLIC_BASE_URL}/c/{car_code}?v={version}`.
- [x] Audit events: `car_created`, `car_updated`, `car_sticker_renewed`, `car_sticker_printed`.
- [x] 25 new tests (`tests/test_admin_cars.py`), **207 in total pass**. The sticker PDF was rendered and looked at.
- [ ] **To verify:** `pip install qrcode reportlab pillow`, `pytest -q` (expect 207). In Swagger as admin: `POST /api/admin/cars`, `GET /api/admin/cars`, open `/api/admin/cars/{id}/qr.pdf`
      (Swagger shows a Download link; or call it with the admin token from the front end later), then `POST .../new-sticker` and check the old `?v=1` link now fails on `GET /api/cars/{code}?v=1`.
      **Before printing real stickers, set `PUBLIC_BASE_URL` in `backend/.env` to the real address** (the QR text is built from it; the front end route `/c/{car_code}` is still to be built).

Decisions: no delete (a car with history is set to inactive instead). The car code is permanent because it is printed on the sticker; a wrong code means adding a new car. The km correction exists
for a replaced odometer; normal km changes only come from trips. Not built: a "Fuel and maintenance records" feature (PDF 'later' list).

### 2026-10-09 (admin: drivers, passengers, Excel import)

PDF 11.2 (Drivers and Passengers pages). No database change. New package: `openpyxl`. Admin and viewer can look, only admin can change.

- [x] Drivers: `GET /api/admin/drivers` (filters `q`, `status`), `GET /api/admin/drivers/{id}`, `POST /api/admin/drivers`, `PATCH /api/admin/drivers/{id}`,
      `POST /api/admin/drivers/{id}/reset-pin`. A driver is added without a PIN and chooses a 4-digit PIN at the first sign-in. Reset PIN removes the PIN so the driver is
      asked for a new one. Name, phone, licence number and status can be edited; the employee ID cannot. Totals shown: trips, km, cancelled trips, last trip, open trip, has PIN.
- [x] Passengers: `GET /api/admin/passengers` (filters `q`, `department`, `status`, `limit`, `offset`), `GET /api/admin/passengers/departments`, `GET /api/admin/passengers/{id}`,
      `POST /api/admin/passengers`, `PATCH /api/admin/passengers/{id}`. Name, department, phone and status can be edited; the employee ID cannot.
- [x] Excel import: `POST /api/admin/passengers/import` (file upload, `.xlsx`, max 5 MB, 5000 rows). The first row holds the headings: Employee ID and Name are required, Department and Phone are
      optional, any order (also accepted: Emp ID, Dept, Mobile, Full Name, and similar). A new employee ID is added; an existing one gets the new name, department and phone (blank cells keep the old
      department and phone). Nobody is deactivated for missing from the file, and an inactive person stays inactive. Bad rows are skipped and listed with their row number, the rest are saved.
      `?dry_run=true` shows the result without saving. A ready sheet is in `docs/passenger-import-template.xlsx`.
- [x] Deactivating a driver or passenger keeps all history. A deactivated driver is signed out at once (the saved sign-in stops working) and can be activated again. An inactive passenger gets
      "ID not found" on the passenger page. A driver with an open trip cannot be deactivated (`409 DRIVER_HAS_OPEN_TRIP`).
- [x] Audit events: `driver_created`, `driver_updated`, `driver_pin_reset`, `passenger_created`, `passenger_updated`, `passengers_imported`.
- [x] 20 new tests (`tests/test_admin_people.py`), 227 in total pass in the sandbox.
- [ ] To verify: `pip install openpyxl`, `pytest -q` (expect 227). In Swagger as admin: add a driver, then sign in as that driver and set a PIN; `reset-pin` and sign in again;
      import `docs/passenger-import-template.xlsx` with `dry_run=true`, then without; search the new people with `q`.

Notes: nothing is ever deleted, only set inactive. An employee ID is permanent (history and QR flows use it). Drivers and passengers are separate lists, so a driver who also rides as a
passenger needs an entry in both. Admin users and Settings are the remaining admin pages.

### 2026-10-09 (admin: users and settings)

PDF 11.2 (Users and Settings pages). No database change, no new package. Users page is admin only. Settings can be seen by admin and viewer, changed by admin only.

- [x] Users: `GET /api/admin/users`, `POST /api/admin/users` (username, role admin or viewer, password 8-72 characters), `PATCH /api/admin/users/{id}` (role and/or active/inactive),
      `POST /api/admin/users/{id}/reset-password`. Usernames are not case-sensitive for the duplicate check and may use letters, numbers, dot, dash and underscore.
- [x] Nobody is deleted, only set inactive. A deactivated account is signed out at once. An admin cannot demote or deactivate their own account, so there is always someone who can sign in
      (another admin can still do it). `POST /api/admin/users/me/password` lets anyone signed in (admin or viewer) change their own password with the current one.
- [x] Settings: `GET /api/admin/settings` lists each setting with its value, default, allowed range and a plain label. `PATCH /api/admin/settings` takes `{"values": {"qr_expiry_minutes": 10}}`.
      Each value is range-checked (for example, yes/no settings only 0 or 1). If one value is bad, nothing is saved. Saving the same value again does nothing.
- [x] Changes take effect straight away because the trip, QR and alert code already read the values from the settings table.
- [x] Audit events: `admin_user_added`, `admin_user_changed`, `admin_password_reset`, `admin_password_changed`, `settings_changed` (old and new value for each key). Passwords are never written to the log.
- [x] 11 new tests (`tests/test_admin_users_settings.py`), 238 in total pass in the sandbox.
- [ ] To verify: `pytest -q` (expect 238, or 237 passed and 1 skipped without `pdftotext`). In Swagger as admin: add a viewer, sign in as that viewer, open the settings (works) and try to change one (403);
      change `qr_expiry_minutes` as admin and look at the audit log for `settings_changed`; reset the viewer's password and sign in with the new one.

Notes: a password reset does not clear a lockout from too many wrong tries; the lock ends by itself after 15 minutes. Reports with Excel/PDF export are the last backend piece.

### 2026-10-09 (reports, Excel/PDF export, audit export, purposes list)

PDF 11.3 (Reports), section 15 (`/admin/reports/{name}`) and the "purposes list" in 11.2 Settings. One new migration (`0004`: `settings.value` becomes text, so the purposes list fits). No new package
(openpyxl and ReportLab were already installed). Admin and viewer can use the reports; the audit export is admin only.

- [x] `GET /api/admin/reports` lists the seven reports. `GET /api/admin/reports/{name}` returns one as JSON (`summary` plus one or more `sections` with `columns` and `rows`), or as a file with
      `?format=xlsx` or `?format=pdf`. Names: `car_usage`, `drivers`, `passenger_department`, `trip_log`, `exceptions`, `km_continuity`, `monthly_summary`.
- [x] Filters on every report: `date_from`, `date_to` (Bangladesh dates, on the trip's start time), `range` (`today`, `week`, `month`), `car_id`, `driver_id`, `department`. With no date the report covers the
      current month. Times in the rows are already written in Bangladesh time.
- [x] Car usage: trips, total km, hours used, days used, idle days, km per trip. Idle days = days of the period (up to today) with no trip starting. A trip that runs past midnight counts for its start day only.
- [x] Driver report: trips, km, average trip minutes, cancelled trips, alerts. Passenger and department: two tables (by department with share of km, by passenger). Visitors are grouped under "Visitor" and trips
      without a passenger under "(no passenger)". Km only count for trips that are completed or closed by admin; cancelled trips are never counted as trips.
- [x] Trip log: every trip (also cancelled) with all fields. The "photos" column is a link to the admin trip page, because the signed photo links stop working after 10 minutes and would be dead in a saved file.
- [x] Exceptions: cancelled, closed by admin, no passenger, needs review (passenger could not scan), and the alerts made in the period (km gap, long trip, high km, wrong IDs, waiting too long).
      "Admin closed" alerts are not listed a second time.
- [x] Km continuity: each trip's start km against the end km of the previous trip of the same car. Gap above 0 = "Unrecorded use", below 0 = "Odometer went back". The last trip before the period is used for the first
      comparison. If a car's odometer was replaced and corrected in the Cars page, one gap will show for that.
- [x] Monthly summary: trips, completed, closed by admin, cancelled, total km, average km, trips without passenger, visitor trips, open alerts now, trips waiting for approval now, trips running now,
      busiest 5 cars, top 5 departments.
- [x] Excel: one sheet per table plus a Summary sheet, header row, filters, frozen header. Everything typed as text is stored as text, so a name that starts with `=` can never turn into a formula.
      PDF: landscape A4, header repeats on every page, page number and date at the bottom. The very wide trip log shows only the main columns in the PDF; the Excel file has all of them.
- [x] An export of more than 20,000 rows is refused with `TOO_MANY_ROWS` (choose fewer days). The JSON report has no such limit.
- [x] Audit log export: `GET /api/admin/audit/export?format=xlsx|pdf` with the same filters as the audit log search (`q`, `event`, `actor`, `trip_id`, `date_from`, `date_to`); current month if no date.
- [x] Purposes: `GET /api/purposes` (any signed-in driver or admin) gives the list for the start-trip form, `PUT /api/admin/settings/purposes` (admin) replaces it (1 to 30 items, up to 60 characters; duplicates removed;
      every change logged as `purposes_changed`). The driver can still type any purpose. The start list is a placeholder (Office meeting, Client visit, Site visit, Airport pick-up / drop,
      Bank or government office, Other) until the company gives its own. `GET /api/admin/settings` now also returns `purposes`.
- [x] The dashboard already had both charts from the plan (km per car this month, trips per day), so nothing was added there.
- [x] 22 new tests (`tests/test_reports.py`), 260 in total pass in the sandbox. Checked the PDF by eye as well.
- [ ] To verify: `alembic upgrade head`, `pytest -q` (expect 260, or 259 passed and 1 skipped without `pdftotext`). In Swagger as admin: `GET /api/admin/reports/car_usage` (JSON), then the same with
      `format=xlsx` and `format=pdf` and open the downloaded files; try `trip_log` with `car_id`; `GET /api/admin/audit/export`; `PUT /api/admin/settings/purposes`, then `GET /api/purposes` as a driver.

Known gap: the built-in PDF font has no Bangla letters, so Bangla names or places would show as empty boxes in PDF files (Excel is fine). To fix it, put a Bangla font file (for example Noto Sans Bengali)
on the server and set `PDF_FONT_PATH` (and optionally `PDF_FONT_BOLD_PATH`) in `.env`. Not tested with a real Bangla font yet. The backend API list in the PDF is now complete.

### 2026-10-09 (frontend step 1: foundation, look and feel)

Design agreed from the mockups (Design canvas "Scan-to-Drive UI mockups"). Frontend plan, one step at a time:
1 foundation, 2 driver sign-in, 3 driver trip flow, 4 passenger pages, 5 admin dashboard, 6 trip history and detail,
7 admin lists (cars, drivers, passengers, alerts, audit), 8 reports, users, settings, 9 polish, phone test over HTTPS, Docker and Azure.

- [x] `frontend/` set up: Next.js 16.3 (App Router, TypeScript), React 19.3, Tailwind CSS 4.3, ESLint. Exact versions pinned in `package.json`.
- [x] Colours from the Epic website: navy `#1C2E6F` (sidebar, headers), Epic blue `#284DAE` (main buttons), signal blue `#155DFC` (focus, live,
      last odometer digit). All colours are CSS variables in `src/app/globals.css`, with a matching dark set.
- [x] Status colours, the same everywhere: green available, blue on trip, amber waiting, red alert, grey maintenance / inactive.
- [x] Fonts: Poppins (headings, same as the Epic website), Plus Jakarta Sans (text), Geist Mono (km, trip numbers, times), Hind Siliguri (Bangla).
      They come from Fontsource packages and are bundled with the app, so nothing is loaded from Google (Google Fonts was not reachable from the
      build machine, and the company server may block it too).
- [x] Fluid sizes: text and spacing grow smoothly from phone to laptop with `clamp()` tokens in Tailwind's theme (`text-*`, `px-gutter`, `gap-section`).
      The `fluid-tailwind` plugin was not used because it only supports Tailwind 3.
- [x] Light / dark: follows the computer's setting, with a switch (moon / sun). The page cross-fades when switching.
- [x] English / Bangla: English by default, EN / বাং switch everywhere, remembered in a cookie for a year. No `/en` or `/bn` in the address, so the
      QR links (`/c/{car}`, `/p/{token}`) stay short. Texts are in `frontend/messages/en.json` and `bn.json`.
- [x] Shared pieces in `src/components/ui/`: Button, Input / Field, Card, StatusChip, LiveDot, Odometer, CountdownRing, Reveal / Stagger, ThemeToggle,
      LanguageSwitch. Built on Radix (keyboard and screen-reader support) in the shadcn/ui style, but written by hand: the shadcn CLI needs its own
      website, which was not reachable.
- [x] Animations (Motion library): odometer digits roll to the new value, cards rise in one after another, QR ring counts down and turns amber in the
      last minute, live dots pulse, buttons press in, the menu highlight slides, the phone menu slides in. All of it is switched off when the phone
      or computer has "reduce motion" turned on.
- [x] Admin frame: navy sidebar on laptops, slide-in menu on phones, top bar with search box, language and theme switch. Dashboard shows the layout with
      loading placeholders (live data in step 5). Pages not built yet say which step brings them.
- [x] Driver overtime: in the sidebar with a "Phase 2" tag. Its page explains what is planned (hours beyond the shift, monthly totals, approve and
      export for payroll) with a faded preview table of sample numbers.
- [x] Start page (`/`): driver or transport office, and a note for passengers. `/styleguide` shows every shared piece (development only).
- [x] The browser only calls the Next.js server; `/api/...` is passed on to FastAPI (`BACKEND_URL` in `frontend/.env.local`), so no CORS setup is needed.
- [x] Checked in the sandbox: lint, type check and production build pass; pages looked at in Chromium at phone (390 px) and laptop (1366-1440 px)
      sizes, light and dark, English and Bangla; menu, theme and language switches clicked through. No browser errors.
- [ ] To verify: install Node.js 22 LTS, then the commands under "How to run the frontend". Open `/`, `/admin`, `/admin/overtime` and `/styleguide`;
      try the phone size in the browser's device toolbar (F12), the moon button and EN / বাং.

Notes: admin pages are not protected yet; sign-in comes with the admin login (step 5). The Epic logo is not in the app yet (a placeholder mark is
used); put the logo file in `frontend/public/` when we have it. Bangla texts need a read-through by a native speaker.

### 2026-10-09 (frontend step 2: driver sign-in, sessions in cookies, testing on phones)

Backend change (no database change, no new package):
- [x] Sign-in is kept in httpOnly cookies (`s2d_driver` 30 days, `s2d_admin` 8 hours, SameSite=Lax, `Secure` in production). Page scripts cannot
      read them, so a bad script cannot steal a session. The token is still in the login reply, so Swagger's Authorize button keeps working.
- [x] Requests that change something and use the cookie must carry the header `X-S2D: 1` (the web app always sends it), otherwise
      `403 CSRF_CHECK_FAILED`. Other websites cannot add that header, which stops them from making requests in someone's name.
      Requests with a Bearer token (Swagger, scripts, tests) do not need it.
- [x] Driver and admin cookies are separate, so one laptop can be signed in as a driver and as an admin at the same time.
- [x] New: `GET /api/auth/driver/me`, `GET /api/auth/admin/me`, `POST /api/auth/logout?who=driver|admin|all`.
- [x] The passenger pages also notice the driver cookie (a driver cannot confirm their own trip from their own phone).
- [x] Employee ID at sign-in ignores letter case and spaces (`emp-1021` works). The lockout counts the stored ID, so changing the letter case
      does not give extra tries.
- [x] Easy PINs are refused when choosing one: all the same digit (1111) or a straight run (1234, 6789, 9876 ...): `422 WEAK_PIN`.
- [x] Setting `COOKIE_SECURE` (empty = on in production, off in development so plain http works on test phones).
- [x] 12 new tests (`tests/test_cookie_sessions.py`), two older tests changed to use PINs that are not easy. 272 in total pass.

Frontend:
- [x] Epic Group logo in all headers (cream version on navy, navy version on light): `frontend/public/brand/`. A sharper SVG can replace the PNGs later.
- [x] `/driver/login`: employee ID and 4 PIN boxes (one real input behind them, so the phone shows the number pad and paste works). Signs in by
      itself when the 4th digit is typed. Wrong PIN: the boxes shake, the PIN is cleared and a message shows. First sign-in (or after the admin
      reset the PIN): "Choose your PIN", then "Type the PIN again", then a tick and straight in. The last employee ID is remembered on the phone.
- [x] `/driver`: greeting (morning / afternoon / evening, Bangladesh time), name and ID; the open trip if there is one; otherwise "Scan the QR
      sticker in the car" with a moving scan line, and a box to type the car code if a sticker is missing. Sign out at the bottom.
- [x] `/c/{car}` (where the car sticker leads): not signed in, so sign in first and then come straight back to the same car. The car page itself is step 3.
      Only addresses on this site are accepted as the "come back to" page.
- [x] All `/api/...` calls go through `src/app/api/[...path]/route.ts`, a small proxy to FastAPI. It replaces the rewrite in `next.config.ts`
      because the rewrite did not pass on the phone's IP address (the audit log showed 127.0.0.1 for everyone) and fixed the backend address at
      build time. Now the audit log has the phone's address, and `BACKEND_URL` is read when the server starts.
- [x] Testing on phones: `npm run dev:lan` prints the laptop's Wi-Fi address and a QR code to scan with the phone. Phones only need the
      frontend address; the backend stays on 127.0.0.1. Next.js 16 blocks the dev server for other addresses unless allowed, so home and office
      ranges (192.168.x.x, 10.x.x.x, 172.x.x.x) and the found address are allowed in development. The floating Next.js dev button is turned off
      (it covered the sign-out button on phones).
- [x] `BACKEND_URL` defaults to `http://127.0.0.1:8000` instead of `localhost`: on Windows, Node looks up `localhost` as IPv6 (::1) first, where
      uvicorn is not listening.
- [x] Checked in the sandbox with the real backend and database: new driver chooses a PIN (easy PIN and mismatch caught), comes back to the
      car page, cookie is httpOnly and not readable by scripts, sign out, ID remembered, wrong PIN, sign in again, open-redirect blocked,
      Bangla, dark, report download through the proxy, change without `X-S2D` refused, phone IP in the audit log. Production build, lint and types pass.
- [ ] To verify on the laptop and phones: see "Testing on phones" below.

Notes: GPS (start place) needs HTTPS on phones; plain http on the Wi-Fi address is fine for this step and will be handled in step 3. The admin
pages are still open without sign-in until step 5.

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
pip install fastapi "uvicorn[standard]" sqlalchemy alembic "psycopg[binary]" pydantic-settings bcrypt pyjwt httpx python-multipart apscheduler qrcode reportlab pillow openpyxl pytest
copy .env.example .env        # first time only, then edit DATABASE_URL and SECRET_KEY
alembic upgrade head          # create/update tables
python -m app.seed            # sample cars, drivers, passengers, admin, settings (prints admin/viewer passwords once)
pytest -q                     # database rule tests and sign-in tests
uvicorn app.main:app --reload # API at http://localhost:8000, docs at /api/docs
python -m app.worker          # second PowerShell window: background alert checks every minute (run only one)
pip freeze > requirements.txt
```

`backend/.env` values: `DATABASE_URL`, `SECRET_KEY` (generate with
`python -c "import secrets; print(secrets.token_urlsafe(48))"`), `ENVIRONMENT` (`development` or `production`;
production refuses to start with a weak key). Optional: `DRIVER_TOKEN_DAYS` (30), `ADMIN_TOKEN_MINUTES` (480),
`LOGIN_MAX_FAILURES` (5), `LOGIN_LOCKOUT_MINUTES` (15), `CORS_ORIGINS`, `PUBLIC_BASE_URL` (QR links, default
`http://localhost:3000`), `STORAGE_DIR` (photos, default `uploads`), `MAX_PHOTO_MB` (5), `PDF_FONT_PATH` / `PDF_FONT_BOLD_PATH` (a font file with Bangla letters for PDF reports).

Change an admin password: `python -m app.set_password admin` (hidden prompt, 8-72 characters).
Create a user: `python -m app.set_password mary --create --role viewer`.

New migration after changing models: `alembic revision --autogenerate -m "message"`, then **review it**
(autogenerate does not handle sequences, triggers or dropping enum types), and run `alembic check`.

## How to run the frontend (from `frontend/`, PowerShell)

Needs Node.js 22 LTS (Next.js 16 needs 20.9 or newer). Run the backend first, in its own window.

```powershell
npm ci                        # first time, and after package.json changes
copy .env.example .env.local  # first time only; BACKEND_URL=http://127.0.0.1:8000
npm run dev                   # http://localhost:3000 (this laptop only)
npm run dev:lan               # same, plus the address and a QR code for phones on the same Wi-Fi
npm run lint                  # code checks
npm run typecheck             # TypeScript checks
npm run build                 # production build (what the server will run)
npm run start:lan             # run the production build for phones (faster than dev on phones)
```

### Testing on phones (one laptop, two or three phones)

1. Laptop and phones on the **same Wi-Fi**. In Windows, that Wi-Fi should be a **Private** network
   (Settings > Network & internet > Wi-Fi > the network > Private).
2. Window 1, backend (stays on 127.0.0.1, Swagger at http://127.0.0.1:8000/api/docs):
   `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
3. Window 2, frontend: `npm run dev:lan`. It prints something like `On the phones: http://192.168.1.23:3000` and a QR code.
4. The first time, Windows asks whether Node.js may use the network: tick **Private networks** and allow.
   If you missed it, in PowerShell **as administrator**:
   `New-NetFirewallRule -DisplayName "Scan-to-Drive 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private`
5. On each phone, scan the QR code in the terminal (or type the address). Each phone can sign in as a different driver.
6. For car stickers and passenger QR codes to open on the phones (step 3 onwards), set `PUBLIC_BASE_URL=http://192.168.1.23:3000`
   (your address) in `backend/.env` and restart the backend.
7. The laptop's address can change when it reconnects to the Wi-Fi; `npm run dev:lan` always shows the current one.

## API so far

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/health` | anyone | API and database check |
| POST | `/api/auth/driver/login` | driver | employee ID + PIN; `409 PIN_NOT_SET` means ask for a new PIN |
| POST | `/api/auth/driver/set-pin` | driver | first sign-in only; returns a token |
| POST | `/api/auth/admin/login` | admin / viewer | username + password |
| GET | `/api/auth/driver/me` | driver | who is signed in (driver app) |
| GET | `/api/auth/admin/me` | admin / viewer | who is signed in (admin app) |
| POST | `/api/auth/logout` | anyone | `?who=driver`, `admin` or `all`: removes the session cookie(s) |
| GET | `/api/auth/me` | signed in | who am I |
| GET | `/api/cars/{car_code}?v=` | driver | car page: details, last end km, can start or why not |
| POST | `/api/trips` | driver | start a trip (multipart form + dashboard photo) |
| GET | `/api/trips/active` | driver | the driver's open trip or null, plus `start_qr_blocked`, `end_qr_blocked`, `reminders` |
| POST | `/api/trips/{id}/start-qr` | driver | new Start QR (old one stops working; `423` if the trip is locked by wrong IDs) |
| POST | `/api/trips/{id}/cancel` | driver / admin | cancel before the passenger confirms (reason required) |
| POST | `/api/trips/{id}/end` | driver | end the trip (multipart form + end photo); returns the End QR, or completes at once with no passenger |
| POST | `/api/trips/{id}/end-qr` | driver | new End QR (old one stops working; `423` if locked) |
| GET | `/api/p/{token}` | anyone with the QR | passenger page data after scanning a Start QR (trip details) or an End QR (summary) |
| GET | `/api/p/{token}/photo` | anyone with the QR | start dashboard photo (only while the QR is valid) |
| GET | `/api/p/{token}/photo/{kind}` | anyone with the QR | `start` or `end` dashboard photo |
| POST | `/api/p/{token}/lookup` | anyone with the QR | name for a typed employee ID (Start QR only; wrong IDs count toward the limit) |
| POST | `/api/p/{token}/confirm-start` | anyone with the QR | confirm start as `employee` or `visitor`; not from the driver's own session |
| POST | `/api/admin/trips/{id}/close` | admin | close any open trip with a reason (optional end km); car and driver are freed |
| POST | `/api/admin/trips/{id}/unlock` | admin | reset wrong-ID tries of a blocked trip |
| POST | `/api/trips/{id}/cant-scan` | driver | passenger cannot scan the Start QR: trip begins, marked for admin approval |
| POST | `/api/trips/{id}/end-cant-scan` | driver | passenger cannot scan the End QR: trip completes, marked for admin approval |
| GET | `/api/admin/trips/approvals` | admin / viewer | trips waiting for an approval decision |
| POST | `/api/admin/trips/{id}/approval` | admin | approve or reject (rejection needs a note) |
| GET | `/api/admin/alerts` | admin / viewer | alerts list (filter by status and type) |
| POST | `/api/admin/alerts/{id}/solve` | admin | mark an alert as solved, with a note |
| GET | `/api/admin/dashboard` | admin / viewer | cards, car board, live trips, alerts, charts |
| GET | `/api/admin/trips` | admin / viewer | trip history with filters and search |
| GET | `/api/admin/trips/{id}` | admin / viewer | trip detail: people, map points, photo links, timeline, alerts |
| GET | `/api/admin/photos/{trip_id}/{kind}` | signed link | dashboard photo, link valid 10 minutes |
| GET | `/api/admin/audit` | admin | audit log search |
| GET | `/api/admin/cars` | admin / viewer | car list with totals and open trip; filters `q`, `status` |
| GET | `/api/admin/cars/{id}` | admin / viewer | one car, totals and last 10 trips |
| POST | `/api/admin/cars` | admin | add a car |
| PATCH | `/api/admin/cars/{id}` | admin | edit registration, model, status; correct km with a reason |
| POST | `/api/admin/cars/{id}/new-sticker` | admin | new sticker version; the old sticker stops working |
| GET | `/api/admin/cars/{id}/qr.pdf` | admin | printable QR sticker (`layout=sticker` or `a4`) |
| GET | `/api/admin/drivers` | admin / viewer | driver list with totals; also `/{id}` |
| POST | `/api/admin/drivers` | admin | add a driver (no PIN) |
| PATCH | `/api/admin/drivers/{id}` | admin | edit driver, set active / inactive |
| POST | `/api/admin/drivers/{id}/reset-pin` | admin | remove the PIN; driver sets a new one at next sign-in |
| GET | `/api/admin/passengers` | admin / viewer | employee list with filters and paging; also `/{id}` and `/departments` |
| POST | `/api/admin/passengers` | admin | add an employee |
| PATCH | `/api/admin/passengers/{id}` | admin | edit employee, set active / inactive |
| POST | `/api/admin/passengers/import` | admin | import or update employees from an Excel file (`?dry_run=true` to preview) |
| GET | `/api/admin/users` | admin | list admin and viewer accounts |
| POST | `/api/admin/users` | admin | add an account |
| PATCH | `/api/admin/users/{id}` | admin | change role, set active / inactive |
| POST | `/api/admin/users/{id}/reset-password` | admin | set a new password for someone |
| POST | `/api/admin/users/me/password` | admin / viewer | change my own password |
| GET | `/api/admin/settings` | admin / viewer | all settings with value, default and allowed range |
| PATCH | `/api/admin/settings` | admin | change one or more settings (logged) |
| GET | `/api/admin/reports` | admin / viewer | the seven ready reports |
| GET | `/api/admin/reports/{name}` | admin / viewer | one report; filters `date_from`, `date_to`, `range`, `car_id`, `driver_id`, `department`; `format=json|xlsx|pdf` |
| GET | `/api/admin/audit/export` | admin | audit log as Excel or PDF (`format=xlsx|pdf`, same filters as `/api/admin/audit`) |
| GET | `/api/purposes` | driver / admin | trip purposes to pick from |
| PUT | `/api/admin/settings/purposes` | admin | replace the purposes list (logged) |
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
- Web sessions are httpOnly cookies; changes made with a cookie need the `X-S2D: 1` header (CSRF guard). In production, Nginx must set
  `X-Forwarded-For` to the real client address (`proxy_set_header X-Forwarded-For $remote_addr;`) so it cannot be faked, and uvicorn must be
  told to trust the frontend container (`FORWARDED_ALLOW_IPS`). To do with the Docker step.

## Repo layout

```
README.md                  this file
docs/                      the project plan PDF
backend/
  alembic.ini, alembic/    migrations (0001_initial_schema, 0002_visitor_passengers, 0003_cant_scan_approval)
  app/config.py            settings from backend/.env
  app/db.py                engine, session, Base, naming convention
  app/models/              SQLAlchemy models (enums, vehicle, people, trip, audit)
  app/main.py              FastAPI app (health, CORS, routers)
  app/security.py          bcrypt hashing and JWT tokens
  app/deps.py              DB session and role guards
  app/routers/auth.py      driver and admin sign-in
  app/routers/cars.py      car page
  app/routers/trips.py     start trip, active trip, new Start QR, cancel, end trip, new End QR
  app/routers/admin_trips.py admin close, unlock, approvals
  app/routers/admin_alerts.py alerts list and solve
  app/routers/admin_cars.py cars list, add / edit, new sticker version, sticker PDF
  app/routers/admin_people.py drivers and passengers: list, add, edit, reset PIN, Excel import
  app/routers/admin_views.py dashboard, trip history and detail, signed photo links, audit log
  app/routers/passenger.py passenger pages: open QR (start or end), photos, lookup, confirm start, confirm end
  app/worker.py            background worker (alert checks every minute)
  app/routers/admin_reports.py reports and audit export
  app/routers/admin_users.py admin/viewer accounts; app/routers/admin_settings.py settings page
  app/services/reports.py  the seven reports; app/services/report_export.py Excel and PDF files
  app/services/people_import.py reads the passenger Excel sheet
  app/services/stickers.py car QR sticker PDF (qrcode + reportlab)
  app/services/timeutil.py Bangladesh days for dashboards and filters
  app/services/            audit log, alert checks (jobs.py), settings lookup, QR tokens, QR checks and wrong-ID lock (qr_access.py), trip rules,
                           phone normalizing (phones.py)
  app/storage.py           photo storage (local folder now, Azure Blob later)
  app/errors.py            error format helper; app/schemas.py response shapes
  app/seed.py              development seed data
  app/set_password.py      command to change/create admin passwords
  tests/test_db_rules.py   checks that the DB enforces the business rules
  tests/test_auth.py       sign-in, lockout and role-guard tests
  tests/test_trips.py      car page and start-trip tests
  tests/test_passenger.py  passenger page, wrong-ID limit and visitor tests
  tests/test_admin_trips.py admin close and unlock
  tests/test_admin_cars.py cars and stickers
  tests/test_admin_people.py drivers, passengers, import
  tests/test_admin_users_settings.py users and settings pages
  tests/test_reports.py    reports, Excel/PDF, audit export, purposes
  tests/test_cookie_sessions.py cookies, CSRF header, sign-out, weak PINs, ID letter case
  tests/test_admin_views.py dashboard, history, detail, photo links, audit
  tests/test_alerts.py     background alerts, reminders, alerts list
  tests/test_cant_scan.py  passenger can't scan and admin approval
  tests/test_end_trip.py   end form, End QR, end confirmation, visitor phone rule
frontend/                  Next.js app
  messages/en.json, bn.json  all texts, English and Bangla
  src/app/globals.css      colours (light and dark), fonts, fluid sizes
  src/app/                 pages: / (start), /admin/*, /driver, /styleguide (development only)
  src/components/ui/       shared pieces: Button, Input, Card, StatusChip, Odometer, CountdownRing, Reveal, ThemeToggle, LanguageSwitch
  src/components/admin/    admin frame (sidebar, top bar) and the menu list
  src/i18n/                language from the cookie (next-intl)
  src/app/api/[...path]/   passes /api/... on to FastAPI (with the caller's IP)
  src/app/driver/, src/app/c/  driver sign-in, driver home, car sticker landing
  src/components/driver/   driver screens (sign-in, frame, sign out, car code form, scan picture)
  src/lib/api.ts           browser calls to the API (errors, X-S2D header); server-api.ts for server-side checks
  public/brand/            Epic Group logo (cream and navy)
  scripts/dev-lan.mjs      starts the dev server for phones and prints the address + QR code
```

## Next steps

1. Verify the unchecked items above (frontend step 2) on the laptop and phones, and commit.
2. Frontend step 3: driver trip flow (car page, start form with photo and GPS, Start QR, trip in progress, end form, End QR), with HTTPS for phone GPS.
3. Then steps 4-9 as listed in the frontend step 1 entry.
4. Backend still open: Azure Blob Storage for photos, production hardening (with the Docker / Azure step), a Bangla font for PDF reports.

## Conventions for whoever continues

- Times are stored in UTC (`timestamptz`) and shown in Bangladesh time (UTC+6); always use server time.
- Never store raw QR tokens, PINs or passwords; only hashes.
- Never commit `.env`, the virtual environment, uploads or real data.
- Keep the data layer behind interfaces (storage, database) so the hosting can change.
