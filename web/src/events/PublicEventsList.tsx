// `/`, the attendee home: the public events list (events-public-list-web.md W-L1-W-L13).
// No guard, for every role. Waits for me, then makes one list request; an organizer
// stays on / and gets the organizer look from the header (W-L8, W-L9, D60).
// No role eyebrow: the header shows the role (RE1).
import { Link } from "react-router";
import { useMe } from "../auth/session";
import type { PublicListItem } from "./api";
import { formatDateTime, formatDuration } from "./format";
import { PUBLIC_LABEL, publicStatus } from "./publicStatus";
import { isAuthError, usePublicEvents } from "./queries";
import { Badge, type Tone } from "./StatusBadge";

// W-L3: first match wins (W-E17); an open event shows its seats instead of "Open".
function badgeOf(event: PublicListItem): { text: string; tone: Tone } {
  const status = publicStatus(event);
  if (status === "open") {
    return { text: `${event.seats_left} of ${event.capacity} seats left`, tone: "open" };
  }
  return PUBLIC_LABEL[status];
}

function EventCard({ event }: { event: PublicListItem }) {
  return (
    <li className="event-card">
      {/* One real link; the whole card is clickable through it (CSS). */}
      <Link to={`/event/${event.id}`} className="event-card-link">
        {event.title}
      </Link>
      <p className="event-card-meta">
        <span>{formatDateTime(event.starts_at)}</span>
        <span aria-hidden="true"> &middot; </span>
        <span>{formatDuration(event.duration_minutes)}</span>
      </p>
      <span className="event-card-badge">
        <Badge {...badgeOf(event)} />
      </span>
    </li>
  );
}

export function PublicEventsList() {
  const me = useMe();
  // me 401 is null (logged out); a me error is treated as logged out (W-L9).
  const events = usePublicEvents(!me.isPending);

  if (me.isPending) {
    return (
      <section className="public-list" data-role="user">
        <p role="status" className="status">
          Loading...
        </p>
      </section>
    );
  }

  // A 401/403 re-checks me and shows no text of its own (W-L10).
  if (events.isPending || (events.isError && isAuthError(events.error))) {
    return (
      <section className="card card-message" data-role="user">
        <h1>Events</h1>
        <p role="status" className="status status-gap">
          Loading...
        </p>
      </section>
    );
  }

  // The Retry button stays during the refetch, so the focus stays on it (W-L12).
  if (events.isError) {
    return (
      <section className="card card-message" data-role="user">
        <h1>Events</h1>
        <p role="alert" className="list-error">
          Could not load events
        </p>
        <p className="intro">Check your connection and try again.</p>
        <button type="button" className="button-primary" onClick={() => void events.refetch()}>
          Retry
        </button>
        {events.isFetching && (
          <p role="status" className="status status-gap">
            Loading...
          </p>
        )}
      </section>
    );
  }

  if (events.data.length === 0) {
    return (
      <section className="card card-message" data-role="user">
        <h1>Events</h1>
        <p className="intro">No upcoming events.</p>
      </section>
    );
  }

  return (
    <section className="public-list" data-role="user">
      <h1>Events</h1>
      <ul className="event-cards">
        {events.data.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </ul>
    </section>
  );
}
