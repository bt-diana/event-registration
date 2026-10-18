# Session: role eyebrow bug

Started 18-10 18:04 +06.

## Step 1: capture the bug in the spec

**Prompt** (18:04 +06, text cleaned)

> let's capture a UI bug in the spec
> remove "Organizer" and "Attendee" from page content; it's already shown in the header

**What Claude did.** Found the role eyebrows in `EventsList`, `CreateEventForm`, `App.tsx` (attendee home) and `AuthForm`. Added W-E24 to `events-web.md` (moved in step 3) (role word only in the header; no eyebrow on logged-in pages; the login and signup forms keep theirs because the header shows no role when logged out) and a line in section 7. Updated the ticket page, attendee list and organizer registrations lines in `registration-web.md`. No code changed. Used Read, Grep, Bash.

**Decision.** None.

## Step 2: move the step to its own session

**Prompt** (18:06 +06, text cleaned)

> it's not a registration spec; it's a separate session for bug fix

**What Claude did.** Moved step 1 out of `18-10-1800_registration-web-spec.md` into this file. Used Bash.

**Decision.** None.

## Step 3: a separate spec for the bug

**Prompt** (18:08 +06, text cleaned)

> create a separate spec for the bug

**What Claude did.** Wrote `docs/specs/role-eyebrow.md` (behaviours RE1 to RE4, screens, files, done means). Took W-E24 out of `events-web.md` and renamed it to RE1 in `registration-web.md`, `brand.md`, `README.md`, `ROADMAP.md`, `App.tsx` and `eyebrow.test.tsx` (comments and a test name only). Web tests, typecheck and lint pass. Used Write, Bash.

**Decision.** None.
