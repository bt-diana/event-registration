# Event Registration

A small service for event registration. An organizer creates an event with a limited number of seats. People register by email, and at the entrance they are checked in with a ticket code. When seats run out, new people go to a waiting list. When someone cancels, the first person on the list gets the seat and an email.

This is my solution for Task 9. I built it together with an AI agent.

**Demo:** https://event-registration-web-rmbi.onrender.com (log in with the accounts in "Demo logins" below).

The sending domain in Resend is verified, so emails go to any real address. To test the email sender, register for an event with your own email address (sign up as a new attendee with a real mailbox you can open). The demo accounts use placeholder `@seed.test` addresses, which have no mailbox, so no emails are sent for them.

## Features

- **Events:** description, date and time, seat limit. The organizer can reschedule an event, change its seat limit (raising it seats the first people on the list) or cancel it; the people registered or waiting get an email, and a moved event gets a new reminder.
- **Registration:** by email. Registering again with the same email does not create a second seat. A participant can cancel from the ticket page; the row is kept as `cancelled`.
- **Waiting list:** when seats run out, new people go to the list. A cancellation gives the seat to the first person on the list, and they get an email.
- **Tickets:** every registered person gets a ticket with a code. A ticket can be checked in only once.
- **Check-in screen:** the organizer scans the ticket QR code with the camera, or types the ticket code.
- **Organizer screen:** how many people are registered, on the waiting list, and have arrived. The arrivals counter is read again when the organizer opens the page (not live).
- **Emails:** ticket on registration, seat from the waiting list, one reminder one day before the event, and a notice when the event is rescheduled.

## Tech stack

| Part | Choice |
|---|---|
| Backend | Node.js, TypeScript, Express 5, `pg`, `cookie-parser`, Vitest; `qr-creator` 1.0.0 (same exact version as the web) and `canvas` 3 (node-canvas, native; draws the ticket QR for the emails, D77). On Windows x64 with Node 22 `npm install` takes a prebuilt `canvas` binary; without one for your platform, npm compiles it, which needs Cairo and build tools |
| Frontend | React, Vite, TypeScript, TanStack Query, `react-router` (v7, declarative routes), plain CSS, Vitest; `qr-creator` 1.0.0 (draws the ticket QR) and `qr-scanner` 1.4.2 (reads it from the camera), both by Nimiq, exact versions (D46) |
| Database | PostgreSQL 18 (Windows service, port 5433) |
| Email | Sent through [Resend](https://resend.com). Every email is a row in the `outbox` table; a timer sends it through Resend (the `resend` package, D58), at most 3 tries, then `error_sending`. Each email is sent as html and plain text, built from the stored row at send time; ticket, promotion and reminder emails carry the ticket QR as an inline image (D76, D77) |
| Deploy | Render: the API is a Web Service with a Render Postgres, the web is a Static Site (see "Deploy on Render") |
| Accounts | Attendees and organizers sign up with email and password. Passwords are stored as an `scrypt` hash with a random salt (`node:crypto`). Login is one signed `session` cookie that lasts 7 days; no sessions table |

The backend and the frontend are separate apps. They talk over HTTP. The reasons for these choices are in the decisions in `sessions/`. Email is sent for real through Resend (D58); the sending domain is verified in Resend, so mail reaches any address when `MAIL_FROM` is on that domain; with the default `onboarding@resend.dev` Resend delivers only to the account owner (see "Environment").

## Getting started

### Prerequisites

- Node.js 22 (the tested version; 20.12 or newer is the minimum, because the API loads `.env` with Node's built-in loader) and npm
- PostgreSQL 18 with the `psql` command, listening on port 5433 (this project runs it as a Windows service, no Docker). Any recent PostgreSQL on another port works if `DATABASE_URL` says so. No extensions are needed
- Free ports: 3000 (API), 5173 (web) and 5433 (database)
- A [Resend](https://resend.com) account with an API key. The API refuses to start without one (see "Environment")

### Set up the database

The migrator creates the tables but not the database itself, so create an empty one first (use your own `postgres` password):

```bash
psql -p 5433 -U postgres -c "CREATE DATABASE events;"
```

The tests use the same server: each test file creates and drops its own throw-away schema inside the database from `DATABASE_URL`, so the `postgres` user (or any user that may create schemas) is needed.

### Set up the environment

Copy `api/.env.example` to `api/.env` (the API reads it from there; it is git-ignored, never commit it) and fill in:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | `postgres://postgres:<your password>@localhost:5433/events` |
| `COOKIE_SECRET` | At least 32 random characters: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` |
| `EMAIL_API_KEY` | Your Resend API key |
| `MAIL_FROM` | `onboarding@resend.dev` (without a verified domain Resend delivers only to your own account address) |

`PORT` (3000) and `EMAIL_JOB_INTERVAL_MS` (10000 in the example) can stay as they are. All variables are described under "Environment" below.

### Run locally

```bash
# 1. PostgreSQL must be running and the database and .env must be ready (above).

# 2. Backend
cd api
npm install
npm run db:migrate   # applies the pending .sql files in api/src/db/migrations/ (001 to 005); "Nothing to apply" on a repeat
npm run dev

# 3. Frontend (in a new terminal)
cd web
npm install
npm run dev
```

Open http://localhost:5173 and log in with a demo account (see "Demo logins"; migration 005 created them).

Starting the API with a real Resend key sends every `pending` outbox row of that database, so use a test database.

Locally leave `VITE_API_URL` and `CORS_ORIGIN` unset: the web app then calls the API on its own origin. In development the Vite dev server proxies `/auth`, `/events`, `/public`, `/checkin` and `/me` to the API on http://localhost:3000 (`web/vite.config.ts`), so no CORS is needed and `fetch` uses `credentials: "same-origin"`. This proxy exists only in `npm run dev` and `npm run preview`. A production build either is served from the same origin as the API (for example behind one reverse proxy), or is built with `VITE_API_URL` and calls the API on its own origin with CORS (see "Deploy on Render").

### Open the app on a phone

The phone and the PC must be on the same Wi-Fi. Start the API as above, then start the web app so it listens on the network:

```bash
cd web
npm run dev:host        # dev server with live reload, http://<PC address>:5173
# or, for the built app:
npm run build
npm run preview:host    # http://<PC address>:4173
```

Find the PC's Wi-Fi address with `ipconfig` (the IPv4 address of the Wi-Fi adapter, for example `192.168.0.107`) and open `http://<that address>:5173` on the phone. Only the web app needs `--host`: the phone reaches the API through the Vite proxy on the PC.

- **The page does not load (Windows Firewall).** Windows blocks incoming connections to Node.js by default. When the prompt "Windows Defender Firewall has blocked some features of Node.js" appears, tick **Private networks** and click **Allow access**. If you missed the prompt, open PowerShell **as administrator** and run `New-NetFirewallRule -DisplayName "Vite dev 5173" -Direction Inbound -Protocol TCP -LocalPort 5173,4173 -Action Allow -Profile Private` (remove it later with `Remove-NetFirewallRule -DisplayName "Vite dev 5173"`). The Wi-Fi network must also be set to **Private** (Settings, Network & internet, Wi-Fi, your network). Check that the phone is not on mobile data or a guest network.
- **The camera does not start.** Browsers allow the camera only on https or `localhost`, so over `http://<PC address>` the scan screen shows "The camera needs a secure connection (https or localhost). Enter the code below." Typing the code and showing the ticket QR still work. For a camera test on Android Chrome, open `chrome://flags/#unsafe-treat-insecure-origin-as-secure`, add the address, enable it and restart Chrome (testing only). iPhone Safari has no such switch: use an https tunnel or a local certificate (not set up here).

### Deploy on Render

The demo runs on Render: https://event-registration-web-rmbi.onrender.com. The web and the API are two services on two `onrender.com` origins (`docs/specs/api-base-url.md`, D79):

- **API, a Web Service.** Root Directory `api`, Build Command `npm install --include=dev && npm run build` (compiles `api/src` with `tsconfig.build.json` into `api/dist/`, tests excluded), Start Command `npm start` (the `start` script applies the pending migrations with `npm run db:migrate`, then runs the built API; `tsx` comes from the dev dependencies installed in the build). Environment: the variables from `api/.env.example` (`DATABASE_URL`, `COOKIE_SECRET`, `EMAIL_API_KEY`, `MAIL_FROM`), plus `NODE_ENV=production` and `CORS_ORIGIN=https://<web>.onrender.com` (the web origin exactly: https, no path, no trailing slash). With both set the API answers CORS for that one origin (credentials allowed, no wildcard) and the login cookie is `SameSite=None; Secure`, so the browser sends it on the cross-site calls. The API process applies no migrations by itself; the `start` script runs them before it starts, so nothing has to be run by hand.
- **Web, a Static Site.** Root Directory `web`, Build Command `npm install && npm run build`, Publish Directory `dist`. Environment: `VITE_API_URL=https://<api>.onrender.com` (the API origin only, no path; a trailing slash is ignored). Vite puts the value into the bundle at build time, so set it before the build and rebuild the site after every change. With it the web calls `<VITE_API_URL>/auth/...` with `credentials: "include"`.

**Known limit.** `onrender.com` is on the public suffix list, so the two `*.onrender.com` origins are different sites and the session cookie is a third-party cookie for the web. Browsers that block third-party cookies (Safari, Chrome with that setting on) do not keep the login. A custom domain with the web and the API on sibling subdomains of one domain (for example `app.example.com` and `api.example.com`) fixes it; nothing in the code needs to change for that. `SameSite=None` also drops the `Lax` defence from `auth.md`: the exact `CORS_ORIGIN` check and `HttpOnly` remain, and CSRF protection is out of scope.

`api/render.yaml` is a Render Blueprint for the API service and its Postgres (variables, build and start commands, health check at `/health`; `COOKIE_SECRET` is generated, `EMAIL_API_KEY`, `MAIL_FROM` and `CORS_ORIGIN` are asked for). Render looks for the file in the repository root, so create the Blueprint with the file path `api/render.yaml`. Its start command runs the migrations; it does not create the Static Site.

**What to put in `VITE_API_URL` for a built version.** The public URL of the API service, origin only: `https://<api>.onrender.com`. No path, no trailing slash. It must be set in the Static Site environment before the build; to build locally against that API put the same line in `web/.env` (copy `web/.env.example`). Empty means relative calls (the dev proxy). To check a deployed build, open the Network tab: the requests must go to the API address, not to the web address. If they go to the web address, the variable was not set at build time.

**Deploy checklist.**

1. Create the Render Postgres and copy its Internal Database URL into the API as `DATABASE_URL`.
2. Nothing to run by hand: `npm start` applies the migrations before it starts the API. Running `npm run db:migrate` from your machine also works if the database accepts your IP and SSL (`?sslmode=require`).
3. Set the API variables (`COOKIE_SECRET`, `EMAIL_API_KEY`, `MAIL_FROM`, `NODE_ENV=production`) and deploy the API; copy its URL.
4. Set `VITE_API_URL` to that URL on the Static Site and deploy it; copy the web URL.
5. Set `CORS_ORIGIN` to the web URL on the API and redeploy the API.
6. A reload on a page such as `/events/:id` must not break the app. The web build copies `dist/index.html` to `dist/404.html`, and a Render Static Site serves `404.html` for a path it does not find, so the app loads and the router shows the page. Nothing to set. The cleaner option is a rewrite of `/*` to `/index.html` in the Render dashboard (Redirects/Rewrites), which answers 200 instead of 404; add it if you like.

### Demo logins

Migration `005_seed_test_data.sql` adds test data: one organizer, five events on 20-24 October 2026 (the TypeScript Workshop on 21 October is full with two people waiting), eight attendees and their registrations. The addresses are placeholders with no mailbox, and no emails are sent for them. Every demo account uses the password `demo1234`.

| Role | Login | Password |
|---|---|---|
| Organizer | `organizer@seed.test` | `demo1234` |
| Attendees | `attendee1@seed.test` to `attendee8@seed.test` | `demo1234` |

The migration runs on every database the migrator touches, so remove these accounts before any real deployment.

### Try it with two clients

Open the registrations page (`/registrations`) in one browser tab and the check-in screen in another. Register a person and check the ticket in: the arrivals counter on the check-in screen goes up at once. The first tab shows the new number and the "Arrived" cell after you return to the registrations page (or reload it): nothing is live, there is no polling (D50, D51).

### Run the tests

```bash
cd api && npm test      # runs against the real database (each test file uses a throw-away schema)
cd api && npm run typecheck && npm run lint
cd web && npm test      # unit tests
cd web && npm run typecheck && npm run lint
bash scripts/verify.sh      # typecheck, lint and tests for api and web, stops at the first failure
cd api && npm run email:preview -- <folder>   # writes the five emails as html files and ticket-qr.png, sends nothing
```

### Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (port 5433) |
| `PORT` | API port, default 3000 |
| `COOKIE_SECRET` | Signs the login cookie. At least 32 characters, or the API does not start |
| `NODE_ENV` | `production` makes the cookie `Secure` |
| `CORS_ORIGIN` | Optional. The one web origin allowed to call the API with the cookie (for example `https://<web>.onrender.com`). With `NODE_ENV=production` the cookie becomes `SameSite=None`. Leave it unset locally |
| `VITE_API_URL` | Web, optional, read at build time. The API origin the web calls (for example `https://<api>.onrender.com`). Unset or empty: relative calls through the dev proxy. Leave it unset locally. Name documented in `web/.env.example` (Vite reads `web/.env`) |
| `EMAIL_API_KEY` | The Resend API key. Required: missing or blank, the API prints the variable name and exits with code 1 (D59). Never commit it |
| `MAIL_FROM` | The sender, passed to Resend as it is (`onboarding@resend.dev` or `Name <address>`). Required, like the key |
| `EMAIL_JOB_INTERVAL_MS` | How often the email round runs (reminders, then the sender). Default in code 3600000 (1 h, D63); `api/.env.example` sets 10000 (10 s) for development. A whole number of at least 1000, else the API does not start |

The API reads `api/.env` when `DATABASE_URL` or `COOKIE_SECRET` is not already set.

**Resend free tier:** without a verified domain Resend delivers only to the address of the account owner; emails to any other address end as `error_sending` after 3 tries (with the provider's reason in `send_error`, addresses replaced). Note that starting the API with a real key sends every `pending` outbox row of the dev database.

## API

All routes, bodies, answers and error codes are described in [api/openapi.yaml](api/openapi.yaml) (OpenAPI 3.0.3, hand-written). Bodies are JSON; errors are `{ "error": "<code>" }`. The behaviour behind each route is in the specs in `docs/specs/`.

## Web routes

Styled by [docs/brand.md](docs/brand.md). The web paths avoid the API prefixes `/events` and `/public`, so one origin can serve both.

| Route | Who | What it shows |
|---|---|---|
| `/` | Everyone | The public list of upcoming events |
| `/login`, `/signup` | Attendees | Log in or create an attendee account |
| `/organizer/login`, `/organizer/signup` | Organizers | Log in or create an organizer account |
| `/organizer` | Organizers | My events, with registered / capacity, and "Create event" |
| `/organizer/events/new` | Organizers | The create form |
| `/event/:id` | Everyone | One link for every viewer. The owner sees the organizer view (numbers, reschedule, cancel event). Everybody else sees the public view with a register button, the waiting-list button or their ticket |
| `/registrations/me` | Attendees | My registrations, one card each. With `?event={id}`: the ticket page with the code and the QR |
| `/registrations` | Organizers | The registrations of one event, the arrivals counter and a link to each attendee's emails |
| `/registrations/:registrationId/emails?event={id}` | Organizers | The emails sent to one attendee, with their status |
| `/registrations/scan?event={id}` | Organizers | Check-in: scan the ticket QR with the camera or type the code |

Logged-out people are sent to the right login and come back afterwards. A person with the wrong role is sent to their own screen. These guards only decide what is shown; the API is the real guard. Nothing refreshes by itself: a screen reads its data when it opens and when you return to it.

## Project structure

```
api/                 backend (Express, TypeScript)
  openapi.yaml       the API description
  src/auth/          password hashing, session cookie, middleware, auth routes
  src/events/        organizer and public event routes, reschedule and cancel
  src/registrations/ register, my registration, my registrations list
  src/checkin/       check-in, organizer registrations list, arrivals
  src/email/         outbox sender (Resend), email templates and QR, reminder worker, timer, email routes
  src/db/            pool, migrator, SQL migrations (001 to 005)
  test/              Vitest tests
web/                 frontend (React, Vite, TypeScript)
  src/auth/          session, guards, login and sign-up forms, header
  src/events/        event list, create form, event pages, reschedule and cancel
  src/registrations/ register, tickets and QR, registrations lists, arrivals, scan screen, emails page
  src/styles.css     brand tokens and styles from docs/brand.md
ROADMAP.md           the order of work, milestones and steps
sessions/            the work log: one markdown file per session
.claude/             agent rules (CLAUDE.md), agents and skills
docs/                specs, brand, database notes, research and planning
```

## How it works

The hard cases are handled in the database, not in application code.

- **Last seat, two people at once:** registration runs in one transaction that locks the event row first. The second person waits, then sees that the seat is gone and goes to the waiting list.
- **One seat per account:** registering needs a login, so the same email is the same account. Inside the locked transaction an active registration of the account is answered again (200, same ticket); a partial unique index on (event, user) for active rows is the safety net.
- **Cancel and promote:** one locked transaction cancels the seat, promotes the first person on the list (by `queue_no`, the order they joined the list) and saves the email.
- **Check in once:** one `UPDATE ... WHERE checked_in_at IS NULL` statement. If it changes zero rows, the ticket was already used.
- **One reminder:** a worker runs on a timer and saves a reminder with a unique key per registration and event start time. Two workers, or repeated runs, still give one reminder.
- **Reschedule:** one transaction with the same event lock as registering moves the start, bumps the schedule version, deletes the pending reminders with the old time and saves one email for everyone waiting or registered (not yet checked in). A moved event gets a new reminder for the new time, also when it moves back (A -> B -> A -> B). The reminder worker takes a share lock on the event, so it cannot slip in an old reminder behind a reschedule.
- **Cancel the event:** the same locked transaction marks the event cancelled, cancels the waiting and not checked-in registrations, saves one email for each and deletes the pending reminders. A second cancel does nothing. Registering and check-in on a cancelled event are refused.

## How the behaviour is proven

The hard parts have automatic tests that run against the real database (API) or with a mocked `fetch` (web):

| Behaviour | Test |
|---|---|
| Last seat: 20 people register at once for 1 seat, exactly 1 gets it and 19 wait | `api/test/registrations/` |
| One seat per account, also with 5 parallel requests | `api/test/registrations/` |
| One reminder per person and start time, also with parallel workers | `api/test/email/reminders.test.ts` |
| An email is sent once, retried, then marked `error_sending` after 3 tries | `api/test/email/sender.test.ts` (fake transport) |
| A ticket checks in once, also with 5 parallel check-ins | `api/test/checkin/` |
| Reschedule and cancel the event: one email per person, a second cancel writes nothing | `api/test/events/` |
| Screens and guards | `web/src/` |

Not done yet: a real email delivery through Resend by hand, and the two-browser test with a screenshot.

## Project status

**Works**
- Accounts and login for attendees and organizers (signed 7-day cookie).
- Events: an organizer creates events (title, description, start, duration, seats), lists their own, reschedules and cancels them. Anyone sees the public list and the event page.
- Registration: an attendee registers, goes to the waiting list when the event is full, and sees their ticket with a code and a QR. The last seat is safe against parallel requests.
- Check-in: the organizer scans the QR or types the code. A ticket checks in once. The registrations list and the arrivals counter are read again when the page opens.
- Cancel and capacity (M4): an attendee cancels their ticket (`POST /events/:id/registrations/me/cancel`; a checked-in ticket answers 409 `already_checked_in`); the first waiting person gets the seat and a `promotion` email. The organizer changes the seat limit (`POST /events/:id/capacity`; below the registered count answers 409 `capacity_below_registered`; a raise seats the first waiting people). Both run in the event lock, so the seats never go above the limit.
- Emails: ticket, seat from the waiting list, reschedule, event cancelled and one reminder 24 hours before the start. They are sent as html and plain text through Resend from a timer, with 3 tries. The organizer sees the status of each email.
- Demo data (migration 005) and a deploy on Render.

**Known limits**
- Resend delivers to any address only when `MAIL_FROM` is on the verified domain. With `onboarding@resend.dev` (no domain) only the account owner's address works and other addresses end as `error_sending`.
- On `onrender.com` the login cookie is a third-party cookie, so Safari and Chrome with third-party cookies blocked do not keep the login (see "Deploy on Render").
- The cookie cannot be revoked before its 7 days end (no sessions table). There is no rate limiting, password reset or email verification.
- `sent` means the provider accepted the email, not that it arrived. Delivery is at least once.
- Checked by hand: the real camera and QR scan work, and the organizer screen runs on the Render demo.
- Not checked by hand yet: the phone layout at 320 and 390 px, and one real email delivery.

## How it was built

I built this project together with an AI agent, and I do not hide it.

- **Tool:** Claude Code
- **Models:** my default session model is Sonnet 5.5 at medium effort. I use it for research, for writing the spec and for basic work with text. For code I switch to Opus 5.5 at high effort. Both are set as agents in `.claude/agents/`: `spec-writer` (model `sonnet`, effort medium) and `code-writer` (model `opus`, effort high).
- **Why these models:** I use Sonnet for basic work with text, so not many tokens are spent on it. I keep Opus for the code, because from my experience it works well with code, and the code is the part where quality is very important. The research and the first README draft were done in a Claude chat with Sonnet, before the build.
- **Why Claude Code:** from my experience, Claude works best with code. I also have a subscription, and I am used to Claude Code.

My process is a light version of spec-driven development:

1. One spec document. It has the goals and expected behaviour, the UI decisions, the architectural decisions, and the files to touch with what to do in each.
2. Tests first for the hard parts: the last seat, the single reminder and the single check-in.
3. A `SubagentStop` hook on `code-writer` (`.claude/settings.json`, `.claude/hooks/verify-then-review.sh`): it runs `scripts/verify.sh` (typecheck, lint, tests) and blocks until it passes, then makes the agent run a code review and fix the findings.

Why I chose this process is in decision D1 in [sessions/17-10-1532_research.md](sessions/17-10-1532_research.md). The research is in `docs/research/sdd/`, and the skill I used for it is in `.claude/skills/audited-research/`.

## Documentation

- `docs/specs/`: the specs the build follows, one per feature, written from [SPEC_TEMPLATE.md](docs/specs/SPEC_TEMPLATE.md) before any code or tests
- [api/openapi.yaml](api/openapi.yaml): the API description
- [docs/brand.md](docs/brand.md): colours, type, spacing and components for the web UI. It comes from the [design artifact](https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76); change `brand.md` first when a value changes
- [docs/DATABASE.md](docs/DATABASE.md): the database schema
- [ROADMAP.md](ROADMAP.md): the order of work, milestones and steps
- `sessions/`: the work log, one markdown file per session with its prompts and decisions (time, reason)
- `docs/research/sdd/`: research about AI-driven development approaches ([summary](docs/research/sdd/summary.md)), made with the skill in `.claude/skills/audited-research/`
- [docs/planning/build_plan.md](docs/planning/build_plan.md): the first build plan, out of date (Fastify, Docker); `ROADMAP.md` replaces it
