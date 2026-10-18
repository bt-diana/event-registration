import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// The .env file is in api/, two levels up from src/db (and from dist/db).
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));

// Loads api/.env with Node's built-in loader when DATABASE_URL or
// COOKIE_SECRET is missing. Variables already in the environment win.
export function loadEnv(): void {
  const missing = process.env.DATABASE_URL === undefined || process.env.COOKIE_SECRET === undefined;
  if (missing && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

export function createPool(config: pg.PoolConfig = {}): pg.Pool {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new pg.Pool({ ...config, connectionString });
}
