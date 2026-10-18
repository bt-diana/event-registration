# Session: hide the ticket code and QR on a checked-in ticket

## Step 1: QR code not read by the camera

**Prompt** (text cleaned)

> The QR code is not read by the camera.

**What Claude did.** Read `qr.ts`, `QrCode.tsx`, the canvas CSS, `scanner.ts` and the spec (Read, Grep, Bash). Rendered the QR with the app's own options in a scratch folder and decoded it with jsQR at 464, 232 and 160 px: all decode to the ticket code. Found no fault in the drawing code. Asked which camera and display failed; the user then said it works now.

**Decision.** None.

## Step 2: no code and no QR on a checked-in ticket

**Prompt** (text cleaned)

> Never mind, it is working now. Turn off and remove the camera and ticket code components when the attendee is checked in.

**What Claude did.** Read the QR was already hidden by W-R25, so read "camera" as the QR and removed the ticket code text too. `spec-writer` updated `registration-web.md` (W-R7, W-R22, W-R25, W-R26, W-R38, texts, tests; commit `038a0e3`). `code-writer` wrote the tests first (`96b1d7f`, 8 failed) and then `TicketPanel` renders the "Ticket code" block only while `checked_in_at` is null (`0506f4f`). Web lint and the touched test files pass; full web run fails only in unrelated uncommitted email work.

**Decision.** None.
