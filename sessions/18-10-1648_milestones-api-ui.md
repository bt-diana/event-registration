# Session: milestones with API and UI specs

Started 18-10 16:48 +06.

## Step 1: update the milestones

**Prompt** (16:48 +06, text cleaned)

> update Milestones
> each Milestone should have both api and ui specs
> remove M9

**What Claude did.** Read `ROADMAP.md`, the specs and the last session files. Rewrote `ROADMAP.md`: the milestone table has an API spec column and a UI spec column (`events-web.md`, `registration-web.md`, `checkin-web.md`, `email-reminders-web.md`; M1 already has `auth-web.md`). Each milestone now has its API steps and then its UI steps, test first. The old M9 (web app) is removed: its screens moved into M1-M8, and the old M10 (review and README) is M9. Steps were renumbered (46 steps; the old step 28 is step 6). Updated the references to `web.md` and "M9" in `auth.md`, `auth-web.md`, `events.md` and `README.md`. Used Read, Grep, Write, Bash (`sed`).

### D35: every milestone has an API spec and a UI spec; no separate web milestone
**Time:** 16:48:09 +0600

The web screens are built in the milestone of their feature, with their own UI spec, instead of in one web milestone at the end. The old M9 is removed and the review milestone is M9. Reason: the user asked for it, so each feature is finished end to end before the next one starts.
