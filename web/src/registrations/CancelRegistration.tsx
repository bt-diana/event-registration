// The "Cancel registration" section of the ticket page (cancel-registration-web.md
// W-CR1-W-CR7, W-CR10-W-CR12): a button, an in-place confirm panel, the pending state and
// one message. Always mounted by TicketPage when a ticket exists, so the message outlives
// the controls; the controls show only when canCancel. No library, no window.confirm, no
// dialog element. The server decides (409 codes); the page then corrects itself.
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { useMe } from "../auth/session";
import type { PublicEvent } from "../events/api";
import { isAuthError, statusOf } from "../events/queries";
import type { CancelConflict, Registration } from "./api";
import { useCancelRegistration } from "./queries";
import { canCancel } from "./ticket";

type Active = "registered" | "waitlisted";

const WORDING: Record<Active, { heading: string; text: string; done: string }> = {
  registered: {
    heading: "Cancel your registration?",
    text: "Your seat goes to the next person on the waiting list. If you register again later and the event is full, you join the end of the waiting list.",
    done: "Registration cancelled. Your seat is free for someone else.",
  },
  waitlisted: {
    heading: "Leave the waiting list?",
    text: "You lose your place. If you join again later, you go to the end of the list.",
    done: "Registration cancelled. You are no longer on the waiting list.",
  },
};

const CONFLICT: Record<CancelConflict, string> = {
  already_checked_in: "You have already checked in, so this registration cannot be cancelled.",
  event_started: "This event has already started, so the registration can no longer be cancelled.",
  event_passed: "This event has ended, so the registration can no longer be cancelled.",
  event_cancelled: "This event has been cancelled.",
};

const FAILED = "Something went wrong. Try again.";

type Message = { role: "status" | "alert"; text: string };
type FocusTarget = "message" | "keep" | "cancel";

type Props = {
  registration: Registration;
  event: Pick<PublicEvent, "status" | "has_started">;
  eventId: string;
};

export function CancelRegistration({ registration, event, eventId }: Props) {
  const headingId = useId();
  const me = useMe();
  const cancel = useCancelRegistration(eventId);
  // The status when the panel opened picks the wording and the success text (W-CR3, W-CR5).
  const [confirming, setConfirming] = useState<Active | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; n: number } | null>(
    null,
  );
  // W-CR4: a second click sends nothing, also before the pending state has rendered.
  const sending = useRef(false);
  const refs = {
    message: useRef<HTMLParagraphElement>(null),
    keep: useRef<HTMLButtonElement>(null),
    cancel: useRef<HTMLButtonElement>(null),
  };

  // Focus moves after the target is on screen (W-CR12).
  useEffect(() => {
    if (!focusRequest) return;
    refs[focusRequest.target].current?.focus();
  }, [focusRequest]); // refs are stable; only a new request moves focus

  function focus(target: FocusTarget) {
    setFocusRequest((previous) => ({ target, n: (previous?.n ?? 0) + 1 }));
  }

  function show(role: Message["role"], text: string) {
    setMessage({ role, text });
    focus("message");
  }

  function open() {
    if (registration.status === "cancelled") return;
    setMessage(null);
    setConfirming(registration.status);
    focus("keep");
  }

  function keep() {
    setConfirming(null);
    focus("cancel");
  }

  function confirm(was: Active) {
    if (sending.current) return;
    const meId = me.data?.id;
    if (!meId) return;
    sending.current = true;
    cancel.mutate(meId, {
      onSuccess: (result) => {
        setConfirming(null);
        if (result.outcome === "cancelled") show("status", WORDING[was].done);
        else show("alert", CONFLICT[result.outcome]);
      },
      onError: (error) => {
        setConfirming(null);
        // 401/403: the guard takes over; 404: the page shows no ticket. No text (W-CR7).
        if (isAuthError(error) || statusOf(error) === 404) return;
        show("alert", FAILED);
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  const allowed = canCancel(registration, event);
  if (!allowed && message === null) return null;

  return (
    <div className="cancel-registration">
      {message && (
        <p
          ref={refs.message}
          role={message.role}
          tabIndex={-1}
          className={message.role === "alert" ? "error-box cancel-message" : "cancel-message"}
        >
          {message.text}
        </p>
      )}
      {message?.role === "status" && (
        <Link to={`/event/${encodeURIComponent(eventId)}`} className="button-link">
          Go to the event
        </Link>
      )}
      {allowed &&
        (confirming ? (
          <div
            role="group"
            aria-labelledby={headingId}
            aria-busy={cancel.isPending ? true : undefined}
            className="cancel-confirm"
          >
            <h2 id={headingId} className="schedule-heading">
              {WORDING[confirming].heading}
            </h2>
            <p className="confirm-text">{WORDING[confirming].text}</p>
            <div className="cancel-confirm-actions">
              <button
                type="button"
                className="button-primary"
                disabled={cancel.isPending}
                onClick={() => confirm(confirming)}
              >
                {cancel.isPending ? "Cancelling..." : "Yes, cancel registration"}
              </button>
              <button
                ref={refs.keep}
                type="button"
                className="button-secondary"
                disabled={cancel.isPending}
                onClick={keep}
              >
                Keep registration
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={refs.cancel}
            type="button"
            className="button-secondary cancel-registration-button"
            onClick={open}
          >
            Cancel registration
          </button>
        ))}
    </div>
  );
}
