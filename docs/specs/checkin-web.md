# Spec: Arrivals counter and arrival column (web, M5 UI)

> **Decision note (D50).** The user decided, in these words (cleaned):
> 1. "The new `POST /checkin` serves the checking process" (the scan screen, already built, W-R28-W-R37).
> 2. "No polling of the organizer list." After a successful check-in the organizer stays on the check-in (scan) page: no redirect, no list refetch there.
> 3. "The list of registered users is shown on the registrations page. When the organizer returns to that page, the list API call (`GET /events/:id/registrations`) must be performed again."
> 4. "The numbers are shown on the registrations page as well, from the separate endpoint `GET /events/:id/arrivals`" (not counted from the list), also fetched again on return.
> 5. "I added the separate endpoint `GET /events/:id/arrivals`." (`arrivals.md`, D47, D49; built.)
>
> This replaces the 5 s polling of the earlier version of this file (old W-C6 to W-C10, W-C17). The user did not ask for polling anywhere, so there is none (question 2).

Feature spec for the web side of milestone M5, made from `SPEC_TEMPLATE.md` (sections 1-5). The API side is `checkin.md` (C1-C19), `arrivals.md` (the route `GET /events/:id/arrivals`, AR1-AR15, D47, D49) and `api/openapi.yaml`; this file does not change them. **The check-in screen itself is not here.** The organizer scan screen (camera, manual code, result states, `POST /checkin`) and the organizer registrations page are specified in `registration-web.md` (W-R20, W-R21, W-R28 to W-R37) and are built; this file adds what is left of M5 UI: the arrivals counter (B7), read from the arrivals route and fetched when a screen opens or is returned to and after each check-in, and the arrival column in the organizer list. Login, session, guards and `ApiError` are `auth-web.md`; query helpers are `events/queries.ts`. Style values are `docs/brand.md`. Roadmap steps 27 (this spec) and 28. Nothing is live: no polling and no server-sent events (D51; M8 is dropped).

## 1. Goals and expected behaviour

**Goal.** The organizer sees how many of the registered people have arrived ("Arrived: 12 / 20 registered", with the capacity on a small second line) on the scan screen and on the registrations page (`/registrations`). The numbers come from `GET /events/{id}/arrivals` (`{ capacity, registered, arrived }`, `arrivals.md`); the browser counts nothing. They are fetched when a screen opens, when the organizer returns to it, and right after a successful check-in; nothing refreshes by itself in between. Nothing here sends a check-in, cancels, exports, polls or listens to a stream.

**Behaviours.** Each line is checked with a component or unit test (`fetch` mocked; fake timers only for the "nothing runs by itself" test). "Test first" ones get the test before the code. Ids are W-C1, W-C2, ... (ids are kept from the earlier version where the line still exists; W-C6 to W-C10 and W-C17 changed meaning).

*Computing and showing the number*

| # | Behaviour | Test first? |
|---|---|---|
| W-C1 | A hook `useEventArrivals(eventId)` reads `GET /events/{id}/arrivals` and gives `{ capacity, registered, arrived }` exactly as the server sent them. The client does no counting, no clamping, no `min`/`max` and does not read the registrations list for the counter. The request goes to `/events/{id}/arrivals` with the event id of the screen. (That `arrived` is never above `registered` and that waitlisted people are never counted are API tests AR4, AR5, not tested here.) | |
| W-C2 | The counter text is "Arrived: {arrived} / {registered} registered", for example "Arrived: 12 / 20 registered", with a small second line "Capacity: {capacity}" (14px, `text-muted`), for example "Capacity: 25" (question 9; "Capacity" is the word the event page already uses). `capacity` is shown as stored, also when `registered` is above it (AR6). Numbers are plain digits with no separators. When `registered` is above 0 and `arrived` equals `registered`, the line "Everyone has arrived." is added under the capacity line. | |
| W-C3 | Where it shows. Scan screen (`/registrations/scan`): under the event selector, above the camera, whenever an event is chosen, in every camera state (also with no camera or denied). Registrations page (`/registrations`): under the event selector, above the table, whenever an event is chosen, also when the list has no rows (it no longer depends on the list; question 10). It does not show on the organizer event page `/event/:id`, the public page, the ticket page or any attendee screen, and those make no request for it (question 1). | |
| W-C4 | **One query, shared by both screens.** The counter has its own query and its own request, key `["event-arrivals", me.id, eventId]` (one key per account and event). The scan screen and the registrations page read the same key. The table keeps its own query (`useEventRegistrations`, key `["event-registrations", me.id, eventId]`, W-R23) and its own request. So the scan screen sends one request when it opens (arrivals only, it never loads the list), and the registrations page sends two (arrivals and registrations). The two keys never share data. | |
| W-C5 | Counter shows numbers only. It renders no name, email or ticket code. The scan screen loads no registrations list. | |

*When data is fetched (no polling)*

| # | Behaviour | Test first? |
|---|---|---|
| W-C6 | **Nothing runs by itself.** There is no `refetchInterval` and no timer on any of the two queries, no refetch on window focus or on a visible tab (`refetchOnWindowFocus` stays `false`), no refetch on reconnect. A screen sends its requests when it mounts with an event chosen (W-C7, W-C8), when the event selector changes (a new key, the new event loads), after a successful check-in (W-C11) and on Retry (W-C12), and at no other time. With fake timers: after mount the request counts are as in W-C4; advance 60 000 ms, dispatch `visibilitychange` (hidden then visible) and `online`: the counts do not change. | yes |
| W-C7 | **Returning to the registrations page loads the list again.** Whenever `/registrations` is mounted again (back from the scan screen, from another route, or a new visit) with an event chosen, `GET /events/{id}/registrations` is sent again, also when a cached answer for the same account and event exists, however recent. The query sets `staleTime: 0` and `refetchOnMount: "always"`. The test opens the page (1 list request), navigates to `/registrations/scan` and back (2 list requests), and the table shows the rows of the second answer (for example a row that had `checked_in_at` null now has a time). Opening the page again with the list unchanged still sends the request. | yes |
| W-C8 | **Returning loads the arrivals again.** The same for the counter: every mount of a screen that shows it (`/registrations` or `/registrations/scan`) with an event chosen sends `GET /events/{id}/arrivals` again, even if the key is cached; the query sets `staleTime: 0` and `refetchOnMount: "always"`. The test goes scan screen, registrations page, scan screen and counts one arrivals request per visit (3), and the text shows the newest answer. | yes |
| W-C9 | **Terminal errors.** After an answer 401 or 403 from either query `["me"]` is invalidated (W-R13, W-E13); the guard then redirects or shows the wrong-account page, and the counter shows no text of its own. After 404 the counter shows "Event not found" (as W-R21, once: the page shows one text, not two). No automatic retry (`retry: false`); Retry on first-load error is W-C12. | yes |
| W-C10 | **Cached data on return.** While the request of a return is running (W-C7, W-C8), the cached rows and numbers of the same account and event may stay on screen and are replaced when the answer arrives (no "Loading..." flash, no re-mount). If that request fails (network error or 5xx), they stay and the small note "Could not refresh" (14px, `text-muted`) shows under the numbers or above the table; a later good answer removes it. A different event or a different account never shows the cached data of another (W-C13, W-C15). | |

*Check-in and the counter*

| # | Behaviour | Test first? |
|---|---|---|
| W-C11 | **A check-in is counted once, from the server only, and the organizer stays.** After a `POST /checkin` answer 200 (`outcome: "checked_in"`) the scan screen invalidates the prefix `["event-arrivals"]` (the active query for the chosen event refetches at once, a request still running is cancelled and started again, so its older answer cannot overwrite the new one). It does **not** invalidate or refetch `["event-registrations"]`, does not navigate (the route stays `/registrations/scan`, no redirect) and starts no timer. No answer other than 200 (the 409 codes, 404, 400, errors) refetches anything. There is no local `+1`: the counter changes only when the arrivals route answers. Test with `fetch` mocked: the route shows `11 / 20`, one 200 check-in, the route now answers `12 / 20`: the text goes `11` to `12` once, with exactly one more arrivals request and zero registrations requests, and the path is still `/registrations/scan`; before the route answers the text is still `11`. Five repeated reads of the same code (W-R33) give one check-in request and `12` (not `16`); a repeated manual check-in that answers 409 `already_checked_in` leaves `12` and sends no arrivals request. | yes |

*States*

| # | Behaviour | Test first? |
|---|---|---|
| W-C12 | First load: "Loading arrivals..." until the first answer. Network error or 5xx on the first load: "Could not load arrivals" and a Retry button that refetches only this query. No numbers are shown in these two states, never a stale number from another event or account. | |
| W-C13 | **Keeps its value, no flicker.** A refetch after a check-in or on return (also a slow or failed one) never shows "Loading arrivals...", never empties the number and never re-mounts the block; the previous text stays until a new answer changes it. Equal data leaves the same text (the DOM node text is not rewritten). A refetch that fails keeps the last numbers and adds "Could not refresh" (W-C10); the next good answer removes it. Changing the event (selector) shows "Loading arrivals..." for the new event and never the old event's number (no placeholder data). | yes (failed refetch keeps value, note shows and clears) |
| W-C14 | Counts of 0 and full. Event with nobody registered: "Arrived: 0 / 0 registered" and "Capacity: 25" (the real capacity), no "Everyone has arrived." Only waiting-list people: also `0 / 0` (the route does not count them, AR3). `arrived` equals `registered` above 0: "Arrived: 20 / 20 registered", "Capacity: 25" and "Everyone has arrived." A cancelled or passed event of the organizer is counted the same (C17). | |
| W-C15 | **Cache by account.** Both queries are enabled only when `me` is a known organizer (W-R23). The test fills the counter as organizer A (for example `5 / 8`, capacity 10) and the list with A's rows, sets `me` to organizer B on the same event id, and checks that `5 / 8`, A's capacity and A's rows are not rendered and B's requests are sent (both queries are read again). | yes |

*Organizer list*

| # | Behaviour | Test first? |
|---|---|---|
| W-C16 | **"Arrival" column, filled from the list rows only** (`checked_in_at` of `OrganizerRegistration`, no extra request). The table of W-R20 gets one more column, "Arrival", after "Place". Cell by row: `registered` with `checked_in_at`: "Arrived" and the time (`formatDateTime`, W-E19, in a `<time dateTime>`); `registered` without it: "Not yet"; `waitlisted`: empty cell. The other columns, the row order (API order) and the states of W-R21 do not change. The column is as fresh as the list: it changes when the page is opened or returned to (W-C7), not by itself. The counter and the column come from two requests (two snapshots) and can differ by a check-in made between them (question 5). | |
| W-C17 | **The registrations page makes exactly two requests when it opens** (arrivals and registrations, W-C4), none after that until the organizer returns, changes the event or presses Retry. Rows are keyed by `id`. A return keeps the selected event (the `event` query parameter, W-R20) and does not reset the page. | |

*Cross-cutting*

| # | Behaviour | Test first? |
|---|---|---|
| W-C18 | Accessibility. The counter block is a `<div>` (not a heading) with the visible text and **no live region**: nothing changes while the organizer looks except right after a check-in, whose result the scan screen already announces (W-R34), and a second announcement would repeat it. "Could not refresh" is plain text, never `role="alert"`. The numbers are text, never colour alone; "Everyone has arrived." is text. The Retry button is a real `<button>`, at least 48px. | |
| W-C19 | Texts and styles come from section 2 and `brand.md`; no new colour. The counter is the same component on both screens (`ArrivalsCounter`, prop `eventId` only). | |

**Out of scope.** Polling of any kind (the list, the counter, the "Arrival" column), refetch on window focus, server-sent events and any live state (D51: nothing is live; M8 is dropped); counting arrivals in the browser from the list; a list of who has arrived or who is missing; export or download of the list; undo of a check-in; a counter for the waiting list; a progress bar or chart; sound or vibration on a check-in; showing the counter to attendees or on the public page; the organizer event page (question 1); paging; showing names or emails in the counter; backoff or retry; translations; dark theme.

**Assumptions.** Change any of these first in this file.
- "registered" in the counter text means registrations with status `registered` (taken seats, `arrivals.md` AR3), not the capacity of the event. It can be lower than the capacity.
- The arrivals route is the only truth for the counter (AR12, AR13: one snapshot, `no-store`). The browser adds no cache time and no merge with its own check-in answers.
- The user chose "fetch on open, on return and after a check-in" over polling (decision note). So a second organizer window, or a colleague's phone, shows a check-in only after a return, a reload, or its own check-in; this is accepted (D51: nothing is live).
- The query defaults of `events/queries.ts` (`retry: false`, `refetchOnWindowFocus: false`) stay. These two queries override only `staleTime: 0` and `refetchOnMount: "always"` (explicit, so a later change of the shared default cannot hide the refetch on return).
- The scan screen never loads the list, so a check-in needs no list refetch there; the list is loaded again when the organizer returns to `/registrations` (W-C7).
- `registration-web.md` said the list screen has no polling; that stays true. This file only adds the refetch on return, the counter and the column.
- Nothing is live (D51): no stream is added later; the text, the keys and the hook are final.
- Besides `staleTime` and `refetchOnMount`, both queries also set `refetchOnReconnect: false` (added in step 28): with `staleTime: 0` the library default would read them again when the network comes back, which W-C6 forbids.

## 2. UI decisions

| Screen | Route | API route | Query key | What it shows and does |
|---|---|---|---|---|
| Scan screen (exists, W-R28) | `/registrations/scan?event={id}` | `GET /events/:id/arrivals` (new for this screen), `POST /checkin` | `["event-arrivals", me.id, id]`; mutation | Counter under the selector (W-C3), loaded on open and return (W-C8), refetched after a 200 check-in (W-C11). The organizer stays on the screen. Everything else as in W-R28-W-R37. |
| Registrations page (exists, W-R20) | `/registrations?event={id}` | `GET /events/:id/registrations`, `GET /events/:id/arrivals` | `["event-registrations", me.id, id]` (table), `["event-arrivals", me.id, id]` (counter, the same key as the scan screen) | Counter above the table, "Arrival" column; both requests sent again on every return (W-C7, W-C8, W-C16). |

**Texts.**

| Where | Text |
|---|---|
| Counter | "Arrived: {arrived} / {registered} registered" |
| Capacity (second line) | "Capacity: {capacity}" |
| All arrived | "Everyone has arrived." |
| Loading | "Loading arrivals..." |
| First-load error | "Could not load arrivals" + Retry |
| Failed refetch | "Could not refresh" (small, under the numbers; on the list also above the table when the list refetch fails) |
| Event 404 | "Event not found" |
| Table column | "Arrival"; cells "Arrived" + time, "Not yet", empty for the waiting list |

**Counter look.** A block of 16px text in a card: surface, 1px `border`, radius 12, padding `12px 16px`, full width of the screen card. "Arrived:" in `text-muted`, the two numbers and the word "registered" in the text colour at 600. "Capacity: {capacity}" 14px `text-muted` on a second line. "Everyone has arrived." 15px under it. "Could not refresh" 14px `text-muted`. Organizer indigo accent as the other organizer screens; no new colour.

**States on every screen.**
- Loading: "Loading arrivals..." (first load of a key only; a return keeps the cached numbers, W-C10).
- Error: first load with Retry; later failures only the small note.
- Empty: `0 / 0` and the capacity on both screens (the list shows its W-R21 text under the counter).
- Full ("all arrived"): the extra line.
- Not found: "Event not found".
- Wrong role or logged out: the redirects of W-R16 and W-R28; no counter and no request before the guard accepts.
- Already checked in: not a counter state; the 409 result is the scan screen's (W-R34) and leaves the number unchanged.

## 3. Architecture decisions

- **Apps:** `web/` only. No new library, no API change, no proxy change (`/events` and `/checkin` are proxied). No new route.
- **Hook** in `web/src/registrations/arrivals.ts`: `useEventArrivals(eventId)` (W-C1) with its fetch of `GET /events/{id}/arrivals`. Key `["event-arrivals", me.id, eventId]`, enabled only for a known organizer (as `useEventRegistrations`, W-R23), spreads `QUERY_OPTIONS`, then sets `staleTime: 0` and `refetchOnMount: "always"`. No `refetchInterval`, no `refetchIntervalInBackground`, no `refetchOnWindowFocus: true`. `retry: false` stays. The cache is not changed by hand (`setQueryData` is not used for the counter). There is no `arrivals(registrations)` function and no poll constant or helper.
- **List hook:** `useEventRegistrations` in `queries.ts` (existing, key per account, enabled for a known organizer) gets `staleTime: 0` and `refetchOnMount: "always"` (W-C7) and nothing else. Only the registrations page mounts it; the scan screen does not.
- **No keepPreviousData / placeholderData:** a selector change is a new key and shows loading, not the old event (W-C13). The same-key cache on return is kept on purpose and refetched (W-C10).
- **Check-in refresh:** `useCheckIn` in `queries.ts` gets `onSuccess`: `queryClient.invalidateQueries({ queryKey: ["event-arrivals"] })` (prefix, not exact, so the screen does not need the `event_id` of the answer; a ticket of another of the organizer's own events refreshes the active query too, and the others are only marked stale). It does not touch `["event-registrations"]` and does not navigate. Only the 200 path counts: `checkIn` returns the other outcomes as values, so `useCheckIn` must call `invalidate` only when `outcome === "checked_in"`. A thrown `ApiError` goes to the screen as today (401/403 re-check `me`, W-R13). `invalidateQueries` cancels a running fetch and refetches, which gives W-C11's "old answer cannot win".
- **Component:** `ArrivalsCounter.tsx`, props `{ eventId: string }`. It reads `useEventArrivals(eventId)`, shows loading/error/data from the query, treats `isRefetchError` with data as the "Could not refresh" note, and renders the three numbers as sent. It never renders rows. It does not have its own `me` or guard: the screens already render it only after the guard (W-R16, W-R28).
- **Screens:** `ScanScreen` renders `<ArrivalsCounter eventId={chosen.id} />` under the selector. `OrganizerRegistrations` renders `<ArrivalsCounter eventId={chosen.id} />` under the selector, above the table and the empty text, and adds the "Arrival" column (from `checked_in_at`).
- **Time:** `formatDateTime` (W-E19) with the optional zone argument for tests.
- **Tests:** "return" is tested with one `QueryClient` kept across navigation (`MemoryRouter` with the app routes, `renderApp`), going `/registrations` to `/registrations/scan` and back; `mockFetch` call counts prove the request numbers. The "nothing runs by itself" test uses `vi.useFakeTimers()` after the `QueryClient` is made and `await vi.advanceTimersByTimeAsync(60000)`.
- **No SSE (D51):** M8 is dropped; nothing streams into these keys. The refetch on open, on return and after a check-in is the whole design.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/registrations/arrivals.ts` | Hook `useEventArrivals` with its fetch of the arrivals route, `staleTime: 0`, `refetchOnMount: "always"` | W-C1, W-C4, W-C8 |
| `web/src/registrations/queries.ts` | `staleTime: 0` and `refetchOnMount: "always"` on `useEventRegistrations`; `onSuccess` of `useCheckIn` invalidates `["event-arrivals"]` only for `checked_in` | W-C7, W-C11 |
| `web/src/registrations/ArrivalsCounter.tsx` | The block with text, capacity line, states, note, Retry | W-C1, W-C2, W-C3, W-C10, W-C12-W-C14, W-C18 |
| `web/src/registrations/ArrivalsCounter.test.tsx` | **Tests first:** W-C6 (no timers, no focus refetch), W-C8 (one request per visit), W-C9 (401, 403, 404), W-C11 (one count, no local +1, five reads, 409 leaves it, only the arrivals prefix invalidated, no navigation), W-C13 (failed refetch keeps value, note shows and clears), W-C15 (account B); then W-C1 (numbers as sent, request URL), W-C2, W-C4, W-C10, W-C12, W-C14 | W-C1-W-C15, W-C18 |
| `web/src/registrations/ScanScreen.tsx` | Render the counter under the selector; no list request; nothing else changes | W-C3, W-C4, W-C11 |
| `web/src/registrations/ScanScreen.test.tsx` | Add: counter visible in every camera state; only the arrivals route is requested (no registrations list); 200 check-in refetches the arrivals route once and the registrations route never, and the path stays; 409/404/400 do not refetch; no live region | W-C3, W-C4, W-C11, W-C18 |
| `web/src/registrations/OrganizerRegistrations.tsx` | Counter under the selector (also with no rows), "Arrival" column | W-C3, W-C4, W-C16, W-C17 |
| `web/src/registrations/OrganizerRegistrations.test.tsx` | **Tests first:** W-C7 (list sent again on return, new rows shown), W-C15 (account B, both queries). Then: Arrival cells (arrived with time, not yet, waiting list empty); counter shown for an empty list; opening sends one arrivals and one registrations request and no more | W-C3, W-C4, W-C7, W-C15, W-C16, W-C17 |
| `web/src/styles.css` | Counter card, capacity line, note, "Everyone has arrived." line | W-C19 |
| `docs/specs/registration-web.md` | Lines that contradicted this file are fixed (W-R20 and W-R21 refetch on return, W-R23, check-in invalidation, out-of-scope polling line, the table of routes, S4) | W-C7, W-C11, W-C16 |
| `docs/brand.md` | Counter style after the canvas | |
| Design canvas | New board "Arrivals counter" (scan screen and registrations page, states of section 6) in the existing canvas | |
| `README.md`, `ROADMAP.md` | Counter and column work; no polling, data is fetched on open, return and check-in; nothing is live (D51) | |

Tests follow `auth-web.md` section 4 and `registration-web.md` section 4 (Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test with `retry: false`, `MemoryRouter`, only `@testing-library/react`). Mock call counts prove the request numbers. The file `arrivals.test.ts` of the earlier version is dropped (no pure interval helper any more).

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- Every behaviour W-C1 to W-C19 has a test, or a note in the README that says it is not covered.
- The API route `GET /events/:id/arrivals` (`arrivals.md`) exists before the web step (it does).
- Tests first, committed before the code: `ArrivalsCounter.test.tsx` for W-C6, W-C8, W-C9, W-C11, W-C13 and W-C15, and `OrganizerRegistrations.test.tsx` for W-C7 and W-C15.
- Request-count proof: no request after open, a 60 s wait, a hidden or visible tab, or going online (zero); one arrivals and one registrations request per visit to the registrations page; one arrivals request per visit to the scan screen and none for the list.
- Manual check against the real API: on the scan screen check in a ticket and see the counter go up by one without leaving the page and without a list request; open `/registrations` and see the new "Arrived" cell and the same counter; check in another ticket from a second window, go back to the first window's `/registrations` through the scan screen, and see both the row and the counter change; stop the API and see "Could not refresh" with the last numbers, then start it and return to see it go; log in as another organizer in the same tab and see that no number or row of the first one is shown.
- The README "Project status" says: the arrivals counter and the Arrival column work; data is fetched when a screen opens, when the organizer returns and after a check-in (no polling); nothing is live (no server-sent events, D51).

## 6. Screens for a visual mock-up

Each at desktop and phone width, organizer (indigo) accent. Sample data: event "Spring Meetup", capacity 25, 20 registered.

| Board | States |
|---|---|
| Scan screen with counter | "Arrived: 12 / 20 registered" and "Capacity: 25" under the selector, camera area below; with the camera denied; all arrived (20 / 20, capacity 25, + "Everyone has arrived."); empty event (0 / 0); loading "Loading arrivals..."; first-load error with Retry; failed refetch ("Could not refresh" under the numbers); right after a check-in (result card and the new number, same page) |
| Registrations page with counter | counter under the selector and above the table, column "Arrival": "Arrived" + `Sat, 1 Jan 2030, 10:05 CET`, "Not yet", empty for the waiting list; failed refetch note; no rows (counter `0 / 0` with capacity, then "No one has registered for this event yet.") |

## 7. Open questions (each with a recommended answer)

Answered by the user's message (decision note above): 4 (the list does not poll; it loads again on return) and the old interval question 2 and focus-refetch question 3 in the part about polling (see 2 and 3 below). For step 28 the user said "go" with the recommended answers: 2 no polling at all (D51), 3 no refetch on window focus, 5 keep the Arrival column, 9 "Capacity: 25", 10 an empty event shows `0 / 0`, 11 cached rows stay while the refetch runs. Questions 1, 6, 7 and 8 were built as recommended.

1. **Organizer event page `/event/:id`.** Options: show the counter there too, or not. **Recommended: not.** That page is read only and already shows `registered` and seats left (E10); a third place would need its own request and its own tests. The scan screen is where the door is, and the registrations page is the overview. Open.
2. **Polling for the counter. Answered in substance (no polling asked for), please confirm: NO polling at all.** The data is fetched on open, on return and after each check-in (W-C6, W-C11). **Recommended: none;** the cost is that a second device's check-ins show only after a return or reload. **Answered (D51): no polling and no server-sent events; nothing is live** (M8 is dropped).
3. **Refetch when the tab becomes visible.** Not asked for. **Recommended: no** (`refetchOnWindowFocus` stays `false`, W-C6). It is a one-line change later.
4. **Registrations list refetch on return. Answered by the user** (decision note 3): `GET /events/:id/registrations` is sent again every time the page is mounted (W-C7).
5. **"Arrival" column in `registration-web.md` W-R20.** Kept only because it is filled from the list rows (`checked_in_at`, W-C16); it changes with the list, so it can differ for a moment from the counter (two requests). **Recommended: keep the column** (one cell per row, no new request); the ticket page keeps its single word "Checked in" (W-R25), no time. Open.
6. **Live region.** With no polling the counter has no live region (W-C18), because the scan result is already announced (W-R34). **Recommended: as written.** Alternative: a polite region on the registrations page, which would read the new number after a return.
7. **Counter on a passed or cancelled event.** Fetched like any other (cheap, rare). **Recommended: as written.** Moot for polling.
8. **Ownership.** The scan screen stays in `registration-web.md` (its question 11, recommended answer). This file adds only the counter and the column. The user's note 1 says `POST /checkin` serves the check-in screen, which fits. Confirm.
9. **Counter text with the capacity (W-C2, W-C14). Recommendation, the user should confirm** (`arrivals.md` question 2). Written here: keep "Arrived: {arrived} / {registered} registered" and add "Capacity: {capacity}" as a small second line (14px, `text-muted`; "Capacity" is the word of the event page, the user's example "Seats: 25" is an alternative). Alternatives: "Arrived: x / capacity" as the only denominator (reads "12 / 25" with 20 registered and "Everyone has arrived." could never show), or one line "Arrived: 12 / 20 registered (capacity 25)". If the user chooses differently, only W-C2, W-C14, the texts table, the counter look and section 6 change.
10. **Counter on the registrations page with no rows (W-C3).** The counter no longer depends on the list, so it can show `0 / 0` with the capacity above "No one has registered for this event yet.". **Recommended: show it** (same as the scan screen, one rule). Alternative: hide it when the list is empty, as the earlier version did.
11. **Cached rows during a return refetch (W-C10).** The old rows and numbers stay visible until the new answer replaces them (no flash). **Recommended: as written.** Alternative: drop the cache when the page unmounts (`gcTime: 0`), so a return shows "Loading..." and never an old row; simpler to reason about, a visible flash on every return. Open.

## Roadmap note (suggested wording; ROADMAP.md is not edited here)

- 27. UI spec: `checkin-web.md` (done: W-C1-W-C19, decision D50): the arrivals counter ("Arrived: 12 / 20 registered" plus "Capacity: 25", read from `GET /events/:id/arrivals` (`arrivals.md`)) on the scan screen and the registrations page, fetched on open, on return and after a check-in (no polling), the registrations list loaded again on every return to `/registrations`, and the "Arrival" column of the organizer list (from `checked_in_at`). The check-in screen itself (camera, manual code, results, `POST /checkin`) is specified under M3 in `registration-web.md` (W-R28-W-R37).
- 28. Test, then code: the arrivals counter and the "Arrival" column (`arrivals.ts` with the `useEventArrivals` hook, `ArrivalsCounter.tsx`, `refetchOnMount: "always"` on both queries, return and "nothing runs by itself" tested first; one check-in counted once, the organizer stays on the scan page). The check-in screen is already built (W-R28-W-R37, M3); this step only adds the counter and wires the arrivals refetch after a 200 into it. Not a new check-in screen, no polling.
