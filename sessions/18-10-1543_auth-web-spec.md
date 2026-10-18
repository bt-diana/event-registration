# Session: web auth spec

Started 18-10 15:43 +06.

## Step 1: write the web auth spec with the UI decisions

**Prompt** (15:43 +06, text cleaned)

> let's write another auth spec for the web app with the UI decisions

**What Claude did.** Read `SPEC_TEMPLATE.md`, `auth.md`, `ROADMAP.md`, `web/package.json` and the last session file. Asked four UI questions (page layout per role, how the app knows the session, guards, router). Gave the `spec-writer` agent the answers. It wrote `docs/specs/auth-web.md` (W-A1 to W-A20; test first: W-A1 one `me` call, W-A2 no flash of the login page, W-A6 wrong-role message, W-A8 login fills the cache without a second call; seven routes, form fields, guard table, states, files). It also updated `docs/specs/auth.md`: `GET /auth/me` (A17-A19) and `role` in the sign-up, login and `me` answers; nine routes. Updated `ROADMAP.md` (M9 spec column, steps 27-28, M1 step 3). Used AskUserQuestion, Read, Glob, Bash, Agent (`spec-writer`). Open question left in the spec: Vite dev proxy for `/auth` or CORS.

### D30: separate login and sign-up pages per role
**Time:** 15:45 +0600

`/login`, `/signup` for attendees and `/organizer/login`, `/organizer/signup` for organizers, each linking to the others. Reason: chosen by the user over one page with a role switch.

### D31: session from `GET /auth/me`, role in login and sign-up answers
**Time:** 15:47 +0600

The app asks `GET /auth/me` once at start; it returns `{ role, id, email, name }` or 401. Login and sign-up answers also carry `role`, so no second call is needed. The role-specific `/me` routes stay for the guards. Reason: the cookie is `httpOnly` and the app has to learn the role. `auth.md` is updated (A17-A19).

### D32: redirect to login and come back
**Time:** 15:47 +0600

A logged-out person on a protected screen goes to that role's login page with `?next=` and returns after success. Reason: chosen by the user.

### D33: add react-router
**Time:** 15:47 +0600

The user approved `react-router` (v7) as a new library for `web/`. Not installed yet; it comes with the code step (ROADMAP step 28).

## Step 2: design canvas and brand notes

**Prompt** (15:5x +06, text cleaned)

> create a Claude design project from the README, the roadmap and the auth-web spec

> extract the core brand-book descriptions from the generated UI in the design artifact and write them down in a separate .md file in docs

**What Claude did.** Made a design canvas (https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76) with four auth screens: attendee login, attendee sign-up with field errors, organizer login with the 401 error, and the wrong-account page. Three listed screens (organizer sign-up, states board, phone login) are not written yet. Then wrote `docs/brand.md` from the values used in those screens (colours, type, spacing, components, rules) and linked it in the README. Used Artifact, Write, Bash.

**Decision.** None.

## Step 3: static auth UI

**Prompt** (text cleaned)

> implement the UI only for the current task; no functionality yet

**What Claude did.** Gave the `code-writer` agent the task. It installed `react-router` (approved in D33), added six routes, `AuthForm` (only the Show/Hide toggle works), a logged-out `Header`, `styles.css` with the brand tokens, fonts in `index.html`, and 7 render tests. Typecheck, lint and tests pass in `web/`. No fetch, session, validation or guards yet. Updated README, ROADMAP and `code-writer.md`. Used Agent, Bash.

**Decision.** None.
## Step 6: link the design artifact in the README

**Prompt** (text cleaned)

> mention the brand.md and the design artifact in readme

**What Claude did.** `brand.md` was already listed; added the design artifact link to that line (`1a9cea2`). Used Bash.

**Decision.** None.
## Step 4: app icon

**Prompt** (text cleaned)

> apply web\icon.svg to the tab icon and in the app itself: green for attendees and purple for the organizers

**What Claude did.** Moved `web/icon.svg` to `web/public/icon-attendee.svg` and made `icon-organizer.svg` with the indigo accent `#3A3AA0`. The header logo and the tab icon use the organizer icon on `/organizer` routes and the attendee icon elsewhere. Updated `docs/brand.md`. Typecheck, lint and tests pass. Used Bash.

**Decision.** None.

**Note on the icon commit (`3a98f6f`).** It was made with `git add -A`, so it also took in changes I did not make: an edit to `docs/brand.md` made on disk by another session (the logo text and the radius line, which belong to this icon change and are correct), and a version of `sessions/18-10-1535_auth-spec.md` that lacked its "Step 6: link the design artifact in the README" block, so the commit deleted that block. The block was restored from `9907f40` in the next commit. Lesson: stage files by name.
