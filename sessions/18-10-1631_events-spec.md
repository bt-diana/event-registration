# Session: events spec

Started 18-10 16:31 +06.

## Step 1: write the spec for M2 (api)

**Prompt** (16:31 +06, text cleaned)

> write spec for M2 for api

**What Claude did.** Read `ROADMAP.md`, `DATABASE.md` and the last session file. Gave the `spec-writer` agent the M2 scope. It wrote `docs/specs/events.md`: behaviours E1-E17 (tests first: E4 own list, E7 other organizer's event gives 404, E9 guards, E13 public answer leaks nothing), routes `POST/GET /events`, `GET /events/:id` (organizer) and `GET /public/events/:id` (no login), validation, seats left, files, done means. Marked roadmap step 5 done. Open questions in section 6: past or cancelled event on the public page (200 with flags or 404), the `/public/events/:id` path, whether to show `capacity`, no pagination. Used Read, Bash, Agent (`spec-writer`).

**Decision.** None.
