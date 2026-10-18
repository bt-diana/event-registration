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
