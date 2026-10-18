# Session: check-in API spec

Started 18-10 18:40 +06.

## Step 1: write the check-in API spec (M5, step 24)

**Prompt** (18:40 +06, text cleaned)

> write a spec for M5 for api

**What Claude did.** Read `ROADMAP.md` and `DATABASE.md` to find the scope (steps 24-28, B6 and B7). Started this session file. Handed the work to the `spec-writer` agent, which wrote `docs/specs/checkin.md` (C1-C19): `POST /checkin`, `GET /events/:id/arrivals`, error codes, the race-safe classification and the test-first list. Marked step 24 done in `ROADMAP.md` and linked the spec in `README.md`. Used Read, Grep, Glob, Bash, Agent, Write.

The agent made six recommendations in the spec for the user to confirm: check-in is allowed before the start and after the end; body `{ ticket_code }`, trimmed and upper-cased, 400 for a bad shape; 200 answer with `attendee_name` and no email; 409 codes `already_checked_in`, `waitlisted`, `registration_cancelled`, `event_cancelled` (a cancelled event wins); the conditional UPDATE without a lock, with a read to classify; the arrivals route answers `{ event_id, checked_in, registered, waitlisted }` with `no-store`.

**Decision.** None.
