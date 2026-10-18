// Hooks for the registration routes (registration-web.md section 3).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "../auth/session";
import {
  PUBLIC_EVENTS_KEY,
  QUERY_OPTIONS,
  authCheckedCall,
  onApiError,
  publicEventKey,
  statusOf,
} from "../events/queries";
import { getMyRegistration, listEventRegistrations, register, type Registration } from "./api";

// Keyed by the account, so a second account in the same tab never sees the first
// one's ticket (W-R23).
export const registrationKey = (meId: string, eventId: string) =>
  ["registration", meId, eventId] as const;

export const eventRegistrationsKey = (eventId: string) =>
  ["event-registrations", eventId] as const;

// The organizer list of one event (W-R20); runs once an event is chosen. A 401/403
// re-checks me and the guard decides (W-R13).
export function useEventRegistrations(eventId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: eventRegistrationsKey(eventId ?? ""),
    queryFn: () => authCheckedCall(queryClient, () => listEventRegistrations(eventId ?? "")),
    enabled: eventId !== null,
    ...QUERY_OPTIONS,
  });
}

// The caller's registration for one event; null means "not registered" (W-R3).
// Runs only for a logged-in attendee, so logged-out viewers and organizers make no
// request (W-R1). A 401/403 re-checks me (W-R13).
export function useMyRegistration(eventId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const me = useMe();
  const meId = me.data?.role === "user" ? me.data.id : "";
  return useQuery({
    queryKey: registrationKey(meId, eventId),
    queryFn: () => authCheckedCall(queryClient, () => getMyRegistration(eventId)),
    enabled: enabled && meId !== "",
    ...QUERY_OPTIONS,
  });
}

// The mutation variable is the account id at click time, so the answer is stored
// under the account that registered (W-R6, W-R23). No optimistic update (W-R8).
export function useRegister(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation<Registration, Error, string>({
    mutationFn: () => register(eventId),
    onSuccess: (registration, meId) => {
      queryClient.setQueryData(registrationKey(meId, eventId), registration);
      void queryClient.invalidateQueries({ queryKey: publicEventKey(eventId), exact: true });
      // W-L13: the home list badge is not stale when the person goes back.
      void queryClient.invalidateQueries({ queryKey: PUBLIC_EVENTS_KEY, exact: true });
    },
    onError: (error) => {
      onApiError(queryClient, error);
      // 409: the status line turns Cancelled or Ended; 404: the page shows Event not found.
      const status = statusOf(error);
      if (status === 409 || status === 404) {
        void queryClient.invalidateQueries({ queryKey: publicEventKey(eventId), exact: true });
      }
    },
  });
}
