import { randomInt } from "node:crypto";

// A-Z without I and O, and 2-9: 32 characters (DATABASE.md decision 3).
export const TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TICKET_LENGTH = 10;

// randomInt has no modulo bias (registration.md R2).
export function makeTicketCode(): string {
  let code = "";
  for (let i = 0; i < TICKET_LENGTH; i++) {
    code += TICKET_ALPHABET[randomInt(TICKET_ALPHABET.length)];
  }
  return code;
}
