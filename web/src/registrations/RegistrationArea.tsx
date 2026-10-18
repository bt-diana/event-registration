// The registration area on the public event view (registration-web.md W-R1-W-R10, W-R22).
// Only for a logged-out viewer or an attendee; an organizer gets nothing (W-R1).
// "Registration is closed." for a closed event is the view's own line (W-E17), shown once.
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useMe } from "../auth/session";
import type { PublicEvent } from "../events/api";
import { isClosed, publicStatus } from "../events/publicStatus";
import { isAuthError, statusOf } from "../events/queries";
import { useMyRegistration, useRegister } from "./queries";
import { registerAction, type RegisterAction } from "./ticket";
import { TicketPanel } from "./TicketPanel";

type Props = { event: PublicEvent };

export function RegistrationArea({ event }: Props) {
  const me = useMe();
  // The event page has waited for me. A failed me is neither logged out nor an attendee.
  if (me.data === undefined) return null;
  if (me.data === null) return <LoggedOutArea event={event} />;
  if (me.data.role !== "user") return null;
  // A new account gets a fresh area: no ticket, error or pending state of the last one.
  return <AttendeeArea key={me.data.id} meId={me.data.id} event={event} />;
}

// W-R2: a link to the login that comes back to this page; no registration request.
function LoggedOutArea({ event }: Props) {
  if (isClosed(publicStatus(event))) return null;
  const next = encodeURIComponent(`/event/${event.id}`);
  return (
    <div className="registration-area">
      {event.full && <p className="registration-hint">This event is full.</p>}
      <Link to={`/login?next=${next}`} className="button-link">
        {event.full ? "Log in to join the waiting list" : "Log in to register"}
      </Link>
    </div>
  );
}

const LABEL: Record<Exclude<RegisterAction, "none">, { idle: string; pending: string }> = {
  register: { idle: "Register", pending: "Registering..." },
  "register-again": { idle: "Register again", pending: "Registering..." },
  waitlist: { idle: "Join waiting list", pending: "Joining..." },
};

function AttendeeArea({ meId, event }: Props & { meId: string }) {
  const mine = useMyRegistration(event.id, true);
  const registerCall = useRegister(event.id);
  // Blocks a second click before the pending state has rendered (W-R5).
  const sending = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // W-R22: after success the focus goes to the ticket heading, after an error to its text.
  useEffect(() => {
    if (registerCall.isSuccess) headingRef.current?.focus();
    if (registerCall.isError) errorRef.current?.focus();
  }, [registerCall.isSuccess, registerCall.isError]);

  // W-R10 and W-R13: a 401/403 re-checks me and shows no text of its own.
  if (mine.isPending || (mine.isError && (mine.isFetching || isAuthError(mine.error)))) {
    return (
      <div className="registration-area">
        <p role="status" className="status">
          Loading...
        </p>
      </div>
    );
  }

  if (mine.isError) {
    return (
      <div className="registration-area">
        <p role="alert" className="error-box">
          Could not load your registration
        </p>
        <button type="button" className="button-secondary" onClick={() => void mine.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const registration = mine.data;
  const action = registerAction(event, registration);
  const errorStatus = registerCall.isError ? statusOf(registerCall.error) : null;
  // 409: closed until the fresh event says so (then the view's own line takes over).
  // 404: the fresh event read turns the page into "Event not found".
  const stopped = errorStatus === 409 || errorStatus === 404;
  const showButton = action !== "none" && !stopped;
  const failed =
    errorStatus !== null &&
    !stopped &&
    errorStatus !== 401 &&
    errorStatus !== 403;

  function onRegister() {
    if (sending.current) return;
    sending.current = true;
    registerCall.mutate(meId, {
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  return (
    <div className="registration-area">
      {registration && (
        // The result of a register call is announced (W-R22).
        <div role="status">
          <TicketPanel registration={registration} viewTicketOf={event.id} headingRef={headingRef} />
        </div>
      )}
      {showButton && action === "waitlist" && (
        <p className="registration-hint">This event is full.</p>
      )}
      {errorStatus === 409 && !isClosed(publicStatus(event)) && (
        <p role="alert" tabIndex={-1} ref={errorRef} className="error-box">
          Registration is closed.
        </p>
      )}
      {failed && (
        <p role="alert" tabIndex={-1} ref={errorRef} className="error-box">
          Something went wrong. Try again.
        </p>
      )}
      {showButton && (
        <button
          type="button"
          className="button-primary registration-button"
          disabled={registerCall.isPending}
          aria-busy={registerCall.isPending ? "true" : undefined}
          onClick={onRegister}
        >
          {registerCall.isPending ? LABEL[action].pending : LABEL[action].idle}
        </button>
      )}
    </div>
  );
}
