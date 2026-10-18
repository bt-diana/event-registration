import { Resend } from "resend";

// docs/specs/email-reminders.md ER39-ER43 (D58). The sender depends on the
// function type only, never on the provider. This is the only file that
// imports `resend`, and `createResendTransport` is the only place that builds
// its client (called from index.ts; tests always pass a fake client).

// An inline image: the html refers to it as `cid:<contentId>`
// (email-templates.md ET18, ET23).
export type EmailAttachment = { filename: string; content: Buffer; contentType: string; contentId: string };

// The email built from one outbox row (message.ts). `attachments` only for the
// three ticket kinds.
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
};

// Resolves when the provider accepted the email; throws (rejects) on any
// failure. The idempotency key is the outbox row id (ER4).
export type EmailTransport = (message: EmailMessage & { idempotencyKey?: string }) => Promise<void>;

type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer | string; contentType: string; contentId: string }[];
};

// The part of the SDK client the transport uses, so a test can pass a plain
// object. Checked against resend 6.34.1 at install: the idempotency key and the
// abort signal both go in the second argument of emails.send, and an API error
// is returned as `error` ({ name, message, statusCode }), not thrown. An
// attachment is `{ filename, content (Buffer or string), contentType,
// contentId }` (camelCase in the SDK's `Attachment` type, ET23).
export type ResendClient = {
  emails: {
    send(
      payload: ResendPayload,
      options?: { idempotencyKey?: string; signal?: AbortSignal },
    ): Promise<{
      data: { id: string } | null;
      error: { name: string; message: string; statusCode?: number | null } | null;
    }>;
  };
};

export type ResendTransportOptions = {
  apiKey: string;
  from: string;
  // Defaults to the real SDK client.
  client?: ResendClient;
  // Bounds the provider call, so the sender's row lock is always released (ER43).
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

// A thin wrapper: no retry (the sender's job, D56), no log, no address cleaning
// (ER17). Every failure is a thrown Error whose message never holds the key,
// the subject, the body, the html or the attachment (ER40).
export function createResendTransport(options: ResendTransportOptions): EmailTransport {
  const { apiKey, from } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client: ResendClient = options.client ?? new Resend(apiKey);
  const withoutKey = (text: string) => (apiKey === "" ? text : text.split(apiKey).join("[key]"));

  return async (message) => {
    const requestOptions: { idempotencyKey?: string; signal: AbortSignal } = {
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (message.idempotencyKey !== undefined) requestOptions.idempotencyKey = message.idempotencyKey;

    let timer: NodeJS.Timeout | undefined;
    // Second guard: a client that ignores the signal still cannot hold the lock.
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`resend request timed out after ${timeoutMs} ms`)), timeoutMs);
    });

    const payload: ResendPayload = {
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    };
    // No attachments key at all when there is none (ET23).
    if (message.attachments && message.attachments.length > 0) {
      payload.attachments = message.attachments.map(({ filename, content, contentType, contentId }) => ({
        filename,
        content,
        contentType,
        contentId,
      }));
    }

    let result: Awaited<ReturnType<ResendClient["emails"]["send"]>>;
    try {
      const call = client.emails
        .send(payload, requestOptions)
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : "unknown error";
          throw new Error(withoutKey(`resend request failed: ${reason}`));
        });
      result = await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }

    // The SDK does not throw on API errors (ER40).
    if (result.error) {
      throw new Error(withoutKey(`resend ${result.error.name}: ${result.error.message}`));
    }
    if (!result.data?.id) throw new Error("resend returned no id");
  };
}
