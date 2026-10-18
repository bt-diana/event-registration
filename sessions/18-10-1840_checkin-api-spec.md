# Session: check-in API spec

Started 18-10 18:40 +06.

## Step 1: write the check-in API spec (M5, step 24)

**Prompt** (18:40 +06, text cleaned)

> write a spec for M5 for api

**What Claude did.** Read `ROADMAP.md` and `DATABASE.md` to find the scope (steps 24-28, B6 and B7). Started this session file. Handed the work to the `spec-writer` agent, which wrote `docs/specs/checkin.md` (C1-C19): `POST /checkin`, `GET /events/:id/arrivals`, error codes, the race-safe classification and the test-first list. Marked step 24 done in `ROADMAP.md` and linked the spec in `README.md`. Used Read, Grep, Glob, Bash, Agent, Write.

The agent made six recommendations in the spec for the user to confirm: check-in is allowed before the start and after the end; body `{ ticket_code }`, trimmed and upper-cased, 400 for a bad shape; 200 answer with `attendee_name` and no email; 409 codes `already_checked_in`, `waitlisted`, `registration_cancelled`, `event_cancelled` (a cancelled event wins); the conditional UPDATE without a lock, with a read to classify; the arrivals route answers `{ event_id, checked_in, registered, waitlisted }` with `no-store`.

**Decision.** None.

## Step 2: confirm the spec decisions and drop the arrivals route

**Prompt** (18:50 +06, text cleaned)

> 1-4. accept recommended
> 5. the arrivals data is already available at /events/{id}/registrations; let's not create a separate endpoint

**What Claude did.** Checked the API: only `POST /events/{id}/registrations` and `.../me` exist; the organizer list `GET /events/{id}/registrations` is still an open question in `registration-web.md` (question 2, option A). So `checkin.md` now defines that list route (organizer only, 404 for a foreign event, registration shape plus `attendee_name` and `attendee_email`, `no-store`) and the screen counts arrivals from it. Removed `GET /events/:id/arrivals` and changed C1 and C15-C18, the shapes, the route table, the files and the open questions. Updated `ROADMAP.md`. `registration-web.md` question 2 is not edited yet; it should point to `checkin.md`. Used Bash, Read, Grep.

**Decision.**

### D44: accept the check-in rules of `checkin.md`
18:47:12 +0600. Check-in before the start and after the end, the body and error codes, the name without email in the 200 answer, and the conditional UPDATE without a lock stay as the spec recommends. Reason: the user accepted recommendations 1-4.

### D45: no separate arrivals endpoint
18:47:12 +0600. The arrivals counter is counted by the screen from `GET /events/{id}/registrations`, which `checkin.md` defines. Reason: the user wants one route for the data instead of two.
