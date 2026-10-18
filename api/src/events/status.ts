// The derived event status (events.md E19, DATABASE.md 3.10), shared by the
// event routes and the register service (registration.md R10).

export const MINUTE_MS = 60 * 1000;

export type StoredStatus = "active" | "cancelled";
export type EventStatus = "active" | "cancelled" | "passed";

export function endsAt(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * MINUTE_MS);
}

// `cancelled` if stored cancelled; else `passed` from the end on; else `active`.
export function deriveStatus(
  stored: StoredStatus,
  startsAt: Date,
  durationMinutes: number,
  now: Date,
): EventStatus {
  if (stored === "cancelled") return "cancelled";
  return now.getTime() >= endsAt(startsAt, durationMinutes).getTime() ? "passed" : "active";
}
