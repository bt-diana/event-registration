// The ticket panel (W-R7), shared by the event page and the ticket page (W-R11).
// A section labelled by its h2; the code is plain selectable text (W-R22).
import { useId, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { Badge } from "../events/StatusBadge";
import type { Registration } from "./api";
import { ticketLabel } from "./ticket";

type Props = {
  registration: Registration;
  // The event page links to the ticket page; the ticket page shows the badge instead.
  viewTicketOf?: string;
  badge?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  // The ticket page puts the QR here (W-R25); the event page has none.
  children?: ReactNode;
};

export function TicketPanel({
  registration,
  viewTicketOf,
  badge = false,
  headingRef,
  children,
}: Props) {
  const headingId = useId();
  const label = ticketLabel(registration);
  return (
    <section className="ticket" aria-labelledby={headingId} data-status={registration.status}>
      <h2 id={headingId} tabIndex={-1} ref={headingRef}>
        {label.heading}
      </h2>
      {badge && (
        <p className="ticket-badge">
          <Badge {...label.badge} />
        </p>
      )}
      {label.place && <p className="ticket-place">{label.place}</p>}
      <dl className="ticket-code-block">
        <dt>Ticket code</dt>
        <dd className="ticket-code">{registration.ticket_code}</dd>
      </dl>
      {label.note && <p className="ticket-note">{label.note}</p>}
      {label.checkedIn && <p className="ticket-checked-in">{label.checkedIn}</p>}
      {children}
      {viewTicketOf !== undefined && (
        <Link
          to={`/registrations/me?event=${encodeURIComponent(viewTicketOf)}`}
          className="action-link ticket-link"
        >
          View ticket
        </Link>
      )}
    </section>
  );
}
