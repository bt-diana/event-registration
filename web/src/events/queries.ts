import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "../auth/api";
import { ME_KEY } from "../auth/session";
import {
  createEvent,
  getEvent,
  getPublicEvent,
  listEvents,
  type NewEvent,
  type OrganizerEvent,
} from "./api";

export const EVENTS_KEY = ["events"] as const;
export const eventKey = (id: string) => ["events", id] as const;
export const publicEventKey = (id: string) => ["public-event", id] as const;

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
async function organizerCall<T>(queryClient: QueryClient, call: () => Promise<T>): Promise<T> {
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
    queryFn: () => organizerCall(queryClient, listEvents),
    ...QUERY_OPTIONS,
  });
}

export function useEvent(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: eventKey(id),
    queryFn: () => organizerCall(queryClient, () => getEvent(id)),
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
