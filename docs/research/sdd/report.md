# AI-native development approach for Task 9 (Event Registration) — research report
Date: 2026-10-17. Tool scored for: Claude Code. Files: `sources.csv` (S01–S32), `search_log.csv`, `blocked_or_failed.csv`, `calc_*.csv`, `score.py`, `build_plan.md`, `archive_pages.sh`.
Labels: **[V]** verified in primary source · **[C2]** corroborated by two independent sources · **[S]** single source · **[I]** inference (mine). "Secondary" and "vendor-written" are marked where they matter.

## 1. Verdict (one screen)

**Primary: "Claude-native spec-lite + test-first".** Not a named framework — I composed it from Anthropic's own documented workflow [V: S05] plus red/green TDD [S: S17]:
1. Let Claude interview you and write one `SPEC.md` (with an end-to-end verification step) [V: S05].
2. Plan in plan mode, then execute in a **fresh session** [V: S05].
3. Write the failing tests for the three hard behaviours first (last-seat race, exactly-one reminder, single check-in), confirm they fail, then implement [S: S17; the confirm-fail step is S17's own caveat].
4. Keep `CLAUDE.md` short; enforce "tests must pass" with a **Stop hook**, not prose, because CLAUDE.md is advisory and hooks are deterministic [V: S04, S05, S06].
5. Review with a fresh-context subagent against SPEC.md [V: S05 describes the pattern].

**Fallback: plain agent red/green TDD** (same tests and hooks, no SPEC.md interview, no per-step decision notes). Switch to it if you are not green on the registration/waitlist core by the 3-hour mark (see `build_plan.md`).

**Why not a named SDD tool (Spec Kit, Kiro, OpenSpec, BMAD)?** The only hands-on independent evidence found says these tools add review load and are mismatched to small tasks: "I'd rather review code than all these markdown files" [S: S12]; "lengthy spec files that are hard to review" [S: S13; same organisation as S12, so NOT independent corroboration]. One practitioner reports 12–16 hours before first code with BMAD [S: S19]. Task 9 is one day, one developer, so [I] they are a poor fit. Kiro is also a separate IDE, not Claude Code [S: S21, vendor-interested; S03 for its files].

**How strong is this?** Weak-to-moderate. **No controlled study compares these approaches on a whole application.** The only empirical SDD study I found is a design with no results [V: S27]; the others are narrow (test generation at Google [S25], one 717k-line case study [S26]) or conceptual [S28]. The ranking below is my rubric (inference); P and F are a statistical tie under the speed weights (see §5).

**Self-audit result:** 7 errors/weaknesses found in my own draft (§9).

## 2. Assumptions and readings
1. "SSD" = spec-driven development (SDD). Other plausible reading: "structured/spec-first software design" in general. Both are covered because P contains a lightweight spec and the survey includes the named SDD tools.
2. Quick local launch = `docker compose up` for Postgres plus npm scripts; no hosting research done (excluded). Requirement 8 ("deployment prerequisites") is met by a README section only.
3. Backend/frontend stack is my recommendation, not researched: Node.js + TypeScript + Fastify, React + Vite, PostgreSQL [I]. Reason: one language across client and server; Postgres gives row locks and unique constraints (S24). Python/FastAPI would work equally well; the decision log should say so.
4. Email is stubbed to an `outbox` table plus console (requirement 10).
5. Loose end (1-day build vs 30-minute audit): I treat them as not in conflict. The 30 minutes audits this report; `build_plan.md` is ~2 pages. If you want a single-page version, keep only §3 timings and §5 proofs of `build_plan.md`.
6. Reminder semantics after rescheduling are unspecified by the task. I assume one reminder per registration per scheduled start time; log this in the decision log.
7. "Today" is 2026-10-17; tool/docs versions are as fetched today (Claude Code docs mention v2.1.283+ features). All pages were read via WebFetch, a **summarizing** tool, so quotes are as returned by the tool and not byte-verified (see §8).

## 3. Control questions (answers you know)
- **Spec Kit workflow commands** [S: S01 + S02, tool-summarized; could not verify against raw README, see blocked_or_failed.csv]: `/speckit-constitution`, `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`, and `/speckit-converge` (hyphen form on the fetched page; docs site lists the phases "Specify → Plan → Tasks → Implement → Converge"). `/speckit-clarify` and `/speckit-analyze` were **not** returned by either page, though I recall them from earlier versions; I cannot confirm them. Opt-in bug-fix and idea-assessment extensions also exist.
- **Kiro's three spec files** [V-ish: S03, one fetch]: `requirements.md` (`bugfix.md` for bugfix specs), `design.md`, `tasks.md`.
- **CLAUDE.md** [V: S04, S05]: a file of instructions you write that gives Claude persistent context, loaded at the start of each session; it is context, not enforced configuration; keep it under ~200 lines; use hooks to enforce.

## 4. Survey: approaches, evidence for, evidence against
| Approach | What it is (primary) | Evidence for | Documented problems (disconfirming) |
|---|---|---|---|
| **Spec Kit** | GitHub's SDD toolkit; phases Specify→Plan→Tasks→Implement→Converge, each producing Markdown that feeds the next [V: S01, S02] | Vendor docs only; Thoughtworks calls space "fascinating" [S: S13] | Agent "ultimately not follow[ed] all the instructions"; duplicated existing classes; "A LOT of markdown files" to review; overkill for 3–5-point feature [S: S12, hands-on Sept 2025]. "Elaborate and opinionated" [S: S13]. User confusion on mandatory test tasks [S: S29, weak] |
| **Kiro** (AWS IDE) | Specs = requirements/design/tasks files [V: S03] | Press hands-on: impressed by output; gated flow [S: S20 plus vendor-interested S21] | "Sledgehammer to crack a nut" on a small bug [S: S12]; specs "mostly static" [S: S20, AWS speaker]; own IDE, AWS credits/lock-in [S: S21, flagged competitor] |
| **OpenSpec** | "lightweight spec layer"; change folder with proposal/specs/design/tasks [V: S10, self-description] | None independent found | Team report: inconsistent use, original intent lost, docs drift [S: S30, **promotional** — promotes AIDLC]. README: stores "in beta"; telemetry on by default [V: S10] |
| **BMAD-METHOD** | Agile-style multi-persona method; v6 stable, v7 alpha with breaking changes [V: S11] | Author finds persistent docs helpful for resuming [S: S19] | 12–16 h before first code; 6 h debugging after an architecture mistake; context/credit exhaustion in "party mode" [S: S19]. README gives no overhead data [V: S11] |
| **Plan-then-execute (plan mode)** | Explore→plan→implement→commit [V: S05] | Anthropic guidance only | Anthropic itself: "adds overhead"; skip if diff fits one sentence [V: S05]. Plan alone does not prove behaviour (trust-then-verify gap) [V: S05] |
| **Agent TDD / red-green** | Write tests, watch them fail, implement [S: S17]; give Claude a runnable check [V: S05] | Giving tests to LLMs improved function-level pass rates (GPT-4, Llama 3; MBPP/HumanEval) [S: S16, 2024, abstract only]; spec-then-test generation +9.8 pp bug detection at Google [S: S25, abstract only, not whole-app] | Agent skips steps, under-tests, generalizes early, lower confidence than human TDD [S: S32]; guidance skipped run to run, behaviour changed with model update [S: S31]. Vendor acknowledges "shortcuts or loopholes" in agentic tasks [S: S23, vendor]. I found **no** direct report of Claude Code editing tests (searched; S31 states it does not report this) |
| **CLAUDE.md / skills / hooks / subagents** | CLAUDE.md = advisory context; hooks = deterministic; skills = `SKILL.md`; subagents = own context [V: S04–S09] | Official docs | "Bloated CLAUDE.md files cause Claude to ignore your actual instructions" [V: S05]; a skill invocation requirement ignored, issue closed not planned [S: S22, mirror, single report] |
| **Named "AI-native SDLC" frameworks** | BMAD (above); Tessl (spec-as-source, per S12); AWS AI-DLC (seen only inside S30) | — | Tessl: "the non-determinism in action" [S: S12]. Not researched further (see §6) |
| **Whole-field context** | — | Specs in the right amount help: "Zero spec ... costly vibe-coding" [S: S18, opinion, no data] | Over-spec "starts confusing the model" [S: S18]; RCT: experienced devs 19% slower with early-2025 AI tools [V: S14], later estimates unreliable [V: S15]; none of this tests SDD |

Cross-cutting conclusions:
- Agents not following written instructions appears in three independent practitioner sources [C2+: S12, S31, S32] and one issue [S: S22]. So **a gate that runs (tests, Stop hook) beats more prose** [I, supported by S04/S05/S06].
- Spec overhead is real for small tasks [S: single organisation, S12 + S13]; the one longer-form data point is S19 (one person, personal project).
- Whether SDD tools beat lean workflows on a 1-day app: **no evidence either way** — label inference.

## 5. Scoring (re-scorable: `calc_raw_scores.csv`, `calc_weights.csv`, `score.py`)
Criteria (0–5, higher is better): C1 speed within 1 day · C2 fit to Claude Code · C3 history/decision-log artifacts · C4 provability · C5 strength of evidence in favour · C6 low documented failure-mode risk · C7 low review burden.
Weight sets: **A speed** (.30/.15/.05/.15/.05/.15/.15) · **B organizers** (.10/.10/.25/.25/.10/.10/.10) · **C equal**.

| Approach | A speed | B organizers | C equal |
|---|---|---|---|
| **P** Claude-native spec-lite + test-first | **4.05** | **4.05** | 3.86 |
| **F** Agent red/green TDD + CLAUDE.md | **4.05** | 3.90 | 3.86 |
| Plan-then-execute only | 3.70 | 3.05 | 3.29 |
| OpenSpec | 3.15 | 3.40 | 3.14 |
| Spec Kit | 2.25 | 2.90 | 2.43 |
| BMAD | 1.80 | 2.70 | 2.14 |
| Kiro | 2.05 | 2.55 | 2.14 |

Read honestly:
- **All raw scores are my judgments [I]**, anchored on the sources cited in this section; C5 (evidence) is low for everything (1–3) because no comparative evidence exists.
- **P vs F is a tie under A and C** (the script's tie order puts P first; do not read that as a win). P leads under B by 0.15, purely from C3 (decision-log artifacts, 4 vs 3). Perturbing any single raw score by ±1 changes the rank-1 approach in 12/89 cases under A and C, 3/89 under B (`calc_sensitivity.csv`).
- The SDD tools stay below P/F under all three weight sets; the closest is OpenSpec (3.40 under B). If you want a named SDD tool for graders, OpenSpec is the least costly [I], but that is not the recommendation.
- Rationale for key scores: C1 BMAD=1 from S19; C2 Kiro=1 (separate IDE, S21); C2 Spec Kit=3 because Claude Code support was not confirmed in the fetched pages (S01 says "other agents ... may use different invocation syntax"); C7 Spec Kit=1 from S12/S13; C4 plan-only=2 from "trust-then-verify gap" (S05).

**Rejected / removed:**
- Kiro — not Claude Code; credits/lock-in (S21, flagged); removed on C2.
- BMAD — time to first code (S19), v7 alpha breaking changes (S11); removed on C1.
- Spec Kit — review burden and small-task mismatch (S12, S13); lowest-ranked of the usable ones, not wholly rejected.
- Plan-only — fastest but nothing proves the three concurrency behaviours (S05); fails requirement 13.
- Tessl — spec-as-source, 1:1 spec-to-code mapping and non-determinism noted by S12; not available/explored, no primary source read.
- AWS AI-DLC and "Consort" (arXiv 2609.09671) — seen only via a promotional post (S30) / unreadable PDF; excluded.
- Unstructured prompting — excluded by brief as a baseline.

## 6. Could-not-find list (queries in `search_log.csv`)
- A controlled or comparative study of SDD tools versus lean workflows on whole apps (search_log.csv: the "spec-driven development criticism" and "empirical study" queries). Found only S25–S28 (narrow, single-case, design-only, conceptual).
- Quantified overhead of Spec Kit/OpenSpec/Kiro (no data; only S12, S13, S19 impressions).
- Raw Spec Kit README / `clarify` and `analyze` command confirmation (gh 403; docs site silent).
- A direct, sourced report of Claude Code editing tests to force a pass (search_log.csv: the "deletes or edits failing tests" query; S31 explicitly doesn't report it). Treat "agent games tests" as plausible [I] (vendor admits shortcut behaviour, S23) but not demonstrated here.
- Whether the Claude Code JSONL lines carry per-message timestamps (S07 says format is internal and changes). **Check one file yourself** before relying on it.
- Primary Anthropic system-card text on test special-casing (blocked_or_failed.csv).

## 7. Fit to Task 9
**13 requirements** (how P covers each; details in `build_plan.md`):
1 client-server: separate `api/` and `web/`, talking over HTTP/SSE · 2 Node/TS justified in the session decisions file (assumption 3) · 3 React · 4 PostgreSQL via docker compose; locks per S24 · 5 no accounts (organizer token or none; log it) · 6 decision log and prompts (session files and transcripts) · 7 state AI use openly in README · 8 README "Prerequisites" (Node, Docker, ports) · 9 `docker compose up` + `npm run dev` · 10 outbox-table email stub · 11 two-tab proof: SSE counter + Playwright two-context test · 12 README "State" with works / doesn't / not done / why · 13 the three concurrency tests plus test log committed.
**7 deliverables:** repo link · model/tool statement (2 sentences; name the exact model shown in `/status` at build time — I do not know which you will use) · prompts + session export (see below) · timestamped progress (commits + decision log + session JSONL) · README with deploy steps and state · `NEXT.md` · disclosure (no template used, or list what was).
**Timestamped progress with Claude Code** [V: S06, S07]:
- Sessions are saved as JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`, default retention 30 days (`cleanupPeriodDays`); `/export` writes a readable text file; a `SessionEnd` hook can archive the transcript (the hook receives `transcript_path`); SessionEnd hooks share a 1.5-second budget, so keep the hook to a `cp`.
- Commit after every timed step (the git timestamp is the independent clock). Name sessions with `/rename` or `claude -n`. Add one dated entry to the session decisions file per decision.
- Caveats: JSONL format is internal and may change [V: S07], and the transcript may contain secrets — scan before publishing [I]. Also save `/export` text as the human-readable copy.

## 8. How sources were read, and limits
- Every page was read with **WebFetch**, which runs a small model over the converted page. Text inside double quotes in `sources.csv` is what that tool returned as a quote; it is not guaranteed verbatim. The Claude Code docs pages (S04–S07) came back as long near-verbatim text, and S04 and S06 quotes were re-checked by grep against saved output. For other rows, the quote column is the tool's output; I normalised curly apostrophes to straight.
- Archive copies: none (no archive tool in this session). `archive_pages.sh` submits all URLs to the Wayback Machine when run elsewhere.
- Vendor-written: S01–S11, S23 (by their makers); promotional/vendor-interested: S21, S30. Independent secondary: S12, S13 (same organisation), S17, S18, S20, S31, S32.
- Arxiv items: abstracts only, peer-review status not checked.

## 9. Self-audit (re-read of stored output / my draft)
I re-read saved output for S04 and S06 by grep, and re-compared S05, S12, S13, S25 and S19 rows against the tool text in the transcript. Errors and weaknesses found in my own draft:
1. **Independence error:** my working notes treated S12 and S13 as two independent sources for "SDD adds review burden". Both are Thoughtworks. Downgraded to single-source.
2. **Spec Kit command list:** my memory included `clarify`/`analyze`; the fetched pages did not. I now state only the six returned and flag the rest unconfirmed.
3. **Tie risk:** the script ranked P above F by input order under weight sets A and C. Now disclosed as a tie.
4. **Overclaim risk:** I had planned to list "agents editing tests to pass" as a documented failure. The searches found no source saying so (S31 explicitly does not); reworded to "not demonstrated".
5. **Disconfirming gap:** the OpenSpec row had none after the first research pass because I had not searched for it. I ran a targeted search and added S30 (itself promotional).
6. **Quote normalisation:** curly apostrophes in S12/S13 rows were converted to straight; wording otherwise unchanged. The date of S17 comes from page metadata, not text.
7. **Mirror status conflict:** S22 page says both "Closed — not planned" and "Resolved" in metadata; I report only the former, flagged mirror.
Not audited: whether Claude Code supports each SDD tool end-to-end (only S10 states "30+ tools"); this affects C2 scores for Spec Kit and BMAD (3 each, inference).
