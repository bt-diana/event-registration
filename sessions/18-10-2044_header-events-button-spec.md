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

## Step 5: build

**Prompt** (21:05 +06, text cleaned)

> implement

**What Claude did.** Delegated to the `code-writer` agent: W-L8 tests (`37db0ed`), the code that keeps organizers on `/`, the header tests (`7bf0d2d`, 49 new, failing first) and the link with styles (`82c47ae`). Another process committed to `main` at the same time, so the code for W-L8 went into `c807773` (message about the registrations link) instead of its own commit; history was not rewritten. Checked: web tests, typecheck and lint pass. Not done: HB10 (phone layout by hand). Used Agent, Bash.

**Decision.** None.

## Step 6: header button and Log out look like links

**Prompt** (21:04 +06, text cleaned)

> the button should look like a link; same goes for the log out button; fix that

**What Claude did.** Changed `web/src/styles.css`: `.button-link-secondary` and the Log out button in `.site-account` now look like the nav links (no border or background, 15 px semibold, underline on hover; the current page is underlined). Updated the look rows in `header-events-link.md`. Markup and tests are unchanged. Web tests, typecheck and lint pass. Used Bash.

**Decision.**

### D63: the "Watch all events" button and Log out look like links
21:04:41 +0600. Replaces the outlined look of the spec. Reason: the user asked for it.

## Step 7: the logo replaces the button

**Prompt** (21:12 +06, text cleaned)

> rename "Watch all events", use the logo as such a button instead, for both types of users

**What Claude did.** Read it as: remove the "Watch all events" button and make the logo open `/` for everyone, organizers too. The `spec-writer` agent rewrote `header-events-link.md` for the logo and changed one sentence each in `events-web.md` (W-E22) and `events-public-list-web.md` (W-L8, assumptions). Updated `ROADMAP.md` and `README.md`. Open: `registration-web.md` W-R14 still says "Registrations" where the built link is "My events" (another change, not touched). Used Agent, Bash.

**Decision.**

### D64: the header logo opens `/` for everyone; the "Watch all events" button is removed
21:12:00 +0600. Replaces D58-D59 (the button) and D62 (organizer logo to `/organizer`). Organizers reach `/organizer` through "My events" and after login (D61). Reason: the user asked for the logo to be the button for both roles.

## Step 8: build the logo change

**Prompt** (21:15 +06, text cleaned)

> implement

**What Claude did.** Delegated to the `code-writer` agent: tests `ab197e5` (38 failed first), code `259e9f0` (logo `to="/"` with `aria-current`, button and its CSS removed, Log out keeps the link look; one stale assertion in `PublicEventsList.test.tsx` fixed). Web tests (633 passed), typecheck and lint pass. Not done: HB10 (phone layout by hand), canvas boards, `docs/brand.md`. Used Agent, Bash.

**Decision.** None.

## Step 9: "All events" on desktop too

**Prompt** (21:55 +06, text cleaned)

> we have that button back for the mobile
> return it for the desktop as well

**What Claude did.** Found that another process had added the "All events" link to the phone menu (D68, `header-responsive.md` HR27). Read it as: show that link on desktop too. The `spec-writer` agent changed `header-responsive.md` (HR1, HR19, HR27, HR28, sections 2-7) and `header-events-link.md` (HB1, HB4, HB9, assumptions). Open: the built phone drawer slides down from the top and the spec says a right-side drawer (not caused by this change, not touched); the desktop boards are not drawn. Used Bash, Agent.

**Decision.**

### D73: the "All events" link is shown on desktop too
21:55:44 +0600. Above 640 px it is the first item of the right group of the header row, with the nav link look; the logo still links to `/`. It is absent while `me` loads, as the rest of the menu. Reason: the user asked to bring the button back on desktop.

## Step 10: build "All events" on desktop

**Prompt** (22:00 +06, text cleaned)

> (result of step 9)

**What Claude did.** Delegated to the `code-writer` agent: tests `b3102ce` (15 new DOM tests; none failed first because jsdom does not read CSS), code `4aacb71` (the `display: none` rule for `.site-nav-all` removed, comments fixed; no logic change). Web tests (825 passed), typecheck and lint pass. The agent signed the commits "Opus 5.5" instead of "Sonnet 5.5". Not done: the hand check of the desktop layout (HR19), the canvas boards. Used Agent, Bash.

**Decision.** None.
