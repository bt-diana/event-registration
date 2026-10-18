# Session: registration web spec

Started 18-10 18:00 +06.

## Step 1: spec and mock-up for the registration screens (web)

**Prompt** (18:00 +06, text cleaned)

> create a spec for the registration feature in web
> api: api\openapi.yaml
> create a mock-up in a design artifact
> notice: we have /registrations for the organizer and /registrations/me for the attendee; an attendee should be redirected to /registrations/me if they try to access /registrations


## Step 2: UI bug, role word repeated in page content

**Prompt** (18:04 +06, text cleaned)

> let's capture a UI bug in the spec
> remove "Organizer" and "Attendee" from page content; it's already shown in the header

**What Claude did.** Found the role eyebrows in `EventsList`, `CreateEventForm`, `App.tsx` (attendee home) and `AuthForm`. Added W-E24 to `events-web.md` (role word only in the header; no eyebrow on logged-in pages; the login and signup forms keep theirs because the header shows no role when logged out) and a line in section 7. Updated the ticket page, attendee list and organizer registrations lines in `registration-web.md`. No code changed. Used Read, Grep, Bash.

**Decision.** None.
