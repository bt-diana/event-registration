import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmail } from "../../src/email/templates.js";

// The email template (email-templates.md ET1-ET13, D76, roadmap step 34b).
// Written before the module: ET1, ET2, ET4-ET10 are the tests first. Plain
// objects only: no database, no network, no clock.

type Kind = "ticket" | "promotion" | "reminder" | "reschedule" | "event_cancelled";
type Row = { kind: Kind; subject: string; body: string };

const CODE = "ABCDEFGH23";

// The stored shapes (registration/service.ts, reminders.ts, events/manage.ts;
// the promotion as recommended in cancel-registration.md question 8).
function stored(kind: Kind, title: string, code = CODE): Row {
  switch (kind) {
    case "ticket":
      return {
        kind,
        subject: `Your ticket for ${title}`,
        body: `You have a seat at ${title}.\nStarts: 2030-01-01T10:00:00.000Z (UTC)\nTicket code: ${code}`,
      };
    case "promotion":
      return {
        kind,
        subject: `You have a seat at ${title}`,
        body: `You have a seat at ${title}.\nStarts: 2030-01-01T10:00:00.000Z (UTC)\nTicket code: ${code}`,
      };
    case "reminder":
      return {
        kind,
        subject: `Reminder: ${title} starts soon`,
        body: `${title}\nStarts: 2030-01-02 09:00 (UTC)\nTicket code: ${code}`,
      };
    case "reschedule":
      return {
        kind,
        subject: `Rescheduled: ${title}`,
        body: `${title}\nNew start: 2030-02-01 10:00 (UTC)\nPrevious start: 2030-01-01 10:00 (UTC)`,
      };
    case "event_cancelled":
      return {
        kind,
        subject: `Cancelled: ${title}`,
        body: `${title}\nWas to start: 2030-01-01 10:00 (UTC)\nThe event has been cancelled.`,
      };
  }
}

const KINDS: Kind[] = ["ticket", "promotion", "reminder", "reschedule", "event_cancelled"];
const TICKET_KINDS: Kind[] = ["ticket", "promotion", "reminder"];

// Section 2, "Content per kind".
const CONTENT: Record<Kind, { eyebrow: string; intro: string; footer: string; labels: string[] }> = {
  ticket: {
    eyebrow: "Your ticket",
    intro: "You have a seat. Keep this email: the ticket code below lets you in at the door.",
    footer: "You got this email because you registered for this event.",
    labels: ["Starts"],
  },
  promotion: {
    eyebrow: "Seat confirmed",
    intro: "A seat became free and it is yours. The ticket code below lets you in at the door.",
    footer: "You got this email because a seat became free and you were first on the waiting list.",
    labels: ["Starts"],
  },
  reminder: {
    eyebrow: "Reminder",
    intro: "The event starts within a day. Your ticket code is below.",
    footer: "You got this email because you have a seat at this event.",
    labels: ["Starts"],
  },
  reschedule: {
    eyebrow: "New time",
    intro: "The start time changed. Your registration stays as it is.",
    footer: "You got this email because you are registered or on the waiting list for this event.",
    labels: ["New start", "Previous start"],
  },
  event_cancelled: {
    eyebrow: "Cancelled",
    intro: "The event has been cancelled. Your registration is cancelled too, and you do not need to do anything.",
    footer: "You got this email because you were registered or on the waiting list for this event.",
    labels: ["Was to start"],
  },
};

// `Label: value` lines from the second line on.
function details(body: string): { label: string; value: string }[] {
  return body
    .split("\n")
    .slice(1)
    .map((line) => /^([A-Z][a-z ]*): (.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ label: match[1], value: match[2] }));
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("ET1: pure and deterministic (tests first)", () => {
  it("gives a byte-identical output on 100 calls and for equal but separate objects", () => {
    for (const kind of KINDS) {
      const first = renderEmail(stored(kind, "Spring Meetup"));
      for (let call = 0; call < 100; call++) expect(renderEmail(stored(kind, "Spring Meetup"))).toEqual(first);
      const row = stored(kind, "Spring Meetup");
      expect(renderEmail(row)).toEqual(renderEmail({ ...row }));
    }
  });

  it("does not change its input", () => {
    const row = stored("ticket", "Spring Meetup");
    const copy = { ...row };
    renderEmail(row);
    expect(row).toEqual(copy);
  });

  it("imports nothing and reads no environment, clock or random source", () => {
    const source = readFileSync(new URL("../../src/email/templates.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
    for (const banned of ["process.", "Date", "Math.random", "crypto", "performance"]) {
      expect(source).not.toContain(banned);
    }
  });
});

describe("ET2: the subject is unchanged (tests first)", () => {
  it("returns the stored subject for all five kinds", () => {
    const expected: Record<Kind, string> = {
      ticket: "Your ticket for Spring Meetup",
      promotion: "You have a seat at Spring Meetup",
      reminder: "Reminder: Spring Meetup starts soon",
      reschedule: "Rescheduled: Spring Meetup",
      event_cancelled: "Cancelled: Spring Meetup",
    };
    for (const kind of KINDS) {
      const row = stored(kind, "Spring Meetup");
      expect(row.subject).toBe(expected[kind]);
      expect(renderEmail(row).subject).toBe(row.subject);
    }
  });
});

describe("ET3: the title comes from the subject", () => {
  it("removes the fixed part of the kind", () => {
    for (const kind of KINDS) {
      const { html } = renderEmail(stored(kind, "Spring Meetup"));
      expect(html).toMatch(/<h1[^>]*>Spring Meetup<\/h1>/);
    }
  });

  it("uses the whole subject when the fixed part is missing, without throwing", () => {
    for (const kind of KINDS) {
      const { html } = renderEmail({ kind, subject: "Hand made", body: "" });
      expect(html).toMatch(/<h1[^>]*>Hand made<\/h1>/);
    }
    expect(renderEmail({ kind: "reminder", subject: "Reminder: no suffix", body: "" }).html).toMatch(
      /<h1[^>]*>Reminder: no suffix<\/h1>/,
    );
  });
});

describe("ET4: the plain-text part (tests first)", () => {
  it("is the stored body byte for byte, an empty line, then the footer line of the kind", () => {
    for (const kind of KINDS) {
      const row = stored(kind, "Spring Meetup");
      expect(renderEmail(row).text).toBe(`${row.body}\n\n${CONTENT[kind].footer}`);
    }
  });

  it("keeps every old fact of the text", () => {
    const text = (kind: Kind) => renderEmail(stored(kind, "Spring Meetup")).text;
    expect(text("ticket")).toContain("Starts: 2030-01-01T10:00:00.000Z (UTC)");
    expect(text("ticket")).toContain(`Ticket code: ${CODE}`);
    expect(text("reminder")).toContain("Starts: 2030-01-02 09:00 (UTC)");
    expect(text("reschedule")).toContain("New start: 2030-02-01 10:00 (UTC)");
    expect(text("reschedule")).toContain("Previous start: 2030-01-01 10:00 (UTC)");
    expect(text("event_cancelled")).toContain("Was to start: 2030-01-01 10:00 (UTC)");
    expect(text("event_cancelled")).toContain("The event has been cancelled.");
  });
});

describe("ET5: html escaping (tests first)", () => {
  it("escapeHtml turns & < > \" ' into entities", () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
  });

  it("escapes the title, the detail values, the ticket code and the document title", () => {
    const title = `<b>"&`;
    for (const kind of KINDS) {
      const row = stored(kind, title);
      const { html } = renderEmail(row);
      expect(html).toContain("&lt;b&gt;&quot;&amp;");
      expect(html).not.toContain("<b>");
      expect(html).toContain(`<title>${escapeHtml(row.subject)}</title>`);
    }
    const hostile = renderEmail({
      kind: "reschedule",
      subject: "Rescheduled: x",
      body: "x\nNew start: <i>soon</i>\nPrevious start: a & b",
    }).html;
    expect(hostile).toContain("&lt;i&gt;soon&lt;/i&gt;");
    expect(hostile).toContain("a &amp; b");
    expect(hostile).not.toContain("<i>");
    const code = renderEmail(stored("ticket", "x", "<CODE&1>"));
    expect(code.html).toContain("&lt;CODE&amp;1&gt;");
    expect(code.html).not.toContain("<CODE&1>");
  });
});

describe("ET6: no dynamic text in attributes or structure (tests first)", () => {
  it("a plain and a hostile title give the same html after replacing the escaped title", () => {
    const hostileTitle = `" onmouseover="x" <script>alert(1)</script>`;
    for (const kind of KINDS) {
      const plain = renderEmail(stored(kind, "Plain")).html;
      const hostile = renderEmail(stored(kind, hostileTitle)).html;
      expect(hostile).not.toContain("<script");
      expect(hostile.split(escapeHtml(hostileTitle)).join("{TITLE}")).toBe(plain.split("Plain").join("{TITLE}"));
    }
  });
});

describe("ET7: each kind shows its facts (tests first)", () => {
  it("has the escaped title, the eyebrow, the intro and every detail of the kind", () => {
    for (const kind of KINDS) {
      const row = stored(kind, "Spring Meetup & Friends");
      const { html } = renderEmail(row);
      const content = CONTENT[kind];
      expect(html).toContain("Spring Meetup &amp; Friends");
      expect(html).toContain(content.eyebrow);
      expect(html).toContain(content.intro);
      const found = details(row.body).filter((d) => d.label !== "Ticket code");
      expect(found.map((d) => d.label)).toEqual(content.labels);
      for (const detail of found) {
        expect(html).toContain(`>${detail.label}<`);
        expect(html).toContain(`>${escapeHtml(detail.value)}<`);
      }
    }
  });
});

describe("ET8: the ticket code only where it belongs (tests first)", () => {
  it("shows the code once and returns it for ticket, promotion and reminder", () => {
    for (const kind of TICKET_KINDS) {
      const result = renderEmail(stored(kind, "Spring Meetup"));
      expect(result.ticketCode).toBe(CODE);
      expect(count(result.html, CODE)).toBe(1);
    }
  });

  it("has no code for reschedule and event_cancelled, even when the body holds one", () => {
    for (const kind of ["reschedule", "event_cancelled"] as Kind[]) {
      const row = stored(kind, "Spring Meetup");
      const wrong = { ...row, body: `${row.body}\nTicket code: ${CODE}` };
      for (const input of [row, wrong]) {
        const result = renderEmail(input);
        expect(result.ticketCode).toBeNull();
        expect(result.html).not.toContain(CODE);
        expect(result.html).not.toContain("Ticket code");
        expect(result.html).not.toContain("<img");
      }
    }
  });
});

describe("ET9: the same facts in text and html (tests first)", () => {
  it("every Label: value line, the footer and the title are in both parts", () => {
    for (const kind of KINDS) {
      const row = stored(kind, "Spring Meetup");
      const { text, html } = renderEmail(row);
      for (const detail of details(row.body)) {
        expect(text).toContain(`${detail.label}: ${detail.value}`);
        expect(html).toContain(detail.label);
        expect(html).toContain(escapeHtml(detail.value));
      }
      expect(text).toContain(CONTENT[kind].footer);
      expect(html).toContain(CONTENT[kind].footer);
      expect(text).toContain("Spring Meetup");
      expect(html).toContain("Spring Meetup");
    }
  });
});

describe("ET10: self-contained (tests first)", () => {
  it("loads nothing from outside and has one style block and only the cid image", () => {
    for (const kind of KINDS) {
      const { html } = renderEmail(stored(kind, "Spring Meetup"));
      for (const banned of ["<script", "<link", "<iframe", "@import", "url(", "http://", "https://", "@font-face"]) {
        expect(html.toLowerCase()).not.toContain(banned);
      }
      expect(count(html, "<style")).toBe(1);
      const images = html.match(/<img\b[^>]*>/g) ?? [];
      if (TICKET_KINDS.includes(kind)) {
        expect(images).toHaveLength(1);
        expect(images[0]).toContain('src="cid:ticket-qr"');
      } else {
        expect(images).toHaveLength(0);
      }
      // Plain ASCII for an ASCII title: no emoji, typographic characters are entities.
      expect(html).not.toMatch(/[^\t\n\r -~]/);
    }
  });
});

describe("ET11: document shape", () => {
  it("has the doctype, lang, charset, viewport, title, presentation tables, 600px card and the preheader first", () => {
    for (const kind of KINDS) {
      const row = stored(kind, "Spring Meetup");
      const { html } = renderEmail(row);
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
      expect(html).toContain(`<title>${escapeHtml(row.subject)}</title>`);
      expect(html).toContain('<table role="presentation"');
      expect(html).toContain("max-width:600px");
      const afterBody = html.slice(html.indexOf("<body"));
      const firstElement = afterBody.slice(afterBody.indexOf(">") + 1).trimStart();
      expect(firstElement).toMatch(/^<div[^>]*display:none[^>]*>/);
      expect(firstElement).toContain("&zwnj;&nbsp;");
    }
  });

  it("the preheader is at most 90 characters", () => {
    for (const kind of KINDS) {
      const { html } = renderEmail(stored(kind, "Spring Meetup"));
      const afterBody = html.slice(html.indexOf("<body"));
      const preheader = /^<body[^>]*>\s*<div[^>]*>([^<&]*)/.exec(afterBody);
      expect(preheader).not.toBeNull();
      expect(preheader![1].trim().length).toBeGreaterThan(0);
      expect(preheader![1].trim().length).toBeLessThanOrEqual(90);
      expect(CONTENT[kind].intro.startsWith(preheader![1].trim())).toBe(true);
    }
  });
});

describe("ET12: palette only", () => {
  it("uses only the brand colours", () => {
    const palette = ["#EEF1F0", "#FFFFFF", "#C9D3D0", "#101C1A", "#4A5A57", "#0B6E5F", "#8C1D18"];
    for (const kind of KINDS) {
      const { html } = renderEmail(stored(kind, "Spring Meetup"));
      const colours = html.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      expect(colours.length).toBeGreaterThan(0);
      for (const colour of colours) expect(palette).toContain(colour.toUpperCase());
    }
    expect(renderEmail(stored("event_cancelled", "x")).html).toContain("#8C1D18");
    expect(renderEmail(stored("ticket", "x")).html).not.toContain("#8C1D18");
  });
});

describe("ET13: missing facts do not break the email", () => {
  it("renders a body without a Starts line", () => {
    const { html, ticketCode } = renderEmail({ kind: "ticket", subject: "Your ticket for X", body: `X\nTicket code: ${CODE}` });
    expect(ticketCode).toBe(CODE);
    expect(html).not.toContain("Starts");
    for (const bad of ["undefined", "null", "NaN"]) expect(html).not.toContain(bad);
    expect(html).toContain("</html>");
  });

  it("an empty body gives the title and the footer only", () => {
    for (const kind of KINDS) {
      const result = renderEmail({ kind, subject: stored(kind, "Empty").subject, body: "" });
      expect(result.html).toMatch(/<h1[^>]*>Empty<\/h1>/);
      expect(result.html).toContain(CONTENT[kind].footer);
      expect(result.ticketCode).toBeNull();
      expect(result.html).not.toContain("<img");
      expect(result.html).not.toContain("Ticket code");
      for (const label of ["Starts", "New start", "Previous start", "Was to start"]) {
        expect(result.html).not.toContain(label);
      }
      expect(result.html).not.toContain("undefined");
      expect(result.html.endsWith("</html>\n") || result.html.endsWith("</html>")).toBe(true);
    }
  });

  it("ignores a detail line with an empty value", () => {
    const { html } = renderEmail({ kind: "reschedule", subject: "Rescheduled: X", body: "X\nNew start: \nPrevious start: 2030" });
    expect(html).not.toContain(">New start<");
    expect(html).toContain(">Previous start<");
  });
});
