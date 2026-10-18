# Session 14:33: spec for the PostgreSQL tables

Build session, Claude Code. Times are Asia/Bishkek (UTC+06). The date is in the file name. Prompts have spelling and grammar fixed (text cleaned) and the wording otherwise unchanged.

## Step 1: ask for the first database spec

**Prompt** (14:33 +06)

> let's write the first spec for creating the PostgreSQL table

**What Claude did.** Read `SPEC.md`, the research session, the session files for the next decision ID and the `spec-writer` agent file (Read, Glob, Grep, Bash for the time). Started this session file. Next it hands the spec to the `spec-writer` agent.

**Decision.** None.

## Step 2: database spec written

**Prompt.** None (the `spec-writer` agent's report came back).

**What Claude did.** The `spec-writer` agent (Sonnet 5.5, medium; Read, Glob, Grep, Write, Edit) wrote `docs/specs/DATABASE.md`: tables `events`, `registrations` (a ticket is one row) and `outbox` (the stub email), a SQL sketch, how B1 to B8 are made safe, and 9 open questions with defaults. It filled the Database and Concurrency parts in section 3 of `SPEC.md` and the migrations row in section 4. B4 uses a row lock on the event, B5 a unique key on the outbox, B6 a conditional UPDATE. Claude read the result and committed it. The agent did not find the task text in the repo, so the spec rests on B1 to B8.

**Decision.** None. The open questions in section 6 of `DATABASE.md` are still waiting for my answers.

## Step 3: status for events

**Prompt** (about 14:40 +06, text cleaned)

> shouldn't we have status for events as well?
> like, if the whole event would be canceled?

**What Claude did.** Agreed, and gave the `spec-writer` agent (Sonnet 5.5, medium) the defaults to use. The agent added `events.status` (`active` or `cancelled`) and `events.cancelled_at`, the `event_cancelled` outbox kind, section 3.7 (cancel the whole event, in one transaction with the event row locked) and B9 in `SPEC.md`. Registrations are not changed when the event is cancelled. A cancelled event rejects registering, rescheduling and check-in, sends no reminders and promotes nobody. Claude checked the diff, changed the migrations row in `SPEC.md` from B1-B8 to B1-B9, and committed. Used Bash, Edit, Agent. The agent added open questions 10 to 12 to `DATABASE.md`.

**Decision.**

### D20: events get a status, so a whole event can be cancelled

**Time:** 14:41:14 +0600

Without an event status, nothing stops registrations, reminders and the waiting list for an event that is off. A `status` column is the smallest change that fixes this. It is added to the spec as B9.

## Step 4: users and organizers tables

**Prompt** (about 14:45 +06, text cleaned)

> let's add users and organizer tables
> what does "no separate ticket" mean?

**What Claude did.** Answered the question: "no separate ticket" in section 5 of `DATABASE.md` means a ticket is a `registrations` row (its `ticket_code` column), not its own table. Because users and organizers change B1 and the organizer access rule, Claude asked me two questions (AskUserQuestion). Then the `spec-writer` agent (Sonnet 5.5, medium) added `users` and `organizers` to `DATABASE.md`: `registrations.user_id` replaces the email, the B1 unique index is now `(event_id, user_id)`, `events.organizer_id` is NOT NULL, and every organizer action checks the owner (new section 3.8, another organizer's event answers 404). It updated the database, concurrency and organizer access lines and the migrations row in `SPEC.md`, and added open questions 13 to 18. Claude checked the diff and committed. Used AskUserQuestion, Agent, Bash.

**Decision.**

### D21: attendee accounts in `users`, organizers in their own table and owning their events

**Time:** 14:47:24 +0600

`users` holds attendees (no login); registrations point to a user. `organizers` is a separate table with a login, and each event has an `organizer_id`. This replaces the shared key from an environment variable. No password library or session method is chosen yet (question 13).

## Step 5: answers to the open questions

**Prompt** (about 14:52 +06, text cleaned)

> No attendee login or password: please, add those
>
> 1 - 5. OK
> 6. NO
> 7. explain the issue in detail
> 8. let's not allow making capacity less than the already registered number of people (warning message)
> 9. switch to uuid
> 10. Yes, cancel registrations
> 11. no
> 12. I think this question is closed by the previous ones
> 13. cookie, use the standard cookie-parser middleware
> 14. sign-up screen
> 15. Attendee name should be stored only in the user table; reference the user in the registration via id
> 16. OK
> 17. OK
> 18. OK

**What Claude did.** Explained question 7 itself (the unique key on the outbox blocks a reminder or reschedule email when an event goes A, B, A, B), and kept it open. The `spec-writer` agent (Sonnet 5.5, medium) applied the rest to `DATABASE.md` and `SPEC.md`: `users` got `name` and `password_hash` (attendees sign up and log in); a signed cookie with `cookie-parser` and `crypto.scrypt` for hashing (no sessions table); sign-up screens for attendees and organizers; uuid ids with `uuidv7()` plus a `queue_no` identity column for the waiting-list order; event cancel now cancels registrations too (people already checked in are left alone); capacity change as new B10 (lower than registered is rejected with a 409 warning). B1 and B9 were reworded. The old open questions became 12 decisions and 4 open questions. Claude checked the diff and committed. `uuidv7()` could not be tested here (psql needs a password), so it is unverified until the migration runs. Used Agent, Bash, Edit.

**Decision.**

### D22: attendees sign up and log in; sessions are a signed cookie with `cookie-parser`

**Time:** 14:59:12 +0600

Attendees get accounts with a password, and organizers and attendees both have a sign-up screen. Login sets a signed cookie (`cookie-parser`, the only new library, approved here). Passwords use Node's built-in `crypto.scrypt`, so no hashing library is added. This changes B1.

### D23: uuid ids, with `queue_no` for the waiting-list order

**Time:** 14:59:12 +0600

All ids are `uuid` (`uuidv7()`). The waiting list is ordered by an identity column `queue_no`, because uuidv7 is not strictly ordered between concurrent connections.

### D24: cancelling an event cancels its registrations; no reopening

**Time:** 14:59:12 +0600

All registered and waiting people are cancelled and emailed. A cancelled event cannot be reopened. This replaces the earlier default from D20 that registrations stay unchanged.

### D25: capacity can be changed, but not below the registered count

**Time:** 14:59:12 +0600

Lowering capacity below the number of registered people is rejected with a warning (409). This adds B10.

### D26: defaults accepted

**Time:** 14:59:12 +0600

Accepted as written: tickets and registrations in one table, waiting people get a code but no ticket email, 10-character ticket codes, cancelling a checked-in ticket gives 409, the 24-hour reminder window is worker logic, no reminders for the waiting list, the name stored only in `users.name`, user rows kept, no owner change or organizer delete, and 404 for another organizer's event.

## Step 6: last open questions

**Prompt** (about 15:01 +06, text cleaned)

> 1. OK
> 2. cancelling an event when it has already started is not possible
> 3 - 4. OK

**What Claude did.** Gave the four answers to the `spec-writer` agent (Sonnet 5.5, medium). It added `schedule_version` to `events` and `outbox`, so the outbox unique key is now `(registration_id, kind, schedule_version)` and a reschedule that goes A, B, A, B emails every move. It made cancelling an event that has started a 409 (also written into B9 in `SPEC.md`). It confirmed that raising capacity promotes waiting people, and set the cookie lifetime to 7 days as a default (I said OK without a value, so this is my default, not a number from me). No open questions are left in `DATABASE.md`. The agent noted one weakness: the new key no longer blocks a second `ticket`, `promotion` or `event_cancelled` row across versions. The app logic under the event lock keeps them to one per person, and nothing in the design writes them twice. An optional stricter guard is a partial unique index on `(registration_id, kind)` for those three kinds. Claude checked the diff and committed. Used Agent, Bash.

**Decision.**

### D27: outbox "once" rule is per schedule version; no event cancel after the start

**Time:** 15:03:30 +0600

Reminders and reschedule emails are unique per person per `schedule_version`, so an event that returns to an earlier time still emails everyone. An event that has already started cannot be cancelled (409). Raising capacity promotes the waiting people. The cookie lasts 7 days unless changed.

## Step 7: implement the database

**Prompt** (15:05 +06, text cleaned)

> implement the DB

**What Claude did.** Looked at `api/` (Express, `pg`, Vitest, no migrations yet), then gave the work to the `code-writer` agent (Opus 5.5, high) with `DATABASE.md` as the spec: tests first, then code. The agent made two commits. `ab3f09d test(api): add database schema tests` had 32 of 33 tests failing for the right reason (missing tables). `47f4d58 feat(api): add initial database schema and migrator` added `001_init.sql` (the five tables), a pool helper, a migrator that records files in `schema_migrations`, and the `db:migrate` script. The 28 new tests cover the last seat (20 parallel registrations on 1 seat give 1 registered and 19 waitlisted), the single reminder (10 runs and 10 parallel workers), the single check-in (5 parallel calls give 1 row), B1, the constraints, and the migrator. They run in throw-away schemas, so the dev `public` schema is untouched and has no tables yet. `uuidv7()` exists on this server (PostgreSQL 18.6). Claude ran the tests, typecheck and lint itself: 33 of 33 pass, both clean. Used Agent, Bash.

Points found: the database has six tables, not five, because of `schema_migrations`, which the spec does not mention. The agent changed its B4 test in the code commit so that removing the lock makes it fail (an earlier version passed by accident). Its commits end with `Co-Authored-By: Claude Opus 5.5`, not the Sonnet 5.5 line from this session's attribution rule. Two migrators started at the same time are not handled.

**Decision.** None.

## Step 8: open the database in pgAdmin

**Prompt** (about 15:15 to 15:24 +06, text cleaned)

> how can i open the db in pgAdmin
>
> (then the pgAdmin error "password authentication failed for user postgres" on port 5432, "it's the same password as .env", and "yes" to running the migration)

**What Claude did.** Explained how to register the server in pgAdmin. The error came from port 5432, but the project database runs on port 5433. Claude read `DATABASE_URL` with the password hidden to confirm the host, port and database name (`localhost`, 5433, `events`). On "yes" it ran `npm run db:migrate`. The output was "Nothing to apply": the six tables (`events`, `organizers`, `outbox`, `registrations`, `schema_migrations`, `users`) were already in `public`. Claude listed them with a query to check. Used Bash.

**Decision.** None.
