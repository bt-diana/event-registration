// Route guards (auth-web.md section 2). UI convenience only: the API is the real guard.
//
// | me state             | RequireRole(R)                  | RedirectIfLoggedIn(R)        |
// |----------------------|---------------------------------|------------------------------|
// | loading              | "Loading..." (W-A2)             | "Loading..."                 |
// | error                | "Could not check your login"    | same                         |
// | logged out (null)    | redirect to R's login, ?next=   | show the page                |
// | logged in as R       | show the screen                 | redirect to safe next / home |
// | logged in as other   | wrong-account message (W-A6)    | show the page                |
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router";
import type { Me, Role } from "./api";
import { useMe } from "./session";
import { safeNext } from "./validate";

export const HOME: Record<Role, string> = { user: "/", organizer: "/organizer" };
export const LOGIN: Record<Role, string> = { user: "/login", organizer: "/organizer/login" };

const AUDIENCE: Record<Role, string> = { user: "attendees", organizer: "organizers" };
const LOGIN_AS: Record<Role, string> = {
  user: "Log in as an attendee",
  organizer: "Log in as an organizer",
};

type Props = { role: Role; children: ReactNode };

// Renders children only once me has an answer; loading and error states otherwise.
function MeGate({ children }: { children: (me: Me | null) => ReactNode }) {
  const me = useMe();
  if (me.isPending || (me.isError && me.isFetching)) {
    return (
      <p role="status" className="status">
        Loading...
      </p>
    );
  }
  if (me.isError) {
    return (
      <section className="card card-message">
        <h1>Could not check your login</h1>
        <p className="intro">Check your connection and try again.</p>
        <button type="button" className="button-primary" onClick={() => void me.refetch()}>
          Retry
        </button>
      </section>
    );
  }
  return <>{children(me.data)}</>;
}

function WrongAccount({ need, me }: { need: Role; me: Me }) {
  return (
    <section className="card card-message">
      <p className="eyebrow eyebrow-error">Wrong account</p>
      <h1>Switch account</h1>
      <p className="intro">
        This page is for {AUDIENCE[need]}. You are logged in as {me.email}.
      </p>
      <p className="switch-mode" data-role={need}>
        <Link to={LOGIN[need]} className="action-link">
          {LOGIN_AS[need]}
        </Link>
      </p>
      <p className="switch-mode" data-role={me.role}>
        <Link to={HOME[me.role]} className="action-link">
          Go home
        </Link>
      </p>
    </section>
  );
}

export function RequireRole({ role, children }: Props) {
  const { pathname, search } = useLocation();
  return (
    <MeGate>
      {(me) => {
        if (!me) {
          const next = encodeURIComponent(pathname + search);
          return <Navigate to={`${LOGIN[role]}?next=${next}`} replace />;
        }
        if (me.role !== role) return <WrongAccount need={role} me={me} />;
        return children;
      }}
    </MeGate>
  );
}

export function RedirectIfLoggedIn({ role, children }: Props) {
  const [params] = useSearchParams();
  return (
    <MeGate>
      {(me) => {
        if (me && me.role === role) {
          return <Navigate to={safeNext(params.get("next")) ?? HOME[role]} replace />;
        }
        return children;
      }}
    </MeGate>
  );
}
