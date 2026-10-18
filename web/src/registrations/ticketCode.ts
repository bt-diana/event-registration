// The ticket code check (registration-web.md W-R31, W-R32), done before any request.
// Alphabet as the API: A-Z without I and O, and 2-9; 10 characters.
const TICKET_CODE = /^[A-HJ-NP-Z2-9]{10}$/;

// A decoded text (or a normalised typed one) to the code, or null when it is not one.
export function parseTicketCode(text: string): string | null {
  const code = text.trim();
  return TICKET_CODE.test(code) ? code : null;
}

// The manual field accepts lower case and spaces (W-R32).
export function normalizeTyped(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}
