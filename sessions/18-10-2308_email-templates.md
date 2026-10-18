# Session: HTML email template

## Step 1: ask what the template covers

**Prompt** (23:08 +06, text cleaned)

> create a nice email template

**What Claude did.** Read `docs/brand.md`, `api/src/email/reminders.ts` and `docs/specs/email-reminders.md`. The spec lists "HTML emails" under *Not in this spec* and all five kinds are plain text, so a spec update must come first. Asked two questions (scope, format) with AskUserQuestion.

**Decision.**

### D76: one HTML + plain-text template for all five email kinds
23:08 +0600. One shared layout (brand colours and fonts from `docs/brand.md`) with its own content per kind (ticket, promotion, reminder, reschedule, event cancelled), sent as `html` and `text` together. Reason: the user chose "all five kinds" and "HTML + plain-text fallback" over reminder-only, a design-only preview or nicer plain text.

## Step 2: add a QR to the emails

**Prompt** (text cleaned)

> let's also send a qr; use the same package as on web for qr generation

**What Claude did.** Checked `web/src/registrations/qr.ts`: it uses `qr-creator` 1.0.0, which only draws onto a canvas (content: the ticket code only, level M, quiet 4, fill `#101C1A`). The API is Node with no canvas, so asked how to run it there (AskUserQuestion). Passed the answer to the running `spec-writer` agent. Used Grep, Read, Bash, AskUserQuestion, SendMessage.

**Decision.**

### D77: QR in the email with `qr-creator` plus `canvas` (node-canvas) in `api/`
Reason: the user kept the same package as the web ticket page over a pure-JS library or a link; this adds `canvas` (native) as a second new dependency in `api/`, approved by the user with this answer.

## Step 3: write the email template spec

**Prompt.** Same as steps 1 and 2.

**What Claude did.** Delegated to the `spec-writer` agent. It wrote `docs/specs/email-templates.md` (ET1-ET26) and edited ER4, ER9, ER10, ER39, ER40, ER51 and the "Not in this spec" line in `email-reminders.md`, plus ROADMAP steps 34a and 34b (nothing marked done). Key choices: html rendered at send time from the stored `kind`, `subject` and `body` (no migration); QR as an inline attachment made at send time; `qr.ts` must set `globalThis.HTMLCanvasElement` to the node-canvas class because `qr-creator` checks `instanceof HTMLCanvasElement`. Seven open questions remain, each with a recommendation. Used Agent, SendMessage, Bash.

**Decision.** None.
