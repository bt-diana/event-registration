import { Route, Routes } from "react-router";
import { AuthForm } from "./auth/AuthForm";
import { RedirectIfLoggedIn, RequireRole } from "./auth/guards";
import { Header } from "./auth/Header";
import { CreateEventForm } from "./events/CreateEventForm";
import { EventPage } from "./events/EventPage";
import { EventsList } from "./events/EventsList";
import { PublicEventsList } from "./events/PublicEventsList";

export function App() {
  return (
    <>
      <Header />
      <main className="page">
        <Routes>
          {/* Public: no guard. An organizer is sent to /organizer (W-L8). */}
          <Route path="/" element={<PublicEventsList />} />
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
