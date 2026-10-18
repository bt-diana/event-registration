// /registrations/me for an attendee (W-R15). With `event`: the ticket page (W-R11).
// Without it: the list, blocked until the API has a "my registrations" route
// (registration-web.md open question 1), so a placeholder with no request (W-R18).
import { useSearchParams } from "react-router";
import { TicketPage } from "./TicketPage";

export function MyRegistrations() {
  const [params] = useSearchParams();
  const eventId = params.get("event") ?? "";
  if (eventId !== "") return <TicketPage key={eventId} eventId={eventId} />;
  return (
    <section className="card card-message" data-role="user">
      <h1>My registrations</h1>
      <p className="intro">The list is not built yet.</p>
    </section>
  );
}
