# Spec: Role word only in the header (UI bug, web)

Bug-fix spec made from `SPEC_TEMPLATE.md` (sections 1-5, short). Found on 18-10 in the events screens: the page said "Organizer" right under the header account block that already said it.

## 1. Goals and expected behaviour

**Goal.** The role of the logged-in person ("Organizer" or "Attendee") is shown once, in the header account block (`events-web.md` W-E22). Page content does not repeat it.

**Behaviours.**

| # | Behaviour | Test first? |
|---|---|---|
| RE1 | Pages for logged-in people have no role eyebrow ("Organizer" or "Attendee") in the page content. This covers the events list (also its loading, error and empty states), the create form, the attendee home `/`, the ticket page, the attendee list and the organizer registrations page. The `h1` is the first line of the card. | yes |
| RE2 | The login and signup forms keep their role eyebrow. The header shows no role for logged-out people, so the eyebrow tells which form it is. | |
| RE3 | The header account block still shows the role (W-E22, W-A18). | |
| RE4 | Eyebrows that are not a role stay: the public event page keeps "Event" (`docs/brand.md`). | |

**Out of scope.** Any other change to the header, the logo or the role look (W-E22); the `.eyebrow` style itself (still used by RE2 and RE4).

**Assumptions.**
- RE2 is my choice, not yet answered by the user: if the login and signup forms should lose the eyebrow too, change RE2 here first.
- A test looks for the words "Organizer" and "Attendee" inside `main`, so the header (outside `main`) does not count.

## 2. UI decisions

| Screen | Change |
|---|---|
| `/organizer` (list, loading, error, empty) | Remove the "Organizer" eyebrow. |
| `/organizer/events/new` | Remove the "Organizer" eyebrow. |
| `/` (attendee home) | Remove the "Attendee" eyebrow. |
| Ticket page, attendee list, organizer registrations (`registration-web.md` S2 to S4) | Built without the eyebrow. |
| Login and signup (both roles) | No change (RE2). |

## 3. Architecture decisions

None. Only the `<p className="eyebrow">` lines are removed; no component, route or style changes.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/events/eyebrow.test.tsx` | Tests first: no role word in `main` on each screen above; the login form still has it; the header still has it. | RE1, RE2, RE3 |
| `web/src/events/EventsList.tsx` | Remove the three "Organizer" eyebrows. | RE1 |
| `web/src/events/CreateEventForm.tsx` | Remove the "Organizer" eyebrow. | RE1 |
| `web/src/App.tsx` | Remove the "Attendee" eyebrow of the home. | RE1 |
| `docs/brand.md`, `docs/specs/registration-web.md` | Point to this spec. | RE1 |

## 5. Done means

- Tests, typecheck and linter pass.
- RE1 has a test written and committed before the code.
