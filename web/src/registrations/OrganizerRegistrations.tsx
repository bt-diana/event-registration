// /registrations for an organizer (registration-web.md W-R20, W-R21). Inside the
// organizer entry (W-R16). The organizer's events feed the selector; the chosen event's
// registrations come from GET /events/{id}/registrations (checkin.md C15-C18), shown in
// the API order, with the "Arrival" column from checked_in_at (checkin-web.md W-C16).
// The arrivals counter sits under the selector (W-C3). Both are read again on every
// return to the page and never by themselves (W-C6, W-C7, W-C8). No role eyebrow (RE1).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { BackLink } from "../events/EventParts";
import { formatDateTime } from "../events/format";
import { isAuthError, statusOf, useEvents } from "../events/queries";
import { Badge } from "../events/StatusBadge";
import type { OrganizerRegistration } from "./api";
import { ArrivalsCounter } from "./ArrivalsCounter";
import { EventSelect, useChosenEvent } from "./EventSelect";
import { useEventRegistrations } from "./queries";
import { ticketLabel } from "./ticket";

const NEW_EVENT = "/organizer/events/new";
// DA44 (question 17): the back link goes to the organizer's events list in every state.
const EVENTS_LIST = "/organizer";

type List = ReturnType<typeof useEventRegistrations>;

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
      {/* design-alignment.md DA14: the error box and a secondary Retry. */}
      <p role="alert" className="error-box status-gap">
        Could not load registrations
      </p>
      <p className="intro">Check your connection and try again.</p>
      <button type="button" className="button-secondary" onClick={onRetry}>
        Retry
      </button>
    </>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <section className="card card-message" data-role="organizer">
      <BackLink to={EVENTS_LIST} name="events" />
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
      <BackLink to={EVENTS_LIST} name="events" />
      <div className="list-head">
        <h1>Registrations</h1>
        {/* design-alignment.md DA13: the chosen event's page, no request of its own. */}
        <div className="list-head-actions">
          <Link to={`/event/${encodeURIComponent(chosen.id)}`} className="text-link">
            Open event page
          </Link>
          <Link
            to={`/registrations/scan?event=${encodeURIComponent(chosen.id)}`}
            className="button-link"
          >
            Check in attendees
          </Link>
        </div>
      </div>
      <EventSelect events={events.data} value={chosen.id} onChange={choose} />
      {/* The list's own 404 text is the page's one "Event not found" (W-C9). */}
      {!listNotFound(list) && <ArrivalsCounter eventId={chosen.id} />}
      <RegistrationsBody list={list} />
    </section>
  );
}

function listNotFound(list: List): boolean {
  return list.isError && statusOf(list.error) === 404;
}

function RegistrationsBody({ list }: { list: List }) {
  if (list.isError && isAuthError(list.error)) return <Loading />;
  if (listNotFound(list)) {
    return (
      <>
        <p role="alert" className="list-error">
          Event not found
        </p>
        <p className="intro">This link is not valid or the event does not exist.</p>
      </>
    );
  }
  const { data } = list;
  if (data === undefined) {
    if (list.isError && !list.isFetching) return <LoadError onRetry={() => void list.refetch()} />;
    return <Loading />;
  }
  // A return shows the cached rows while the list is read again; a failed read keeps
  // them with a note (checkin-web.md W-C10).
  const note = list.isError && <p className="refresh-note">Could not refresh</p>;
  if (data.length === 0) {
    return (
      <>
        {note}
        <p className="intro">No one has registered for this event yet.</p>
      </>
    );
  }
  return (
    <>
      {note}
      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <th scope="col">Place</th>
              <th scope="col">Arrival</th>
              <th scope="col">Ticket code</th>
              <th scope="col">Registered</th>
            </tr>
          </thead>
          <tbody>
            {data.map((registration) => (
              <Row key={registration.id} registration={registration} />
            ))}
          </tbody>
        </table>
      </div>
    </>
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
      <td>
        <Arrival registration={registration} />
      </td>
      <td className="table-code">{registration.ticket_code}</td>
      <td>{formatDateTime(registration.created_at)}</td>
    </tr>
  );
}

// W-C16: "Arrived" and the time, "Not yet", or nothing for the waiting list. Only from
// the row, so it is as fresh as the list.
function Arrival({ registration }: { registration: OrganizerRegistration }) {
  if (registration.status === "waitlisted") return null;
  if (registration.checked_in_at === null) return <>Not yet</>;
  return (
    <>
      Arrived
      <time className="table-note table-time" dateTime={registration.checked_in_at}>
        {formatDateTime(registration.checked_in_at)}
      </time>
    </>
  );
}
