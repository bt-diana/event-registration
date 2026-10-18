# Session: README check (M9)

## Step 1: check the README and add the demo link

**Prompt** (23:58 +0600, text cleaned)

> check that readme is up to date (M9)
> add demo link: https://event-registration-web-rmbi.onrender.com

**What Claude did.** Read `README.md`, `ROADMAP.md`, `.env.example`, `api/package.json`, `web/vite.config.ts`, `web/src/App.tsx` and the latest sessions; compared them with the code (Read, Grep, Bash). Fixed: migrations "001 to 004" to "001 to 005", the missing `/me` dev proxy, the missing organizer emails page route and files, the Render build and start commands (`tsconfig.build.json`, `node dist/index.js`, migrations are run by hand), stale status lines (events list screen, emails screens, reschedule/cancel), and marked cancel and promotion as not built (M4). Added the demo link under the title and in the Render section. Added a line to the `ROADMAP.md` Done list. The hosted web service setup is not described because it is not in the repository.

**Decision.** None

## Step 2: local setup of the database and the environment

**Prompt** (text cleaned)

> also mention how to run locally, how to set up the env, and what is needed to run PostgreSQL

**What Claude did.** Read `api/src/db/run-migrations.ts` and `pool.ts` (the migrator does not create the database; `.env` is read from the repo root). Rewrote the README "Prerequisites" and "Run locally": added the `CREATE DATABASE events` step, a table of the four required `.env` values with a command for `COOKIE_SECRET`, the Resend key, and the migrate and start order (Bash, Read, Edit via a Python script).

**Decision.** None
