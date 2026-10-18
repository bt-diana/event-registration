// /event/:id, no guard (W-E10, W-E11). One link for everyone: the owner sees the
// organizer view, everybody else the public view. Waits for me before any event request.
// The owner view is no longer read only (email-reminders-web.md M7 assumptions): while the
// event is active and in the future it has the reschedule and cancel controls (W-EM16).
import { Link, useParams } from "react-router";
import { useMe } from "../auth/session";
import type { OrganizerEvent } from "./api";
import { EventSchedule } from "./EventSchedule";
import { formatDateTime, formatDuration } from "./format";
import { PublicEventView } from "./PublicEventPage";
import { isAuthError, statusOf, useEvent } from "./queries";
import { EventStatusBadge } from "./StatusBadge";
import { BackLink, Detail, EventDescription, EventLoadError, EventLoading } from "./EventParts";

export function EventPage() {
  const { id = "" } = useParams();
  const me = useMe();

  if (me.isPending || (me.isError && me.isFetching)) return <EventLoading />;
  // Logged out, an attendee, or me failed: the public view, no organizer request.
  if (me.data?.role !== "organizer") return <PublicEventView id={id} />;
  return <OwnerOrPublic id={id} />;
}

function OwnerOrPublic({ id }: { id: string }) {
  const query = useEvent(id);

  // A 401/403 re-checks me; the page then picks its view again (W-E13).
  if (
    query.isPending ||
    (query.isError && (query.isFetching || isAuthError(query.error)))
  ) {
    return <EventLoading />;
  }
  if (query.isError) {
    // Not theirs or unknown: the same 404, so the public view decides (W-E11).
    if (statusOf(query.error) === 404) return <PublicEventView id={id} />;
    return <EventLoadError backTo="/organizer" onRetry={() => void query.refetch()} />;
  }
  return <OrganizerEventView event={query.data} />;
}

// Real numbers for every status (events.md E10). The M7 section sits between the
// "Registrations" link and the share line (W-EM33).
function OrganizerEventView({ event }: { event: OrganizerEvent }) {
  const link = `/event/${event.id}`;
  return (
    <section className="card card-event" data-role="organizer">
      <BackLink to="/organizer" name="Events" />
      <h1>{event.title}</h1>
      <p className="event-status">
        <EventStatusBadge status={event.status} />
      </p>
      <EventDescription text={event.description} />
      <dl className="details">
        <Detail label="Starts">{formatDateTime(event.starts_at)}</Detail>
        <Detail label="Ends">{formatDateTime(event.ends_at)}</Detail>
        <Detail label="Duration">{formatDuration(event.duration_minutes)}</Detail>
        <Detail label="Capacity">{String(event.capacity)}</Detail>
        <Detail label="Registered">{String(event.registered)}</Detail>
        <Detail label="Seats left">{String(event.seats_left)}</Detail>
        <Detail label="Created">{formatDateTime(event.created_at)}</Detail>
      </dl>
      {/* design-alignment.md DA7: 24 px above (from the dl) and below (to the share line). */}
      <Link
        to={`/registrations?event=${encodeURIComponent(event.id)}`}
        className="button-link event-registrations-link"
      >
        Registrations
      </Link>
      {/* Keyed by the event, so a message never carries over to another event's page. */}
      <EventSchedule key={event.id} event={event} />
      <p className="share">
        Share link (same for everyone, others see the public view):{" "}
        <Link to={link} className="action-link">
          {link}
        </Link>
      </p>
    </section>
  );
}
