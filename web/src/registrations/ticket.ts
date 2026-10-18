// Pure helpers shared by the event page, the ticket page and the lists
// (registration-web.md section 3, W-R4, W-R7, W-R18, W-R40).
import type { PublicEvent } from "../events/api";
import { isClosed, publicStatus } from "../events/publicStatus";
import type { Tone } from "../events/StatusBadge";
import type { MyRegistration, Registration } from "./api";

export type RegisterAction = "none" | "register" | "register-again" | "waitlist";

// W-R4, first match wins: closed events and active registrations get no button;
// `full` gives the waiting list; a cancelled ticket gives "Register again".
// Already started stays registrable (R11).
export function registerAction(
  event: Pick<PublicEvent, "status" | "has_started" | "full">,
  registration: Pick<Registration, "status"> | null,
): RegisterAction {
  if (isClosed(publicStatus(event))) return "none";
  if (registration && registration.status !== "cancelled") return "none";
  if (event.full) return "waitlist";
  return registration ? "register-again" : "register";
}

export type TicketLabel = {
  heading: string;
  // Shown above the ticket code (the place on the waiting list).
  place: string | null;
  // Shown under the ticket code (a cancelled ticket).
  note: string | null;
  // "Checked in" once the ticket is used; the time is not shown (W-R25).
  checkedIn: string | null;
  badge: { text: string; tone: Tone };
};

// W-R7 words; badge colours as brand.md (Registered like Open, Waiting list like Full).
// W-R42: a registered ticket that is checked in has the badge "Checked in" instead of
// "Registered", same Open tone; waiting and cancelled keep their own badge.
export function ticketLabel(
  registration: Pick<Registration, "status" | "waitlist_position" | "checked_in_at">,
): TicketLabel {
  const checkedIn = registration.checked_in_at === null ? null : "Checked in";
  switch (registration.status) {
    case "registered":
      return {
        heading: "You are registered",
        place: null,
        note: null,
        checkedIn,
        badge: { text: checkedIn ?? "Registered", tone: "open" },
      };
    case "waitlisted":
      return {
        heading: "You are on the waiting list",
        place:
          registration.waitlist_position === null
            ? null
            : `Your place: ${registration.waitlist_position}`,
        note: null,
        checkedIn,
        badge: { text: "Waiting list", tone: "full" },
      };
    case "cancelled":
      return {
        heading: "Registration cancelled",
        place: null,
        note: "This ticket is no longer valid.",
        checkedIn,
        badge: { text: "Cancelled", tone: "cancelled" },
      };
  }
}

// W-R25: the ticket page shows the QR only for a ticket that can still be used at the
// door: registered, not checked in, event not Cancelled (an Ended event keeps it).
export function showQr(
  registration: Pick<Registration, "status" | "checked_in_at">,
  event: Pick<PublicEvent, "status">,
): boolean {
  return (
    registration.status === "registered" &&
    registration.checked_in_at === null &&
    event.status !== "cancelled"
  );
}

// cancel-registration-web.md W-CR1: the ticket page shows "Cancel registration" only for a
// registered or waiting ticket that is not checked in, on an active event that has not
// started (the server's has_started, no browser clock). Otherwise nothing at all.
export function canCancel(
  registration: Pick<Registration, "status" | "checked_in_at">,
  event: Pick<PublicEvent, "status" | "has_started">,
): boolean {
  return (
    (registration.status === "registered" || registration.status === "waitlisted") &&
    registration.checked_in_at === null &&
    event.status === "active" &&
    !event.has_started
  );
}

// W-R18: the registration status on a row of the attendee list. The waiting place is in
// the badge text; a cancelled row has no place (W-R40). A checked-in registered row reads
// "Checked in" (W-R42).
export function listStatusText(
  registration: Pick<Registration, "status" | "waitlist_position" | "checked_in_at">,
): string {
  switch (registration.status) {
    case "registered":
      return registration.checked_in_at === null ? "Registered" : "Checked in";
    case "waitlisted":
      return registration.waitlist_position === null
        ? "Waiting list"
        : `Waiting list: place ${registration.waitlist_position}`;
    case "cancelled":
      return "Cancelled";
  }
}

// W-R40: the second badge of a row, after the registration's own one; an active event
// adds nothing.
export function eventStatusBadge(status: MyRegistration["event_status"]): string | null {
  switch (status) {
    case "cancelled":
      return "Event cancelled";
    case "passed":
      return "Ended";
    case "active":
      return null;
  }
}
