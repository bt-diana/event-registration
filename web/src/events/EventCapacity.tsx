// The "Capacity" section of the owner view of /event/:id (capacity-web.md W-CP1-W-CP9,
// W-CP12): a field prefilled with the current capacity, the client checks, the request and
// the result message. Always mounted in the owner view, so the message stays when the form
// goes away after a 409. The browser clock only hides the form; the server decides.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { EventActionError, type OrganizerEvent } from "./api";
import { RESCHEDULE_CONFLICT, canChange } from "./EventSchedule";
import { isAuthError, statusOf, useSetCapacity } from "./queries";
import { ERRORS, validateCapacity, validateCapacityChange } from "./validate";

const TEXT = {
  same: "That is already the capacity. Nothing changed.",
  saved: (seatsLeft: number) => `Capacity saved. Seats left: ${seatsLeft}.`,
  failed: "Something went wrong. Try again.",
};

function hintText(registered: number): string {
  const who = registered === 1 ? "person" : "people";
  return `1 to 100000. Not below the ${registered} registered ${who}. More seats go to the waiting list in order, and those people get an email.`;
}

type Message = { role: "status" | "alert"; text: string };
type FocusTarget = "field" | "message";

export function EventCapacity({ event }: { event: OrganizerEvent }) {
  const id = useId();
  const setCapacity = useSetCapacity(event.id);
  // Set once (W-CP2): a later read of the event never overwrites what the user typed.
  const [value, setValue] = useState(() => String(event.capacity));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; n: number } | null>(
    null,
  );
  // A second submit while one runs sends nothing (W-CP5), also before the pending render.
  const saving = useRef(false);
  const refs = {
    field: useRef<HTMLInputElement>(null),
    message: useRef<HTMLParagraphElement>(null),
  };

  const headingId = `${id}-heading`;
  const fieldId = `${id}-capacity`;
  const hintId = `${id}-capacity-hint`;
  const errorId = `${id}-capacity-error`;

  // Focus moves after the target is on screen (W-CP12).
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

  function showFieldError(text: string) {
    setFieldError(text);
    focus("field");
  }

  function onSubmit(submitted: FormEvent<HTMLFormElement>) {
    submitted.preventDefault();
    if (saving.current) return;
    setMessage(null);

    // W-CP3: none of these sends a request; the server still decides (W-CP8, W-CP9).
    const invalid = validateCapacity(value) ?? validateCapacityChange(value, event.registered);
    if (invalid) {
      showFieldError(invalid);
      return;
    }
    setFieldError(null);
    const capacity = Number(value.trim());
    if (capacity === event.capacity) {
      show("status", TEXT.same);
      return;
    }

    saving.current = true;
    setCapacity.mutate(capacity, {
      onSuccess: (answer) => {
        setValue(String(answer.capacity));
        show("status", TEXT.saved(answer.seats_left));
      },
      onError: (error) => {
        const status = statusOf(error);
        // 401/403: the guard takes over; 404: the page falls back (W-CP9). No text.
        if (isAuthError(error) || status === 404) return;
        if (status === 400) {
          showFieldError(ERRORS.capacity);
          return;
        }
        const code = error instanceof EventActionError ? error.code : "";
        if (status === 409 && code === "capacity_below_registered") {
          const registered = (error as EventActionError).registered;
          if (registered !== undefined) showFieldError(ERRORS.capacityBelow(registered));
          else show("alert", TEXT.failed);
          return;
        }
        const closed = status === 409 && Object.hasOwn(RESCHEDULE_CONFLICT, code);
        show("alert", closed ? RESCHEDULE_CONFLICT[code] : TEXT.failed);
      },
      onSettled: () => {
        saving.current = false;
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
        <section aria-labelledby={headingId}>
          <form className="form" onSubmit={onSubmit} noValidate>
            <h2 id={headingId} className="schedule-heading">
              Capacity
            </h2>
            <div className="field">
              <label htmlFor={fieldId}>Capacity (seats)</label>
              <input
                ref={refs.field}
                id={fieldId}
                type="text"
                inputMode="numeric"
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
                {hintText(event.registered)}
              </p>
            </div>
            <button type="submit" className="button-primary" disabled={setCapacity.isPending}>
              {setCapacity.isPending ? "Saving..." : "Save capacity"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
