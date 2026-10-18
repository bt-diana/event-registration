# Build plan — Task 9 Event Registration (approach P, about 2 pages)
Budget: 8 h build + 1 h buffer. Commit after every step (commit timestamps are your independent clock). Stack is my recommendation [inference], see report assumption 3.

## 1. Architecture
- `api/` Node.js + TypeScript + Fastify, `pg`, Vitest. `web/` React + Vite. `docker-compose.yml` runs PostgreSQL 16 (and optionally the api).
- Tables: `events(id, title, description, starts_at, capacity, version)`; `registrations(id, event_id, email_lower, status in registered|waitlisted|cancelled, waitlist_pos/created_at, ticket_code unique, checked_in_at, created_at)` with **unique(event_id, email_lower)** among active rows (re-register = same row, no second seat); `outbox(id, registration_id, kind in ticket|promotion|reminder|reschedule|cancel, event_starts_at, payload, created_at)` with **unique(registration_id, kind, event_starts_at)** for reminder (exactly-one by constraint, not by timing).
- **Last-seat race:** in one transaction, `SELECT ... FROM events WHERE id=$1 FOR UPDATE`, count `registered`, insert as registered or waitlisted. The row lock makes concurrent registrants queue: "other transactions that attempt ... SELECT FOR UPDATE ... of these rows will be blocked until the current transaction ends" (S24, PostgreSQL docs).
- **Cancel + auto-promote:** same locked transaction: mark cancelled, take first waitlisted ordered by (created_at, id), set registered, write `promotion` outbox row.
- **Check-in once:** `UPDATE registrations SET checked_in_at=now() WHERE ticket_code=$1 AND status='registered' AND checked_in_at IS NULL RETURNING id`; zero rows returns 409 "already checked in / invalid".
- **Reminder:** worker (setInterval 30 s, injected clock) selects registered rows of events starting within 24 h, inserts `reminder` outbox rows with `ON CONFLICT DO NOTHING`. Two workers or repeated ticks still yield one row.
- **Reschedule:** update `starts_at`, insert `reschedule` outbox rows for all registered and waitlisted people. Reminder key includes `starts_at`, so a moved event can get a fresh reminder; log this decision (assumption 6).
- **Live counters:** `GET /events/:id/stats` plus SSE `/events/:id/stream` (in-process emitter; fine for one local server). Fallback: 2 s polling.
- **Email stub:** outbox row is the "email"; a stub sender prints it and sets `sent_at`. Tests assert on outbox rows.
- No accounts. Organizer pages guarded by a shared `ORGANIZER_KEY` env var (or none; log choice).

## 2. Timed steps (each ends with a commit)
| Time | Step | Claude Code move |
|---|---|---|
| 0:00–0:45 | Repo, `CLAUDE.md` (commands, test runner, "run `npm test` before finishing"), Stop hook running tests, SessionEnd hook copying transcript to `sessions/`. Interview prompt, produce `SPEC.md` incl. acceptance table | Interview prompt from S05; then `/clear` |
| 0:45–1:30 | Plan mode: schema, API list, ADRs into the session decisions file (timestamped lines) | `claude --permission-mode plan`; edit plan with Ctrl+G |
| 1:30–3:00 | **Red:** write 3 hard tests + registration/waitlist/cancel tests, run, show failing. **Green:** migrations, services | Fresh session; tests before code |
| 3:00 | **Checkpoint:** if registration/waitlist core not green, switch to fallback F (drop SPEC/ADR ceremony, keep tests and hooks) | — |
| 3:00–4:00 | Tickets, check-in, reschedule, outbox, reminder worker | tests first for each |
| 4:00–5:30 | React: event list/create, register/cancel/ticket page, check-in (code entry), organizer counts + reschedule | Screenshot-compare loop (S05) optional |
| 5:30–6:30 | Two-tab proof, Playwright two-context test, subagent review of diff vs `SPEC.md` ("flag only correctness/requirement gaps", per S05) | `.claude/agents/reviewer.md` |
| 6:30–7:30 | README (run, prerequisites, honest state), `NEXT.md`, export sessions, disclosure | `/export`; copy JSONL |
| 7:30–8:30 | Buffer: flaky tests, polish | — |

## 3. How each "Expected behavior" item is proven (all in `npm test` against real Postgres)
| Expected behavior | Proof |
|---|---|
| Ticket email on registration; same email twice = one seat | Test: register twice, assert 1 row, 1 `ticket` outbox row, same ticket code |
| Seats full → waitlist | Test: capacity 2, register 3, assert statuses |
| Cancel → first waitlisted promoted + email | Test: cancel one, assert oldest waitlisted is `registered` and a `promotion` outbox row exists; second waitlisted unchanged |
| **Last seat, concurrent** | Test: capacity 1, 20 concurrent `Promise.all` registrations with different emails; assert exactly 1 `registered`, 19 `waitlisted`; repeat 20 times |
| **Reminder exactly one** | Test: fake clock to T-24h; run worker tick 10x concurrently and with two worker instances; assert exactly 1 `reminder` row per registered person; waitlisted get none (log decision) |
| **Ticket checks in once; counter live** | Test: 5 concurrent check-ins of one code → one 200, four 409; arrivals = 1. Playwright: two browser contexts, check in on one, organizer page in the other shows arrivals +1 without reload |
| Reschedule → everyone emailed | Test: reschedule, assert one `reschedule` row per registered + waitlisted person |
| Works in two tabs | Playwright two-context test; manual screenshot in README |

Honest limits to write in README: SSE is in-process (single server only); reminder worker is polling; no real SMTP; reminder timing uses server clock; no accounts.

## 4. Prompts and history capture (Claude Code)
- Commit per step; session file one dated entry per decision; prompts live in the session transcripts.
- `sessions/*.jsonl` from the SessionEnd hook (transcripts default to `~/.claude/projects/<project>/<id>.jsonl`, 30-day retention, S07); `sessions/*.txt` from `/export`. Scan for secrets before pushing. Verify one JSONL to see whether lines carry timestamps (not verified by me).
