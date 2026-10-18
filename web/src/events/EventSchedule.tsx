// The M7 section of the owner view of /event/:id (email-reminders-web.md W-EM16-W-EM28,
// W-EM33): the reschedule form, "Cancel event" with an in-place confirm panel, and the
// result message. Always mounted in the owner view, so the message stays when the controls
// go away after a success or a 409. The browser clock only hides the controls; the server
// decides (409 event_started). No library, no window.confirm, no dialog element.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { EventActionError, type OrganizerEvent } from "./api";
import { localToIso, localZoneName, toLocalInput } from "./format";
import { isAuthError, isMoved, statusOf, useCancelEvent, useRescheduleEvent } from "./queries";
import { ERRORS, validateStart } from "./validate";

const TEXT = {
  same: "That is already the start time. Nothing changed.",
  rescheduled: "Event rescheduled. Emails to registered and waiting people are queued.",
  confirm:
    "All registrations and the waiting list are cancelled and those people get an email. People who already checked in keep their ticket. This cannot be undone.",
  cancelled: "Event cancelled. Registrations are cancelled and emails to those people are queued.",
  alreadyCancelled: "This event is already cancelled.",
  failed: "Something went wrong. Try again.",
};

// 409 texts by the error code of the body (W-EM23, W-EM27); an unknown code is TEXT.failed.
const RESCHEDULE_CONFLICT: Record<string, string> = {
  event_cancelled: "This event is cancelled and cannot be changed.",
  event_passed: "This event has already ended and cannot be changed.",
  event_started: "This event has already started and cannot be changed.",
};

const CANCEL_CONFLICT: Record<string, string> = {
  event_started: "This event has already started and cannot be cancelled.",
  event_passed: "This event has already ended and cannot be cancelled.",
};

type Message = { role: "status" | "alert"; text: string };
type FocusTarget = "field" | "message" | "keep" | "cancel";

function codeOf(error: unknown): string {
  return error instanceof EventActionError ? error.code : "";
}

function conflictText(texts: Record<string, string>, error: unknown): string {
  const code = codeOf(error);
  return Object.hasOwn(texts, code) ? texts[code] : TEXT.failed;
}

// W-EM16: only an active event that starts later than the browser clock at render time.
function canChange(event: OrganizerEvent): boolean {
  return event.status === "active" && Date.parse(event.starts_at) > Date.now();
}

export function EventSchedule({ event }: { event: OrganizerEvent }) {
  const id = useId();
  const reschedule = useRescheduleEvent(event.id);
  const cancel = useCancelEvent(event.id);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; n: number } | null>(
    null,
  );
  // Neither call is safe to send twice: a second submit or click while one runs sends
  // nothing (W-EM20, W-EM25), also before the pending state has rendered.
  const rescheduling = useRef(false);
  const cancelling = useRef(false);
  const refs = {
    field: useRef<HTMLInputElement>(null),
    message: useRef<HTMLParagraphElement>(null),
    keep: useRef<HTMLButtonElement>(null),
    cancel: useRef<HTMLButtonElement>(null),
  };
  const [minStart] = useState(() => toLocalInput(new Date()));
  const [zone] = useState(() => localZoneName());

  const fieldId = `${id}-start`;
  const hintId = `${id}-start-hint`;
  const errorId = `${id}-start-error`;
  const confirmId = `${id}-confirm`;

  // Focus moves after the target is on screen (W-EM33).
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

  function showFieldError() {
    setFieldError(ERRORS.start);
    focus("field");
  }

  function onReschedule(submitted: FormEvent<HTMLFormElement>) {
    submitted.preventDefault();
    if (rescheduling.current) return;
    setMessage(null);

    // W-EM18: none of these sends a request; the server still decides.
    if (validateStart(value, new Date())) {
      showFieldError();
      return;
    }
    setFieldError(null);
    const startsAt = localToIso(value) ?? "";
    if (Date.parse(startsAt) === Date.parse(event.starts_at)) {
      show("status", TEXT.same);
      return;
    }

    rescheduling.current = true;
    const input = { startsAt, shownVersion: event.schedule_version };
    reschedule.mutate(input, {
      onSuccess: (answer) => {
        if (isMoved(answer, input)) {
          setValue("");
          show("status", TEXT.rescheduled);
        } else {
          show("status", TEXT.same);
        }
      },
      onError: (error) => {
        const status = statusOf(error);
        // 401/403: the guard takes over; 404: the page falls back (W-EM23). No text.
        if (isAuthError(error) || status === 404) return;
        if (status === 400) {
          showFieldError();
          return;
        }
        show("alert", status === 409 ? conflictText(RESCHEDULE_CONFLICT, error) : TEXT.failed);
      },
      onSettled: () => {
        rescheduling.current = false;
      },
    });
  }

  function openConfirm() {
    setConfirming(true);
    focus("keep");
  }

  function keepEvent() {
    setConfirming(false);
    focus("cancel");
  }

  function onConfirm() {
    if (cancelling.current) return;
    cancelling.current = true;
    setMessage(null);
    cancel.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        show("status", TEXT.cancelled);
      },
      onError: (error) => {
        setConfirming(false);
        const status = statusOf(error);
        if (isAuthError(error) || status === 404) return;
        // Not expected (the API answers 200, ER76): shown as the cancelled state.
        if (status === 409 && codeOf(error) === "event_cancelled") {
          show("status", TEXT.alreadyCancelled);
          return;
        }
        show("alert", status === 409 ? conflictText(CANCEL_CONFLICT, error) : TEXT.failed);
      },
      onSettled: () => {
        cancelling.current = false;
      },
    });
  }

  const open = canChange(event);
  if (!open && message === null) return null;

  return (
    <div className="event-schedule">
      {message && (
        <p
          ref={refs.message}
          role={message.role}
          tabIndex={-1}
          className={message.role === "alert" ? "form-error schedule-message" : "schedule-message"}
        >
          {message.text}
        </p>
      )}
      {open && (
        <section className="schedule-controls" aria-label="Change the event">
          <form className="form" onSubmit={onReschedule} noValidate>
            <h2 className="schedule-heading">Reschedule</h2>
            <div className="field">
              <label htmlFor={fieldId}>New start</label>
              <input
                ref={refs.field}
                id={fieldId}
                type="datetime-local"
                min={minStart}
                value={value}
                onChange={(changed) => setValue(changed.target.value)}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={[fieldError ? errorId : undefined, hintId]
                  .filter(Boolean)
                  .join(" ")}
              />
              {fieldError && (
                <p id={errorId} className="field-error" role="alert">
                  {fieldError}
                </p>
              )}
              <p id={hintId} className="hint">
                {`Your local time (${zone})`}
              </p>
            </div>
            <button type="submit" className="button-primary" disabled={reschedule.isPending}>
              {reschedule.isPending ? "Rescheduling..." : "Reschedule"}
            </button>
          </form>

          {confirming ? (
            <div role="group" aria-labelledby={confirmId} className="confirm-panel">
              <h2 id={confirmId} className="schedule-heading">
                Cancel this event?
              </h2>
              <p className="confirm-text">{TEXT.confirm}</p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="button-primary"
                  disabled={cancel.isPending}
                  onClick={onConfirm}
                >
                  {cancel.isPending ? "Cancelling..." : "Yes, cancel event"}
                </button>
                <button
                  ref={refs.keep}
                  type="button"
                  className="button-secondary"
                  disabled={cancel.isPending}
                  onClick={keepEvent}
                >
                  Keep event
                </button>
              </div>
            </div>
          ) : (
            <button
              ref={refs.cancel}
              type="button"
              className="button-secondary schedule-cancel"
              onClick={openConfirm}
            >
              Cancel event
            </button>
          )}
        </section>
      )}
    </div>
  );
}
