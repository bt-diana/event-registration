import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

export const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

// Applies the .sql files in `dir` in file-name order. Each file runs in its own
// transaction together with its row in schema_migrations, so a file is either
// fully applied and recorded, or not at all. Files already recorded are
// skipped. Returns the file names applied by this call.
export async function migrate(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const done = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  const applied = new Set(done.rows.map((row) => row.filename));
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();

  const appliedNow: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    appliedNow.push(file);
  }
  return appliedNow;
}
