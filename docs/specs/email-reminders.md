# Spec: Outbox sender (real email) and reminder worker (M6, API only)

Feature spec for milestone M6, made from `SPEC_TEMPLATE.md` (sections 1-5). Roadmap steps 29-32 (this spec is step 29); behaviour B5. No new table, no new column and no migration: the `outbox` table, its `kind` CHECK (`reminder` is allowed), `sent_at` and `UNIQUE (registration_id, kind, schedule_version)` are in `DATABASE.md` (section 1, 3.2, decisions 5, 6 and 13), which this file does not change. Outbox rows of kind `ticket` are already written by `api/src/registrations/service.ts` (`registration.md`); `promotion` rows come with M4. Reschedule and event-cancel emails (rows of kind `reschedule` and `event_cancelled`, B8, B9) are M7 and extend this file later. The UI side (step 33) is `email-reminders-web.md`. Ids are ER1, ER2, ...

**Decisions that shape this version.** D52 (answers to the first open questions: checked-in people get no reminder, send before commit = at least once, period 10 s, reminder text, queued reminders stay for M7) all still hold. D53: emails are really sent, to `outbox.to_email`, through an HTTP email API called with the built-in `fetch`, no new library. D54: the API refuses to start without the mail settings; there is no console fallback in the running API.

## 1. Goals and expected behaviour

**Goal.** Every email that the app decides to send is a row in `outbox`. A sender takes each unsent row, sends it to the address in `to_email` through an `EmailTransport` and then sets `sent_at`. A reminder worker writes one `reminder` row for each seated person in the 24 hours before the event, once per schedule version, even if the worker runs many times or in parallel. A timer starts both. Resend (`POST https://api.resend.com/emails`) is the concrete provider, but it sits behind one small function type so tests inject a fake and the provider can change.

**Delivery guarantee (at least once).** A send over HTTP cannot be inside the database transaction: if the provider accepts the email and the process dies before the `COMMIT`, the row is still unsent and the next run sends it again. The opposite order (mark first, send after) would lose an email when the send fails. The spec keeps D52 answer 2 and chooses at least once: **a row is never lost; in a rare crash it can be sent twice.** To keep that window as small as possible, each row is claimed, sent and marked in its own short transaction (one email at risk, not a whole batch). A failed send leaves `sent_at` NULL and the row is tried again on the next round.

**Behaviours.** Each line is something a test can prove. "Yes" means the test is written and committed before the code (red).

Sender (roadmap step 30). Tests inject a fake `EmailTransport`; no test sends real email (ER33).

| # | Behaviour | Test first? |
|---|---|---|
| ER1 | `sendPending(pool, { transport, batchSize, log, onError })` selects `outbox` rows with `sent_at IS NULL`, calls `transport({ to: to_email, subject, text: body })` once per row, and sets `sent_at` on exactly the rows whose call resolved. It returns the number of rows sent. A row that was already sent is not selected. `transport` is required (no default). | yes |
| ER2 | A repeat run sends nothing: after one run, the next runs (10 in a row) call `transport` 0 times, return 0 and leave `sent_at` of sent rows unchanged. | yes |
| ER3 | Two or more senders at the same moment send each row once: with N unsent rows, 5 parallel `sendPending` calls call `transport` N times in total (each row once, checked by recipient) and every row has `sent_at` set. Deterministic case: while one sender's `transport` call is pending (the fake waits on a promise the test controls), a second `sendPending` skips that row (does not wait, does not call `transport` for it) and sends the others; during the pending call the row still has `sent_at` NULL. | yes |
| ER4 | The log line is a single line (no `\n`) made by a pure function `formatSentLine(row)`: `[email] sent <kind> to <to_email>`. It has no subject and no body (no ticket code in the logs). `sendPending` calls `log` once per sent row, after the row's commit; nothing is logged for a failed row. The default `log` is `console.log`; tests pass a collecting function. | |
| ER5 | Batch: one call makes at most `batchSize` send attempts (default 20; sent and failed attempts both count), oldest first (`created_at`, then `id`). With 5 rows and `batchSize` 2 the first call returns 2 (the 2 oldest), then 2, then 1, then 0. | |
| ER6 | If `transport` rejects for a row, that row keeps `sent_at` NULL, the other rows of the batch are still sent and marked, the error is reported to `onError` (default `console.error`, message only, ER34), and `sendPending` does not throw. The failed row is not tried again inside the same call (it would only fail again) but is tried on the next call. The count returned does not include the failed row. | yes |
| ER7 | The sender treats every `kind` the same (`ticket`, `promotion`, `reminder`, `reschedule`, `event_cancelled`): one transport call, `sent_at` set. It has no code per kind. | |
| ER8 | The sender changes only `outbox.sent_at`. It writes no outbox row and touches no other table or column. A sent row's `to_email`, `subject`, `body`, `schedule_version` and `event_starts_at` are unchanged. The transport receives only `to`, `subject` and `text` (no ids). | |

Mail settings, transport and error path (roadmap step 30; new in this version):

| # | Behaviour | Test first? |
|---|---|---|
| ER29 | `readMailConfig(env)` (in `api/src/email/config.ts`) returns `{ apiKey, from, apiUrl }` from `EMAIL_API_KEY`, `MAIL_FROM` and optional `EMAIL_API_URL`. Values are trimmed. `EMAIL_API_KEY` or `MAIL_FROM` unset or blank throws an error that names the variable and does not contain any key value. `EMAIL_API_URL` unset or blank gives `https://api.resend.com/emails`; if set it must be a valid `http:` or `https:` URL, otherwise it throws and names the variable. `createApp` and the tests never read these variables. | yes |
| ER30 | `createResendTransport({ apiKey, from, apiUrl, timeoutMs })` (in `api/src/email/transport.ts`; `apiUrl` required, `timeoutMs` default 10000) returns an `EmailTransport`. A call sends one `POST` to `apiUrl` with headers `Authorization: Bearer <apiKey>` and `Content-Type: application/json`, and a JSON body that is exactly `{ "from": <from>, "to": <to>, "subject": <subject>, "text": <text> }` (`to` is a string). A 2xx answer resolves. Tested against a local fake HTTP server (`node:http` on `127.0.0.1`, port 0) that records the request: method, path, the two headers and the parsed body. | yes |
| ER31 | The transport rejects (throws) when the call fails: a non-2xx status (for example 400, 422, 429, 500), a network error (connection refused, connection closed with no answer) and a timeout (the fake server never answers, `timeoutMs` set small in the test; the call is stopped with `AbortSignal.timeout`). The error message names the cause (the status code, `network error`, `timeout`) and never contains the API key, the recipient address, the subject or the body. | yes |
| ER32 | Error path with the real transport against the fake server: when the server answers 500, when the connection is refused, and when it never answers (small `timeoutMs`), `sendPending` leaves `sent_at` NULL, reports the failure once to `onError`, does not throw and returns 0. After the server is fixed, the next `sendPending` sends the row and sets `sent_at` (retry on the next round). | yes |
| ER33 | Tests never send real email. `sendPending`, `startEmailJobs` and `createResendTransport` have no built-in destination: the transport is a required option and `apiUrl` is a required argument (the Resend URL lives only in `readMailConfig`). In `sender`, `reminders`, `runner`, `jobs` and app tests, `fetch` is replaced (`vi.stubGlobal`) by a function that fails the test if it is called; the transport tests use only the local fake server and assert that the request host is `127.0.0.1`. No test reads `EMAIL_API_KEY` or `MAIL_FROM` from the real environment. | |
| ER34 | Error and log messages made by the email code (transport errors, `onError`, `formatSentLine`) never contain `EMAIL_API_KEY`, the subject or the body, and `onError` messages do not contain the recipient address. A failure message has the shape `email <id> (<kind>) not sent: <cause>`. Tested with a key and a body that have a recognisable text and a check that neither appears in any collected message. | |

Reminder worker (roadmap steps 31, 32; unchanged by D53):

| # | Behaviour | Test first? |
|---|---|---|
| ER9 | (B5) `enqueueReminders(pool, now)` writes one outbox row of kind `reminder` for each person with a `registered` registration, no `checked_in_at`, on an `active` event with `starts_at - 24 hours <= now AND now < starts_at`. The row has `registration_id`, `schedule_version` and `event_starts_at` copied from the event, `to_email` from `users.email` (through `registrations.user_id`), `sent_at` NULL, and a subject and body (ER10). It returns the number of rows inserted. | yes |
| ER10 | Text of the row: subject `Reminder: <title> starts soon`; body has the title, `Starts: <starts_at in UTC> (UTC)` and the `Ticket code: <ticket_code>`, one item per line (the same style as the ticket email). The body is plain text and is sent as `text`. The test checks that title, time and ticket code are in the body. | |
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
| ER22 | `startEmailJobs({ pool, transport, intervalMs, clock, log, onError })` (in `api/src/email/jobs.ts`) returns `{ tick, stop }`. `tick()` runs one round: `enqueueReminders(pool, clock())` then `sendPending(pool, { transport, ... })`, in this order. So a reminder that falls into the window is sent (to the fake transport) in the same round. `tick()` is how tests run one round without waiting. `transport` is required. | yes |
| ER23 | A small runner (`api/src/email/runner.ts`, no database) calls its task once at start and then every `intervalMs` (tested with Vitest fake timers). | |
| ER24 | No overlap: if the previous run has not finished when the interval fires, that firing is skipped (the task is not started twice at the same time); the next firing after it finishes runs again. A slow send (up to the 10 s timeout per email) therefore delays the next round and never starts a second one. | yes |
| ER25 | An error in the task (a rejected promise) is reported to `onError` (default `console.error`, message only) and the timer keeps going: the next firing runs. A rejected round never causes an unhandled rejection. | yes |
| ER26 | `stop()` clears the timer, starts no new run, and returns a promise that resolves after a run in progress has finished. Calling it twice is fine. | |
| ER27 | The period is `EMAIL_JOB_INTERVAL_MS`, default 10000 (10 s). It is read by `readIntervalMs(env)`: unset or empty gives 10000; a positive integer of at least 1000 is accepted; anything else (text, 0, negative, decimal, under 1000) throws an error that names the variable, so the API stops at start. | |
| ER28 | `createApp()` starts nothing and needs no mail settings: the timer is started in `api/src/index.ts` only, after `listen`. A test with fake timers that builds the app with a pool wrapper and advances an hour sees no `query` call and no `fetch` call. In `index.ts`, before `listen`, `readMailConfig(process.env)` and `readIntervalMs(process.env)` run; if either throws, `index.ts` prints the message (variable name only, never a value), exits with code 1 and does not listen (D54). On `SIGINT` and `SIGTERM`, `index.ts` stops the jobs (and waits), closes the server and ends the pool. The exit and the signals are checked by hand (Done means). | |

**No HTTP route, no migration, no library.** The roadmap says no new route unless the spec asks for it, and this spec does not: nothing is triggered over HTTP, so `api/openapi.yaml` does not change. `outbox` already has everything the sender and worker need; a partial index on `sent_at IS NULL` is not added (small tables; add it when a measurement says so). `setInterval` from Node is the timer and the global `fetch` is the HTTP client.

**Not in this spec.** Reschedule and event-cancel emails and their rows (M7, B8, B9). The sender sends rows of kind `reschedule` and `event_cancelled` exactly like the others (ER7); it does not write them, skip them or treat them differently. Promotion rows (M4) are the same. HTML emails, bounce handling, unsubscribe links, delivery-status webhooks, sender-domain setup, retries with back-off, a failed-count column or dead-letter state (see open question 1), other providers, an HTTP route to send or list emails, an admin screen, per-user reminder settings, a reminder for waiting people (they get none, `DATABASE.md` decision 6), a second reminder at another time, removing an already queued reminder when the event is rescheduled or cancelled or the person cancels afterwards (the row is an email that is already queued and the sender sends it), the web notes (step 33).

**Assumptions.** Change any of these first in this file.
- A row is "sent" when `transport` resolved (the provider answered 2xx) and the row's transaction committed. At least once, as described above: a crash or a database error between the provider's 2xx and the `COMMIT` sends that one row again on the next round. Accepted; open question 2 can narrow it further.
- The sender claims one row at a time in its own transaction: `BEGIN`; `SELECT id, kind, to_email, subject, body FROM outbox WHERE sent_at IS NULL AND id <> ALL($1::uuid[]) ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED` (`$1` = ids that already failed in this call); `transport(...)`; `UPDATE outbox SET sent_at = now() WHERE id = $2`; `COMMIT`; repeat up to `batchSize` attempts. `SKIP LOCKED` makes a second sender take other rows or none, never the same row. `sent_at` uses the database clock (`now()`); only the reminder window uses the injected clock.
- The row lock and one pool connection are held while the HTTP call runs (at most `timeoutMs` = 10 s per email). With `batchSize` 20 and a provider that hangs on every call, one round can take up to 200 s and holds one connection; the runner skips overlapping firings (ER24), and other senders skip locked rows. Accepted for a small system; a smaller batch is the first thing to change if it hurts.
- A row whose send always fails (for example the provider refuses the address) stays unsent, is retried on every round and is reported each time. With `batchSize` or more such rows at the head of the queue they block newer rows (oldest first, failed attempts count in the batch). There is no per-row attempt counter because that needs a migration; see open question 1.
- Resend's free test sender (`onboarding@resend.dev`) delivers only to the address of the account owner until a domain is verified. With it, emails to any other attendee fail with a 4xx and stay unsent (previous assumption). This is a README note for the demo (use the owner's address for test accounts, or verify a domain and set `MAIL_FROM`), not a behaviour of the code. Resend also limits the request rate (a few requests per second by default); a 429 is an ordinary failure and the row goes out on the next round.
- `to` is one address per email (`outbox.to_email`). `from` is `MAIL_FROM` as given (for example `Events <onboarding@resend.dev>`); the code does not check its format.
- One reminder per registration per schedule version, so a person who cancels and registers again (a new registration row) can get a new reminder. A checked-in person gets none (ER14); if the event is later rescheduled to a new version (M7) and they are still not checked in again, the rule is the same as for everyone.
- A person who registers inside the 24-hour window gets their ticket email and, at the next round, a reminder too. No special case.
- Time in the body is UTC, like the ticket email. No time-zone handling.
- The email address is personal data: it is sent to the provider (the point of the feature) and appears in the `[email] sent` log line (ER4). It does not appear in error messages (ER34). The API key is never logged.
- Tests use a test schema (`createTestDb()` from `api/test/db/helpers.ts`) and insert rows by SQL with the helpers there (`insertEvent` takes `startsAt`, so events are placed relative to the fake clock). The existing `api/test/db/reminder.test.ts` proves the unique key and the `schedule_version` loop with its own copy of the statement; it stays. The new tests call the real `enqueueReminders`. A cleanup of `outbox` rows by a test follows the rule in `checkin.md` (outbox first).
- The default period of 10 s is for a demo; reminders are daily, so any period up to a minute is fine.

## 2. UI decisions

No screen in this spec (API only, no new route). What the web can show about emails (step 33, `email-reminders-web.md`) can use only data that already exists: for example the `ticket` email is written when a person gets a seat (`registration.md`). Nothing here changes a response shape. The web must not say that an email "arrived": the API only knows that the provider accepted it.

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest, `pg`. No new table, no migration, no library, no HTTP route. New env variables: `EMAIL_API_KEY` and `MAIL_FROM` (both required to start the API), `EMAIL_API_URL` (optional, default the Resend URL; lets a test or a local fake server stand in for the provider), and the optional `EMAIL_JOB_INTERVAL_MS`.
- **Files (new folder `api/src/email/`):**
  - `transport.ts`: `type EmailMessage = { to: string; subject: string; text: string }`, `type EmailTransport = (message: EmailMessage) => Promise<void>` and `createResendTransport(options)`. The only file that knows Resend and `fetch`.
  - `config.ts`: `readMailConfig(env)` (ER29).
  - `sender.ts`: `formatSentLine(row)` and `sendPending(pool, options)`; takes an `EmailTransport`, knows nothing about HTTP or Resend; no timer.
  - `reminders.ts`: `enqueueReminders(pool, now)`; no HTTP, no timer.
  - `runner.ts`: `createRunner(task, { intervalMs, onError })` returns `{ stop }`; generic, no database, so the timer behaviour (ER23-ER26) is tested with fake timers and a task the test controls.
  - `jobs.ts`: `readIntervalMs(env)` and `startEmailJobs(options)`; composes the worker, the sender and the runner (ER22, ER27).
- **Transport (ER30, ER31):** `fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify({ from, to, subject, text }), signal: AbortSignal.timeout(timeoutMs) })`. A rejected `fetch` becomes `network error` (the original error is not copied into the message, because some Node errors carry the URL), an abort/timeout becomes `timeout`, `!res.ok` becomes `status <code>`. The response body is not read into the message (it may echo the address). On success the body is drained or ignored. No redirect handling beyond the default of `fetch`.
- **Sender (ER1-ER8, ER32), concurrency and delivery:** per row, one transaction on one client, as in the Assumptions. If `transport` rejects: `ROLLBACK` (nothing was changed, the lock is released), remember the id in the failed list, call `onError`, continue with the next row. If a database statement fails: `ROLLBACK`, release the client, rethrow (the runner reports it, ER25). `log(formatSentLine(row))` runs after the `COMMIT`. A pool client is used for one row at a time, so `batchSize` never needs more than one connection per sender.
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
  The unique key is the whole "once" rule (`DATABASE.md` 3.2): nothing depends on timing or on a lock in the app. Under READ COMMITTED a parallel second statement waits for the first one's uncommitted rows on the unique index, then does nothing (`reminder.test.ts` already shows this on the schema). `rowCount` is the number inserted. The statement is not limited to one event, so it handles every event in the window in one pass; it reads event columns and `users.email` in the same snapshot. Checked-in people are left out (ER14).
- **Clock:** `enqueueReminders(pool, now: Date)` passes `now` as a parameter; `startEmailJobs` gets `clock: () => Date` (default `() => new Date()`). Neither `sender.ts` nor `reminders.ts` reads the real time for the window (ER17).
- **Timer and start-up (ER22-ER28):** `createRunner` calls the task at start, then with `setInterval(intervalMs)`; a `running` promise guards against overlap (a firing while it is set is skipped); the task is wrapped in `try/catch` and `onError` gets the error message. `stop()` calls `clearInterval` and awaits the running promise (at most one email in flight, so at most `timeoutMs` of waiting). `index.ts` first calls `readMailConfig(process.env)` and `readIntervalMs(process.env)` in a `try/catch` (print the message, `process.exit(1)`), then creates the pool with `createPool()`, builds `createResendTransport({ ...config, timeoutMs: 10000 })`, passes the pool to `createApp({ pool })` (an existing option), calls `listen`, then `startEmailJobs`, and registers `SIGINT` and `SIGTERM`: `await jobs.stop()`, `server.close()`, `pool.end()`. The runner is not started in `createApp`, so tests of the app and of the routes never start a timer and never need mail settings (ER28).
- **Logging:** `console.log` for the `[email] sent <kind> to <address>` line and `console.error` for failures only. No body, no subject, no key.
- **API:** none. No routes are added.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/email/config.test.ts` | **Tests first (red):** `readMailConfig` with both variables, missing/blank key, missing/blank sender, default URL, custom URL, invalid URL, no key value in the message | ER29 |
| `api/test/email/fakeMailServer.ts` | Test helper: a `node:http` server on `127.0.0.1` port 0 that records requests and can answer a chosen status, close the connection, or never answer. No library | ER30-ER32 |
| `api/test/email/transport.test.ts` | **Tests first (red):** request shape against the fake server; non-2xx, network error and timeout reject with the right cause and no secret in the message | ER30, ER31, ER34 |
| `api/test/email/sender.test.ts` | **Tests first (red), roadmap step 30:** ER1, ER2, ER3 (5 parallel senders; a pending transport call), ER6, ER32 (real transport against the fake server: 500, refused, no answer, then fixed), then ER4, ER5, ER7, ER8, ER34. Fake transport = a collecting function; a rejecting one for ER6. `fetch` stubbed to fail in the tests that use the fake transport (ER33) | ER1-ER8, ER32-ER34 |
| `api/test/email/reminders.test.ts` | **Tests first (red), roadmap step 31:** ER11, ER12, ER13, ER15, ER16, ER17, ER18, ER19, ER9 (fields), then ER10, ER14, ER20, ER21. Fake clock = a fixed `Date` passed as `now` (for example one day before the start; events placed with `insertEvent({ startsAt })`). Uses `createTestDb()`; the red run fails because `enqueueReminders` does not exist | ER9-ER21 |
| `api/test/email/runner.test.ts` | ER23-ER26 with `vi.useFakeTimers()` and a controllable task (a promise the test resolves); ER27 (`readIntervalMs`) | ER23-ER27 |
| `api/test/email/jobs.test.ts` | ER22 (`tick()` writes the reminder and sends it to the fake transport in one round, in that order) and ER28 (`createApp` with a wrapped pool starts nothing and calls neither `query` nor `fetch`) | ER22, ER28 |
| `api/src/email/transport.ts` | `EmailMessage`, `EmailTransport`, `createResendTransport` | ER30, ER31, ER34 |
| `api/src/email/config.ts` | `readMailConfig` | ER29 |
| `api/src/email/sender.ts` | `formatSentLine`, `sendPending` | ER1-ER8, ER32, ER34 |
| `api/src/email/reminders.ts` | `enqueueReminders` with the statement above | ER9-ER21 |
| `api/src/email/runner.ts` | `createRunner` | ER23-ER26 |
| `api/src/email/jobs.ts` | `readIntervalMs`, `startEmailJobs` | ER22, ER27 |
| `api/src/index.ts` | Read the mail settings and the period before `listen` (exit 1 with a clear message if they fail), create the pool and the transport, pass the pool to `createApp({ pool })`, call `startEmailJobs` after `listen`, stop everything on `SIGINT` and `SIGTERM` | ER28 |
| `.env.example` | Add `EMAIL_API_KEY=` and `MAIL_FROM=` (required, with a comment that the API will not start without them and that the key is never committed), `EMAIL_API_URL` (optional, commented out, default the Resend URL) and `EMAIL_JOB_INTERVAL_MS` (optional, commented out, default 10000) | ER28, ER29 |
| `README.md` | Environment table: the four variables above. A note on Resend: the free test sender only delivers to the account owner's address until a domain is verified. "Project status": the sender and worker, emails are really sent. How to start the API now needs the two mail settings. Note the hand checks | |
| `ROADMAP.md` | Mark steps 29-32 when finished; reword step 30 ("prints unsent outbox rows") and the M6 line in "Current state" to real sending | |
| `docs/DATABASE.md` | Wording only, if the code-writer's step changes it: the `outbox` heading says the sender "prints" the row; no column, constraint or rule changes | |

Not touched: `api/src/db/migrations/`, `api/openapi.yaml`, `api/src/app.ts`, `api/src/registrations/`, `api/src/checkin/`, other specs, `web/`. No new package in `api/package.json` (`fetch`, `AbortSignal.timeout` and `node:http` are built in).

Tests use the existing style (a pool from `createTestDb()` with its own schema, helpers in `api/test/db/helpers.ts`; no new test library; `vi.useFakeTimers()` and `vi.stubGlobal` are part of Vitest). Parallel cases use `Promise.all` over several calls on the same pool. Order of work (roadmap): config and transport tests, then code; sender tests, then sender code (step 30); B5 tests committed red, then the worker, runner, jobs and `index.ts` (steps 31, 32).

## 5. Done means

- Tests, typecheck and linter pass in `api/` (`bash scripts/verify.sh`).
- Every behaviour ER1-ER34 has a test, or a note in the README that says it is not covered. The start-up exit and the signal handling in `index.ts` (second and third part of ER28) are checked by hand and the README says so.
- The tests for ER1-ER3, ER6, ER9, ER11-ER13, ER15-ER19, ER22, ER24, ER25 and ER29-ER32 (marked "yes") are written and committed before the code that makes them pass, and shown failing for the right reason.
- `api/src/db/migrations/` and `api/openapi.yaml` have no change in the diff, and `api/package.json` has no new dependency.
- No test sends a real email: the whole `api` test run passes with `EMAIL_API_KEY` and `MAIL_FROM` unset and with no network (ER33).
- By hand, once, noted in the README: (a) `npm run dev` in `api/` with `EMAIL_API_KEY` or `MAIL_FROM` removed prints a message that names the variable and exits without listening; (b) with real settings and a registration made with the Resend account owner's address, the ticket email arrives once within one period, the console shows one `[email] sent ticket to ...` line, and nothing more is sent for that row afterwards.

## 6. Open questions

D52 answers 1-5 (checked-in people get no reminder; send before commit, at least once; 10 s period; reminder text; queued reminder after reschedule left for M7) still hold and are not asked again. D53 and D54 are settled. New questions:

1. **Permanently failing rows.** With Resend's test sender, any attendee with an address other than the owner's (and every seeded fake address in M10) gives a 4xx that never goes away; those rows are retried every round and, once `batchSize` (20) of them sit at the head of the queue, they block newer rows, including the owner's. Without a migration there is no honest fix (marking such a row `sent_at` would be a lie). **Recommended: accept for the first version and follow with a small separate step that adds `outbox.send_attempts smallint NOT NULL DEFAULT 0`** (increment on failure, skip rows at 5 or more, a test for it) and a one-line change to `DATABASE.md`. Until then the README tells the user to use the owner's address for test accounts.
2. **Duplicate on crash.** A crash after the provider's 2xx and before the `COMMIT` sends that one email twice. Resend accepts an `Idempotency-Key` header (check the current docs before coding). **Recommended: add an optional `idempotencyKey` field to `EmailMessage`, filled with the outbox row id and sent as that header**, which removes the duplicate within the provider's window at the cost of one header and one test line in ER30. If the answer is no, the at-least-once rule above stands as written.
3. **Pause between sends (rate limit).** Sending 20 rows in a row can hit the provider's per-second limit, which gives 429s that clear on the next round. **Recommended: no pause now**; lower the default `batchSize` if 429s show up in the manual check.
4. **Timeout and batch size defaults.** 10 s per email and 20 attempts per round (ER5, ER30), as set in D53. **Recommended: keep**, both are plain constants/options.
