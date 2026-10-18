// The ticket page /registrations/me?event={id} (registration-web.md W-R11-W-R13).
// Inside the attendee entry (W-R15). Both reads start together; no button here.
// The QR of the ticket code is shown here only (W-R25). Only the registration status is
// shown, no ticket heading and no event status; the ticket sits in the card (W-R38).
// One exception (email-reminders-web.md W-EM30): a cancelled event adds the line "This
// event has been cancelled.", from the public event already read. No role eyebrow (RE1).
import { Link } from "react-router";
import { BackLink, EventNotFound, Detail } from "../events/EventParts";
import { formatDateTime } from "../events/format";
import { isAuthError, statusOf, usePublicEvent } from "../events/queries";
import { QrCode } from "./QrCode";
import { Badge } from "../events/StatusBadge";
import { useMyRegistration } from "./queries";
import { showQr, ticketLabel } from "./ticket";
import { TicketPanel } from "./TicketPanel";

export function TicketPage({ eventId }: { eventId: string }) {
  const event = usePublicEvent(eventId);
  const mine = useMyRegistration(eventId, true);
  // DA41, DA42 (question 18): the event of the URL, so the error state has it too.
  const back = <BackLink to={`/event/${encodeURIComponent(eventId)}`} name="Event" />;

  // Loading until both have answered; a 401/403 re-checks me and the guard decides (W-R13).
  if (
    event.isPending ||
    mine.isPending ||
    (event.isError && event.isFetching) ||
    (mine.isError && (mine.isFetching || isAuthError(mine.error)))
  ) {
    return (
      <section className="card card-message" data-role="user">
        <h1>Your ticket</h1>
        <p role="status" className="status status-gap">
          Loading...
        </p>
      </section>
    );
  }

  if (event.isError && statusOf(event.error) === 404) return <EventNotFound />;

  if (event.isError || mine.isError) {
    return (
      <section className="card card-message" data-role="user">
        {back}
        <h1>Your ticket</h1>
        <p role="alert" className="list-error">
          Could not load your ticket
        </p>
        <p className="intro">Check your connection and try again.</p>
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            if (event.isError) void event.refetch();
            if (mine.isError) void mine.refetch();
          }}
        >
          Retry
        </button>
      </section>
    );
  }

  const eventLink = `/event/${event.data.id}`;

  if (mine.data === null) {
    return (
      <section className="card card-message" data-role="user">
        <h1>Your ticket</h1>
        <p className="intro">You have no ticket for this event.</p>
        <Link to={eventLink} className="button-link">
          Go to the event
        </Link>
      </section>
    );
  }

  return (
    <section className="card card-event ticket-page" data-role="user">
      {back}
      <h1>Your ticket</h1>
      <p className="event-status">
        <Badge {...ticketLabel(mine.data).badge} />
      </p>
      {/* The event name is plain text (user request, D72); the "Event" back link leads there. */}
      <p className="ticket-event">{event.data.title}</p>
      {/* W-EM30: for every ticket status, so a checked-in person (still registered) sees it. */}
      {event.data.status === "cancelled" && (
        <p className="ticket-event-note">This event has been cancelled.</p>
      )}
      <dl className="details">
        <Detail label="Starts">{formatDateTime(event.data.starts_at)}</Detail>
      </dl>
      <TicketPanel registration={mine.data} flat>
        {showQr(mine.data, event.data) && <QrCode code={mine.data.ticket_code} />}
      </TicketPanel>
    </section>
  );
}
