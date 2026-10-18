// /registrations for an organizer (W-R16). The list is blocked until the API route
// GET /events/{id}/registrations exists (checkin.md C15-C18, roadmap step 26;
// registration-web.md question 2), so a placeholder with no request (W-R20).
export function OrganizerRegistrations() {
  return (
    <section className="card card-message" data-role="organizer">
      <h1>Registrations</h1>
      <p className="intro">The list is not built yet.</p>
    </section>
  );
}
