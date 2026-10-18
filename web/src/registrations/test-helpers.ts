// Sample registrations for the web tests, shaped as `Registration` in api/openapi.yaml.
// Reuse auth/test-helpers.tsx (mockFetch, json, renderApp) and events/test-helpers.ts.
import type { Me } from "../auth/api";
import { EVENT_ID } from "../events/test-helpers";

export type SampleRegistration = {
  id: string;
  event_id: string;
  status: "registered" | "waitlisted" | "cancelled";
  ticket_code: string;
  waitlist_position: number | null;
  checked_in_at: string | null;
  created_at: string;
};

export function registration(overrides: Partial<SampleRegistration> = {}): SampleRegistration {
  return {
    id: "9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
    event_id: EVENT_ID,
    status: "registered",
    ticket_code: "K7M2QX9TPA",
    waitlist_position: null,
    checked_in_at: null,
    created_at: "2026-10-18T10:00:00.000Z",
    ...overrides,
  };
}

// A second attendee for the cache-key test (W-R23).
export const BEN: Me = {
  role: "user",
  id: "7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d",
  email: "ben@mail.com",
  name: "Ben",
};

export const MY_REGISTRATION = `GET /events/${EVENT_ID}/registrations/me`;
export const REGISTER = `POST /events/${EVENT_ID}/registrations`;

// An item of GET /events/{id}/registrations (OrganizerRegistration in api/openapi.yaml).
export type SampleOrganizerRegistration = Omit<SampleRegistration, "status"> & {
  status: "registered" | "waitlisted";
  attendee_name: string;
  attendee_email: string;
};

export function organizerRegistration(
  overrides: Partial<SampleOrganizerRegistration> = {},
): SampleOrganizerRegistration {
  return {
    ...registration(),
    status: "registered",
    attendee_name: "Olga Test",
    attendee_email: "olga@example.com",
    ...overrides,
  };
}

export const SECOND_EVENT_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
export const eventRegistrations = (eventId: string) => `GET /events/${eventId}/registrations`;
