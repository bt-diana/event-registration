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

// Stub for the tests-first commit.
export type ResendClient = {
  emails: {
    send(
      payload: { from: string; to: string[]; subject: string; text: string },
      options?: { idempotencyKey?: string; signal?: AbortSignal },
    ): Promise<{
      data: { id: string } | null;
      error: { name: string; message: string; statusCode?: number | null } | null;
    }>;
  };
};

export type ResendTransportOptions = { apiKey: string; from: string; client?: ResendClient; timeoutMs?: number };

export const createResendTransport: (options: ResendTransportOptions) => EmailTransport = () => {
  throw new Error("not implemented");
};
