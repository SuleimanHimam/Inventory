/**
 * Migration runner.
 *
 * Plain SQL files in `server/migrations-mssql`, applied in filename order, all
 * in one transaction, recorded in `schema_migrations` so a re-run is a no-op.
 * No migration framework: the deployment target is a single Windows Server
 * instance that boots with `npm start`, and one `sp_getapplock` is all the
 * coordination a single-instance deploy needs.
 *
 * T-SQL requires certain DDL (`CREATE TRIGGER`, `CREATE FUNCTION`, …) to be
 * the sole statement in its batch, so each migration file is split on a line
 * containing just `GO` — the same convention `sqlcmd` uses — and every
 * migration authored from here on must follow it.
 *
 * Usage:  npm run migrate        (also runs automatically at server start)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { pool, configError } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, '../../migrations-mssql');

// sp_getapplock's @Resource is scoped to the database it runs against, so
// this only has to be unique within this app's own database.
const LOCK_RESOURCE = 'inventory_migrate';

/** Split a .sql file into batches the way sqlcmd does: on a line of just GO. */
function splitBatches(sqlText) {
  return sqlText
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);
}

export async function migrate({ log = console.log } = {}) {
  if (configError) throw configError;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  await pool.connect();
  const transaction = new sql.Transaction(pool);
  const applied = [];
  await transaction.begin();
  try {
    // Stricter than the app's normal connections (XACT_ABORT OFF — see the
    // header comment in db/index.js) on purpose: this connection never uses
    // savepoints, so there is nothing for a lenient abort mode to protect,
    // only value in failing the whole run immediately on any error.
    await new sql.Request(transaction).batch('SET XACT_ABORT ON;');

    await new sql.Request(transaction).batch(`
      IF OBJECT_ID('dbo.schema_migrations') IS NULL
      CREATE TABLE schema_migrations (
        id         nvarchar(255) NOT NULL PRIMARY KEY,
        applied_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    `);

    // Transaction-scoped exclusive lock, released automatically on
    // commit/rollback — the sp_getapplock equivalent of Postgres's
    // pg_advisory_xact_lock. A negative return means it failed to acquire
    // (timeout/deadlock/parameter error); sp_getapplock does not raise its
    // own error for that, so the check is explicit.
    const lockRequest = new sql.Request(transaction);
    lockRequest.input('resource', LOCK_RESOURCE);
    await lockRequest.query(`
      DECLARE @result int;
      EXEC @result = sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction';
      IF @result < 0 THROW 50020, 'sp_getapplock failed to acquire the migration lock', 1;
    `);

    const doneRows = (await new sql.Request(transaction).query('SELECT id FROM schema_migrations')).recordset;
    const done = new Set(doneRows.map((r) => r.id));

    for (const file of files) {
      if (done.has(file)) continue;
      const fileSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        for (const batchText of splitBatches(fileSql)) {
          await new sql.Request(transaction).batch(batchText);
        }
        const insertReq = new sql.Request(transaction);
        insertReq.input('id', file);
        await insertReq.query('INSERT INTO schema_migrations (id) VALUES (@id)');
      } catch (err) {
        throw new Error(`migration ${file} failed: ${err.message}`, { cause: err });
      }
      applied.push(file);
      log(`[migrate] applied ${file}`);
    }
    await transaction.commit();

    if (!applied.length) log(`[migrate] up to date (${files.length} migrations)`);
    return applied;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      // Already gone — nothing more to undo.
    }
    throw err;
  }
}

// Run directly: `node src/db/migrate.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => pool.close())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
