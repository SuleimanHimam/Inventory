/**
 * Migration runner.
 *
 * Plain SQL files in `server/migrations`, applied in filename order, each in its
 * own transaction, recorded in `schema_migrations` so a re-run is a no-op. No
 * migration framework: the deployment target is a free Render instance that
 * boots with `npm start`, and one advisory lock is all the coordination a
 * single-instance deploy needs.
 *
 * Usage:  npm run migrate        (also runs automatically at server start)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

// Any stable arbitrary number: it only has to be the same in every process.
const LOCK_KEY = 4317_2026;

export async function migrate({ log = console.log } = {}) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  // One client for the whole run: an advisory lock belongs to the session that
  // took it, so it cannot be taken and released through the pool.
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    const done = new Set(
      (await client.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${err.message}`, { cause: err });
      }
      applied.push(file);
      log(`[migrate] applied ${file}`);
    }

    if (!applied.length) log(`[migrate] up to date (${files.length} migrations)`);
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// Run directly: `node src/db/migrate.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
