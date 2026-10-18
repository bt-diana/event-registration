# Spec: header logo opens the events list (web)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). Decision D64: there is no separate "Watch all events" button. The header logo is the way to the events list `/`, for logged out people, attendees and organizers. Frontend only: no API change, no new library, no new route. It changes `web/src/auth/Header.tsx` (header rules W-A18, W-R14, W-E22 in `Header.test.tsx`). The list itself is `events-public-list-web.md` (`/`; W-L8, D60: an organizer on `/` stays there and sees the list in the organizer look). No role words in page content: `role-eyebrow.md` RE1 (the header is not content). Style values are `docs/brand.md`. Ids are HB1, HB2, ...

History: D58 and D59 added the "Watch all events" button, D62 gave the organizer logo the target `/organizer`, D63 gave the button and Log out the link look. D64 removes the button and replaces D62 (and the logo part of W-E22); D61 and D63 (for Log out) stay.

## 1. Goals and expected behaviour

**Goal.** From any screen, anyone (logged out, attendee, organizer) opens `/` in one click on the logo. An organizer who clicks it stays on `/` and sees the list in the organizer look (W-L8, D60). Organizers reach their own events `/organizer` with the "My events" link in the header and after login (D61).

**Behaviours.** Each line is checked with a component test in `web/src/auth/Header.test.tsx` (`fetch` mocked). "Test first" ones get the test before the code.

| # | Behaviour | Test first? |
|---|---|---|
| HB1 | The header has exactly one logo link (role `link`, inside the `banner`, named "Event Registration"; the visible "All events" link, `header-responsive.md` HR27 (D73), is a different link and is not a logo), accessible name "Event Registration" (from its text; the icon has `alt=""`; no `aria-label`). It is a `Link`, not a `<button>`, and makes no request of its own. | |
| HB2 | The logo `href` is `/` in every state: logged out, attendee and organizer, on every route. It never depends on `me`. For an organizer it is no longer `/organizer`. | yes |
| HB3 | The logo is shown at once with `href` `/`, also while `me` is pending, and stays the same element with the same `href` after `me` answers 200 (attendee or organizer), 401, a network error or 5xx. | yes |
| HB4 | No "Watch all events" text anywhere: no link, no button, no `aria-label`, no title, on any route and in any state. The logo is still the one logo link; "All events" (a different text, D68, D73, `header-responsive.md` HR27) is a second link to `/`, visible in the header at every width (in the phone drawer and, above 640 px, in the row). | yes |
| HB5 | Current page: when the pathname is exactly `/`, the logo has `aria-current="page"` (no visual change); elsewhere it has no `aria-current`. `/event/1`, `/organizer` and `/organizer/events/new` do not count (exact match). Query string and hash are ignored. Holds for an organizer on `/` too. | yes |
| HB6 | Clicking the logo from another screen goes to `/` (location changes; `GET /auth/me` count stays 1), for an organizer too: the location stays `/`, no redirect. Clicking it on `/` stays on the page and makes no request. | |
| HB7 | An organizer who clicks the logo from `/organizer` stays on `/` and sees "Loading..." until `me`, then the public list in the organizer look, with one `GET /public/events` request (W-L8). The "My events" link (`href` `/organizer`) is still in the Main nav and opens `/organizer`. | |
| HB8 | Look kept: the organizer logo and tab icon are `/icon-organizer.svg` for a logged-in organizer on every screen (W-E22), `/icon-attendee.svg` for everyone else; the account block shows "Organizer" / "Attendee"; account links per role (W-R14), `Log in` / `Sign up` / role switch (W-A18) and Log out (W-A9) work as before. Only the logo `href` changed. | |
| HB9 | Log out keeps the link look (D63): no border or background, `--text`, 15 px semibold, 44 px high, underline on hover. Tab order (DOM order, `header-responsive.md` HR1, D69): logo, Menu, then in the drawer Close menu, "All events", the account links (`Log in`, `Sign up`, role switch; or "My events" / "My registrations"), then Log out. Over 640 px Menu and Close menu are not displayed, so Tab goes logo, "All events", account links, Log out (D73). Enter on the logo opens `/`; visible focus ring (the existing `a:focus-visible`). | |
| HB10 | Replaced by `header-responsive.md` HR18 (phone layout with the Menu button, D66; was HR7, D65). | |

**Out of scope.** A separate events button (the "All events" link of `header-responsive.md` is a link with the nav link look, not a button) or any other new header element; subscribing, notifications or email for new events; counters or badges; a dropdown or menu; changing the `/` or `/organizer` pages; changing "My events" / "My registrations"; translations; dark theme; new icons.

**Assumptions.** Change any of these first in this file.
- The logo target is `/` for everyone (D64). An organizer on `/` is not sent to `/organizer` (D60, W-L8): the page waits for `me` ("Loading..." only), then shows the public list in the organizer look.
- After login the organizer opens `/organizer` (D61; `HOME` in `web/src/auth/guards.tsx`, W-A5/W-A7 in `auth-web.md`). Unchanged.
- The organizer's way to `/organizer` from other screens is the "My events" link (built in `Header.tsx`, `REGISTRATIONS_LINK`). The text of W-R14 in `registration-web.md` still says "Registrations" to `/registrations`; that row owns the header account link and is out of date with the built code (see section 7).
- `aria-current` is set on the logo and, since D68, on the "All events" link, only on `/` (exact match). The logo is not the only way to `/` in the row: "All events" is also visible there (D73). The logo still links to `/` for everyone.
- The text is English only, as the rest of the app.

## 2. UI decisions

| Part | Decision |
|---|---|
| Logo | Left side of the header, icon plus text "Event Registration", as built. Same look in all states; only the icon colour follows the organizer look (W-E22). |
| Right group | `div.site-header-end` stays as the wrapper of the account links / `Log in` nav (flex, wrap, gap), now without the button in front. Desktop: one row, logo left, group right. |
| Log out | Link look (D63), unchanged. |
| Current state | `aria-current="page"` on the logo on `/`; no visual change. |
| Phone (up to 640 px, the header width in `styles.css`) | See `header-responsive.md` HR18 (D69, D70): the logo and a Menu button, the rest in a modal drawer from the right. |

**Copy.** No new text. "Watch all events" no longer exists in the app.

**States.** The logo is always visible; no loading or error state of its own.

## 3. Architecture decisions

- **Apps:** `web/` only. `react-router` `Link`, `useLocation` (already in `Header.tsx`).
- **Target:** the constant `/`. No role map and no `useMe` check for the logo `href`. (`me` is still read for the icon and the account block.)
- **Current state:** `aria-current={pathname === "/" ? "page" : undefined}` on the logo `Link`.
- **Remove from built code** (see section 4): the "Watch all events" `Link` and its comment in `Header.tsx`; the CSS class `.button-link-secondary` and its `[aria-current="page"]` rule; its tests.
- **Keep:** `.site-account button.button-secondary` (Log out link look, D63) and `.site-header-end` with its phone rule `flex-basis: 100%`. Rename the CSS comments so they no longer name the button.
- **Landmarks:** unchanged ("Main" for the logged-in account, "Account" for logged out).

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/auth/Header.test.tsx` | Tests first: HB2 (logo `href` `/` in three states, on `/` and `/event/1`), HB3 (same element while pending and after 200, 401, 5xx, network error), HB4 (no "Watch all events" anywhere), HB5 (logo `aria-current` exact match). Then HB1, HB6, HB7, HB9 (Tab order). Change the W-E22 organizer case (`logo goes to /organizer`) to `/`. Delete the `WATCH` helpers and all tests that look for the "Watch all events" link (old HB1-HB9 describes), and the `/organizer` logo `href` check in the organizer-list test | HB1-HB9 |
| `web/src/auth/Header.tsx` | Logo `to="/"` with `aria-current`; remove the "Watch all events" `Link`; keep the wrapper | HB1-HB9 |
| `web/src/styles.css` | Remove `.button-link-secondary` (3 rules); keep the Log out rules; fix comments of `.site-header-end` | HB9, HB10 |
| `docs/brand.md`, `README.md`, `ROADMAP.md` | Header section, step and behaviour list: remove the button (separate edit by the agent that owns them) | |

Tests follow `auth-web.md` section 4. Existing helpers `ANN`, `OLGA`, `renderApp`, `callsTo`, `deferred`, `json` are enough.

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- Every behaviour HB1 to HB9 has a test; HB10 is replaced by `header-responsive.md` HR7 (checked by hand).
- HB2, HB3, HB4 and HB5 have their tests written and committed before the code.
- All other `Header.test.tsx` and `eyebrow.test.tsx` cases stay green.
- A manual check on the real app, desktop and 360 px: the logo opens `/` when logged out, as attendee and as organizer (the organizer sees "Loading..." only, then the list in the organizer look); "My events" opens `/organizer`; the tab order and focus ring are visible.

## 6. Canvas boards

The earlier boards "Header / Watch all events" (and phone) must be removed from the existing canvas (no new artifact) or redrawn without the button: the three states (logged out, attendee, organizer in purple) at desktop and 360 px, logo normal, hover and focus; not done yet.

## 7. Open questions

1. `aria-current="page"` on the logo on `/` (default, HB5, no visual change), or none?
2. W-R14 in `registration-web.md` says the organizer link is "Registrations" to `/registrations`; the built link is "My events" to `/organizer`. Update W-R14 (and its test list) in a separate edit?
