# Session: registration web implementation

Started 18-10 18:39 +06.

## Step 1: tests first for the register area and the registration routes

**Prompt** (18:39 +06, text cleaned)

> implement

(Roadmap steps 17-18 from `docs/specs/registration-web.md`, buildable part W-R1 to W-R23, with the recommended answers of open questions 1-8. The QR and scan part W-R24 to W-R37 is left out: it needs two new libraries, and those need the user's OK first.)

**What Claude did.** Read the spec, `api/openapi.yaml`, `docs/brand.md` and the web code. Wrote the tests-first files in `web/src/registrations/`: `entries.test.tsx` (W-R15-W-R17: redirects for both roles, logged out with `next`, loading, me error, no loop, one `GET /auth/me`), `RegistrationArea.test.tsx` (W-R1, W-R4 every row, W-R5 double click gives one `POST`, W-R6 201 and 200, W-R8, W-R9 409/404/401/403/5xx, W-R10, W-R23 cache by account), `TicketPage.test.tsx` (W-R13) and `test-helpers.ts`. Ran them: 47 fail, 4 pass (the organizer "no area" cases hold before the code); typecheck and lint pass. Commit `0b8d102`. Used Read, Grep, Write, Bash.

**Decision.** None.

## Step 2: register area, ticket page and route entries

**Prompt** (18:39 +06, same prompt as step 1; during the step the coordinator passed on that `registration-web.md` was updated in `efed152` to match `checkin.md`)

**What Claude did.** Built `web/src/registrations/`: `api.ts` (`getMyRegistration` with 404 as `null`, `register`), `queries.ts` (key `["registration", me.id, eventId]`, register success sets the cache and invalidates `["public-event", id]` and `["public-events"]`, 409/404 re-read the event, 401/403 re-check `me`), `ticket.ts` (`registerAction`, `ticketLabel`), `RegistrationArea.tsx` (login link, buttons, ticket panel, errors, a ref guard so a double click sends one `POST`, focus after success and error), `TicketPanel.tsx`, `TicketPage.tsx`, `entries.tsx` (role redirects), and the two list placeholders. Mounted the area in `PublicEventPage.tsx`, added the routes in `App.tsx`, the header links, exported `MeGate`, `onApiError`, `authCheckedCall` and `QUERY_OPTIONS`, and added styles. Added the other tests (W-R2, W-R3, W-R7, W-R11, W-R12, W-R14, W-R22, `ticket.test.ts`, placeholders, `it.todo` for W-R18-W-R21) and updated the W-E15, W-E17 and W-E20 tests that said "no register control". Re-read the spec diff of `efed152`: only blocked parts changed (organizer list route, check-in body and result texts), so only the placeholder comment and the `it.todo` texts changed. Not built: the QR and scan screen (W-R24-W-R37, new libraries need the user's OK). Updated `README.md` and `ROADMAP.md` (step 18 done). `bash scripts/verify.sh` passes: api 298 tests, web 399 tests and 6 todo, typecheck and lint clean. Used Read, Edit, Write, Bash.

**Decision.** None.

## Step 3: QR libraries `qr-creator` and `qr-scanner`

**Prompt** (19:01 +06, passed on by the coordinator, text cleaned)

> Use the libraries `qr-creator` (https://github.com/nimiq/qr-creator, to draw the ticket QR) and `qr-scanner` (https://github.com/nimiq/qr-scanner, to read it from the camera) instead of `qrcode`/`jsqr`. I have worked with them. They are from the same developer (Nimiq), so they are fully compatible with each other, and they are more up to date than the earlier candidates. Install them, pin the versions and update the spec. `GET /events/:id/registrations` is built now; `POST /checkin` is not.

**What Claude did.** Checked the npm names and versions (`npm view`), installed `qr-creator` 1.0.0 and `qr-scanner` 1.4.2 in `web/` with exact versions (no other new package; `qr-scanner` brings `@types/offscreencanvas` as its own dependency). Read the installed sources: qr-creator has only `QrCreator.render(config, element)` and draws only to a canvas (no SVG, no module matrix); qr-scanner works on a `<video>`, loads its worker file itself with a dynamic `import()`, has `QrScanner.hasCamera()`, and its `start()` turns every camera error into the string "Camera not found.". Updated `docs/specs/registration-web.md`: W-R24, W-R26, W-R27 (canvas with `role="img"` and label, `drawQr`), W-R30 (`hasCamera()`, the screen still asks for the camera itself so the error name is kept), W-R31, W-R33, W-R34 (results tested with a `submitCode` stub), W-R35, W-R37 (`scanner.ts` wraps qr-scanner), W-R20/W-R21 marked buildable (the route exists), sections 3, 4, 5, 6 and questions 9 and 14. Used Bash, Read, Edit.

**Decision.**

### D46: use `qr-creator` and `qr-scanner` for the ticket QR and the scan screen
19:01:07 +0600. `qr-creator` draws the QR of the ticket code, `qr-scanner` reads it from the camera, instead of the recommended `qrcode`/`jsqr`. Reason (the user's own words, not checked): the user has worked with these libraries; both are from the same developer (Nimiq), so they are fully compatible with each other; and they are more up to date than `qrcode` and `jsqr`.

## Step 4: ticket QR (W-R24-W-R27)

**Prompt** (19:01 +06, same prompt as step 3: build the QR on the ticket page, tests first)

**What Claude did.** Tests first (commit `c26dee0`, red: `qr.ts` and `showQr` missing): `qr.test.ts` (`qr-creator` mocked: one `render` call with the code only, level M, `radius` 0, quiet zone 4, `#101C1A` on white, 464 px, on the given canvas; no fetch), `showQr` and the "Checked in" line in `ticket.test.ts`, the QR cases in `TicketPage.test.tsx` (`qr.ts` mocked: shown for registered and on an Ended event; not for waitlisted, cancelled ticket, Cancelled event, checked in; canvas with `role="img"` and the label; no fetch after a re-render) and two cases in `RegistrationArea.test.tsx` (no QR on the event page, "Checked in" line). Then the code: `qr.ts` (`drawQr`, the only `qr-creator` import), `QrCode.tsx` (canvas, `h3` "Check-in code", the two hints), `showQr` and `checkedIn` in `ticket.ts`, the QR as a child of `TicketPanel` on the ticket page only, styles (232 px shown, 160 px minimum, `image-rendering: pixelated`). Updated `README.md` and `ROADMAP.md`. `bash scripts/verify.sh` passes (api 332, web 422 and 6 todo). A production build bundles `qr-creator`. While this step ran, another session committed `POST /checkin` (`d4ff8f2`); this step did not touch it. Used Read, Write, Edit, Bash.

**Decision.** None.

## Step 5: organizer registrations list (W-R20, W-R21)

**Prompt** (19:01 +06, same prompt as step 3: replace the `/registrations` placeholder with the real list, the route `GET /events/:id/registrations` is built)

**What Claude did.** Tests first (commit `f50c255`, red: the screen was still the placeholder): `OrganizerRegistrations.test.tsx` (no events with "Create event" and no list request, 404 "Event not found", default first event, `event` parameter in and not in the list, changing the event, table in the API order with the six columns and `scope="col"`, "Checked in", nobody, loading, list and events errors with Retry, 401 to the organizer login, one `h1`), the `it.todo` for W-R20/W-R21 removed, and the organizer cases of `entries.test.tsx` and the W-R13 case of `TicketPage.test.tsx` answer `GET /events`. Then the code: `listEventRegistrations` and the `OrganizerRegistration` type in `api.ts`, `useEventRegistrations` (key `["event-registrations", id]`) in `queries.ts`, `EventSelect.tsx` (selector and `useChosenEvent`, the choice in `?event=`), `OrganizerRegistrations.tsx`, styles for the select and the table. Updated `README.md` and `ROADMAP.md`. `bash scripts/verify.sh` passes (api 332, web 435 and 4 todo). Used Read, Write, Edit, Bash.

**Decision.** None.

## Step 6: organizer list cache keyed by account

**Prompt** (19:14 +06, passed on by the coordinator from a security review, text cleaned)

> `eventRegistrationsKey(eventId)` has no account in it. A login as another account replaces the cookie without a logout, so the cache would show the previous organizer's attendee names and emails. Key it by `me.id`, enable the query only when `me` is a loaded organizer, and add a test first. Also check that the cache is cleared or ignored when the `me` identity changes on login or sign-up; if that is a broader existing gap, report it instead of widening the scope. Add this to the spec and the session file.

**What Claude did.** Test first (commit `349b7b9`, red: after `me` changes from organizer A to B the same key showed A's rows and no new request was made). Then `eventRegistrationsKey(meId, eventId)` and `useEventRegistrations` enabled only for a known organizer (`queries.ts`). Checked login and sign-up in `auth/session.ts`: they only set the `me` cache and remove nothing, so `["events"]` (the organizer's events, from M2) has the same gap: organizer B can briefly see A's event titles until the refetch. Not fixed here (auth-web and events-web scope); written as a known gap in `registration-web.md` W-R23 and reported. Updated the spec W-R20, W-R21, W-R23, section 2 and section 3 keys. `bash scripts/verify.sh` passes (api 332, web 436 and 4 todo; the scan screen test files of the next step were set aside for this run). Used Read, Edit, Bash.

**Decision.** None.

## Step 7: organizer scan screen with the real check-in (W-R28-W-R37)

**Prompt** (19:01 +06, same prompt as step 3: the scan screen `/registrations/scan` with the "Check in attendees" link; then, passed on by the coordinator during the step, text cleaned:)

> `POST /checkin` is now implemented. Add `checkIn(ticketCode)` in `registrations/api.ts` and `useCheckIn()` in `queries.ts` as the spec says, make it the real default `submitCode`, map the 200/404/409/400/401/403 answers to the W-R34 result states from the real OpenAPI error codes, and turn the blocked W-R34 tests into real tests with fetch mocked.

**What Claude did.** Updated `registration-web.md` for the real call (commit `21a0540`: W-R33, W-R34, section 3 `CheckInResult` mapping, section 4 rows, `/checkin` proxy). Tests first (commit `930f8a7`, red: no scan screen, no `scanner.ts`, `camera.ts`, `ticketCode.ts`): `ScanScreen.test.tsx` (camera states incl. denied, no camera, insecure; no prompt before the click; invalid scanned text sends nothing; manual entry; five reads of one code and a double click give one `POST /checkin`; every answer 200, 409 x4, 404, 400, 5xx and network with "Try again", 401 to the login; release on unmount, route change, event change and while asking; selector, no events, events error; accessibility), W-R28 guard, link and W-R17 rows in `entries.test.tsx`, and `ticketCode.test.ts`, `camera.test.ts`, `scanner.test.ts` (`qr-scanner` mocked). Then the code: `ticketCode.ts`, `camera.ts`, `scanner.ts` (the only `qr-scanner` import: `hasCamera`, `startScanner` with `pause(true)` and `destroy()` on stop), `checkIn` and `CheckInResult` in `api.ts`, `useCheckIn` in `queries.ts`, `ScanScreen.tsx`, `ScanEntry` in `entries.tsx`, the route in `App.tsx`, the "Check in attendees" link on `/registrations`, `/checkin` in `vite.config.ts`, styles. A production build puts the qr-scanner worker in its own chunk. Updated `README.md` and `ROADMAP.md`. `bash scripts/verify.sh` passes (api 332, web 522 and 4 todo). Not done: the manual camera and QR check with a phone (jsdom has no camera); the mock-up boards in the design canvas could not be opened from this agent, so the screens follow `docs/brand.md` and section 6 of the spec. Used Read, Write, Edit, Bash.

**Decision.** None.

## Step 8: spec for the arrivals counter (checkin-web.md)

**Prompt** (19:21 +06, text cleaned)

> let's then create a spec for checkin-web.md with what's left

**What Claude did.** Gave the `spec-writer` agent the task. It wrote `docs/specs/checkin-web.md` (W-C1-W-C19): arrivals counter ("Arrived: 12 / 20 registered") counted from the organizer list, polled every 5 s, an "Arrival" column, stops and refetch after a check-in tested first. Claude marked roadmap step 27 done, reworded step 28 (the scan screen is already built from `registration-web.md`), and fixed W-R29 so it no longer says the event id goes to the check-in. Open questions 1-8 are not answered; the spec's recommended answers are: no counter on the event page, 5 s, refetch on tab focus, list polls, add the column. Pointer edits for W-R20 and W-R34 in `registration-web.md` are still to do. Used Agent (`spec-writer`), Bash.

**Decision.** None.

## Step 9: checkin-web spec reworked for the arrivals route

**Prompt** (19:4x +06, text cleaned)

> the new /checkin endpoint should serve the checking process
> no need to poll the organizer list; after a new user is checked in, the organizer should stay on the checking page;
> the list of registered users should be shown on the registrations page and the new API call should be performed on return; let's show the numbers on that page as well
> I added a separate endpoint for the arrivals count: GET /events/:id/arrivals
> update the spec

**What Claude did.** Gave the `spec-writer` agent the decisions. It rewrote `docs/specs/checkin-web.md`: no polling (the interval and `arrivals.test.ts` are gone), the list and the arrivals counter are requested again on every return to `/registrations` (`staleTime: 0`, `refetchOnMount: "always"`), a successful check-in invalidates only `["event-arrivals"]` and the organizer stays on `/registrations/scan`, the counter uses `{ capacity, registered, arrived }` from `GET /events/:id/arrivals` and shows on both screens. It fixed the contradicting lines in `registration-web.md` (W-R20, W-R21, W-R23, the check-in call, out of scope). Open questions left: confirm "no polling", refetch on window focus (recommended no), keep the Arrival column, "Capacity: 25" vs "Seats: 25", empty page shows `0 / 0`, old rows visible during the refetch. Used Agent (`spec-writer`), Bash.

**Decision.**

### D50: no polling; list and arrivals counter reload on return to the registrations page
19:45 +0600. The user wants the check-in to use `POST /checkin`, the organizer to stay on the check-in page after a check-in, no polling of the organizer list, and the list and the numbers (from the new `GET /events/:id/arrivals`) to be requested again when the organizer returns to `/registrations`. Reason: simpler than polling, and the data is fresh when it is looked at.

## Step 10: no live counter

**Prompt** (19:48:09 +0600, text cleaned)

> why do we need polling?
> let's not have it live; SPEC_TEMPLATE.md is just a spec template, not the real spec, so never treat it like one

**What Claude did.** Explained that polling came from B7 in `SPEC_TEMPLATE.md` ("updates live") and from roadmap M8. Dropped M8 (steps 40-43) in `ROADMAP.md`, changed step 45/46 and the README lines that promised live updates or server-sent events to "read again on return". Saved the template rule as a memory. Used Bash.

**Decision.**

### D51: the arrivals counter is not live
19:48:09 +0600. The user does not want live updates or polling. The counter reloads when the organizer returns to the page (D50). `SPEC_TEMPLATE.md` is only a template: its behaviours (B1-B10) are not requirements and must not be used to justify features. Reason: simpler, and the template was never the real spec.
