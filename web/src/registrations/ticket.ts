// Pure helpers shared by the event page, the ticket page and (later) the lists
// (registration-web.md section 3, W-R4, W-R7).
import type { PublicEvent } from "../events/api";
import { isClosed, publicStatus } from "../events/publicStatus";
import type { Tone } from "../events/StatusBadge";
import type { Registration } from "./api";

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
  badge: { text: string; tone: Tone };
};

// W-R7 words; badge colours as brand.md (Registered like Open, Waiting list like Full).
export function ticketLabel(
  registration: Pick<Registration, "status" | "waitlist_position">,
): TicketLabel {
  switch (registration.status) {
    case "registered":
      return {
        heading: "You are registered",
        place: null,
        note: null,
        badge: { text: "Registered", tone: "open" },
      };
    case "waitlisted":
      return {
        heading: "You are on the waiting list",
        place:
          registration.waitlist_position === null
            ? null
            : `Your place: ${registration.waitlist_position}`,
        note: null,
        badge: { text: "Waiting list", tone: "full" },
      };
    case "cancelled":
      return {
        heading: "Registration cancelled",
        place: null,
        note: "This ticket is no longer valid.",
        badge: { text: "Cancelled", tone: "cancelled" },
      };
  }
}
