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

## Step 4: go ahead, without the design canvas

**Prompt** (23:14 +06, text cleaned)

> yes
> you don't need the design

**What Claude did.** The user rejected a read of the design canvas and said it is not needed, so no email boards are added; the emails are built from `docs/brand.md` and `email-templates.md` only. Saved this as a memory. Delegated the build (step 34b) to the `code-writer` agent. Used Artifact (rejected), Write, Bash, Agent.

**Decision.**

### D78: no design canvas boards for the emails
23:16 +0600. Reason: the user said the design is not needed; the emails follow `docs/brand.md` and the spec.

## Step 5: build the templates and the QR

**Prompt.** Same as step 4.

**What Claude did.** The `code-writer` agent made four commits: `6bb34ff` build (`qr-creator` 1.0.0, `canvas` ^3.2.3, prebuilt binary, no native build), `b76b2b9` tests first, `0c17730` code (`templates.ts`, `qr.ts`, `message.ts`, transport and sender changes, `npm run email:preview`), `baa28ff` README, ROADMAP and DATABASE notes (34a and 34b marked done). I re-ran typecheck, lint and tests in `api/`: all green, 37 files, 631 passed, 2 todo. Choices the agent made on its own: `qr.ts` sets `globalThis.self` while qr-creator loads and `HTMLCanvasElement` while drawing, then restores both; the cancelled email's preheader is its first sentence (the intro is over 90 characters); the sender replaces html, text and body with `[content]` in error reasons (ET24); an unknown kind throws, so it is a failed try; the first test that builds a QR loads node-canvas slowly, so four test files build it in `beforeAll` with a 30 s limit. Not done: opening the preview files in a browser and one real delivery. Used Agent, Bash.

**Decision.** None.
