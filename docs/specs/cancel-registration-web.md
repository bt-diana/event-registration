# Spec: Cancel registration button on the ticket page (M4 UI, web)

Feature spec for the web side of the attendee cancel, made from `SPEC_TEMPLATE.md` (sections 1-5; its behaviours are not requirements). Roadmap step 22 (the cancel button part; the capacity form is a separate spec) and step 23 builds it, tests first. The API side is `cancel-registration.md` (CR1-CR27, route `POST /events/:id/registrations/me/cancel`); this file does not change it. It is a **new file**, not an extension of `registration-web.md` (user request); it supersedes one line of that file for the ticket page: "No button on this page" (W-R11). The ticket page, its statuses and badges are `registration-web.md` (W-R7, W-R11, W-R12, W-R25, W-R38, W-R42). The confirm panel follows `email-reminders-web.md` W-EM24 (no library, no `window.confirm`). Style values are `docs/brand.md`. Nothing is live (D50, D51). Ids are **W-CR1, W-CR2, ...**

## 1. Goals and expected behaviour

**Goal.** On the ticket page `/registrations/me?event={id}` an attendee with a seat or a place on the waiting list sees a button "Cancel registration". It opens a short confirm step in place; a second click cancels. Afterwards the ticket page shows a cancelled ticket and a message, and the other screens show the change the next time they are read.

**What the API gives** (`cancel-registration.md`): 200 with the registration (`status` `cancelled`; also for a repeat); 401 `not_logged_in`; 403 `wrong_role`; 404 `not_found`; 409 `already_checked_in`, `event_started`, `event_passed`, `event_cancelled`. The 200 does not say whether someone was promoted.

**Behaviours.** Each line is checked with a component or unit test (`fetch` mocked; fake system time is not needed because the page uses the event's `has_started` from the server). "Test first" ones get the test before the code.

*When the button exists*

| # | Behaviour | Test first? |
|---|---|---|
| W-CR1 | **When the section is shown.** The ticket page renders the section "Cancel registration" (W-CR2, W-CR3) only when all hold: the registration `status` is `registered` or `waitlisted`; `checked_in_at` is `null`; the public event has `status` `active` and `has_started` false. Pure function `canCancel(registration, event)` in `ticket.ts`. Otherwise **no button, no disabled button, no hint**: cancelled ticket, checked-in ticket (W-R25), event Cancelled, Ended or Already started. The badge already says why. The section exists on the ticket page only: not in the event page panel, not on the attendee list, not on the organizer screens. Loading, load error and "no ticket" states (W-R12) have none. Test: a table of `registered`, `waitlisted`, `cancelled`, `registered` + checked in, each with an active, a started, a cancelled and an ended event. | yes |

*Button and confirm step*

| # | Behaviour | Test first? |
|---|---|---|
| W-CR2 | **The button.** Under the ticket panel (after the QR, if any): a `<button type="button">` "Cancel registration", class `button-secondary`, at least 48px, full width in the card on a phone. A click sends nothing and opens the confirm panel (W-CR3); while the panel is open the button is not rendered. | yes |
| W-CR3 | **The confirm panel (no library, no `window.confirm`, no dialog element).** A `div role="group"` labelled by its `h2`. Wording by the status **at the time the panel opened**: `registered`: `h2` "Cancel your registration?", text "Your seat goes to the next person on the waiting list. If you register again later and the event is full, you join the end of the waiting list."; `waitlisted`: `h2` "Leave the waiting list?", text "You lose your place. If you join again later, you go to the end of the list." Buttons for both: "Yes, cancel registration" (`button-primary`) and "Keep registration" (`button-secondary`). Focus moves to "Keep registration" (the safe default). "Keep registration" closes the panel, sends nothing and gives the focus back to "Cancel registration". Test: both wordings; open sends zero `fetch` calls; Keep closes, focus back, zero calls. | yes |
| W-CR4 | **The request and pending.** "Yes, cancel registration" sends exactly one `POST /events/{id}/registrations/me/cancel` (`id` through `encodeURIComponent`; no body, no `Content-Type`). While it runs both panel buttons are `disabled`, "Yes" reads "Cancelling...", the panel has `aria-busy="true"`, and a second click sends nothing (a ref guard, as W-R5). The guard is released after the answer. The attendee's account id is the mutation variable (as `useRegister`, W-R6), so the answer is stored under the account that clicked. Test: two quick clicks, one `fetch` call; URL, method, no body. | yes |

*Success*

| # | Behaviour | Test first? |
|---|---|---|
| W-CR5 | **Success (200).** The answer is put into `["registration", me.id, eventId]` with `setQueryData` (no extra GET). The ticket page then shows what it already shows for a cancelled ticket: badge "Cancelled", the old ticket code as text with "This ticket is no longer valid." (W-R7), **no QR** (`showQr` is false), no cancel section (W-CR1). The panel closes and a message `role="status"` (`tabIndex={-1}`, focus moves to it) shows: "Registration cancelled. Your seat is free for someone else." (was `registered`) or "Registration cancelled. You are no longer on the waiting list." (was `waitlisted`), and under it the link "Go to the event" (`/event/{id}`, the look and text of W-R12), because registering again happens on the event page, where the cancelled ticket gives the button "Register again" or "Join waiting list" (W-R4). The message stays until the next action or until the page is left; it lives in the component that owns the section (always mounted, so the message survives the controls going away), not in the query cache. A 200 for a ticket that was already cancelled (a repeat, a second tab) is shown the same way. Test: badge, no QR, no section, message by earlier status, the link, focus, no extra `fetch`. | yes |
| W-CR6 | **What a success invalidates** (keys from `events/queries.ts` and `registrations/queries.ts`): `["registrations", me.id]` (exact; the attendee list shows "Cancelled" on its next read), `["public-event", eventId]` (exact; seats left and Full change) and `["public-events"]` (exact; the home list badge). Nothing else: the organizer queries (`["event-registrations"]`, `["event-arrivals"]`, `["registration-emails"]`) belong to organizer accounts and are read again on every mount (`staleTime: 0`, `refetchOnMount: "always"`; W-C7, W-EM4), so they need no invalidation. No request is sent for a query that is not mounted. Test: after a success the three keys are `isInvalidated`, the registration key holds the answer, and an unrelated key (another event's `["public-event", other]`, `["event-arrivals"]`) is not invalidated. | yes |

*Errors*

| # | Behaviour | Test first? |
|---|---|---|
| W-CR7 | **Errors by code.** The panel closes, the message is `role="alert"` (class `error-box`, `tabIndex={-1}`, focus moves to it) and the section stays mounted so the message stays. 409 `already_checked_in`: "You have already checked in, so this registration cannot be cancelled." and the registration query is invalidated (exact), so the page shows the "Checked in" badge and drops the section. 409 `event_started`: "This event has already started, so the registration can no longer be cancelled." 409 `event_passed`: "This event has ended, so the registration can no longer be cancelled." 409 `event_cancelled`: "This event has been cancelled." For these three `["public-event", eventId]` is invalidated (exact), so the status and `has_started` update and the section is hidden (W-CR1); `event_cancelled` also invalidates the registration query. 404: no text of its own; the registration and public event queries are invalidated (the page then shows "You have no ticket for this event." or "Event not found", W-R12). 401 or 403: `["me"]` is invalidated (`onApiError`, W-R13) and the guard takes over; no text. Network error, 5xx, or a 409 with an unknown or missing code: "Something went wrong. Try again." and nothing is invalidated; the button is back. No automatic retry. Test: every row (the text, the role, the focus, the invalidated keys). | yes |
| W-CR8 | **Client plumbing.** `registrations/api.ts` gets `cancelRegistration(eventId)` in the style of `checkIn`: it returns `{ outcome: "cancelled", registration }` for a 200 and `{ outcome: "already_checked_in" \| "event_started" \| "event_passed" \| "event_cancelled" }` for those four 409 codes, and throws `ApiError(status)` for everything else (401, 403, 404, 5xx, an unknown 409, `ApiError(0)` for a network error). `queries.ts` gets `useCancelRegistration(eventId)` (`useMutation`, variable = account id; `onSuccess`, `onError` as W-CR5-W-CR7). `ApiError` in `auth/api.ts` is not changed, and the `EventActionError` of `email-reminders-web.md` W-EM34 is not needed (so this step does not wait for M7's UI). Test: a table of status/body -> outcome or thrown status; a 409 with a non-JSON body throws `ApiError(409)`. | yes |

*Other screens, accounts, live updates*

| # | Behaviour | Test first? |
|---|---|---|
| W-CR9 | **The other screens change by what they read; no new element is added to any of them.** *Event page* (`/event/:id`): the ticket panel reads `["registration", me.id, id]`, so right after the cancel it shows "Registration cancelled" and, for an open event, the button "Register again" (or "Join waiting list" when full). *Attendee list* `/registrations/me`: the row shows the badge "Cancelled" after its next read (the row keeps its link, W-R40). *Public event page and home list*: seats left and the Full or Open badge are read again on the next mount (W-CR6). Regression tests: the event page panel from the cached cancelled answer; the list row from a mocked `GET /me/registrations`; no change to `RegistrationArea`, `MyRegistrations`, `PublicEventPage`. | |
| W-CR10 | **Cache by account.** The mutation variable and the stored answer use the id of the account that clicked (W-R23); the section is rendered inside the attendee entry, which is keyed by the account. Test: cancel as attendee A, set `me` to attendee B on the same event: A's message and cancelled answer are not rendered for B, and B's ticket is read for B's key. | yes |
| W-CR11 | **Nothing is live (D50, D51).** The page sends no request after the cancel (no `GET .../me`, W-CR5), and nothing polls: another person's cancel does not move this page's "Your place" until the page is read again (a reload or a new visit). Test with fake timers: after mount and after a cancel, 60 000 ms, `visibilitychange` and `online` cause no request. | yes |
| W-CR12 | **Accessibility and look.** "Cancel registration" is a real `<button type="button">`; the panel is `role="group"` labelled by its `h2` (so the ticket page then has one `h1` and one `h2` only while the panel is open); status text is never colour alone; the success message is `role="status"`, an error `role="alert"`, each with `tabIndex={-1}` and focus moved to it after it is on screen; focus on open is "Keep registration", after Keep "Cancel registration", after an answer the message. All buttons are 48px high (at least 44px, `brand.md`). The panel is a 1px `border` box with 16px padding and 8px radius inside the card, buttons side by side over 520px and stacked, full width, up to 520px. **No red or danger colour on any button** (`brand.md` has no destructive button): "Cancel registration" is `button-secondary`, "Yes, cancel registration" is `button-primary` in the attendee accent `#0B6E5F`. The error message uses the existing error box tokens of `brand.md` (error text, tint, 2px border). No new colour, no new library, no portal. | |
| W-CR13 | **No proxy change.** `vite.config.ts` is unchanged: the `/events` prefix of the dev and preview proxy already carries `POST /events/:id/registrations/me/cancel`. The web route `/registrations/me` is not proxied. | |

**Out of scope.** The organizer capacity form and the capacity change (separate spec); cancelling from the event page panel or from the attendee list; cancelling someone else's ticket; an undo; a reason field; a cancel email or a note about one; showing who was promoted or the place of others; a cancellation window; a "Cancelled" row in the organizer table (`design-alignment.md` DA15 stays blocked); polling and live updates (D50, D51); translations; dark theme; any change in `api/`.

**Assumptions.** Change any of these first in this file.
- The API route exists before the web step (`cancel-registration.md` is built and `openapi.yaml` updated), as for the arrivals and emails routes.
- The ticket page already has the public event (`["public-event", id]`: `status`, `has_started`) and the registration, so W-CR1 needs no new request and no browser clock. The server decides (409 codes); the page may be stale, which W-CR7 handles.
- A cancelled ticket keeps showing its old ticket code (W-R7, `registration.md` line 47). This spec changes nothing there.
- Registering again is done on the event page, as W-R11 says ("register stays on the event page"). This page only links to it.
- The existing test `TicketPage.test.tsx` that expects no buttons for a `registered` and a `waitlisted` ticket (and no `h2`) is updated in the tests-first commit to the new rule: one "Cancel registration" button for those two, none for `cancelled`, and no `h2` while the panel is closed.

## 2. UI decisions

| Screen | Route | API route | Query key | What it shows and does |
|---|---|---|---|---|
| Ticket page (exists, W-R11), new section | `/registrations/me?event={id}` | `POST /events/:id/registrations/me/cancel` | stores `["registration", me.id, id]`; invalidates `["registrations", me.id]`, `["public-event", id]`, `["public-events"]` | Button, confirm panel, pending, message, errors (W-CR1-W-CR8). Attendee only. |
| Event page, attendee list, home list, organizer screens | unchanged | none | read as before | Show the change by what they read (W-CR9). No new element. |

**Texts.**

| Where | Text |
|---|---|
| Button | "Cancel registration" |
| Panel, seat | `h2` "Cancel your registration?"; "Your seat goes to the next person on the waiting list. If you register again later and the event is full, you join the end of the waiting list." |
| Panel, waiting list | `h2` "Leave the waiting list?"; "You lose your place. If you join again later, you go to the end of the list." |
| Panel buttons | "Yes, cancel registration" (pending "Cancelling..."), "Keep registration" |
| Success, was a seat | "Registration cancelled. Your seat is free for someone else." |
| Success, was waiting | "Registration cancelled. You are no longer on the waiting list." |
| Link after success | "Go to the event" |
| 409 `already_checked_in` | "You have already checked in, so this registration cannot be cancelled." |
| 409 `event_started` | "This event has already started, so the registration can no longer be cancelled." |
| 409 `event_passed` | "This event has ended, so the registration can no longer be cancelled." |
| 409 `event_cancelled` | "This event has been cancelled." |
| Other failures | "Something went wrong. Try again." (401, 403 and 404 have no text of their own) |

**States of the section.** Hidden (cancelled, checked in, event closed or started, or the page is loading, failed or has no ticket); idle (button); confirm open (seat wording, waiting wording); confirm pending; success (message and link; section gone); one error message per row of W-CR7.

**Design boards.** A new state of an existing screen, so one board **"Ticket: cancel registration"** is added to the **existing** design canvas (https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76, linked from `README.md` and `docs/brand.md`; no new artifact; this spec does not edit it), at desktop and phone width, attendee (teal) accent: (1) a registered ticket with the button; (2) the same with the confirm panel open (seat wording); (3) a waiting-list ticket with the panel open (waiting wording); (4) pending ("Cancelling..." with both buttons disabled); (5) after success for a seat (badge "Cancelled", no QR, message, link "Go to the event"); (6) the same for a waiting ticket (message only differs); (7) three error messages in the error box (checked in, event started, something went wrong). If the canvas has no board for the ticket page in the cancelled state, board (5) is that board. No other board: the event page, list and home list show existing states (W-CR9). Add a line for the confirm panel and the section to `docs/brand.md` after the canvas is updated.

## 3. Architecture decisions

- **Apps:** `web/` only. No new library, no `api/` change, no proxy change (W-CR13).
- **`registrations/api.ts`:** `cancelRegistration(eventId)` and its result type (W-CR8), built on `request` from `auth/api.ts`, in the style of `checkIn`.
- **`registrations/queries.ts`:** `useCancelRegistration(eventId)`, written like `useRegister` (variable = account id; `onSuccess` sets `registrationKey(meId, eventId)` and invalidates `myRegistrationsKey(meId)`, `publicEventKey(eventId)`, `PUBLIC_EVENTS_KEY`, all exact; `onError` calls `onApiError` for 401 and 403). The 409 and 404 invalidations of W-CR7 are made in the handler for the result outcomes.
- **`registrations/ticket.ts`:** `canCancel(registration, event)` (W-CR1) next to `showQr`; pure.
- **New component `registrations/CancelRegistration.tsx`:** the section (button, confirm panel, pending, message, errors). Props: `registration`, `event`, `eventId`. Always mounted by `TicketPage` when a ticket exists (so the message outlives the controls); it renders the controls only when `canCancel(...)`. It owns the ref guard, the open/pending state, the message and the focus work. Reuses `button-primary`, `button-secondary`, `error-box`, `status`, `button-link`.
- **`registrations/TicketPage.tsx`:** renders `CancelRegistration` after `TicketPanel`; the header comment is updated ("No button" no longer holds). Keyed by the account like the attendee area (W-CR10).
- **No change** in `RegistrationArea.tsx`, `TicketPanel.tsx`, `MyRegistrations.tsx`, `PublicEventPage.tsx`, `auth/api.ts`, `vite.config.ts`, `package.json`.
- **Styles:** reuse existing classes; add only a small rule for the panel border and padding (and stacked buttons up to 520px) in `styles.css` if no class fits.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/registrations/ticket.test.ts` | **Tests first (red):** `canCancel` table (four registrations x four event states) | W-CR1 |
| `web/src/registrations/api.test.ts` (or the nearest existing API test file) | **Tests first (red):** `cancelRegistration` outcomes and thrown statuses | W-CR8 |
| `web/src/registrations/CancelRegistration.test.tsx` | **Tests first (red):** W-CR2-W-CR7 (button, both panel wordings, zero requests on open and Keep, one request on two clicks, pending, success message and focus, every error row, invalidated keys and an unrelated key untouched), W-CR10 (account B), W-CR11 (fake timers) | W-CR2-W-CR7, W-CR10, W-CR11 |
| `web/src/registrations/TicketPage.test.tsx` | Update the "no buttons" assertion (assumption above); add: the button for `registered` and `waitlisted` only, none for `cancelled`, checked in, or a Cancelled, Ended or started event; no extra `fetch`; the page after a mocked 200 (badge, no QR, message) | W-CR1, W-CR5 |
| `web/src/registrations/RegistrationArea.test.tsx`, `MyRegistrations.test.tsx` | Add regression tests: the event page panel and the list row from a cancelled answer (W-CR9). Existing tests unchanged | W-CR9 |
| `web/src/registrations/api.ts`, `queries.ts`, `ticket.ts` | `cancelRegistration`, `useCancelRegistration`, `canCancel` | W-CR1, W-CR4-W-CR8 |
| `web/src/registrations/CancelRegistration.tsx`, `TicketPage.tsx` | The section and its placement | W-CR1-W-CR7, W-CR10 |
| `web/src/styles.css` | Only if needed for the panel | W-CR12 |
| `docs/brand.md`, design canvas | One line for the confirm panel; the board "Ticket: cancel registration" in the existing canvas | |
| `README.md`, `ROADMAP.md` | Steps 22 and 23: the attendee can cancel from the ticket page; note that `registration-web.md` W-R11 "no button on this page" is superseded | |

Tests follow `registration-web.md` section 4 (Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test with `retry: false`, `MemoryRouter`, only `@testing-library/react`).

## 5. Done means

- Tests, typecheck and linter pass in `web/` (`bash scripts/verify.sh`).
- Every behaviour W-CR1 to W-CR13 has a test, or a note in the README that says it is not covered.
- Tests first, committed red before the code: `ticket.test.ts` (`canCancel`), the `cancelRegistration` tests, and `CancelRegistration.test.tsx` (W-CR2-W-CR7, W-CR10, W-CR11).
- Request-count proof: opening the panel and Keep send nothing; two clicks on "Yes" send one request; nothing is sent after the answer or after 60 s.
- `git diff --stat` shows no file under `api/`, no `vite.config.ts` and no `web/package.json`.
- By hand, once, with the API running: register two attendees on a capacity-1 event (the second is waiting); cancel the first from the ticket page, see the message, the "Cancelled" badge and no QR; open `/registrations/me` (the row says Cancelled), reload the second attendee's ticket (now "Registered", and the promotion email in the organizer's emails table), the event page (seats), and register the first one again from the event page (they join the end of the list). Check in a ticket as the organizer, then try to cancel it from a ticket page that was open before: the checked-in text shows.

## 6. Open questions (each with a recommended answer)

1. **Where the button lives.** **Recommended: the ticket page only** (as asked). Alternative: also on the event page panel and the list cards (more places to keep in step; the list card is one link by design, W-R18).
2. **Different wording for a waiting ticket (W-CR3).** **Recommended: yes**, same button labels, different heading and text. Alternative: one wording for both.
3. **Success message after the cancel (W-CR5).** **Recommended: a message plus the link "Go to the event"**, so the person can register again from the event page. Alternative: redirect to the event page, or no link (the "← Event" back link is still at the top).
4. **Hide or disable when not allowed (W-CR1).** **Recommended: hidden** (as W-EM16; the badge says why). Alternative: disabled with a hint.
5. **Invalidating organizer keys (W-CR6).** **Recommended: no**; they refetch on mount anyway and belong to another account. Alternative: also invalidate `["event-registrations"]`, `["event-arrivals"]`, `["registration-emails"]` as W-EM28 does for the organizer's own actions (harmless, never a request when unmounted).
6. **Stale ticket page (W-CR7).** The button can show on a page left open after the event started. **Recommended: the server's 409 is the authority and the page then corrects itself** (no browser clock). Alternative: also hide by the browser clock as W-EM16 does.
7. **Button colour.** **Recommended: no red** (`brand.md` has no destructive button): secondary to open, primary to confirm. Alternative: add a danger button to `brand.md` and the canvas first.
