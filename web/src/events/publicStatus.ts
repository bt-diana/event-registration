// The public status line (W-E17), first match wins. The client never compares dates:
// `status` and `has_started` come from the server clock.
import type { PublicEvent } from "./api";
import type { Tone } from "./StatusBadge";

export type PublicStatus = "cancelled" | "ended" | "started" | "full" | "open";

// The W-E17 words and badge tones, shared by the public event page and the list (W-L3).
export const PUBLIC_LABEL: Record<PublicStatus, { text: string; tone: Tone }> = {
  open: { text: "Open", tone: "open" },
  full: { text: "Full", tone: "full" },
  started: { text: "Already started", tone: "muted" },
  cancelled: { text: "Cancelled", tone: "cancelled" },
  ended: { text: "Ended", tone: "muted" },
};

export function publicStatus(event: Pick<PublicEvent, "status" | "has_started" | "full">): PublicStatus {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "passed") return "ended";
  if (event.has_started) return "started";
  if (event.full) return "full";
  return "open";
}

// Only Cancelled and Ended are closed. Already started is not: registration stays
// possible until the event ends (registration.md R11).
export function isClosed(status: PublicStatus): boolean {
  return status === "cancelled" || status === "ended";
}
