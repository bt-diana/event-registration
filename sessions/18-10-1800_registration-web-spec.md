# Session: registration web spec

Started 18-10 18:00 +06.

## Step 1: spec and mock-up for the registration screens (web)

**Prompt** (18:00 +06, text cleaned)

> create a spec for the registration feature in web
> api: api\openapi.yaml
> create a mock-up in a design artifact
> notice: we have /registrations for the organizer and /registrations/me for the attendee; an attendee should be redirected to /registrations/me if they try to access /registrations

**What Claude did.** Gave the `spec-writer` agent the task. It wrote `docs/specs/registration-web.md` (W-R1-W-R23, sections 1-7): register area on `/event/:id`, ticket page `/registrations/me?event={id}`, the redirects (attendee on `/registrations` goes to `/registrations/me`, organizer on `/registrations/me` goes to `/registrations`, both test first). The API has no "list my registrations" and no organizer list route, so W-R18-W-R21 are blocked until the API; the spec proposes `GET /me/registrations` and `GET /events/{id}/registrations` and lists eight open questions with recommended answers. Claude first made a new design artifact by mistake; see step 2. Used Agent (`spec-writer`), Artifact, Read, Bash.

**Decision.** None yet (open questions are not answered).

## Step 2: mock-up goes into the existing design canvas

**Prompt** (18:0x +06, text cleaned)

> you shouldn't have done it in a new artifact
> we already have one mentioned in the README
> let's mention it in CLAUDE.md as well

**What Claude did.** Added five boards (`RegEvent`, `RegTicket`, `RegPhone`, `RegAreaStates`, `RegLists`: event page with the register button, ticket page states, phone view, all area states, attendee and organizer lists) and a title note to the existing canvas https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76, below the event screens. Added the canvas link and the rule "add boards to it, no new artifact" to `.claude/CLAUDE.md`, and marked roadmap step 17 done. The first, wrong artifact (https://claude.ai/artifact/7gp1thoHPG3HFH5zPGvuC8) is still there; not deleted without the user's word.

**Decision.** None.
