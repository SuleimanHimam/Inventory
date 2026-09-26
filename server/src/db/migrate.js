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
import { DB_NAME, configError, connectFile, close } from './index.js';

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

/**
 * Apply every pending migration to one file's database.
 *
 * `database` defaults to the configured one, which is what `npm run migrate`
 * and the boot-time run mean. Creating a file passes the new database's name
 * instead: a file is only a file once this has run against it, so the same
 * runner builds both, and a migration added later reaches every file rather
 * than only the original.
 */
export async function migrate({ log = console.log, database = DB_NAME } = {}) {
  if (configError) throw configError;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  const pool = await connectFile(database);
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

/**
 * Apply pending migrations to the default database *and every file database*.
 *
 * Boot only migrated the configured DB, and a file otherwise gets migrations
 * only when it is first created — so a migration added after a file existed
 * (the whole accounting module, for one) never reached that file, leaving it
 * without the new tables/columns. Running this at boot makes a plain
 * pull-and-restart deploy propagate every migration to every file, which is
 * how this app is delivered. Each file is migrated on its own connection and
 * failures are collected, not thrown, so one broken file cannot stop the rest.
 */
export async function migrateAllFiles({ log = console.log } = {}) {
  if (configError) throw configError;
  await migrate({ log }); // the configured/default database first
  const { listFiles } = await import('../lib/files.js');
  const files = await listFiles();
  const failures = [];
  for (const f of files) {
    if (f.id === DB_NAME) continue; // already done above
    try {
      await migrate({ log, database: f.id });
    } catch (err) {
      failures.push({ file: f.id, error: err.message });
      log(`[migrate] file ${f.id} failed: ${err.message}`);
    }
  }
  if (failures.length) {
    const e = new Error(`migration failed for ${failures.length} file(s): `
      + failures.map((x) => x.file).join(', '));
    e.failures = failures;
    throw e;
  }
  return files.map((f) => f.id);
}

// Run directly: `node src/db/migrate.js [--all]`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (process.argv.includes('--all') ? migrateAllFiles() : migrate())
    .then(() => close())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
