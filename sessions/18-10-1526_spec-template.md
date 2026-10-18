# Session: reset SPEC.md to a template

Started 18-10 15:26 +06.

## Step 1: reset SPEC.md to the template

**Prompt** (15:26 +06, text cleaned)

> let's fix docs/specs/SPEC.md; it should be just a template

**What Claude did.** Read `SPEC.md` and found it filled in with decisions (B1 and B9-B10, sign-up screens, database, concurrency, login, organizer access, the migration row). Took the original template from the first commit (`8fd5bb1`) and restored it. Changed two lines that were stale there: the Database line (PostgreSQL 16 with docker compose, now a `[TODO]` without docker) and the `docker-compose.yml` row (now `api/src/db/migrations/...`). The filled-in version stays in git history, and `DATABASE.md` still holds the database details. Used Read, Glob, Bash.

### D28: SPEC.md is only a template
**Time:** 15:26:58 +0600

`SPEC.md` keeps the structure and `[TODO]` markers only. Decisions live in `DATABASE.md`, the session files and git history.

## Step 2: rename to SPEC_TEMPLATE.md

**Prompt** (15:28:07 +0600, text cleaned)

> rename it to SPEC_TEMPLATE

**What Claude did.** Ran `git mv docs/specs/SPEC.md docs/specs/SPEC_TEMPLATE.md`. Did not change the other files that still mention `SPEC.md` (`CLAUDE.md`, both agent files, `README.md`, `DATABASE.md`, `build_plan.md`); asked the user first. Used Bash.

**Decision.** None.
