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

  const client = await pool.connect();
  const applied = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    // Everything pending goes in ONE transaction, and the lock is
    // `pg_advisory_xact_lock` rather than `pg_advisory_lock`, because a
    // session-scoped lock is lost behind a transaction pooler — which is the
    // only way a free-tier Supabase project is reachable over IPv4. Being
    // transaction-scoped, the lock also releases itself on failure.
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);

      const done = new Set(
        (await client.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
      );

      for (const file of files) {
        if (done.has(file)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        } catch (err) {
          throw new Error(`migration ${file} failed: ${err.message}`, { cause: err });
        }
        applied.push(file);
        log(`[migrate] applied ${file}`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }

    if (!applied.length) log(`[migrate] up to date (${files.length} migrations)`);
    return applied;
  } finally {
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
