# Session: email and reminders web spec

Started 18-10 20:46 +06.

## Step 1: write the M6 web spec

**Prompt** (20:46 +06, text cleaned)

> write a spec for M6 on web

**What Claude did.** Found ROADMAP step 33 (`email-reminders-web.md`, "only what the API can tell; no new route unless the spec asks for it") and the done API spec `email-reminders.md`. Delegated the spec to the `spec-writer` agent (see below). Used Read, Grep, Glob, Bash, Agent.

**Decision.** None.

**Result.** `spec-writer` wrote `docs/specs/email-reminders-web.md` (W-EM1-W-EM8). No API response exposes email status, so the only UI change is two static lines on the ticket page. ROADMAP step 33 marked done. Six open questions are still open (ID prefix, per-ticket status, demo note, reminder line, organizer view, placement), each with a recommendation. Used Edit, Bash.

## Step 2: replace the static email lines with an emails table per attendee

**Prompt** (22:20 +06, text cleaned)

> for the reminders, let's show just the table with the data we get from /events/:id/registrations/:registrationId/emails
> separate for each attendee
> access through a link in registration table row

**What Claude did.** Saw that the route does not exist yet, so this needs an API spec change as well as the web spec change. Delegated both spec updates to the `spec-writer` agent (see below). Used Bash, Agent.

**Decision.**

### D74: show an emails table per attendee, from a new organizer route, instead of static lines
22:20:20 +0600. The organizer opens it from a link in each row of the registrations table. The table shows the data of `GET /events/:id/registrations/:registrationId/emails`; it replaces the two static lines of W-EM2/W-EM3 on the ticket page. Reason: the user chose this over static text, so the web can show real outbox data.

**Result.** `spec-writer` added the route `GET /events/:id/registrations/:registrationId/emails` to `email-reminders.md` (ER48-ER60) and rewrote `email-reminders-web.md` (W-EM1-W-EM15): an "Emails" column with a "View emails" link in each registrations row, and a page `/registrations/:registrationId/emails?event=` with one table (Kind, Status, To, Subject, Created, Sent at, Failed tries, Error). The ticket page gets no email lines. This decision was first numbered D59, which clashed with two other sessions; renumbered to D74. Open: the route overlaps `email-outbox.md` (`GET /events/:id/emails?registration_id=`, D60/D61). `ROADMAP.md` still says "two static lines" (it has staged changes from another session, so not touched). Used Agent, Bash.
