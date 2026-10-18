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
