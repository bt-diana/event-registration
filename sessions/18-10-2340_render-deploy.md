# Session: deploy on Render

## Step 1: fix `npm start` (module not found)

**Prompt** (about 23:42 +0600, text cleaned)

> fix the issue: `npm run start` fails with "Cannot find module `api\dist\index.js`"

**What Claude did.** Found that `tsc` writes `dist/src/index.js` because `rootDir` is `.` and `test/` and `scripts/` are compiled too. Changed the `start` script to `node dist/src/index.js`, built and started it (Bash, Read). Commit `245ec1a`.

**Decision.** None

## Step 2: questions about `COOKIE_SECRET` and the web env

**Prompt** (about 23:47 +0600, text cleaned)

> do I need to set COOKIE_SECRET?
> I'm deploying on Render, should I set the API url for the frontend in env?
> what variable in env do I need for the web?
> so, how does it know what API to call?
> but my backend and frontend are built as separate services

**What Claude did.** Read `api/src/app.ts`, `api/src/db/pool.ts`, `.env.example`, `web/vite.config.ts` and `web/src/auth/api.ts` (Grep, Bash). Answered: `COOKIE_SECRET` is required (32+ characters) in the repo-root `.env`; the web has no env variable and calls relative paths with same-origin cookies; the API has no CORS. Suggested Render rewrite rules on a Static Site as the link between the two services. Noted that the built code looked for `.env` in `api/` (fixed later by step 4). No code change.

**Decision.** None

## Step 3: root build and start scripts for Render

**Prompt** (about 23:53 +0600, text cleaned)

> fix the issue: Render build fails, `/opt/render/project/src/package.json` not found
> add a start script to run in Render

**What Claude did.** Explained that the repo root has no `package.json` and the Root Directory setting was wrong. Added a root `package.json` with `build` (`cd api && npm install --include=dev && npm run build`) and `start`, after `npm --prefix api install` wrongly added the root package to the API dependencies (reverted). Added a "Deploy on Render" section to `README.md` (Bash, Python script for the edit). Commit `562929e`. The root scripts were removed again later by the user (`a4b2419`).

**Decision.** None

## Step 4: build only `src` so the build skips the tests

**Prompt** (about 23:55 +0600, text cleaned)

> (Render log) `test/...` errors: cannot find module `vitest`, `@types/node`, and others

**What Claude did.** Found that the build compiled `test/` and `scripts/` without the dev dependencies. Added `api/tsconfig.build.json` (`rootDir: src`, include `src`), pointed `npm run build` at it and put `start` back to `node dist/index.js`. The built code now finds the repo-root `.env`. Typecheck, lint and 631 tests passed (Bash, Edit). Commit `8407152`.

**Decision.** None

## Step 5: Render settings (Root Directory and install)

**Prompt** (about 00:01 +0600, text cleaned)

> fix issues: (Render log) `tsc -p tsconfig.build.json` ... cannot find module `express`, `pg`, `process`

**What Claude did.** Read the log: the build ran inside `api/` with no `npm install`, so the service Root Directory is still `api` and the root scripts are not used. No code change. Told the user to set the Build Command to `npm install --include=dev && npm run build` and to clear the build cache.

**Decision.** None

## Step 6: outbound IP addresses (not a connection)

**Prompt** (about 00:02 +0600)

> here's how to connect web to api: (pasted the Render outbound IP ranges)

**What Claude did.** Explained that the pasted text is the outbound IP list for allowlisting, not a way to connect the web to the API, and that Render Postgres should use the internal database URL. No code change.

**Decision.** None

## Step 7: web gets the API URL from the environment

**Prompt** (about 00:03 +0600, text cleaned)

> this does not work, let's provide the API url in env for the web

**What Claude did.** Read `api/src/auth/cookie.ts`, `web/src/auth/api.ts` (the only `fetch`), `web/vite.config.ts` and the specs list. Because this changes behaviour, started the spec first: launched the `spec-writer` agent to write `docs/specs/api-base-url.md` (`VITE_API_URL` for the web, `CORS_ORIGIN` and a `SameSite=None` cookie for the API, no new libraries). Warned that browsers that block third-party cookies will drop the login between two `onrender.com` addresses; a custom domain fixes it. Code and tests come after the spec.

**Decision.**

### D79: the web calls the API at `VITE_API_URL` instead of Render rewrites

00:04:55 +0600. The rewrite rules did not work for the user, so the web and the API use separate origins: the web reads `VITE_API_URL` at build time, the API sends CORS headers for `CORS_ORIGIN` and uses a `SameSite=None` cookie in production. Without `VITE_API_URL` nothing changes (local dev proxy).

## Step 8: log the session

**Prompt** (00:05 +0600, text cleaned)

> capture this session in sessions

**What Claude did.** Wrote this file from the conversation and the git log (Bash, Read).

**Decision.** None

## Step 9: spec and code for `VITE_API_URL`

**Prompt** (about 00:10 +0600, text cleaned)

> add env variable

**What Claude did.** The `spec-writer` agent wrote `docs/specs/api-base-url.md` (decisions P1 to P4, behaviours R1 to R11); closed its two open questions and committed it (`886762d`). Then the `code-writer` agent worked tests first: `8dcdf8c` adds `api/test/cors.test.ts`, the cross-site cookie cases in `api/test/auth/cookie.test.ts` and the new `web/src/auth/api.test.ts`; `ed5e12d` adds `api/src/cors.ts` (hand-written, first middleware in `app.ts`), the `SameSite=None` cookie when `CORS_ORIGIN` is set in production, and `request()` in `web/src/auth/api.ts` reading `VITE_API_URL` on each call. Updated `.env.example`, `README.md` (Deploy on Render, environment table) and `ROADMAP.md`. Typecheck, lint and tests passed in both apps (api 645, web 1054). The only `fetch(` in `web/src` is inside `request()`. The two commits carry the `Co-Authored-By: Claude Opus 5.5` line, because the agent is Opus 5.5.

On Render still to do by hand: set `VITE_API_URL` on the Static Site (before the build) and `CORS_ORIGIN` plus `NODE_ENV=production` on the Web Service, then redeploy. A Static Site with client-side routes probably also needs a `/*` to `/index.html` rewrite; this was not checked.

**Decision.** None

## Step 10: one env file per app

**Prompt** (text cleaned)

> add VITE_API_URL to .env.example
> let's split env to api and web and add VITE_API_URL

**What Claude did.** Added `VITE_API_URL=` to the root `.env.example` (`3ee3d7f`, `9d60d85`), then split the env files: `.env.example` moved to `api/.env.example` (without the web section), new `web/.env.example` with `VITE_API_URL`, the local `.env` moved to `api/.env`. `api/src/db/pool.ts` now loads `api/.env` (`../../.env`, which is right from both `src/db` and `dist/db`). Updated the README, a short section 7 in `docs/specs/api-base-url.md`. Typecheck, lint and 645 api tests pass; the built API starts and reads `api/.env` (Bash, Python, Edit).

**Decision.** None
