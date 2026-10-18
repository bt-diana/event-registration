// Pieces shared by the organizer and the public event views (W-E12, W-E18, W-E23).
import { Link } from "react-router";

export function EventLoading() {
  return (
    <section className="card card-event">
      <p role="status" className="status">
        Loading...
      </p>
    </section>
  );
}

export function EventLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="card card-message">
      <h1>Could not load this event</h1>
      <p className="intro">Check your connection and try again.</p>
      <button type="button" className="button-primary" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}

export function EventNotFound() {
  return (
    <section className="card card-message">
      <p className="eyebrow">Event</p>
      <h1>Event not found</h1>
      <p className="intro">This link is not valid or the event does not exist.</p>
      <Link to="/" className="back-link">
        Go home
      </Link>
    </section>
  );
}

// Plain text with the line breaks kept (CSS white-space: pre-wrap). A React text node,
// so markup is shown as typed. Empty shows nothing at all.
export function EventDescription({ text }: { text: string }) {
  if (text === "") return null;
  return <p className="event-description">{text}</p>;
}

export function Detail({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
