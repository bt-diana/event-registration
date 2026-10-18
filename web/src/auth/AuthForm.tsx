import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, type Role } from "./api";
import { useLogin, useSignup } from "./session";
import { validateEmail, validateName, validatePassword } from "./validate";

export type { Role };
export type Mode = "login" | "signup";

type Props = { role: Role; mode: Mode };
type Field = "email" | "name" | "password";
type FieldErrors = Partial<Record<Field, string>>;
type FocusTarget = Field | "form";

const FIELD_ORDER: Field[] = ["email", "name", "password"];

const BASE: Record<Role, string> = { user: "", organizer: "/organizer" };

const COPY: Record<
  Role,
  Record<Mode, { title: string; intro: string; submit: string; pending: string }>
> = {
  user: {
    login: {
      title: "Log in",
      intro: "Log in to sign up for events and see your tickets.",
      submit: "Log in",
      pending: "Logging in...",
    },
    signup: {
      title: "Create an account",
      intro: "Make an account to sign up for events.",
      submit: "Create account",
      pending: "Creating account...",
    },
  },
  organizer: {
    login: {
      title: "Log in",
      intro: "Log in to create and manage your events.",
      submit: "Log in",
      pending: "Logging in...",
    },
    signup: {
      title: "Create an organizer account",
      intro: "Make an account to create events and check people in.",
      submit: "Create account",
      pending: "Creating account...",
    },
  },
};

const TEXT = {
  wrongCredentials: "Wrong email or password.",
  emailTaken: "This email is already used.",
  invalidInput: "Some fields are not valid. Check them and try again.",
  failed: "Something went wrong. Try again.",
};

// The shared login and sign-up form for both roles. On success the session cache is
// filled (session.ts) and RedirectIfLoggedIn moves the person on (W-A5).
// The password lives only in this component's state (W-A20).
export function AuthForm({ role, mode }: Props) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; n: number } | null>(
    null,
  );
  const sending = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  const loginMutation = useLogin(role);
  const signupMutation = useSignup(role);
  const pending = loginMutation.isPending || signupMutation.isPending;

  const copy = COPY[role][mode];
  const base = BASE[role];
  const isSignup = mode === "signup";

  const emailId = `${id}-email`;
  const nameId = `${id}-name`;
  const passwordId = `${id}-password`;
  const hintId = `${id}-password-hint`;
  const errorId = (field: Field) => `${id}-${field}-error`;
  const formErrorId = `${id}-form-error`;

  const otherMode: Mode = isSignup ? "login" : "signup";
  const otherRole: Role = role === "user" ? "organizer" : "user";
  const sameRolePath = `${base}/${otherMode}`;
  const otherRolePath = `${BASE[otherRole]}/${mode}`;

  // Focus moves after the error is on screen (W-A16).
  useEffect(() => {
    if (!focusRequest) return;
    const targets = { email: emailRef, name: nameRef, password: passwordRef, form: formErrorRef };
    targets[focusRequest.target].current?.focus();
  }, [focusRequest]);

  function focus(target: FocusTarget) {
    setFocusRequest((previous) => ({ target, n: (previous?.n ?? 0) + 1 }));
  }

  function showFormError(text: string) {
    setFormError(text);
    focus("form");
  }

  function onError(error: Error) {
    const status = error instanceof ApiError ? error.status : -1;
    if (isSignup && status === 409) {
      setFieldErrors({ email: TEXT.emailTaken });
      focus("email");
    } else if (!isSignup && status === 401) {
      showFormError(TEXT.wrongCredentials);
    } else if (status === 400) {
      showFormError(TEXT.invalidInput);
    } else {
      showFormError(TEXT.failed);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return; // W-A12: no second request while one is pending

    const errors: FieldErrors = {};
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;
    if (isSignup) {
      const nameError = validateName(name);
      if (nameError) errors.name = nameError;
    }
    const passwordError = validatePassword(password, mode);
    if (passwordError) errors.password = passwordError;

    setFieldErrors(errors);
    setFormError(null);
    const firstInvalid = FIELD_ORDER.find((field) => errors[field]);
    if (firstInvalid) {
      focus(firstInvalid);
      return;
    }

    sending.current = true;
    const callbacks = {
      onError,
      onSettled: () => {
        sending.current = false;
      },
    };
    if (isSignup) {
      signupMutation.mutate(
        () => ({ email: email.trim(), name: name.trim(), password }),
        callbacks,
      );
    } else {
      loginMutation.mutate(() => ({ email: email.trim(), password }), callbacks);
    }
  }

  function describedBy(field: Field, extra?: string): string | undefined {
    const ids = [extra, fieldErrors[field] ? errorId(field) : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(" ") : undefined;
  }

  function fieldError(field: Field) {
    const text = fieldErrors[field];
    if (!text) return null;
    return (
      <p id={errorId(field)} className="field-error" role="alert">
        {text}
      </p>
    );
  }

  return (
    <section className="card" data-role={role}>
      <p className="eyebrow">{role === "user" ? "Attendee" : "Organizer"}</p>
      <h1>{copy.title}</h1>
      <p className="intro">{copy.intro}</p>

      {formError && (
        <p
          ref={formErrorRef}
          id={formErrorId}
          className="form-error"
          role="alert"
          tabIndex={-1}
        >
          {formError}
        </p>
      )}

      <form
        className="form"
        onSubmit={onSubmit}
        noValidate
        aria-describedby={formError ? formErrorId : undefined}
      >
        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input
            ref={emailRef}
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={describedBy("email")}
          />
          {fieldError("email")}
        </div>

        {isSignup && (
          <div className="field">
            <label htmlFor={nameId}>Name</label>
            <input
              ref={nameRef}
              id={nameId}
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={describedBy("name")}
            />
            {fieldError("name")}
          </div>
        )}

        <div className="field">
          <label htmlFor={passwordId}>Password</label>
          <div className="password-row">
            <input
              ref={passwordRef}
              id={passwordId}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={describedBy("password", isSignup ? hintId : undefined)}
            />
            <button
              type="button"
              className="button-secondary"
              aria-pressed={showPassword}
              aria-controls={passwordId}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {isSignup && (
            <p id={hintId} className="hint">
              8 to 128 characters
            </p>
          )}
          {fieldError("password")}
        </div>

        <button type="submit" className="button-primary" disabled={pending}>
          {pending ? copy.pending : copy.submit}
        </button>
      </form>

      <p className="switch-mode">
        {isSignup ? "Already have an account? " : "No account yet? "}
        <Link to={sameRolePath} className="action-link">
          {isSignup ? "Log in" : "Sign up"}
        </Link>
      </p>

      <p className="switch-role">
        <Link to={otherRolePath} className="action-link">
          {role === "user" ? "I organize events" : "I am an attendee"}
        </Link>
      </p>
    </section>
  );
}
