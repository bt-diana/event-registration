# Notes for Claude

Event registration service (Task 9). Backend in `api/` (Express, TypeScript, Vitest). Frontend in `web/` (React, Vite, TypeScript, TanStack Query, Vitest). PostgreSQL 18 runs as a Windows service on port 5433 (no Docker). The connection string is in `DATABASE_URL`.

Read `docs/specs/SPEC_TEMPLATE.md` before you start. All specs are in `docs/specs/`. Decisions are in the session files in `sessions/`.

## Commands

- API tests: `cd api && npm test`
- Web tests: `cd web && npm test`
- Typecheck: `cd api && npm run typecheck`, `cd web && npm run typecheck`
- Lint: `cd api && npm run lint`, `cd web && npm run lint`
- Database: `psql -p 5433 -U postgres` (PostgreSQL 18 on Windows)

## History log (part of the task, please follow it)

- After each finished step, make one git commit. Follow the Conventional Commits convention: `type(scope): description`, with a type like `feat`, `fix`, `test`, `docs`, `refactor`, `build` or `chore`, a short scope when it helps, and a short imperative description in lowercase without a final period. For example `feat(api): promote first waiting person on cancel` or `test(api): add last-seat concurrency test`. Put a tests-first commit before the code commit that makes it pass.
- Work directly on `main`. Do not create branches: branches are for team work and I am the only team member. Commit to `main` after each step once the tests, typecheck and linter pass.
- Each session has one file in `sessions/`, named `DD-MM-HHMM_short-name.md` (the start date and time, for example `17-10-2130_research.md`). Start it when the session starts. Write it as steps, in order. Each step has three parts: **Prompt** (with the time), **What Claude did** (short: what was done and which tools were used), and **Decision** (only if I made one, otherwise write "None"). Add each step to the file as soon as it is finished, not at the end of the session, so nothing is lost if the session stops.
- A decision is written in its step: `### Dn: title`, the time with the UTC offset and no date (get it with `date +"%H:%M:%S %z"`) and a short reason. Use the next ID in the order of all session files. Do not rewrite old entries.
- When you copy my prompts into the session file, fix spelling and grammar and keep the wording otherwise. Say that the text was cleaned.

## Working rules

- Write the tests for the hard parts first: the last seat, the single reminder and the single check-in.
- Do not call a step done before the tests, typecheck and linter pass.
- Keep it simple. Do not add libraries or tooling that are not in the spec. Ask me first.
- When you review your own work, flag only problems that affect correctness or the requirements.
- Use the `spec-writer` agent (Sonnet 5.5, medium) for research and specs, and the `code-writer` agent (Opus 5.5, high) for code. Their files are in `.claude/agents/`.
