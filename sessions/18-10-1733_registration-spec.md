# Session: registration spec

Started 18-10 17:33 +06.

## Step 1: write the spec for M3 (api)

**Prompt** (17:33 +06, text cleaned)

> implement spec for M3 for api

**What Claude did.** Read `ROADMAP.md` and the last session files. `registration.md` did not exist yet, so Claude asked what "implement" meant; the answer was "spec only". Gave the `spec-writer` agent the M3 scope. It wrote `docs/specs/registration.md`: behaviours R1-R21 (tests first: B4 as R8 and R9, B1 and B2 as R4-R6, guards R15, own ticket only R19), routes `POST /events/:id/registrations` and `GET /events/:id/registrations/me`, one transaction with `FOR UPDATE`, a `ticket` outbox row only for registered people, 409 for cancelled and passed events. Marked roadmap step 13 done and listed the spec in `README.md`. Open questions are in the last section of the spec: running events, repeat request on a closed event, 200 vs 201 for a repeat, cancelled ticket on "my registration", nested route. Used Read, Bash, AskUserQuestion, Agent (`spec-writer`).

**Decision.** None.

## Step 2: answers to the open questions

**Prompt** (17:41 +06, text cleaned)

> 1. accept
> 2. 409
> 3. 200 and 201
> 4. return all registrations: passed, cancelled, etc.
> 5. nested

**What Claude did.** Gave the `spec-writer` agent the answers. It changed R17 and R19 and added R22 (the read ignores the event status and returns a cancelled registration with its old ticket code; 404 only when the attendee never registered). `cancelled` is now a valid `status` in the answer shape. M4 must keep the cancelled row and its ticket code. Section 6 now says all questions are answered. Used Agent (`spec-writer`), Bash.

**Decision.**

### D41: "my registration" returns the registration in any status
17:41 +0600. The user wants `GET /events/:id/registrations/me` to return cancelled and passed registrations too, not 404. 404 is only for a person who never registered. Reason: the ticket page can then show a cancelled ticket. The other four answers are accepted as suggested.

## Step 3: spec for the event description field

**Prompt** (text cleaned)

> please, create another spec for adding new field to events: description

then:

> for all open questions accept suggestions

**What Claude did.** Gave the `spec-writer` agent the task. It wrote `docs/specs/event-description.md` (DS1-DS13): column `description text NOT NULL DEFAULT ''`, up to 2000 characters, new migration `003_event_description.sql`, optional on create, shown in the organizer and public shapes, plain text only. It edited no other file; the spec lists the docs to update when it is built (`events.md`, `DATABASE.md`, `events-web.md`, `README.md`, `ROADMAP.md`). Then Claude marked all seven open questions as answered. A roadmap step for it is not added yet (the `code-writer` agent was editing `ROADMAP.md`). Used Agent (`spec-writer`), Read, Grep, Bash.

**Decision.**

### D42: event description spec, all suggested answers accepted
The user accepted all seven suggestions: `NOT NULL DEFAULT ''`, 2000 characters, optional on create, whitespace-only becomes `''`, `description` in the organizer list, no editing for now, migration 003 (to confirm when building).
