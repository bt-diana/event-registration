# Spec: Email notes on the ticket page (web, M6 UI)

Feature spec for the web side of milestone M6, made from `SPEC_TEMPLATE.md` (sections 1-5). Roadmap step 33 (this spec) and 34. The API side is `email-reminders.md` (ER1-ER38, console stub, D56, D57); this file does not change it. M7 (reschedule and event-cancel emails, roadmap steps 38-39) extends this file later. Ids are **W-EM1, W-EM2, ...**: the prefix `W-E` is already used by `events-web.md` (W-E1-W-E21), so it is not reused (question 1).

## 0. What the API can tell the web today (checked in `api/openapi.yaml` and `web/src`)

**Nothing about email status.** No response has a field or a route for the outbox:

- `Registration` (`POST /events/:id/registrations`, `GET .../registrations/me`) has exactly `id, event_id, status, ticket_code, waitlist_position, checked_in_at, created_at` (`additionalProperties: false`).
- `OrganizerRegistration` adds only `attendee_name` and `attendee_email`. `CheckIn`, `Arrivals` and `PublicEvent` have nothing about email either.
- `outbox.status`, `send_attempts`, `send_error` and `sent_at` (`email-reminders.md` ER1) are not returned by any route (said in its section 2). There is no outbox route.
- The web code under `web/src` shows no email text anywhere (the word appears only for the login form and the organizer table column).

So the web **cannot know** whether a ticket email is pending, "sent" (printed) or `error_sending`, and it cannot know whether a given `registered` ticket came from a seat taken at once (a `ticket` row) or from a promotion (M4, a `promotion` row). Also, the email is a console stub (D57): a line printed in the API terminal. No sentence on any screen may say or suggest that an email reached an inbox.

**Decision of this spec:** the UI only shows **static wording that is true whatever the outbox holds**. No new route, no new field, no new query, no polling, no library. Showing a real per-ticket status ("ticket email sent", "could not be sent") needs a new route or field and is an open question (question 2, recommended: not now).

## 1. Goals and expected behaviour

**Goal.** An attendee who opens their ticket page (`/registrations/me?event={id}`) sees one short, honest note about email: this demo does not deliver email to an inbox, the messages are only printed in the server log, and (for a seat that can still get one) a reminder is prepared about a day before the event. Nothing else on the web changes in M6.

**Behaviours.** Each line is checked with a component or unit test (`fetch` mocked). "Test first" ones get the test before the code. The text is a pure function so every state is tested by a direct call.

| # | Behaviour | Test first? |
|---|---|---|
| W-EM1 | **No new request.** The ticket page sends the same two requests as before (`GET /public/events/:id`, `GET .../registrations/me`, W-R11) and no other. The note is drawn from the data of those two answers. No new route, query key, hook or mutation, and nothing in `api/` or the dev proxy changes. Test: the `fetch` mock is called with exactly those two URLs, before and after the note is shown. | yes |
| W-EM2 | **Demo note (always, when a ticket is shown).** Whenever the ticket page shows a registration (`registered`, `waitlisted` or `cancelled`), it shows the line "Demo: emails are not sent to a real inbox. They are only printed in the server log." The line says nothing about this person's own mail, so it is true for every outbox state (pending, printed, `error_sending`). It is not shown in the states without a ticket (loading, error, "You have no ticket", "Event not found"). | yes |
| W-EM3 | **Reminder line (pure function `reminderNote(registration, publicEvent)` in `ticket.ts`).** It returns the text "A reminder is prepared about 24 hours before the event starts." only when all hold: `registration.status` is `registered`, `registration.checked_in_at` is `null`, and the public event is not `cancelled`, not `passed` and `has_started` is false (the same flags as W-E17). Otherwise it returns `null` and the line is not drawn. Test: a table of cases (registered and open: text; registered and Full: text (full does not matter); waitlisted, cancelled, checked in, event Cancelled, Ended, Already started: no text). | yes |
| W-EM4 | **Honest words.** No text added by this spec contains "sent to you", "delivered", "arrived", "in your inbox", "check your email", "we emailed you" or the attendee's email address. The only verbs are "printed in the server log" and "prepared". Test: render all states and check that none of those phrases is in the page text. | yes |
| W-EM5 | **Waiting list and cancelled.** A waitlisted ticket gets W-EM2 only (no reminder, `DATABASE.md` decision 6; the promotion email of M4 is not promised here). A cancelled ticket gets W-EM2 only. A checked-in ticket gets W-EM2 only. | |
| W-EM6 | **Where and how.** Both lines go under the ticket panel on the ticket page (under the QR when it is shown), as two plain `<p>` elements, 14px `text-muted`, in this order (demo note, reminder line). No icon, no badge, no colour for status, no live region, no `role="alert"`, no button. They are not shown on the event page area (`RegistrationArea`), the organizer screens, the public page or any list. Test: the event page and the organizer registrations page do not contain the text. | |
| W-EM7 | **Nothing for the organizer.** No organizer screen says anything about email in M6: the organizer list shows `attendee_email` as before (W-R20) and gets no "email sent" column or note, because the API cannot say it. | |
| W-EM8 | **The ticket page keeps working as before.** Existing ticket page behaviour (W-R11-W-R13, W-R25-W-R27: states, QR, `Checked in`, no fetch for the QR) is unchanged; their tests pass without edits. | |

**Out of scope.** A real per-ticket or per-event email status (sent, pending, failed, "could not send") and any new route or field for it; a list or count of outbox rows; a resend button; email text preview; the organizer seeing which attendees got email; notes on the register button or the event page; an inbox or notification centre; reschedule and event-cancel messages (M7); promotion message to waiting people (M4); settings for reminders; real delivery (D57); translations; dark theme; polling (D51).

**Assumptions.** Change any of these first in this file.
- A `registered` person that is not checked in and whose event is open and not started will get a reminder when the event is within 24 hours and the worker runs (`email-reminders.md` ER18, ER23, ER24). Saying "prepared" is a statement about the rule, not about a row; it can be stale only when a reschedule or cancel (M7) changes the event, which M7 will cover.
- The reminder line uses the event flags from the public event answer (`status`, `passed`, `has_started`), not the browser clock, so the test needs no fake timers.
- "The server log" is the API terminal where the stub prints `[email] ...` lines (ER7). The demo wording stays until a real transport exists (a later spec would replace W-EM2).

## 2. UI decisions

| Screen | What changes |
|---|---|
| Ticket page `/registrations/me?event={id}` (exists, W-R11) | Two small lines under the ticket panel (W-EM2, W-EM3, W-EM6). Nothing else. |
| Event page registration area, ticket panel on the event page | No change. |
| Organizer screens | No change (W-EM7). |

**Texts.**

| Where | Text |
|---|---|
| Demo note (all ticket states) | "Demo: emails are not sent to a real inbox. They are only printed in the server log." |
| Reminder line (registered, not checked in, event open and not started) | "A reminder is prepared about 24 hours before the event starts." |

**States on the ticket page.** Loading, error, no ticket, event not found: no email lines (the existing texts stay). Registered, waitlisted, cancelled, checked in, event Cancelled, Ended, Already started: see W-EM2, W-EM3 and W-EM5.

**Design board.** This changes a visible screen by two small text lines, so one board "Ticket page: email notes" is added to the **existing** design canvas (link in `README.md` and `docs/brand.md`; not a new artifact): registered (both lines), waitlisted (demo note only), checked in (demo note only), event Cancelled (demo note only), at desktop and phone width, attendee (teal) accent. Style from `docs/brand.md`: 14px `text-muted`, no new colour.

## 3. Architecture decisions

- **Apps:** `web/` only. No new library, no API change, no proxy change, no new route (roadmap: "no new route unless the spec asks for it"; it does not).
- **Pure function** `reminderNote(registration, publicEvent): string | null` in `web/src/registrations/ticket.ts`, next to `ticketLabel` and `showQr`, using the same inputs as `showQr` (`Registration`, `PublicEvent`). The two texts are constants in the same file (`EMAIL_DEMO_NOTE`, `REMINDER_NOTE`).
- **Drawing:** `TicketPage.tsx` renders `<p className="email-note">` for each, under the ticket panel and QR, only on the branch that already has both answers and a registration.
- **Styles:** one class `.email-note` in `web/src/styles.css` (14px, `text-muted`, margin-top 8px). No new colour.
- **Why static:** the only data source for real status would be a new route or field (question 2). Until then a "sent" claim would be invented.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/registrations/ticket.test.ts` | **Tests first (red):** `reminderNote` table (W-EM3, W-EM5) | W-EM3, W-EM5 |
| `web/src/registrations/TicketPage.test.tsx` | **Tests first (red):** demo note shown for registered, waitlisted, cancelled, checked in; not shown for loading, error, no ticket, event not found; the two fetch URLs only; forbidden phrases absent (W-EM1, W-EM2, W-EM4). Add: the event page and the organizer registrations page do not contain the text (W-EM6, W-EM7) | W-EM1, W-EM2, W-EM4, W-EM6, W-EM7 |
| `web/src/registrations/ticket.ts` | `reminderNote` and the two text constants | W-EM2, W-EM3 |
| `web/src/registrations/TicketPage.tsx` | Draw the two lines under the panel | W-EM2, W-EM3, W-EM6 |
| `web/src/styles.css` | `.email-note` | W-EM6 |
| `docs/brand.md` | One line: email note style after the canvas | |
| Design canvas | Board "Ticket page: email notes" in the existing canvas | |
| `README.md`, `ROADMAP.md` | Step 33 done (this spec), step 34 when built; state honestly: email is a console stub, the web shows no per-ticket email status, only static notes | |

Not touched: `api/` (no file), `web/package.json`, `vite.config.ts`, `RegistrationArea.tsx`, `TicketPanel.tsx`, the organizer screens, other specs. Tests follow `registration-web.md` section 4 (Vitest globals, files next to the code, `mockFetch`, fresh `QueryClient` per test with `retry: false`, `MemoryRouter`, only `@testing-library/react`).

## 5. Done means

- Tests, typecheck and linter pass in `web/` (`bash scripts/verify.sh`).
- Every behaviour W-EM1 to W-EM8 has a test, or a note in the README that says it is not covered.
- Tests first, committed before the code: `ticket.test.ts` (W-EM3, W-EM5) and the W-EM1, W-EM2, W-EM4 cases of `TicketPage.test.tsx`, shown failing for the right reason.
- `git diff --stat` shows no file under `api/`, no change in `web/package.json` and no new route.
- By hand, once: with the API running, register and open the ticket page; the demo note and the reminder line show; the API terminal shows the `[email] ticket to ...` line; check the ticket in, reload the ticket page, the reminder line is gone.
- README "Project status" says: the ticket page carries two static email notes; the web shows no per-ticket email status because the API does not return one; email is a console stub.

## 6. Open questions (each with a recommended answer)

1. **Id prefix.** You asked for W-E1, W-E2, ...; `events-web.md` already owns W-E1-W-E21 (and the later specs refer to them, for example W-E17, W-E19). **Recommended: W-EM1...** (used here). Alternative: renumber from W-E22, which would still read as part of the events spec.
2. **Real status on the ticket page ("ticket email sent / could not be sent").** Needs a new field (for example `ticket_email: "pending" | "sent" | "failed"` on `GET .../registrations/me`) or a route, changes `openapi.yaml`, and still only means "printed", never "delivered" (D57). **Recommended: not now.** The honest static notes are enough for a stub; add it with the real transport, if that is ever built, in its own spec. If you want it anyway, the smallest form is one field on `Registration`, read from the newest outbox row of kind `ticket` or `promotion`.
3. **Is the demo note wanted at all?** It tells the user that no inbox gets mail. It is accurate and cheap, but it is development wording on an attendee screen. **Recommended: keep it** until real email exists (the README already says "no real email"). Alternative: show only the reminder line, or show nothing and end M6 UI with this spec.
4. **Reminder line for a registered person.** It is a promise about the rule, not about a row. **Recommended: keep it**, shown only where the rule applies (W-EM3). Alternative: drop it so the page makes no promise at all (then W-EM3, W-EM5 reduce to the demo note).
5. **Organizer view.** **Recommended: nothing in M6** (W-EM7); the API has nothing for it. M7 will add reschedule and cancel-event UI and can add notes there ("everyone registered and waiting gets an email").
6. **Ticket page only.** The note could also sit on the event page ticket panel. **Recommended: ticket page only** (one place, fewer tests).
