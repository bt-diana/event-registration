// The emails of one attendee (email-reminders-web.md W-EM3, W-EM4, W-EM9):
// GET /events/{id}/registrations/{registrationId}/emails (email-reminders.md ER48-ER60).
// The browser sorts and counts nothing; the rows are shown as sent, newest first.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "../auth/api";
import { useMe } from "../auth/session";
import { QUERY_OPTIONS, authCheckedCall } from "../events/queries";

// An item of the answer (ER50): exactly these nine keys, no body and no ticket code.
export type RegistrationEmail = {
  id: string;
  kind: string;
  status: string;
  to_email: string;
  subject: string;
  created_at: string;
  sent_at: string | null;
  send_attempts: number;
  send_error: string | null;
};

export type RegistrationEmails = { attendee_name: string; emails: RegistrationEmail[] };

// The same pattern as the API (any case), so a bad id never makes a request (W-EM3).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

const KINDS: Record<string, string> = {
  ticket: "Ticket",
  promotion: "Promotion",
  reminder: "Reminder",
  reschedule: "Reschedule",
  event_cancelled: "Event cancelled",
};

// Words for the stored status only; "Sent" means the provider accepted it (D57, W-EM11).
const STATUSES: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  error_sending: "Sending failed",
};

function word(words: Record<string, string>, value: string): string {
  return Object.hasOwn(words, value) ? words[value] : value;
}

// An unknown value is shown as received (W-EM9).
export function emailKindLabel(kind: string): string {
  return word(KINDS, kind);
}

export function emailStatusLabel(status: string): string {
  return word(STATUSES, status);
}

// The prefix a reschedule or an event cancel invalidates (new rows, W-EM28).
export const REGISTRATION_EMAILS_KEY = ["registration-emails"] as const;

// Keyed by the account like the other organizer lists (W-EM6): a login as another
// organizer in the same tab never shows the first one's rows.
export const registrationEmailsKey = (meId: string, eventId: string, registrationId: string) =>
  [...REGISTRATION_EMAILS_KEY, meId, eventId, registrationId] as const;

// 404 (unknown or foreign event or registration), 401 and 403 are thrown as ApiError.
export async function getRegistrationEmails(
  eventId: string,
  registrationId: string,
): Promise<RegistrationEmails> {
  const response = await request(
    `/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}/emails`,
  );
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as RegistrationEmails;
}

// Read on every mount, also with a cached answer (W-EM5), and never by itself: no
// interval, no focus or reconnect refetch (W-EM4). Runs only for a known organizer and
// two valid ids. A 401/403 re-checks me and the guard decides (W-EM7).
export function useRegistrationEmails(eventId: string, registrationId: string) {
  const queryClient = useQueryClient();
  const me = useMe();
  const meId = me.data?.role === "organizer" ? me.data.id : "";
  return useQuery({
    queryKey: registrationEmailsKey(meId, eventId, registrationId),
    queryFn: () =>
      authCheckedCall(queryClient, () => getRegistrationEmails(eventId, registrationId)),
    enabled: meId !== "" && isUuid(eventId) && isUuid(registrationId),
    ...QUERY_OPTIONS,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: false,
  });
}
