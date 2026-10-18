# Spec: HTML + plain-text email template for all five outbox kinds, with a ticket QR (M6, API only)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-6). It extends `email-reminders.md` (the sender, the transport and the text of the rows); rows of that spec that change are listed in section 3 and edited in place there, with a note that points here. Ids are ET1, ET2, ... (no clash: `ET` is not used by another spec). Roadmap steps 34a and 34b (this spec is 34a). Behaviours: none of B1-B10 changes; this is the look and the format of the emails of B1, B3, B5, B8 and B9.

**Decisions that shape this spec.**
- **D76** (session `18-10-2308_email-templates`): one shared HTML layout with its own content per kind (`ticket`, `promotion`, `reminder`, `reschedule`, `event_cancelled`), sent as `html` and `text` together. Brand colours from `docs/brand.md`.
- **D77** (from the coordinator, decided by the user): the `ticket`, `promotion` and `reminder` emails also carry a QR of the ticket code. Same package as the web, `qr-creator` 1.0.0 (`web/src/registrations/qr.ts`), plus the native `canvas` package (node-canvas), because `qr-creator` only draws onto a canvas and the API has no DOM. **Both are new dependencies in `api/`, approved by the user** (the project rule "no library that is not in the spec" is met by this approval and by this spec, like `resend` in D58).

**What was checked (2026-10-18).**
- Resend inline images (https://resend.com/docs/dashboard/emails/embed-inline-images): the html has `<img src="cid:<id>">` and the attachment has the same value in `contentId` (a string under 128 characters). A local file is passed as `content` (a Buffer, or a base64 string) with `filename`; inline images follow the rules of normal attachments, and attachments are not supported by the batch endpoint (not used here). Some webmail clients may reject inline images. Many clients block `data:` URIs, which is why `cid:` is used. "Verify at install" below.
- `qr-creator` 1.0.0 in `web/node_modules/qr-creator/src/qr-creator.js`: `QrCreator.render(options, element)` does `$element instanceof HTMLCanvasElement` before it draws. In Node `HTMLCanvasElement` is not defined, so the call throws a `ReferenceError`. The module therefore sets `globalThis.HTMLCanvasElement` to node-canvas's `Canvas` class before the call (a three-line shim, only in `qr.ts`). The drawing itself only uses `getContext('2d')`, which node-canvas has.

## 1. Goals and expected behaviour

**Goal.** Every email the app sends is a small, readable page in the brand colours (ground, white card, accent) with the same facts as today's plain text, plus the plain text itself as the fallback part. A ticket, promotion or reminder email also shows the ticket as a QR that the organizer can scan at the door. Nothing about when or to whom an email is sent changes.

**How the HTML reaches the transport (recommended, open question 1).** The html is built **at send time from the stored outbox row** (`kind`, `subject`, `body`), by a pure function. No new column, no migration, no change to the five places that write rows.

| | A. New column `body_html` (migration 005) | B. Render at send time from `kind`, `subject`, `body` (recommended) |
|---|---|---|
| Writers | All five must produce html. Three of them (reminder, reschedule, cancel) are one `INSERT ... SELECT` statement in SQL, which cannot call a TypeScript renderer; they would have to become read-then-insert in the app (breaks ER27, the "one statement" rule) or build html with SQL string concatenation. | None changes. Rows keep the text body that ER19, ER68, ER75 and `registration.md` R3 already fix. |
| Migration, tests | Migration 005, a CHECK or backfill for old rows (old rows have no html), changes in the reminder, reschedule, cancel and ticket tests. | None. Existing tests on the body pass unchanged. |
| Idempotency (ER10, ER12) | The stored html cannot change between two tries. | The payload is a pure function of the row, so it is the same on every try. It can differ only if the template code is deployed between two tries of the same row, inside Resend's 24 hours: Resend then answers `409 invalid_idempotent_request`, which is a failed try like any other (D56). Accepted. |
| Immutable rows (ER10, `event-edit.md` EE14) | Yes. | Yes: nothing is joined from `events`, `registrations` or `users` at send time, so an event edit after the row was written cannot change the email (the title in the email is the title in the subject). |
| Cost | A column that holds a big, repeated text for every row. | A small parser of the stored text (section 3). |

The parser is safe because the body grammar is fixed by this spec set (ER19, ER68, ER75, R3): line 1 is a sentence or the title, and the facts are `Label: value` lines. The ticket code needed for the QR is read from its `Ticket code: ` line the same way. Rejected: a joined read at send time (breaks immutability); html stored in a jsonb `payload` (a bigger change to every writer for no gain today).

**Behaviours.** Each line is something a test can prove. "Yes" means the test is written and committed before the code (red). The first group tests the pure module with plain objects, no database, no network, no clock. Tests never send real email (`email-reminders.md` section 1).

Template module, `renderEmail(row)` in `api/src/email/templates.ts` (roadmap step 34b). Input `{ kind, subject, body }` (the three stored columns). Output `{ subject, text, html, ticketCode }`, where `ticketCode` is a string for the three kinds that show a ticket and `null` for the other two.

| # | Behaviour | Test first? |
|---|---|---|
| ET1 | **Pure and deterministic.** `renderEmail` does no I/O, reads no `process.env`, no clock, no random, imports no library. The same input gives a byte-identical output on every call (also 100 calls in a row, also for two equal but separate objects). This is what keeps the idempotency key valid (ER10, ER12). | yes |
| ET2 | **Subject unchanged.** `output.subject === input.subject`, for all five kinds, with these stored subjects: `Your ticket for <title>`, `You have a seat at <title>` (promotion, `cancel-registration.md` open question 8), `Reminder: <title> starts soon`, `Rescheduled: <title>`, `Cancelled: <title>`. | yes |
| ET3 | **Title from the subject.** The title shown in the html is the subject with the fixed part of its kind removed (table in section 2). If the fixed part is not there (a hand-made row), the whole subject is the title; nothing throws. | |
| ET4 | **Plain-text part.** `text` is the stored `body` byte for byte, then an empty line, then the footer line of the kind (section 2). So every fact of the old text (title, `Starts: ...`, `Ticket code: ...`, `New start: ...`, `Previous start: ...`, `Was to start: ...`, `The event has been cancelled.`) is still in `text` and the old tests on `body` stay valid. | yes |
| ET5 | **HTML escaping.** Every dynamic value (title, every detail value, the ticket code, the preheader, the document `<title>`) goes through one `escapeHtml` that turns `& < > " '` into entities. A title `<b>"&` appears as `&lt;b&gt;&quot;&amp;` and the string `<b>` is not in the html. | yes |
| ET6 | **No dynamic text in attributes or in structure.** The only attribute values are fixed in the template (`cid:ticket-qr`, a fixed alt text, widths, `lang`, `role`). Test: render the same row with title `Plain` and with a hostile title (`" onmouseover="x" <script>alert(1)</script>`); after replacing the escaped title in both outputs with a placeholder, the two htmls are identical, and the hostile one has no `<script`. | yes |
| ET7 | **Each kind shows its facts** (section 2 table). Test per kind with a body in the exact stored shape (the shapes in `api/test/events/reschedule.test.ts` and `cancel.test.ts` and the ticket and reminder bodies of ER19 and `registration/service.ts`): the html contains the escaped title, the eyebrow, the fixed intro, and every `Label: value` of the kind with its value. | yes |
| ET8 | **Ticket code only where it belongs.** For `ticket`, `promotion` and `reminder` the html contains the ticket code once as text (in the code block) and `ticketCode` is that string. For `reschedule` and `event_cancelled` (ER68, ER75) the html and `ticketCode` have no code: the renderer does not read a `Ticket code:` line for these two kinds, so even a wrong body cannot put the code into their html. | yes |
| ET9 | **Same facts in text and html.** For every `Label: value` line of the body, the html contains the label and the escaped value; the footer line is in both parts; the title is in both. A test loops over the five kinds. | yes |
| ET10 | **Self-contained.** The html has no `<script`, `<link`, `<iframe`, `@import`, `url(`, `http://` or `https://` (no external image, font, stylesheet or link), no web font, and no `<img` except the one `cid:` image of the three ticket kinds. It has one small `<style>` block (the phone rule, section 2) and inline styles everywhere else. No emoji; the html is plain ASCII for an ASCII title (typographic characters are entities). | yes |
| ET11 | **Document shape.** `<!doctype html>`, `<html lang="en">`, `<meta charset="utf-8">`, a viewport meta, a `<title>` equal to the escaped subject, layout in `<table role="presentation">`, the card at `max-width: 600px`, a hidden preheader as the first thing in `<body>`. | |
| ET12 | **Palette only.** Every `#rrggbb` in the html is one of `#EEF1F0`, `#FFFFFF`, `#C9D3D0`, `#101C1A`, `#4A5A57`, `#0B6E5F`, `#8C1D18`. The pairs used (section 2) are at least 4.5:1; that is checked once by hand and noted in the session file (a test of a contrast formula is not worth adding). | |
| ET13 | **Missing facts do not break the email.** A body with no `Starts:` line (a hand-made row) still renders: no empty label, no `undefined`, no `null`, and the html is still valid in shape (ET11). An empty body gives a html with the title and the footer only. | |

QR module, `makeQrPng(code)` in `api/src/email/qr.ts` (the only file that imports `qr-creator` and `canvas`; both are loaded lazily with `import()` inside the function, so a test or a start-up that never builds a QR never loads the native module).

| # | Behaviour | Test first? |
|---|---|---|
| ET14 | **A PNG from the code.** `makeQrPng('ABCDEFGH23')` resolves a `Buffer` that starts with the 8 PNG signature bytes (`89 50 4E 47 0D 0A 1A 0A`), whose IHDR width and height are both 464. | yes |
| ET15 | **Same options as the web, so the two QRs match.** The content is the ticket code only (no URL, no prefix), `ecLevel: 'M'`, `radius: 0`, `quiet: 4`, `fill: '#101C1A'`, `background: '#FFFFFF'`, `size: 464` (`web/src/registrations/qr.ts`). Cheap check without a decoder library: load the PNG with node-canvas `loadImage`, read pixels: the four corners (quiet zone) are `#FFFFFF`; the middle of the top-left finder square (pixel 4 x 16 + 8 = 72 from both edges) is `#101C1A`; the pixel just outside that finder square, in the quiet zone, is `#FFFFFF`. The test does not call the web. | yes |
| ET16 | **Deterministic.** The same code gives the same bytes on two calls; two different codes give different bytes. (The idempotency key needs the same payload on every try.) | yes |
| ET17 | **Failure is loud.** If `canvas` cannot be loaded or drawing throws, `makeQrPng` rejects; it does not return an empty buffer. | |

Message builder, `buildMessage(row, qrPng = makeQrPng)` in `api/src/email/message.ts` (the sender calls it for each claimed row; the second argument lets a test pass a fake, and a sender test whose rows have no `Ticket code:` line never reaches the real one).

| # | Behaviour | Test first? |
|---|---|---|
| ET18 | **Message shape.** For `ticket`, `promotion` and `reminder` with a `Ticket code:` line it resolves `{ to, subject, text, html, attachments: [ { filename: 'ticket-qr.png', content: <PNG Buffer>, contentType: 'image/png', contentId: 'ticket-qr' } ] }`, and the html has `<img src="cid:ticket-qr"` exactly once. The PNG is `makeQrPng(<the code in ticketCode>)`. For `reschedule` and `event_cancelled`, and for a ticket-kind row without a `Ticket code:` line, there is **no `attachments` key** and no `<img` in the html. Test with a fake `qrPng` that records the code (called once, with the code only). | yes |
| ET19 | **Accessible without the image.** The `<img>` has a fixed `alt` ("QR code of your ticket. Show it at the door.") with `width`/`height` attributes and `style="display:block;max-width:100%;height:auto"`; the ticket code is also in the html as text (ET8) and in `text`. A client that blocks the image still shows the code. | yes |
| ET20 | **QR failure is a failed try, not a plainer email.** If `qrPng` rejects, `buildMessage` rejects, the sender runs its failure path (ER11, ER17: the row stays `pending`, `send_attempts + 1`, reason in `send_error`, three tries then `error_sending`). It never sends the email without the image, because that would change the payload between tries. Test with a fake that rejects and a fake transport that must not be called. | yes |
| ET21 | **Same row, same message.** Two `buildMessage` calls for one row give deep-equal messages, including equal PNG bytes (real `qrPng`, one test). | yes |

Sender, transport, privacy (changes to `email-reminders.md`, section 3):

| # | Behaviour | Test first? |
|---|---|---|
| ET22 | **Sender uses the builder.** `sendPending` still selects the same columns (`id, kind, to_email, subject, body`) and now calls `transport({ ...buildMessage(row), idempotencyKey: row.id })`. For a row of any kind the transport receives `to`, `subject` (equal to the stored one), `text` (starts with the stored body), `html` (a non-empty string) and `idempotencyKey`. The sender has no code per kind (ER9): `buildMessage` has it. A repeat try of one failing row (ER12) gets deep-equal messages and the same key each time. | yes |
| ET23 | **Transport carries html and attachments.** `EmailTransport` gets `html: string` and `attachments?: EmailAttachment[]`. `createResendTransport` calls `emails.send` with `{ from, to: [to], subject, text, html }` and adds `attachments: [{ filename, content, contentType, contentId }]` only when the message has them (a message without attachments has no `attachments` key in the payload). Fake client, one test each. | yes |
| ET24 | **Nothing new is logged, stored or returned.** The sent line (ER7), the `onError` message and `send_error` (ER17), the transport's thrown messages (ER40) and the organizer route (ER48-ER60, ER51) never contain the html, the PNG, the `attachments` or the ticket code. Test: a ticket row is sent with a transport that throws a message holding the html; the logged line and `send_error` do not contain `<html` or the code. The route response has no `html`, `attachments` or `body` key (the existing ER51 test gets the two extra keys). The PNG holds the ticket code (the secret that admits a person), so it is treated like the body. | yes |
| ET25 | **No data change.** No migration, no new column, no new outbox kind or status. The writers (`registrations/service.ts`, the reminder statement, the reschedule and cancel statements) are not edited; ER3, ER19, ER68, ER75 and `registration.md` R3 pass unchanged. | |
| ET26 | **Preview (hand check).** `npm run email:preview -- <folder>` in `api/` writes five html files (`ticket.html`, `promotion.html`, `reminder.html`, `reschedule.html`, `cancelled.html`), the QR as `ticket-qr.png` next to them, with the `cid:` link rewritten to the file name in the copy it writes, from sample rows (a title with `&` and a long title). It sends nothing and reads no key. Used for the check against the design boards (section 2); not run by the tests. | |

## 2. UI decisions

No web screen. The design is the email itself. **Boards:** after this spec is accepted, the email boards (one per kind, each at desktop width 640px and phone width 360px, so ten frames, plus one for the ticket with the image blocked) are added to the existing design canvas https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76 as new boards (project rule: no new design artifact). They are not made in this step. When they exist, the module is checked against them with the preview of ET26; a difference is fixed in the module or in this section first, whichever is wrong.

**Email-safe version of `docs/brand.md`.** Real mail clients ignore web fonts, many ignore `border-radius` and CSS in `<head>`, and Outlook ignores `max-width` on some elements. So: table layout, inline styles, a `bgcolor` attribute next to every background colour, system fonts, no images except the QR.

| Part | Value |
|---|---|
| Page | Background `#EEF1F0` (ground), centred column, `max-width: 600px`, padding `32px 16px` (`16px` on a phone). |
| Font | Everything: `-apple-system, "Segoe UI", system-ui, Roboto, Arial, sans-serif` (no Bricolage Grotesque or Public Sans: web fonts are unreliable in mail). Code: `ui-monospace, Menlo, Consolas, monospace`. |
| Preheader | The first element of `<body>`: hidden (`display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all`), 90 characters at most, the intro line of the kind; followed by hidden padding of `&zwnj;&nbsp;` so the inbox does not pull in body text. |
| Wordmark | Text "Event Registration", 20px, 700, `#0B6E5F`, above the card on the ground; no image (images may be blocked). Not a link (no public URL is known to the API, open question 2). |
| Card | `#FFFFFF`, 1px `#C9D3D0` border, radius 12px, padding 32px (20px on a phone). |
| Eyebrow | 13px, 600, uppercase, letter spacing `0.08em`, `#0B6E5F` (`#8C1D18` for the cancelled email, as the brand's dark error). |
| Title (`h1`) | The event title, 28px (24px on a phone), 700, line height 1.2, `#101C1A`, `word-break: break-word`. |
| Intro | One fixed paragraph, 16px, line height 1.5, `#101C1A`. |
| Details | A two-column table, one row per `Label: value` line: label 14px 600 `#4A5A57`, value 16px `#101C1A`, a 1px `#C9D3D0` line between rows, rows at least 44px high. On a phone label and value stack. |
| Ticket block | Only for ticket, promotion, reminder. Label "Ticket code" (14px 600 `#4A5A57`), the code in the monospace font, 24px, 600, letter spacing `0.12em`, `#101C1A`, in a box of `#EEF1F0` with a 1px `#C9D3D0` border, radius 8px, padding `12px 16px`, left aligned, selectable text (not an image). Under it the QR, `width="232" height="232"` (the 464px PNG at half size, like the web), then the hint "Show this code or the QR code at the door." 15px `#4A5A57`. |
| Button | The layout has a button slot (a `<a>` with accent background, white 16px 600 text, radius 8px, height 48px, padding `0 20px`, so at least 44px) but **no kind uses it in this version**: there is no public web address in the API's settings and the outbox row has no event id (open question 2). No link, no `href`, no tracking in any email. |
| Footer | Under the card, on the ground: the "why you got this" line of the kind, then "Times are in UTC." 13px `#4A5A57`, line height 1.5. |
| Phone rule | One `<style>` block: `@media (max-width: 520px)` sets card padding 20px, title 24px, stacks the detail rows and lets the QR scale (`max-width:100%`). Clients that drop `<style>` still show a readable 600px-wide column that shrinks (fluid `width:100%`). |
| Contrast | `#101C1A` on `#FFFFFF` and on `#EEF1F0`; `#4A5A57` on `#FFFFFF` and on `#EEF1F0`; `#0B6E5F` on `#FFFFFF`; `#8C1D18` on `#FFFFFF`. All are brand pairs already used in the web UI and are above 4.5:1. |
| Not used | Emoji, icons, gradients, shadows, background images, dark-mode rules (out of scope as in `brand.md`), the organizer indigo (every email goes to an attendee). |

**Content per kind.** The eyebrow, intro and footer text are fixed strings; the title and the detail values come from the stored row. Labels are exactly the ones in the body text.

| Kind | Stored subject (unchanged) | Title is the subject without | Eyebrow | Intro | Details (from the body) | Ticket block | Footer line |
|---|---|---|---|---|---|---|---|
| `ticket` | `Your ticket for <title>` | `Your ticket for ` | Your ticket | You have a seat. Keep this email: the ticket code below lets you in at the door. | Starts | yes | You got this email because you registered for this event. |
| `promotion` | `You have a seat at <title>` | `You have a seat at ` | Seat confirmed | A seat became free and it is yours. The ticket code below lets you in at the door. | Starts | yes | You got this email because a seat became free and you were first on the waiting list. |
| `reminder` | `Reminder: <title> starts soon` | `Reminder: ` and ` starts soon` | Reminder | The event starts within a day. Your ticket code is below. | Starts | yes | You got this email because you have a seat at this event. |
| `reschedule` | `Rescheduled: <title>` | `Rescheduled: ` | New time | The start time changed. Your registration stays as it is. | New start, Previous start | no | You got this email because you are registered or on the waiting list for this event. |
| `event_cancelled` | `Cancelled: <title>` | `Cancelled: ` | Cancelled | The event has been cancelled. Your registration is cancelled too, and you do not need to do anything. | Was to start | no | You got this email because you were registered or on the waiting list for this event. |

Parsing rule: from the second line of the body on, a line is a detail when it starts with one of `Starts`, `New start`, `Previous start`, `Was to start` or `Ticket code` (the last only for the three ticket kinds), followed by `: `; the rest of the line is the value, shown as stored (the ticket email's `Starts:` is an ISO time with milliseconds and the others use `YYYY-MM-DD HH:MM (UTC)`; unifying them is not part of this spec). Other lines are ignored by the html; their words are in the fixed intro (this is why `The event has been cancelled.` and `You have a seat at <title>.` need no line of their own). A reminder is never sent to a checked-in person (ER23), so there is no "already arrived" variant. Times stay in UTC.

**States.** None on a screen. Edge cases (empty body, hostile title, image blocked, no ticket code line) are ET13, ET19, ET6, ET8.

## 3. Architecture decisions

- **Apps:** `api/` only. Two new dependencies, approved by the user (D77): `qr-creator` (same version as `web/package.json`, 1.0.0) and `canvas` (node-canvas, latest stable at install). `web/` is not touched.
- **Files (in `api/src/email/`):** `templates.ts` (pure: `renderEmail`, `escapeHtml`, the layout and the five contents; imports nothing), `qr.ts` (`makeQrPng`, the only file that imports `qr-creator` and `canvas`, both with a lazy `import()`; sets `globalThis.HTMLCanvasElement` to the node-canvas `Canvas` class before `QrCreator.render`, creates a 464 x 464 canvas, returns `canvas.toBuffer('image/png')`), `message.ts` (`buildMessage`: calls `renderEmail`, and for a non-null `ticketCode` calls `qrPng(ticketCode)` and adds the attachment), `transport.ts` (new fields), `sender.ts` (calls `buildMessage`; still no import of `resend`, `canvas` or `qr-creator`).
- **Escaping:** one function, applied by a helper at the point of insertion; the template never concatenates a raw value. Plain template strings, no template engine, no HTML library, no CSS inliner (styles are written inline by hand).
- **Where the PNG is made: at send time, not stored (recommended, open question 3).** Storing a PNG in the outbox would need a bytea column and a migration, and the writers would have to draw it, for a 2 KB image that is a pure function of the ticket code. At send time it is made once per try. A node-canvas PNG for the same input and the same installed version is byte-identical (ET16), so a repeat of a row has the same payload (ER10, ER12). Across a deploy that changes the `canvas` version inside 24 hours the same 409 case as for the template applies (a failed try, retried later).
- **Delivery of the image:** an inline attachment with a content id, not a `data:` URI (blocked by many clients) and not a hosted image (no public URL, no external resources, ET10). The attachment is named `ticket-qr.png`, `image/png`, `contentId: 'ticket-qr'`. The ticket code stays visible as text in html and text (ET19), so a client that blocks or drops the image loses nothing but the scan convenience.
- **Verify at install** (the code-writer does this right after `npm install qr-creator canvas`, before writing ET14-ET23, and notes it in the session file): (1) `resend` 6.34.1 types: that `emails.send` accepts `attachments` with `filename`, `content` (Buffer or string), `contentType` and `contentId` (if the SDK names the field differently, for example `content_id`, `ResendClient` and ET23 follow the types; nothing else changes); (2) that the shim `globalThis.HTMLCanvasElement = Canvas` is enough for `QrCreator.render` to draw on a node-canvas canvas (if the import form needs `default`, the import line adapts); (3) **node-canvas on Windows is the install risk**: `canvas` ships prebuilt binaries for common Node versions and platforms; if there is none for this Node version, npm compiles it, which needs Cairo and other native tools and often fails on Windows. The code-writer runs `npm install` and **reports if the native build fails**, without switching library or adding a workaround on its own; the user then decides (open question 4).
- **Sender change (the rows of `email-reminders.md` that change):** ER4 (the transport call), ER9, ER10 and ER39 (below). The claim SQL, the transaction, the retry and every other ER row stay as they are.
- **Rows of `email-reminders.md` edited in place** (each with a short note "changed by `email-templates.md` ET..."):

| ER row | Change |
|---|---|
| ER4 | The transport call is `transport({ ...buildMessage(row), idempotencyKey: <row id> })`; the message has `to`, `subject`, `text` (the stored body plus the footer), `html` and, for the three ticket kinds, `attachments` (ET22). The sender test that expected `text: r.body` changes. |
| ER9 | Still no code per kind in the sender; `buildMessage` (`message.ts`, with `renderEmail` in `templates.ts`) has the per-kind content. |
| ER10 | The sent message is a pure function of the stored row (`kind`, `subject`, `body`); a repeat try has the same text, html and image. |
| ER19 | Not changed (the stored body keeps the same text); a note says the html is made from it. |
| ER39 | `EmailTransport` message gets `html: string` and `attachments?`; the fake client receives `{ from, to: [to], subject, text, html }` and `attachments` only when given. The transport test that expects exactly `{ from, to, subject, text }` changes. |
| ER40 | The "does not contain" list adds the html and the attachment content. |
| ER51 | The route never returns `html`, `attachments` or the PNG either. |
| ER68, ER75 | Not changed; the notes say the html of these two has no ticket code and no image. |
| "Not in this spec" | "HTML emails (the email is plain `text`)" is removed; the line now says HTML emails and the QR are in `email-templates.md`, and still lists unsubscribe links, tracking and a hosted image as not done. |
| Section 4 and 5 | "The only new package is `resend`" becomes "`resend`, and `qr-creator` and `canvas` (D77, `email-templates.md`)". |

- **Tests that change:** `api/test/email/sender.test.ts` (the `toHaveBeenCalledWith({ to, subject, text: r.body, idempotencyKey })` check at ER4: now `text` starts with the body, `html` is a string, the key is the same), `api/test/email/transport.test.ts` (the payload check at ER39: now has `html`, and a test for `attachments`), and the existing ER51 route test (two more keys that must be absent). **Tests that must pass unchanged:** the ticket, reminder, reschedule and cancel tests on `body` (R3, ER19, ER68, ER75, `reschedule.test.ts`, `cancel.test.ts`), the outbox status tests, and every race test.
- **Not changed:** the five outbox writers, `DATABASE.md` tables, migrations `001`-`004`, `api/openapi.yaml`, `web/`.
- **Idempotency note:** Resend compares the whole payload for one key, so the attachment is part of it. The PNG is byte-identical for one code (ET16), so a repeat of the same row inside 24 hours is answered with the original result.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/email/templates.test.ts` | **Tests first (red):** ET1, ET2, ET4, ET5, ET6, ET7, ET8, ET9, ET10 with plain objects (all five kinds; a loop for ET9 and ET10), then ET3, ET11, ET12, ET13. | ET1-ET13 |
| `api/test/email/qr.test.ts` | **Tests first (red):** ET14, ET15, ET16 with the real `canvas` (PNG signature, IHDR size, corner and finder pixels via `loadImage`, equal bytes for equal code), then ET17 (with the module mocked to fail to load). | ET14-ET17 |
| `api/test/email/message.test.ts` | **Tests first (red):** ET18, ET20, ET21 (fake `qrPng` that records or rejects), then ET19. | ET18-ET21 |
| `api/test/email/sender.test.ts` | Change the ER4 expectation (ET22); add the repeat-try deep-equal check and the privacy check (ET24); add the QR-failure case with a rejecting `qrPng` (ET20, if the sender takes the option) | ET20, ET22, ET24 |
| `api/test/email/transport.test.ts` | Change the payload expectation; add `html`, `attachments` present and absent | ET23 |
| existing ER51 test (`api/test/email/registrationEmails.test.ts` if built, and `outbox.test.ts`) | Add `html` and `attachments` to the keys that must not appear | ET24 |
| `api/src/email/templates.ts` | `renderEmail`, `escapeHtml`, layout, five contents | ET1-ET13 |
| `api/src/email/qr.ts` | `makeQrPng` | ET14-ET17 |
| `api/src/email/message.ts` | `buildMessage(row, qrPng?)` | ET18-ET21 |
| `api/src/email/transport.ts` | `EmailMessage` gets `html` and `attachments?`; `ResendClient` payload type gets them; the `emails.send` call builds the payload from the message | ET23 |
| `api/src/email/sender.ts` | Call `buildMessage(row, options.qrPng)` instead of passing `row.body`; `SendOptions.qrPng?` (optional, for tests); failure path unchanged | ET20, ET22 |
| `api/package.json`, `api/package-lock.json` | Add `qr-creator` (same version as the web) and `canvas` to `dependencies` (own commit: `build(api): add qr-creator and canvas`, D77) | D77 |
| `api/scripts/preview-emails.ts` and the npm script `"email:preview": "tsx scripts/preview-emails.ts"` | The preview of ET26: sample rows of the five kinds, writes the files into the folder given as the argument, exits with a message if there is no argument. No test | ET26 |
| `docs/specs/email-reminders.md` | Rows listed in section 3 (done by the spec step, notes point here) | ER4, ER9, ER10, ER39, ER40, ER51 |
| `docs/DATABASE.md` | (Code-writer, step 34b.) In the `outbox` section: `body` is the plain-text part of the email; the html and the QR are built from the row when it is sent, nothing else is stored | ET25 |
| `README.md`, `ROADMAP.md` | Env and commands unchanged; add `npm run email:preview`, the two new packages, the node-canvas install note, and what "Project status" says about HTML emails. Mark step 34b when done | |

Order of work: spec (34a, this file); `npm install qr-creator canvas` as its own commit and the "Verify at install" notes; tests red (templates, qr, message, then sender and transport changes); code (`templates.ts`, `qr.ts`, `message.ts`, `transport.ts`, `sender.ts`); the preview script; the design boards on the canvas are added after the spec and checked with the preview; `docs/DATABASE.md`, README, ROADMAP.

## 5. Done means

- Tests, typecheck and linter pass in `api/` (`bash scripts/verify.sh`).
- Every ET behaviour has a test, or a README note (ET11 viewport and ET26 are partly by hand). The tests marked "yes" are committed before the code and shown failing for the right reason.
- All five kinds render through `renderEmail`; the sender sends `text` and `html` (and the QR for the three ticket kinds); the stored subjects and bodies are unchanged and their old tests pass without edits (ET25).
- No migration is in the diff; the only new packages in `api/package.json` are `qr-creator` and `canvas` (D77).
- A search of `api/src` finds `qr-creator` and `canvas` imported only in `qr.ts`, and `resend` only in `transport.ts`.
- By hand, once, noted in the README: `npm run email:preview -- <folder>`, open the five files in a browser and compare them to the design boards on the canvas (desktop and phone width); one real delivery to the Resend account owner's address shows the QR in the mailbox and the scan result of the QR is the ticket code (a phone camera is enough).
- The tests never send real email and the whole `api` test run passes with only `DATABASE_URL` in the environment.

## 6. Open questions

Each has a recommendation; if you do not answer, the recommendation is used.

1. **Render at send time or store the html (migration 005).** **Recommended: render at send time** (section 1 table). Only a deploy of new template code between two tries of the same row inside 24 hours can cause a provider `409`, which is one failed try. If you want the html fixed at write time, say so: the reminder, reschedule and cancel statements would have to stop being single SQL statements.
2. **Links and a button.** No email has a link or button now: the API has no public web address setting and the outbox row has no event id. **Recommended: leave it** (the ticket code and the QR are what the person needs). Later option: an `APP_URL` setting plus an event id in the stored row; then one slot already exists in the layout.
3. **Where the PNG is made.** **Recommended: at send time** (section 3). The alternative (a stored bytea) costs a migration for a 2 KB value.
4. **node-canvas on Windows.** If `npm install canvas` has no prebuilt binary and the native build fails, **recommended:** stop and ask; do not swap the library on your own. The lazy `import()` in `qr.ts` means the rest of the API and its tests still run without it.
5. **QR failure.** **Recommended: a failed try** (ET20), so the payload never changes between tries; the ticket code is in the email text either way, but a silent downgrade hides a broken install. Alternative: send without the image and log a warning.
6. **Two date formats.** The ticket email says `Starts: 2030-01-01T10:00:00.000Z (UTC)`; the others say `2030-01-01 10:00 (UTC)`. **Recommended: leave them as stored** in this step (changing the ticket text would touch `registration.md` R3 and its tests). A later small step can unify them.
7. **Promotion wording is not built yet** (`cancel-registration.md`). The template assumes the recommended subject `You have a seat at <title>` and a body with `Starts:` and `Ticket code:` lines. **Recommended: keep**; if that step uses other words, ET2 and the title rule of the promotion row change first.
