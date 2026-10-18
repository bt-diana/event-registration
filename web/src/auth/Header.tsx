import { useEffect } from "react";
import { Link, useLocation } from "react-router";

// Logged-out header only (UI step). The logged-in variant comes with the session code.
export function Header() {
  const { pathname } = useLocation();
  const icon = pathname.startsWith("/organizer") ? "/icon-organizer.svg" : "/icon-attendee.svg";

  // The tab icon follows the role of the page: green for attendees, purple for organizers.
  useEffect(() => {
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", icon);
  }, [icon]);

  return (
    <header className="site-header">
      <Link to="/" className="logo">
        <img className="logo-icon" src={icon} alt="" width="32" height="32" />
        <span className="logo-text">Event Registration</span>
      </Link>
      <nav aria-label="Account" className="site-nav">
        <Link to="/login">Log in</Link>
        <Link to="/signup">Sign up</Link>
        <Link to="/organizer/login">For organizers</Link>
      </nav>
    </header>
  );
}
