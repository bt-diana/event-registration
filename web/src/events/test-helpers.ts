// Sample events for the web tests, shaped as in api/openapi.yaml (plus `description`,
// event-description.md DS9, DS10). Reuse auth/test-helpers.tsx for fetch and rendering.

export const EVENT_ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

type Status = "active" | "cancelled" | "passed";

export type SampleOrganizerEvent = {
  id: string;
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  registered: number;
  seats_left: number;
  status: Status;
  schedule_version: number;
  cancelled_at: string | null;
  created_at: string;
};

export type SamplePublicEvent = {
  id: string;
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  status: Status;
  has_started: boolean;
  seats_left: number;
  full: boolean;
};

export function organizerEvent(
  overrides: Partial<SampleOrganizerEvent> = {},
): SampleOrganizerEvent {
  return {
    id: EVENT_ID,
    title: "Spring meetup",
    description: "",
    starts_at: "2030-01-01T10:00:00.000Z",
    ends_at: "2030-01-01T11:30:00.000Z",
    duration_minutes: 90,
    capacity: 25,
    registered: 0,
    seats_left: 25,
    status: "active",
    schedule_version: 1,
    cancelled_at: null,
    created_at: "2026-10-18T10:00:00.000Z",
    ...overrides,
  };
}

export function publicEvent(overrides: Partial<SamplePublicEvent> = {}): SamplePublicEvent {
  return {
    id: EVENT_ID,
    title: "Spring meetup",
    description: "",
    starts_at: "2030-01-01T10:00:00.000Z",
    ends_at: "2030-01-01T11:30:00.000Z",
    duration_minutes: 90,
    capacity: 25,
    status: "active",
    has_started: false,
    seats_left: 25,
    full: false,
    ...overrides,
  };
}
