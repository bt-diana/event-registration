import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import type { Me } from "./api";
import { useLogout, useMe } from "./session";

const ROLE_NAME: Record<Me["role"], string> = { user: "Attendee", organizer: "Organizer" };

// One registrations link per role (registration-web.md W-R14).
const REGISTRATIONS_LINK: Record<Me["role"], { to: string; text: string }> = {
  user: { to: "/registrations/me", text: "My registrations" },
  organizer: { to: "/registrations", text: "Registrations" },
};

function Account({ me }: { me: Me }) {
  const logout = useLogout();
  const link = REGISTRATIONS_LINK[me.role];
  return (
    <div className="site-account" data-role={me.role}>
      <nav aria-label="Main" className="site-nav">
        <Link to={link.to}>{link.text}</Link>
      </nav>
      <span className="account-name">{me.name}</span>
      <span className="account-role">{ROLE_NAME[me.role]}</span>
      <button
        type="button"
        className="button-secondary"
        disabled={logout.isPending}
        onClick={() => {
          if (!logout.isPending) logout.mutate(me.role);
        }}
      >
        {logout.isPending ? "Logging out..." : "Log out"}
      </button>
      {logout.isError && (
        <p className="field-error" role="alert">
          Could not log out. Try again.
        </p>
      )}
    </div>
  );
}

// Shown on every screen; reads the me cache, so it changes at once on login and logout (W-A18).
export function Header() {
  const { pathname } = useLocation();
  const me = useMe();
  const organizerPage = pathname.startsWith("/organizer");
  // A logged-in organizer keeps the organizer look on every screen, also on / and /event/:id (W-E22).
  const organizerLook = me.data?.role === "organizer" || organizerPage;
  const icon = organizerLook ? "/icon-organizer.svg" : "/icon-attendee.svg";

  // The tab icon follows the role of the page: green for attendees, purple for organizers.
  useEffect(() => {
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", icon);
  }, [icon]);

  return (
    <header className="site-header">
      <Link to={me.data?.role === "organizer" ? "/organizer" : "/"} className="logo">
        <img className="logo-icon" src={icon} alt="" width="32" height="32" />
        <span className="logo-text">Event Registration</span>
      </Link>
      {me.data ? (
        <Account me={me.data} />
      ) : (
        // Nothing while me is loading, so a logged-in person never sees the login links flash.
        !me.isPending && (
          <nav aria-label="Account" className="site-nav">
            <Link to="/login">Log in</Link>
            <Link to="/signup">Sign up</Link>
            {/* The role switch follows the page role. */}
            {organizerPage ? (
              <Link to="/login">For attendees</Link>
            ) : (
              <Link to="/organizer/login">For organizers</Link>
            )}
          </nav>
        )
      )}
    </header>
  );
}
