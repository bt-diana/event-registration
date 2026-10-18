import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";

export type Role = "user" | "organizer";
export type Mode = "login" | "signup";

type Props = { role: Role; mode: Mode };

const BASE: Record<Role, string> = { user: "", organizer: "/organizer" };

const COPY: Record<Role, Record<Mode, { title: string; intro: string; submit: string }>> = {
  user: {
    login: {
      title: "Log in",
      intro: "Log in to sign up for events and see your tickets.",
      submit: "Log in",
    },
    signup: {
      title: "Create an account",
      intro: "Make an account to sign up for events.",
      submit: "Create account",
    },
  },
  organizer: {
    login: {
      title: "Log in",
      intro: "Log in to create and manage your events.",
      submit: "Log in",
    },
    signup: {
      title: "Create an organizer account",
      intro: "Make an account to create events and check people in.",
      submit: "Create account",
    },
  },
};

// UI only (step 28, visual part): the form sends nothing yet.
export function AuthForm({ role, mode }: Props) {
  const id = useId();
  const [showPassword, setShowPassword] = useState(false);
  const copy = COPY[role][mode];
  const base = BASE[role];
  const isSignup = mode === "signup";

  const emailId = `${id}-email`;
  const nameId = `${id}-name`;
  const passwordId = `${id}-password`;
  const hintId = `${id}-password-hint`;

  const otherMode: Mode = isSignup ? "login" : "signup";
  const otherRole: Role = role === "user" ? "organizer" : "user";
  const sameRolePath = `${base}/${otherMode}`;
  const otherRolePath = `${BASE[otherRole]}/${mode}`;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <section className="card" data-role={role}>
      <p className="eyebrow">{role === "user" ? "Attendee" : "Organizer"}</p>
      <h1>{copy.title}</h1>
      <p className="intro">{copy.intro}</p>

      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input id={emailId} name="email" type="email" autoComplete="email" />
        </div>

        {isSignup && (
          <div className="field">
            <label htmlFor={nameId}>Name</label>
            <input id={nameId} name="name" type="text" autoComplete="name" />
          </div>
        )}

        <div className="field">
          <label htmlFor={passwordId}>Password</label>
          <div className="password-row">
            <input
              id={passwordId}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              aria-describedby={isSignup ? hintId : undefined}
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
        </div>

        <button type="submit" className="button-primary">
          {copy.submit}
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
