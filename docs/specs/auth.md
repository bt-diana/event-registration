# Spec: Accounts and login (M1)

Feature spec for milestone M1, made from `SPEC_TEMPLATE.md` (sections 1-5). The tables `users` and `organizers` are in `DATABASE.md`; this file does not change them. Decisions used: `DATABASE.md` 8, 9, 10, 12, 16.

**Changed after the first version** (for the web app, `auth-web.md`): `GET /auth/me` (A17, A18) is the only "me" route, and `role` is in the sign-up, login and "me" answers (A4, A8, A17). The role-specific `GET /auth/<role>/me` was removed (A11, A19). The ids were not renumbered.

## 1. Goals and expected behaviour

**Goal.** Attendees and organizers create their own account with email and password, log in, log out, and ask who they are (with or without knowing their role; every answer includes `role`). Later features use the login to know who is calling (`req.user` or `req.organizer`) and to refuse the wrong role.

**Behaviours.** Each line is something that can be checked. B1-B10 belong to other features, so auth uses A1, A2, ...

| # | Behaviour | Test first? |
|---|---|---|
| A1 | A password is stored as an scrypt hash with a random salt. Hashing the same password twice gives two different strings. The right password verifies, a wrong one does not. The stored text never contains the password. | yes |
| A2 | The login cookie is signed, lasts 7 days, and is `httpOnly`, `sameSite=lax`, and `secure` only when `NODE_ENV=production`. It carries the role (`user` or `organizer`) and the id. | yes |
| A3 | A cookie that was changed, signed with another secret, or past its 7 days (checked on the server, not only by the browser) counts as no login. | yes |
| A4 | Sign-up with valid data creates the row, sets the cookie and answers 201 with `{ role, id, email, name }` (`role` is `user` or `organizer`). The person is logged in. | |
| A5 | The email is trimmed and lowercased before it is stored or looked up. `  Ann@Mail.COM ` signs up as `ann@mail.com` and can log in with `ANN@mail.com`. | |
| A6 | Sign-up with an email that already exists (in the same table, after trimming and lowercasing) answers 409 and creates nothing. Two parallel sign-ups with one email give one row and one 409 (the unique key decides, the app maps error `23505` to 409). | |
| A7 | Sign-up with a bad body answers 400 and creates nothing: email not a valid address, name empty after trimming, password shorter than 8 or longer than 128 characters, or a field missing or not a string. | |
| A8 | Login with the right email and password sets the cookie and answers 200 with `{ role, id, email, name }`. | |
| A9 | Login with an unknown email and login with a wrong password answer the same: 401 with the same body, and neither sets a cookie. | |
| A10 | Logout clears the cookie and answers 204. It also answers 204 when nobody is logged in. | |
| A11 | (removed) There is no role-specific "me" route. `GET /auth/me` (A17) is the only one. | |
| A12 | An attendee account and an organizer account may share one email (separate tables). A cookie holds one role: logging in as the other role replaces it. | |
| A13 | Middleware: with a valid cookie it sets `req.user` (role `user`) or `req.organizer` (role `organizer`) to `{ id }`. With none, or an invalid one (A3), it sets neither and does not fail by itself. | |
| A14 | `requireUser` and `requireOrganizer` answer 401 when there is no valid login. | |
| A15 | `requireUser` with an organizer cookie, and `requireOrganizer` with an attendee cookie, answer 403 and run no handler. | |
| A16 | No response (including `GET /auth/me`) contains `password_hash`, and the password is never logged. | |
| A17 | `GET /auth/me` with a valid cookie of either role answers 200 with `{ role, id, email, name }`. The role comes from the cookie and the row is loaded from the matching table (`users` or `organizers`), so the data is current. | |
| A18 | `GET /auth/me` with no cookie, a bad one or an expired one (A3) answers 401 and sets no cookie. It never answers 403 (it accepts both roles). | |
| A19 | (removed) There is no `GET /auth/<role>/me`. | |

**Out of scope.** Password reset, email verification, OAuth or other providers, rate limiting and lockout, a sessions table (`DATABASE.md` section 5), a roles table, changing email or password, deleting accounts, CSRF protection beyond `sameSite=lax`.

**Assumptions.** Change any of these first in this file.
- Password rule: 8 to 128 characters, nothing else required.
- Email check: one `@`, text on both sides, no spaces, at most 254 characters. It is a format check only; nothing is sent.
- Name: trimmed, 1 to 100 characters.
- 403 for the wrong role: the person is logged in but not allowed, so it is not 401. (This differs from `DATABASE.md` 3.8, which uses 404 to hide another organizer's event; that is about a resource, this is about a route.)
- One cookie named `session`. Its signed value is `<role>.<id>.<expiresAtMs>`. The server checks the expiry itself, so a stolen old cookie stops working at 7 days.
- Logout only clears the cookie in the browser. A copy of the cookie stays valid until it expires, because there is no sessions table. Honest limitation.
- `sameSite=lax` is the only CSRF defence. A cross-site form POST does not carry the cookie, but this is not a full protection (for example a hostile subdomain). Honest limitation.
- The middleware does not read the database. Accounts are never deleted (`DATABASE.md` decision 9), so an id in a valid cookie always has a row.
- The cookie secret must be set. The app refuses to start without `COOKIE_SECRET` of at least 32 characters.
- Errors use the body `{ "error": "<code>" }`, for example `invalid_input`, `invalid_credentials`, `email_taken`, `not_logged_in`, `wrong_role`. Only the status is fixed by this spec; codes may be refined.

## 2. UI decisions

No screens in M1 (API only). The sign-up and login forms for both roles are in `auth-web.md` (M9). States the API gives them: 400 (show field errors), 401 (show "wrong email or password"), 409 (show "email already used"), success (go on as logged in).

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new tables, no migration.
- **Hashing:** `node:crypto` `scrypt` (async, through `util.promisify`), 16 random bytes of salt from `randomBytes`, 64-byte key, Node default cost. Stored in `password_hash` as `scrypt$<salt hex>$<key hex>`. Verify re-derives the key with the stored salt and compares with `timingSafeEqual` (lengths are equal by construction; a malformed stored value verifies false). For an unknown email on login the app still runs one scrypt against a fixed dummy hash, so both failures take about the same time.
- **Cookie:** `cookie-parser` with the secret, signed cookies. It is **not yet in `api/package.json`**. It is named in `DATABASE.md` decision 12, but installing it (`cookie-parser` and `@types/cookie-parser`) needs the user's OK first. No other library is needed. Set with `res.cookie("session", value, { signed: true, httpOnly: true, sameSite: "lax", secure: NODE_ENV === "production", maxAge: 7 days })`. Parsing: read `req.signedCookies.session`; `false` or `undefined` (bad signature) means no login; then split the value, check the role is `user` or `organizer`, the id looks like a uuid and `expiresAtMs` is in the future.
- **Env:** `COOKIE_SECRET` (new). `NODE_ENV` decides `secure`.
- **Middleware (in order in `createApp`):** `express.json()`, `cookieParser(secret)`, `authenticate` (sets `req.user` or `req.organizer`, never fails), then routes. Guards `requireUser` and `requireOrganizer` are per-route. Types: `req.user?: { id: string }`, `req.organizer?: { id: string }` through a `declare global` / Express `Request` augmentation.
- **Database access:** parameterised queries with `pg` through the existing pool. Insert returns `id, email, name`. A duplicate email is caught as error code `23505`.
- **Concurrency:** no lock. The unique key on `email` makes parallel sign-ups safe (A6).
- **API** (all JSON; `<role>` is `users` for attendees, `organizers` for organizers):

| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /auth/<role>/signup` | `{ email, name, password }` | 201 `{ role, id, email, name }`, cookie set | 400 invalid input, 409 email taken |
| `POST /auth/<role>/login` | `{ email, password }` | 200 `{ role, id, email, name }`, cookie set | 400 missing or non-string field, 401 bad credentials |
| `POST /auth/<role>/logout` | none | 204, cookie cleared | none |
| `GET /auth/me` | none | 200 `{ role, id, email, name }` | 401 not logged in |

  Seven routes in total: three for `users` (sign-up, login, logout), three for `organizers`, and `GET /auth/me`. One handler set is shared by both roles (table name and role string are the only difference; the table name comes from a fixed map, never from the request). `role` in bodies is `user` or `organizer` (the cookie value), not the path word. `GET /auth/me` is registered once, not per role, and uses `req.user` / `req.organizer` from `authenticate`.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/package.json` | Add `cookie-parser` and `@types/cookie-parser` (after the user's OK) | A2 |
| `api/src/auth/password.ts` | `hashPassword(password)` and `verifyPassword(password, stored)` with scrypt and `timingSafeEqual` | A1 |
| `api/src/auth/cookie.ts` | `setSession(res, role, id)`, `clearSession(res)`, `readSession(req)`; builds and checks `<role>.<id>.<expiresAtMs>`; cookie options | A2, A3 |
| `api/src/auth/middleware.ts` | `authenticate`, `requireUser`, `requireOrganizer`, and the `Request` type additions | A13, A14, A15 |
| `api/src/auth/routes.ts` | The three routes per role (sign-up, login, logout), input validation, email normalisation, 23505 to 409, `role` in answers; plus `GET /auth/me` | A4-A10, A12, A16-A18 |
| `api/src/app.ts` | Add `cookieParser(secret)`, `authenticate` and the auth router; throw if `COOKIE_SECRET` is missing or shorter than 32 | A2 |
| `api/test/auth/password.test.ts` | Tests first: A1 | A1 |
| `api/test/auth/cookie.test.ts` | Tests first: A2 (flags, 7 days), A3 (tampered, wrong secret, expired) | A2, A3 |
| `api/test/auth/routes.test.ts` | Sign-up, login, logout for both roles; `role` in answers; `GET /auth/me` for both roles and with no, bad or expired cookie; parallel sign-up; same error for unknown email and wrong password; no `password_hash` in any body | A4-A10, A12, A16-A18 |
| `api/test/auth/middleware.test.ts` | No cookie gives 401; attendee cookie on an organizer route and the reverse give 403; a bad cookie gives 401 | A13-A15 |
| `.env.example` | Add `COOKIE_SECRET=` with a note: at least 32 random characters, never commit the real value | A2 |
| `.env` (local only, not committed) | Add a `COOKIE_SECRET` for development and tests | |
| `README.md` | Env var, the seven routes, and the two limitations (logout, CSRF) | |
| `ROADMAP.md` | Mark M1 steps done as they finish; note that the cookie package was installed | |

Tests use the existing style (`createApp().listen(0)` and `fetch`; no new test library) and set `COOKIE_SECRET` for the test process. Tests that need rows delete only the emails they created.

## 5. Done means

- Tests, typecheck and linter all pass in `api/`.
- Every behaviour A1-A19 (except the removed A11 and A19) has a test, or a note in the README that says it is not covered.
- A1, A2 and A3 have their tests written and committed before the code.
- The README "Project status" says what really works, including that logout does not cancel a copied cookie.

## 6. Open questions

1. May `cookie-parser` and `@types/cookie-parser` be installed? Needed for A2 and A3; the code step waits for the answer.
