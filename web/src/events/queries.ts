import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "../auth/api";
import { ME_KEY } from "../auth/session";
// The keys a reschedule or cancel invalidates come from the files that own them (W-EM28).
// These modules import this one too; the keys are only read inside the handlers below.
import { EVENT_ARRIVALS_KEY } from "../registrations/arrivals";
import { REGISTRATION_EMAILS_KEY } from "../registrations/emails";
import {
  EVENT_REGISTRATIONS_KEY,
  MY_REGISTRATIONS_KEY,
  REGISTRATION_KEY,
} from "../registrations/queries";
import {
  cancelEvent,
  createEvent,
  getEvent,
  getPublicEvent,
  listEvents,
  listPublicEvents,
  rescheduleEvent,
  type NewEvent,
  type OrganizerEvent,
} from "./api";

export const EVENTS_KEY = ["events"] as const;
export const eventKey = (id: string) => ["events", id] as const;
export const publicEventKey = (id: string) => ["public-event", id] as const;
// W-L13: the register success handler (registration-web.md W-R6) invalidates this key.
export const PUBLIC_EVENTS_KEY = ["public-events"] as const;

// The HTTP status of a failed call; 0 is a network error, -1 is not an API error.
export function statusOf(error: unknown): number {
  return error instanceof ApiError ? error.status : -1;
}

// 401 or 403: the cookie expired or the role changed. The guard decides what to show (W-E13).
export function isAuthError(error: unknown): boolean {
  const status = statusOf(error);
  return status === 401 || status === 403;
}

// Shared with registrations/queries.ts (registration-web.md section 3).
export function onApiError(queryClient: QueryClient, error: unknown) {
  if (isAuthError(error)) void queryClient.invalidateQueries({ queryKey: ME_KEY });
}

// Queries in TanStack Query v5 have no onError, so the check wraps the call.
export async function authCheckedCall<T>(
  queryClient: QueryClient,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    onApiError(queryClient, error);
    throw error;
  }
}

export const QUERY_OPTIONS = { retry: false, refetchOnWindowFocus: false } as const;

export function useEvents() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: EVENTS_KEY,
    queryFn: () => authCheckedCall(queryClient, listEvents),
    ...QUERY_OPTIONS,
  });
}

export function useEvent(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: eventKey(id),
    queryFn: () => authCheckedCall(queryClient, () => getEvent(id)),
    ...QUERY_OPTIONS,
  });
}

export function usePublicEvent(id: string) {
  return useQuery({
    queryKey: publicEventKey(id),
    queryFn: () => getPublicEvent(id),
    ...QUERY_OPTIONS,
  });
}

// The public list on / (W-L1). `enabled` is false until me has answered, for any role,
// so W-L8 and W-L9 make no list request while me loads. A 401/403 re-checks me (W-L10).
export function usePublicEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: PUBLIC_EVENTS_KEY,
    queryFn: () => authCheckedCall(queryClient, listPublicEvents),
    enabled,
    ...QUERY_OPTIONS,
  });
}

// email-reminders-web.md W-EM28. Nothing is refetched by a timer: mounted queries read
// again at once, the others on their next mount.
function invalidateAfterChange(queryClient: QueryClient, id: string, cancelled: boolean) {
  const exact = [EVENTS_KEY, publicEventKey(id), PUBLIC_EVENTS_KEY];
  const prefixes: ReadonlyArray<readonly string[]> = [
    REGISTRATION_EMAILS_KEY,
    MY_REGISTRATIONS_KEY,
    REGISTRATION_KEY,
    ...(cancelled ? [EVENT_REGISTRATIONS_KEY, EVENT_ARRIVALS_KEY] : []),
  ];
  for (const queryKey of exact) void queryClient.invalidateQueries({ queryKey, exact: true });
  for (const queryKey of prefixes) void queryClient.invalidateQueries({ queryKey });
}

// A 401/403 re-checks me (W-E13); a 409 or 404 reads the event again, so the page shows
// the real status or falls back to the public view (W-EM23, W-EM27).
function onActionError(queryClient: QueryClient, id: string, error: unknown) {
  onApiError(queryClient, error);
  const status = statusOf(error);
  if (status !== 409 && status !== 404) return;
  for (const queryKey of [eventKey(id), EVENTS_KEY, publicEventKey(id)]) {
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }
}

// The schedule_version on screen at click time tells a move from the no-op of ER65.
export type RescheduleInput = { startsAt: string; shownVersion: number };

export function isMoved(answer: OrganizerEvent, input: RescheduleInput): boolean {
  return answer.schedule_version > input.shownVersion;
}

// POST /events/{id}/reschedule (W-EM19, W-EM21, W-EM22): the answer goes into the event's
// entry; only a real move invalidates the other reads.
export function useRescheduleEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation<OrganizerEvent, Error, RescheduleInput>({
    mutationFn: ({ startsAt }) => rescheduleEvent(id, startsAt),
    onSuccess: (answer, input) => {
      queryClient.setQueryData(eventKey(id), answer);
      if (isMoved(answer, input)) invalidateAfterChange(queryClient, id, false);
    },
    onError: (error) => onActionError(queryClient, id, error),
  });
}

// POST /events/{id}/cancel (W-EM25, W-EM26); also the 200 of an already cancelled event.
export function useCancelEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation<OrganizerEvent, Error, void>({
    mutationFn: () => cancelEvent(id),
    onSuccess: (answer) => {
      queryClient.setQueryData(eventKey(id), answer);
      invalidateAfterChange(queryClient, id, true);
    },
    onError: (error) => onActionError(queryClient, id, error),
  });
}

// W-E8: the new event goes into its cache entry and the list is marked stale.
export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: NewEvent) => createEvent(event),
    onError: (error) => onApiError(queryClient, error),
    onSuccess: (event: OrganizerEvent) => {
      queryClient.setQueryData(eventKey(event.id), event);
      void queryClient.invalidateQueries({ queryKey: EVENTS_KEY, exact: true });
    },
  });
}
