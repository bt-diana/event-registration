import { makeQrPng } from "./qr.js";
import { QR_CONTENT_ID, renderEmail } from "./templates.js";
import type { EmailMessage } from "./transport.js";

// docs/specs/email-templates.md ET18-ET21 (D76, D77). The email for one
// claimed outbox row: the rendered text and html, and for the three ticket
// kinds the QR as an inline attachment. The message is a pure function of the
// stored row, so a repeat try sends the same payload (ER10, ER12).

export type QrPng = (code: string) => Promise<Buffer>;

export type MessageRow = { kind: string; to_email: string; subject: string; body: string };

// A failing qrPng rejects the whole message (ET20): the email is never sent
// without the image, because that would change the payload between tries.
export async function buildMessage(row: MessageRow, qrPng: QrPng = makeQrPng): Promise<EmailMessage> {
  const { subject, text, html, ticketCode } = renderEmail(row);
  const message: EmailMessage = { to: row.to_email, subject, text, html };
  if (ticketCode === null) return message;

  const content = await qrPng(ticketCode);
  return {
    ...message,
    attachments: [{ filename: "ticket-qr.png", content, contentType: "image/png", contentId: QR_CONTENT_ID }],
  };
}
