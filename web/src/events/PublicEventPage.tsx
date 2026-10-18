// The public event view (W-E15-W-E18, W-E23): the same for nobody, an attendee and an
// organizer who does not own the event. Read only: no register button in M2.
import { formatDateTime, formatDuration } from "./format";
import { isClosed, publicStatus, type PublicStatus } from "./publicStatus";
import { statusOf, usePublicEvent } from "./queries";
import { Badge, type Tone } from "./StatusBadge";
import {
  Detail,
  EventDescription,
  EventLoadError,
  EventLoading,
  EventNotFound,
} from "./EventParts";

const LABEL: Record<PublicStatus, { text: string; tone: Tone }> = {
  open: { text: "Open", tone: "open" },
  full: { text: "Full", tone: "full" },
  started: { text: "Already started", tone: "muted" },
  cancelled: { text: "Cancelled", tone: "cancelled" },
  ended: { text: "Ended", tone: "muted" },
};

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
        <Badge {...LABEL[status]} />
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
    </section>
  );
}
