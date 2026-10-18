import { describe, expect, it, vi } from "vitest";
import { buildMessage } from "../../src/email/message.js";

// The message builder (email-templates.md ET18-ET21, D76, D77, roadmap step
// 34b). Written before the module: ET18-ET21 are the tests first. The QR is a
// fake that records the code, except in the one ET21 test with the real one.

const CODE = "ABCDEFGH23";
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Row = { kind: string; to_email: string; subject: string; body: string };

const ROWS: Record<string, Row> = {
  ticket: {
    kind: "ticket",
    to_email: "ana@example.com",
    subject: "Your ticket for Spring Meetup",
    body: `You have a seat at Spring Meetup.\nStarts: 2030-01-01T10:00:00.000Z (UTC)\nTicket code: ${CODE}`,
  },
  promotion: {
    kind: "promotion",
    to_email: "ana@example.com",
    subject: "You have a seat at Spring Meetup",
    body: `You have a seat at Spring Meetup.\nStarts: 2030-01-01T10:00:00.000Z (UTC)\nTicket code: ${CODE}`,
  },
  reminder: {
    kind: "reminder",
    to_email: "ana@example.com",
    subject: "Reminder: Spring Meetup starts soon",
    body: `Spring Meetup\nStarts: 2030-01-02 09:00 (UTC)\nTicket code: ${CODE}`,
  },
  reschedule: {
    kind: "reschedule",
    to_email: "ana@example.com",
    subject: "Rescheduled: Spring Meetup",
    body: "Spring Meetup\nNew start: 2030-02-01 10:00 (UTC)\nPrevious start: 2030-01-01 10:00 (UTC)",
  },
  event_cancelled: {
    kind: "event_cancelled",
    to_email: "ana@example.com",
    subject: "Cancelled: Spring Meetup",
    body: "Spring Meetup\nWas to start: 2030-01-01 10:00 (UTC)\nThe event has been cancelled.",
  },
};

function fakeQr() {
  return vi.fn(async (code: string) => {
    void code;
    return FAKE_PNG;
  });
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("ET18: the message shape (tests first)", () => {
  for (const kind of ["ticket", "promotion", "reminder"]) {
    it(`${kind}: to, subject, text, html and one inline QR attachment`, async () => {
      const row = ROWS[kind];
      const qrPng = fakeQr();
      const message = await buildMessage(row, qrPng);

      expect(Object.keys(message).sort()).toEqual(["attachments", "html", "subject", "text", "to"]);
      expect(message.to).toBe(row.to_email);
      expect(message.subject).toBe(row.subject);
      expect(message.text.startsWith(row.body)).toBe(true);
      expect(message.attachments).toEqual([
        { filename: "ticket-qr.png", content: FAKE_PNG, contentType: "image/png", contentId: "ticket-qr" },
      ]);
      expect(count(message.html, '<img src="cid:ticket-qr"')).toBe(1);
      expect(qrPng).toHaveBeenCalledTimes(1);
      expect(qrPng).toHaveBeenCalledWith(CODE);
    });
  }

  for (const kind of ["reschedule", "event_cancelled"]) {
    it(`${kind}: no attachments key, no image, no QR call`, async () => {
      const qrPng = fakeQr();
      const message = await buildMessage(ROWS[kind], qrPng);
      expect(Object.keys(message).sort()).toEqual(["html", "subject", "text", "to"]);
      expect(message).not.toHaveProperty("attachments");
      expect(message.html).not.toContain("<img");
      expect(qrPng).not.toHaveBeenCalled();
    });
  }

  it("a ticket-kind row without a Ticket code line has no attachments and no image", async () => {
    const qrPng = fakeQr();
    const message = await buildMessage({ ...ROWS.reminder, body: "Spring Meetup\nStarts: 2030-01-02 09:00 (UTC)" }, qrPng);
    expect(message).not.toHaveProperty("attachments");
    expect(message.html).not.toContain("<img");
    expect(qrPng).not.toHaveBeenCalled();
  });
});

describe("ET19: accessible without the image (tests first)", () => {
  it("the img has a fixed alt, width, height and a fluid style, and the code is also text", async () => {
    const message = await buildMessage(ROWS.ticket, fakeQr());
    const img = /<img\b[^>]*>/.exec(message.html)![0];
    expect(img).toContain('alt="QR code of your ticket. Show it at the door."');
    expect(img).toContain('width="232"');
    expect(img).toContain('height="232"');
    expect(img).toContain('style="display:block;max-width:100%;height:auto"');
    expect(message.html.replace(img, "")).toContain(CODE);
    expect(message.text).toContain(`Ticket code: ${CODE}`);
  });
});

describe("ET20: a QR failure rejects (tests first)", () => {
  it("rejects with the QR error and never builds a message without the image", async () => {
    const qrPng = vi.fn(async () => {
      throw new Error("canvas broke");
    });
    await expect(buildMessage(ROWS.ticket, qrPng)).rejects.toThrow(/canvas broke/);
  });
});

describe("ET21: the same row gives the same message (tests first)", () => {
  it("two calls with the real QR give deep-equal messages and equal PNG bytes", async () => {
    const first = await buildMessage(ROWS.ticket);
    const second = await buildMessage({ ...ROWS.ticket });
    expect(second).toEqual(first);
    expect(second.attachments![0].content.equals(first.attachments![0].content)).toBe(true);
    expect([...first.attachments![0].content.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
