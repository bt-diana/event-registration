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
