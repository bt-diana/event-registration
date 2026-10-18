// The arrivals counter (checkin-web.md W-C1, W-C4, W-C6, W-C8): GET /events/{id}/arrivals
// (arrivals.md). The browser counts nothing; the three numbers are shown as sent. Same
// origin: /events is proxied to the API in development (vite.config.ts).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "../auth/api";
import { useMe } from "../auth/session";
import { QUERY_OPTIONS, authCheckedCall } from "../events/queries";

// Arrivals in api/openapi.yaml: `registered` is the taken seats, `arrived` those of
// them checked in, `capacity` as stored (not clamped).
export type Arrivals = { capacity: number; registered: number; arrived: number };

// The prefix a 200 check-in invalidates (W-C11).
export const EVENT_ARRIVALS_KEY = ["event-arrivals"] as const;

// One key per account and event, shared by the scan screen and the registrations page
// (W-C4, W-C15).
export const eventArrivalsKey = (meId: string, eventId: string) =>
  [...EVENT_ARRIVALS_KEY, meId, eventId] as const;

// 404 (unknown or not theirs), 401 and 403 are thrown as ApiError like the list.
export async function getArrivals(eventId: string): Promise<Arrivals> {
  const response = await request(`/events/${encodeURIComponent(eventId)}/arrivals`);
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as Arrivals;
}

// Read on every mount of a screen that shows it (W-C8) and after a 200 check-in
// (W-C11), never by itself: no interval, no focus or reconnect refetch (W-C6).
export function useEventArrivals(eventId: string) {
  const queryClient = useQueryClient();
  const me = useMe();
  const meId = me.data?.role === "organizer" ? me.data.id : "";
  return useQuery({
    queryKey: eventArrivalsKey(meId, eventId),
    queryFn: () => authCheckedCall(queryClient, () => getArrivals(eventId)),
    enabled: meId !== "",
    ...QUERY_OPTIONS,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: false,
  });
}
