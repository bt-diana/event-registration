# Session: events web spec and mockup

Started 18-10 17:30 +06.

## Step 1: events UI spec and mockup (started)

**Prompt** (17:30 +06, text cleaned)

> Implement the spec for the web for events; implement a UI mockup in https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76#page-dcb81aee8d83. API: `api/openapi.yaml`.

**What Claude did.** Read `ROADMAP.md`, `auth-web.md`, `events.md`, `brand.md` and the design canvas (it holds only the auth screens, no event screens). Read it as roadmap step 10: write `docs/specs/events-web.md` (with the `spec-writer` agent), then add the event screens to the design canvas.

**Decision.** None.

## Step 2: events UI spec written

**Prompt** (17:30 +06, same as step 1)

**What Claude did.** The `spec-writer` agent wrote `docs/specs/events-web.md` (W-E1 to W-E21, routes `/organizer`, `/organizer/events/new`, `/organizer/events/:id`, `/event/:id`, files to touch, canvas boards). Claude read it through and marked ROADMAP step 10 done. Used Agent, Read, Bash.

**Decision.** None.

## Step 3: event screens on the design canvas

**Prompt** (17:30 +06, same as step 1)

**What Claude did.** Added eight boards to the canvas (https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76): organizer events list, create form with client errors, organizer event page, public event page (Open), and two state boards (public: Full, Already started, Cancelled, Ended, 404, loading, error; organizer: empty, loading, errors, pending, 404). Added the badge and table styles to `docs/brand.md`. No phone boards yet. Used Write, Bash and Artifact (publish).

**Decision.** None.

## Step 4: answers to the open questions

**Prompt** (cleaned)

> 1. no
> 2. approve; mark in brand.md
> 3. let's have the same link for public and org; org will see it from the org view; others - from public view

**What Claude did.** Left the unrelated changes in the last commit as they are (1). Marked the badge colours approved in `docs/brand.md` (2). Changed `events-web.md`: one route `/event/:id` without a guard; the owner sees the organizer view (`GET /events/:id`), everyone else the public view (`GET /public/events/:id`); a 404 for an organizer falls back to the public view; `/organizer/events/:id` is removed (W-E8, W-E10, W-E11, W-E14, W-E15, W-E21, sections 2-4, questions 2-3). Updated the share link on the organizer event board. Used Bash, Artifact (publish).

### D37: badge colours approved
**Time:** 17:39:53 +0600

The status badge colours in `brand.md` are final. Reason: the user approved them.

### D38: one event link for the public and the organizer view
**Time:** 17:39:53 +0600

The event page is `/event/:id` for everyone. The owner gets the organizer view, others the public view. Reason: the user wants one share link; the view depends on who is logged in.

## Step 5: header bug and closing the open questions

**Prompt** (cleaned)

> found a bug: on clicking the app title in the header while logged in as org, we get to see the event list as Attendee; let's keep the org view, even for public events
>
> update docs/specs/events-web.md: I answered all open questions

**What Claude did.** Found the cause in `web/src/auth/Header.tsx` (logo links to `/`; the organizer look depends only on the path). Added W-E22 to `events-web.md` and gave the fix to the `code-writer` agent, test first (it commits itself). Then turned section 7 of the spec into a list of decisions: questions 2 and 3 as the user answered; question 1 as `registration.md` R11 already says (running events accept registrations); question 4 accepted as drawn on the canvas. Used Read, Grep, Agent, Bash.

### D39: an organizer keeps the organizer view on every screen
**Time:** 17:41:31 +0600

The header logo of a logged-in organizer goes to `/organizer` and the organizer look stays on public event pages too (W-E22). Reason: the user found that the logo led an organizer to the attendee home.

## Step 6: registration after the start

**Prompt** (cleaned)

> update the spec: event registration is possible when event already started, until it ended

**What Claude did.** Updated `events-web.md` (W-E17, public page content, section 7): Already started is not a closed status, its page never says "Registration is closed.", and only Cancelled and Ended are closed. Used Bash.

### D40: registration stays open after the start, until the event ends
**Time:** 17:44:44 +0600

A running event still accepts registrations until it ends (same as `registration.md` R11). Reason: the user said so.

## Step 7: description field in the web spec and mockup

**Prompt** (cleaned)

> add the description field to the spec and mock-up: docs\specs\event-description.md

**What Claude did.** Read `event-description.md` (API only; it says the web part goes into `events-web.md`). Updated `events-web.md`: the create form has an optional "Description" textarea (W-E4, W-E5, field table, `validateDescription`, canvas boards), and new W-E23 shows the description as plain text with line breaks under the title on the organizer and public views, nothing when empty, not on the list. Mockup: description textarea with a "too long" error on the create board; description text on the organizer and public event boards. Used Read, Bash, Artifact (publish).

**Decision.** None.

## Step 8: implementation (web steps 11 and 12)

**Prompt** (cleaned)

> start implementation

**What Claude did.** Sent the `code-writer` agent to build the description API (`event-description.md`). It stopped without changes: another session was writing M3 code in `api/` (same files: `events/routes.ts`, `openapi.yaml`). So the description API is waiting. Sent a second `code-writer` run for the web screens in `web/` (steps 11 and 12, tests first): commits `5b08cc1` (tests), `8981092` (role eyebrow tests), `26d245b` (events list and create form), `e703432` (event page, organizer and public views). 265 web tests, typecheck and lint pass; `verify.sh` and the real-API manual check were not run. The web accepts a missing `description` until the API step lands. Used Agent, Bash.

**Decision.** None.
