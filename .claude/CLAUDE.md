# Notes for Claude

Event registration service (Task 9). Backend in `api/` (Express, TypeScript, Vitest). Frontend in `web/` (React, Vite, TypeScript, TanStack Query, Vitest). PostgreSQL runs through `docker compose`.

Read `docs/specs/SPEC.md` before you start. All specs are in `docs/specs/`. Decisions are in the session files in `sessions/`.

## Commands

`[TODO: fill in after the projects are created]`

- API tests: `cd api && npm test`
- Web tests: `cd web && npm test`
- Typecheck and lint: `[TODO]`

## History log (part of the task, please follow it)

- After each finished step, make one git commit. Use a short message in the imperative, for example "Add waiting list promotion on cancel".
- Each session has one file in `sessions/`, named `HHMM_short-name.md` (the start time, no date, because the task is finished in one day). Start it when the session starts. Write it as steps, in order. Each step has three parts: **Prompt** (with the time), **What Claude did** (short: what was done and which tools were used), and **Decision** (only if I made one, otherwise write "None"). Add each step to the file as soon as it is finished, not at the end of the session, so nothing is lost if the session stops.
- A decision is written in its step: `### Dn: title`, the time with the UTC offset and no date (get it with `date +"%H:%M:%S %z"`) and a short reason. Use the next ID in the order of all session files. Do not rewrite old entries.
- When you copy my prompts into the session file, fix spelling and grammar and keep the wording otherwise. Say that the text was cleaned.

## Working rules

- Write the tests for the hard parts first: the last seat, the single reminder and the single check-in.
- Do not call a step done before the tests, typecheck and linter pass.
- Keep it simple. Do not add libraries or tooling that are not in the spec. Ask me first.
- When you review your own work, flag only problems that affect correctness or the requirements.
- Use the `spec-writer` agent (Sonnet 5.5, medium) for research and specs, and the `code-writer` agent (Opus 5.5, high) for code. Their files are in `.claude/agents/`.
