# Spec: Outbox sender (console stub with retries) and reminder worker (M6, API only)

Feature spec for milestone M6, made from `SPEC_TEMPLATE.md` (sections 1-5). Roadmap steps 29-32 (this spec is step 29); behaviour B5. One small migration (`004_outbox_status.sql`) adds a delivery status to `outbox`; everything else about the table (`kind` CHECK, `sent_at`, `UNIQUE (registration_id, kind, schedule_version)`) stays as in `DATABASE.md` (section 1, 3.2, decisions 5, 6 and 13). Outbox rows of kind `ticket` are already written by `api/src/registrations/service.ts` (`registration.md`); `promotion` rows come with M4. Reschedule and event-cancel emails (rows of kind `reschedule` and `event_cancelled`, B8, B9) are M7 and extend this file later. The UI side (step 33) is `email-reminders-web.md`. Ids are ER1, ER2, ...

**Decisions that shape this version.** D52 (checked-in people get no reminder, send before commit = at least once, period 10 s, reminder text, queued reminders stay for M7) still holds. D57 replaces D53-D55: real email (Resend, `fetch`, transport, mail settings) is out of scope; the sender is a console stub. D56: a failed send is tried at most 3 times in total, then the row gets the status `error_sending` and is never selected again.

## 1. Goals and expected behaviour

**Goal.** Every email that the app decides to send is a row in `outbox`. A sender takes each `pending` row, "sends" it by printing one line with an injectable `log` function (the stub; default `console.log`), and sets `status = 'sent'` and `sent_at`. If `log` throws, the row is tried again on the next timer tick, at most 3 tries in total; after the third failure it becomes `error_sending` and stays out of the queue. A reminder worker writes one `reminder` row for each seated person in the 24 hours before the event, once per schedule version, even if the worker runs many times or in parallel. A timer starts both.

**Delivery guarantee (at least once).** The print cannot be inside the database transaction in a way that makes it undoable: if the line is printed and the process dies before the `COMMIT`, the row is still `pending` and the next run prints it again. The opposite order (mark first, print after) would lose an email when the print fails. D52 answer 2 stands: **a row is never lost; in a rare crash it can be printed twice.** Each row is claimed, "sent" and marked in its own short transaction, so only one email is at risk.

**Failure and retry (D56).**
- A try is one call of `log` for one row. A try fails when `log` throws or its promise rejects.
- `send_attempts` counts failed tries. A failed try does `send_attempts + 1` and stores a short reason in `send_error`. On the third failed try (`send_attempts` reaches 3) the status becomes `error_sending`. Otherwise the row stays `pending`.
- A row that failed in a round is not tried again in the same round (it would only fail again): the retry is on the next timer tick. So the 3 tries take at least two ticks (about 20 s with the 10 s period). No back-off.
- `error_sending` rows are never selected again and are **not retried automatically**. A manual re-queue (a route, a script, a button) is out of scope.
- The reminder worker's unique key still blocks a second reminder for the same person and schedule version, even when the first one is `error_sending` (ER31). A new schedule version (M7) gives a new row, as before.
- **Why the counter survives.** The failed try is not rolled back. The claim transaction holds the row lock; on failure it runs `UPDATE ... SET send_attempts = send_attempts + 1, send_error = ..., status = ...` and **commits**. So the increment is persisted, and because the lock is held until that commit, a parallel sender (which uses `SKIP LOCKED`) can neither pick the row nor count the same try twice. Only a crash or a database error between the print and the commit leaves the count unchanged (that try is not counted, consistent with at least once).

**Behaviours.** Each line is something a test can prove. "Yes" means the test is written and committed before the code (red).

Schema (roadmap step 30; new migration):

| # | Behaviour | Test first? |
|---|---|---|
| ER1 | Migration `004_outbox_status.sql` (in `api/src/db/migrations/`, next after 003) adds to `outbox`: `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','error_sending'))`, `send_attempts integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0)`, `send_error text NULL`, and a named CHECK `outbox_status_sent_at` : `(status = 'sent') = (sent_at IS NOT NULL)`. A schema test proves each: an insert with another status fails; a negative `send_attempts` fails; `status = 'sent'` with `sent_at` NULL fails; `status = 'pending'` or `'error_sending'` with `sent_at` set fails; `error_sending` with `sent_at` NULL is accepted. `UNIQUE (registration_id, kind, schedule_version)` is still there (a second row with the same key fails). `001` to `003` are not edited. | yes |
| ER2 | Backfill: rows that exist before the migration are valid after it. Test: apply `001`-`003` (the temp-directory style of `api/test/db/migrate.test.ts`), insert one row with `sent_at` set and one with `sent_at` NULL, apply `004`; the first has `status = 'sent'`, the second `'pending'`; both have `send_attempts = 0` and `send_error` NULL; the migration does not fail on the new CHECK. | yes |
| ER3 | Rows written by other code get the defaults. A `ticket` row written by `registrations/service.ts` (and any plain SQL insert in tests) has `status = 'pending'`, `send_attempts = 0`, `send_error` NULL and `sent_at` NULL. No change to the registration, cancel or check-in services; their tests pass unchanged. | |

Sender (roadmap step 30). Tests pass a collecting `log`; there is no transport and no network.

| # | Behaviour | Test first? |
|---|---|---|
| ER4 | `sendPending(pool, { batchSize, log, onError })` selects `outbox` rows with `status = 'pending'`, calls `log(formatEmailLine(row))` once per row, and for each row whose call succeeded sets `status = 'sent'` and `sent_at = now()` (database clock) and clears `send_error`. It returns the number of rows sent. A row with another status is never selected, including a `pending`-looking row with a `sent_at` (impossible by ER1). All options are optional; defaults: `batchSize` 20, `log` = `console.log`, `onError` = `console.error`. | yes |
| ER5 | A repeat run sends nothing: after one run, the next runs (10 in a row) call `log` 0 times, return 0 and leave `sent_at` of sent rows unchanged. The same holds for rows in `error_sending` (ER13). | yes |
| ER6 | Two or more senders at the same moment send each row once: with N pending rows, 5 parallel `sendPending` calls call `log` N times in total (each row once, checked by recipient) and every row ends `sent`. Deterministic case: while one sender's `log` call is pending (the test's `log` returns a promise the test controls), a second `sendPending` skips that row (does not wait, does not call `log` for it) and handles the others; during the pending call the row still has `status = 'pending'` and `sent_at` NULL. | yes |
| ER7 | The printed line is a single line (no `\n`) made by a pure function `formatEmailLine(row)`: `[email] <kind> to <to_email> | <subject> | <body>`, where line breaks in the body are replaced by ` / ` (the same line as the first version of this spec, `c36c710`). It holds the kind, the address, the subject and the body, so the draft can be read in the API terminal. `log` is called once per try, before the row's commit (so a throw in `log` is a failed try). Nothing is logged by the sender for a row it does not try. | |
| ER8 | Batch: one call makes at most `batchSize` tries (sent and failed tries both count), oldest first (`created_at`, then `id`). With 5 rows and `batchSize` 2 the first call returns 2 (the 2 oldest), then 2, then 1, then 0. | |
| ER9 | The sender treats every `kind` the same (`ticket`, `promotion`, `reminder`, `reschedule`, `event_cancelled`): one `log` call, status `sent`. It has no code per kind. | |
| ER10 | The sender changes only `outbox.status`, `sent_at`, `send_attempts` and `send_error`. It writes no outbox row and touches no other table or column. A row's `to_email`, `subject`, `body`, `schedule_version`, `event_starts_at` and `created_at` are unchanged. | |

Retry, `error_sending` (roadmap step 30; D56):

| # | Behaviour | Test first? |
|---|---|---|
| ER11 | A failed try: if `log` throws (or rejects) for a row, the row keeps `status = 'pending'` and `sent_at` NULL, `send_attempts` becomes `+1`, `send_error` holds the short reason, the other rows of the batch are still sent, the failure is reported once to `onError` (ER17), and `sendPending` does not throw. The failed row is not tried again inside the same call. The returned count does not include it. | yes |
| ER12 | Retry succeeds: `log` fails for a row on the first two calls and works on the third. After call 1 and call 2 the row is `pending` (`send_attempts` 1, then 2); after call 3 it is `sent` with `sent_at` set, `send_attempts` 2 and `send_error` NULL, and `log` was called 3 times for that row in total. | yes |
| ER13 | Give up after 3 failed tries: `log` always fails for a row. After call 3 the row has `status = 'error_sending'`, `send_attempts` 3, `sent_at` NULL and `send_error` set. Calls 4 to 10 call `log` 0 times for that row (it is never printed again), leave `send_attempts` at 3 and return 0. No call changes the status of an `error_sending` row. | yes |
| ER14 | `send_attempts` is persisted across ticks: read through a second connection right after a failed try, before any later call, it already shows the new value (the increment is committed, not rolled back). With `startEmailJobs(...).tick()` run 3 times and a failing `log`, the row shows 1, 2, 3 after the ticks, and `error_sending` after the third. | yes |
| ER15 | Parallel senders do not double-count: with one pending row and a failing `log`, 5 parallel `sendPending` calls call `log` once in total for it and the row has `send_attempts = 1` (not 5). Deterministic case: while sender A's failing `log` is pending, sender B skips the row; after A's failure, `send_attempts = 1`. | yes |
| ER16 | A failed row does not block newer rows: with the oldest row always failing and 3 newer rows, one `sendPending` call (default `batchSize`) sends the 3 newer rows. With `batchSize` 1 the failing row takes one try per call and holds the head of the queue for at most 3 calls; on call 4 the newer rows are reached (call 4 sends the oldest of them). So the delay of a newer row is bounded by 3 ticks per failing row. | yes |
| ER17 | `onError` gets one message per failed try, shape `email <id> (<kind>) not sent (try <n> of 3): <reason>`, where `<reason>` is the error's `message` cut to 200 characters (`unknown error` if a non-Error was thrown). The message never contains the body or the recipient address (the sender does not add them; the test throws an error whose message is `boom` and checks that neither the body, the subject nor the address appears). `send_error` stores the same `<reason>`, nothing else. A database error (not a failed `log`) is not a failed try: the row's transaction is rolled back, `send_attempts` is unchanged and `sendPending` rejects (the runner reports it, ER35). | |

Reminder worker (roadmap steps 31, 32):

| # | Behaviour | Test first? |
|---|---|---|
| ER18 | (B5) `enqueueReminders(pool, now)` writes one outbox row of kind `reminder` for each person with a `registered` registration, no `checked_in_at`, on an `active` event with `starts_at - 24 hours <= now AND now < starts_at`. The row has `registration_id`, `schedule_version` and `event_starts_at` copied from the event, `to_email` from `users.email` (through `registrations.user_id`), `status = 'pending'` (the default; the statement does not name the new columns), `sent_at` NULL, and a subject and body (ER19). It returns the number of rows inserted. | yes |
| ER19 | Text of the row: subject `Reminder: <title> starts soon`; body has the title, `Starts: <starts_at in UTC> (UTC)` and the `Ticket code: <ticket_code>`, one item per line (the same style as the ticket email). The test checks that title, time and ticket code are in the body. | |
| ER20 | (B5) Run the worker 10 times with the same `now`: the first call returns N (the number of seated people in the window), the other nine return 0, and the outbox has exactly N reminder rows. | yes |
| ER21 | (B5) Two workers at once give one row per person: 2, and also 10, parallel `enqueueReminders` calls (different pool connections) with the same `now` return counts that add up to N, and the outbox has N reminder rows. | yes |
| ER22 | (B5) Only `registered` people: `waitlisted` and `cancelled` registrations get no reminder (`DATABASE.md` decision 6). | yes |
| ER23 | A `registered` person with `checked_in_at` set gets no reminder: they are already there. (A check-in before the window starts is possible, because check-in has no time window, `checkin.md` C11.) | |
| ER24 | (B5) An event with stored `status = 'cancelled'` gets no reminder, even for people left `registered` by SQL in the test (`DATABASE.md` 3.7). | yes |
| ER25 | (B5) Window edges, with the event starting at `S`: `now = S - 24h` gives rows; `now = S - 24h - 1 ms` gives none; `now = S - 1 ms` gives rows; `now = S` gives none; `now = S + 1 h` (event started or passed) gives none; an event 3 days away gives none. | yes |
| ER26 | (B5) The clock is injected: the SQL gets `now` as a parameter (`$1::timestamptz`) and the worker never calls `Date.now()` or SQL `now()` for the window. A test with `now` in the year 2030 and events at 2030 dates gives rows, with the real clock far away. | yes |
| ER27 | (B5) Version and time come from the event in the same statement: `enqueueReminders` runs exactly one `INSERT ... SELECT ... ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING` per call (the test counts the `query` calls on a wrapped pool: one). No read-then-insert in the app, no JS loop over people. | yes |
| ER28 | (B5) Reschedule loop: with a direct `UPDATE` (`starts_at` and `schedule_version + 1`, as `DATABASE.md` 3.6 does in M7) A -> B -> A -> B and `now` moved into each window, every move gives one fresh reminder per person (versions 1, 2, 3, 4), and a repeat in the same version gives none. The old rows stay. | yes |
| ER29 | A person who registers after the first run, still inside the window, gets their reminder on the next run; the people who already have one get no second row. Several events in the window each get their rows; an event outside the window gets none. | |
| ER30 | The worker writes only outbox rows. It changes no `registrations`, `events` or `users` row and prints nothing by itself (the sender does that). | |
| ER31 | (B5) `error_sending` does not open the door to a second reminder: after a reminder row for a person and version has been set to `error_sending`, `enqueueReminders` with the same `now` returns 0 for that person and the outbox still has one `reminder` row for them; the row stays `error_sending`. | yes |

Timer (roadmap step 32):

| # | Behaviour | Test first? |
|---|---|---|
| ER32 | `startEmailJobs({ pool, intervalMs, clock, log, onError })` (in `api/src/email/jobs.ts`) returns `{ tick, stop }`. `tick()` runs one round: `enqueueReminders(pool, clock())` then `sendPending(pool, { log, onError, ... })`, in this order. So a reminder that falls into the window is printed (to the test's `log`) in the same round. `tick()` is how tests run one round without waiting. | yes |
| ER33 | A small runner (`api/src/email/runner.ts`, no database) calls its task once at start and then every `intervalMs` (tested with Vitest fake timers). | |
| ER34 | No overlap: if the previous run has not finished when the interval fires, that firing is skipped (the task is not started twice at the same time); the next firing after it finishes runs again. | yes |
| ER35 | An error in the task (a rejected promise) is reported to `onError` (default `console.error`, message only) and the timer keeps going: the next firing runs. A rejected round never causes an unhandled rejection. | yes |
| ER36 | `stop()` clears the timer, starts no new run, and returns a promise that resolves after a run in progress has finished. Calling it twice is fine. | |
| ER37 | The period is `EMAIL_JOB_INTERVAL_MS`, default 10000 (10 s). It is read by `readIntervalMs(env)`: unset or empty gives 10000; a positive integer of at least 1000 is accepted; anything else (text, 0, negative, decimal, under 1000) throws an error that names the variable, so the API stops at start. | |
| ER38 | `createApp()` starts nothing: the timer is started in `api/src/index.ts` only, after `listen`. A test with fake timers that builds the app with a pool wrapper and advances an hour sees no `query` call. In `index.ts`, before `listen`, `readIntervalMs(process.env)` runs; if it throws, `index.ts` prints the message (variable name only), exits with code 1 and does not listen. On `SIGINT` and `SIGTERM`, `index.ts` stops the jobs (and waits), closes the server and ends the pool. The exit and the signals are checked by hand (Done means). | |

**No HTTP route, no library.** Nothing is triggered over HTTP, so `api/openapi.yaml` does not change. A partial index on `status = 'pending'` is not added (small tables; add it when a measurement says so). `setInterval` from Node is the timer.

**Not in this spec.** Real email: sending through a provider (Resend or another), an HTTP client or transport, mail settings (`EMAIL_API_KEY`, `MAIL_FROM`, `EMAIL_API_URL`), a fake mail server, failing at start for missing settings. This is a later option; the sender is built so that only the `log` call would be replaced by a send (a transport can be added then, with its own spec). Also out: reschedule and event-cancel emails and their rows (M7, B8, B9; the sender sends such rows exactly like the others, ER9); promotion rows (M4); HTML emails, bounce handling, unsubscribe links, delivery webhooks, back-off between tries, a configurable retry count, a manual or automatic re-queue of `error_sending` rows (and any route, screen or script that lists them), other providers, per-user reminder settings, a reminder for waiting people (`DATABASE.md` decision 6), a second reminder at another time, removing an already queued reminder when the event is rescheduled or cancelled or the person cancels afterwards (the row is an email that is already queued and the sender prints it), the web notes (step 33).

**Assumptions.** Change any of these first in this file.
- A row is "sent" when `log` returned (or its promise resolved) and the row's transaction committed. At least once, as described above.
- The sender claims one row at a time in its own transaction, on one pool client: `BEGIN`; `SELECT id, kind, to_email, subject, body FROM outbox WHERE status = 'pending' AND id <> ALL($1::uuid[]) ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED` (`$1` = ids that already failed in this call); `log(...)`; then on success `UPDATE outbox SET status = 'sent', sent_at = now(), send_error = NULL WHERE id = $2`, on failure `UPDATE outbox SET send_attempts = send_attempts + 1, send_error = $3, status = CASE WHEN send_attempts + 1 >= 3 THEN 'error_sending' ELSE 'pending' END WHERE id = $2`; `COMMIT` in both cases; repeat up to `batchSize` tries. If a database statement fails: `ROLLBACK`, release the client, rethrow. `onError` is called after the commit. `SKIP LOCKED` makes a second sender take other rows or none, never the same row. `sent_at` uses the database clock; only the reminder window uses the injected clock. The limit 3 is one constant (`MAX_SEND_ATTEMPTS`), not an option or a setting.
- `send_attempts` means failed tries. A row that was sent after two failures has `send_attempts = 2`. Rows backfilled as `sent` keep 0.
- `send_error` is an optional column, the reason of the last failed try: a short message only (at most 200 characters), never the body or the address. Why a column at all: without it the only trace of why a row is `error_sending` is a console line that is gone after a restart, and a later step (manual re-queue, an admin view) needs to tell the rows apart. It is NULL for rows that never failed and is cleared when a retry succeeds. It is written only by the sender.
- A row that always fails now leaves the queue after 3 ticks (about 20 s with the 10 s period), so it can delay newer rows by at most 3 ticks (ER16). The stub's `log` rarely fails, so this is mostly a safety net and the shape for a future real transport.
- One reminder per registration per schedule version, so a person who cancels and registers again (a new registration row) can get a new reminder. A checked-in person gets none (ER23).
- A person who registers inside the 24-hour window gets their ticket email and, at the next round, a reminder too. No special case.
- Time in the body is UTC, like the ticket email. No time-zone handling.
- The email address is personal data: it appears in the printed line (ER7), as before with the stub. It does not appear in `onError` messages or in `send_error` (ER17).
- Tests use a test schema (`createTestDb()` from `api/test/db/helpers.ts`) and insert rows by SQL with the helpers there (`insertEvent` takes `startsAt`, so events are placed relative to the fake clock). The existing `api/test/db/reminder.test.ts` proves the unique key and the `schedule_version` loop with its own copy of the statement; it stays. The new tests call the real `enqueueReminders`. A cleanup of `outbox` rows by a test follows the rule in `checkin.md` (outbox first). No test needs environment settings.
- The default period of 10 s is for a demo; reminders are daily, so any period up to a minute is fine.

## 2. UI decisions

No screen in this spec (API only, no new route). What the web can show about emails (step 33, `email-reminders-web.md`) can use only data that already exists. Nothing here changes a response shape: `status`, `send_attempts` and `send_error` are not returned by any route. The web must not say that an email "arrived": the stub only prints a line.

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest, `pg`. One migration, no library, no HTTP route. One optional env variable: `EMAIL_JOB_INTERVAL_MS`.
- **Migration `004_outbox_status.sql`** (next number after `003_event_description.sql`; same style as `002` and `003`: a header comment that names this spec and `DATABASE.md`, `001` to `003` are not edited):
  ```sql
  ALTER TABLE outbox
    ADD COLUMN status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','sent','error_sending')),
    ADD COLUMN send_attempts integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
    ADD COLUMN send_error text;
  UPDATE outbox SET status = 'sent' WHERE sent_at IS NOT NULL;
  ALTER TABLE outbox
    ADD CONSTRAINT outbox_status_sent_at CHECK ((status = 'sent') = (sent_at IS NOT NULL));
  ```
  The backfill runs before the consistency CHECK is added, so existing rows pass it. The CHECK on `status` and the one between `status` and `sent_at` are the whole schema guarantee; `3 tries` is app logic, not schema (no CHECK on `send_attempts` against 3). The unique key is untouched. `sent_at` stays: it records when, `status` records what.
- **Rows written by other code:** `registrations/service.ts` (and the cancel and promote code) insert `outbox` rows with named columns and none of the new ones, so they get `pending`, 0, NULL by the defaults. No change there (ER3).
- **Files (new folder `api/src/email/`):**
  - `sender.ts`: `formatEmailLine(row)`, `MAX_SEND_ATTEMPTS = 3` and `sendPending(pool, options)`; no timer, no HTTP.
  - `reminders.ts`: `enqueueReminders(pool, now)`; no timer.
  - `runner.ts`: `createRunner(task, { intervalMs, onError })` returns `{ stop }`; generic, no database, so the timer behaviour (ER33-ER36) is tested with fake timers and a task the test controls.
  - `jobs.ts`: `readIntervalMs(env)` and `startEmailJobs(options)`; composes the worker, the sender and the runner (ER32, ER37).
- **Sender (ER4-ER17), concurrency and delivery:** as in the Assumptions. One transaction per row. `log` is awaited, so a test can hold a try open with a promise. The same client does the claim, the `log` and the final `UPDATE`, which is why the failure counter is committed with the lock still held (no lost increment, no double count). The failed ids list keeps a row out of the rest of the call. A pool client is used for one row at a time, so `batchSize` never needs more than one connection per sender. `log` is synchronous and fast by default, so holding the lock around it is cheap.
- **Reminder worker (ER18-ER31): one statement, no transaction needed.** `$1` is the injected `now`:
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
  The unique key is the whole "once" rule (`DATABASE.md` 3.2): it counts rows of every status, so an `error_sending` or `sent` reminder blocks a new one for the same person and version (ER31). Nothing depends on timing or on a lock in the app. Under READ COMMITTED a parallel second statement waits for the first one's uncommitted rows on the unique index, then does nothing. `rowCount` is the number inserted. The statement is not limited to one event, so it handles every event in the window in one pass. Checked-in people are left out (ER23).
- **Clock:** `enqueueReminders(pool, now: Date)` passes `now` as a parameter; `startEmailJobs` gets `clock: () => Date` (default `() => new Date()`). Neither `sender.ts` nor `reminders.ts` reads the real time for the window (ER26).
- **Timer and start-up (ER32-ER38):** `createRunner` calls the task at start, then with `setInterval(intervalMs)`; a `running` promise guards against overlap (a firing while it is set is skipped); the task is wrapped in `try/catch` and `onError` gets the error message. `stop()` calls `clearInterval` and awaits the running promise. `index.ts` first calls `readIntervalMs(process.env)` in a `try/catch` (print the message, `process.exit(1)`), creates the pool with `createPool()`, passes it to `createApp({ pool })` (an existing option), calls `listen`, then `startEmailJobs`, and registers `SIGINT` and `SIGTERM`: `await jobs.stop()`, `server.close()`, `pool.end()`. The runner is not started in `createApp`, so tests of the app and of the routes never start a timer.
- **Logging:** the sender's `log` (default `console.log`) prints the `[email] ...` line (ER7); `onError` (default `console.error`) is for failed tries and round errors only. No body.
- **API:** none. No routes are added.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/db/outboxStatus.test.ts` | **Tests first (red):** the constraints of the migration (bad status, negative attempts, `sent` without `sent_at`, `pending` or `error_sending` with `sent_at`, `error_sending` without `sent_at` accepted, unique key still enforced), the backfill (apply `001`-`003` in a temp directory, insert a sent and an unsent row, apply `004`), defaults of a plain insert and of a `ticket` row made by the registration service | ER1-ER3 |
| `api/test/db/migrate.test.ts` | Existing test: add `004_outbox_status.sql` to the `ALL` list and update the case that expects `["003_event_description.sql"]` to be the only file left to apply (it becomes `004`, and the temp-directory case that applies `001`-`002` first now applies `003`-`004` in the second run). Minimal edit, same style | ER1 |
| `api/test/email/sender.test.ts` | **Tests first (red), roadmap step 30:** ER4, ER5, ER6 (5 parallel senders; a pending `log`), ER11, ER12, ER13, ER14, ER15, ER16, then ER7, ER8, ER9, ER10, ER17. `log` = a collecting function; a throwing one for the failure cases (fails twice then works; always fails). A second connection from the test pool reads `send_attempts` for ER14 | ER4-ER17 |
| `api/test/email/reminders.test.ts` | **Tests first (red), roadmap step 31:** ER20, ER21, ER22, ER24, ER25, ER26, ER27, ER28, ER31, ER18 (fields), then ER19, ER23, ER29, ER30. Fake clock = a fixed `Date` passed as `now` (for example one day before the start; events placed with `insertEvent({ startsAt })`). Uses `createTestDb()`; the red run fails because `enqueueReminders` does not exist | ER18-ER31 |
| `api/test/email/runner.test.ts` | ER33-ER36 with `vi.useFakeTimers()` and a controllable task (a promise the test resolves); ER37 (`readIntervalMs`) | ER33-ER37 |
| `api/test/email/jobs.test.ts` | ER32 (`tick()` writes the reminder and prints it through the test's `log` in one round, in that order; also 3 ticks with a failing `log`, ER14) and ER38 (`createApp` with a wrapped pool starts nothing and calls no `query`) | ER14, ER32, ER38 |
| `api/src/db/migrations/004_outbox_status.sql` | The migration above | ER1-ER3 |
| `api/src/email/sender.ts` | `formatEmailLine`, `MAX_SEND_ATTEMPTS`, `sendPending` | ER4-ER17 |
| `api/src/email/reminders.ts` | `enqueueReminders` with the statement above | ER18-ER31 |
| `api/src/email/runner.ts` | `createRunner` | ER33-ER36 |
| `api/src/email/jobs.ts` | `readIntervalMs`, `startEmailJobs` | ER32, ER37 |
| `api/src/index.ts` | Read the period before `listen` (exit 1 with a clear message if it fails), create the pool, pass it to `createApp({ pool })`, call `startEmailJobs` after `listen`, stop everything on `SIGINT` and `SIGTERM` | ER38 |
| `.env.example` | Add `EMAIL_JOB_INTERVAL_MS` (optional, commented out, default 10000). No mail variables | ER37 |
| `README.md` | Environment table: `EMAIL_JOB_INTERVAL_MS`. "Project status": the sender (console stub with 3 tries, then `error_sending`) and the reminder worker; real sending is a later option. Mention migration `004` (run `npm run migrate` or the project's migrate command). Note the hand checks | |
| `ROADMAP.md` | Mark steps 29-32 when finished; keep step 30 as "prints pending outbox rows, retries a failed one twice, then `error_sending`" | |
| `docs/DATABASE.md` | (Written by the code-writer in the same step as the migration, not by the spec-writer.) In the `outbox` section: change the heading to say the sender prints the row, sets `status = 'sent'` and `sent_at`, and gives up after 3 failed tries with `error_sending`; add table rows for `status` (`pending`, `sent`, `error_sending`, default `pending`), `send_attempts` (failed tries, default 0) and `send_error` (short reason of the last failed try, no body or address); add the constraints (`status` CHECK, `(status = 'sent') = (sent_at IS NOT NULL)`, the unique key unchanged); add decision 19 "Outbox delivery status: a row is tried at most 3 times, then `error_sending`; not retried automatically; added by migration `004_outbox_status.sql`, not by editing `001`" (same style as decisions 17 and 18); add `outbox` status to the behaviour map under B5 only as a note that the unique key counts rows of every status. Section 5 ("no real email delivery") stays true | ER1 |

Not touched: `api/openapi.yaml`, `api/src/app.ts`, `api/src/registrations/`, `api/src/checkin/`, `api/src/db/migrations/001`-`003`, other specs, `web/`. No new package in `api/package.json`.

Tests use the existing style (a pool from `createTestDb()` with its own schema, helpers in `api/test/db/helpers.ts`; no new test library; `vi.useFakeTimers()` is part of Vitest). Parallel cases use `Promise.all` over several calls on the same pool. Order of work (roadmap): migration test, migration (the schema is needed by everything else), then sender tests and sender code (step 30); B5 tests committed red, then the worker, runner, jobs and `index.ts` (steps 31, 32).

## 5. Done means

- Tests, typecheck and linter pass in `api/` (`bash scripts/verify.sh`).
- Every behaviour ER1-ER38 has a test, or a note in the README that says it is not covered. The start-up exit and the signal handling in `index.ts` (second and third part of ER38) are checked by hand and the README says so.
- The tests marked "yes" (ER1, ER2, ER4, ER5, ER6, ER11-ER16, ER18, ER20-ER22, ER24-ER28, ER31, ER32, ER34, ER35) are written and committed before the code that makes them pass, and shown failing for the right reason.
- `api/openapi.yaml` has no change in the diff, `api/package.json` has no new dependency, and the only migration in the diff is the new `004_outbox_status.sql`. The registration, cancel and check-in tests pass unchanged (ER3).
- `docs/DATABASE.md` is updated as described in section 4, in the same step as the migration.
- The whole `api` test run passes with no environment settings except `DATABASE_URL`.
- By hand, once, noted in the README: (a) `npm run dev` in `api/` with `EMAIL_JOB_INTERVAL_MS=abc` prints a message that names the variable and exits without listening; (b) after a registration, the console shows one `[email] ticket to ...` line within one period and nothing more for that row afterwards; the row has `status = 'sent'` in `psql`.

## 6. Open questions

D52 answers 1-5 and D56, D57 are settled and not asked again. Questions that are left (each has a recommendation; if you do not answer, the recommendation is used):

1. **`send_error` column.** The spec adds it (ER1, ER11, ER17). **Recommended: keep it**, a short reason of the last failed try, so an `error_sending` row can be understood after the console is gone. If you want the smallest migration, drop the column and ER17's second half; nothing else changes.
2. **Printed line format.** Settled: ER7 uses the line of `c36c710` (kind, address, subject and body on one line).
3. **Pending rows that are never printed after a crash loop.** A row whose print fails because of a database error (not `log`) is not counted as a try (ER17). **Recommended: keep**; only a failing `log` gives up, and the runner reports database errors each round.
