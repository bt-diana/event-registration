// docs/specs/email-templates.md ET1-ET13 (D76). The look of every email: one
// shared html layout with its own content per kind, plus the plain-text part.
// Pure: no I/O, no environment, no clock, no random, no library. The html is
// built at send time from the three stored outbox columns (open question 1),
// so the same row always gives the same bytes (ER10, ER12).

export type StoredEmail = { kind: string; subject: string; body: string };

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
  // The code for the QR: a string for ticket, promotion and reminder, else null.
  ticketCode: string | null;
};

// The inline image's content id. message.ts attaches the PNG under this id.
export const QR_CONTENT_ID = "ticket-qr";

const QR_ALT = "QR code of your ticket. Show it at the door.";

// docs/brand.md, the seven colours of section 2 (ET12).
const GROUND = "#EEF1F0";
const SURFACE = "#FFFFFF";
const BORDER = "#C9D3D0";
const TEXT = "#101C1A";
const MUTED = "#4A5A57";
const ACCENT = "#0B6E5F";
const DARK_ERROR = "#8C1D18";

// System fonts only: web fonts are unreliable in mail (section 2). Single
// quotes, because these go inside style="..." attributes.
const FONT = "-apple-system, 'Segoe UI', system-ui, Roboto, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

const PREHEADER_MAX = 90;

type Content = {
  // The subject is `${prefix}<title>${suffix}` (ET3).
  prefix: string;
  suffix: string;
  eyebrow: string;
  eyebrowColour: string;
  intro: string;
  footer: string;
  // Reads the `Ticket code:` line and shows the ticket block (ET8).
  ticket: boolean;
};

// Section 2, "Content per kind". Fixed strings only.
const CONTENT: Record<string, Content> = {
  ticket: {
    prefix: "Your ticket for ",
    suffix: "",
    eyebrow: "Your ticket",
    eyebrowColour: ACCENT,
    intro: "You have a seat. Keep this email: the ticket code below lets you in at the door.",
    footer: "You got this email because you registered for this event.",
    ticket: true,
  },
  promotion: {
    prefix: "You have a seat at ",
    suffix: "",
    eyebrow: "Seat confirmed",
    eyebrowColour: ACCENT,
    intro: "A seat became free and it is yours. The ticket code below lets you in at the door.",
    footer: "You got this email because a seat became free and you were first on the waiting list.",
    ticket: true,
  },
  reminder: {
    prefix: "Reminder: ",
    suffix: " starts soon",
    eyebrow: "Reminder",
    eyebrowColour: ACCENT,
    intro: "The event starts within a day. Your ticket code is below.",
    footer: "You got this email because you have a seat at this event.",
    ticket: true,
  },
  reschedule: {
    prefix: "Rescheduled: ",
    suffix: "",
    eyebrow: "New time",
    eyebrowColour: ACCENT,
    intro: "The start time changed. Your registration stays as it is.",
    footer: "You got this email because you are registered or on the waiting list for this event.",
    ticket: false,
  },
  event_cancelled: {
    prefix: "Cancelled: ",
    suffix: "",
    eyebrow: "Cancelled",
    eyebrowColour: DARK_ERROR,
    intro: "The event has been cancelled. Your registration is cancelled too, and you do not need to do anything.",
    footer: "You got this email because you were registered or on the waiting list for this event.",
    ticket: false,
  },
};

// The labels of the facts shown in the details table (section 2, parsing rule).
const DETAIL_LABELS = ["Starts", "New start", "Previous start", "Was to start"];
const TICKET_LABEL = "Ticket code";

// ET5: the one escaping function. Every dynamic value goes through it.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeHtml;

// ET3: the subject without the fixed part of its kind, or the whole subject.
function titleOf(subject: string, content: Content): string {
  const { prefix, suffix } = content;
  if (subject.length > prefix.length + suffix.length && subject.startsWith(prefix) && subject.endsWith(suffix)) {
    return subject.slice(prefix.length, subject.length - suffix.length);
  }
  return subject;
}

type Detail = { label: string; value: string };

// From the second line on: `Label: value` lines with a known label. The
// ticket code is read only for the three ticket kinds (ET8). Other lines and
// empty values are ignored (ET13).
function parseBody(body: string, ticket: boolean): { details: Detail[]; ticketCode: string | null } {
  const details: Detail[] = [];
  let ticketCode: string | null = null;
  for (const raw of body.split("\n").slice(1)) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const separator = line.indexOf(": ");
    if (separator <= 0) continue;
    const label = line.slice(0, separator);
    const value = line.slice(separator + 2);
    if (value.trim() === "") continue;
    if (label === TICKET_LABEL) {
      if (ticket && ticketCode === null) ticketCode = value.trim();
    } else if (DETAIL_LABELS.includes(label)) {
      details.push({ label, value });
    }
  }
  return { details, ticketCode };
}

// The intro, or its first sentence when the intro is longer than 90 characters.
function preheaderOf(intro: string): string {
  if (intro.length <= PREHEADER_MAX) return intro;
  const end = intro.indexOf(". ");
  return end > 0 && end < PREHEADER_MAX ? intro.slice(0, end + 1) : intro.slice(0, PREHEADER_MAX);
}

// Hidden padding after the preheader, so the inbox does not pull in body text.
const PREHEADER_PADDING = "&zwnj;&nbsp;".repeat(40);

const PHONE_STYLE = `<style>
@media (max-width: 520px) {
  .page { padding: 16px !important; }
  .card { padding: 20px !important; }
  .title { font-size: 24px !important; }
  .detail-label, .detail-value { display: block !important; width: 100% !important; }
  .detail-label { padding-bottom: 0 !important; }
  .detail-value { padding-top: 4px !important; }
  .qr { max-width: 100% !important; height: auto !important; }
}
</style>`;

function detailsTable(details: Detail[]): string {
  if (details.length === 0) return "";
  const rows = details.map((detail, index) => {
    const line = index === 0 ? "" : `border-top:1px solid ${BORDER};`;
    return `<tr>
<td class="detail-label" width="40%" valign="top" style="${line}padding:12px 16px 12px 0;font-size:14px;line-height:20px;font-weight:600;color:${MUTED};">${e(detail.label)}</td>
<td class="detail-value" valign="top" style="${line}padding:12px 0;font-size:16px;line-height:20px;color:${TEXT};">${e(detail.value)}</td>
</tr>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 24px 0;">
${rows.join("\n")}
</table>`;
}

// Only for ticket, promotion and reminder with a code. The code is text (not
// only an image), so a client that blocks the image still shows it (ET19).
function ticketBlock(code: string): string {
  return `<p style="margin:0 0 8px 0;font-size:14px;line-height:20px;font-weight:600;color:${MUTED};">${e(TICKET_LABEL)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
<tr>
<td bgcolor="${GROUND}" style="background-color:${GROUND};border:1px solid ${BORDER};border-radius:8px;padding:12px 16px;font-family:${MONO};font-size:24px;line-height:32px;font-weight:600;letter-spacing:0.12em;color:${TEXT};">${e(code)}</td>
</tr>
</table>
<img src="cid:${QR_CONTENT_ID}" alt="${QR_ALT}" width="232" height="232" border="0" class="qr" style="display:block;max-width:100%;height:auto">
<p style="margin:16px 0 0 0;font-size:15px;line-height:1.5;color:${MUTED};">Show this code or the QR code at the door.</p>`;
}

// The layout has a slot for one accent button under the ticket block, but no
// kind uses it in this version: there is no public web address and no event
// id in the row (open question 2). So there is no link in any email.
function layout(parts: {
  subject: string;
  preheader: string;
  eyebrow: string;
  eyebrowColour: string;
  title: string;
  intro: string;
  details: string;
  ticket: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(parts.subject)}</title>
${PHONE_STYLE}
</head>
<body bgcolor="${GROUND}" style="margin:0;padding:0;background-color:${GROUND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${e(parts.preheader)}${PREHEADER_PADDING}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="width:100%;background-color:${GROUND};">
<tr>
<td class="page" align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr>
<td style="padding:0 0 16px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${ACCENT};">Event Registration</td>
</tr>
<tr>
<td class="card" bgcolor="${SURFACE}" style="background-color:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:32px;font-family:${FONT};color:${TEXT};">
<p style="margin:0 0 8px 0;font-size:13px;line-height:20px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${parts.eyebrowColour};">${e(parts.eyebrow)}</p>
<h1 class="title" style="margin:0 0 16px 0;font-family:${FONT};font-size:28px;line-height:1.2;font-weight:700;color:${TEXT};word-break:break-word;">${e(parts.title)}</h1>
<p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;color:${TEXT};">${e(parts.intro)}</p>
${parts.details}
${parts.ticket}
</td>
</tr>
<tr>
<td style="padding:16px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">
<p style="margin:0;">${e(parts.footer)}</p>
<p style="margin:0;">Times are in UTC.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
}

export function renderEmail(row: StoredEmail): RenderedEmail {
  if (!Object.hasOwn(CONTENT, row.kind)) throw new Error(`no email template for kind ${row.kind}`);
  const content = CONTENT[row.kind];
  const { details, ticketCode } = parseBody(row.body, content.ticket);

  const html = layout({
    subject: row.subject,
    preheader: preheaderOf(content.intro),
    eyebrow: content.eyebrow,
    eyebrowColour: content.eyebrowColour,
    title: titleOf(row.subject, content),
    intro: content.intro,
    details: detailsTable(details),
    ticket: ticketCode === null ? "" : ticketBlock(ticketCode),
    footer: content.footer,
  });

  // ET4: the stored body byte for byte, an empty line, the footer line.
  const text = `${row.body}\n\n${content.footer}`;
  return { subject: row.subject, text, html, ticketCode };
}
