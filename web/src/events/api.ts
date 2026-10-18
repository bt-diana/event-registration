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

// A failed reschedule or cancel (email-reminders-web.md W-EM34): the status as ApiError,
// plus `code`, the `error` string of the body ("" when the body is not JSON or has none),
// so the 409 texts can tell event_cancelled, event_passed and event_started apart.
// `registered` is the count a 409 capacity_below_registered carries (capacity-web.md
// W-CP10): a whole number >= 0, else undefined.
export class EventActionError extends ApiError {
  readonly code: string;
  readonly registered?: number;
  constructor(status: number, code: string, registered?: number) {
    super(status);
    this.name = "EventActionError";
    this.code = code;
    this.registered = registered;
  }
}

type ErrorBody = { code: string; registered?: number };

async function errorBody(response: Response): Promise<ErrorBody> {
  try {
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) return { code: "" };
    const code = "error" in data && typeof data.error === "string" ? data.error : "";
    const registered =
      "registered" in data && Number.isInteger(data.registered) && Number(data.registered) >= 0
        ? Number(data.registered)
        : undefined;
    return { code, registered };
  } catch {
    return { code: "" };
  }
}

async function actionAnswer(response: Response): Promise<OrganizerEvent> {
  if (!response.ok) {
    const { code, registered } = await errorBody(response);
    throw new EventActionError(response.status, code, registered);
  }
  return withDescription((await response.json()) as OrganizerEvent);
}

// POST /events/{id}/reschedule (email-reminders.md ER61-ER71): the new start as an ISO
// string with Z; answers the organizer event. A network error stays ApiError(0) (request).
export async function rescheduleEvent(id: string, startsAtIso: string): Promise<OrganizerEvent> {
  const response = await request(`/events/${encodeURIComponent(id)}/reschedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ starts_at: startsAtIso }),
  });
  return actionAnswer(response);
}

// POST /events/{id}/cancel (ER73-ER79): no body; answers the organizer event.
export async function cancelEvent(id: string): Promise<OrganizerEvent> {
  const response = await request(`/events/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  return actionAnswer(response);
}

// POST /events/{id}/capacity (capacity.md CP1-CP24): the new capacity as a JSON number;
// answers the organizer event with the new capacity, registered and seats_left.
export async function setCapacity(id: string, capacity: number): Promise<OrganizerEvent> {
  const response = await request(`/events/${encodeURIComponent(id)}/capacity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capacity }),
  });
  return actionAnswer(response);
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
