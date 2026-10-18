// Client checks (W-A10). The same rules as auth.md A5 and A7; the server still decides (W-A11).
// Each returns the error text, or null when the value is fine.

const EMAIL = /^[^@\s]+@[^@\s]+$/;

// Characters as code points, the way the API counts them.
function length(text: string): number {
  return [...text].length;
}

export function validateEmail(value: string): string | null {
  const email = value.trim();
  return EMAIL.test(email) && length(email) <= 254 ? null : "Enter a valid email address.";
}

export function validateName(value: string): string | null {
  const size = length(value.trim());
  return size >= 1 && size <= 100 ? null : "Enter your name (1 to 100 characters).";
}

// Not trimmed. Login only needs a non-empty password.
export function validatePassword(value: string, mode: "login" | "signup"): string | null {
  if (mode === "login") return value.length > 0 ? null : "Enter your password.";
  const size = length(value);
  return size >= 8 && size <= 128 ? null : "Use 8 to 128 characters.";
}

// A same-site path only (W-A5): one leading "/", not "//", no scheme. A backslash or a
// control or space character is refused too, because browsers may read "/\x" or "/\t/x" as "//x".
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex -- control characters are what we refuse
  if (/[\\\s\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}
