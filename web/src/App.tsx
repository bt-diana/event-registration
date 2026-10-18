import { Route, Routes } from "react-router";
import { AuthForm } from "./auth/AuthForm";
import { RedirectIfLoggedIn, RequireRole } from "./auth/guards";
import { Header } from "./auth/Header";
import { CreateEventForm } from "./events/CreateEventForm";
import { EventPage } from "./events/EventPage";
import { EventsList } from "./events/EventsList";
import { PublicEventsList } from "./events/PublicEventsList";
import { MyRegistrationsEntry, RegistrationsEntry, ScanEntry } from "./registrations/entries";

export function App() {
  return (
    <>
      <Header />
      <main className="page">
        <Routes>
          {/* Public: no guard. An organizer stays here and sees the list (W-L8, D60). */}
          <Route path="/" element={<PublicEventsList />} />
          {/* One link for everyone, no guard: the page picks its view from me (W-E10). */}
          <Route path="/event/:id" element={<EventPage />} />
          {/* Each entry redirects the other role to its own screen (W-R15-W-R17). */}
          <Route path="/registrations" element={<RegistrationsEntry />} />
          <Route path="/registrations/me" element={<MyRegistrationsEntry />} />
          <Route path="/registrations/scan" element={<ScanEntry />} />
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
