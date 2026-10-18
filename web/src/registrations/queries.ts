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
import {
  cancelRegistration,
  checkIn,
  getMyRegistration,
  listEventRegistrations,
  listMyRegistrations,
  register,
  type CancelResult,
  type CheckInResult,
  type Registration,
} from "./api";
import { EVENT_ARRIVALS_KEY } from "./arrivals";

// The prefixes a reschedule or an event cancel invalidates (email-reminders-web.md W-EM28).
export const REGISTRATION_KEY = ["registration"] as const;
export const MY_REGISTRATIONS_KEY = ["registrations"] as const;
export const EVENT_REGISTRATIONS_KEY = ["event-registrations"] as const;

// Keyed by the account, so a second account in the same tab never sees the first
// one's ticket (W-R23).
export const registrationKey = (meId: string, eventId: string) =>
  [...REGISTRATION_KEY, meId, eventId] as const;

// The attendee list of all my registrations, keyed by the account (W-R19, W-R23).
export const myRegistrationsKey = (meId: string) => [...MY_REGISTRATIONS_KEY, meId] as const;

// Keyed by the account like the attendee key (W-R23): a login as another organizer
// replaces the cookie without a logout, and names and emails must not carry over.
export const eventRegistrationsKey = (meId: string, eventId: string) =>
  [...EVENT_REGISTRATIONS_KEY, meId, eventId] as const;

// The organizer list of one event (W-R20); runs once me is a known organizer and an
// event is chosen. A 401/403 re-checks me and the guard decides (W-R13). Read again on
// every mount, also with a cached answer (checkin-web.md W-C7), and never by itself
// (no interval, no focus or reconnect refetch, W-C6).
export function useEventRegistrations(eventId: string | null) {
  const queryClient = useQueryClient();
  const me = useMe();
  const meId = me.data?.role === "organizer" ? me.data.id : "";
  return useQuery({
    queryKey: eventRegistrationsKey(meId, eventId ?? ""),
    queryFn: () => authCheckedCall(queryClient, () => listEventRegistrations(eventId ?? "")),
    enabled: meId !== "" && eventId !== null,
    ...QUERY_OPTIONS,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: false,
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

// GET /me/registrations for the attendee list (W-R18, W-R41). Runs only once me is a
// known attendee, so nothing is sent while me loads, for logged-out viewers or for
// organizers. A 401/403 re-checks me and the guard decides (W-R13). staleTime 0: opening
// the screen again reads it again; nothing refetches by itself.
export function useMyRegistrations() {
  const queryClient = useQueryClient();
  const me = useMe();
  const meId = me.data?.role === "user" ? me.data.id : "";
  return useQuery({
    queryKey: myRegistrationsKey(meId),
    queryFn: () => authCheckedCall(queryClient, listMyRegistrations),
    enabled: meId !== "",
    ...QUERY_OPTIONS,
    staleTime: 0,
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
      // W-R19: the attendee list is read again on the next visit (no request while it is
      // not mounted).
      void queryClient.invalidateQueries({ queryKey: myRegistrationsKey(meId), exact: true });
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

// POST /checkin (registration-web.md W-R33, W-R34). The scan screen handles errors
// itself (a 401/403 re-checks me there). Only a 200 (`checked_in`) reads the arrivals
// again (checkin-web.md W-C11): the prefix, so the screen needs no event id; the list is
// not touched and nothing navigates. A running arrivals request is cancelled first, so
// an answer read before the check-in cannot win (also on a first load, where
// invalidateQueries alone would reuse the running request).
export function useCheckIn() {
  const queryClient = useQueryClient();
  return useMutation<CheckInResult, Error, string>({
    mutationFn: (ticketCode) => checkIn(ticketCode),
    onSuccess: async (result) => {
      if (result.outcome !== "checked_in") return;
      await queryClient.cancelQueries({ queryKey: EVENT_ARRIVALS_KEY });
      void queryClient.invalidateQueries({ queryKey: EVENT_ARRIVALS_KEY });
    },
  });
}

// POST /events/{id}/registrations/me/cancel from the ticket page (cancel-registration-web.md
// W-CR4-W-CR8). The mutation variable is the account id at click time, so the answer is
// stored under the account that clicked (W-CR10). The section shows the texts itself.
export function useCancelRegistration(eventId: string) {
  const queryClient = useQueryClient();
  const exact = (queryKey: readonly unknown[]) =>
    void queryClient.invalidateQueries({ queryKey, exact: true });
  return useMutation<CancelResult, Error, string>({
    mutationFn: () => cancelRegistration(eventId),
    onSuccess: (result, meId) => {
      switch (result.outcome) {
        case "cancelled":
          // W-CR5, W-CR6: no extra GET. The other keys are only marked stale, so they are
          // read on their next mount and the ticket page sends nothing now (W-CR11).
          queryClient.setQueryData(registrationKey(meId, eventId), result.registration);
          for (const queryKey of [myRegistrationsKey(meId), publicEventKey(eventId), PUBLIC_EVENTS_KEY]) {
            void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
          }
          return;
        // W-CR7: the page corrects itself from the server's answer.
        case "already_checked_in":
          exact(registrationKey(meId, eventId));
          return;
        case "event_started":
        case "event_passed":
          exact(publicEventKey(eventId));
          return;
        case "event_cancelled":
          exact(publicEventKey(eventId));
          exact(registrationKey(meId, eventId));
          return;
      }
    },
    onError: (error, meId) => {
      // 401/403: me is read again and the guard decides (W-R13).
      onApiError(queryClient, error);
      // 404: the page shows "You have no ticket" or "Event not found" (W-R12).
      if (statusOf(error) === 404) {
        exact(registrationKey(meId, eventId));
        exact(publicEventKey(eventId));
      }
    },
  });
}
