// Fetch wrapper for the event routes in api/openapi.yaml (events.md, event-description.md).
// Same origin: the dev proxy in vite.config.ts sends /events and /public to the API.
import { ApiError, request } from "../auth/api";

export type EventStatus = "active" | "cancelled" | "passed";

export type OrganizerEvent = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  registered: number;
  seats_left: number;
  status: EventStatus;
  schedule_version: number;
  cancelled_at: string | null;
  created_at: string;
};

export type PublicEvent = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  status: EventStatus;
  has_started: boolean;
  seats_left: number;
  full: boolean;
};

export type NewEvent = {
  title: string;
  description: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
};

// The API answers `description` as a string (event-description.md DS9, DS10). An API
// built before that field has none, so a missing value is read as empty.
function withDescription<T extends { description?: unknown }>(event: T): T & { description: string } {
  return {
    ...event,
    description: typeof event.description === "string" ? event.description : "",
  };
}

async function body<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as T;
}

export async function listEvents(): Promise<OrganizerEvent[]> {
  const { events } = await body<{ events: OrganizerEvent[] }>(await request("/events"));
  return events.map(withDescription);
}

export async function getEvent(id: string): Promise<OrganizerEvent> {
  return withDescription(
    await body<OrganizerEvent>(await request(`/events/${encodeURIComponent(id)}`)),
  );
}

export async function createEvent(event: NewEvent): Promise<OrganizerEvent> {
  const response = await request("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  return withDescription(await body<OrganizerEvent>(response));
}

export async function getPublicEvent(id: string): Promise<PublicEvent> {
  return withDescription(
    await body<PublicEvent>(await request(`/public/events/${encodeURIComponent(id)}`)),
  );
}

// An item of GET /public/events (events-public-list.md PL5): the ten keys, no description.
export type PublicListItem = Omit<PublicEvent, "description">;

// Upcoming and running events, soonest first; the client keeps the API order (W-L1).
export async function listPublicEvents(): Promise<PublicListItem[]> {
  const { events } = await body<{ events: PublicListItem[] }>(await request("/public/events"));
  return events;
}
