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
