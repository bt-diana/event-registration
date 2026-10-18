import { Link } from "react-router";

// Logged-out header only (UI step). The logged-in variant comes with the session code.
export function Header() {
  return (
    <header className="site-header">
      <Link to="/" className="logo">
        <span className="logo-square" aria-hidden="true" />
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
