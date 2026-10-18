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
