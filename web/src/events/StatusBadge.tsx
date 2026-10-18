// Status pills (brand.md "Event screens"). The status is always text, never colour alone.
import type { EventStatus } from "./api";

export type Tone = "open" | "full" | "cancelled" | "muted";

export function Badge({ text, tone }: { text: string; tone: Tone }) {
  return <span className={`badge badge-${tone}`}>{text}</span>;
}

// The organizer screens show the raw status: Active, Cancelled, Ended (from passed).
const ORGANIZER: Record<EventStatus, { text: string; tone: Tone }> = {
  active: { text: "Active", tone: "open" },
  cancelled: { text: "Cancelled", tone: "cancelled" },
  passed: { text: "Ended", tone: "muted" },
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge {...ORGANIZER[status]} />;
}
