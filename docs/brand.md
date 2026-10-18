# Brand and UI style

Taken from the login and sign-up screens in the design canvas (https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76), made from `specs/auth-web.md`. There was no design system, so this is the first set of values. Four screens exist (attendee login, attendee sign-up, organizer login, wrong account). Change this file first when a value changes, then the code. Use these values for the other web screens too.

## Character

Plain and calm, a tool for forms and lists. One card on a light gray-green ground, large text, big touch targets, no decoration. Each role has its own accent colour, so a person can see which side they are on.

## Colour

| Token | Value | Use |
|---|---|---|
| ground | `#EEF1F0` | Page background |
| surface | `#FFFFFF` | Header, cards, inputs |
| border | `#C9D3D0` | Card and header borders, dividers |
| border-input | `#7C8D89` | Input and secondary button borders |
| text | `#101C1A` | Body text, headings |
| text-muted | `#4A5A57` | Hints, secondary text |
| accent-attendee | `#0B6E5F` | Attendee buttons, eyebrow label, links (hover `#074D43`) |
| accent-organizer | `#3A3AA0` | Organizer buttons, eyebrow label, links (hover `#26267A`) |
| error | `#B3261E` | Invalid input border, error text |
| error-text-on-tint | `#8C1D18` | Text inside the form error box |
| error-tint | `#FDECEA` | Form error box background |

- The logo is `web/public/icon-*.svg` (calendar with a check). It is teal (`icon-attendee.svg`) on attendee pages and indigo (`icon-organizer.svg`) on `/organizer` pages. The same file is the tab icon and changes with the page.
- White text goes only on an accent button. Error is never shown by colour alone: it also has text, a 2px border and `aria-invalid`.

## Typography

| Role | Font | Size and weight |
|---|---|---|
| Page title (h1) | Bricolage Grotesque | 34px, 700, line height 1.1 (30px on message pages) |
| Logo text | Bricolage Grotesque | 20px, 700 |
| Body, inputs, buttons | Public Sans | 16px; buttons 600 |
| Label | Public Sans | 14px, 600 |
| Eyebrow (role name) | Public Sans | 13px, 600, uppercase, letter spacing 0.08em, accent colour |
| Hint, links, nav | Public Sans | 15px (nav and links 600) |
| Field error | Public Sans | 14px, error colour |
| Ticket code | `ui-monospace, Menlo, monospace` | 600, letter spacing 0.12em; 30px on the ticket page (24px up to 520px), 20px in the event page panel, 24px in the scan result, 18px in the typed-code field (`design-alignment.md` DA10) |

Both from Google Fonts. Fallback: `system-ui, sans-serif`.

## Layout and shape

- Page: header on top, then the content centred, padding `64px 16px` (`16px` on all sides up to 520px, D71). Only a fluid width, so it works at phone width.
- Phone (up to 520px, `design-alignment.md` section 2): `h1` 30px, card padding 20px, 12px between event cards, buttons in a card full width, only tables scroll sideways.
- Header (`specs/header-responsive.md`, D65-D70): white, 1px bottom border, padding `8px 40px` (`8px 16px` up to 640px), not sticky. The logo links to `/`. Logged out: Log in, Sign up, For organizers (For attendees on `/organizer` pages). Logged in, three groups in this order: the nav link ("My events" / "My registrations"), the account info (name 15px 400 `text`, one line with an ellipsis, then the role label), Log out (link look). Over 640px: one row, no menu button, no drawer, no "All events", a 1px `border` divider 28px high between the nav link and the account info. Up to 640px: one row with the logo and a Menu button on the right (44 x 44px, no border, three-bar icon in `text`, `aria-label="Menu"`). The button, or a click on the header row, opens a modal drawer the full width of the page under the header row, which stays visible (user requests after D70): fixed, `surface`, padding `8px 16px`, revealed downward from the header over 200ms (no animation with reduced motion), over a backdrop of `text` at 40%. Items stacked, each at least 44px high: the Close menu button (44 x 44px, no border, X icon in `text`), first in the Tab order but shown in the header row in place of the Menu button, then "All events", the nav link, a 1px `border` horizontal line, the account info left and Log out right; logged out, the three links one under the other. The log-out error is its own row below. Nav link and Log out hover in the role accent.
- Card: white, 1px border, radius 12px, padding 32px, max width 440px (520px for message pages).
- Spacing: 20px between fields, 24px between the intro and the form, 8px between label and input groups.
- Radius: 8px for inputs and buttons, 12px for cards.

## Components

- **Input:** 48px high, 1px `border-input`, radius 8, 16px text, a visible `<label>` above it. Invalid: 2px `error` border, `aria-invalid="true"`, error text below with `role="alert"` linked by `aria-describedby`.
- **Password field:** input plus a "Show"/"Hide" button (48px high, `aria-pressed`) in a row with an 8px gap.
- **Primary button:** 48px high, full width in a form, accent background, white 16px 600 text, radius 8. Disabled and relabelled while a request is pending (`auth-web.md` W-A12).
- **Secondary button:** same size, white background, 1px `border-input`, dark text.
- **Form error box:** above the form, padding `12px 14px`, `error-tint` background, 1px `error` border, radius 8, `role="alert"`.
- **Error box** (screens: load errors, camera problems, scan refusals, registration errors; `design-alignment.md` section 3): padding `10px 12px`, `error-tint` background, 2px `error` border, radius 8, `error-text-on-tint` text. Retry next to it is the secondary button.
- **Links:** accent colour, 600 when they are actions ("Sign up", "I organize events"). The switch to the other role is a link under a divider.
- **Eyebrow:** the role name ("Attendee", "Organizer") above the title in the role accent, only on the login and sign-up forms. Pages for logged-in people have no role eyebrow; the role is in the header (`role-eyebrow.md` RE1) and the `h1` is the first line. The public event page uses "Event". "Wrong account" uses the dark error colour.

## Rules

- Touch targets are at least 44px (48px for fields and buttons).
- Real `<button>`, `<a>` and `<input>` with `<label>`. No emoji, no icons without a text label.
- Text contrast at least 4.5:1. Check every new colour pair before adding it.
- Copy is short and plain; error texts are in `specs/auth-web.md`.

## Event screens (added from `specs/events-web.md`)

Status badge colours are approved (user, 18-10). Pill, radius 999px, padding `2px 10px`, 14px 600. The status is always text, never colour alone.

| Badge | Text | Background |
|---|---|---|
| Active, Open | `#074D43` | `#DDF0EA` |
| Full | `#6B4200` | `#FFF1D6` |
| Cancelled | `#8C1D18` | `#FDECEA` |
| Ended, Already started | `#3A4A47` | `#E4E8E7` |

Table (events list): white card with 1px border and radius 12, header cells 14px 600 `text-muted`, rows 16px with a 1px `border` line, scrolls sideways under 640px. Event details are a `dl` grid (label 14px 600 `text-muted`, value 16px). Wide cards: 520px (create form), 640px (event pages), 960px (list). The organizer pages use `accent-organizer`, the public page `accent-attendee`.

- **Textarea** (description): like the input, but `padding 12px 14px`, 5 rows, resizes vertically. Field order inside a field: label, input, error, hint.
- **Button link** ("Create event" on the list): a link with the primary button look, 48px high, padding `0 20px`.
- **Back link** ("Back to events"): a 15px 600 accent link with a left arrow, at least 44px high.
- **Event page:** the badge under the `h1` (12px above, 24px below), then the description (plain text, `white-space: pre-wrap`), then the details `dl`. A closed public event shows "Capacity: N" and "Registration is closed." (15px `text-muted`) under the `dl`. The organizer view ends with the share link line: 15px `text-muted`, under a 1px `border` divider.

## Arrivals counter (added from `specs/checkin-web.md`)

- **Counter** (scan screen and registrations page, under the event selector): a white card, 1px `border`, radius 12, padding `12px 16px`, full width of the screen card. 16px: "Arrived:" in `text-muted`, then the two numbers and "registered" in the text colour at 600. "Capacity: N" on a second line, 14px `text-muted`. "Everyone has arrived." 15px under it. "Could not refresh" 14px `text-muted`. Loading and first-load error are plain 15px text, Retry is the secondary button (48px). No live region, no new colour.
- **Arrival column** (organizer list): "Arrived" with the time under it (14px 600, like the "Checked in" note), "Not yet", or empty for the waiting list.
- **List note:** "Could not refresh" above the table, 14px `text-muted`.

## Not decided yet

- Dark theme (out of scope in `auth-web.md`).
- The design canvas is still missing organizer sign-up, the loading and error states board, and phone boards for every page except the public list and the scan screen (the phone values above are derived, `design-alignment.md` question 11).
