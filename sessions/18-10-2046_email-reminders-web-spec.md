# Session: email and reminders web spec

Started 18-10 20:46 +06.

## Step 1: write the M6 web spec

**Prompt** (20:46 +06, text cleaned)

> write a spec for M6 on web

**What Claude did.** Found ROADMAP step 33 (`email-reminders-web.md`, "only what the API can tell; no new route unless the spec asks for it") and the done API spec `email-reminders.md`. Delegated the spec to the `spec-writer` agent (see below). Used Read, Grep, Glob, Bash, Agent.

**Decision.** None.

**Result.** `spec-writer` wrote `docs/specs/email-reminders-web.md` (W-EM1-W-EM8). No API response exposes email status, so the only UI change is two static lines on the ticket page. ROADMAP step 33 marked done. Six open questions are still open (ID prefix, per-ticket status, demo note, reminder line, organizer view, placement), each with a recommendation. Used Edit, Bash.
