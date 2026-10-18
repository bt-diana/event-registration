// docs/specs/email-reminders.md ER44-ER46 (D59). The API does not start
// without the provider key and the sender address. The environment is passed
// in, so tests use plain objects and never the real key.

export type MailConfig = { apiKey: string; from: string };

// The message names the variables only, never a value (ER46).
export function readMailConfig(env: Readonly<Record<string, string | undefined>>): MailConfig {
  const apiKey = env.EMAIL_API_KEY?.trim() ?? "";
  const from = env.MAIL_FROM?.trim() ?? "";
  const missing = [apiKey === "" ? "EMAIL_API_KEY" : null, from === "" ? "MAIL_FROM" : null].filter(
    (name): name is string => name !== null,
  );
  if (missing.length > 0) {
    throw new Error(`${missing.join(" and ")} must be set (see .env.example); the API does not start without them`);
  }
  return { apiKey, from };
}
