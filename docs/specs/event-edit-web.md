# Spec: Edit an event, web

Feature spec for the screens of editing an event, made from `SPEC_TEMPLATE.md` (sections 1-5; its behaviours are not requirements). The API side is `event-edit.md` (`PATCH /events/:id`, EE1-EE19); this file does not change it. Ids are **W-EE1, W-EE2, ...** (checked: free). It follows the style of `email-reminders-web.md` (W-EM16-W-EM34, the reschedule and cancel section) and `events-web.md` (create form W-E4-W-E9, W-E20). Login, guards and `ApiError` are `auth-web.md`; query helpers are `web/src/events/queries.ts`; style values are `docs/brand.md`. Nothing is live (D50, D51): no polling.

## 1. Goals and expected behaviour

**Goal.** On the organizer view of an event the owner sees an "Edit event" link while the event is open. It opens a form with the title, the description and the duration, filled with the current values. Saving sends only what changed, shows "Event saved." and the new values show everywhere the event is shown.

**What the API gives** (`event-edit.md`): `PATCH /events/:id` with `{ title?, description?, duration_minutes? }` answers 200 with the organizer event; 400 `invalid_input` (no field names); 401 `not_logged_in`; 403 `wrong_role`; 404 `not_found` (malformed, unknown or foreign id); 409 `event_cancelled`, `event_passed`. A running event can be edited (EE10) but its new end must stay in the future (EE11). Start and capacity are refused by the API (EE4) and have no field here.

**Behaviours.** Each line is checked with a component or unit test (`fetch` mocked; fake system time where the clock matters). "Test first" ones get the test before the code (UI steps are test first; the roadmap steps are proposed in the report).

*The link on the event page*

| # | Behaviour | Test first? |
|---|---|---|
| W-EE1 | **When it exists.** The organizer view of `/event/:id` (`OrganizerEventView`, owner only) shows the link "Edit event" while `event.status` is `active` (a running event too, EE10). For `cancelled` and `passed` ("Ended") it is not rendered at all (no disabled link, no hint; the status badge says why), as the M7 controls (W-EM16). The public view and every non-owner never show it. It is an `<a>` (`Link`) to `/organizer/events/{id}/edit` (`id` through `encodeURIComponent`), class `button-link`, at least 48px, accessible name "Edit event". **Position:** directly after the "Registrations" link and before the M7 section "Change the event" (W-EM16); if M7 is not built yet, between the "Registrations" link and the share line. The two links sit side by side with a 12px gap and wrap on a phone (320px); the 24px space above and below the group of `design-alignment.md` DA7 stays. Test: `active` (future and started one minute ago) shows it with the right `href`; `cancelled`; `passed`; public view of the same event has none. | yes |

*Route, guard, loading*

| # | Behaviour | Test first? |
|---|---|---|
| W-EE2 | **Route and guard.** The route is `/organizer/events/:id/edit`, in `App.tsx` inside `RequireRole role="organizer"` like `/organizer/events/new` (the fixed `new` path and this one do not clash). Logged out goes to the organizer login with `next`; an attendee gets the wrong-account page (W-A4, W-A6); no event request runs before the guard accepts (W-E14). Test: the three cases, with zero `fetch` calls for the first two. | yes |
| W-EE3 | **Loading the event and the page states.** The page reads the event with `useEvent(id)` (key `["events", id]`, one `GET /events/:id`; the cached copy of the event page is shown at once and read again on mount, as on the event page). *Loading:* the existing `EventLoading` ("Loading..."). *Network error or 5xx:* the existing `EventLoadError` ("Could not load this event", Retry), `backTo` the event link. *404* (unknown, malformed or not yours): `h1` "Event not found" and the line "This link is not valid or the event does not exist." (`role="alert"`), and a back link "← Events" to `/organizer`; never the public view (this is an organizer-only screen). *401 or 403:* `["me"]` is invalidated (W-E13), no text of its own. *Closed* (the loaded `status` is `cancelled` or `passed`): back link "← Event", `h1` "Edit event", the line "This event is cancelled and cannot be edited." or "This event has ended and cannot be edited.", and no form. *Open:* the form (W-EE4). Test: one case per state; Retry refetches only this query. | yes (closed, 404) |

*The form*

| # | Behaviour | Test first? |
|---|---|---|
| W-EE4 | **Three fields, prefilled.** Back link (the shared `BackLink`, name "Event", text "← Event", to `/event/{id}`) above the `h1` "Edit event", then the form (`noValidate`, same `card card-form` look and `field`, `hint`, `field-error`, `form-error` classes as the create form): *Title* (text input, hint "1 to 200 characters"), *Description (optional)* (textarea, 5 rows, hint "Shown on the public event page, so everyone can read it. Up to 2000 characters."), *Duration (minutes)* (text input, `inputMode="numeric"`, hint "1 to 1440. The end moves with the duration. The event starts {formatDateTime(starts_at)}." with the date from the loaded event). Labels and the first two hints are the create form's words, not new ones. The values start as the loaded event's `title`, `description` and `String(duration_minutes)`. The button is "Save changes" (`button-primary`, at least 48px, `type="submit"`). There is no field for the start or the capacity, and no text about them. The values are set **once**, from the first data of the page; a later background read of `["events", id]` never overwrites what the user typed. Test: the three fields show the loaded values; a second answer with another title leaves a typed title alone. | yes |
| W-EE5 | **Checks before any request** (the validators of `validate.ts` are reused, not copied: `validateTitle`, `validateDescription`, `validateDuration`, and their `ERRORS` texts). On submit, in field order: a failing field shows its error under it and focus goes to the first one; no request. One more check for a **running** event (`starts_at` not later than the browser clock): if `starts_at + duration` is not later than the browser clock, the duration field shows "The new end must be in the future." (new text in `ERRORS`, `endPast`; the API rule is EE11). If the trimmed values all equal the loaded ones, the notice "Nothing changed." (`role="status"`) shows and nothing is sent. The server stays the authority (W-EE9). Test: empty title; 201-character title; 2001-character description; duration `0`, `1441`, `1.5`, empty; running event with a short duration; open future event with any valid duration (no end error); unchanged form; each with zero `fetch` calls and the right text and focus. | yes |
| W-EE6 | **The request.** A valid, changed form sends exactly one `PATCH /events/{id}` (`id` through `encodeURIComponent`), `Content-Type: application/json`, a body with **only the fields that differ** from the loaded values: `title` trimmed, `description` trimmed (`""` when cleared; that is how it is removed, EE6), `duration_minutes` as a number. Nothing else is sent (no `starts_at`, no `capacity`, no `status`). Test: change only the title: body is exactly `{"title":"New"}`; clear the description: `{"description":""}`; change all three: three keys; the URL and method. | yes |
| W-EE7 | **Pending and double submit.** While the request runs the button reads "Saving..." and is `disabled`, the values stay, and a second submit (click, Enter) sends nothing (a ref guard released on settle, as W-E7 and W-EM20). Test: two quick submits make one `fetch` call. | yes |
| W-EE8 | **Success.** A 200 puts the answer into `["events", id]` (the event page and every list read it at once), resets the "loaded values" of the form to the answer (so the next change is compared with what was saved, and the fields show the trimmed values), keeps the user on the page, and shows "Event saved." (`role="status"`, `tabIndex={-1}`, focus moves to it). The message stays until the next submit or until the page is left. The cache work is W-EE10. Test: the fields show the answer's values; the message and focus; a second save with no change gives "Nothing changed." and no request. | yes |
| W-EE9 | **Errors** (the body `{ "error": code }` is read, W-EE11). Texts go in a message at the top of the form (`form-error`, `role="alert"`, `tabIndex={-1}`, focus moves to it) and the values are kept. 400 `invalid_input`: "Some fields are not valid. Check them and try again." (the create form's text, W-E6). 409 `event_cancelled`: "This event is cancelled and cannot be edited." 409 `event_passed`: "This event has ended and cannot be edited." After a 409 `["events", id]` is refetched (W-EE10), so the page switches to the closed state of W-EE3 (the form disappears; the message of the 409 is the same sentence). 404: the not-found state of W-EE3, no text of its own. 401 or 403: `["me"]` is invalidated and the guard takes over, no text. Network error, 5xx, or a 409 with an unknown code: "Something went wrong. Try again." No automatic retry. Test: each row; the message `role` and focus; values kept. | yes |
| W-EE10 | **What a success invalidates** (keys that exist in `events/queries.ts`, `registrations/`). *Saved (200 with a change):* set `["events", id]`; invalidate `["events"]` (exact; the organizer list and the event selectors), `["public-event", id]` (exact; the public page and the ticket page), `["public-events"]` (exact; the home list), and the prefixes `["registrations"]` and `["registration"]` (the attendee list and tickets show the event title and the Ended badge, which a changed duration can move). *Not* invalidated: arrivals, `["event-registrations"]`, `["registration-emails"]` (no names, counts or email rows change). *Nothing changed (client check):* nothing. *409 and 404:* invalidate `["events", id]`, `["events"]` (exact) and `["public-event", id]` (exact). Nothing is refetched by a timer (D50, D51); mounted queries refetch at once, the others on their next mount. Test: after a success the listed keys are `isInvalidated` and an unrelated key (another event's) is not; the event page, opened after a save, shows the new title and duration without a manual reload. | yes |

*Plumbing, accessibility, other screens*

| # | Behaviour | Test first? |
|---|---|---|
| W-EE11 | **Client plumbing, no proxy change.** `events/api.ts` gets the type `EventPatch` (`{ title?: string; description?: string; duration_minutes?: number }`) and `updateEvent(id, patch)` (through `request`, `PATCH`, JSON body) that returns the organizer event through `withDescription` and throws `EventActionError`. `EventActionError` is the subclass of `ApiError` that `email-reminders-web.md` W-EM34 defines (status as before, plus `code`: the `error` string of the body, `""` when the body is not JSON or has none); **whichever of the two features is built first defines it, the other reuses it, never two copies**. `events/queries.ts` gets `useUpdateEvent(id)` (`useMutation`; `onSuccess` and `onError` as W-EE10; `onApiError` for 401/403). `vite.config.ts` is unchanged: the `/events` prefix of the dev and preview proxy carries `PATCH /events/:id` (any method); the page path `/organizer/events/:id/edit` is not proxied. Test: `updateEvent` sends the method, header and body; a 409 with each of the two codes gives that `code`; a 409 with a non-JSON body gives `""`. | yes |
| W-EE12 | **Accessibility and layout.** Every input has a `<label>`; an invalid input has `aria-invalid="true"` and `aria-describedby` to its error and hint (W-E20, the same `row` structure as the create form); field errors and the form error are `role="alert"`, the success message and "Nothing changed." are `role="status"`; each has `tabIndex={-1}` where focus moves to it, after it is on screen. One `h1` per state. The link of W-EE1 and the button are real elements with a text name (no colour alone). Organizer indigo accent, `data-role="organizer"`, no new colour, **no red**; no new library, no dialog, no confirm step (an edit can be edited again). The form is one column and full width on a phone like the create form. | |
| W-EE13 | **Other screens are unchanged.** The event page shows the new values from the cache; the public page, the home list, the organizer list, the ticket page and the attendee list show the new title and duration after their next read (W-EE10). No "edited" badge, no "last changed" line and no note about emails anywhere (the API sends none, `event-edit.md` EE14). The create form, the M7 section and the registrations screens get no edits. Existing tests pass without edits. | |

**Out of scope.** Fields for the start and the capacity (the start is `POST /events/:id/reschedule`, `email-reminders-web.md`; capacity is B10, M4); editing a cancelled or ended event; a confirm step, a diff view or an undo; a warning on leaving with unsaved changes; an "edited" marker or history; a notice that attendees were or were not told; a Cancel button (the back link leaves the page); editing from the events list; a rich text editor; a library; polling or live updates (D50, D51); translations; dark theme; any change in `api/`.

**Assumptions.** Change any of these first in this file.
- `event-edit.md` is built and in `api/openapi.yaml` before the web step, as the arrivals and M7 routes were.
- The page is a separate route, not an in-place form on the event page (open question 1).
- W-EE1 uses the API `status`, not the browser clock. The clock is used only for the one running-event check of W-EE5. The server decides (EE9, EE11).
- The description is the stored plain text; the textarea shows it as it is, with line breaks. It is never shown as HTML (DS11).
- A saved form leaves the user on the page (open question 2), because the cache is already updated and the message confirms it.
- `EventStatusBadge`, `EventDescription`, `BackLink`, `EventLoading`, `EventLoadError` (`EventParts.tsx`) are reused as they are.

## 2. UI decisions

| Screen | Route | API route | Query key | What it shows and does |
|---|---|---|---|---|
| Organizer event page (exists, W-E10) | `/event/{id}` (owner view) | unchanged (`GET /events/:id`) | `["events", id]` | One more link "Edit event" after "Registrations" while the status is `active` (W-EE1). Nothing else changes. |
| Edit event (new) | `/organizer/events/{id}/edit` | `GET /events/:id` to fill, `PATCH /events/:id` to save | `["events", id]`; saving sets it and invalidates per W-EE10 | Back link "← Event", `h1` "Edit event", the three fields, "Save changes", messages. Organizer only (W-EE2-W-EE9). |
| Public page, home list, lists, ticket page | unchanged | unchanged | invalidated by a save | New title and duration at the next read (W-EE13). |

**Route choice.** Separate route, recommended over an in-place form (question 1): the form has a 5-row textarea and three fields, which would push the M7 reschedule and cancel section far down the event page and mix two result messages in one component; the create form is already a route of the same shape (`/organizer/events/new`), so the page, its validators and its tests are close copies; the event data is in the cache already, so opening it costs no wait. The in-place form (W-EM17) is right for the reschedule because that is one field.

**Texts (exact).**

| Where | Text |
|---|---|
| Link on the event page | "Edit event" |
| Page | back link "← Event" (name "Event"); `h1` "Edit event" |
| Labels | "Title", "Description (optional)", "Duration (minutes)" |
| Hints | "1 to 200 characters"; "Shown on the public event page, so everyone can read it. Up to 2000 characters."; "1 to 1440. The end moves with the duration. The event starts {date and time}." |
| Button | "Save changes", pending "Saving..." |
| Client errors | the `ERRORS` of `validate.ts` (title, description, duration); new: "The new end must be in the future." |
| Nothing changed | "Nothing changed." |
| Success | "Event saved." |
| 400 | "Some fields are not valid. Check them and try again." |
| 409 | "This event is cancelled and cannot be edited." / "This event has ended and cannot be edited." |
| Other failures | "Something went wrong. Try again." (401, 403 and 404 have no text of their own) |
| Not found | `h1` "Event not found", "This link is not valid or the event does not exist.", back link "← Events" |
| Loading, load error | "Loading..." ; "Could not load this event", "Check your connection and try again.", Retry (existing components) |

**Look.** The create form's look (`card card-form`, `field`, `hint`, `field-error`, `form-error`, `button-primary`, `button-link`; `brand.md`), organizer indigo, no new colour. The two links of W-EE1 sit in one row; if no existing class fits, one small rule in `styles.css` for the 12px gap and wrapping.

**States of the form page.** Loading; load error with Retry; not found; closed (cancelled, ended); idle with the values; field errors; pending; saved; nothing changed; 400; 409 (switches to closed); network error. Wrong role or logged out is the guard (W-EE2).

**Design boards** (new screens, so they go on the **existing** canvas https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76; do not edit it from this spec; no new artifact), each at desktop and phone width, organizer (indigo) accent:
1. **"Organizer event: Edit link"**: the event page with "Edit event" beside "Registrations" for an open event (and, if M7 is built, above the "Change the event" section); the same page for a Cancelled and an Ended event with no link. If the canvas already has a board for the organizer event page, add the link to that board instead of a new one.
2. **"Edit event"**: idle with prefilled values (duration hint with the start); field errors (title empty, duration, "The new end must be in the future."); pending ("Saving..."); saved ("Event saved."); "Nothing changed."; form error (400, 409, other); closed state (cancelled and ended); not found; loading; load error with Retry.

## 3. Architecture decisions

- **Apps:** `web/` only. No new library, no `api/` change, no proxy change (W-EE11). One new route in `App.tsx`, one new component, two small additions to `api.ts` and `queries.ts`.
- **New component `web/src/events/EditEventForm.tsx`:** the page (back link, `h1`, states, form, messages). It reads `id` with `useParams`, the event with `useEvent(id)`, and saves with `useUpdateEvent(id)`. It follows `CreateEventForm.tsx` (field rows with `useId`, `focusRequest` effect, `sending` ref, `check()` over the shared validators). The row helper may be shared with `CreateEventForm.tsx` if that is a pure move with the create tests unchanged; otherwise the structure is repeated (small file, no new abstraction required).
- **`validate.ts`:** one new text `ERRORS.endPast` and one small pure function `validateNewEnd(startsAtIso, durationText, now)` (returns the text or `null`; only for a running event), unit-tested in `validate.test.ts`. The other validators are used as they are.
- **`api.ts`, `queries.ts`:** `EventPatch`, `updateEvent`, `EventActionError` (shared with W-EM34), `useUpdateEvent` (W-EE11, W-EE10). Keys come from the files that own them (`EVENTS_KEY`, `eventKey`, `publicEventKey`, `PUBLIC_EVENTS_KEY`; export small prefix constants for `["registrations"]` and `["registration"]` where a file has none).
- **`EventPage.tsx`:** `OrganizerEventView` renders the link (W-EE1); its header comment ("Read only") is updated (it already was by M7 if built first).
- **`App.tsx`:** the route inside `RequireRole role="organizer"`.
- **No change** in `CreateEventForm.tsx` behaviour, `PublicEventPage.tsx`, `ticket.ts`, `TicketPage.tsx`, `registrations/`, `auth/api.ts`, `vite.config.ts`, `package.json`.
- **Styles:** reuse existing classes; add only the link-row rule if needed.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/events/validate.test.ts` | **Tests first (red):** `validateNewEnd` (running event: end before, at and after now; future event: no error) | W-EE5 |
| `web/src/events/EditEventForm.test.tsx` (new) | **Tests first (red):** W-EE2 (roles, zero requests), W-EE3 (loading, error with Retry, 404, closed, open), W-EE4 (prefill, typed values survive a refetch), W-EE5 (every client check, zero `fetch` calls), W-EE6 (exact bodies), W-EE7 (double submit), W-EE8 (success, refilled values, focus, nothing changed), W-EE9 (every error row, focus, values kept, switch to closed after a 409), W-EE10 (`isInvalidated` keys), W-EE11 (`EventActionError` codes, `updateEvent` request), W-EE12 (labels, `aria-*`, roles) | W-EE2-W-EE12 |
| `web/src/events/EventPage.test.tsx` | **Tests first (red):** W-EE1 (link for `active` future and running, none for `cancelled`, `passed` and the public view, right `href`), W-EE13 (the page shows the saved title from the cache). Existing tests pass without edits | W-EE1, W-EE13 |
| `web/src/events/validate.ts` | `ERRORS.endPast`, `validateNewEnd` | W-EE5 |
| `web/src/events/api.ts`, `web/src/events/queries.ts` | `EventPatch`, `updateEvent`, `EventActionError` (or reuse), `useUpdateEvent` | W-EE6-W-EE11 |
| `web/src/events/EditEventForm.tsx` (new) | The page | W-EE3-W-EE12 |
| `web/src/events/EventPage.tsx` | The link in `OrganizerEventView` | W-EE1 |
| `web/src/App.tsx` | The route `/organizer/events/:id/edit` inside `RequireRole role="organizer"` | W-EE2 |
| `web/src/styles.css` | Only if the link row needs a rule | W-EE1 |
| `docs/brand.md`, design canvas | One line for the link row if a rule is added; the two boards of section 2 in the existing canvas | |
| `README.md`, `ROADMAP.md` | The organizer can edit title, description and duration from the event page; `events-web.md` W-E10 "read only" and its Out of scope "editing" are superseded for the owner view (note, as M7 does); the create form's "no edit" lines in `event-description.md` are old | |

Tests follow `registration-web.md` section 4 (Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test with `retry: false`, `MemoryRouter`, only `@testing-library/react`; the helpers in `web/src/events/test-helpers.ts`). The "opened after a save" test uses one `QueryClient` kept across navigation and `renderApp`.

Not touched: `api/`, `web/package.json`, `vite.config.ts`, `CreateEventForm.tsx` behaviour, `registrations/`, `auth/`.

## 5. Done means

- Tests, typecheck and linter pass in `web/` (`bash scripts/verify.sh`).
- Every behaviour W-EE1 to W-EE13 has a test, or a note in the README that says it is not covered.
- Tests first, committed before the code and shown failing for the right reason: `validate.test.ts` (`validateNewEnd`), `EditEventForm.test.tsx`, and the W-EE1 case of `EventPage.test.tsx`.
- Request-count proof: opening the edit page makes one `GET /events/:id` (plus `me`); a save makes one `PATCH`; an unchanged form and every failing client check make none; a double submit makes one.
- `git diff --stat` shows no file under `api/`, no `vite.config.ts`, no `web/package.json`.
- By hand, once, with the API running: open an open event, click "Edit event", change the title and save, go back and see the new title on the event page, `/organizer` and the home list `/`; change the duration of a running event to a value that ends before now and see the error; cancel the event in another tab (SQL until M7 exists) and save, see the closed state; open the link as an attendee and as a stranger.
- README "Project status" says what the organizer can edit and what not (start and capacity).

## 6. Open questions (each with a recommended answer)

1. **Separate route or in place.** **Recommended: the separate route `/organizer/events/{id}/edit`** (section 2, "Route choice"). Alternative: an in-place form on the event page that replaces the details, like the M7 reschedule form; fewer routes, but a larger `OrganizerEventView` and two result messages next to each other.
2. **After saving: stay or go back.** **Recommended: stay** and show "Event saved." (W-EE8). Alternative: `navigate("/event/{id}", { replace: true })` like the create form (W-E8); then the confirmation is lost unless a router state carries it.
3. **Label of the link.** **Recommended: "Edit event"** (a bare "Edit" is unclear next to "Registrations"). Alternative: "Edit".
4. **Show the link for a running event.** **Recommended: yes**, as the API allows it (EE10). Alternative: hide it once the event has started, like the M7 controls; then a typo can no longer be fixed on the day.
5. **Hidden or disabled when closed.** **Recommended: hidden** (W-EE1), as W-EM16 decided. Alternative: a disabled link with a hint.
6. **Start and capacity on this form.** **Recommended: neither** (the API refuses them, `event-edit.md` question 1). If the user answers that PATCH accepts them, this spec grows two fields and `W-EE6` sends them.
7. **Warn about unsaved changes on leaving.** **Recommended: no** (out of scope, no library, no dialog).
8. **Build order with M7.** `EventActionError` (W-EM34) and the placement above "Change the event" (W-EE1) depend on which feature is built first. **Recommended: either order; the first one defines `EventActionError`, the second reuses it** (W-EE11); the tests of this spec do not need M7.
9. **The duration hint shows the start date.** **Recommended: yes** (it tells how the end moves, with no computed field). Alternative: a live "Ends {time}" line under the field, which needs a computation and a test per case; not asked for.
