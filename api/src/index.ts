import { createApp } from "./app.js";
import { createPool, loadEnv } from "./db/pool.js";
import { readMailConfig, type MailConfig } from "./email/config.js";
import { readIntervalMs, startEmailJobs, type EmailJobs } from "./email/jobs.js";
import { createResendTransport } from "./email/transport.js";

// The settings are read before anything listens (email-reminders.md ER38,
// ER47, D59): a bad or missing one prints its message (variable names only,
// never a value) and exits with code 1.
loadEnv();
let intervalMs: number;
let mail: MailConfig;
try {
  intervalMs = readIntervalMs(process.env);
  mail = readMailConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "invalid settings");
  process.exit(1);
}

const pool = createPool();
const port = Number(process.env.PORT ?? 3000);
let jobs: EmailJobs | undefined;

const server = createApp({ pool }).listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  // The only real provider client is built here.
  jobs = startEmailJobs({ pool, transport: createResendTransport(mail), intervalMs });
});

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await jobs?.stop();
  server.close();
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "shutdown failed");
      process.exitCode = 1;
    });
  });
}
