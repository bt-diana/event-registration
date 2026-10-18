import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendTransport, type ResendClient } from "../../src/email/transport.js";

// The Resend transport (email-reminders.md ER39-ER43, D58), tests first. The
// client is always a fake object: no network, no real key, no SDK client.

const API_KEY = "re_test_secret";
const FROM = "Events <onboarding@resend.dev>";
const MESSAGE = {
  to: "ana@example.com",
  subject: "Reminder: Spring Meetup starts soon",
  text: "Spring Meetup\nStarts: 2030-01-02 09:00 (UTC)\nTicket code: ABCDEFGH23",
  html: '<!doctype html><html lang="en"><body><p>Ticket code ABCDEFGH23</p></body></html>',
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ATTACHMENT = { filename: "ticket-qr.png", content: PNG, contentType: "image/png", contentId: "ticket-qr" };

type SendResult = Awaited<ReturnType<ResendClient["emails"]["send"]>>;

function fakeClient(result: SendResult | (() => Promise<SendResult>)) {
  const send = vi.fn<ResendClient["emails"]["send"]>(async () =>
    typeof result === "function" ? result() : result,
  );
  return { client: { emails: { send } } satisfies ResendClient, send };
}

const OK: SendResult = { data: { id: "email-1" }, error: null };

function transportWith(client: ResendClient, timeoutMs?: number) {
  return createResendTransport({ apiKey: API_KEY, from: FROM, client, timeoutMs });
}

// The rejection of `promise` as an Error (fails the test when it resolves).
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("expected a rejection");
}

function expectNoSecret(error: Error): void {
  expect(error.message).not.toContain(API_KEY);
  expect(error.message).not.toContain(MESSAGE.text);
  expect(error.message).not.toContain(MESSAGE.subject);
  // Added by email-templates.md ET24 (ER40): never the html or the attachment.
  expect(error.message).not.toContain(MESSAGE.html);
  expect(error.message).not.toContain("<html");
  expect(error.message).not.toContain(PNG.toString("base64"));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ER39: the transport sends one email through the client (tests first)", () => {
  // Changed by email-templates.md ET23: the payload has html too (it was text only).
  it("calls emails.send once with from, a one-item to array, subject, text and html, and resolves with no value", async () => {
    const { client, send } = fakeClient(OK);
    await expect(transportWith(client)(MESSAGE)).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    const [payload] = send.mock.calls[0];
    expect(payload).toEqual({
      from: FROM,
      to: [MESSAGE.to],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
  });
});

describe("ET23: the transport carries html and attachments (tests first)", () => {
  it("has no attachments key when the message has none", async () => {
    const { client, send } = fakeClient(OK);
    await transportWith(client)(MESSAGE);
    const [payload] = send.mock.calls[0];
    expect(payload).not.toHaveProperty("attachments");
    expect(payload.html).toBe(MESSAGE.html);
  });

  it("passes the inline attachment with filename, content, contentType and contentId", async () => {
    const { client, send } = fakeClient(OK);
    await transportWith(client)({ ...MESSAGE, attachments: [ATTACHMENT], idempotencyKey: "key-1" });
    expect(send).toHaveBeenCalledTimes(1);
    const [payload, options] = send.mock.calls[0];
    expect(payload).toEqual({
      from: FROM,
      to: [MESSAGE.to],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
      attachments: [{ filename: "ticket-qr.png", content: PNG, contentType: "image/png", contentId: "ticket-qr" }],
    });
    expect(options?.idempotencyKey).toBe("key-1");
  });

  it("a failure with an attachment holds no html and no attachment content", async () => {
    const { client } = fakeClient({ data: null, error: { name: "validation_error", message: "attachment too big" } });
    const error = await rejection(transportWith(client)({ ...MESSAGE, attachments: [ATTACHMENT] }));
    expect(error.message).toBe("resend validation_error: attachment too big");
    expectNoSecret(error);
  });
});

describe("ER40: a returned error is a failure (tests first)", () => {
  it("rejects with the error name and message, never resolves, and holds no key, body or subject", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "validation_error", message: "You can only send testing emails to your own email address" },
    });
    const error = await rejection(transportWith(client)(MESSAGE));
    expect(error.message).toBe(
      "resend validation_error: You can only send testing emails to your own email address",
    );
    expectNoSecret(error);
  });

  it("removes the key if the provider's message holds it", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "invalid_api_key", message: `API key ${API_KEY} is invalid`, statusCode: 403 },
    });
    const error = await rejection(transportWith(client)(MESSAGE));
    expect(error.message).toContain("resend invalid_api_key:");
    expectNoSecret(error);
  });

  it("rejects an answer with no id and no error", async () => {
    const { client } = fakeClient({ data: null, error: null } as unknown as SendResult);
    const error = await rejection(transportWith(client)(MESSAGE));
    expect(error.message).toBe("resend returned no id");
  });
});

describe("ER41: a rejected client call and rate or server errors (tests first)", () => {
  it("rejects with `resend request failed: <message>` and calls the client once (no retry inside)", async () => {
    const send = vi.fn<ResendClient["emails"]["send"]>(() => Promise.reject(new Error("socket hang up")));
    const error = await rejection(transportWith({ emails: { send } })(MESSAGE));
    expect(error.message).toBe("resend request failed: socket hang up");
    expect(send).toHaveBeenCalledTimes(1);
    expectNoSecret(error);
  });

  it("rejects a thrown value that is not an Error too", async () => {
    const send = vi.fn<ResendClient["emails"]["send"]>(() => Promise.reject("nope"));
    const error = await rejection(transportWith({ emails: { send } })(MESSAGE));
    expect(error.message).toBe("resend request failed: unknown error");
  });

  for (const name of ["rate_limit_exceeded", "application_error", "service_unavailable"]) {
    it(`rejects a returned ${name} like any other error`, async () => {
      const { client, send } = fakeClient({
        data: null,
        error: { name, message: `${name} message`, statusCode: name === "rate_limit_exceeded" ? 429 : 500 },
      });
      const error = await rejection(transportWith(client)(MESSAGE));
      expect(error.message).toBe(`resend ${name}: ${name} message`);
      expect(send).toHaveBeenCalledTimes(1);
    });
  }
});

describe("ER42: the idempotency key (tests first)", () => {
  it("passes the key in the request options when the message has one, and leaves it out otherwise", async () => {
    const { client, send } = fakeClient(OK);
    const transport = transportWith(client);
    await transport({ ...MESSAGE, idempotencyKey: "0190abcd-0000-7000-8000-000000000001" });
    await transport(MESSAGE);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1]?.idempotencyKey).toBe("0190abcd-0000-7000-8000-000000000001");
    expect(send.mock.calls[1][1]).not.toHaveProperty("idempotencyKey");
    // Never in the payload.
    for (const [payload] of send.mock.calls) expect(payload).not.toHaveProperty("idempotencyKey");
  });
});

describe("ER43: the timeout (tests first)", () => {
  it("passes an AbortSignal and rejects after timeoutMs when the client never answers", async () => {
    vi.useFakeTimers();
    const send = vi.fn<ResendClient["emails"]["send"]>(() => new Promise<SendResult>(() => {}));
    const pending = transportWith({ emails: { send } }, 5000)(MESSAGE);
    let settled = false;
    const outcome = rejection(pending).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error.message).toBe("resend request timed out after 5000 ms");
    expect(send.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses 10000 ms by default", async () => {
    vi.useFakeTimers();
    const send = vi.fn<ResendClient["emails"]["send"]>(() => new Promise<SendResult>(() => {}));
    const outcome = rejection(transportWith({ emails: { send } })(MESSAGE));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await outcome).message).toBe("resend request timed out after 10000 ms");
  });

  it("clears its timer when the call settles earlier", async () => {
    vi.useFakeTimers();
    const { client } = fakeClient(OK);
    await transportWith(client)(MESSAGE);
    expect(vi.getTimerCount()).toBe(0);

    const failing = fakeClient({ data: null, error: { name: "application_error", message: "down" } });
    await rejection(transportWith(failing.client)(MESSAGE));
    expect(vi.getTimerCount()).toBe(0);
  });
});
