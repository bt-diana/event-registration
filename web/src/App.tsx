import { Route, Routes } from "react-router";
import { AuthForm } from "./auth/AuthForm";
import { Header } from "./auth/Header";

function AttendeeHome() {
  return (
    <section className="card" data-role="user">
      <p className="eyebrow">Attendee</p>
      <h1>Events</h1>
      <p className="intro">The event list is not built yet.</p>
    </section>
  );
}

// Placeholder. The RequireRole("organizer") guard comes with the functionality step.
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
          <Route path="/login" element={<AuthForm role="user" mode="login" />} />
          <Route path="/signup" element={<AuthForm role="user" mode="signup" />} />
          <Route path="/organizer" element={<OrganizerHome />} />
          <Route path="/organizer/login" element={<AuthForm role="organizer" mode="login" />} />
          <Route path="/organizer/signup" element={<AuthForm role="organizer" mode="signup" />} />
        </Routes>
      </main>
    </>
  );
}
