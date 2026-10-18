# Event Registration

A small service for event registration. An organizer creates an event with a limited number of seats. People register by email, and at the entrance they are checked in with a ticket code. When seats run out, new people go to a waiting list. When someone cancels, the first person on the list gets the seat and an email.

This is my solution for Task 9. I built it together with an AI agent.

> **Draft.** Nothing is built yet. `[TODO]` marks what I fill in during and after the build. The "Project status" section must only say what really works.

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
| Backend | Node.js, TypeScript, Express, `pg`, Vitest |
| Frontend | React, Vite, TypeScript, TanStack Query, Vitest |
| Database | PostgreSQL 16 |
| Email | Stub. Every email is saved in an `outbox` table and printed to the console |
| Accounts | None. The organizer pages use one shared key from an environment variable `[TODO: confirm]` |

The backend and the frontend are separate apps. They talk over HTTP, and the live counter uses server-sent events. The reasons for these choices are in the decisions in `sessions/`. The task allows stubs for external services, so email is not sent for real.

## Getting started

`[TODO: confirm versions and commands after the build]`

### Prerequisites

- Node.js 20 or newer
- Docker (for PostgreSQL)
- Free ports: 3000 (API), 5173 (web) and 5432 (database)

### Run locally

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Backend
cd api
npm install
npm run migrate
npm run dev

# 3. Frontend (in a new terminal)
cd web
npm install
npm run dev
```

Open http://localhost:5173.

### Try it with two clients

Open the organizer screen in one browser tab and the check-in screen in another. Register a person, check in the ticket, and watch the arrivals counter change in the first tab without a reload.

### Run the tests

```bash
cd api && npm test      # runs against the real database
cd web && npm test      # unit tests
cd web && npm run e2e   # two-browser test [TODO: confirm]
```

## Project structure

Planned. `[TODO: update after the build]`

```
api/                 backend (Express, TypeScript)
web/                 frontend (React, Vite, TypeScript)
docker-compose.yml   PostgreSQL
sessions/            the work log: one markdown file per session
.claude/             agent rules (CLAUDE.md), agents and skills
docs/
  specs/             the specs the build follows (SPEC.md)
  planning/          the build plan for this task
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

- **Works:** `[TODO]`
- **Partly works:** `[TODO]`
- **Does not work, or not done, and why:** `[TODO]`
- **Known limits (expected, confirm after the build):** live updates use an in-process event stream, so only one server instance is supported. The reminder worker checks on a timer and uses the server clock. Email is a stub. There are no accounts.
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
3. A verification hook that blocks "done" until the tests, typecheck and linter pass.

Why I chose this process is in decision D1 in [sessions/1532_research.md](sessions/1532_research.md). The research is in `docs/research/sdd/`, and the skill I used for it is in `.claude/skills/audited-research/`.

## Documentation

- `sessions/*.md`: one file per session with its prompts and decisions (time, reason)
- [docs/specs/SPEC.md](docs/specs/SPEC.md): the spec the build follows
- [docs/planning/build_plan.md](docs/planning/build_plan.md): the build plan for this task
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
- Add organizer accounts instead of one shared key.
- Add a real ticket scanner (camera and QR code) next to code entry.
- Send reminders in each participant's own time zone.

## Credits and disclosure

- The project was built together with an AI agent (Claude Code). The prompts, what the agent did and my decisions are in `sessions/`.
- `[TODO: confirm. Planned: no template or generator, except the standard Vite React scaffold.]`
