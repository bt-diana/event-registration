import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildMessage, type MessageRow } from "../src/email/message.js";

// docs/specs/email-templates.md ET26: `npm run email:preview -- <folder>`
// writes the five emails as html files and the QR as ticket-qr.png into the
// folder, for a check by eye in a browser. Sample rows only: it sends nothing,
// reads no key and does not touch the database. Not run by the tests.

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: npm run email:preview -- <folder>");
  process.exit(1);
}

const CODE = "ABCDEFGH23";
const AMPERSAND = "Spring Meetup & Workshop";
const LONG = "An unusually long event title that keeps going to show how the heading wraps on a narrow phone screen";
const TO = "ana@example.com";

const samples: { file: string; row: MessageRow }[] = [
  {
    file: "ticket.html",
    row: {
      kind: "ticket",
      to_email: TO,
      subject: `Your ticket for ${AMPERSAND}`,
      body: `You have a seat at ${AMPERSAND}.\nStarts: 2030-01-01T10:00:00.000Z (UTC)\nTicket code: ${CODE}`,
    },
  },
  {
    file: "promotion.html",
    row: {
      kind: "promotion",
      to_email: TO,
      subject: `You have a seat at ${LONG}`,
      body: `You have a seat at ${LONG}.\nStarts: 2030-01-01T10:00:00.000Z (UTC)\nTicket code: ${CODE}`,
    },
  },
  {
    file: "reminder.html",
    row: {
      kind: "reminder",
      to_email: TO,
      subject: `Reminder: ${AMPERSAND} starts soon`,
      body: `${AMPERSAND}\nStarts: 2030-01-02 09:00 (UTC)\nTicket code: ${CODE}`,
    },
  },
  {
    file: "reschedule.html",
    row: {
      kind: "reschedule",
      to_email: TO,
      subject: `Rescheduled: ${LONG}`,
      body: `${LONG}\nNew start: 2030-02-01 10:00 (UTC)\nPrevious start: 2030-01-01 10:00 (UTC)`,
    },
  },
  {
    file: "cancelled.html",
    row: {
      kind: "event_cancelled",
      to_email: TO,
      subject: `Cancelled: ${AMPERSAND}`,
      body: `${AMPERSAND}\nWas to start: 2030-01-01 10:00 (UTC)\nThe event has been cancelled.`,
    },
  },
];

const target = resolve(folder);
mkdirSync(target, { recursive: true });

for (const { file, row } of samples) {
  const message = await buildMessage(row);
  let html = message.html;
  for (const attachment of message.attachments ?? []) {
    // The same code in all three ticket kinds, so one PNG serves them all.
    writeFileSync(join(target, attachment.filename), attachment.content);
    html = html.split(`cid:${attachment.contentId}`).join(attachment.filename);
  }
  writeFileSync(join(target, file), html);
  console.log(`wrote ${join(target, file)}`);
}
console.log(`wrote ${join(target, "ticket-qr.png")}`);
