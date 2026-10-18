// /registrations/:registrationId/emails?event= for an organizer (email-reminders-web.md
// W-EM2-W-EM15). Inside RegistrationEmailsEntry, so it has no guard of its own. One
// table of the emails of one attendee, as the API sends them (newest first), read on
// every visit and never by itself (D50, D51). Read only: the page shows the back link,
// the h1 and the table or a state, nothing else (W-EM13).
import type { ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { BackLink } from "../events/EventParts";
import { formatDateTime } from "../events/format";
import { isAuthError, statusOf } from "../events/queries";
import {
  emailKindLabel,
  emailStatusLabel,
  isUuid,
  useRegistrationEmails,
  type RegistrationEmail,
} from "./emails";

// The organizer registrations page (entries.tsx REGISTRATIONS; not imported, entries.tsx
// imports this file).
const REGISTRATIONS = "/registrations";

type Emails = ReturnType<typeof useRegistrationEmails>;

function Loading() {
  return (
    <p role="status" className="status">
      Loading emails...
    </p>
  );
}

function NotFound() {
  return (
    <>
      <p role="alert" className="list-error">
        Registration not found
      </p>
      <p className="intro">This link is not valid or the registration does not exist.</p>
    </>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      {/* The error box and a secondary Retry, as on the registrations page (W-EM12). */}
      <p role="alert" className="error-box">
        Could not load emails
      </p>
      <div className="status-gap">
        <button type="button" className="button-secondary" onClick={onRetry}>
          Retry
        </button>
      </div>
    </>
  );
}

export function RegistrationEmails() {
  const { registrationId = "" } = useParams();
  const [params] = useSearchParams();
  const eventId = params.get("event") ?? "";
  const emails = useRegistrationEmails(eventId, registrationId);
  // The registrations page keeps the chosen event (W-R20); without a valid event the
  // plain page (W-EM13).
  const back = isUuid(eventId)
    ? `${REGISTRATIONS}?event=${encodeURIComponent(eventId)}`
    : REGISTRATIONS;
  const valid = isUuid(eventId) && isUuid(registrationId);
  const name = valid ? attendeeName(emails) : null;

  return (
    <section className="list-page registrations-page" data-role="organizer">
      <BackLink to={back} name="Registrations" />
      <div className="list-head">
        <h1>{name === null ? "Emails" : `Emails of ${name}`}</h1>
      </div>
      {valid ? <EmailsBody emails={emails} /> : <NotFound />}
    </section>
  );
}

// The name only once the data is shown (not in the loading, error or not-found state).
function attendeeName(emails: Emails): string | null {
  if (emails.isError && (isAuthError(emails.error) || statusOf(emails.error) === 404)) return null;
  return emails.data?.attendee_name ?? null;
}

function EmailsBody({ emails }: { emails: Emails }): ReactNode {
  // A 401/403 re-checks me and the guard takes over (W-EM7), so no error of our own.
  if (emails.isError && isAuthError(emails.error)) return <Loading />;
  if (emails.isError && statusOf(emails.error) === 404) return <NotFound />;
  const { data } = emails;
  if (data === undefined) {
    if (emails.isError && !emails.isFetching) {
      return <LoadError onRetry={() => void emails.refetch()} />;
    }
    return <Loading />;
  }
  // A return shows the cached rows while they are read again; a failed read keeps them
  // with a note (W-EM5).
  const note = emails.isError && <p className="refresh-note">Could not refresh</p>;
  if (data.emails.length === 0) {
    return (
      <>
        {note}
        <p className="intro">No emails for this attendee yet.</p>
      </>
    );
  }
  return (
    <>
      {note}
      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col">To</th>
              <th scope="col">Subject</th>
              <th scope="col">Created</th>
              <th scope="col">Sent at</th>
              <th scope="col">Failed tries</th>
              <th scope="col">Error</th>
            </tr>
          </thead>
          <tbody>
            {data.emails.map((email) => (
              <Row key={email.id} email={email} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Plain words, no badge and no colour (W-EM9); empty cells stay empty (no dash).
function Row({ email }: { email: RegistrationEmail }) {
  return (
    <tr>
      <td>{emailKindLabel(email.kind)}</td>
      <td>{emailStatusLabel(email.status)}</td>
      <td>{email.to_email}</td>
      <td>{email.subject}</td>
      <td>
        <DateTime iso={email.created_at} />
      </td>
      <td>{email.sent_at !== null && <DateTime iso={email.sent_at} />}</td>
      <td>{String(email.send_attempts)}</td>
      <td>{email.send_error ?? ""}</td>
    </tr>
  );
}

// The same zone and format as the registrations table (W-EM10).
function DateTime({ iso }: { iso: string }) {
  return (
    <time className="table-note table-time" dateTime={iso}>
      {formatDateTime(iso)}
    </time>
  );
}
