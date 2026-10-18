// /registrations for an organizer (registration-web.md W-R20, W-R21). Inside the
// organizer entry (W-R16). The organizer's events feed the selector; the chosen event's
// registrations come from GET /events/{id}/registrations (checkin.md C15-C18), shown in
// the API order. No role eyebrow (RE1).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../events/format";
import { isAuthError, statusOf, useEvents } from "../events/queries";
import { Badge } from "../events/StatusBadge";
import type { OrganizerRegistration } from "./api";
import { EventSelect, useChosenEvent } from "./EventSelect";
import { useEventRegistrations } from "./queries";
import { ticketLabel } from "./ticket";

const NEW_EVENT = "/organizer/events/new";

function Loading() {
  return (
    <p role="status" className="status status-gap">
      Loading...
    </p>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p role="alert" className="list-error">
        Could not load registrations
      </p>
      <p className="intro">Check your connection and try again.</p>
      <button type="button" className="button-primary" onClick={onRetry}>
        Retry
      </button>
    </>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <section className="card card-message" data-role="organizer">
      <h1>Registrations</h1>
      {children}
    </section>
  );
}

export function OrganizerRegistrations() {
  const events = useEvents();
  const [chosen, choose] = useChosenEvent(events.data);
  const list = useEventRegistrations(chosen?.id ?? null);

  // A 401/403 re-checks me and the guard takes over (W-R13), so no error of our own.
  if (events.isPending || (events.isError && (events.isFetching || isAuthError(events.error)))) {
    return (
      <Message>
        <Loading />
      </Message>
    );
  }

  if (events.isError) {
    return (
      <Message>
        <LoadError onRetry={() => void events.refetch()} />
      </Message>
    );
  }

  if (chosen === null) {
    return (
      <Message>
        <p className="intro">You have no events yet.</p>
        <Link to={NEW_EVENT} className="button-link">
          Create event
        </Link>
      </Message>
    );
  }

  return (
    <section className="list-page registrations-page" data-role="organizer">
      <div className="list-head">
        <h1>Registrations</h1>
        <Link
          to={`/registrations/scan?event=${encodeURIComponent(chosen.id)}`}
          className="button-link"
        >
          Check in attendees
        </Link>
      </div>
      <EventSelect events={events.data} value={chosen.id} onChange={choose} />
      <RegistrationsBody list={list} />
    </section>
  );
}

function RegistrationsBody({ list }: { list: ReturnType<typeof useEventRegistrations> }) {
  if (list.isPending || (list.isError && (list.isFetching || isAuthError(list.error)))) {
    return <Loading />;
  }
  if (list.isError && statusOf(list.error) === 404) {
    return (
      <>
        <p role="alert" className="list-error">
          Event not found
        </p>
        <p className="intro">This link is not valid or the event does not exist.</p>
      </>
    );
  }
  if (list.isError) return <LoadError onRetry={() => void list.refetch()} />;
  if (list.data.length === 0) {
    return <p className="intro">No one has registered for this event yet.</p>;
  }
  return (
    <div className="table-card">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Status</th>
            <th scope="col">Place</th>
            <th scope="col">Ticket code</th>
            <th scope="col">Registered</th>
          </tr>
        </thead>
        <tbody>
          {list.data.map((registration) => (
            <Row key={registration.id} registration={registration} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ registration }: { registration: OrganizerRegistration }) {
  const label = ticketLabel(registration);
  return (
    <tr>
      <td>{registration.attendee_name}</td>
      <td>{registration.attendee_email}</td>
      <td>
        <Badge {...label.badge} />
        {label.checkedIn && <span className="table-note">{label.checkedIn}</span>}
      </td>
      <td>{registration.waitlist_position ?? ""}</td>
      <td className="table-code">{registration.ticket_code}</td>
      <td>{formatDateTime(registration.created_at)}</td>
    </tr>
  );
}
