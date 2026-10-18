# Event Registration

A small service for event registration. An organizer creates an event with a limited number of seats. People register by email, and at the entrance they are checked in with a ticket code. When seats run out, new people go to a waiting list. When someone cancels, the first person on the list gets the seat and an email.

This is my solution for Task 9. I built it together with an AI agent.

> **Draft.** Only the database schema, accounts and login (milestone M1) and the web login, sign-up and session screens (M1 step 6) are built so far. `[TODO]` marks what I fill in during and after the build. The "Project status" section must only say what really works.

## Features

- **Events:** description, date and time, seat limit.
- **Registration:** by email. Registering again with the same email does not create a second seat. A participant can cancel.
- **Waiting list:** when seats run out, new people go to the list. A cancellation gives the seat to the first person on the list, and they get an email.
- **Tickets:** every registered person gets a ticket with a code. A ticket can be checked in only once.
- **Check-in screen:** the organizer types the ticket code. A scanner is replaced by code entry.
- **Organizer screen:** how many people are registered, on the waiting list, and have arrived. The arrivals counter updates live.
- **Emails:** ticket on registration, seat from the waiting list, one reminder one day before the event, and a notice when the event is rescheduled.

## Tech stack

| Part | Choice |
|---|---|
| Backend | Node.js, TypeScript, Express 5, `pg`, `cookie-parser`, Vitest |
| Frontend | React, Vite, TypeScript, TanStack Query, `react-router` (v7, declarative routes), plain CSS, Vitest |
| Database | PostgreSQL 18 (Windows service, port 5433) |
| Email | Stub. Every email is saved in an `outbox` table and printed to the console |
| Accounts | Attendees and organizers sign up with email and password. Passwords are stored as an `scrypt` hash with a random salt (`node:crypto`). Login is one signed `session` cookie that lasts 7 days; no sessions table |

The backend and the frontend are separate apps. They talk over HTTP, and the live counter uses server-sent events. The reasons for these choices are in the decisions in `sessions/`. The task allows stubs for external services, so email is not sent for real.

## Getting started

`[TODO: confirm versions and commands after the build]`

### Prerequisites

- Node.js 20 or newer
- PostgreSQL 18, installed as a Windows service on port 5433 (no Docker)
- Free ports: 3000 (API), 5173 (web) and 5433 (database)

### Run locally

```bash
# 1. PostgreSQL runs as a Windows service.
#    Copy .env.example to .env and set DATABASE_URL and COOKIE_SECRET
#    (at least 32 random characters; the API refuses to start without it).
#    Never commit .env.

# 2. Backend
cd api
npm install
npm run db:migrate
npm run dev

# 3. Frontend (in a new terminal)
cd web
npm install
npm run dev
```

Open http://localhost:5173.

The web app calls the API on its own origin. In development the Vite dev server proxies `/auth` to the API on http://localhost:3000 (`web/vite.config.ts`), so no CORS is needed and `fetch` uses `credentials: "same-origin"`. This proxy exists only in `npm run dev`; a production build must be served from the same origin as the API (for example behind one reverse proxy), or the login cookie and the calls will not work.

### Try it with two clients

Open the organizer screen in one browser tab and the check-in screen in another. Register a person, check in the ticket, and watch the arrivals counter change in the first tab without a reload.

### Run the tests

```bash
cd api && npm test      # runs against the real database (each test file uses a throw-away schema)
cd api && npm run typecheck && npm run lint
cd web && npm test      # unit tests
cd web && npm run typecheck && npm run lint
bash scripts/verify.sh      # typecheck, lint and tests for api and web, stops at the first failure
cd web && npm run e2e   # two-browser test [TODO: confirm]
```

### Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (port 5433) |
| `PORT` | API port, default 3000 |
| `COOKIE_SECRET` | Signs the login cookie. At least 32 characters, or the API does not start |
| `NODE_ENV` | `production` makes the cookie `Secure` |

The API reads the repository `.env` when `DATABASE_URL` or `COOKIE_SECRET` is not already set.

## API

Described in [api/openapi.yaml](api/openapi.yaml) (OpenAPI 3.0.3, hand-written). The behaviours are in [docs/specs/auth.md](docs/specs/auth.md). All bodies are JSON; errors are `{ "error": "<code>" }`.

| Route | Answer |
|---|---|
| `POST /auth/users/signup`, `POST /auth/organizers/signup` | 201 `{ role, id, email, name }` and the cookie; 400 bad input; 409 email taken |
| `POST /auth/users/login`, `POST /auth/organizers/login` | 200 `{ role, id, email, name }` and the cookie; 400 bad input; 401 wrong email or password (same answer for both) |
| `POST /auth/users/logout`, `POST /auth/organizers/logout` | 204, cookie cleared |
| `GET /auth/me` | 200 `{ role, id, email, name }` for either role (the only "me" route); 401 not logged in |

Seven routes in total. There is no role-specific `GET /auth/users/me` or `GET /auth/organizers/me`; those paths answer 404.

Later routes use the middleware in `api/src/auth/middleware.ts`: `authenticate` puts `req.user` or `req.organizer` on the request, and `requireUser` / `requireOrganizer` answer 401 (no login) or 403 (other role).

## Web routes

From [docs/specs/auth-web.md](docs/specs/auth-web.md) section 2, styled by [docs/brand.md](docs/brand.md).

| Route | Who sees it | Shows |
|---|---|---|
| `/` | Everyone (public) | Attendee home (placeholder) |
| `/login`, `/signup` | Logged out, or an organizer | Attendee login and sign-up form (`POST /auth/users/login`, `/signup`) |
| `/organizer/login`, `/organizer/signup` | Logged out, or an attendee | Organizer login and sign-up form (`POST /auth/organizers/login`, `/signup`) |
| `/organizer` | Organizers (guarded) | Organizer home (placeholder). Logged out: redirect to `/organizer/login?next=/organizer`. Attendee: a wrong-account message |

At start the app calls `GET /auth/me` once (TanStack Query key `["me"]`); 401 means logged out. Login and sign-up put the answer into that cache, so no second call is made, and then go to a safe `?next=` path or the role's home. A person already logged in with the page's role is sent on from the login and sign-up pages. The header shows "Log in", "Sign up" and "For organizers" (or "For attendees" on `/organizer` pages) when logged out, and the name, the role and "Log out" when logged in.

## Project structure

Partly planned. `[TODO: update after the build]`

```
api/                 backend (Express, TypeScript)
  openapi.yaml       the API description (auth routes so far)
  src/app.ts         createApp: JSON, cookie-parser, authenticate, routes
  src/auth/          password hashing, session cookie, middleware, auth routes
  src/db/            pool, migrator, migrations (SQL)
  test/              Vitest tests (auth/, db/)
web/                 frontend (React, Vite, TypeScript)
  src/main.tsx       QueryClientProvider, BrowserRouter, styles.css
  src/App.tsx        header and routes
  src/auth/          api.ts (fetch wrapper), session.ts (useMe and the login, sign-up and
                     logout mutations), validate.ts (client checks, safeNext), guards.tsx
                     (RequireRole, RedirectIfLoggedIn), AuthForm, Header, and their tests
  src/styles.css     brand tokens and styles from docs/brand.md
ROADMAP.md           the order of work, milestones and steps
sessions/            the work log: one markdown file per session
.claude/             agent rules (CLAUDE.md), agents and skills
docs/
  specs/             the specs the build follows (SPEC_TEMPLATE.md)
  planning/          the first build plan (out of date, see ROADMAP.md)
  research/sdd/      research about AI-driven development approaches
  skills/            the skill I used (audited-research)
```

## How it works

The hard cases are handled in the database, not in application code.

- **Last seat, two people at once:** registration runs in one transaction that locks the event row first. The second person waits, then sees that the seat is gone and goes to the waiting list.
- **One seat per email:** a unique constraint on the event and the lowercase email.
- **Cancel and promote:** one locked transaction cancels the seat, promotes the first person on the list (by registration time) and saves the email.
- **Check in once:** one `UPDATE ... WHERE checked_in_at IS NULL` statement. If it changes zero rows, the ticket was already used.
- **One reminder:** a worker runs on a timer and saves a reminder with a unique key per registration and event start time. Two workers, or repeated runs, still give one reminder.
- **Reschedule:** the date changes, and everyone registered or on the waiting list gets an email. A moved event can get a new reminder for the new time.
- **Live counter:** server-sent events, with polling every 2 seconds as a fallback.

## How the behaviour is proven

All of these are automatic tests. `[TODO: fill the Status column with real results and link the test files]`

| Expected behaviour | How it is proven | Status |
|---|---|---|
| Ticket email on registration; same email twice gives one seat | Register twice. One registration, one ticket email, same code | ☐ |
| Seats full, new people go to the waiting list | Capacity 2, register 3, check the statuses | ☐ |
| Cancel gives the seat to the first person and sends an email | Cancel one. The oldest waiting person is registered and gets an email. The next one is unchanged | ☐ |
| Two people compete for the last seat | Capacity 1, 20 registrations at once. Exactly 1 registered and 19 waiting. Repeated 20 times | ☐ |
| One reminder, one day before | Fake clock to 24 hours before. Run the worker many times and with two workers. One reminder per person | ☐ |
| Ticket checks in once | 5 check-ins of one code at once. One succeeds, four are refused | ☐ |
| Arrivals counter updates live | Two browser contexts. Check in on one, and the organizer page in the other updates without reload | ☐ |
| Reschedule emails everyone | Reschedule. One email per registered and waiting person | ☐ |
| Works with two clients open | The two-browser test above, plus a screenshot | ☐ |

## Project status

`[TODO: fill in honestly after the build. Do not copy the plan here.]`

- **Works:** the database schema and migrator. Accounts and login (API only, M1): sign-up, login and logout for attendees and organizers, `GET /auth/me` for either role, the signed 7-day cookie (expiry checked on the server), and the `authenticate`, `requireUser` and `requireOrganizer` middleware. Behaviours A1-A18 of `docs/specs/auth.md` (except the removed A11) have tests in `api/test/auth/` and `api/test/app.test.ts`.
- **Works (web, M9 step 28):** sign-up, login and logout in the browser for both roles, the session from one `GET /auth/me`, the `RequireRole` and `RedirectIfLoggedIn` guards (loading, error with Retry, redirect with `next`, wrong-account message), client checks, the API error texts (400, 401, 409, 5xx and network), pending buttons, focus and aria. Behaviours W-A1 to W-A20 of `docs/specs/auth-web.md` have component tests in `web/src/` (`fetch` mocked). Not covered by a test: the W-A20 part "the cookie is `httpOnly` and the app never reads it" (an API fact, tested in `api/`; the web code has no cookie access). The contract was checked by hand through the dev proxy with `curl` (sign-up 201, a second sign-up 409, `me` 200 with the cookie, logout 204, `me` 401 after it, wrong password 401, bad body 400); the full browser walk-through (reload, redirect back after login) is still to be done by hand.
- **The UI guards are not security.** They only decide what the screen shows. The API is the real guard (`requireUser`, `requireOrganizer`): a person who edits the page in the browser still gets 401 or 403 from the API.
- **Does not work, or not done, and why:** events, registration, waiting list, check-in, emails, live updates and the rest of the web app are not built yet (milestones M2-M8 in `ROADMAP.md`).
- **Known limits of the login:** logout only clears the cookie in the browser (the web app then shows the logged-out header; it cannot do more). A copy of the cookie stays valid until its 7 days end, because there is no sessions table (a test shows this). `sameSite=lax` is the only CSRF defence, which is not full protection (for example a hostile subdomain). No rate limiting, password reset or email verification.
- **Known limits (expected, confirm after the build):** live updates use an in-process event stream, so only one server instance is supported. The reminder worker checks on a timer and uses the server clock. Email is a stub.
- **Assumption:** the task does not say what happens to reminders after a reschedule. I assume one reminder per person per start time.

## How it was built

I built this project together with an AI agent, and I do not hide it.

- **Tool:** Claude Code `[TODO: confirm]`
- **Models:** my default session model is Sonnet 5.5 at medium effort. I use it for research, for writing the spec and for basic work with text. For code I switch to Opus 5.5 at high effort. Both are set as agents in `.claude/agents/`: `spec-writer` and `code-writer`. `[TODO: confirm the exact model names shown by /status at build time]`
- **Why these models:** I use Sonnet for basic work with text, so not many tokens are spent on it. I keep Opus for the code, because from my experience it works well with code, and the code is the part where quality is very important. The research and the first README draft were done in a Claude chat with Sonnet, before the build.
- **Why Claude Code:** from my experience, Claude works best with code. I also have a subscription, and I am used to Claude Code.

My process is a light version of spec-driven development:

1. One spec document. It has the goals and expected behaviour, the UI decisions, the architectural decisions, and the files to touch with what to do in each.
2. Tests first for the hard parts: the last seat, the single reminder and the single check-in.
3. A `SubagentStop` hook on `code-writer` (`.claude/settings.json`, `.claude/hooks/verify-then-review.sh`): it runs `scripts/verify.sh` (typecheck, lint, tests) and blocks until it passes, then makes the agent run a code review and fix the findings.

Why I chose this process is in decision D1 in [sessions/17-10-1532_research.md](sessions/17-10-1532_research.md). The research is in `docs/research/sdd/`, and the skill I used for it is in `.claude/skills/audited-research/`.

## Documentation

- `sessions/*.md`: one file per session with its prompts and decisions (time, reason)
- [ROADMAP.md](ROADMAP.md): the order of work, milestones and steps
- [docs/specs/SPEC_TEMPLATE.md](docs/specs/SPEC_TEMPLATE.md): the template for feature specs (one spec per feature)
- [docs/brand.md](docs/brand.md): colours, type, spacing and components for the web UI. It comes from the [design artifact](https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76) (login and sign-up screens, made from `docs/specs/auth-web.md`); change `brand.md` first when a value changes
- [docs/specs/DATABASE.md](docs/specs/DATABASE.md), [docs/specs/auth.md](docs/specs/auth.md), [docs/specs/auth-web.md](docs/specs/auth-web.md): the database schema, the accounts and login API, the login screens
- [api/openapi.yaml](api/openapi.yaml): the API description (OpenAPI 3.0.3)
- [docs/planning/build_plan.md](docs/planning/build_plan.md): the first build plan, out of date (Fastify, Docker); `ROADMAP.md` replaces it
- [docs/research/sdd/summary.md](docs/research/sdd/summary.md): the research summary (the full report and sources are in the same folder)
- [.claude/skills/audited-research/SKILL.md](.claude/skills/audited-research/SKILL.md): the skill I used for the research
- `sessions/`: the work log, one markdown file per session

## Progress over time

The task asks to see how the work went from start to end. I record it in two places, so that no single one has to be perfect:

- **Git commits:** one commit after every finished step. Commit times are the independent clock. The timeline is `git log --date=iso`.
- **`sessions/`:** one markdown file per session. Each step has my prompt, a short description of what Claude did and which tools it used, and my decision if there was one, with the time. The work before the build was done in a Claude chat, so those steps were written by hand. During the build the agent writes the steps itself, as the rules in `.claude/CLAUDE.md` say.

I do not export the raw session files, only these markdown logs. The agent writes them, so it can forget a step. At the end I compare `git log` with the session files to find gaps.

- **Research and process decision (D1):** the day before, after 15:32 +06 `[TODO: exact time]`
- **Build started:** `[TODO: time and timezone]`
- **Build finished:** `[TODO: time and timezone]`

## Next steps

`[TODO: fill after the build. Ideas from the plan:]`

- Send real emails instead of the outbox stub.
- Add a message queue and a shared event stream, so more than one server instance works.
- Add a real ticket scanner (camera and QR code) next to code entry.
- Send reminders in each participant's own time zone.

## Credits and disclosure

- The project was built together with an AI agent (Claude Code). The prompts, what the agent did and my decisions are in `sessions/`.
- `[TODO: confirm. Planned: no template or generator, except the standard Vite React scaffold.]`
