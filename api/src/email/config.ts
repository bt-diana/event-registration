// docs/specs/email-reminders.md ER44-ER46. Stub for the tests-first commit.

export type MailConfig = { apiKey: string; from: string };

export const readMailConfig: (env: Readonly<Record<string, string | undefined>>) => MailConfig = () => {
  throw new Error("not implemented");
};
