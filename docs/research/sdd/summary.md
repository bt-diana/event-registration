# Summary: how to build Task 9 with an AI agent (audited)

Date: 2026-10-17. Full report: `report.md`. Evidence: `sources.csv` and the other files in this folder.

**The short answer.** Don't use a named spec tool for a one-day project. Use a light version instead. Have Claude interview you and write one `SPEC.md`. Write the tests for the three hard behaviours first. Add a hook that stops Claude from saying "done" until the tests pass. If the core is not working by hour 3, drop the spec step and just do test-first.

**The best options.**

*1. Light spec + test-first (score 4.05 out of 5 under both speed and organizer weights).* This is a lightweight form of spec-driven development (SDD), without a named toolkit like Spec Kit (GitHub's toolkit that runs a fixed chain of spec, plan and task steps) or Kiro (Amazon's own code editor built around spec files). The researcher built it from Anthropic's own advice: Claude interviews you, writes SPEC.md, and a fresh session builds from it. Tests come first for the last-seat race, the one-only reminder and the one-only check-in. It also makes the notes the organizers ask for, such as a decision log. Main risk: nobody has tested this exact mix, and the scores are the researcher's judgment.

*2. Plain test-first with a short CLAUDE.md (4.05 under speed weights, 3.90 under organizer weights).* This is the fallback. Same tests and hooks, no spec interview. Main risk: agents sometimes skip steps. Three independent practitioners say so.

*Near miss:* OpenSpec scored 3.40 under the organizer weights. It is the lightest of the named tools.

**The weak options.** GitHub Spec Kit (2.25 under speed weights, 2.90 under organizer weights) and Kiro (2.05 and 2.55) create lots of Markdown to review. A Thoughtworks writer said "I'd rather review code than all these markdown files". Kiro is also its own IDE, not Claude Code. BMAD scored 1.80 and 2.70. One person reported 12 to 16 hours before the first line of code. Plan-then-execute alone scored 3.70 under speed weights, but nothing in it proves the three concurrency behaviours.

**Hard facts about your goal.** The build plan is 8 hours of work plus a 1-hour buffer, so it fits "about a day". Tasks 1 to 3 hours in are the spec, the plan and the first failing tests. The three behaviours that decide whether the project counts as working are the concurrent last seat, the single reminder and the single check-in. The plan proves each with a test against a real PostgreSQL database, plus a two-browser test for the live counter.

**Other findings that change the plan.**
There is no controlled study comparing these approaches on a whole app. The ranking rests on practitioner reports and the researcher's scoring. The best-known study (METR) found experienced developers were 19% slower with early-2025 AI tools. It says nothing about spec tools, and its later update was called unreliable.
You asked about "AI-native SDLC" frameworks. Only BMAD was really covered. Tessl and AWS AI-DLC were seen only in a promotional post and were not researched.
The stack in the plan (Node, Fastify, React, PostgreSQL) is a suggestion, not researched.
Claude Code's docs say the session file format is internal and changes between versions. Whether each line has a timestamp was not verified. Check one file yourself. Git commit times are the safe clock. Scan session files for secrets before publishing.
The task doesn't say what a reminder should do after a reschedule. The plan assumes one reminder per start time. Log it as a decision.

**What to do next.** Spend the first 45 minutes on `SPEC.md`, `CLAUDE.md` and the hooks. At the 3-hour mark, check whether registration, waitlist and cancel tests pass. If yes, continue. If no, switch to the fallback and drop the spec work.

**Caveats.** All scores are the researcher's judgment, not measurements. Evidence quality is weak to moderate. The researcher found 7 errors or weaknesses in its own draft and fixed them. I fetched 7 sources myself (Claude Code best practices, Martin Fowler's SDD article, the BMAD blog post, Kiro's docs, the Spec Kit README, the METR study, Claude Code's sessions page) and checked about 20 quotes and facts. All matched, none were wrong. I used the same kind of summarizing tool as the researcher, so this is a sample, not proof. The control questions (Spec Kit commands, Kiro files, what CLAUDE.md is) were also answered through that tool. No archive copies exist, so those links can break. Run `archive_pages.sh` somewhere that can reach archive sites.

**Where it is saved.** In this session's outputs folder, `ai-native-dev-2026-10-17/`: `report.md`, `build_plan.md`, `summary.md`, `sources.csv` and the scoring files. I could not reach your "App research" project from here.

Sources (fetched during the audit):
- https://code.claude.com/docs/en/best-practices
- https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- https://dev.to/arch4g/my-experience-using-the-bmad-framework-on-a-personal-project-patience-required-28aa
- https://kiro.dev/docs/specs/
- https://github.com/github/spec-kit
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- https://code.claude.com/docs/en/sessions
