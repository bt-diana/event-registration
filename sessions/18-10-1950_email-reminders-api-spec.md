# Session: email and reminders API spec

Started 18-10 19:50 +06.

## Step 1: write the M6 API spec

**Prompt** (19:50 +06, text cleaned)

> implement spec for API M6

**What Claude did.** Found that `docs/specs/email-reminders.md` does not exist yet (ROADMAP step 29 is not done), so there is no spec to implement. Read `SPEC_TEMPLATE.md`, `ROADMAP.md` and `DATABASE.md` (outbox, 3.2). Started this session file. Delegated step 29 to the `spec-writer` agent (see below).

**Decision.** None.

**Result.** The `spec-writer` agent wrote `docs/specs/email-reminders.md` (ER1-ER28: sender ER1-ER8, worker ER9-ER21, timer ER22-ER28; five open questions with recommendations). Marked step 29 done in `ROADMAP.md`, linked the spec in `README.md`. Nothing is built yet. Used Agent, Bash.

## Step 2: accept the recommendations and ask where the email appears

**Prompt** (19:56 +06, text cleaned)

> accept all recommendations
> where will the email draft appear?

**What Claude did.** Marked the open questions of `docs/specs/email-reminders.md` as answered. Answered the question: the email text is stored in the `outbox` row (`subject`, `body`, `to_email`) and the sender prints it as one console line in the API terminal (ER4); nothing is shown in the web app (M6 UI spec decides that). Then started the build (steps 30-32) with the `code-writer` agent. Used Bash, Agent.

**Decision.**

### D52: accept all five recommendations of `email-reminders.md`
19:56:21 +0600. Checked-in people get no reminder; print before commit; period 10 s (`EMAIL_JOB_INTERVAL_MS`); reminder text as in ER10; queued reminders after a reschedule or cancel are left to M7. Reason: the user accepted all recommendations.

## Step 3: rework the spec for real email

**Prompt** (19:59 +06, text cleaned)

> actually, let's rework the spec and send the real notification to registered email

**What Claude did.** Stopped the `code-writer` agent before it changed any file in `api/` (nothing of the build was committed). Asked two questions because real sending needs a library or a service and the rules say to ask first. Delegated the spec rework to the `spec-writer` agent (below). Used TaskStop, AskUserQuestion, Bash, Agent.

**Decision.**

### D53: send real email through an HTTP email API, with the built-in `fetch`, no new library
19:59:53 +0600. The stub sender is replaced by a sender that posts each outbox row to a provider's HTTP API. Reason: the user chose this option over nodemailer and a hand-written SMTP client.

### D54: the API refuses to start without mail settings
19:59:53 +0600. No console fallback in the running API; tests pass a fake transport. Reason: the user chose "fail at start" over keeping the console stub.

## Step 4: provider is Resend

**Prompt** (19:59 +06, text cleaned)

> I'll use Resend

**What Claude did.** Nothing to change: the brief to the `spec-writer` agent already names Resend (`POST https://api.resend.com/emails`) behind a small `EmailTransport` function. Logged the decision. Used Bash.

**Decision.**

### D55: the email provider is Resend
19:59:57 +0600. The HTTP API of D53 is Resend's. Reason: the user chose it.

## Step 5: spec reworked for real email

**Prompt** (20:02 +06, text cleaned)

> (result of step 3)

**What Claude did.** The `spec-writer` agent reworked `docs/specs/email-reminders.md` (ER1-ER34): an `EmailTransport` with a Resend implementation over `fetch`, `readMailConfig` and start-up failure (ER29), at-least-once delivery with one row claimed per transaction, a fake HTTP server for tests, no secrets in logs. Four new open questions with recommendations. Updated step 30 and the M6 line in `ROADMAP.md` and the line in `README.md`. Used Agent, Bash.

**Decision.** None.

## Step 6: two retries, `error_sending`, and Resend out of scope

**Prompt** (20:07 +06, text cleaned)

> why could rows fail?
> let's have only 2 retries and if it still didn't work, mark the email status as error_sending
> let's not include Resend in the scope
> mark the email status as error_sending

**What Claude did.** Answered the first question in chat. Went back to the console stub sender (Resend, `fetch` transport, mail settings and fail-at-start removed from the scope) and added the retry limit with the status `error_sending`. Delegated the spec rework to the `spec-writer` agent. Used Bash, Agent.

**Decision.**

### D56: a failed email gets 2 retries, then the status `error_sending`
20:07:37 +0600. A row is tried at most 3 times (the first try and 2 retries, one per timer tick); after the third failure its status is `error_sending` and the sender never picks it again. Reason: the user asked for it.

### D57: real email through Resend is out of scope; the sender stays a console stub
20:07:37 +0600. Replaces D53, D54 and D55. Reason: the user asked to leave Resend out of the scope.

## Step 7: spec reworked for the stub, retries and `error_sending`

**Prompt** (20:10 +06, text cleaned)

> please, create an env.example, so I could provide the Resend API key

**What Claude did.** Added `EMAIL_API_KEY` and `MAIL_FROM` to the existing `.env.example` (commit 8bf76df; unused until real sending is in scope, D57). The `spec-writer` agent reworked `docs/specs/email-reminders.md` (ER1-ER38): migration `004_outbox_status.sql` (`status`, `send_attempts`, `send_error`), retries, the console stub. The agent could not read the first version, so I put the printed line back to the one of c36c710 (with the body) in ER7 and closed open question 2. Updated `ROADMAP.md` and `README.md`. Used Bash, Agent.

**Decision.** None.

## Step 8: real sending is back, with the `resend` package

**Prompt** (22:13 +06, text cleaned)

> suggest domain for my email
> I added the email API key and the mail from. Here's the send email API: (pasted example with `import { Resend } from 'resend'` and `resend.emails.send`)

**What Claude did.** Suggested domain names in chat (nothing written). The pasted example uses the `resend` npm package and the earlier decision said Resend was out of scope, so I asked two questions instead of building. Did not read `.env`. Delegated the spec rework to the `spec-writer` agent (below). Used AskUserQuestion, Bash, Agent.

**Decision.**

### D58: real email through Resend is in scope again, with the `resend` npm package
22:13:13 +0600. Replaces D57 and the "no library" part of D53. The user answered "use import { Resend } from 'resend'", which also approves adding the package to `api/`. The retries and `error_sending` of D56 stay.

### D59: the API refuses to start without `EMAIL_API_KEY` and `MAIL_FROM`
22:13:13 +0600. Confirms D54. Reason: the user chose "Yes, as in D54".

## Step 9: organizer-only endpoint for the reminders table

**Prompt** (22:16 +06, text cleaned)

> are there any endpoints we'll need for the web implementation?
> let's also implement an endpoint just to show the reminders table of the organizer's events, just for the organizers

**What Claude did.** Answered the first question in chat (no route is needed for M6 itself; a `ticket_email` field on `registrations/me` would be needed for a ticket-page note). For the second, started a separate spec `docs/specs/email-outbox.md` with the `spec-writer` agent (own file, so it does not collide with the `email-reminders.md` rework that is still running). Used Bash, Agent.

**Decision.**

### D60: add an organizer-only route that lists the email (outbox) rows of the organizer's own events
22:16:13 +0600. Organizers can read the reminders table (the `outbox` rows, with their status) of events they own; attendees and other organizers cannot. Reason: the user asked for it. Details (path, kinds, shape) are in `email-outbox.md`.

## Step 10: spec reworked for Resend

**Prompt** (22:17 +06, text cleaned)

> (result of step 8)

**What Claude did.** The `spec-writer` agent reworked `docs/specs/email-reminders.md` (ER1-ER47): `createResendTransport` over the `resend` package (`^6.34.1`), a returned `error` is thrown, the outbox row id as idempotency key, a timeout, `readMailConfig` and start-up failure, no address or body in logs. Updated `ROADMAP.md` and `README.md`. Still to do: `email-reminders-web.md` (W-EM2, the ER7 remark) needs a small edit. Used Agent, Bash.

**Decision.** None.

## Step 11: organizer outbox route spec written

**Prompt** (22:17 +06, text cleaned)

> (result of step 9)

**What Claude did.** The `spec-writer` agent wrote `docs/specs/email-outbox.md` (OB1-OB15): `GET /events/:id/emails`, organizer only, filters `kind` and `status`, newest first, cap 200 with a `truncated` flag, no body or ticket code, one read-only statement, code in `api/src/email/`. Added step 32a to `ROADMAP.md` and the spec to `README.md`. Used Agent, Bash.

**Decision.** None.

## Step 12: emails of one attendee

**Prompt** (22:19 +06, text cleaned)

> let's make the endpoint return info for a separate attendee reminders

**What Claude did.** Read it as: the organizer can ask for the emails of one attendee of an own event. Chose a `registration_id` filter on `GET /events/:id/emails` instead of a second route (open to change). Delegated the edit of `docs/specs/email-outbox.md` to the `spec-writer` agent. Used Bash, Agent.

**Decision.**

### D61: `GET /events/:id/emails` can be limited to one attendee with `registration_id`
22:19:21 +0600. The organizer gets the emails (reminders and the other kinds) of one registration of the own event. Reason: the user asked for the reminders of a separate attendee.

## Step 13: attendee filter added to the outbox spec

**Prompt** (22:20 +06, text cleaned)

> (result of step 12)

**What Claude did.** The `spec-writer` agent added `registration_id` to `docs/specs/email-outbox.md` (OB16-OB18; OB2, OB7, OB15 changed; open question 6). An unknown or foreign registration id gives 200 with an empty list, not 404. Updated the ids in `ROADMAP.md`. Used Agent, Bash.

**Decision.** None.

## Step 14: implement

**Prompt** (22:22 +06, text cleaned)

> implement

**What Claude did.** Took "implement" as: build `email-reminders.md` (ER1-ER47) and `email-outbox.md` (OB1-OB18) with the recommended answers to the open questions. Started the `code-writer` agent (steps 30-32a, below). Used Bash, Agent.

**Decision.**

### D62: accept the recommendations of the open questions of `email-reminders.md` and `email-outbox.md`
22:22:06 +0600. Batch size 5, keep `send_error`, database errors are not tries; `truncated` kept, all kinds by default, `invalid_status`, cap 200, code in `api/src/email/`, `registration_id` filter. Reason: the user said "implement" after the recommendations were listed.

## Step 15: default worker period 1 h, local value 10 s

**Prompt** (22:33 +06, text cleaned)

> so, the email will be sent every 10 seconds?
> let's also send an email when a person just registered for an event
> also, set default worker interval to 1h; and set env variable to 10s

**What Claude did.** Explained the 10 s timer (one reminder per person, not one email every 10 s). Found that the ticket email on registration is already built (B1, `ticket` outbox row), so the new sender sends it; no change. Changed the default of `EMAIL_JOB_INTERVAL_MS` in `docs/specs/email-reminders.md` (ER37 and the notes) to 3600000 and set `EMAIL_JOB_INTERVAL_MS=10000` in `.env.example` and in `.env` (appended one line; the file was not read). Told the running `code-writer` agent. Used Bash, SendMessage.

**Decision.**

### D63: the default period of the email job is 1 h; the local value is 10 s
22:33:12 +0600. Code default 3600000 ms, `.env` and `.env.example` set 10000. Reason: the user asked for it. Effect: without the variable a ticket email can wait up to an hour.

## Step 16: resend package and migration 004 (roadmap step 30, part 1)

**Prompt** (22:24 +06, text cleaned)

> (the `code-writer` agent's build of step 14: install `resend`, migration `004_outbox_status.sql`, tests first)

**What Claude did.** The `code-writer` agent installed `resend` 6.34.1 in `api/` (`62c6fef`). Verify at install (`email-reminders.md` section 3): `idempotencyKey` and `signal` both go in the second argument, `emails.send(payload, { idempotencyKey, signal })` (`CreateEmailRequestOptions extends PostOptions, IdempotentRequest`); an API error is returned as `{ data: null, error: { name, message, statusCode } }` with `statusCode: number | null`; a network failure or an abort is also returned as `application_error` (the SDK catches it); `new Resend('')` falls back to `RESEND_API_KEY` and then throws "Missing API key". Outside `NODE_ENV=production` the SDK prints `[Resend API Error]` with the provider's error to the console. Then the schema tests (`648bb2a`, red: columns missing) and the migration with `docs/DATABASE.md` decision 19 (`0e7a115`). Used Bash, Write, Edit.

**Decision.** None.

## Step 17: outbox sender (roadmap step 30, part 2)

**Prompt** (22:29 +06, text cleaned)

> (continued build)

**What Claude did.** Tests first for ER4-ER17 with a fake transport (`e13b94b`, red against a throwing stub), then `api/src/email/sender.ts` (`5f79731`): one row per transaction with `FOR UPDATE SKIP LOCKED`, the row id as idempotency key, `send_attempts` committed with the lock held, `error_sending` on the third failed try, addresses replaced in `send_error`, batch size 5 (D62). Used Bash, Write, Edit.

**Decision.** None.

## Step 18: Resend transport and mail settings (roadmap step 30, part 3)

**Prompt** (22:32 +06, text cleaned)

> (continued build)

**What Claude did.** Tests first for ER39-ER46 with a fake client object (`0e835ac`), then `api/src/email/transport.ts` and `config.ts` (`a938f35`): a returned `error` and an answer without an id are failures, `AbortSignal.timeout` plus a timer race (10 s), the key is never in a message. No test reads `EMAIL_API_KEY` or builds `new Resend`. Used Bash, Write.

**Decision.** None.

## Step 19: B5 reminder worker (roadmap steps 31, 32)

**Prompt** (22:34 +06, text cleaned)

> (continued build)

**What Claude did.** B5 tests first (`a884348`, ER18-ER31: 10 runs, 2 and 10 parallel workers in 3 rounds, window edges to the millisecond, the injected clock, one statement, A -> B -> A -> B, `error_sending` blocks a second reminder), then `api/src/email/reminders.ts` with the spec's statement (`bffb13d`). The ER27 test first also checked that `pool.connect` is not called; `pg`'s `Pool.query` calls it inside, so that line was removed in the code commit. Used Bash, Write.

**Decision.** None.

## Step 20: timer, jobs and start-up (roadmap step 32)

**Prompt** (22:36 +06, text cleaned)

> (continued build; D63 from step 15 arrived during it)

**What Claude did.** Tests first for ER32-ER38 and the ER14 ticks (`3257d63`), with the D63 default of 3600000 in the ER37 test. Then `runner.ts`, `jobs.ts`, `api/src/index.ts` (reads the period and the mail settings before `listen`, exit 1 with the variable name, jobs after `listen`, stop on `SIGINT`/`SIGTERM`) and the `.env.example` comment (`127b561`). A runner test found a bug before the commit: a task that throws synchronously left the overlap guard set. Checked by hand: a blank `EMAIL_API_KEY`, an empty `MAIL_FROM` and `EMAIL_JOB_INTERVAL_MS=abc` each print the variable name and exit with code 1 (no real email was sent). Used Bash, Write, Edit.

**Decision.** None.

## Step 21: organizer email list route (roadmap step 32a)

**Prompt** (22:48 +06, text cleaned)

> (continued build)

**What Claude did.** Tests first for OB1-OB18 (`b0ac92f`, red: the route did not exist), then `api/src/email/service.ts`, `routes.ts`, the mount in `api/src/app.ts` and `api/openapi.yaml` 0.8.0 with the tag `email` (`998709b`). Used Bash, Write.

**Decision.** None.

## Step 22: docs for the M6 API

**Prompt** (22:53 +06, text cleaned)

> (continued build)

**What Claude did.** Updated `README.md` (stack, run steps, the three email variables, the Resend free-tier limit, the `GET /events/:id/emails` row, the structure, the proof table and "Project status") and `ROADMAP.md` (steps 30, 31, 32 and 32a done). The agent files only list the core stack, so they were not changed. Not built: ER48-ER60 (`GET /events/:id/registrations/:registrationId/emails`, D74), which were added to `email-reminders.md` during this build. Not done by hand yet: one real delivery to the Resend owner's address and the signal handling. Used Bash, Edit.

**Decision.** None.
