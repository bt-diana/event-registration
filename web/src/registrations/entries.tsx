// Route entries for the two registration screens (registration-web.md W-R15-W-R17).
// Each one redirects only the other role, to a route that role may open, so there is
// no loop. Logged out goes to the login of the screen's role with `next`. RequireRole
// is not used: it shows the wrong-account page instead of redirecting (W-A6).
import { Navigate, useLocation } from "react-router";
import { LOGIN, MeGate } from "../auth/guards";
import { MyRegistrations } from "./MyRegistrations";
import { OrganizerRegistrations } from "./OrganizerRegistrations";

export const MY_REGISTRATIONS = "/registrations/me";
export const REGISTRATIONS = "/registrations";

function useNext(): string {
  const { pathname, search } = useLocation();
  return encodeURIComponent(pathname + search);
}

// /registrations/me: attendees. An organizer goes to /registrations (open question 4).
export function MyRegistrationsEntry() {
  const next = useNext();
  return (
    <MeGate>
      {(me) => {
        if (!me) return <Navigate to={`${LOGIN.user}?next=${next}`} replace />;
        if (me.role !== "user") return <Navigate to={REGISTRATIONS} replace />;
        return <MyRegistrations />;
      }}
    </MeGate>
  );
}

// /registrations: organizers. An attendee goes to /registrations/me, the query is
// dropped (an organizer's event id means nothing to an attendee). Logged out goes to
// the organizer login (open question 3).
export function RegistrationsEntry() {
  const next = useNext();
  return (
    <MeGate>
      {(me) => {
        if (!me) return <Navigate to={`${LOGIN.organizer}?next=${next}`} replace />;
        if (me.role !== "organizer") return <Navigate to={MY_REGISTRATIONS} replace />;
        return <OrganizerRegistrations />;
      }}
    </MeGate>
  );
}
