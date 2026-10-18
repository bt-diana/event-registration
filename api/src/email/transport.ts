// docs/specs/email-reminders.md ER39-ER43 (D58). The sender depends on this
// function type only, never on the provider.

// Resolves when the provider accepted the email; throws (rejects) on any
// failure. The idempotency key is the outbox row id (ER4).
export type EmailTransport = (message: {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}) => Promise<void>;
