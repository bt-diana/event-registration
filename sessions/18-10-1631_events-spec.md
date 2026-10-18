# Session: events spec

Started 18-10 16:31 +06.

## Step 1: write the spec for M2 (api)

**Prompt** (16:31 +06, text cleaned)

> write spec for M2 for api

**What Claude did.** Read `ROADMAP.md`, `DATABASE.md` and the last session file. Gave the `spec-writer` agent the M2 scope. It wrote `docs/specs/events.md`: behaviours E1-E17 (tests first: E4 own list, E7 other organizer's event gives 404, E9 guards, E13 public answer leaks nothing), routes `POST/GET /events`, `GET /events/:id` (organizer) and `GET /public/events/:id` (no login), validation, seats left, files, done means. Marked roadmap step 5 done. Open questions in section 6: past or cancelled event on the public page (200 with flags or 404), the `/public/events/:id` path, whether to show `capacity`, no pagination. Used Read, Bash, Agent (`spec-writer`).

**Decision.** None.

## Step 2: answers to the open questions

**Prompt** (16:52 +06, text cleaned)

> accept assumptions
> 1. Let's have a duration field in the event and make the status "passed" after that time passes
> 2. /public/events/:id is ok
> 3. yes
> 4. it's fine

**What Claude did.** Gave the `spec-writer` agent the answers. It updated `docs/specs/DATABASE.md` (new column `duration_minutes`, 1 to 1440, default 60, added by a new migration `002_event_duration.sql`; new section 3.10 and decision 17 for the derived status) and `docs/specs/events.md` (duration in create and in both shapes, `ends_at`, `capacity` on the public page, derived status `active`/`passed`/`cancelled`, E18-E20, no open questions left). The migration itself is not written yet (step 6). Notes for later milestones: M3, M4, M5 and M7 must decide what a passed event allows (suggested: refuse register, reschedule and capacity change; allow check-in). Used Read, Bash, Agent (`spec-writer`).

**Decision.**

### D36: event duration and a derived `passed` status
16:52:12 +0600. The user wants a duration on each event and the status `passed` once the event is over. Not stored: the API works it out as `now >= starts_at + duration`, so no worker or status change in the table is needed. The public page also shows `capacity`; the other three answers are accepted as written.

## Step 3: implement M2 (api)

**Prompt** (17:00 +06, text cleaned)

> implement

**What Claude did.** Gave the `code-writer` agent the task. It made three commits on `main`: `9e9a703` (migration `002_event_duration.sql` and schema tests), `36e3f30` (tests first: ownership, public page and organizer tests, E1-E20; 72 of 81 failed on purpose because the routes were missing) and `f66461e` (`api/src/events/routes.ts`, mount in `app.ts`, `openapi.yaml`, README, ROADMAP). Then ran `bash scripts/verify.sh`: typecheck, lint and tests pass (api 184, web 110). Things to know: `events.md` still says roadmap steps 6 and 7, while the renumbered ROADMAP calls them steps 8 and 9; `starts_at` accepts only `YYYY-MM-DDTHH:MM[:SS[.fff]]` with `Z` or an offset; a body that is not JSON gets 400 before the guard (from the app-wide `express.json()`); the new tests rely on dropping their throw-away schema instead of deleting rows; the agent wrote `Co-Authored-By: Claude Opus 5.5` in its commits. Used Agent (`code-writer`), Bash.

**Decision.** None.
