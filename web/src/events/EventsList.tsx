// /organizer: the organizer's events (W-E1-W-E3, W-E20, W-E21). Inside RequireRole.
import { Link } from "react-router";
import { formatDateTime } from "./format";
import { isAuthError, useEvents } from "./queries";
import { EventStatusBadge } from "./StatusBadge";

const NEW_EVENT = "/organizer/events/new";

export function EventsList() {
  const events = useEvents();

  // A 401/403 re-checks me and the guard takes over (W-E13), so no error of our own.
  if (
    events.isPending ||
    (events.isError && (events.isFetching || isAuthError(events.error)))
  ) {
    return (
      <section className="card card-message" data-role="organizer">
        <h1>Your events</h1>
        <p role="status" className="status status-gap">
          Loading...
        </p>
      </section>
    );
  }

  if (events.isError) {
    return (
      <section className="card card-message" data-role="organizer">
        <h1>Could not load your events</h1>
        <p className="intro">Check your connection and try again.</p>
        <button type="button" className="button-primary" onClick={() => void events.refetch()}>
          Retry
        </button>
      </section>
    );
  }

  if (events.data.length === 0) {
    return (
      <section className="card card-message" data-role="organizer">
        <h1>Your events</h1>
        <p className="intro">You have no events yet.</p>
        <Link to={NEW_EVENT} className="button-link">
          Create event
        </Link>
      </section>
    );
  }

  return (
    <section className="list-page" data-role="organizer">
      <div className="list-head">
        <h1>Your events</h1>
        <Link to={NEW_EVENT} className="button-link">
          Create event
        </Link>
      </div>
      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Starts</th>
              <th scope="col">Status</th>
              <th scope="col">Registered</th>
            </tr>
          </thead>
          <tbody>
            {events.data.map((event) => (
              <tr key={event.id}>
                <td>
                  <Link to={`/event/${event.id}`} className="action-link">
                    {event.title}
                  </Link>
                </td>
                <td>{formatDateTime(event.starts_at)}</td>
                <td>
                  <EventStatusBadge status={event.status} />
                </td>
                <td>{`${event.registered} / ${event.capacity}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
