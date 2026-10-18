// /registrations/me for an attendee (W-R15). With `event`: the ticket page (W-R11).
// Without it, or with an empty `event`: the list of all my registrations from
// GET /me/registrations (registration-web.md W-R18, W-R19, W-R39-W-R41, board S3). Rows
// in the API order (no sorting, filtering or deduplication), keyed by the registration
// id, no ticket code; each card is one link to its ticket page. No role eyebrow (RE1), no
// back link (DA45: a top-level screen).
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { formatDateTime } from "../events/format";
import { isAuthError } from "../events/queries";
import { Badge, type Tone } from "../events/StatusBadge";
import type { MyRegistration } from "./api";
import { useMyRegistrations } from "./queries";
import { eventStatusBadge, listStatusText, ticketLabel } from "./ticket";
import { TicketPage } from "./TicketPage";

// The extra event badge has the colours of Cancelled and Ended (brand.md, W-R40).
const EVENT_TONE: Record<MyRegistration["event_status"], Tone> = {
  active: "open",
  cancelled: "cancelled",
  passed: "muted",
};

export function MyRegistrations() {
  const [params] = useSearchParams();
  const eventId = params.get("event") ?? "";
  if (eventId !== "") return <TicketPage key={eventId} eventId={eventId} />;
  return <RegistrationsList />;
}

function Message({ children }: { children: ReactNode }) {
  return (
    <section className="card card-message" data-role="user">
      <h1>My registrations</h1>
      {children}
    </section>
  );
}

function RegistrationsList() {
  const list = useMyRegistrations();

  // A 401/403 re-checks me and shows no text of its own; the guard then redirects (W-R41).
  if (list.isPending || (list.isError && (list.isFetching || isAuthError(list.error)))) {
    return (
      <Message>
        <p role="status" className="status status-gap">
          Loading...
        </p>
      </Message>
    );
  }

  if (list.isError) {
    return (
      <Message>
        <p role="alert" className="error-box status-gap">
          Could not load your registrations
        </p>
        <p className="intro">Check your connection and try again.</p>
        <button type="button" className="button-secondary" onClick={() => void list.refetch()}>
          Retry
        </button>
      </Message>
    );
  }

  if (list.data.length === 0) {
    return (
      <Message>
        <p className="intro">You have no registrations yet.</p>
        <Link to="/" className="button-link">
          Go home
        </Link>
      </Message>
    );
  }

  return (
    <section className="public-list" data-role="user">
      <h1>My registrations</h1>
      <ul className="event-cards">
        {list.data.map((registration) => (
          <Row key={registration.id} registration={registration} />
        ))}
      </ul>
    </section>
  );
}

// The whole card is one link to the ticket page (W-R18, W-R22, S3). Its name comes from its
// content: the title (plain text), the start, then the badges (plain spans), so it reads
// "Spring Meetup Sat, 1 Jan 2030, 10:00 CET Registered". Nothing interactive inside, no
// link to the event page. The spaces between the parts are for that name only (whitespace
// between grid and flex items is not drawn). Two rows of one event have the same target
// and differ by their start and badges.
function Row({ registration }: { registration: MyRegistration }) {
  const event = encodeURIComponent(registration.event_id);
  const eventBadge = eventStatusBadge(registration.event_status);
  return (
    <li>
      <Link to={`/registrations/me?event=${event}`} className="registration-card">
        <span className="registration-card-title">{registration.event_title}</span>{" "}
        <span className="event-card-meta">
          <time dateTime={registration.event_starts_at}>
            {formatDateTime(registration.event_starts_at)}
          </time>
        </span>{" "}
        <span className="registration-card-badges">
          <Badge text={listStatusText(registration)} tone={ticketLabel(registration).badge.tone} />
          {eventBadge && (
            <>
              {" "}
              <Badge text={eventBadge} tone={EVENT_TONE[registration.event_status]} />
            </>
          )}
        </span>
      </Link>
    </li>
  );
}
