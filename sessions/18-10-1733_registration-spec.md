# Session: registration spec

Started 18-10 17:33 +06.

## Step 1: write the spec for M3 (api)

**Prompt** (17:33 +06, text cleaned)

> implement spec for M3 for api

**What Claude did.** Read `ROADMAP.md` and the last session files. `registration.md` did not exist yet, so Claude asked what "implement" meant; the answer was "spec only". Gave the `spec-writer` agent the M3 scope. It wrote `docs/specs/registration.md`: behaviours R1-R21 (tests first: B4 as R8 and R9, B1 and B2 as R4-R6, guards R15, own ticket only R19), routes `POST /events/:id/registrations` and `GET /events/:id/registrations/me`, one transaction with `FOR UPDATE`, a `ticket` outbox row only for registered people, 409 for cancelled and passed events. Marked roadmap step 13 done and listed the spec in `README.md`. Open questions are in the last section of the spec: running events, repeat request on a closed event, 200 vs 201 for a repeat, cancelled ticket on "my registration", nested route. Used Read, Bash, AskUserQuestion, Agent (`spec-writer`).

**Decision.** None.
