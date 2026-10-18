# Session: header "Watch all events" button spec

Started 18-10 20:44 +06.

## Step 1: new spec for the header button

**Prompt** (20:44 +06, text cleaned)

> create new spec
> let's add "watch all event" button to header

**What Claude did.** Read `SPEC_TEMPLATE.md`, `events-public-list-web.md`, `web/src/auth/Header.tsx` and `App.tsx`. The meaning of "watch" was not clear, so I asked one question (below). Delegated the spec to the `spec-writer` agent. Used Read, Glob, Grep, Bash, AskUserQuestion, Agent.

**Decision.**

### D58: "Watch all events" is a header link that opens the events list
20:46:00 +0600. The button is a link styled as a button: `/` for logged out and attendees, `/organizer` for organizers. No subscription, no API change. Reason: the user chose this option over a follow/subscribe feature.

## Step 2: spec written

**Prompt** (20:47 +06, text cleaned)

> (result of step 1)

**What Claude did.** The `spec-writer` agent wrote `docs/specs/header-events-link.md` (HB1-HB10): the link is first in the right group of the header, hidden while `me` loads, `aria-current="page"` on an exact match, outlined style `button-link-secondary`. Test first: HB2 (route per role), HB3 (pending, 401, 5xx), HB5 (exact match). Five open questions with recommendations. Added the line to `ROADMAP.md` and the link to `README.md`. Used Agent, Bash.

**Decision.** None.

## Step 3: the link always opens `/`

**Prompt** (20:50 +06, text cleaned)

> the link should just open / route

**What Claude did.** Changed `docs/specs/header-events-link.md`: `href` is `/` for everyone (HB2), the button is shown while `me` loads and does not read `me` (HB3), `aria-current` only on `/` (HB5), the role map `EVENTS_LINK` removed. An organizer reaches `/organizer` through the existing W-L8 redirect. Open questions went from five to four. Updated the line in `ROADMAP.md`. Used Read, Bash.

**Decision.**

### D59: the header link always opens `/`
20:50:49 +0600. Replaces the per-role target of D58 (`/organizer` for organizers). Reason: the user asked for the link to just open `/`.

## Step 4: organizers stay on `/`, login and logo open `/organizer`

**Prompt** (20:53 +06, text cleaned)

> leave orgs on / when clicking the new button
> open /organizer by default when accessing the app from the login page
> open /organizer when clicking the logo

**What Claude did.** Checked the code: after login an organizer already goes to `HOME` (`/organizer`) and the organizer logo already links to `/organizer` (W-E22); only the redirect from `/` (W-L8) had to change. The `spec-writer` agent changed `events-public-list-web.md` (W-L7, W-L8, W-L9, assumptions, sections 2-7) and `header-events-link.md` (HB5-HB7, assumptions, manual check, questions: three left). The built redirect in `PublicEventsList.tsx` and its W-L8 test are not changed yet; they need a tests-first step. Updated `ROADMAP.md`. Used Bash, Grep, Agent.

**Decision.**

### D60: an organizer who opens `/` stays there and sees the public list
20:53:38 +0600. Replaces the redirect of W-L8 (`events-public-list-web.md`). Reason: the user asked to leave organizers on `/` when they click the new button.

### D61: after login the organizer opens `/organizer` by default
20:53:38 +0600. Already the behaviour (`HOME` in `guards.tsx`); written down as a rule. Reason: the user asked for it.

### D62: the logo opens `/organizer` for an organizer
20:53:38 +0600. Already the behaviour (W-E22); only the new button is fixed to `/`. Reason: the user asked for it.
