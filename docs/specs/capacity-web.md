# Spec: Change the capacity of an event, web (M4 UI)

Feature spec for the capacity form on the organizer event page, made from `SPEC_TEMPLATE.md` (sections 1-5; its behaviours are not requirements). Roadmap step 22 (the capacity form part; the cancel button is `cancel-registration-web.md`) and step 23 builds it, tests first. The API side is `capacity.md` (CP1-CP24, route `POST /events/:id/capacity`); this file does not change it. It follows the style of `email-reminders-web.md` (W-EM16-W-EM34, the reschedule and cancel section, which it sits next to) and `event-edit-web.md` (W-EE4-W-EE9, a prefilled form with field errors). Login, guards and `ApiError` are `auth-web.md`; style values are `docs/brand.md`. Nothing is live (D50, D51): no polling. Ids are **W-CP1, W-CP2, ...** (checked: free).

## 1. Goals and expected behaviour

**Goal.** On the organizer view of an event page `/event/{id}` the owner of an open event that has not started sees a small form "Capacity". It is filled with the current capacity. A value below the number of people already registered shows a field error; a valid new value is saved, the page shows the new seats left, and the people moved up from the waiting list are handled by the API (they get an email).

**What the API gives** (`capacity.md`): `POST /events/:id/capacity` with `{ "capacity": <integer> }` answers 200 with the organizer event (new `capacity`, `registered`, `seats_left`; also for a repeat of the same value); 400 `invalid_input`; 401 `not_logged_in`; 403 `wrong_role`; 404 `not_found` (malformed, unknown or foreign id); 409 `capacity_below_registered` with a second key `registered` (the real count); 409 `event_cancelled`, `event_passed`, `event_started`. The 200 does not say who was promoted.

**Behaviours.** Each line is checked with a component or unit test (`fetch` mocked; fake system time where the clock matters). "Test first" ones get the test before the code.

*When the form exists*

| # | Behaviour | Test first? |
|---|---|---|
| W-CP1 | **When the section is shown.** The owner view (`OrganizerEventView`) renders the section "Capacity" (W-CP2) only while `status` is `active` **and** `starts_at` is later than the browser clock at render time: the rule of W-EM16, because the API refuses a started event (`capacity.md` CP4). For `cancelled`, `passed` (Ended) or a running event the form is not rendered (no disabled field, no hint; the badge says why; the "Capacity" line of the details stays). The clock is only a hint; the server decides (409, W-CP9). The public view and every non-owner never show it. The component is always mounted in the owner view, so its message stays on screen when the form goes away after a 409. **Position:** after the "Registrations" link and before the M7 section "Change the event" (`EventSchedule`), which is not edited. Test (fake system time): active in the future shows the form; `cancelled`; `passed`; `active` with `starts_at` one minute ago; `starts_at` exactly now (hidden); public view of the same event has none. | yes |

*The form*

| # | Behaviour | Test first? |
|---|---|---|
| W-CP2 | **The form.** An `h2` "Capacity" (`schedule-heading` look), then a form (`noValidate`) with one field labelled "Capacity (seats)" (text input, `inputMode="numeric"`, as the create form), its hint, and a button "Save capacity" (`button-primary`, at least 48px, `type="submit"`). Hint: "1 to 100000. Not below the {n} registered {person\|people}. More seats go to the waiting list in order, and those people get an email." where `{n}` is the page's `registered` (exact text in section 2). The field has a `<label>`, `aria-invalid` when it has an error, and `aria-describedby` to its error and hint (as W-E20). The start value is `String(event.capacity)` of the page's event, set **once**; a later background read of `["events", id]` never overwrites what the user typed, but the hint and the checks of W-CP3 always use the current `registered` of the page. Test: the field shows the loaded capacity; a refetch with another `registered` changes the hint and leaves a typed value alone. | yes |
| W-CP3 | **Checks before any request** (the validator `validateCapacity` and its `ERRORS.capacity` text are reused, not copied). On submit, in this order: not a whole number from 1 to 100000 (empty, text, `0`, `1.5`, `100001`) shows "Enter a whole number from 1 to 100000."; a number below the page's `registered` shows "Capacity cannot be below {n} registered {person\|people}." (new `ERRORS` text built by a new pure function `validateCapacityChange(value, registered)` in `validate.ts`, returns the text or `null`); a value equal to the page's `capacity` shows the notice "That is already the capacity. Nothing changed." (`role="status"`). The first two are field errors under the field (`role="alert"`, `aria-invalid`) and focus moves to the field; none of the three sends a request. The server stays the authority (W-CP9). Test: empty; `abc`; `0`; `1.5`; `100001`; `registered - 1` (with `registered` 3: `2`); `registered` itself (allowed); the unchanged value; each with zero `fetch` calls and the right text, role and focus. | yes |
| W-CP4 | **The request.** A valid, changed value sends exactly one `POST /events/{id}/capacity` (`id` through `encodeURIComponent`), `Content-Type: application/json`, body exactly `{"capacity":<number>}` (a JSON number, not a string, from the trimmed text). No other key. Test: URL, method, header, the exact body for `"12"` and for `" 12 "`. | yes |
| W-CP5 | **Pending and double submit.** While the request runs the button reads "Saving..." and is `disabled`, the field keeps its value, and a second submit (click, Enter) sends nothing (a ref guard as in W-E7 and W-EM20, released on settle). Test: two quick submits make one `fetch` call. | yes |

*Success*

| # | Behaviour | Test first? |
|---|---|---|
| W-CP6 | **Success (200).** The answer is put into `["events", id]` with `setQueryData` (no extra GET), so the details of the page ("Capacity", "Registered", "Seats left") show the new numbers at once. The field is reset to the answer's capacity, any field error is cleared, and a message `role="status"` (`tabIndex={-1}`, focus moves to it) shows "Capacity saved. Seats left: {seats_left}." with the answer's `seats_left`. It claims nothing about who was moved up or about delivery. The message stays until the next submit or until the page is left. A 200 for a repeat or a server-side no-op is shown the same way. Test: the details change, the message holds the new seats left, the field value, focus, no extra `fetch`. | yes |
| W-CP7 | **What a success invalidates** (keys from `events/queries.ts`, `registrations/`; the same set as a cancel in W-EM28, through the existing `invalidateAfterChange(queryClient, id, true)`, because promoted people change status and get a `promotion` email row). Set `["events", id]`; invalidate `["events"]` (exact; the organizer list shows `registered / capacity`), `["public-event", id]` (exact; seats left and Full), `["public-events"]` (exact; the home list), and the prefixes `["registration-emails"]`, `["registrations"]`, `["registration"]`, `["event-registrations"]`, `["event-arrivals"]` (promoted people appear in the lists, the arrivals counter shows the capacity). A client check (W-CP3) invalidates nothing. Nothing is refetched by a timer; mounted queries refetch at once, the others on their next mount. Test: after a success the listed keys are `isInvalidated` and an unrelated key (another event's `["public-event", other]`) is not. | yes |

*Errors*

| # | Behaviour | Test first? |
|---|---|---|
| W-CP8 | **Below the registered count from the server** (409 `capacity_below_registered`, body `registered`). The field error under the field (`role="alert"`) is the text of W-CP3 with the **server's** `registered` ("Capacity cannot be below {n} registered {person\|people}."), `aria-invalid`, focus moves to the field, the typed value is kept. `["events", id]`, `["events"]` and `["public-event", id]` are invalidated (exact), so the page's `registered` and the hint catch up. If the body has no usable `registered` (missing, not a whole number): "Something went wrong. Try again." as in W-CP9. Test: a 409 with `registered: 5` shows "5 registered people" even when the page believed 3; focus; value kept; the invalidated keys. | yes |
| W-CP9 | **Other errors** (the body `{ "error": code }` is read, `EventActionError`). The message is `role="alert"` (class `form-error schedule-message`, `tabIndex={-1}`, focus moves to it) and the value is kept. 400 `invalid_input`: the field error "Enter a whole number from 1 to 100000." with focus on the field (as W-EM23). 409 `event_cancelled`: "This event is cancelled and cannot be changed." 409 `event_passed`: "This event has already ended and cannot be changed." 409 `event_started`: "This event has already started and cannot be changed." (the three texts of W-EM23, reused from one shared map, not copied). After any of these three `["events", id]`, `["events"]` and `["public-event", id]` are invalidated (exact), so the page shows the real status and the form goes away (W-CP1) while the message stays. 404: no text of its own; the same invalidations (the page falls back as in W-E10/W-E11). 401 or 403: `["me"]` is invalidated (`onApiError`, W-E13) and the guard takes over; no text. Network error, 5xx, or a 409 with an unknown or missing code: "Something went wrong. Try again." and nothing is invalidated. No automatic retry. Test: every row (text, role, focus, value kept, invalidated keys). | yes |

*Plumbing, other screens, accessibility*

| # | Behaviour | Test first? |
|---|---|---|
| W-CP10 | **Client plumbing, no proxy change.** `events/api.ts` gets `setCapacity(id, capacity)` (through `request`, `POST`, JSON body) that returns the organizer event through `withDescription` and throws `EventActionError`. `EventActionError` (exists, `code` only) gets one optional field `registered?: number`, set from the body when it holds a whole number >= 0 and `undefined` otherwise (the reader `errorCode` is extended to return both; the reschedule and cancel behaviour is unchanged and their tests pass). `events/queries.ts` gets `useSetCapacity(id)` (`useMutation`; `onSuccess` per W-CP6/W-CP7; `onError` through `onActionError`, W-CP8, W-CP9). `vite.config.ts` is unchanged: the `/events` prefix of the dev and preview proxy already carries `POST /events/:id/capacity`. Test: `setCapacity` sends method, header and body; a 409 with `capacity_below_registered` and `registered: 4` gives code and `registered` 4; a 409 with a non-JSON body gives `""` and no `registered`; a 409 with `registered: "4"` or `-1` gives no `registered`. | yes |
| W-CP11 | **Other screens change by what they read; no new element is added to any of them.** The details of the organizer page show the new numbers from the cache; the organizer list (`registered / capacity`), the public event page and the home list (seats left, Full or Open badge), the registrations table (promoted people appear), the arrivals counter and an attendee's ticket page ("Registered" instead of the waiting place) show the change after their next read (W-CP7). No "promoted" list, count or note anywhere. Nothing is live (D50, D51): the page sends no request after the answer, and nothing polls (fake timers: after a save, 60 000 ms, `visibilitychange` and `online` cause no request). Regression tests: the details from the cached answer; no change to `EventSchedule`, `PublicEventPage`, `OrganizerRegistrations`. Existing tests pass without edits. | |
| W-CP12 | **Accessibility and layout.** Every control has a text name (no colour alone); the field has a `<label>`; an invalid field has `aria-invalid="true"` and `aria-describedby` to its error and hint; field errors and the form error are `role="alert"`, the success message and "Nothing changed" are `role="status"`, each with `tabIndex={-1}` where focus moves to it, after it is on screen. The section is a `section` labelled by its `h2` (one `h2` more on the page, no second `h1`). Button 48px, full width in the card on a phone. Organizer indigo accent, `data-role="organizer"`, **no red**, no new colour, no confirm step (a capacity can be changed again), no dialog, no library, no portal. Reuse `form`, `field`, `hint`, `field-error`, `form-error`, `schedule-heading`, `schedule-message`, `button-primary`; add only a small rule in `styles.css` for the 24px spacing above the section if no class fits. | |

**Out of scope.** A confirm step; a count or list of the people moved up from the waiting list; a preview of the emails; a warning that lowering has no effect on the waiting list; capacity of a cancelled, ended or running event (the form is hidden; the API refuses it); capacity in the create form (exists) or in `PATCH /events/:id` (refused by the API); the edit form (`event-edit-web.md`, which has no capacity field); changing the form of the reschedule or cancel (`EventSchedule` is not edited); the cancel button for attendees (`cancel-registration-web.md`); polling and live updates (D50, D51); translations; dark theme; any change in `api/`.

**Assumptions.** Change any of these first in this file.
- `capacity.md` is built, and `api/openapi.yaml` updated, before the web step (as for the arrivals, emails and M7 routes).
- The page's `registered` comes from the organizer event it already has (`["events", id]`) and may be stale; the server's 409 carries the real number and corrects it (W-CP8). No browser clock is used except for the hint of W-CP1.
- The prefilled value is the current capacity (unlike the reschedule field, which starts empty), so the form shows what is stored and the unchanged check is natural.
- The success message does not say that people were promoted: the answer does not say how many were (`capacity.md` question 7), and "emails queued" would be untrue when nobody waited. The hint under the field already explains what raising does.
- A server-side no-op (200 with the same capacity, e.g. a second tab saved the same value) shows "Capacity saved." and invalidates the usual keys; it is harmless and rare.
- `EventActionError` and the shared 409 texts of `EventSchedule.tsx` exist (M7 is built); this step only adds the optional `registered` field and exports the text map.

## 2. UI decisions

| Screen | Route | API route | Query key | What it shows and does |
|---|---|---|---|---|
| Organizer event page (exists, W-E10), new section | `/event/{id}` (owner view) | `POST /events/:id/capacity` | stores `["events", id]`; invalidates per W-CP7 | Section "Capacity": field, hint, "Save capacity", messages, while the event is active and in the future (W-CP1-W-CP9). Organizer only. |
| Organizer list, public page, home list, registrations, arrivals, ticket page | unchanged | none | read as before | Show the change by what they read (W-CP11). No new element. |

**Texts (exact).** `{n}` is a whole number; "registered person" when `n` is 1, "registered people" otherwise.

| Where | Text |
|---|---|
| Section heading | "Capacity" |
| Label | "Capacity (seats)" |
| Hint | "1 to 100000. Not below the {n} registered {person\|people}. More seats go to the waiting list in order, and those people get an email." |
| Button | "Save capacity", pending "Saving..." |
| Field error, not a number | "Enter a whole number from 1 to 100000." (the `ERRORS.capacity` of the create form) |
| Field error, below the count (client and 409) | "Capacity cannot be below {n} registered {person\|people}." |
| Nothing changed | "That is already the capacity. Nothing changed." |
| Success | "Capacity saved. Seats left: {seats_left}." |
| 409 `event_cancelled` | "This event is cancelled and cannot be changed." |
| 409 `event_passed` | "This event has already ended and cannot be changed." |
| 409 `event_started` | "This event has already started and cannot be changed." |
| Other failures | "Something went wrong. Try again." (401, 403 and 404 have no text of their own) |

Note on the hint: with `{n}` = 1 it reads "Not below the 1 registered person." and with 3 "Not below the 3 registered people."; with `{n}` = 0 it reads "Not below the 0 registered people." (the lower limit 1 still applies).

**Look.** The reschedule form's look (`brand.md` "Reschedule and cancel"): `h2` 22px 700 Bricolage Grotesque, the field, hint and field error as the create form, 24px above the section, success message 16px 600, errors in the form error box, organizer indigo, no red.

**States of the section.** Hidden (cancelled, ended, started; the message of a 409 stays); idle with the loaded value; field error (not a number, below the count, from the server); nothing changed; pending; saved; one error message per row of W-CP9.

**Design boards** (new states of an existing screen, so they go on the **existing** canvas https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76; do not edit it from this spec; no new artifact), at desktop and phone width, organizer (indigo) accent: **"Organizer event: capacity"**: (1) idle, prefilled value, hint, between the "Registrations" link and the "Change the event" section; (2) client field error below the count; (3) pending ("Saving..."); (4) saved ("Capacity saved. Seats left: 3." with the details above showing the new numbers); (5) server field error with a count that differs from the page; (6) "Nothing changed" notice; (7) form error (event started, something went wrong); (8) the same page for a Cancelled, an Ended and a started event with no section. If the canvas already has a board for the organizer event page with the M7 section, add (1) to that board instead of repeating the page. Add a line for the section to `docs/brand.md` after the canvas is updated.

## 3. Architecture decisions

- **Apps:** `web/` only. No new library, no `api/` change, no proxy change (W-CP10).
- **New component `web/src/events/EventCapacity.tsx`:** the section (form, checks, pending, message, focus). Props: `event` (an `OrganizerEvent`). Mounted always by `OrganizerEventView`, keyed by the event (`key={event.id}`) like `EventSchedule`, so a message never carries to another event; it returns `null` when the section is not open and there is no message (as `EventSchedule` does). It follows `EventSchedule.tsx` (ids from `useId`, `focusRequest` effect, ref guard, a `Message` state, `canChange`-style clock check) and `EditEventForm`'s prefilled value. The clock check `canChange` is exported from `EventSchedule.tsx` (or moved to a small shared function) rather than copied; the 409 text map `RESCHEDULE_CONFLICT` is exported and reused for the three closed codes (W-CP9).
- **`validate.ts`:** one new pure function `validateCapacityChange(value, registered)` and its `ERRORS` text builder (a function of `registered`, since the text holds the number); `validateCapacity` is used as it is. Unit-tested in `validate.test.ts`.
- **`api.ts`:** `setCapacity`; `EventActionError.registered?` and the extended body reader (W-CP10).
- **`queries.ts`:** `useSetCapacity(id)` using `invalidateAfterChange(queryClient, id, true)` and `onActionError` (both exist in the file).
- **`EventPage.tsx`:** `OrganizerEventView` renders `<EventCapacity key={event.id} event={event} />` between the "Registrations" link and `EventSchedule`; its header comment is updated (the M7 comment says the section sits between the link and the share line).
- **No change** in `EventSchedule.tsx` behaviour, `CreateEventForm.tsx`, `PublicEventPage.tsx`, `registrations/`, `auth/api.ts`, `vite.config.ts`, `package.json`.
- **Styles:** reuse existing classes; add only the spacing rule if needed.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/events/validate.test.ts` | **Tests first (red):** `validateCapacityChange` (below, at and above `registered`; singular and plural text; not a number is left to `validateCapacity`) | W-CP3 |
| `web/src/events/EventCapacity.test.tsx` (new) | **Tests first (red):** W-CP1 (visibility table with fake time), W-CP2 (prefill, a refetch does not overwrite typing), W-CP3 (every client check, zero `fetch` calls), W-CP4 (exact bodies), W-CP5 (double submit), W-CP6 (success, details, message, focus, no extra `fetch`), W-CP7 (`isInvalidated` keys and an untouched unrelated key), W-CP8 (server count differs from the page), W-CP9 (every error row, focus, value kept, form goes away after a 409), W-CP10 (`setCapacity` request, `EventActionError.registered` cases), W-CP11 (fake timers: no request after a save), W-CP12 (labels, `aria-*`, roles) | W-CP1-W-CP12 |
| `web/src/events/EventPage.test.tsx` | **Tests first (red):** the section appears in the owner view of an open future event, in the right place (after "Registrations", before "Change the event"), and not in the public view or for `cancelled`/`passed`; the details show the numbers of a cached answer. Existing tests pass without edits | W-CP1, W-CP11 |
| `web/src/events/validate.ts` | `validateCapacityChange` and its text | W-CP3 |
| `web/src/events/api.ts`, `web/src/events/queries.ts` | `setCapacity`, `EventActionError.registered`, `useSetCapacity` | W-CP4-W-CP10 |
| `web/src/events/EventCapacity.tsx` (new) | The section | W-CP1-W-CP9, W-CP12 |
| `web/src/events/EventSchedule.tsx` | Export the clock check and the closed-event text map only; no behaviour change | W-CP1, W-CP9 |
| `web/src/events/EventPage.tsx` | Render the section; update the header comment | W-CP1 |
| `web/src/styles.css` | Only if the section needs a spacing rule | W-CP12 |
| `docs/brand.md`, design canvas | One line for the capacity section; the board "Organizer event: capacity" in the existing canvas | |
| `README.md`, `ROADMAP.md` | Steps 22 and 23: the organizer can change the capacity from the event page; mark them when done | |

Tests follow `registration-web.md` section 4 (Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test with `retry: false`, `MemoryRouter`, only `@testing-library/react`; the helpers in `web/src/events/test-helpers.ts`).

Not touched: `api/`, `web/package.json`, `vite.config.ts`, `CreateEventForm.tsx` behaviour, `registrations/`, `auth/`.

## 5. Done means

- Tests, typecheck and linter pass in `web/` (`bash scripts/verify.sh`).
- Every behaviour W-CP1 to W-CP12 has a test, or a note in the README that says it is not covered.
- Tests first, committed red before the code and shown failing for the right reason: `validate.test.ts` (`validateCapacityChange`), `EventCapacity.test.tsx` and the section cases of `EventPage.test.tsx`.
- Request-count proof: every failing client check and the unchanged value send nothing; a valid change sends one `POST`; a double submit sends one; nothing is sent after the answer or after 60 s.
- `git diff --stat` shows no file under `api/`, no `vite.config.ts` and no `web/package.json`.
- By hand, once, with the API running: an event with capacity 2, 2 registered and 3 waiting; type `1` and see the field error without a request; raise to 4 and see "Capacity saved. Seats left: 0.", the details at Capacity 4 and Registered 4, the two first waiting people as `registered` on the registrations page and a `promotion` row in their emails table; register an attendee in another tab and try to lower below the new count to see the server's count; cancel the event in another tab and save to see the closed message and the form gone; open the page as an attendee and as a stranger (no form).

## 6. Open questions (each with a recommended answer)

1. **Where the form lives.** **Recommended: a section on the event page**, before the M7 section (W-CP1). Alternative: inside `EventSchedule` between the reschedule form and "Cancel event" (one section "Change the event"), at the price of editing that component and its always-mounted message logic.
2. **Prefilled or empty field.** **Recommended: prefilled with the current capacity** (W-CP2). Alternative: empty, like the reschedule field; then "unchanged" can only be caught after a value is typed.
3. **Success message.** **Recommended: "Capacity saved. Seats left: N."** with no claim about promotions (W-CP6). Alternative: add "Emails to people moved up from the waiting list are queued." (untrue when nobody waited unless the API returns a count, `capacity.md` question 7).
4. **Client check against the page's `registered`.** **Recommended: yes**, so the common mistake needs no request (W-CP3), and the server's number wins when they differ (W-CP8). Alternative: send always and rely on the 409.
5. **Hide or disable when not allowed.** **Recommended: hidden** (W-CP1), as W-EM16 decided. Alternative: a disabled field with a hint.
6. **Running events.** The form is hidden for a started event because the API refuses it (`capacity.md` question 2). **Recommended: keep it so.** If that answer changes to "allowed", only the clock part of W-CP1 and the `event_started` text change.
7. **Confirm step for lowering.** **Recommended: none** (the API refuses a value that would remove seats from registered people, so lowering is harmless). Alternative: a confirm panel as W-EM24 for a raise that promotes many; not asked for.
8. **Invalidate the organizer registration keys.** **Recommended: yes** (W-CP7), the same set as a cancel, because promoted people change status. Alternative: only the event keys; the other pages would still read again on their next mount.
9. **Reuse of the M7 texts.** **Recommended: reuse the three closed-event sentences** ("cannot be changed", W-CP9) through one exported map. Alternative: new capacity-specific sentences ("cannot change its capacity"); more text to keep in step.
