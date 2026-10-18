# Session 12:58: README, stack and docs layout

Chat session, before the build. It was done in a Claude chat, so the steps below were written by hand. Each step has my prompt, what Claude did, and my decision if there was one. The prompts have spelling and grammar fixed and the wording otherwise unchanged. Times are Asia/Bishkek (UTC+06), with no dates. The file name time (12:58) is when the work in this session was last written down. Exact times for the steps were not recorded, but all of them are before 13:01.

## Step 1: README draft

**Prompt** (before 13:01 +06)

> Please draft a README for the task.
> Also, include my first decision:
>
> Used my audited-research skill to research suitable AI-driven development practices. Came to the conclusion that I need a lightweight version of SDD, because...

**What Claude did.** Drafted a README from the task text and the build plan: features, stack, run instructions, how the hard cases are handled, how the behaviour is proven, honest status. It marked everything that is not built with `[TODO]`. It wrote my first decision (D1) into it.

**Decision.**

### D2: asked AI to draft the README

**Time:** before 13:01 +06 `[TODO: exact time]`

I asked the AI to draft the README for the task, including my first decision (D1). The draft has `[TODO]` markers for everything that is not built yet.

## Step 2: review of the draft

**Prompts** (before 13:01 +06)

> Is this required by the task? (email stub)
>
> What's this? (Fastify)
>
> Replace it with Express.
>
> Add a request package.

**What Claude did.** Explained that the task allows stubbed email. Explained Fastify. Replaced it with Express in the stack and the structure. For the request package it asked me which one I wanted (AskUserQuestion), and I chose TanStack Query.

**Decisions.**

### D3: Express instead of Fastify

**Time:** before 13:01 +06 `[TODO: exact time]`

The suggested backend framework was Fastify. I replaced it with Express, because Express is still light-weight and it is a standard.

### D4: TanStack Query for API requests

**Time:** before 13:01 +06 `[TODO: exact time]`

I added TanStack Query, because from my experience it is much easier to use a query library than plain `fetch`.

## Step 3: README rewrite

**Prompt** (before 13:01 +06)

> Rewrite the README with /my-writing-tone and a more common README structure.
> Write the decision log in a separate document and just reference it in the README.

**What Claude did.** Loaded my `my-writing-tone` skill and rewrote the README in plain language with the usual sections (description, features, stack, getting started, structure, how it works, status, next steps). It moved the decisions into a separate file and linked it. Then, when I asked, it saved all needed docs, the used skills (except `my-writing-tone`), the research and its summary into a folder, and suggested a repository name and description.

**Decision.** None.

## Step 4: logging system and docs layout

**Prompt** (before 13:01 +06)

> Yes, write those.
> Also, update /docs.
> Separate the README research and the SDD research.
> Or do we even need to keep those files?
> Anyway, align with the suggested log system.

**What Claude did.** Wrote the `SessionEnd` hook (`.claude/settings.json` and `scripts/archive-session.mjs`), a progress script, and the logging rules for `CLAUDE.md`. It tested the scripts on Linux with made-up input. It split the docs into `docs/planning/` and `docs/research/sdd/`, and updated the README to match. It answered that the report, summary and sources are worth keeping and `evidence/` is optional.

**Decisions.**

### D5: how the history is logged

**Time:** before 13:01 +06 `[TODO: exact time]`

**Decision.** The history is kept in two places, so that no single one has to be perfect: git commits (one per step) and `sessions/` (transcripts copied by a hook, plus one file per session with its prompts and decisions). The prompts are not copied anywhere else, because the transcripts hold them word for word.

**Why:**

- The task asks to see that the work happened step by step, with timestamps from start to end.
- The transcript file format is internal to Claude Code and can change, and I have not confirmed that every line has a timestamp. So the commits, the index and the decision times must also tell the story.
- `CLAUDE.md` is advisory, so the agent may skip the logging rules. The transcript copy is a hook, which is deterministic. At the end I check `git log` against the session files to find gaps.

(The first version had four places, and used a hook that copied the raw session files. Later steps in `1315_logging-system.md` simplified it: D15 removed the hook and the raw files.)

### D6: docs layout, keep the research and split it from the plan

**Time:** before 13:01 +06 `[TODO: exact time]`

**Decision.** I keep the research files in the repo, in two places:

- `docs/research/sdd/` for the research about development approaches. The report, summary and sources are at the top. The search log, the scoring files and the scripts are in `evidence/`.
- `docs/planning/build_plan.md` for the plan for this task, which the README architecture started from.

**Why keep them.** D1 rests on this research, and the organizers can check it. The report, summary and sources are the part that matters. The evidence folder can be deleted without breaking anything, but then the claims cannot be re-checked.
