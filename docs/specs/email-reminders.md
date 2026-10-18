# Spec: Outbox sender and reminder worker (M6, API only)

Feature spec for milestone M6, made from `SPEC_TEMPLATE.md` (sections 1-5). Roadmap steps 29-32 (this spec is step 29); behaviour B5. No new table, no new column and no migration: the `outbox` table, its `kind` CHECK (`reminder` is allowed), `sent_at` and `UNIQUE (registration_id, kind, schedule_version)` are in `DATABASE.md` (section 1, 3.2, decisions 5, 6 and 13), which this file does not change. Outbox rows of kind `ticket` are already written by `api/src/registrations/service.ts` (`registration.md`); `promotion` rows come with M4. Reschedule and event-cancel emails (rows of kind `reschedule` and `event_cancelled`, B8, B9) are M7 and extend this file later. The UI side (step 33) is `email-reminders-web.md`. Ids are ER1, ER2, ...

## 1. Goals and expected behaviour

**Goal.** Every email that the app decides to send is a row in `outbox`. A stub sender prints each unsent row once to the console and marks it sent (real delivery is out of scope). A reminder worker writes one `reminder` row for each seated person in the 24 hours before the event, once per schedule version, even if the worker runs many times or in parallel. A timer starts both.

**Behaviours.** Each line is something a test can prove. "Yes" means the test is written and committed before the code (red).

Sender (roadmap step 30):

| # | Behaviour | Test first? |
|---|---|---|
| ER1 | `sendPending(pool, { log, batchSize })` selects `outbox` rows with `sent_at IS NULL`, calls `log` once per row with one line (ER4), and sets `sent_at` on exactly those rows. It returns the number of rows sent. A row that was already sent is not selected. | yes |
| ER2 | A repeat run sends nothing: after one run, the next runs (10 in a row) call `log` 0 times, return 0 and leave `sent_at` of sent rows unchanged. | yes |
| ER3 | Two or more senders at the same moment send each row once: with N unsent rows, 5 parallel `sendPending` calls call `log` N times in total (each row id once) and every row has `sent_at` set. A deterministic case: while one open transaction holds a row with `FOR UPDATE`, a sender skips that row (does not wait, does not print it) and sends the others. | yes |
| ER4 | The log line is a single line (no `\n`) made by a pure function `formatEmailLine(row)`: `[email] <kind> to <to_email> | <subject> | <body>`, where line breaks in the body are replaced by ` / `. It holds the kind, the address, the subject and the body. The default `log` is `console.log`; tests pass a collecting function. | |
| ER5 | Batch: one call takes at most `batchSize` rows (default 100), oldest first (`created_at`, then `id`). With 5 rows and `batchSize` 2 the first call returns 2 (the 2 oldest), then 2, then 1, then 0. | |
| ER6 | If `log` throws for a row, that row keeps `sent_at` NULL (it is tried again on the next run), the other rows of the batch are still printed and marked, the error is reported to `onError` (default `console.error`, message only), and `sendPending` does not throw. The count returned does not include the failed row. | yes |
| ER7 | The sender treats every `kind` the same (`ticket`, `promotion`, `reminder`, `reschedule`, `event_cancelled`): one line, `sent_at` set. It has no code per kind. | |
| ER8 | The sender changes only `outbox.sent_at`. It writes no outbox row and touches no other table or column. A sent row's `to_email`, `subject`, `body`, `schedule_version` and `event_starts_at` are unchanged. | |

Reminder worker (roadmap steps 31, 32):

| # | Behaviour | Test first? |
|---|---|---|
| ER9 | (B5) `enqueueReminders(pool, now)` writes one outbox row of kind `reminder` for each person with a `registered` registration, no `checked_in_at`, on an `active` event with `starts_at - 24 hours <= now AND now < starts_at`. The row has `registration_id`, `schedule_version` and `event_starts_at` copied from the event, `to_email` from `users.email` (through `registrations.user_id`), `sent_at` NULL, and a subject and body (ER10). It returns the number of rows inserted. | yes |
| ER10 | Text of the row: subject `Reminder: <title> starts soon`; body has the title, `Starts: <starts_at in UTC> (UTC)` and the `Ticket code: <ticket_code>`, one item per line (the same style as the ticket email). The test checks that title, time and ticket code are in the body. | |
| ER11 | (B5) Run the worker 10 times with the same `now`: the first call returns N (the number of seated people in the window), the other nine return 0, and the outbox has exactly N reminder rows. | yes |
| ER12 | (B5) Two workers at once give one row per person: 2, and also 10, parallel `enqueueReminders` calls (different pool connections) with the same `now` return counts that add up to N, and the outbox has N reminder rows. | yes |
| ER13 | (B5) Only `registered` people: `waitlisted` and `cancelled` registrations get no reminder (`DATABASE.md` decision 6). | yes |
| ER14 | A `registered` person with `checked_in_at` set gets no reminder: they are already there. (A check-in before the window starts is possible, because check-in has no time window, `checkin.md` C11.) | |
| ER15 | (B5) An event with stored `status = 'cancelled'` gets no reminder, even for people left `registered` by SQL in the test (`DATABASE.md` 3.7). | yes |
| ER16 | (B5) Window edges, with the event starting at `S`: `now = S - 24h` gives rows; `now = S - 24h - 1 ms` gives none; `now = S - 1 ms` gives rows; `now = S` gives none; `now = S + 1 h` (event started or passed) gives none; an event 3 days away gives none. | yes |
| ER17 | (B5) The clock is injected: the SQL gets `now` as a parameter (`$1::timestamptz`) and the worker never calls `Date.now()` or SQL `now()` for the window. A test with `now` in the year 2030 and events at 2030 dates gives rows, with the real clock far away. | yes |
| ER18 | (B5) Version and time come from the event in the same statement: `enqueueReminders` runs exactly one `INSERT ... SELECT ... ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING` per call (the test counts the `query` calls on a wrapped pool: one). No read-then-insert in the app, no JS loop over people. | yes |
| ER19 | (B5) Reschedule loop: with a direct `UPDATE` (`starts_at` and `schedule_version + 1`, as `DATABASE.md` 3.6 does in M7) A -> B -> A -> B and `now` moved into each window, every move gives one fresh reminder per person (versions 1, 2, 3, 4), and a repeat in the same version gives none. The old rows stay. | yes |
| ER20 | A person who registers after the first run, still inside the window, gets their reminder on the next run; the people who already have one get no second row. Several events in the window each get their rows; an event outside the window gets none. | |
| ER21 | The worker writes only outbox rows. It changes no `registrations`, `events` or `users` row and sends nothing by itself (the sender does that). | |

Timer (roadmap step 32):

| # | Behaviour | Test first? |
|---|---|---|
| ER22 | `startEmailJobs({ pool, intervalMs, clock, log })` (in `api/src/email/jobs.ts`) returns `{ tick, stop }`. `tick()` runs one round: `enqueueReminders(pool, clock())` then `sendPending(pool, ...)`, in this order. So a reminder that falls into the window is printed in the same round. `tick()` is how tests run one round without waiting. | yes |
| ER23 | A small runner (`api/src/email/runner.ts`, no database) calls its task once at start and then every `intervalMs` (tested with Vitest fake timers). | |
| ER24 | No overlap: if the previous run has not finished when the interval fires, that firing is skipped (the task is not started twice at the same time); the next firing after it finishes runs again. | yes |
| ER25 | An error in the task (a rejected promise) is reported to `onError` (default `console.error`, message only) and the timer keeps going: the next firing runs. A rejected round never causes an unhandled rejection. | yes |
| ER26 | `stop()` clears the timer, starts no new run, and returns a promise that resolves after a run in progress has finished. Calling it twice is fine. | |
| ER27 | The period is `EMAIL_JOB_INTERVAL_MS`, default 10000 (10 s). It is read by `readIntervalMs(env)`: unset or empty gives 10000; a positive integer of at least 1000 is accepted; anything else (text, 0, negative, decimal, under 1000) throws an error that names the variable, so the API stops at start. | |
| ER28 | `createApp()` starts nothing: the timer is started in `api/src/index.ts` only, after `listen`. A test with fake timers that builds the app with a pool wrapper and advances an hour sees no `query` call. On `SIGINT` and `SIGTERM`, `index.ts` stops the jobs (and waits), closes the server and ends the pool. | |

**No HTTP route, no migration, no library.** The roadmap says no new route unless the spec asks for it, and this spec does not: nothing is triggered over HTTP, so `api/openapi.yaml` does not change. `outbox` already has everything the sender and worker need; a partial index on `sent_at IS NULL` is not added (small tables; add it when a measurement says so). `setInterval` from Node is the timer.

**Not in this spec.** Reschedule and event-cancel emails and their rows (M7, B8, B9). The sender sends rows of kind `reschedule` and `event_cancelled` exactly like the others (ER7); it does not write them, skip them or treat them differently. Promotion rows (M4) are the same. Real delivery (SMTP), retries with back-off or a dead-letter state, a failed-count column, an HTTP route to send or list emails, an admin screen, per-user reminder settings, a reminder for waiting people (they get none, `DATABASE.md` decision 6), a second reminder at another time, removing an already queued reminder when the event is rescheduled or cancelled or the person cancels afterwards (the row is an email that is already queued and the sender prints it), the web notes (step 33).

**Assumptions.** Change any of these first in this file.
- A row is "sent" when `log` returned without throwing and the transaction committed. The stub prints before the commit, so a crash between the print and the commit can print a row twice on the next run (at least once). For a console stub this is accepted; with a real transport the claim would need a state column, which is out of scope.
- The sender picks rows in one transaction: `SELECT ... WHERE sent_at IS NULL ORDER BY created_at, id LIMIT $batch FOR UPDATE SKIP LOCKED`, calls `log` per row, then `UPDATE outbox SET sent_at = now() WHERE id = ANY($ids)` for the rows that printed, then COMMIT. `SKIP LOCKED` makes a second sender take other rows or none, never the same row. `sent_at` uses the database clock (`now()`); only the reminder window uses the injected clock.
- A row whose `log` always throws stays unsent and is retried on every round; it is reported each time. With more than `batchSize` such rows they would block newer rows (the oldest are taken first). Accepted for a console stub, where `log` does not fail in practice.
- One reminder per registration per schedule version, so a person who cancels and registers again (a new registration row) can get a new reminder. A checked-in person gets none (ER14); if the event is later rescheduled to a new version (M7) and they are still not checked in again, the rule is the same as for everyone.
- A person who registers inside the 24-hour window gets their ticket email and, at the next round, a reminder too. No special case.
- Time in the body is UTC, like the ticket email. No time-zone handling.
- Tests use a test schema (`createTestDb()` from `api/test/db/helpers.ts`) and insert rows by SQL with the helpers there (`insertEvent` takes `startsAt`, so events are placed relative to the fake clock). The existing `api/test/db/reminder.test.ts` proves the unique key and the `schedule_version` loop with its own copy of the statement; it stays. The new tests call the real `enqueueReminders`. A cleanup of `outbox` rows by a test follows the rule in `checkin.md` (outbox first).
- The default period of 10 s is for a demo; reminders are daily, so any period up to a minute is fine.

## 2. UI decisions

No screen in this spec (API only, no new route). What the web can show about emails (step 33, `email-reminders-web.md`) can use only data that already exists: for example the `ticket` email is written when a person gets a seat (`registration.md`). Nothing here changes a response shape.

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest, `pg`. No new table, no migration, no library, no HTTP route. One new optional env variable, `EMAIL_JOB_INTERVAL_MS`.
- **Files (new folder `api/src/email/`):**
  - `sender.ts`: `formatEmailLine(row)` and `sendPending(pool, options)`; no HTTP, no timer.
  - `reminders.ts`: `enqueueReminders(pool, now)`; no HTTP, no timer.
  - `runner.ts`: `createRunner(task, { intervalMs, onError })` returns `{ stop }`; generic, no database, so the timer behaviour (ER23-ER26) is tested with fake timers and a task the test controls.
  - `jobs.ts`: `readIntervalMs(env)` and `startEmailJobs(options)`; composes the worker, the sender and the runner (ER22, ER27).
- **Sender (ER1-ER8), concurrency:** one transaction on one client: `BEGIN`; `SELECT id, kind, to_email, subject, body FROM outbox WHERE sent_at IS NULL ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`; `log(formatEmailLine(row))` for each row inside `try/catch` (a catch records the id as failed and calls `onError`); `UPDATE outbox SET sent_at = now() WHERE id = ANY($1::uuid[])` for the printed ids; `COMMIT`; on a database error `ROLLBACK`, release the client, rethrow. The row lock is held while printing; the table is small and the printer is the console. Rows locked by another sender are skipped (`SKIP LOCKED`), so each row is printed by one sender only (ER3).
- **Reminder worker (ER9-ER21): one statement, no transaction needed.** `$1` is the injected `now`:
  ```sql
  INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
  SELECT r.id, 'reminder', e.schedule_version, e.starts_at, u.email,
         'Reminder: ' || e.title || ' starts soon',
         e.title || E'\n' || 'Starts: ' || to_char(e.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' (UTC)'
           || E'\n' || 'Ticket code: ' || r.ticket_code
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN users u ON u.id = r.user_id
   WHERE r.status = 'registered' AND r.checked_in_at IS NULL
     AND e.status = 'active'
     AND e.starts_at - interval '24 hours' <= $1::timestamptz
     AND $1::timestamptz < e.starts_at
  ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING;
  ```
  The unique key is the whole "once" rule (`DATABASE.md` 3.2): nothing depends on timing or on a lock in the app. Under READ COMMITTED a parallel second statement waits for the first one's uncommitted rows on the unique index, then does nothing (`reminder.test.ts` already shows this on the schema). `rowCount` is the number inserted. The statement is not limited to one event, so it handles every event in the window in one pass; it reads event columns and `users.email` in the same snapshot. Checked-in people are left out (ER14): a person who has arrived does not need a reminder; the decision is cheap to reverse (drop one condition).
- **Clock:** `enqueueReminders(pool, now: Date)` passes `now` as a parameter; `startEmailJobs` gets `clock: () => Date` (default `() => new Date()`). Neither `sender.ts` nor `reminders.ts` reads the real time for the window (ER17).
- **Timer (ER22-ER28):** `createRunner` calls the task at start, then with `setInterval(intervalMs)`; a `running` promise guards against overlap (a firing while it is set is skipped); the task is wrapped in `try/catch` and `onError` gets the error message (no body, no email address). `stop()` calls `clearInterval` and awaits the running promise. `index.ts` creates the pool with `createPool()` and passes it to `createApp({ pool })` (an existing option) and to `startEmailJobs`, then registers `SIGINT` and `SIGTERM`: `await jobs.stop()`, `server.close()`, `pool.end()`. The runner is not started in `createApp`, so tests of the app and of the routes never start a timer (ER28).
- **Logging:** `console.log` for the email line and `console.error` for failures only. The email line contains the recipient and the body (a ticket code) because the stub prints "the email"; this is the point of the stub and is not a leak.
- **API:** none. No routes are added.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/email/reminders.test.ts` | **Tests first (red), roadmap step 31:** ER11, ER12, ER13, ER15, ER16, ER17, ER18, ER19, ER9 (fields), then ER10, ER14, ER20, ER21. Fake clock = a fixed `Date` passed as `now` (for example one day before the start; events placed with `insertEvent({ startsAt })`). Uses `createTestDb()`; the red run fails because `enqueueReminders` does not exist | ER9-ER21 |
| `api/test/email/sender.test.ts` | **Tests first (red), roadmap step 30:** ER1, ER2, ER3 (5 parallel senders; a held row lock), ER6, then ER4, ER5, ER7, ER8. Collecting `log` function; a failing `log` for ER6 | ER1-ER8 |
| `api/test/email/runner.test.ts` | ER23-ER26 with `vi.useFakeTimers()` and a controllable task (a promise the test resolves); ER27 (`readIntervalMs`) | ER23-ER27 |
| `api/test/email/jobs.test.ts` | ER22 (`tick()` writes the reminder and prints it in one round, in that order) and ER28 (`createApp` with a wrapped pool starts nothing) | ER22, ER28 |
| `api/src/email/sender.ts` | `formatEmailLine`, `sendPending` | ER1-ER8 |
| `api/src/email/reminders.ts` | `enqueueReminders` with the statement above | ER9-ER21 |
| `api/src/email/runner.ts` | `createRunner` | ER23-ER26 |
| `api/src/email/jobs.ts` | `readIntervalMs`, `startEmailJobs` | ER22, ER27 |
| `api/src/index.ts` | Create the pool, pass it to `createApp({ pool })`, call `startEmailJobs` after `listen`, stop everything on `SIGINT` and `SIGTERM` | ER28 |
| `.env.example`, `README.md` | Add `EMAIL_JOB_INTERVAL_MS` (optional, default 10000) to the environment table; add the sender and worker to "Project status" and say that emails are printed to the console | |
| `ROADMAP.md` | Mark steps 29-32 when finished | |

Not touched: `api/src/db/migrations/`, `api/openapi.yaml`, `api/src/app.ts`, `api/src/registrations/`, `api/src/checkin/`, other specs, `web/`.

Tests use the existing style (a pool from `createTestDb()` with its own schema, helpers in `api/test/db/helpers.ts`; no new test library; `vi.useFakeTimers()` is part of Vitest). Parallel cases use `Promise.all` over several calls on the same pool. Order of work (roadmap): sender tests, then sender code (step 30); B5 tests committed red, then the worker, runner, jobs and `index.ts` (steps 31, 32).

## 5. Done means

- Tests, typecheck and linter pass in `api/` (`bash scripts/verify.sh`).
- Every behaviour ER1-ER28 has a test, or a note in the README that says it is not covered. The signal handling in `index.ts` (second half of ER28) is checked by hand and the README says so.
- The tests for ER1-ER3, ER6, ER9, ER11-ER13, ER15-ER19, ER22, ER24 and ER25 (marked "yes") are written and committed before the code that makes them pass, and shown failing for the right reason.
- `api/src/db/migrations/` and `api/openapi.yaml` have no change in the diff.
- Starting the API (`npm run dev` in `api/`) with an unsent outbox row (for example a ticket email) prints one line for it within one period, and prints nothing for it afterwards. Checked by hand once and noted in the README.

## 6. Open questions (answered: D52, all recommendations accepted)

1. **Reminder for a person who already checked in.** ER14 leaves them out. **Recommended: leave them out** (they are at the event; the roadmap line only says "registered person"). To include them, drop `r.checked_in_at IS NULL` from the statement and ER14.
2. **Print before commit (at least once) or mark before print (at most once).** The spec prints inside the transaction (assumption 1), so a crash can print a row twice but never loses an email. **Recommended: keep it**; for a console stub losing nothing is the better side. The alternative (UPDATE ... RETURNING first, print after) never repeats but loses a line if `log` throws.
3. **Period default.** 10 s via `EMAIL_JOB_INTERVAL_MS` (ER27). **Recommended: 10 s**, so a demo shows the ticket email quickly; set it higher in a real deployment.
4. **Reminder text.** "Reminder: {title} starts soon", with the UTC start and the ticket code (ER10). **Recommended: as written**, no "tomorrow" because the window is up to 24 hours before.
5. **Queued reminder after a reschedule or an event cancel.** A reminder row that is already queued but unsent is still printed with its old text (out of scope here). **Recommended: leave for M7**, where B8 and B9 can decide to skip unsent `reminder` rows of an older `schedule_version` or of a cancelled event.
