# Spec: Event Registration

One document, kept short. The agent reads it before every step. Change it first when a decision changes, then the code. `[TODO]` marks what I still fill in.

## 1. Goals and expected behaviour

**Goal.** `[TODO: one or two sentences. Who uses this and what they get.]`

**Behaviours.** Each line is something that can be checked. The hard ones (marked "test first") get a test before the code.

| # | Behaviour | Test first? |
|---|---|---|
| B1 | Registering by email gives a ticket with a code and sends a ticket email. The same email twice gives one seat. | |
| B2 | When seats are full, new people go to the waiting list. | |
| B3 | Cancelling gives the seat to the first person on the list and sends them an email. | |
| B4 | Two people compete for the last seat: exactly one gets it. | yes |
| B5 | One reminder per person, one day before the event, even if the worker runs many times. | yes |
| B6 | A ticket can be checked in only once. | yes |
| B7 | The arrivals counter on the organizer screen updates live. | |
| B8 | Rescheduling emails everyone registered and on the waiting list. | |
| B9 | `[TODO: anything else the task asks for]` | |

**Out of scope.** `[TODO: accounts, real email sending, payments, camera scanner ...]`

**Assumptions.** `[TODO: for example: one reminder per person per start time, also after a reschedule]`

## 2. UI decisions

| Screen | What it shows and does |
|---|---|
| Event page (public) | `[TODO]` |
| Registration form | `[TODO]` |
| Ticket / registration status | `[TODO]` |
| Organizer: events and counters | `[TODO]` |
| Organizer: check-in | `[TODO]` |

`[TODO: states to handle on every screen: loading, error, empty, full, already checked in.]`

## 3. Architecture decisions

- **Apps:** `api/` (Express, TypeScript) and `web/` (React, Vite, TypeScript, TanStack Query). They talk over HTTP. `[TODO: confirm]`
- **Database:** PostgreSQL 18, installed on Windows (port 5433), no Docker. The connection string is in `DATABASE_URL`. `[TODO: tables and the constraints that matter]`
- **Concurrency:** `[TODO: how B4, B5 and B6 are made safe, for example a row lock, a unique constraint, a conditional UPDATE]`
- **Email:** `[TODO: stub, outbox table and console]`
- **Organizer access:** `[TODO: shared key from an environment variable]`
- **Live updates:** `[TODO: server-sent events with polling as a fallback]`
- **API:** `[TODO: list of routes, one line each]`

## 4. Files to touch

What to create or change, and what to do in each. Updated as the build goes.

| File | What to do | Behaviours |
|---|---|---|
| `api/src/db/migrations/...` | `[TODO]` | |
| `api/src/...` | `[TODO]` | |
| `api/test/...` | `[TODO: tests for B4, B5, B6 first]` | B4, B5, B6 |
| `web/src/...` | `[TODO]` | |
| `README.md` | Run instructions and the honest state | |

## 5. Done means

- Tests, typecheck and linter all pass.
- Every behaviour above has a test, or a note in the README that says it is not covered.
- The README "Project status" says what really works.
