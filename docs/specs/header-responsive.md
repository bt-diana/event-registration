# Spec: header usability and phone layout (web)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). Request: "fix the header: improve usability and add a responsive layout for mobile view". Frontend only: no API change, no new library, no new route, no new screen. It changes `web/src/auth/Header.tsx`, the header CSS in `web/src/styles.css` and `web/src/auth/Header.test.tsx`. The baseline is the header AFTER `header-events-link.md` (D64): the logo links to `/` for everyone and there is no "Watch all events" button. Kept as they are: D63 (Log out has the link look), D64 (logo `/`, `aria-current` on `/`), W-E22 (organizer look and icon), W-R14 (one account link per role), W-A18 (logged-out links, role switch), W-A9 (log out), RE1 in `role-eyebrow.md` (no role words in page content; the header is not content). Style values are `docs/brand.md`. Ids are HR1, HR2, ...

**D66 (this revision).** D65 chose "always-visible rows" for the phone (option A) and it was built (commits c2f18c7, 750228d). The user says the built header "is still not responsive" and wants a burger menu on mobile. D66 makes option B (a "Menu" button with `aria-expanded`, no library) the chosen phone option. D66 replaces D65 for the phone option only. Kept from D65: header not sticky, name weight 400, desktop divider, `.account-info` grouping, ellipsis, nav hover colour `--accent`, the DOM order of the account block.

## 0. Problems found in the code

Checked in `Header.tsx` and `styles.css` (header rules at lines ~53-170, Log out look ~395-460, the phone block `@media (max-width: 520px)` at ~943-998).

Fixed by D65 and still fixed: P1 (wrap order), P2 (name and role grouped), P3 (long name), P4 (name looks like a link), P5 (phone padding), P7 (hover colour), P8 (error row). P6 is reopened:

| # | Problem | Where |
|---|---|---|
| P6 | The phone header is still tall and crowded. With the rows always visible, a logged-in header is 3 rows (logo, nav link, name + role + Log out), a logged-out one is 2 rows (logo, three links). The user does not accept this as responsive. | `@media (max-width: 520px)` |
| P9 | The 520 px breakpoint leaves a gap. The single-row desktop header does not fit between 521 and about 640 px (a logged-in header wraps in an undefined way). | `.site-header`, `.site-header-end` |

Checked and fine (not changed): links and Log out are at least 44 px high; one `banner`; `Main` / `Account` navs are labelled; the focus ring (`a:focus-visible`, `.button-secondary:focus-visible`, 2 px accent) exists for the logo, the links and Log out. The header is not sticky.

## 1. Goals and expected behaviour

**Goal.** On a phone the closed header is one row: the logo and a Menu (burger) button. Everything else (nav link, name and role, Log out; or Log in, Sign up and the role switch) is in a panel that the button opens. On a wider screen the header is the one-row layout of today and the button is not shown. No new features: the same links and texts as today, plus the button.

**Behaviours.** Each line is checked with a component test in `web/src/auth/Header.test.tsx` (`fetch` mocked), or by hand when it needs layout or CSS (jsdom has no layout and does not read `styles.css`; see "How the tests see open and closed" below). "Test first" ones get the test before the code.

How D66 changed the ids (nothing is silently dropped):

| Old id (D65) | Now |
|---|---|
| HR1 | Kept, extended: the Tab order now has the Menu button after the logo. |
| HR2, HR3, HR5 | Kept as they are. |
| HR4 | Kept, extended: the error is in the panel and must stay visible (see HR17). |
| HR6 "no menu button" | **Replaced** by HR6 below (the button now exists). The old test is deleted. |
| HR7 "phone rows" | **Replaced** by HR18 (closed row and open panel). |
| HR8 | Kept. |
| HR9 "desktop over 520 px" | Kept, breakpoint changes to 640 px (see HR19). |
| HR10 | Kept, plus the burger touch target. |
| (new) | HR11-HR17, HR20. |

| # | Behaviour | Test first? |
|---|---|---|
| HR1 | Logged in: inside the `Main` account block the DOM order is: the nav link, then one `.account-info`, then the Log out button (unchanged). The block is inside the panel (HR14). Tab order (DOM order, no `tabindex`): logo, Menu button, nav link, Log out. | yes |
| HR2 | The name and the role label are the only children of `.account-info` (name first). Texts unchanged; the role label is not a link and not a button. | yes |
| HR3 | The name element has `title` equal to the full name; its text is the full name, never cut in code. | yes |
| HR4 | The log-out error (`Could not log out. Try again.`, `role="alert"`) is shown after a failed log out, after the Log out button in the DOM, outside `.account-info`. "Logging out..." and the disabled state while pending (W-A12) are unchanged. | yes |
| HR5 | Logged out: `nav[aria-label=Account]` has exactly `Log in`, `Sign up`, then `For organizers` (or `For attendees` on `/organizer` pages), in that order; no `.account-info`. Unchanged. | |
| HR6 | The burger: exactly one `<button type="button">` with the accessible name `Menu` (an `aria-label`; the icon inside is `aria-hidden`). It is the next element after the logo link in the DOM. It is in the DOM whenever there is something to show: logged in, logged out, or `me` failed (401, 5xx, network error, as the logged-out links today). It is NOT in the DOM while `me` is pending. The name stays `Menu` open and closed. Landmarks unchanged: one `banner`; `Main` (logged in) or `Account` (logged out) nav, now inside the panel. The logo (`/`, HB1-HB5), icon and role look (W-E22) unchanged. | yes |
| HR11 | Closed by default: on first render with a burger, `aria-expanded="false"` and the panel has `data-open="false"`. Same for attendee, organizer, logged out. | yes |
| HR12 | Wiring: the button has `aria-controls` equal to the `id` of the panel; that element exists in the `banner`, the id is unique on the page (React `useId`), and the panel contains the nav (HR14). | yes |
| HR13 | Toggle: a click on Menu sets `aria-expanded="true"` and the panel `data-open="true"`; a second click sets both back to `false`. Several cycles give the same result. | yes |
| HR14 | Panel contents. Logged in: the `Main` nav (the one link of the role, W-R14), `.account-info`, Log out (HR1 order), the error (HR4) when there is one. Logged out: the `Account` nav with the three links (HR5). Outside the panel the header has only the logo and the Menu button. | yes |
| HR15 | Escape: while open, the Escape key (keydown anywhere inside the header, also on a panel link or Log out) closes the panel (`aria-expanded="false"`) and moves focus to the Menu button. While closed, Escape does nothing (focus does not move). | yes |
| HR16 | Closes on navigation: while open, activating a panel link (route change), the logo link, or the browser Back/Forward (any new location `key`) sets `aria-expanded="false"`. It does not close on a re-render without navigation, and does not close when the click is on `.account-info`. | yes |
| HR17 | Log out and the menu: clicking Log out does NOT close the panel (otherwise a failed log out would hide its own error). On failure the panel stays open and the alert is visible. On success the header is rebuilt for the logged-out state and the menu is closed (the menu is keyed on logged in / logged out, so its state starts again at `false`). An organizer is also redirected by the guard (W-A9). Focus after a successful log out is not managed (it falls to the page, as today). | yes |
| HR18 | Phone layout (up to 640 px), checked by hand. Closed: one row, logo on the left, Menu button on the right, header padding `8px 16px`. Open: the panel opens in the page flow (it pushes the page down, no overlay) as a full-width block directly under that row, 1 px `--border` line on top, padding `8px 0` (the 16 px side inset is the header padding). Items are stacked, each at least 44 px high: logged in, the nav link, then a 1 px horizontal `--border` line (the vertical divider is gone), then name + role on the left with Log out on the right of one row (as D65), then the error row; logged out, the three links one under the other. The long name keeps its ellipsis (HR8). No horizontal scroll at 320 px, open or closed. | |
| HR19 | Wider than 640 px, checked by hand: the Menu button is `display: none`; the panel is always shown, whatever `data-open` says, and looks as before D66: one row, padding `8px 40px`, logo left, right group: nav link, 1 px vertical divider, name and role, Log out; logged out the three links in one row. | |
| HR20 | Closed means gone for everyone (checked by hand at 360 px, with a screen reader or the browser accessibility tree and the Tab key): when `data-open="false"` on a phone, the panel is `display: none`, so its links and Log out are not reachable by Tab and not in the accessibility tree. Open: Tab goes logo, Menu, then the panel items in DOM order, then on to the page. | |
| HR8 | Long name (by hand at 320 px and desktop): the name stays on one line with an ellipsis; role label and Log out are never cut; no horizontal scroll. Tested with an 80-character name and with a 40-character single word (also with the panel open). | |
| HR10 | Looks, by hand: the name is `--text` 15 px weight 400; role label as today; nav link hover colour is `--accent` in both looks; touch targets of the logo, Menu button (44 x 44 px), nav links and Log out are at least 44 px high at phone width; the focus ring (2 px accent) is visible on the Menu button and every item. Menu button look: 1 px `--border`, radius 8 px, three-bar icon in `--text`; `aria-expanded="true"` gives the border `--accent`. | |

(HR9 above is covered by HR19; the id HR9 is retired, not reused.)

**How the tests see open and closed.** jsdom does not read `styles.css`, so `display: none` is invisible to it and every item of a closed panel still counts as present and reachable. Therefore tests read state from `aria-expanded` on the button and `data-open` on the panel, never from visibility. This also keeps every existing header and screen test green without opening the menu first. Whether the closed panel is really gone from the screen, the accessibility tree and the Tab order (HR20) and whether the desktop shows everything (HR19) is checked by hand. Not used: the `hidden` attribute (see Assumptions).

**Out of scope.** A sticky or fixed header; an overlay or slide-in drawer; animation; new links, texts or icons beyond the burger icon and its name `Menu`; a user menu with the name as a button; avatar; notifications; changing the logo, `/` or `/organizer`; the text of "My events" / "My registrations"; translations; dark theme; changing other screens or the 520 px rules of other components (the event card).

**Assumptions.** Change any of these first in this file.
- **Phone option (D66): a Menu button.** Chosen over A (always-visible rows, built in D65, replaced for the phone only) and C (free wrap). Cost accepted by the user: Log out and the nav link take two taps, and there is open/close state to test.
- **Burger breakpoint: 640 px, for the header only** (`@media (max-width: 640px)`). The single-row desktop header does not fit between 521 and about 640 px, so keeping 520 px would leave a gap with a wrapped, undefined header (P9). 640 px is already the table scroll limit in `brand.md`. At 641 px and above the desktop layout applies. The old `@media (max-width: 520px)` block keeps only the event-card rules; its header rules (padding, `.site-header-end`, `.site-account`, `.account-info`, divider, Log out) move to the new 640 px block and are reworked for the panel (HR18). The width at which one row stops fitting on desktop for a very long name is still handled by the ellipsis (HR8).
- **No `hidden` attribute.** The panel is always rendered and its state is `data-open`. CSS handles both layouts: above 640 px the panel is shown always; at 640 px and below `[data-open="false"]` is `display: none`. With `hidden`, jsdom would hide the panel from `getByRole`, about 30 existing tests would need to open the menu first, and a desktop override (`[hidden] { display: flex }`) would still be needed. Not worth it.
- The panel is in the page flow (not absolutely positioned), so it needs no click-outside handling and covers nothing.
- The button label is `aria-label="Menu"` on an icon-only button (inline SVG, `aria-hidden`, no library). It is the only new text.
- The menu state is reset on a change of logged in / logged out (key), and closed on a new location key (HR16). It is not stored anywhere else and not kept across reloads.
- Row order inside the panel is the DOM order; no CSS `order`.
- The name is not a link and not a button. The divider is decorative (CSS border) and has no role. The header is not sticky. The text is English only.

## 2. UI decisions

| Part | Decision |
|---|---|
| Logo | Unchanged (D64): left, icon and "Event Registration". |
| Menu button | New `button.nav-toggle`, 44 x 44 px, three-bar inline SVG, only at 640 px and below (`display: none` above). Phone: pushed to the right of the logo row (`margin-left: auto`). Look in HR10. Absent while `me` is pending. |
| Panel | `div.site-header-end` (the existing wrapper) gets the `id` and `data-open`. Above 640 px: today's flex row, gap `8px 16px`. At 640 px and below: `flex-basis: 100%`, column, stacked, `display: none` when `data-open="false"`. |
| Nav link | `nav[aria-label=Main]` with the one link, as today. Phone: full row, 44 px high. Hover `--accent`. |
| Account info | `div.account-info` as D65: name (15 px, 400, `--text`, one line, ellipsis, `title`) and role label. Phone: row of its own, takes the free width, Log out on the right (`margin-left: auto`). |
| Divider | Above 640 px: 1 px `--border` vertical line before the account info (as D65). At 640 px and below: a horizontal 1 px `--border` line above the account info row. |
| Log out | Link look (D63), unchanged, `white-space: nowrap`. |
| Log-out error | Own full-width row below the account row, 14 px error colour (`.field-error`). In the panel, so the panel stays open on failure (HR17). |
| Logged-out links | Above 640 px: one row (`gap 4px 20px`). At 640 px and below: stacked, 44 px each, in the panel. |
| Phone (up to 640 px) | Header padding `8px 16px`. Closed: logo + Menu button. Open: panel under the row (HR18). |
| Desktop | Padding `8px 40px`, one row, logo left, group right, no button. |

**Copy.** One new accessible name: `Menu` (button `aria-label`). No visible new text, no other new label.

**States.** Logged out, attendee, organizer (purple), `me` pending (logo only, no button), log out pending, log out failed (panel open with the error), long name. Each at desktop, and at 360 px closed and open.

## 3. Architecture decisions

- **Apps:** `web/` only. `Header.tsx` and `styles.css`. No new dependency, no library for the menu.
- **State:** one `useState<boolean>` for open, in a small `NavMenu` piece in `Header.tsx` (the file stays one file; a new file only if it grows over about 120 lines). `Header` renders the logo, then `<NavMenu key={me.data ? "in" : "out"}>` with the account content as children, and renders nothing for the menu while `me.isPending`. The `key` resets the state on login and logout (HR17).
- **Markup:** `NavMenu` returns the Menu button (`type="button"`, `aria-label="Menu"`, `aria-expanded={open}`, `aria-controls={panelId}`) and the panel `div.site-header-end` (`id={panelId}`, `data-open={open}`, `data-role` as today). `panelId` comes from `useId()`. The `Account` component and the logged-out `nav` are unchanged and are the panel children.
- **Behaviour code:** toggle on click; `onKeyDown` on the `header` element: if open and key is `Escape`, set false and focus the button (a `ref`); a `useEffect` on `useLocation().key` sets false (use the location `key`, not `pathname`, so a click on the link of the current page also closes). No `hidden`, no `tabindex`, no `aria-hidden`, no focus trap, no click-outside handler, no `matchMedia`.
- **CSS:** `.nav-toggle` (display none by default); one block `@media (max-width: 640px)` with: `.nav-toggle { display: inline-flex }`, header padding, `.site-header-end { flex-basis: 100%; flex-direction: column; align-items: stretch }`, `.site-header-end[data-open="false"] { display: none }`, panel top border and padding, stacked nav links, horizontal divider, account row with Log out on the right. Remove the header rules from the old 520 px block. Reuse the 44 px and focus-ring rules; add no new colours.
- **Accessibility:** the button is a real `<button>` with state in `aria-expanded`; the panel is hidden from sighted users, the accessibility tree and Tab by `display: none` (HR20). Landmarks keep their labels.
- **Layout and CSS are not testable in jsdom:** HR18 to HR20 and HR8, HR10 are by hand; HR1 to HR6 and HR11 to HR17 are DOM tests.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/auth/Header.test.tsx` | Tests first, in one commit before the code. New: HR6 (replaces the old "no menu button" block: button count, name, position after the logo, absent while `me` is pending, present for logged out, 5xx, network error, attendee, organizer), HR11, HR12, HR13, HR14, HR15 (Escape with `fireEvent.keyDown`; focus returns to the button; no focus move while closed), HR16 (panel link click, logo click, `history` Back), HR17 (failed log out keeps the panel open and the alert visible; success closes it). Change: HR1 and the HB9 Tab-order tests (`tabOrder()` and `focusables()` now include the Menu button, textContent empty: use `[LOGO, "", ...]` or read the `aria-label`), HR3 and HR4 get the open panel case. Delete: old HR6 (no `aria-expanded` anywhere). Keep green: all W-A18, W-R14, W-E22, W-A9, HB1-HB8, HR2, HR5 cases (they find items without opening the menu, see "How the tests see open and closed") | HR1-HR6, HR11-HR17 |
| `web/src/auth/Header.tsx` | `NavMenu` (state, ids, Escape, route close), burger button with inline SVG, panel wrapper, `key` | HR1, HR6, HR11-HR17 |
| `web/src/styles.css` | `.nav-toggle`; new `@media (max-width: 640px)` header block; remove header rules from the 520 px block; panel `data-open` rule; comments | HR18-HR20, HR8, HR10 |
| `docs/brand.md` | Header line in "Layout and shape": burger at 640 px and below, panel, 44 px items, horizontal divider; remove "phone view" from "Not decided yet" once the boards exist (separate edit) | HR18-HR20 |
| `docs/specs/header-events-link.md` | HB10 ("the header keeps wrapping as today") and its "Phone" row are replaced by HR18 (separate edit) | |
| `README.md`, `ROADMAP.md` | Step and behaviour list for this spec; D66 (separate edit by the agent that owns them) | |

Tests follow `auth-web.md` section 4. Existing helpers `ANN`, `OLGA`, `renderApp`, `callsTo`, `deferred`, `json` are enough; `renderApp` already exposes the location (`getByTestId("location")`).

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- HR1 to HR6 and HR11 to HR17 have a test; HR8, HR10 and HR18 to HR20 are checked by hand.
- The tests of HR6, HR11 to HR17 and the changed HR1 are written and committed before the code.
- All other `Header.test.tsx` and `eyebrow.test.tsx` cases stay green, with only the Tab-order helpers adjusted for the Menu button.
- A manual check on the real app at 1280 px, 641 px, 640 px, 360 px and 320 px, logged out, as attendee and as organizer, with a short name, an 80-character name and a 40-character single word: at 641 px one row, no button, no wrap; at 640 px and below one row closed and the panel opening under it; no horizontal scroll open or closed; the ellipsis; Escape returns focus to the button; Tab skips the closed panel; a screen reader (or the accessibility tree) does not list the closed panel items; the organizer hover colour; focus ring on each item; touch targets of 44 px; resizing the window from 360 to 1280 px with the panel open or closed shows the full desktop header.

## 6. Canvas boards

New boards on the EXISTING design canvas (https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76); no new artifact. **Limitation:** the canvas cannot be read or edited from this environment (its saved page shows only "Loading..."), so the boards are NOT drawn and must be added by hand. Boards to add:

1. Header / desktop (over 640 px): logged out, attendee, organizer (purple). Already planned in D65.
2. Header / 360 px closed: logged out, attendee, organizer (logo + Menu button).
3. Header / 360 px open: logged out (three links stacked), attendee (nav link, line, name + role + Log out), organizer (purple).
4. Header / 360 px open with a long name, and open with the log-out error.

## 7. Open questions

Answered (now in Assumptions):
- Phone option: B, the Menu button (D66).
- Sticky header: no.
- Name weight 400 and a desktop divider: yes.
- Breakpoint: raised to 640 px for the header only (was 520 px).

New, with a recommendation:
1. Close the panel when the user clicks outside it? Recommend no: the panel is in the page flow, covers nothing, and a second click on Menu or Escape closes it.
2. Keep the panel open after a successful log out? Not possible (the header is rebuilt); the menu closes. Is losing focus to the page after that acceptable? Recommend yes (same as today).
3. Is an icon-only button with `aria-label="Menu"` fine, or should it show the visible word "Menu" next to the icon (a visible new text, a wider button)? Recommend icon only.
4. Hide the closed panel with `display: none` by CSS only (recommended, tests read `data-open`), or with the `hidden` attribute (tests read real visibility but about 30 existing tests must open the menu first)? Recommend CSS only.
