import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// The .env file is in the repository root, three levels up from src/db.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));

// Loads the repository .env with Node's built-in loader, unless the
// environment already has DATABASE_URL.
export function loadEnv(): void {
  if (process.env.DATABASE_URL === undefined && existsSync(envFile)) {
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
