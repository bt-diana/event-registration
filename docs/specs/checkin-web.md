# Spec: Arrivals counter and check-in column (web, M5 UI)

Feature spec for the web side of milestone M5, made from `SPEC_TEMPLATE.md` (sections 1-5). The API side is `checkin.md` (C1-C19) and `api/openapi.yaml` (0.5.0); this file does not change them. **The check-in screen itself is not here.** The organizer scan screen (camera, manual code, result states, `POST /checkin`) and the organizer registrations list are specified in `registration-web.md` (W-R20, W-R21, W-R28 to W-R37) and are built; this file only points to them and adds what is left of M5 UI: the arrivals counter (B7) refreshed by polling, and the arrival column in the organizer list. Login, session, guards and `ApiError` are `auth-web.md`; query helpers are `events/queries.ts`. Style values are `docs/brand.md`. Roadmap steps 27 (this spec) and 28. Live updates by server-sent events are M8 (step 42 extends this file); here the counter polls.

## 1. Goals and expected behaviour

**Goal.** The organizer sees how many of the registered people have arrived ("Arrived: 12 / 20 registered") on the scan screen and on the registrations list, and the number follows the door without a reload. The number is computed in the browser from `GET /events/{id}/registrations` (`checkin.md` C16, D45); there is no arrivals route. Nothing here sends a check-in, cancels, exports, or listens to a stream.

**Behaviours.** Each line is checked with a component or unit test (`fetch` mocked; polling with Vitest fake timers). "Test first" ones get the test before the code. Ids are W-C1, W-C2, ...

*Computing and showing the number*

| # | Behaviour | Test first? |
|---|---|---|
| W-C1 | One pure function `arrivals(registrations)` returns `{ arrived, registered }`. `registered` is the number of items with `status` `registered`; `arrived` is how many of those have `checked_in_at` not null. A `waitlisted` item is never counted in either number, even if a (wrong) `checked_in_at` is set. `[]` gives `0 / 0`. `arrived` is never above `registered`. The client does not use `capacity` or `seats_left`. | |
| W-C2 | The counter text is "Arrived: {arrived} / {registered} registered", for example "Arrived: 12 / 20 registered". Numbers are plain digits with no separators. When `registered` is above 0 and `arrived` equals `registered`, the line "Everyone has arrived." is added under it. | |
| W-C3 | Where it shows. Scan screen (`/registrations/scan`): under the event selector, above the camera, whenever an event is chosen, in every camera state (also with no camera or denied). Organizer list (`/registrations`): above the table, when the chosen event has at least one row (with no rows the empty text of W-R21 is the only text, no `0 / 0`). It does not show on the organizer event page `/event/:id`, the public page, the ticket page or any attendee screen, and those make no request for it (question 1). | |
| W-C4 | One source, one request per tick. The counter and the table of the list screen read the same query (`useEventRegistrations`, key `["event-registrations", me.id, eventId]`, W-R23). The scan screen uses the same hook. Whatever screen is open, one `GET /events/{id}/registrations` per poll; the counter adds no second request. | |
| W-C5 | Counter shows numbers only. It renders no name, email or ticket code, and the scan screen does not render the rows it loads (the list is read only for the count). | |

*Polling*

| # | Behaviour | Test first? |
|---|---|---|
| W-C6 | Interval: first request when the screen mounts and an event is chosen, then one every 5000 ms (`ARRIVALS_POLL_MS`, TanStack `refetchInterval`). With fake timers: after mount 1 request; after 5000 ms 2; after 10000 ms 3. No other trigger refetches it: `refetchOnWindowFocus` is `false` except for W-C8. | |
| W-C7 | **Polling stops** when the counter is no longer on the screen: on unmount (route change, logout), and when the event selector changes (the old event's interval ends, the new event starts its own, W-C13). The test unmounts, advances 60 000 ms and counts zero new requests; a selector change makes no further request for the old event id. | yes |
| W-C8 | **Hidden tab pauses.** While `document.visibilityState` is `hidden` no poll request is sent (TanStack default `refetchIntervalInBackground: false`; not overridden). When the tab becomes visible again the list is refetched at once, then the 5000 ms rhythm goes on (this query sets `refetchOnWindowFocus: true`, question 3). The test sets `visibilityState` to `hidden`, advances 30 000 ms and counts no requests, sets `visible`, dispatches `visibilitychange` and counts one. | yes |
| W-C9 | **Polling stops on terminal errors.** After an answer 401 or 403 the poll stops and `["me"]` is invalidated (W-R13, W-E13); the guard then redirects or shows the wrong-account page, and the counter shows no text of its own. After 404 polling stops and the counter shows "Event not found" (as W-R21). Before the first successful answer (no data yet) there is no polling at all: the first-load error waits for Retry (W-C12). | yes |
| W-C10 | No overlap. If a request is still pending when the next tick comes, no second request is sent (the test makes one answer slower than 5000 ms and counts one request in flight). | |

*Check-in and the counter*

| # | Behaviour | Test first? |
|---|---|---|
| W-C11 | **A check-in is counted once, from the server only.** After a `POST /checkin` answer 200 (`outcome: "checked_in"`) the scan screen invalidates the prefix `["event-registrations"]` (the active query for the chosen event refetches at once, and a poll already in flight is cancelled and started again, so its older answer cannot overwrite the new one). No answer other than 200 (the 409 codes, 404, 400, errors) refetches anything. There is no local `+1`: the counter changes only when the list answers. Test with `fetch` mocked: list shows `11 / 20`, one 200 check-in, the list now answers `12 / 20`: the text goes `11` to `12` once; the next polls with the same list keep `12`; before the list answers the text is still `11`. Five repeated reads of the same code (W-R33) give one check-in request and `12` (not `16`); a repeated manual check-in that answers 409 `already_checked_in` leaves `12`. | yes |

*States*

| # | Behaviour | Test first? |
|---|---|---|
| W-C12 | First load: "Loading arrivals..." until the first answer. Network error or 5xx on the first load: "Could not load arrivals" and a Retry button that refetches only this query; after Retry succeeds polling starts. No numbers are shown in these two states, never a stale number from another event or account. | |
| W-C13 | **Keeps its value, no flicker.** A background poll (also a slow or failed one) never shows "Loading arrivals...", never empties the number and never re-mounts the block; the previous text stays until a new answer changes it. Equal data leaves the same text (the DOM node text is not rewritten). A poll that fails (network error or 5xx) keeps the last numbers, adds the small note "Could not refresh" under them (14px, `text-muted`), and polling goes on at 5000 ms; the next good answer removes the note. Changing the event (selector) shows "Loading arrivals..." for the new event and never the old event's number (no placeholder data). | yes (failed poll keeps value, note shows and clears) |
| W-C14 | Counts of 0 and full. Event with nobody registered (scan screen): "Arrived: 0 / 0 registered", no "Everyone has arrived." Only waiting-list rows: also `0 / 0`. `arrived` equals `registered` above 0: "Arrived: 20 / 20 registered" plus "Everyone has arrived." A cancelled or passed event of the organizer is counted the same (C17); polling is not stopped for it. | |
| W-C15 | **Cache by account.** The counter data comes from `["event-registrations", me.id, eventId]`, enabled only when `me` is a known organizer (W-R23). The test fills the counter as organizer A (for example `5 / 8`), sets `me` to organizer B on the same event id, and checks that `5 / 8` is not rendered, B's request is sent, and A's rows are not shown. | yes |

*Organizer list*

| # | Behaviour | Test first? |
|---|---|---|
| W-C16 | The table of W-R20 gets one more column, "Arrival", after "Place". Cell by row: `registered` with `checked_in_at`: "Arrived" and the time (`formatDateTime`, W-E19, in a `<time dateTime>`); `registered` without it: "Not yet"; `waitlisted`: empty cell. The other columns, the row order (API order) and the states of W-R21 do not change. | |
| W-C17 | The list screen polls as in W-C6 to W-C10, so the "Arrival" cells and the counter follow check-ins. Rows are keyed by `id`; the selected event stays selected and the page does not jump or reset on a poll. A row whose `checked_in_at` appears changes only its Arrival cell. | |

*Cross-cutting*

| # | Behaviour | Test first? |
|---|---|---|
| W-C18 | Accessibility. The counter block is a `<div>` (not a heading) with the visible text. On the **list screen** it is a polite live region (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`) that exists from the first render, so only a change of the text is announced: a poll that returns equal data announces nothing, and neither does "Could not refresh" (it is plain text outside the live region and never `role="alert"`). On the **scan screen** the block is not a live region, because the check-in result there is already announced (W-R34) and a second announcement would repeat it. The numbers are text, never colour alone; "Everyone has arrived." is text. The Retry button is a real `<button>`, at least 48px. | |
| W-C19 | Texts and styles come from section 2 and `brand.md`; no new colour. The counter is the same component on both screens (`ArrivalsCounter`, prop `announce`). | |

**Out of scope.** Server-sent events and the connecting/live/lost states (M8, step 42, extends this file); a separate arrivals route (D45); a list of who has arrived or who is missing; export or download of the list; undo of a check-in; a counter for the waiting list; a progress bar or chart; sound or vibration on a check-in; showing the counter to attendees or on the public page; the organizer event page (question 1); paging; showing names or emails in the counter; a different interval per screen; backoff after failed polls; stopping the poll for passed or cancelled events; translations; dark theme.

**Assumptions.** Change any of these first in this file.
- "registered" in the counter text means registrations with status `registered` (taken seats), not the capacity of the event. It can be lower than the capacity.
- The server list is the only truth (`checkin.md` C16, C18: one snapshot, `no-store`). The browser adds no cache time and no merge with its own check-in answers.
- 5 seconds is "every few seconds" of `checkin.md` section 2. A list of up to the capacity of an event is small (C18), so a full list per poll is accepted; paging is a later change.
- The existing query defaults of `events/queries.ts` (`retry: false`, `refetchOnWindowFocus: false`, `staleTime` 0) stay; this spec overrides only `refetchInterval` and, for this one query, the focus refetch.
- The list screen did not poll in `registration-web.md` (its out-of-scope line: "live updates or polling"). This file overrides that for the organizer list only, because the counter and the table share one query and the table must not disagree with the counter. The attendee screens still do not poll.
- M8 keeps this polling as the fallback and adds a stream next to it; the text, the keys and the pure function stay.

## 2. UI decisions

| Screen | Route | API route | Query key | What it shows and does |
|---|---|---|---|---|
| Scan screen (exists, W-R28) | `/registrations/scan?event={id}` | `GET /events/:id/registrations` (new for this screen), `POST /checkin` | `["event-registrations", me.id, id]`; mutation | Counter under the selector (W-C3), refetch after a 200 check-in (W-C11). Everything else as in W-R28-W-R37. |
| Organizer list (exists, W-R20) | `/registrations?event={id}` | `GET /events/:id/registrations` | the same key | Counter above the table, "Arrival" column, polling (W-C16, W-C17). |

**Texts.**

| Where | Text |
|---|---|
| Counter | "Arrived: {arrived} / {registered} registered" |
| All arrived | "Everyone has arrived." |
| Loading | "Loading arrivals..." |
| First-load error | "Could not load arrivals" + Retry |
| Failed poll | "Could not refresh" (small, under the numbers) |
| Event 404 | "Event not found" |
| Table column | "Arrival"; cells "Arrived" + time, "Not yet", empty for the waiting list |

**Counter look.** A block of 16px text in a card: surface, 1px `border`, radius 12, padding `12px 16px`, full width of the screen card. "Arrived:" in `text-muted`, the two numbers and the word "registered" in the text colour at 600. "Everyone has arrived." 15px under it. "Could not refresh" 14px `text-muted`. Organizer indigo accent as the other organizer screens; no new colour.

**States on every screen.**
- Loading: "Loading arrivals..." (first load only).
- Error: first load with Retry; later failures only the small note.
- Empty: `0 / 0` on the scan screen; on the list the W-R21 text instead (W-C3).
- Full ("all arrived"): the extra line.
- Not found: "Event not found".
- Wrong role or logged out: the redirects of W-R16 and W-R28; no counter and no request before the guard accepts.
- Already checked in: not a counter state; the 409 result is the scan screen's (W-R34) and leaves the number unchanged.

## 3. Architecture decisions

- **Apps:** `web/` only. No new library, no API change, no proxy change (`/events` and `/checkin` are proxied). No new route.
- **Pure helpers** in `web/src/registrations/arrivals.ts`: `arrivals(registrations)` (W-C1), the constant `ARRIVALS_POLL_MS = 5000`, and `arrivalsRefetchInterval(query)` which returns `false` when the query has no data yet, or when its error is an `ApiError` with status 401, 403 or 404, else `ARRIVALS_POLL_MS`. Unit tests need no React.
- **Hook:** `useEventRegistrations` in `queries.ts` (existing, key per account, enabled for a known organizer) gets `refetchInterval: arrivalsRefetchInterval`, `refetchIntervalInBackground: false` and `refetchOnWindowFocus: true` after the `QUERY_OPTIONS` spread. `retry: false` stays. The cache is not changed by hand (`setQueryData` is not used for the counter). `ArrivalsCounter` and the table call the hook with the same arguments, so TanStack shares one query and one timer.
- **No keepPreviousData / placeholderData:** a selector change is a new key and shows loading, not the old event (W-C13).
- **Check-in refresh:** `useCheckIn` in `queries.ts` gets `onSuccess`: `queryClient.invalidateQueries({ queryKey: ["event-registrations"] })` (prefix, not exact, so the screen does not need the `event_id` of the answer; a ticket of another of the organizer's own events refreshes the active query too, and the others are only marked stale). Only the 200 path reaches `onSuccess`: `checkIn` returns the other outcomes as values, so `useCheckIn` must call `invalidate` only when `outcome === "checked_in"`. A thrown `ApiError` goes to the screen as today (401/403 re-check `me`, W-R13). `invalidateQueries` cancels a running fetch and refetches, which gives W-C11's "old poll cannot win".
- **Component:** `ArrivalsCounter.tsx`, props `{ eventId: string; announce?: boolean }`. It reads `useEventRegistrations(eventId)`, shows loading/error/data from the query, treats `isRefetchError` with data as the "Could not refresh" note, and renders `arrivals(data.registrations)`. It never renders rows. It does not have its own `me` or guard: the screens already render it only after the guard (W-R16, W-R28).
- **Screens:** `ScanScreen` renders `<ArrivalsCounter eventId={chosen.id} />` under the selector. `OrganizerRegistrations` renders `<ArrivalsCounter eventId={chosen.id} announce />` above the table when `registrations.length > 0` and adds the "Arrival" column.
- **Time:** `formatDateTime` (W-E19) with the optional zone argument for tests.
- **Fake timers in tests:** `vi.useFakeTimers()` after the `QueryClient` is made; advance with `await vi.advanceTimersByTimeAsync(5000)` so that promises settle; hidden tab through `Object.defineProperty(document, "visibilityState", ...)` plus a `visibilitychange` event. `mockFetch` call counts prove the request numbers.
- **SSE later (M8, step 42):** the stream updates the same query data with `setQueryData` for the same key; the interval stays as the fallback. Nothing in this file needs to be renamed.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/registrations/arrivals.ts` | `arrivals`, `ARRIVALS_POLL_MS`, `arrivalsRefetchInterval` (pure) | W-C1, W-C6, W-C9 |
| `web/src/registrations/arrivals.test.ts` | **Tests first:** `arrivals` (empty, waitlisted ignored even with `checked_in_at`, all arrived, never above registered); `arrivalsRefetchInterval` (no data, 401, 403, 404, 500, ok) | W-C1, W-C9 |
| `web/src/registrations/queries.ts` | Polling options on `useEventRegistrations`; `onSuccess` of `useCheckIn` invalidates `["event-registrations"]` only for `checked_in` | W-C4, W-C6-W-C11 |
| `web/src/registrations/ArrivalsCounter.tsx` | The block with text, states, note, Retry, live-region prop | W-C2, W-C3, W-C12-W-C14, W-C18 |
| `web/src/registrations/ArrivalsCounter.test.tsx` | **Tests first (fake timers):** W-C7 (unmount, selector change), W-C8 (hidden, visible), W-C9 (401, 403, 404, first-load error), W-C11 (one count, no local +1, five reads, 409 leaves it), W-C13 (failed poll keeps value, note shows and clears), W-C15 (account B); then W-C2, W-C6, W-C10, W-C12, W-C14, W-C18 | W-C2-W-C15, W-C18 |
| `web/src/registrations/ScanScreen.tsx` | Render the counter under the selector; nothing else changes | W-C3, W-C11 |
| `web/src/registrations/ScanScreen.test.tsx` | Add: counter visible in every camera state; 200 check-in refetches the list once; 409/404/400 do not; counter is not a live region here | W-C3, W-C11, W-C18 |
| `web/src/registrations/OrganizerRegistrations.tsx` | Counter above the table (only with rows), "Arrival" column, polling through the shared hook | W-C3, W-C16, W-C17 |
| `web/src/registrations/OrganizerRegistrations.test.tsx` | Add: Arrival cells (arrived with time, not yet, waiting list empty); counter hidden for an empty list; poll updates a cell and keeps the selected event | W-C16, W-C17 |
| `web/src/styles.css` | Counter card, note, "Everyone has arrived." line | W-C19 |
| `docs/specs/registration-web.md` | One-line pointers (user edit): W-R20 column list gets "Arrival" and the polling line (W-C16, W-C17); W-R34 "invalidates nothing now" becomes "refetches the list after a 200 (W-C11)"; question 11 answered | W-C11, W-C16 |
| `docs/brand.md` | Counter style after the canvas | |
| Design canvas | New board "Arrivals counter" (scan screen and list, states of section 6) in the existing canvas | |
| `README.md`, `ROADMAP.md` | Counter and column work; polling every 5 s; live updates not built (M8) | |

Tests follow `auth-web.md` section 4 and `registration-web.md` section 4 (Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test with `retry: false`, `MemoryRouter`, only `@testing-library/react`). Mock call counts prove the request numbers.

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- Every behaviour W-C1 to W-C19 has a test, or a note in the README that says it is not covered.
- Tests first, committed before the code: `arrivals.test.ts`, then `ArrivalsCounter.test.tsx` for W-C7, W-C8, W-C9 (polling stops), W-C11 (counted once), W-C13 and W-C15.
- Fake-timer proof: after unmount or in a hidden tab zero requests in 60 s; 5 s rhythm while visible; no concurrent requests.
- Manual check against the real API: two browser windows, one organizer scan screen and one list; check in a ticket in one, the other shows `+1` within 5 s; hide the tab and see in the network panel that polling pauses; stop the API and see "Could not refresh" with the last number, then start it and see the note go; log in as another organizer in the same tab and see that no number of the first one is shown.
- The README "Project status" says: the arrivals counter and the Arrival column work by polling every 5 s; live updates (server-sent events) are not built yet.

## 6. Screens for a visual mock-up

Each at desktop and phone width, organizer (indigo) accent. Sample data: event "Spring Meetup", 20 registered.

| Board | States |
|---|---|
| Scan screen with counter | "Arrived: 12 / 20 registered" under the selector, camera area below; with the camera denied; all arrived (20 / 20 + "Everyone has arrived."); empty event (0 / 0); loading "Loading arrivals..."; first-load error with Retry; failed poll ("Could not refresh" under the numbers) |
| Registrations list with counter | counter above the table, column "Arrival": "Arrived" + `Sat, 1 Jan 2030, 10:05 CET`, "Not yet", empty for the waiting list; failed poll note; no rows (counter hidden, "No one has registered for this event yet.") |

## 7. Open questions (each with a recommended answer)

1. **Organizer event page `/event/:id`.** Options: show the counter there too, or not. **Recommended: not.** That page is read only and already shows `registered` and seats left (E10); a third place would need its own request and its own tests. The scan screen is where the door is, and the list is the overview.
2. **Interval.** 5000 ms for both screens (`checkin.md`: "every few seconds"). **Recommended: 5 s**, one constant. Alternative 3 s for a busier door. Accept?
3. **Refetch when the tab becomes visible (W-C8).** Without it, a returning tab waits up to 5 s for fresh numbers. It means this one query sets `refetchOnWindowFocus: true` against the project default `false` (events-web). **Recommended: yes, for this query only.**
4. **List screen polls (W-C17).** This overrides the "no polling" line of `registration-web.md` for the organizer list. Alternative: only the scan screen polls and the list is read on load, but then the table and its counter would be stale together. **Recommended: poll on the list too.**
5. **"Arrival" column in `registration-web.md` W-R20.** Accept the extra column, or leave the table as it is and keep only the counter. **Recommended: add the column** (one cell per row, no new request); the ticket page keeps its single word "Checked in" (W-R25), no time.
6. **Scan screen counter and the result announcement (W-C18).** The counter there is silent because W-R34 announces the result. **Recommended: as written.** Alternative: also a polite region, which would read the new number after "Checked in".
7. **Counter on a passed or cancelled event.** Polling continues (cheap, rare). **Recommended: as written;** stopping by status can be added later.
8. **Ownership.** The scan screen stays in `registration-web.md` (its question 11, recommended answer). This file adds only the counter. Confirm.

## Roadmap note (suggested wording; ROADMAP.md is not edited here)

- 27. UI spec: `checkin-web.md` (done: W-C1-W-C19): the arrivals counter ("Arrived: 12 / 20 registered", counted from `GET /events/:id/registrations`, polled every 5 s, paused on a hidden tab, refetched after a check-in) and the "Arrival" column of the organizer list. The check-in screen itself (camera, manual code, results) is specified under M3 in `registration-web.md` (W-R28-W-R37).
- 28. Test, then code: the arrivals counter and the "Arrival" column (`arrivals.ts`, `ArrivalsCounter.tsx`, polling and stops tested with fake timers first; one check-in counted once). The check-in screen itself is already built from `registration-web.md` (W-R28-W-R37, M3); this step only wires the refetch after a 200 into it. Not a new check-in screen.
