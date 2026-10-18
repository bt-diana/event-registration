# Spec: Event description (API only)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). It adds one column, `description`, to `events`, by a new migration `003_event_description.sql` (same pattern as `002_event_duration.sql`; 001 and 002 are not edited). It extends the shapes and create rules of `events.md` (E1-E20). Login, guards and the error format are reused from `auth.md` (A13-A15). No registration rule changes. Behaviour ids use the prefix `DS` (the plain `D1...` would clash with the decision ids D1-D38 in `sessions/` and `events-web.md`; `A`, `B`, `E`, `R` are taken too).

## 1. Goals and expected behaviour

**Goal.** An organizer can write a short text about an event when creating it. The text is shown to the organizer and on the public event page, so attendees know what the event is about before they register.

**Behaviours.** Each line is something that can be checked. "Test first" marks the ones whose test is written and committed before the code.

| # | Behaviour | Test first? |
|---|---|---|
| DS1 | After migration 003, `events` has `description text NOT NULL DEFAULT ''` with `CHECK (char_length(description) <= 2000)`. An insert by SQL without `description` stores `''`. An insert of 2000 characters works; 2001 is rejected by the CHECK. | |
| DS2 | Existing events (rows made before the migration, and rows inserted by SQL without the column) have `description` `''`. Nothing else in those rows changes. | |
| DS3 | `POST /events` accepts an optional `description`. With a valid string, the stored and answered value is the trimmed string. 201 answers the organizer event shape with `description`. | |
| DS4 | `description` missing or `null` on create stores and answers `''`. A string that is empty or only whitespace after trimming also gives `''`. None of these is an error. | |
| DS5 | Trim rule: leading and trailing whitespace is removed (JS `trim()`, the same as `title`). Spaces, tabs and line breaks inside the text are kept as sent. Example: `"  Bring a laptop.\n\nDoors at 9.  "` is stored as `"Bring a laptop.\n\nDoors at 9."`. | |
| DS6 | Length rule: after trimming, the length is counted in code points (as for `title`, `events.md` assumptions). 2000 code points is accepted; 2001 answers 400 `{ "error": "invalid_input" }` and writes nothing. A text of 2000 code points with emoji (more UTF-16 units than 2000) is accepted. | yes |
| DS7 | Bad type or content on create answers 400 `invalid_input` and writes nothing: `description` a number, boolean, array or object; a string with a NUL character (`\u0000`). The check is in the app, so PostgreSQL never has to raise an error (no 500). | yes |
| DS8 | Create does not change any other rule of `events.md`: a body without `description` and otherwise valid still answers 201 (E1). A body with a bad `description` and an otherwise valid body answers 400 (DS6, DS7). A bad title or other field with a valid `description` still answers 400 (E2). | |
| DS9 | The organizer event shape (`GET /events`, `GET /events/:id`, and the 201 of `POST /events`) has a new key `description` (always a string, `''` when empty). All other keys and rules are as in `events.md` section 3. The same event answers the same `description` in all three. | |
| DS10 | The public event shape (`GET /public/events/:id`) has a new key `description` (always a string). It is the stored text as is, also for cancelled and passed events (the text does not follow the closed rules of `seats_left`/`full`). Its exact key list is now: `id`, `title`, `description`, `starts_at`, `ends_at`, `duration_minutes`, `capacity`, `status`, `has_started`, `seats_left`, `full`. It still contains none of the keys that E13 forbids. | yes |
| DS11 | The description is stored and answered as plain text. The API does not change, escape or strip it (no HTML handling in the API); a string such as `<b>hi</b>` comes back identical. The web must show it as text, never as HTML (see section 2). | |
| DS12 | Guards are unchanged: `POST /events`, `GET /events`, `GET /events/:id` give 401 `not_logged_in` with no login and 403 `wrong_role` for an attendee, before any validation of `description` (E9). Another organizer's event is 404 (E7), and the answer does not contain the description. | |
| DS13 | Error codes: no new code. `description` problems use `invalid_input` (E2, E17). | |

**Out of scope.** Editing or clearing the description after create (there is no event update route in the API yet; B8/B10/M7 decide their own fields); rich text, Markdown or HTML; images or links; a description in emails or the outbox; search by description; a separate short summary; translations; the web screens (see section 2, `events-web.md`); a default text.

**Assumptions.** Change any of these first in this file.
- Column is `NOT NULL DEFAULT ''`, not nullable. One kind of "no description" (`''`) means one rule for old rows, create, and the shapes (always a string, never `null`). Answered; see open question 1.
- Max 2000 code points. Long enough for a paragraph or two of text, short enough for a page and for a small request. The limit is in the app and in the CHECK. The CHECK uses `char_length`, which counts characters (code points) in a UTF-8 database, the same unit as the app.
- Trim is done in the app only (JS `trim()`), as for `title`. The table has no trim CHECK, because `btrim` in PostgreSQL strips only spaces by default and would not match `trim()`.
- The description is optional on create. This keeps all existing clients and tests that send the four fields working.
- Unknown fields are still ignored (`events.md`); `description` is now a known field.
- The description is public: whatever the organizer writes is shown on the public page without login. The UI should say so (section 2).
- Reschedule, capacity change, event cancel and registration do not read or change `description`.

## 2. UI decisions

No screens are changed by this spec (API only). The web needs a later change in `events-web.md`, a separate step:
- Organizer create form: an optional multi-line field "Description" with a 2000 character limit and a hint that it is shown on the public page. A 400 `invalid_input` shows a field error as for the other fields.
- Public event page and organizer event view: show the description as plain text under the title, keeping line breaks (React text node with `white-space: pre-wrap`; never `dangerouslySetInnerHTML`). When it is `''`, show nothing (no empty block).
- Event lists: not shown (too long for a list).
States: loading, error and not-found stay as in `events-web.md`.

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new library, table or env variable.
- **Migration:** `api/src/db/migrations/003_event_description.sql`, applied by the existing runner in file-name order:
  `ALTER TABLE events ADD COLUMN description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000);`
  A constant default is applied to existing rows without a table rewrite problem and gives `''` (DS2). The `DEFAULT ''` stays on purpose, like `DEFAULT 60`: plain SQL inserts in `api/test/db/` and `api/test/events/` do not send it. The API always sends a value. Before writing the file, check that `003` is still the next free number in `api/src/db/migrations/` (M3 adds no migration).
- **Validation:** one small function next to the existing `title` check in `api/src/events/routes.ts`: `description === undefined || description === null` gives `''`; a non-string is invalid; trim; reject NUL; count `[...text].length`; over 2000 is invalid; return the trimmed text. Reuse the title helper for the code-point count and NUL check if it is a function, otherwise factor it out (no behaviour change for `title`).
- **Database access:** the create `INSERT` adds `description` to the column list and `RETURNING`; the read and list queries select `e.description` (they already use `e.*`, so only the mapping changes). The `GROUP BY e.id` query needs no change.
- **Shapes:** add `description` after `title` in both shapes (`events.md` section 3). Organizer: `{ id, title, description, starts_at, ends_at, duration_minutes, capacity, registered, seats_left, status, schedule_version, cancelled_at, created_at }`. Public: `{ id, title, description, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full }`.
- **Concurrency:** none; one insert, snapshot reads.
- **API:** no new route. Changed routes:

| Route | Change |
|---|---|
| `POST /events` | body takes optional `description`; 201 shape has `description`; 400 `invalid_input` for DS6, DS7 |
| `GET /events` | each event has `description` |
| `GET /events/:id` | event has `description` |
| `GET /public/events/:id` | event has `description` |

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/events/description.test.ts` (new) | Tests first (red): DS6, DS7 (limits, emoji, NUL, bad types, nothing written) and DS10 (exact public key list). Then DS3-DS5, DS8, DS9, DS11, DS12 | DS3-DS12 |
| `api/test/db/` (the existing schema test) | Update: the `events` columns list includes `description`; default is `''`; CHECK accepts 2000 and rejects 2001 characters; a row made without it reads `''` | DS1, DS2 |
| `api/test/events/public.test.ts` | Update the exact key list of E13 to include `description` (same commit as the DS10 test; it fails until the code is changed) | DS10 |
| `api/test/events/organizer.test.ts` | Update shape checks so they accept `description` (use the exact key list if it has one) | DS9 |
| `api/src/db/migrations/003_event_description.sql` | New migration (section 3). Do not edit 001 or 002 | DS1, DS2 |
| `api/src/events/routes.ts` | Validate `description` on create, insert it, add it to both shapes and to the row mapping | DS3-DS10 |
| `api/openapi.yaml` | Add `description` to the create body and to both event shapes | DS3, DS9, DS10 |
| `README.md` | Mention the field in the events routes and "Project status" (separate edit; not done by this spec) | |
| `ROADMAP.md` | Add a step for this feature and mark it when done (separate edit; not done by this spec) | |

**Other docs that need a change when this is built** (not edited now, because another agent is editing some of them):
- `docs/specs/events.md`: E1/E2 (create body, optional `description`), E11 and E13 (public key list now has `description`), section 3 shapes and API table, section 4 (migration list), a pointer to this file.
- `docs/DATABASE.md`: section 1 `events` table (new row), the SQL sketch (comment for 003 like the one for 002), a decision entry (next number after 17), section 4 behaviour map.
- `docs/specs/events-web.md`: the form and the pages (section 2 above).
- `README.md` and `ROADMAP.md`: as in the table.
- `docs/specs/SPEC_TEMPLATE.md`: no change.

Tests use the existing style (`createApp().listen(0)` and `fetch`, helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new library). Rows made by a test are deleted by that test.

## 5. Done means

- Tests, typecheck and linter all pass in `api/`.
- Migration `003_event_description.sql` is applied by the existing runner; 001 and 002 are unchanged; the schema test passes with the new column.
- Every behaviour DS1-DS13 has a test, or a note in the README that says it is not covered.
- DS6, DS7 and DS10 have their tests written and committed before the code (red first, then green).
- All existing tests of `events.md` stay green, except the exact key list of E13, which is updated on purpose in the red commit.
- `api/openapi.yaml` lists `description`. The docs in the list above are updated in the same step that builds the feature, before the commit.

## 6. Open questions (all answered: the suggestions were accepted)

1. Nullable or `NOT NULL DEFAULT ''`? Answer: `NOT NULL DEFAULT ''` (DS1, DS2). The shapes always give a string and no code has to handle `null`. A nullable column would also work, but then "no description" would be two values.
2. Maximum length? Answer: 2000 code points. Alternative: 1000 (short blurb) or 5000.
3. Optional or required on create? Answer: optional, so existing clients and tests keep working (DS4).
4. Should a whitespace-only text be an error or `''`? Answer: `''`, not an error (DS4).
5. Should the description be on the organizer list too? Answer: yes (DS9), for one shape in all organizer answers. It adds up to 2000 characters per event; with no pagination this is acceptable for now.
6. Editing later? Answer: not now (out of scope). If wanted, it needs a new `PATCH /events/:id` route and its own spec.
7. Migration number: 003 is assumed free; confirm when building, in case another migration lands first.
