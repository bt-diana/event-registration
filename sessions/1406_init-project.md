# Session 14:06: init the project

Build session, Claude Code. Times are Asia/Bishkek (UTC+06), with no dates. Prompts have spelling and grammar fixed (text cleaned) and the wording otherwise unchanged.

## Step 1: scaffold the repo

**Prompt** (14:06 +06)

> init the project repo

**What Claude did.** Read `SPEC.md` and the build plan, checked the repo (already a git repo on `main`, clean) and the tools (Node 22, npm 10, Docker not installed). Created branch `chore/init-project`. Scaffolded `api/`, `web/`, `docker-compose.yml` and `.gitignore` with only the libraries named in the spec. Used Read, Glob, Bash, Write.

**Decision.** None.

## Step 2: work on main only

**Prompt** (14:07 +06)

> let's not use different branches, keep all work in main
> because branches are meant for team work
> and I'm the only team member

**What Claude did.** Fast-forward merged `chore/init-project` into `main` and deleted the branch. Replaced the branch rule in `.claude/CLAUDE.md` with a work-on-`main` rule. Used Bash.

**Decision.**

### D16: no branches, work on `main`

**Time:** 14:07:54 +0600

Branches are for team work and there is one person on this project, so they only add merge steps. All commits go straight to `main`.

## Step 3: bind the database to localhost

**Prompt.** None. An automated security-review notice named `docker-compose.yml` but gave no details. It was not a message from me.

**What Claude did.** Saw that Postgres was published on all interfaces with a dev password. Changed the port mapping to `127.0.0.1:5432:5432`. Used Bash.

**Decision.** None.

## Step 4: add the linter

**Prompt** (after the question about ESLint)

> yes

**What Claude did.** Added ESLint with typescript-eslint (recommended rules) to `api/` and `web/`, with an `npm run lint` script in each. The install failed because `typescript-eslint` does not support TypeScript 7, so both apps were pinned to TypeScript ~6.0. Lint, typecheck and tests pass in both. Filled in the lint command in `.claude/CLAUDE.md`. Used Bash.

**Decision.**

### D17: ESLint with typescript-eslint, TypeScript pinned to 6.0

**Time:** 14:09:19 +0600

The task needs a linter and the spec names none. ESLint with typescript-eslint is the common choice. It forced TypeScript ~6.0 because the newest release is outside its supported range.

## Step 5: Postgres 18 in Docker

**Prompt** (after the database options)

> Use the Windows Postgres 18 with docker

**What Claude did.** Found Docker 29.8.2 installed but not on the PATH, and the engine not running (Docker Desktop not started). Read the prompt as "run Postgres 18 in a Docker container". Changed `docker-compose.yml` to `postgres:18` on `127.0.0.1:5434` (the Windows services use 5432 and 5433) and moved the volume to `/var/lib/postgresql`, the data path for the 18 image. Changed "PostgreSQL 16" to 18 in `SPEC.md` and the README. Used Bash and PowerShell.

**Decision.**

### D18: PostgreSQL 18 in Docker on port 5434

**Time:** 14:23:37 +0600

Postgres 18 is installed here and is the latest version, so the container uses it instead of 16. Port 5434 is free; 5432 and 5433 belong to the Windows services.

## Step 6: no Docker, Windows Postgres 18

**Prompt** (interrupted the Docker setup)

> Use the Windows Postgres 18 with no docker

**What Claude did.** I had read the previous prompt as "Postgres 18 in a container". Removed `docker-compose.yml` and changed `SPEC.md`, `README.md` and `.claude/CLAUDE.md` to use the Windows service on port 5433. Used Bash.

**Decision.**

### D19: Windows PostgreSQL 18, no Docker

**Time:** 14:23:55 +0600

Postgres 18 is already installed and running here, so Docker only adds a second database to keep running. This replaces D18 (container on port 5434) and the spec's "PostgreSQL 16 with `docker compose`".

## Step 7: create the database

**Prompt** (14:3x +06, text cleaned)

> I ran `psql -p 5433 -U postgres events` and got: `FATAL: database "events" does not exist`.

**What Claude did.** Explained that the login works and only the database is missing, and gave the `CREATE DATABASE events` command to run (the password is not shared with Claude). Added `.env.example` with `DATABASE_URL` and updated the README step. Used Bash.

**Decision.** None.
