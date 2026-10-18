import { Route, Routes } from "react-router";
import { AuthForm } from "./auth/AuthForm";
import { RedirectIfLoggedIn, RequireRole } from "./auth/guards";
import { Header } from "./auth/Header";

// Public: no guard. The event screens come from web.md.
function AttendeeHome() {
  return (
    <section className="card" data-role="user">
      <p className="eyebrow">Attendee</p>
      <h1>Events</h1>
      <p className="intro">The event list is not built yet.</p>
    </section>
  );
}

// Placeholder for the organizer screens from web.md.
function OrganizerHome() {
  return (
    <section className="card" data-role="organizer">
      <p className="eyebrow">Organizer</p>
      <h1>Organizer home</h1>
      <p className="intro">The organizer screens are not built yet.</p>
    </section>
  );
}

export function App() {
  return (
    <>
      <Header />
      <main className="page">
        <Routes>
          <Route path="/" element={<AttendeeHome />} />
          <Route
            path="/login"
            element={
              <RedirectIfLoggedIn role="user">
                <AuthForm role="user" mode="login" />
              </RedirectIfLoggedIn>
            }
          />
          <Route
            path="/signup"
            element={
              <RedirectIfLoggedIn role="user">
                <AuthForm role="user" mode="signup" />
              </RedirectIfLoggedIn>
            }
          />
          <Route
            path="/organizer"
            element={
              <RequireRole role="organizer">
                <OrganizerHome />
              </RequireRole>
            }
          />
          <Route
            path="/organizer/login"
            element={
              <RedirectIfLoggedIn role="organizer">
                <AuthForm role="organizer" mode="login" />
              </RedirectIfLoggedIn>
            }
          />
          <Route
            path="/organizer/signup"
            element={
              <RedirectIfLoggedIn role="organizer">
                <AuthForm role="organizer" mode="signup" />
              </RedirectIfLoggedIn>
            }
          />
        </Routes>
      </main>
    </>
  );
}
