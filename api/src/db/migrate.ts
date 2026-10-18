import { fileURLToPath } from "node:url";
import type pg from "pg";

export const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

// Stub: applies nothing yet. Returns the file names it applied.
export async function migrate(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  void pool;
  void dir;
  return [];
}
