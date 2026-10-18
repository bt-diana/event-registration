// /organizer/events/new: create an event (W-E4-W-E9, W-E20). Inside RequireRole.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { NewEvent } from "./api";
import { localToIso, localZoneName, toLocalInput } from "./format";
import { isAuthError, statusOf, useCreateEvent } from "./queries";
import {
  validateCapacity,
  validateDescription,
  validateDuration,
  validateStart,
  validateTitle,
} from "./validate";

type Field = "title" | "description" | "start" | "duration" | "capacity";
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, string>>;
type FocusTarget = Field | "form";

const FIELD_ORDER: Field[] = ["title", "description", "start", "duration", "capacity"];

const TEXT = {
  invalidInput: "Some fields are not valid. Check them and try again.",
  failed: "Something went wrong. Try again.",
};

function check(values: Values, now: Date): FieldErrors {
  const errors: FieldErrors = {};
  const results: Record<Field, string | null> = {
    title: validateTitle(values.title),
    description: validateDescription(values.description),
    start: validateStart(values.start, now),
    duration: validateDuration(values.duration),
    capacity: validateCapacity(values.capacity),
  };
  for (const field of FIELD_ORDER) {
    const error = results[field];
    if (error) errors[field] = error;
  }
  return errors;
}

// Only called after check() passed, so the start converts and the numbers are whole.
function toNewEvent(values: Values): NewEvent {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    starts_at: localToIso(values.start) ?? "",
    duration_minutes: Number(values.duration.trim()),
    capacity: Number(values.capacity.trim()),
  };
}

export function CreateEventForm() {
  const id = useId();
  const navigate = useNavigate();
  const create = useCreateEvent();
  const [values, setValues] = useState<Values>({
    title: "",
    description: "",
    start: "",
    duration: "",
    capacity: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; n: number } | null>(
    null,
  );
  // A create is not idempotent: a second submit while one is pending sends nothing (W-E7).
  const sending = useRef(false);
  const refs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
    start: useRef<HTMLInputElement>(null),
    duration: useRef<HTMLInputElement>(null),
    capacity: useRef<HTMLInputElement>(null),
    form: useRef<HTMLParagraphElement>(null),
  };
  const [minStart] = useState(() => toLocalInput(new Date()));
  const [zone] = useState(() => localZoneName());

  const fieldId = (field: Field) => `${id}-${field}`;
  const hintId = (field: Field) => `${id}-${field}-hint`;
  const errorId = (field: Field) => `${id}-${field}-error`;
  const formErrorId = `${id}-form-error`;

  // Focus moves after the error is on screen (W-E20).
  useEffect(() => {
    if (!focusRequest) return;
    refs[focusRequest.target].current?.focus();
  }, [focusRequest]); // refs are stable; only a new request moves focus

  function focus(target: FocusTarget) {
    setFocusRequest((previous) => ({ target, n: (previous?.n ?? 0) + 1 }));
  }

  function onError(error: Error) {
    if (isAuthError(error)) return; // the guard handles it (W-E13)
    setFormError(statusOf(error) === 400 ? TEXT.invalidInput : TEXT.failed);
    focus("form");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;

    const errors = check(values, new Date());
    setFieldErrors(errors);
    setFormError(null);
    const firstInvalid = FIELD_ORDER.find((field) => errors[field]);
    if (firstInvalid) {
      focus(firstInvalid);
      return;
    }

    sending.current = true;
    create.mutate(toNewEvent(values), {
      onSuccess: (created) => navigate(`/event/${created.id}`, { replace: true }),
      onError,
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  function set(field: Field) {
    return (event: { target: { value: string } }) =>
      setValues((previous) => ({ ...previous, [field]: event.target.value }));
  }

  // Props shared by the five inputs: id, value, aria (W-E20).
  function inputProps(field: Field) {
    const error = fieldErrors[field];
    return {
      id: fieldId(field),
      name: field,
      value: values[field],
      onChange: set(field),
      "aria-invalid": error ? true : undefined,
      "aria-describedby": [error ? errorId(field) : undefined, hintId(field)]
        .filter(Boolean)
        .join(" "),
    };
  }

  function row(field: Field, label: string, hint: string, input: ReactNode) {
    const error = fieldErrors[field];
    return (
      <div className="field">
        <label htmlFor={fieldId(field)}>{label}</label>
        {input}
        {error && (
          <p id={errorId(field)} className="field-error" role="alert">
            {error}
          </p>
        )}
        <p id={hintId(field)} className="hint">
          {hint}
        </p>
      </div>
    );
  }

  return (
    <section className="card card-form" data-role="organizer">
      <h1 className="form-title">Create event</h1>

      {formError && (
        <p ref={refs.form} id={formErrorId} className="form-error" role="alert" tabIndex={-1}>
          {formError}
        </p>
      )}

      <form
        className="form"
        onSubmit={onSubmit}
        noValidate
        aria-describedby={formError ? formErrorId : undefined}
      >
        {row(
          "title",
          "Title",
          "1 to 200 characters",
          <input ref={refs.title} type="text" {...inputProps("title")} />,
        )}
        {row(
          "description",
          "Description (optional)",
          "Shown on the public event page, so everyone can read it. Up to 2000 characters.",
          <textarea ref={refs.description} rows={5} {...inputProps("description")} />,
        )}
        {row(
          "start",
          "Starts",
          `Your local time (${zone})`,
          <input ref={refs.start} type="datetime-local" min={minStart} {...inputProps("start")} />,
        )}
        {row(
          "duration",
          "Duration (minutes)",
          "1 to 1440",
          <input ref={refs.duration} type="text" inputMode="numeric" {...inputProps("duration")} />,
        )}
        {row(
          "capacity",
          "Capacity (seats)",
          "1 to 100000",
          <input ref={refs.capacity} type="text" inputMode="numeric" {...inputProps("capacity")} />,
        )}

        <button type="submit" className="button-primary" disabled={create.isPending}>
          {create.isPending ? "Creating..." : "Create event"}
        </button>
      </form>

      <Link to="/organizer" className="back-link">
        <span aria-hidden="true">&larr;</span> Back to events
      </Link>
    </section>
  );
}
