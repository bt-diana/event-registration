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
