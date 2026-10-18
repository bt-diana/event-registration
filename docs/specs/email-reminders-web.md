# Spec: Attendee emails table (web, M6 UI)

Feature spec for the web side of milestone M6, made from `SPEC_TEMPLATE.md` (sections 1-5; its behaviours are not requirements). Roadmap steps 33 (this spec) and 34. The API side is `email-reminders.md`: the route `GET /events/:id/registrations/:registrationId/emails` (ER48-ER60, decision D74, session `18-10-2046_email-reminders-web-spec`) and the outbox fields (ER1, D56, D58); this file does not change it. Ids are **W-EM1, W-EM2, ...** (the prefix `W-E` is taken by `events-web.md`).

**What changed (D74).** The earlier version of this file planned two static email lines on the ticket page (a demo note and a reminder line, old W-EM2, W-EM3, W-EM4, W-EM5). None of that was built. It is removed. Instead, the organizer opens a table of the emails of one attendee from a link in the registrations table. All ids below are new; the old W-EM1-W-EM8 no longer exist. **The ticket page gets no email lines any more** (W-EM14).

Style model: `checkin-web.md` (fetch on open and on return, no polling, D50/D51) and `arrivals.md`/`registration-web.md` (organizer screens, guards, states). Login, session, guards and `ApiError` are `auth-web.md`; query helpers are `web/src/events/queries.ts`. Style values are `docs/brand.md`. Nothing is live (D51): no polling, no server-sent events.

## 1. Goals and expected behaviour

**Goal.** In the organizer registrations table (`/registrations`, `registration-web.md` W-R20), each row has a link "View emails". It opens a page with one table: the emails of that one attendee for that event (ticket, promotion, reminder and the others), as the API returns them, newest first, with their status. The page shows just the table and the headings and states around it; no extra text, notes or status explanations. Read only: no button changes anything.

**What the API gives** (`email-reminders.md` ER48-ER60): 200 `{ attendee_name, emails: [ { id, kind, status, to_email, subject, created_at, sent_at, send_attempts, send_error } ] }`, newest first, all rows, no body and no ticket code; 404 `not_found` for an unknown or foreign event or registration; 401; 403.

**Behaviours.** Each line is checked with a component or unit test (`fetch` mocked; fake timers only for the "nothing runs by itself" test). "Test first" ones get the test before the code.

*The link*

| # | Behaviour | Test first? |
|---|---|---|
| W-EM1 | **A link in every row of the organizer registrations table.** The table of `OrganizerRegistrations` gets one more last column, header "Emails". Its cell holds a link with the visible text "View emails" and `aria-label="View emails of {attendee_name}"` (the row's `attendee_name`). It goes to `/registrations/{registration.id}/emails?event={eventId}` (both ids through `encodeURIComponent`; `eventId` is the chosen event of the page). Every row has it: `registered` and `waitlisted`, checked in or not. The registrations page sends no extra request for it (still the two requests of `checkin-web.md` W-C17). Test: two rows, two links, each with its own `href` and `aria-label`; the `fetch` mock is called with the same two URLs as before. | yes |

*Route, guard and request*

| # | Behaviour | Test first? |
|---|---|---|
| W-EM2 | **Route and guard.** The route is `/registrations/:registrationId/emails` (query `event={eventId}`), in `App.tsx`, with an entry `RegistrationEmailsEntry` in `entries.tsx` that follows the rules of `RegistrationsEntry` (W-R16): logged out goes to the organizer login with `next` set to the path and query; an attendee goes to `/registrations/me` (the query is dropped); an organizer sees the page. The screen is a plain child, so no request runs before the guard accepts. `/registrations/me` and `/registrations/scan` still open their own screens (a fixed path wins over `:registrationId`). Test: the three roles; the two fixed paths unchanged. | yes |
| W-EM3 | **Ids from the URL.** The registration id is the path part, the event id is the `event` query parameter. If `event` is missing, or either id is not a uuid (any case), the page shows the not-found state (W-EM11) and sends **no request**. Test: no `event`; `event=abc`; path id `me`; each shows not found with zero `fetch` calls. | yes |
| W-EM4 | **One request, read on open and on return, never by itself.** The page sends exactly one `GET /events/{eventId}/registrations/{registrationId}/emails` when it mounts with valid ids and a known organizer. Query key `["registration-emails", me.id, eventId, registrationId]`; the query sets `staleTime: 0`, `refetchOnMount: "always"`, `refetchOnReconnect: false`, and keeps `retry: false` and `refetchOnWindowFocus: false` from `QUERY_OPTIONS`. No `refetchInterval`. Test with fake timers: after mount one request; advance 60 000 ms, dispatch `visibilitychange` (hidden then visible) and `online`: still one. | yes |
| W-EM5 | **Returning loads it again.** Going from the table to this page, back, and to the link again sends the request again (also with a cached answer, however recent), and the table shows the rows of the newest answer (for example a row that was `pending` is now `sent`). While the request of a return runs, the cached rows of the same account, event and registration stay on screen (no "Loading..." flash). If that request fails (network error or 5xx), they stay and the note "Could not refresh" (14px, `text-muted`) shows above the table; a later good answer removes it. | yes |
| W-EM6 | **Cache by account.** The query is enabled only when `me` is a known organizer. Test: fill the table as organizer A, set `me` to organizer B on the same ids: A's rows and name are not rendered and B's request is sent. | yes |
| W-EM7 | **Terminal errors.** After 401 or 403 `["me"]` is invalidated (W-R13) and the guard takes over; the page shows the loading state, no error text of its own. After 404 it shows the not-found state (W-EM11). No automatic retry. | yes |

*The table*

| # | Behaviour | Test first? |
|---|---|---|
| W-EM8 | **Columns**, in this order, `<th scope="col">`: "Kind", "Status", "To", "Subject", "Created", "Sent at", "Failed tries", "Error". One row per item, keyed by `id`, in the order the API sent (newest first; the browser sorts nothing). Cells: Kind and Status as words (W-EM9); To = `to_email`; Subject = `subject`; Created = `created_at` as date and time (W-EM10); Sent at = `sent_at` as date and time, empty cell when `null`; Failed tries = `send_attempts` as a plain number (`0` is shown as `0`); Error = `send_error`, empty cell when `null`. All strings are drawn as text (never HTML). | yes |
| W-EM9 | **Words (pure functions `emailKindLabel` and `emailStatusLabel` in `emails.ts`).** Kind: `ticket` "Ticket", `promotion` "Promotion", `reminder` "Reminder", `reschedule` "Reschedule", `event_cancelled` "Event cancelled". Status: `pending` "Pending", `sent` "Sent", `error_sending` "Sending failed". Plain text in the cell, no badge and no colour (the status is words, not colour). An unknown value is shown as received (no crash). Test: a table of all five kinds, all three statuses and one unknown value. | yes |
| W-EM10 | **Dates.** `created_at` and `sent_at` use `formatDateTime` (`events/format.ts`, W-E19) inside `<time dateTime="{iso}">`, so the zone and format are the same as the registrations table. | |
| W-EM11 | **No claim of delivery (D57, `email-reminders.md` section 2).** Nothing on the page says or suggests that an email reached an inbox. "Sent" is only the word of the stored status; "Sending failed" is the word for `error_sending`; the page adds no sentence about what they mean. Test: render pending, sent and failed rows and check that none of "delivered", "arrived", "received", "inbox", "read", "opened" is in the page text. | yes |

*States, heading and links*

| # | Behaviour | Test first? |
|---|---|---|
| W-EM12 | **States** (the same set and look as the registrations page, `checkin-web.md` W-C12): *Loading:* "Loading emails..." (`role="status"`) until the first answer of a key. *First-load error* (network error or 5xx): "Could not load emails" (`role="alert"`, error box) and a secondary button "Retry" that refetches only this query; no table. *Empty* (`emails` is `[]`): the text "No emails for this attendee yet." and no table. *Not found* (W-EM3 or a 404): "Registration not found" (`role="alert"`) and the line "This link is not valid or the registration does not exist."; no table. *Data:* the table. 14px `text-muted`: "Could not refresh" (W-EM5). | yes (empty, error with Retry, not found) |
| W-EM13 | **Heading and back link.** A back link at the top: text "Back to registrations", to `/registrations?event={eventId}` (the registrations page keeps the chosen event, W-R20); in the not-found state for a missing or malformed `event` it goes to `/registrations`. The `h1` is "Emails of {attendee_name}" once the data is loaded and "Emails" in every other state. Nothing else is drawn besides the states and the table: no counts, no summary, no filters, no body, no resend or retry-send button, no explanation of statuses ("show just the table"). Test: with data, the page text has only the back link, the `h1` and the table, and there is no `<button>` (Retry exists only in the error state). | yes |
| W-EM14 | **The ticket page and every other screen are unchanged.** The ticket page (`/registrations/me?event=`), the event page, the attendee list and the scan screen get no email line, link or note. Existing tests of those screens pass without edits. Test: the ticket page for a `registered` ticket does not contain "email", "reminder" or "server log" text from this feature. | |
| W-EM15 | **Accessibility and layout.** The table sits in the same `table-card` as the registrations table (scrolls sideways under 640px, `brand.md`). The link has its `aria-label` (W-EM1); Retry is a real `<button>`, at least 48px. No live region for data, and "Could not refresh" is plain text, never `role="alert"`. Organizer indigo accent, no new colour. | |

**Out of scope.** The email body or a preview; a resend or re-queue button for `Sending failed` rows; filters by kind or status; paging; a table for a whole event or for all attendees; emails of a ticket page or for attendees; counts of sent or failed emails on the registrations page; a column or badge on the registrations table other than the link; explanations of the statuses; delivery, open or bounce status (D57: `sent` only means the provider accepted it); live updates and polling (D50, D51); translations; dark theme; any change in `api/` (the route is `email-reminders.md` ER48-ER60).

**Assumptions.** Change any of these first in this file.
- The route exists before the web step (`email-reminders.md` ER48-ER60 is built and shipped first, with `api/openapi.yaml` updated), as the arrivals route did.
- The organizer routes live under `/registrations*` with the event in the `event` query (`entries.tsx`, `EventSelect.tsx`), not under `/organizer/events/:id/...` (only `/organizer/events/new` exists there). This page follows that, so the example path `/organizer/events/:id/registrations/:registrationId/emails` is not used (question 1).
- `to_email` is the address stored in the outbox row when the email was written, so it can differ from the attendee's email in the registrations table; the page shows it as stored.
- `Failed tries` is `send_attempts` (failed tries only; a `sent` row after two failures shows `2`). The Error column is the short reason of the last failed try, cleared on success (`email-reminders.md` assumptions); it never holds an address or the body.
- Fetching on open and on return, with no polling, is D50/D51; a retrying row changes only after a return or a reload.
- The back link goes to the registrations page of the same event, not to the browser history, so it works after a reload or a pasted link.

## 2. UI decisions

| Screen | Route | API route | Query key | What it shows and does |
|---|---|---|---|---|
| Registrations page (exists, W-R20) | `/registrations?event={id}` | unchanged (`GET /events/:id/registrations`, `GET /events/:id/arrivals`) | unchanged | One more column "Emails" with the link "View emails" in each row (W-EM1). Nothing else changes. |
| Attendee emails page (new) | `/registrations/{registrationId}/emails?event={id}` | `GET /events/:id/registrations/:registrationId/emails` | `["registration-emails", me.id, eventId, registrationId]` | Back link, `h1`, one table of the emails or a state (W-EM8-W-EM13). Organizer only. |
| Ticket page, event page, attendee screens | unchanged | none | none | No change (W-EM14). |

**Texts.**

| Where | Text |
|---|---|
| Link in the row | "View emails", `aria-label` "View emails of {attendee_name}" |
| Table column added to registrations | "Emails" |
| Back link | "Back to registrations" |
| Heading | "Emails of {attendee_name}" (data), "Emails" (other states) |
| Columns | "Kind", "Status", "To", "Subject", "Created", "Sent at", "Failed tries", "Error" |
| Kinds | "Ticket", "Promotion", "Reminder", "Reschedule", "Event cancelled" |
| Statuses | "Pending", "Sent", "Sending failed" |
| Loading | "Loading emails..." |
| First-load error | "Could not load emails" + Retry |
| Failed refetch | "Could not refresh" |
| Empty | "No emails for this attendee yet." |
| Not found | "Registration not found", "This link is not valid or the registration does not exist." |

**Look.** The same page shell as the registrations page (`list-page`, organizer indigo accent, `data-role="organizer"`), the same `table-card` and `table` (header cells 14px 600 `text-muted`, rows 16px, 1px `border` lines, `brand.md` "Table"), dates in `<time>` with the `table-note` style used by the Arrival column. `to_email` and `subject` can be long: they wrap inside the cell; the table scrolls sideways on phones. Empty cells stay empty (no dash). No new colour, no badge.

**States on the page.** Loading, first-load error with Retry, empty, not found, data; a failed refetch keeps the rows and adds the small note; wrong role or logged out is the redirects of W-EM2 (no table and no request before the guard accepts).

**Design board.** A new screen, so one board "Attendee emails table" is added to the **existing** design canvas (https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76, linked from `README.md` and `docs/brand.md`; no new artifact), at desktop and phone width, organizer (indigo) accent: the registrations table with the "Emails" column and link; the emails page with sample rows (a `Ticket` "Sent", a `Reminder` "Pending" with 1 failed try and an error, a `Reminder` "Sending failed" with 3 failed tries and an error); loading; first-load error with Retry; empty; not found; the "Could not refresh" note above the table.

## 3. Architecture decisions

- **Apps:** `web/` only. No new library, no API change, no proxy change (`/events` is proxied already). One new route in `App.tsx` and one entry in `entries.tsx`.
- **New file `web/src/registrations/emails.ts`:** type `RegistrationEmails` (`{ attendee_name: string; emails: RegistrationEmail[] }`, with the nine item keys of ER50), `getRegistrationEmails(eventId, registrationId)` (`request` from `auth/api.ts`, throws `ApiError(status)` when not ok, like `getArrivals`), the key `registrationEmailsKey(meId, eventId, registrationId)`, the hook `useRegistrationEmails(eventId, registrationId)` (enabled only for a known organizer and valid ids; `authCheckedCall`; `QUERY_OPTIONS`, `staleTime: 0`, `refetchOnMount: "always"`, `refetchOnReconnect: false`), and the pure `emailKindLabel`, `emailStatusLabel`, and `isUuid` (case-insensitive, the same pattern as the API).
- **New component `RegistrationEmails.tsx`:** the page (back link, `h1`, states, table). It reads the ids with `useParams` and `useSearchParams`. It has no guard of its own (the entry does that, W-EM2). It does not use `useEvents` (it needs no event list), so it sends exactly one request.
- **`entries.tsx`:** `RegistrationEmailsEntry`, written like `RegistrationsEntry`.
- **`OrganizerRegistrations.tsx`:** the `Row` gets the event id (prop) and the new cell; the header gets the "Emails" column. `Link` is already imported.
- **No keepPreviousData / placeholderData:** a different key shows loading, never another registration's rows. The same-key cache is kept and refetched on return (W-EM5).
- **No changes** in `ticket.ts`, `TicketPage.tsx`, `TicketPanel.tsx`, `RegistrationArea.tsx` or the public screens (W-EM14).
- **Styles:** reuse `table-card`, `table`, `table-note`, `table-time`, `refresh-note`, `back-link`, `text-link`, `status`, `error-box`, `button-secondary`. Add nothing unless the wrapping of long cells needs one small rule in `styles.css`.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/registrations/emails.test.ts` | **Tests first (red):** `emailKindLabel` (five kinds and an unknown), `emailStatusLabel` (three statuses and an unknown), `isUuid` | W-EM3, W-EM9 |
| `web/src/registrations/RegistrationEmails.test.tsx` | **Tests first (red):** W-EM4 (one request, 60 s with fake timers, visibility, online), W-EM5 (second visit, new rows, failed refetch keeps rows and shows the note), W-EM6 (organizer B), W-EM7 (401, 403, 404), W-EM3 (zero requests for bad ids), W-EM2 (roles through `entries`), W-EM11 (forbidden words), W-EM12 (empty, error with Retry, not found, loading), W-EM13 (only back link, `h1` and table); then W-EM8 (columns, cells, empty cells, order as sent, request URL), W-EM10, W-EM15 | W-EM2-W-EM13, W-EM15 |
| `web/src/registrations/OrganizerRegistrations.test.tsx` | **Tests first (red):** the "Emails" column, one link per row with the right `href` and `aria-label`, no extra request (W-EM1). Existing tests pass without edits | W-EM1 |
| `web/src/registrations/TicketPage.test.tsx` | Add one test: the ticket page has no email note (W-EM14). Existing tests unchanged | W-EM14 |
| `web/src/registrations/emails.ts` | Type, fetch, key, hook, label functions, `isUuid` | W-EM3, W-EM4, W-EM9 |
| `web/src/registrations/RegistrationEmails.tsx` | The page | W-EM5-W-EM13, W-EM15 |
| `web/src/registrations/entries.tsx` | `RegistrationEmailsEntry` | W-EM2 |
| `web/src/App.tsx` | The route `/registrations/:registrationId/emails` | W-EM2 |
| `web/src/registrations/OrganizerRegistrations.tsx` | The "Emails" column and the link in `Row` | W-EM1 |
| `web/src/styles.css` | Only if needed for wrapping long cells | W-EM15 |
| `docs/brand.md` | One line: emails table style after the canvas | |
| Design canvas | Board "Attendee emails table" in the existing canvas | |
| `README.md`, `ROADMAP.md` | Steps 33/34: the emails table per attendee (replacing "two static lines on the ticket page"); the web shows data from `GET /events/:id/registrations/:registrationId/emails`; the ticket page has no email lines | |

Not touched: `api/` (no file), `web/package.json`, `vite.config.ts`, `ticket.ts`, `TicketPage.tsx`, `RegistrationArea.tsx`, `TicketPanel.tsx`, other specs. Tests follow `registration-web.md` section 4 (Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test with `retry: false`, `MemoryRouter`, only `@testing-library/react`). "Return" is tested with one `QueryClient` kept across navigation and `renderApp`, as in `checkin-web.md` section 3.

## 5. Done means

- Tests, typecheck and linter pass in `web/` (`bash scripts/verify.sh`).
- Every behaviour W-EM1 to W-EM15 has a test, or a note in the README that says it is not covered.
- Tests first, committed before the code and shown failing for the right reason: `emails.test.ts`, the W-EM1 case of `OrganizerRegistrations.test.tsx`, and the W-EM2-W-EM7, W-EM9, W-EM11, W-EM12 and W-EM13 cases of `RegistrationEmails.test.tsx`.
- Request-count proof: the registrations page makes the same two requests as before; the emails page makes one request per visit, none after 60 s, a hidden or visible tab, or going online; none for bad ids.
- `git diff --stat` shows no file under `api/`, no change in `web/package.json`, and none of `ticket.ts`, `TicketPage.tsx`.
- By hand, once, with the API running: register two attendees (one waiting), open `/registrations`, click "View emails" on a row, see the ticket email row; wait for a reminder or insert one by SQL, go back and open it again, see the new row; stop the API and see the error with Retry; log in as another organizer in the same tab and see no rows of the first one; as an attendee, open the link and land on `/registrations/me`.
- README "Project status" says: the organizer can open a table of the emails of one attendee from the registrations table; the ticket page has no email lines; `Sent` only means the provider accepted the email.

## 6. Open questions (each with a recommended answer)

1. **Path of the page.** The request example was `/organizer/events/:id/registrations/:registrationId/emails`. The router has no such pattern (organizer screens are `/registrations`, `/registrations/scan`, with `?event=`). **Recommended: `/registrations/:registrationId/emails?event={id}`** (W-EM2). Alternative: the long organizer path, which needs its own entry and breaks the "event in the query" convention.
2. **Link on every row.** **Recommended: yes**, also for waiting people (their `promotion` row appears when they get a seat). Alternative: only `registered` rows.
3. **Heading with the attendee name.** Depends on the API returning `attendee_name` (`email-reminders.md` question 5). **Recommended: keep**; if the key is dropped, the heading is "Emails" in every state and W-EM13 loses one clause.
4. **Word for `error_sending`.** **Recommended: "Sending failed"** (plain, no claim about delivery). Alternatives: "Failed", "Not sent".
5. **Show "Failed tries" and "Error".** **Recommended: show both** (the user asked for the data the route returns; this is the only place a failed reminder can be understood). Alternative: hide them for `sent` rows with 0 tries; not worth a rule.
6. **Plain text, not badges.** **Recommended: plain text** (no new colour, and the user asked for just the table). Alternative: reuse the existing `Badge` with a tone.
7. **No request for bad ids (W-EM3).** **Recommended: yes**, a cheap check that also keeps `/registrations/me/emails` (id `me`) from calling the API. Alternative: always call and rely on 404.
8. **Build order and the other outbox spec.** The route must exist first. `email-outbox.md` specifies a different, event-wide route (`GET /events/:id/emails`, `registration_id` filter); see `email-reminders.md` question 4. **Recommended: build the route of ER48-ER60 first and let this page use it only.**
9. **Roadmap and README wording.** Steps 33 and 34 and the README line about "two static lines" are now wrong. **Recommended: update them in the build step** (this spec does not edit them).
