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

// An item of GET /me/registrations (MyRegistration in openapi.yaml, my-registrations.md):
// the registration keys plus the event's title, start and derived status.
export type MyRegistration = Registration & {
  event_title: string;
  event_starts_at: string;
  event_status: "active" | "cancelled" | "passed";
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

// All of the caller's own registrations, in the API order (newest first, MR9; W-R18).
// The server takes the user from the cookie: no user id, no query, no body (W-R19).
export async function listMyRegistrations(): Promise<MyRegistration[]> {
  const response = await request("/me/registrations");
  if (!response.ok) throw new ApiError(response.status);
  const { registrations } = (await response.json()) as { registrations: MyRegistration[] };
  return registrations;
}

// The answer of POST /checkin as a result for the scan screen (registration-web.md
// section 3, question 10; checkIn in openapi.yaml).
export type CheckInResult =
  | {
      outcome: "checked_in";
      ticket_code: string;
      event_title: string;
      attendee_name: string;
      checked_in_at: string;
    }
  | {
      outcome: "already_checked_in";
      ticket_code: string;
      attendee_name: string;
      checked_in_at: string;
    }
  | {
      outcome: "not_found" | "waitlisted" | "registration_cancelled" | "event_cancelled" | "invalid_input";
      ticket_code: string;
    };

const REFUSED = ["waitlisted", "registration_cancelled", "event_cancelled"] as const;

// 200, 404, 400 and the known 409 codes are results; anything else throws ApiError
// (401, 403, 5xx, an unknown 409; a network error is ApiError(0)).
export async function checkIn(ticketCode: string): Promise<CheckInResult> {
  const response = await request("/checkin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket_code: ticketCode }),
  });
  if (response.ok) {
    const body = (await response.json()) as {
      ticket_code: string;
      event_title: string;
      attendee_name: string;
      checked_in_at: string;
    };
    return {
      outcome: "checked_in",
      ticket_code: body.ticket_code,
      event_title: body.event_title,
      attendee_name: body.attendee_name,
      checked_in_at: body.checked_in_at,
    };
  }
  if (response.status === 404) return { outcome: "not_found", ticket_code: ticketCode };
  if (response.status === 400) return { outcome: "invalid_input", ticket_code: ticketCode };
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      attendee_name?: string;
      checked_in_at?: string;
    };
    if (
      body.error === "already_checked_in" &&
      typeof body.attendee_name === "string" &&
      typeof body.checked_in_at === "string"
    ) {
      return {
        outcome: "already_checked_in",
        ticket_code: ticketCode,
        attendee_name: body.attendee_name,
        checked_in_at: body.checked_in_at,
      };
    }
    const refused = REFUSED.find((code) => code === body.error);
    if (refused) return { outcome: refused, ticket_code: ticketCode };
  }
  throw new ApiError(response.status);
}
