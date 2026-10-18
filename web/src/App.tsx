import { Route, Routes } from "react-router";
import { AuthForm } from "./auth/AuthForm";
import { RedirectIfLoggedIn, RequireRole } from "./auth/guards";
import { Header } from "./auth/Header";
import { CreateEventForm } from "./events/CreateEventForm";
import { EventPage } from "./events/EventPage";
import { EventsList } from "./events/EventsList";

// Public: no guard. A placeholder; there is no public list of events yet (events-web.md).
// No role eyebrow: the header shows the role (RE1).
function AttendeeHome() {
  return (
    <section className="card" data-role="user">
      <h1>Events</h1>
      <p className="intro">The event list is not built yet.</p>
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
          {/* One link for everyone, no guard: the page picks its view from me (W-E10). */}
          <Route path="/event/:id" element={<EventPage />} />
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
                <EventsList />
              </RequireRole>
            }
          />
          <Route
            path="/organizer/events/new"
            element={
              <RequireRole role="organizer">
                <CreateEventForm />
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
