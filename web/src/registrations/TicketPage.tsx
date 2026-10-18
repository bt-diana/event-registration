// The ticket page /registrations/me?event={id} (registration-web.md W-R11-W-R13).
// Inside the attendee entry (W-R15). Both reads start together; no button here.
// No role eyebrow (RE1).
import { Link } from "react-router";
import { EventNotFound, Detail } from "../events/EventParts";
import { formatDateTime } from "../events/format";
import { PUBLIC_LABEL, publicStatus } from "../events/publicStatus";
import { isAuthError, statusOf, usePublicEvent } from "../events/queries";
import { Badge } from "../events/StatusBadge";
import { useMyRegistration } from "./queries";
import { TicketPanel } from "./TicketPanel";

export function TicketPage({ eventId }: { eventId: string }) {
  const event = usePublicEvent(eventId);
  const mine = useMyRegistration(eventId, true);

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
      <h1>Your ticket</h1>
      <p className="ticket-event">
        <Link to={eventLink} className="action-link">
          {event.data.title}
        </Link>
      </p>
      <dl className="details">
        <Detail label="Starts">{formatDateTime(event.data.starts_at)}</Detail>
      </dl>
      <p className="event-status">
        <Badge {...PUBLIC_LABEL[publicStatus(event.data)]} />
      </p>
      <TicketPanel registration={mine.data} badge />
    </section>
  );
}
