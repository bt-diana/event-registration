// `npm run db:migrate`: applies the pending migrations to DATABASE_URL.
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";

const pool = createPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length > 0 ? `Applied: ${applied.join(", ")}` : "Nothing to apply");
} finally {
  await pool.end();
}
