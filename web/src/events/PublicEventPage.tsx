// The public event view (W-E15-W-E18, W-E23): the same event details for nobody, an
// attendee and an organizer who does not own the event. Under them the registration
// area (registration-web.md W-R1-W-R10): logged-out viewers and attendees only.
import { RegistrationArea } from "../registrations/RegistrationArea";
import { formatDateTime, formatDuration } from "./format";
import { PUBLIC_LABEL, isClosed, publicStatus } from "./publicStatus";
import { statusOf, usePublicEvent } from "./queries";
import { Badge } from "./StatusBadge";
import {
  Detail,
  EventDescription,
  EventLoadError,
  EventLoading,
  EventNotFound,
} from "./EventParts";

export function PublicEventView({ id }: { id: string }) {
  const query = usePublicEvent(id);

  if (query.isPending || (query.isError && query.isFetching)) return <EventLoading />;
  if (query.isError) {
    if (statusOf(query.error) === 404) return <EventNotFound />;
    return <EventLoadError onRetry={() => void query.refetch()} />;
  }

  const event = query.data;
  const status = publicStatus(event);
  const closed = isClosed(status);

  return (
    <section className="card card-event" data-role="user">
      <p className="eyebrow">Event</p>
      <h1>{event.title}</h1>
      <p className="event-status">
        <Badge {...PUBLIC_LABEL[status]} />
      </p>
      <EventDescription text={event.description} />
      <dl className="details">
        <Detail label="Starts">{formatDateTime(event.starts_at)}</Detail>
        <Detail label="Ends">{formatDateTime(event.ends_at)}</Detail>
        <Detail label="Duration">{formatDuration(event.duration_minutes)}</Detail>
        {!closed && (
          <Detail label="Seats">{`${event.seats_left} of ${event.capacity} seats left`}</Detail>
        )}
      </dl>
      {closed && (
        <>
          <p className="event-note">{`Capacity: ${event.capacity}`}</p>
          <p className="event-closed">Registration is closed.</p>
        </>
      )}
      <RegistrationArea event={event} />
    </section>
  );
}
