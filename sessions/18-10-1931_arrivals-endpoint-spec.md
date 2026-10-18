# Session: arrivals endpoint spec

Started 18-10 19:31 +06.

## Step 1: reverse D45 and ask for a separate arrivals endpoint spec

**Prompt** (19:31 +06, text cleaned)

> write a new spec
> we should have a separate endpoint that returns the capacity and the number of registered arrivals

**What Claude did.** Read `SPEC_TEMPLATE.md`, `checkin.md` (C16, open question 5) and `checkin-web.md` (W-C1, W-C4) and the last decisions (D45 said no arrivals route, D46 is the last ID). Started this session file. Delegated to the `spec-writer` agent, which wrote `docs/specs/arrivals.md` (AR1-AR15): `GET /events/:id/arrivals`, organizer only, `{ event_id, capacity, registered, arrived }`, one SQL statement with `count ... FILTER`, `no-store`, tests-first list, what it supersedes (D45, `checkin.md` C16, `checkin-web.md` W-C1/W-C4/W-C11) and a follow-up edits list, six open questions with recommendations. The agent did not read `DATABASE.md`, `openapi.yaml` or `auth.md`; guards were checked against `api/src/checkin/routes.ts`. Added the spec to `ROADMAP.md` and `README.md`. Used Read, Grep, Bash, Agent.

**Decision.**

### D47: add a separate arrivals endpoint, replacing D45
19:31:18 +0600. The counter gets its own route that returns the capacity and the number of arrived people, instead of being counted in the browser from the registrations list. Reason: the user asks for it; the capacity is not in the list.

## Step 2: response shape is `{ registered, arrived }`

**Prompt** (19:40 +06, text cleaned)

> return a js object {registered: n, arrived: m}

**What Claude did.** Changed `docs/specs/arrivals.md`: the answer has only `registered` and `arrived` (no `event_id`, no `capacity`); AR2, AR6, AR7, the SQL, the shape line, the route table and open questions 1, 2 and 5 follow. Updated the `ROADMAP.md` line. Used Bash.

**Decision.**

### D48: arrivals answer is `{ registered, arrived }`
19:33:58 +0600. Two numbers only; the capacity is not returned. Reason: the user asked for exactly this object.
