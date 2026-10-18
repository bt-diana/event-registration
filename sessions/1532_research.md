# Session 15:32: research on development approaches

Chat session, the day before the others, before the build. It was done in a Claude chat, so the steps below were written by hand. Each step has my prompt, what Claude did, and my decision if there was one. The prompts have spelling and grammar fixed and the wording otherwise unchanged. Times are Asia/Bishkek (UTC+06), with no dates. The session started at about 15:32 (the time Claude created its session folder). Exact times for the steps were not recorded.

## Step 1: research request

**Prompt** (about 15:32 +06)

> Let's research what kinds of approaches to AI-native development already exist (e.g., SDD, AI-native SDLC),
> which of them work best,
> and which will suit my task best.

The task text from the organizers was pasted after it.

**What Claude did.** Ran my `audited-research` skill. It asked me four questions (deadline about one day, tool Claude Code, 30 minutes for the audit, also a full build plan). It wrote a brief and acceptance criteria, then started one researcher subagent that searched and fetched sources (WebSearch and WebFetch, 32 sources logged) and scored the options. Then an independent audit: Claude fetched 7 sources and compared about 20 quotes and facts with the pages (all matched), and recalculated the scores with `score.py`. Output: `report.md`, `summary.md`, `sources.csv`, `build_plan.md` and the search and scoring files. The prompt the researcher received is in `docs/research/sdd/researcher_prompt.md`.

**Decision.**

### D1: a light version of spec-driven development (SDD)

**Time:** after 15:32 +06 `[TODO: exact time]`

**Context.** Before writing code, I wanted to choose a way of working with an AI agent. The researcher surveyed GitHub Spec Kit, Kiro, OpenSpec, BMAD-METHOD, Anthropic's AI-native SDLC playbook, and test-first development with agents. The audit was a sample, not a proof, and it used the same kind of summarizing fetch tool as the researcher.

**Decision.** I use a light version of SDD: one spec document, tests first for the hard parts, and a verification hook that runs tests, typecheck and linter.

**Why:**

- **My own experience.** When I used Anthropic's AI-native SDLC playbook, writing the artifacts took a lot of time and did not bring much value for me. I want a lighter process.
- **Time.** Task 9 is about one day of work. Every extra file is time I have to review.
- **What the research found.** The named toolkits add many files to review. One Thoughtworks writer said he would "rather review code than all these markdown files". Anthropic's own docs say plan mode adds overhead. The playbook is written for organizations and has no separate guidance for small projects.
- **The hard parts need running checks, not documents.** The last seat, the single reminder and the single check-in must be proven by tests. Anthropic's docs describe `CLAUDE.md` as advisory and hooks as deterministic, so the hook is the gate.

**What I rejected.** A full spec toolkit (Spec Kit, Kiro, BMAD-METHOD), because it is too heavy for one day. Plan-then-execute alone, because nothing in it proves the concurrency behaviour. The full AI-native SDLC playbook, because it did not work for me before.

**Limits of the evidence.** I found no controlled study that compares these methods on a whole application. This choice is a judgment, based on documentation, practitioner reports and my own experience.

**Research files:** `docs/research/sdd/` (`report.md`, `summary.md`, `sources.csv`, `researcher_prompt.md` and the `evidence/` folder). The skill I used is in `.claude/skills/audited-research/SKILL.md`.

## Step 2: questions about the summary

**Prompts** (later the same session, no times recorded)

> Isn't it SDD?
>
> What are these? (Spec Kit and Kiro)
>
> What are BMAD and OpenSpec? What are the origins of all the methods and toolkits you found?

I also sent the link to Anthropic's AI-native SDLC playbook.

**What Claude did.** Answered from the report and from the playbook page, which it read and added to the report. It fixed the summary wording to say the chosen approach is a lightweight form of SDD, and explained what Spec Kit and Kiro are in plain words.

**Decision.** None.
