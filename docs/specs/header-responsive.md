# Spec: header usability and phone layout (web)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). Request: "fix the header: improve usability and add a responsive layout for mobile view". Frontend only: no API change, no new library, no new route, no new screen. It changes `web/src/auth/Header.tsx`, the header CSS in `web/src/styles.css` and `web/src/auth/Header.test.tsx`. The baseline is the header AFTER `header-events-link.md` (D64) is built: the logo links to `/` for everyone and there is no "Watch all events" button. Kept as they are: D63 (Log out has the link look), D64 (logo `/`, `aria-current` on `/`), W-E22 (organizer look and icon), W-R14 (one account link per role), W-A18 (logged-out links, role switch), W-A9 (log out), RE1 in `role-eyebrow.md` (no role words in page content; the header is not content). Style values are `docs/brand.md`. Ids are HR1, HR2, ...

## 0. Problems found in the code

Checked in `Header.tsx` and `styles.css` (header rules at lines ~53-132, Log out look ~395-431, one phone rule `@media (max-width: 520px)` at ~915).

| # | Problem | Where |
|---|---|---|
| P1 | The wrap order is not defined. `.site-account` is a flex row with `flex-wrap` and five loose children (nav, name, role, Log out, error). On a narrow screen the role label can end up alone on a line, away from the name, and Log out can sit alone. | `.site-account`, `Account` |
| P2 | Name and role are not grouped. They are two separate `span`s with a 16 px gap, the same gap as between the link and the button. | `Account` |
| P3 | A long name is not handled. `.account-name` has no `min-width: 0`, no ellipsis, no `nowrap`. A name with spaces wraps to many lines and makes the header tall. A long word (or an email-like name) cannot shrink and pushes the page wider than the screen at 320 px. | `.account-name` |
| P4 | A non-interactive name looks like a link. `.account-name` is 15 px / 600, the same as the nav links and Log out. Nothing separates "where I can go" from "who I am". | `.account-name`, `.site-nav a` |
| P5 | The phone has the desktop padding `8px 40px`. At 320 px that leaves 240 px for content; at 360 px, 280 px. There is no phone padding rule. | `.site-header` |
| P6 | The only phone rule is `.site-header-end { flex-basis: 100% }`: the group drops below the logo and then wraps freely (P1). There is no defined phone layout. | `@media (max-width: 520px)` |
| P7 | The nav link hover colour is fixed to teal: `.site-nav a:hover` uses `--accent-attendee`, while Log out hover uses `--accent`. In the organizer look "My events" turns teal and Log out turns indigo (W-E22 says the accent follows the role). | `.site-nav a:hover` |
| P8 | The log-out error (`p.field-error`, `role="alert"`) is a flex item in the same wrapping row. It lands next to Log out or below the name, depending on the width. | `Account` |

Checked and fine (not changed): links and Log out are at least 44 px high; one `banner`; `Main` / `Account` navs are labelled; the focus ring (`a:focus-visible`, `.button-secondary:focus-visible`, 2 px accent) exists for the logo, the links and Log out; the tab order is the DOM order (logo, links, Log out). The header is not sticky (it scrolls away); see the open questions.

## 1. Goals and expected behaviour

**Goal.** The header is easy to scan and to use on a desktop and on a phone (320 to 520 px wide). Navigation, the account info (name and role) and Log out are visibly separate parts, always in the same order, and nothing overflows. No new features: the same links and the same texts as today.

**Behaviours.** Each line is checked with a component test in `web/src/auth/Header.test.tsx` (`fetch` mocked), or by hand when it needs layout (jsdom has no layout, as HB10 in `header-events-link.md`). "Test first" ones get the test before the code.

| # | Behaviour | Test first? |
|---|---|---|
| HR1 | Logged in: inside the `Main` account block the DOM order is: the nav link ("My events" or "My registrations"), then one element `.account-info`, then the Log out button. The Tab order stays: logo, nav link, Log out (the visual order on a phone follows the DOM order; no CSS `order`). | yes |
| HR2 | The name and the role label are the only children of `.account-info` (same parent, name first). Their texts do not change ("Organizer" / "Attendee", the person's name). The role label is not a link and not a button. | yes |
| HR3 | The name element has `title` equal to the full name (so a name cut by the layout can still be read). Its text content is the full name, never cut in code. | yes |
| HR4 | The log-out error (`Could not log out. Try again.`, `role="alert"`) is still shown after a failed log out, after the Log out button in the DOM, and outside `.account-info`. "Logging out..." and the disabled state while pending (W-A12) are unchanged. | yes |
| HR5 | Logged out: `nav[aria-label=Account]` has exactly `Log in`, `Sign up`, then `For organizers` (or `For attendees` on `/organizer` pages), in that order; there is no `.account-info`. While `me` is pending: no account links (W-A18). Unchanged. | |
| HR6 | No menu button: with any `me` state the header has no `<button>` except Log out (logged in), and no element with `aria-expanded`. The logo link (`/`, HB1-HB5), landmarks (one `banner`, one nav: `Main` when logged in, `Account` when logged out), icon and role look (W-E22) are unchanged; the existing HB, W-A18, W-R14, W-E22, W-A9 and RE1 tests stay green. | yes |
| HR7 | Phone layout (up to 520 px): padding `8px 16px`; the rows are, in order, the logo; the nav links; then the name and role on the left with Log out on the right of the same row. Logged out: the logo, then the three links in one row. No horizontal scroll at 320 px. Checked by hand (canvas boards and the real page). | |
| HR8 | Long name (checked by hand at 320 px and desktop): the name stays on one line and ends with an ellipsis; the role label and Log out are never cut; no horizontal scroll. Tested with a name of 80 characters, and with one long word of 40 characters. | |
| HR9 | Desktop layout (over 520 px), checked by hand: one row, padding `8px 40px` as now; logo left; right group: nav link, a 1 px `--border` vertical divider, then name and role, then Log out. Logged out: the three links in one row, no divider. | |
| HR10 | Looks, checked by hand: the name is `--text` 15 px weight 400 (not 600), so it does not look like a link; the role label is as today; the nav link hover colour is the role accent (`--accent`) in both looks (indigo for the organizer), the same as Log out hover. Touch targets: logo, nav links and Log out are at least 44 px high at phone width. The focus ring is visible on the logo, every link and Log out. | |

**Out of scope.** A "Menu" button, hamburger or any disclosure; a sticky or fixed header; new links, new text or new icons; a user menu with the name as a button; avatar; notifications; changing the logo, `/` or `/organizer`; the text of "My events" / "My registrations"; translations; dark theme; changing other screens or the 520 px rule of other components.

**Assumptions.** Change any of these first in this file.
- **Phone option (recommended): always-visible rows with a fixed order, no JS.** Compared:
  - **A. Visible rows with a defined order (chosen).** Logo row, nav row, account row (name, role, Log out). All actions are one tap away; no state, no focus handling, nothing new to test beyond the DOM. Height on a phone is about 3 x 44 px plus padding, which is acceptable because the header has at most 4 items.
  - **B. A "Menu" button (`aria-expanded`) that opens the nav and the account block.** Closed header is one row (about 60 px), but Log out and the nav link take 2 taps, and it needs open/close state, Escape, focus return and closing on navigation. This is a new control for 3 to 4 items; it adds more to maintain than it saves. Not chosen; can be added later (the DOM of A is already the right content for it).
  - **C. Keep today's free wrap and only fix padding and long names.** Smallest change but P1, P2 and P8 stay (wrap order is left to the width).
- The breakpoint is the existing `max-width: 520px`, the same as the other phone rules in `styles.css`. At 521 px and above the desktop layout applies. The width at which one row stops fitting on desktop (a very long name at about 600 px) is handled by the ellipsis (HR8), not by another breakpoint.
- The row order on the phone is the DOM order; no CSS `order`, so the visual order equals the Tab order (HR1).
- The name is not a link and not a button (no profile page exists). The name gets weight 400; the role label keeps its look.
- The divider is decorative (CSS border), not an element, and has no role.
- The header is not sticky.
- The text is English only, as the rest of the app.

## 2. UI decisions

| Part | Decision |
|---|---|
| Logo | Unchanged (D64): left, icon and "Event Registration". |
| Right group | `div.site-header-end` stays the wrapper. Desktop: flex row, gap `8px 16px`, vertically centred. Phone: full width, column of rows (see below). |
| Nav link | `nav[aria-label=Main]` with the one link, as today. Hover colour `--accent`. |
| Account info | New `div.account-info`: the name (15 px, 400, `--text`, one line, ellipsis, `min-width: 0`, `title`) and the role label (as today, `white-space: nowrap`). Inline flex, gap 8 px. |
| Divider | Desktop only, logged in: 1 px `--border` line (28 px high) between the nav and the account info. |
| Log out | Link look (D63), unchanged. `white-space: nowrap`. Phone: pushed to the right of the account row (`margin-left: auto`). |
| Log-out error | Own full-width row below the account row (`flex-basis: 100%`), 14 px error colour as `.field-error`. |
| Logged-out links | One row (`gap 4px 20px`, wraps only if it must). No divider. |
| Phone (up to 520 px) | Padding `8px 16px`. Rows: (1) logo; (2) nav link(s); (3) `.account-info` (takes the free width, shrinks, name ellipsis) and Log out on the right; (4) the error if any. Logged out: (1) logo, (2) the three links. |
| Desktop | Padding `8px 40px`, one row, logo left, group right. |

**Copy.** No new text and no new `aria-label`.

**States.** Logged out, attendee, organizer (purple), `me` pending (logo only), log out pending, log out failed (HR4), long name (HR8). Each at desktop and 360 px.

## 3. Architecture decisions

- **Apps:** `web/` only. `Header.tsx` (JSX change in `Account`) and `styles.css`. No new dependency, no new state, no `useState` for the header.
- **Markup:** in `Account`, wrap the name and role in `<div className="account-info">` and add `title={me.name}` on the name `span`. Nothing else moves. The error `p` stays after the button.
- **CSS:** add `.account-info`, the desktop divider (`.site-nav + .account-info`, `border-left`), and one block inside `@media (max-width: 520px)` for `.site-header` padding, `.site-header-end` and `.site-account` as a column, `.account-info` row with Log out. Change `.account-name` to weight 400 with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`. Change `.site-nav a:hover` to `var(--accent)`. Fix the comment of `.site-header-end` ("Watch all events" is gone). Reuse the existing rules for the 44 px height and the focus ring; do not add new colours.
- **Accessibility:** landmarks, labels, DOM and Tab order unchanged (HR1, HR6). No ARIA added.
- **Layout is not testable in jsdom:** HR7 to HR10 are checked by hand; HR1 to HR6 are DOM tests.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/auth/Header.test.tsx` | Tests first: HR1 (DOM order and Tab order, attendee and organizer), HR2 (`.account-info` children), HR3 (`title` and full text for an 80-character name), HR4 (error after the button, outside `.account-info`; pending text), HR6 (no other button, no `aria-expanded`, landmarks). Then HR5 (logged-out links and order). Existing tests stay green | HR1-HR6 |
| `web/src/auth/Header.tsx` | Add `div.account-info` around name and role; `title` on the name | HR1-HR4 |
| `web/src/styles.css` | `.account-info`, `.account-name` (weight 400, ellipsis), desktop divider, phone block in the existing `max-width: 520px` rule, `.site-nav a:hover` colour, comments | HR7-HR10 |
| `docs/brand.md` | Header line in "Layout and shape" (padding on phone, groups, divider, name weight 400); remove "phone view" from "Not decided yet" once the boards exist (separate edit) | HR7-HR10 |
| `docs/specs/header-events-link.md` | HB10 ("the header keeps wrapping as today") and the "Phone" row of section 2 are replaced by HR7 (separate edit) | |
| `README.md`, `ROADMAP.md` | Step and behaviour list for this spec (separate edit by the agent that owns them) | |

Tests follow `auth-web.md` section 4. Existing helpers `ANN`, `OLGA`, `renderApp`, `callsTo`, `deferred`, `json` are enough.

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- HR1 to HR6 have a test; HR7 to HR10 are checked by hand.
- HR1, HR2, HR3, HR4 and HR6 have their tests written and committed before the code.
- All other `Header.test.tsx` and `eyebrow.test.tsx` cases stay green.
- A manual check on the real app at 1280 px, 521 px, 360 px and 320 px, logged out, as attendee and as organizer, with a short name, an 80-character name and a 40-character single word: no horizontal scroll, the row order of HR7, the ellipsis, the organizer hover colour, the focus ring on each item, touch targets of 44 px.

## 6. Canvas boards

New boards on the EXISTING design canvas (https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76); no new artifact. Not drawn yet. Boards: "Header / responsive" with three states (logged out, attendee, organizer in purple) at desktop and at 360 px, plus a 360 px board with a long name and a board with the log-out error. If option B is chosen later (open question 1), add closed and open Menu boards at 360 px.

## 7. Open questions

1. Phone option: A (visible rows, recommended) or B (Menu button)? A is chosen in the Assumptions; B needs HR behaviours for open/close, `aria-expanded`, Escape, focus return and closing on navigation.
2. Make the header sticky? Recommend no: it is not asked for, and it takes screen height on a phone.
3. Name weight 400 and a desktop divider (HR9, HR10)? Recommend yes; they solve P4 without a new colour.
4. One breakpoint (520 px, as the other phone rules)? Recommend yes.
