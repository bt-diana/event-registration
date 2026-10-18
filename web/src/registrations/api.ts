// Fetch wrapper for the registration routes in api/openapi.yaml (registration.md).
// Same origin: /events is proxied to the API in development (vite.config.ts).
import { ApiError, request } from "../auth/api";

export type RegistrationStatus = "registered" | "waitlisted" | "cancelled";

export type Registration = {
  id: string;
  event_id: string;
  status: RegistrationStatus;
  ticket_code: string;
  waitlist_position: number | null;
  checked_in_at: string | null;
  created_at: string;
};

// An item of GET /events/{id}/registrations (OrganizerRegistration in openapi.yaml):
// only active rows, with the attendee's name and email for the owning organizer.
export type OrganizerRegistration = Omit<Registration, "status"> & {
  status: "registered" | "waitlisted";
  attendee_name: string;
  attendee_email: string;
};

function path(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/registrations`;
}

async function body(response: Response): Promise<Registration> {
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as Registration;
}

// 200 gives the caller's registration; 404 means "not registered" and gives null (W-R3).
// The page proves that the event exists with its own public event read.
export async function getMyRegistration(eventId: string): Promise<Registration | null> {
  const response = await request(`${path(eventId)}/me`);
  if (response.status === 404) return null;
  return body(response);
}

// POST with no body. 201 (new) and 200 (already registered) are both a success (W-R6).
export async function register(eventId: string): Promise<Registration> {
  return body(await request(path(eventId), { method: "POST" }));
}

// The registrations of one of the organizer's events, in the API order (W-R20).
// 404 (not theirs or unknown) is thrown as ApiError(404) and shown by the screen (W-R21).
export async function listEventRegistrations(eventId: string): Promise<OrganizerRegistration[]> {
  const response = await request(path(eventId));
  if (!response.ok) throw new ApiError(response.status);
  const { registrations } = (await response.json()) as { registrations: OrganizerRegistration[] };
  return registrations;
}
