// The ticket panel (W-R7), shared by the event page and the ticket page (W-R11).
// A section labelled by its h2; the code is plain selectable text (W-R22), and it is left
// out once the ticket is checked in (W-R25).
import { useId, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import type { Registration } from "./api";
import { ticketLabel } from "./ticket";

type Props = {
  registration: Registration;
  // The event page links to the ticket page; the ticket page has its own page layout.
  viewTicketOf?: string;
  // The ticket page (W-R38): no heading and no box, the parts sit in the card itself.
  flat?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  // The ticket page puts the QR here (W-R25); the event page has none.
  children?: ReactNode;
};

export function TicketPanel({
  registration,
  viewTicketOf,
  flat = false,
  headingRef,
  children,
}: Props) {
  const headingId = useId();
  const label = ticketLabel(registration);
  const Root = flat ? "div" : "section";
  return (
    <Root
      className={flat ? "ticket-flat" : "ticket"}
      aria-labelledby={flat ? undefined : headingId}
      data-status={registration.status}
    >
      {!flat && (
        <h2 id={headingId} tabIndex={-1} ref={headingRef}>
          {label.heading}
        </h2>
      )}
      {label.place && <p className="ticket-place">{label.place}</p>}
      {/* W-R25: a checked-in ticket shows no code at all (keys on checked_in_at only). */}
      {registration.checked_in_at === null && (
        <dl className="ticket-code-block">
          <dt>Ticket code</dt>
          <dd className="ticket-code">{registration.ticket_code}</dd>
        </dl>
      )}
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
    </Root>
  );
}
