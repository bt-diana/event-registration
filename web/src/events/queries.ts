import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "../auth/api";
import { ME_KEY } from "../auth/session";
import {
  createEvent,
  getEvent,
  getPublicEvent,
  listEvents,
  listPublicEvents,
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

function onApiError(queryClient: QueryClient, error: unknown) {
  if (isAuthError(error)) void queryClient.invalidateQueries({ queryKey: ME_KEY });
}

// Queries in TanStack Query v5 have no onError, so the check wraps the call.
async function authCheckedCall<T>(queryClient: QueryClient, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    onApiError(queryClient, error);
    throw error;
  }
}

const QUERY_OPTIONS = { retry: false, refetchOnWindowFocus: false } as const;

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

// The attendee home list (W-L1). `enabled` is false until me has answered and for an
// organizer, so W-L8 and W-L9 make no list request. A 401/403 re-checks me (W-L10).
export function usePublicEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: PUBLIC_EVENTS_KEY,
    queryFn: () => authCheckedCall(queryClient, listPublicEvents),
    enabled,
    ...QUERY_OPTIONS,
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
