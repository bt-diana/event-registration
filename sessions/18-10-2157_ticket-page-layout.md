# Session: ticket page layout

Started 18-10 21:57 +06.

## Step 1: flatten the ticket page

**Prompt** (21:57 +06, text cleaned)

> On the ticket page, remove the "You are registered" header and the event status. Show only the registration status instead. And move the ticket code with the QR to the main container.

**What Claude did.** Read the ticket page, panel, tests, CSS and `registration-web.md` (Read, Grep, Bash). Added W-R38 to the spec (no ticket `h2`, no event status line, only the registration badge, code and QR directly in the card).

**Decision.** None.
