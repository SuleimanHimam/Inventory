/**
 * SQL Server data access layer.
 *
 * Replaces the PostgreSQL layer of v6.0. Three things are worth knowing before
 * reading the services:
 *
 *  1. `@name` bind parameters are kept — and needed no rewriting to get here.
 *     `@name` is native T-SQL parameter syntax, so `compile()` just extracts
 *     the distinct names a query uses and hands their values to
 *     `request.input()`; the driver does the actual parameterised binding.
 *
 *  2. Tenant isolation is a single layer now, not two. SQL Server has no
 *     transaction-local equivalent of Postgres's `SET LOCAL` (its
 *     `SESSION_CONTEXT` is connection-scoped, which is unsafe to rely on
 *     under pooling), so Row-Level-Security was dropped rather than ported.
 *     Every service query still carries an explicit `org_id = @org`
 *     predicate — that was always the primary defence, RLS was
 *     defence-in-depth on top of it.
 *
 *  3. SQL Server dooms a transaction on a unique-constraint violation or a
 *     trigger-raised error in a way `ROLLBACK TRANSACTION <savepoint>` cannot
 *     recover from — proven empirically against this schema (plain `CHECK`
 *     violations recover fine; unique-index and trigger `THROW` failures do
 *     not). `tx()` marks this with `err.transactionDoomed = true` when a
 *     savepoint rollback itself fails, so a catch-and-continue caller (the
 *     importer, in particular) can tell "this row failed, try the next one"
 *     apart from "this whole transaction is unusable now, stop." The safe
 *     pattern for anything that might race a unique constraint (see
 *     `nextNumber`/`setSettings` below) is to check under `UPDLOCK, HOLDLOCK`
 *     before writing, not to attempt the write and catch the violation.
 *
 *  4. The org id and the current transaction travel in AsyncLocalStorage
 *     rather than through every function signature, so the service layer
 *     keeps the exact same public API it had as a desktop app.
 */
import sql from 'mssql';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { AppError } from '../lib/errors.js';

export const DB_SERVER = process.env.DB_SERVER;
export const DB_NAME = process.env.DB_NAME;
export const DB_USER = process.env.DB_USER;
export const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_ENCRYPT = (process.env.DB_ENCRYPT ?? 'false') === 'true';
const DB_TRUST_SERVER_CERTIFICATE = (process.env.DB_TRUST_SERVER_CERTIFICATE ?? 'true') === 'true';

/**
 * Missing configuration is recorded, not thrown at import time — see the
 * PostgreSQL-era comment this replaces for why: throwing here used to kill
 * the process before `app.listen` ever ran, which reports to a host as an
 * undifferentiated failed health check. Now the API starts, `/api/v1/health`
 * names the problem, and the error still surfaces on the first query.
 */
export const configError = (DB_SERVER && DB_NAME && DB_USER && DB_PASSWORD)
  ? null
  : new Error(
    'DB_SERVER, DB_NAME, DB_USER and DB_PASSWORD must all be set — point them at '
    + 'your SQL Server instance, e.g. DB_SERVER=127.0.0.1\\INVENTORY.',
  );

/**
 * Connection options shared with the admin pool in lib/backup.js, which needs
 * the same server and credentials but binds to `master` instead — see the
 * header there for why a backup or restore cannot run on this pool.
 */
export const DB_OPTIONS = {
  encrypt: DB_ENCRYPT,
  trustServerCertificate: DB_TRUST_SERVER_CERTIFICATE,
  enableArithAbort: true,
};

export const pool = configError ? null : new sql.ConnectionPool({
  server: DB_SERVER,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  options: DB_OPTIONS,
  // The API runs as a single instance against a local SQL Server — a small
  // pool leaves headroom for the migration runner and sqlcmd/SSMS.
  pool: {
    max: Number(process.env.DB_POOL_MAX ?? 8),
    idleTimeoutMillis: 30_000,
    /*
     * Never wait forever for a connection.
     *
     * Without this, anything that pins the pool — the aborted-request leak
     * `orgContext` used to have, a genuinely slow query, a stuck transaction —
     * turns every later request into an indefinite hang. The API stays
     * "running", `/health` keeps answering `ok`, and the only symptom is that
     * nothing responds, which is the hardest possible failure to diagnose from
     * the outside.
     *
     * A bounded wait converts that into an error with a name, at the cost of
     * refusing a request that a very slow moment might eventually have served.
     * That is the right trade for an app whose queries are all sub-second.
     */
    acquireTimeoutMillis: Number(process.env.DB_ACQUIRE_TIMEOUT_MS ?? 15_000),
  },
  // A runaway query must not pin a connection forever.
  requestTimeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 20_000),
  connectionTimeout: 15_000,
});

pool?.on('error', (err) => console.error('[mssql] pool error', err));

let connectPromise = null;

/**
 * Set while the database is being replaced underneath us (see lib/backup.js).
 *
 * A RESTORE needs `SINGLE_USER WITH ROLLBACK IMMEDIATE`, which evicts every
 * session on the database — including this pool's. Closing the pool is not
 * enough on its own: the next request to arrive would reconnect, take the one
 * connection single-user mode allows, and the RESTORE would fail with
 * "database is in use" having already killed everything.
 *
 * So the gate does both halves. While it is set, no connection is handed out
 * at all and every request that touches data fails with a 503 that says why,
 * which is a far better answer than a connection error nobody can interpret.
 */
let maintenanceReason = null;

/** Connect the pool once, lazily, and retry on a later call if it failed. */
async function activePool() {
  if (configError) throw configError;
  if (maintenanceReason) {
    throw new AppError(503, maintenanceReason, 'DB_MAINTENANCE');
  }
  if (!connectPromise) {
    connectPromise = pool.connect().catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  await connectPromise;
  return pool;
}

/**
 * Close the pool and refuse new connections until `endMaintenance` runs.
 *
 * Deliberately not exported as a general-purpose "close" — `close()` below is
 * that, and leaves the pool able to reconnect. This one latches.
 */
export async function beginMaintenance(reason) {
  maintenanceReason = reason;
  connectPromise = null;
  await pool?.close().catch(() => {});
}

/** Re-open for business. The next query reconnects to whatever is there now. */
export function endMaintenance() {
  maintenanceReason = null;
  connectPromise = null;
}

export const inMaintenance = () => maintenanceReason;

/**
 * Turn a pool-acquire timeout into something that names itself.
 *
 * When `acquireTimeoutMillis` fires, tedious reports "operation timed out for
 * an unknown reason", which is true and useless — it is precisely the message
 * that made the original pool exhaustion so hard to diagnose. This says what
 * happened and prints the pool counters, so the next occurrence is one log
 * line rather than an investigation.
 */
function mapPoolError(err) {
  if (!/timed out/i.test(err?.message ?? '') || err instanceof AppError) return err;
  const tarn = pool?.pool;
  console.error('[db] could not acquire a connection: '
    + `used=${tarn?.numUsed?.()} free=${tarn?.numFree?.()} `
    + `pendingAcquire=${tarn?.numPendingAcquires?.()} max=${pool?.config?.pool?.max}`);
  return new AppError(503,
    'الخادم مشغول حالياً — تعذّر الحصول على اتصال بقاعدة البيانات. حاول بعد قليل.',
    'DB_POOL_BUSY');
}

// ---------------------------------------------------------------- ambient context
/**
 * @typedef {object} Ctx
 * @property {string|null} orgId  organisation every query is scoped to
 * @property {import('mssql').Transaction|null} transaction  ambient transaction, if any
 * @property {boolean} inTx  whether that transaction is open
 */
const store = new AsyncLocalStorage();

/** The organisation every query in the current request is scoped to. */
export function orgId() {
  const current = store.getStore()?.orgId;
  if (!current) {
    // A programming error, never a user error: some code path reached the
    // database without going through the auth middleware.
    throw new Error('ORG_CONTEXT_MISSING: no organisation bound to this call');
  }
  return current;
}

export const maybeOrgId = () => store.getStore()?.orgId ?? null;

// ------------------------------------------------------------------ statements
const NAMED = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;

/** Pull out the distinct `@name` parameters a query uses, in first-seen order. */
export function compile(sqlText, params) {
  if (params === undefined || params === null) return { text: sqlText, inputs: [] };

  if (Array.isArray(params)) {
    throw new Error('positional (?) parameters are not supported against SQL Server — use named @params');
  }

  const inputs = [];
  const seen = new Set();
  for (const match of sqlText.matchAll(NAMED)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (!(name in params)) throw new Error(`missing bind parameter @${name}`);
    inputs.push([name, params[name]]);
  }
  return { text: sqlText, inputs };
}

/** Run a statement on the ambient transaction if there is one, else the pool. */
export async function query(sqlText, params) {
  const p = await activePool();
  const { text, inputs } = compile(sqlText, params);
  const current = store.getStore();
  const request = current?.transaction ? new sql.Request(current.transaction) : p.request();
  for (const [name, value] of inputs) request.input(name, value);
  try {
    return await request.query(text);
  } catch (err) {
    throw mapPoolError(err);
  }
}

/** All rows. */
export const all = async (sqlText, params) => (await query(sqlText, params)).recordset ?? [];

/** The first row, or undefined — the shape better-sqlite3's `.get()` returned. */
export const get = async (sqlText, params) => (await query(sqlText, params)).recordset?.[0];

/** `{ changes }`, so callers that checked `res.changes` keep working. */
export async function run(sqlText, params) {
  const res = await query(sqlText, params);
  const changes = Array.isArray(res.rowsAffected) ? res.rowsAffected.reduce((a, b) => a + b, 0) : 0;
  return { changes };
}

// ---------------------------------------------------------------- transactions
let savepointSeq = 0;

/**
 * How long `settle` will wait for an in-flight query before giving up on
 * closing its transaction cleanly. Comfortably longer than `requestTimeout`
 * (20s by default), so a query that is going to be killed anyway is waited out
 * rather than abandoned along with its connection.
 */
const SETTLE_TIMEOUT_MS = Number(process.env.DB_SETTLE_TIMEOUT_MS ?? 30_000);
const SETTLE_POLL_MS = 25;

/**
 * Roll back to `name`, and if that itself fails, mark `err` as having doomed
 * the whole ambient transaction rather than just this unit of work — see the
 * file header for why SQL Server needs this where Postgres did not.
 */
async function rollbackToSavepoint(transaction, name, err) {
  try {
    await new sql.Request(transaction).query(`ROLLBACK TRANSACTION ${name}`);
  } catch {
    err.transactionDoomed = true;
  }
}

/**
 * Run `fn` inside a transaction.
 *
 * Nested calls become savepoints, which matters in two places: posting an
 * invoice is itself transactional and is called from inside the stocktaking
 * apply and the importer. It also matters for error handling — a failed
 * statement can poison the whole transaction, so any code that catches an
 * error and carries on (the importer does, per row) must have its own
 * savepoint to roll back to, and must check `err.transactionDoomed` before
 * assuming that recovery actually worked.
 */
export async function tx(fn) {
  const current = store.getStore();

  // Already inside a transaction → savepoint, so a failure here rolls back
  // only this unit of work (when the engine allows it) and the caller decides
  // what to do next.
  if (current?.inTx && current.transaction) {
    const name = `sp_${(savepointSeq += 1)}`;
    await new sql.Request(current.transaction).query(`SAVE TRANSACTION ${name}`);
    try {
      return await fn();
    } catch (err) {
      await rollbackToSavepoint(current.transaction, name, err);
      throw err;
    }
  }

  const p = await activePool();
  const transaction = new sql.Transaction(p);
  try {
    await transaction.begin();
  } catch (err) {
    throw mapPoolError(err);
  }
  try {
    const result = await store.run({ orgId: current?.orgId ?? null, transaction, inTx: true }, fn);
    await settle(transaction, 'commit');
    return result;
  } catch (err) {
    try {
      await settle(transaction, 'rollback');
    } catch {
      // Already gone (e.g. the connection dropped) — nothing more to undo.
    }
    throw err;
  }
}

/**
 * Commit or roll back, waiting out a query that is still running on the same
 * connection.
 *
 * This exists because of how a request ends when the client disappears. The
 * API holds one transaction per request and releases it when the response
 * closes (`orgContext`) — but the route handler is not cancelled by a client
 * hanging up, so its query is often still in flight at that moment. Committing
 * then fails with `EREQINPROG`, "Can't commit transaction. There is a request
 * in progress"; the rollback in the catch fails for the identical reason; and
 * the connection is never returned to the pool.
 *
 * That is a permanent leak of one pooled connection per aborted-mid-query
 * request, and with `DB_POOL_MAX` at 8 the API stops answering entirely after
 * the eighth — silently, because `/health` touches no database. Observed in
 * production after ~14 hours of ordinary use: exactly 8 connections held,
 * every authenticated route hanging forever.
 *
 * The in-flight query does finish on its own, moments later, so the fix is
 * simply not to give up on the first attempt. Bounded, because waiting forever
 * would reproduce the very failure it prevents.
 */
async function settle(transaction, action) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    try {
      await transaction[action]();
      return;
    } catch (err) {
      // Anything other than "still busy" is a real failure and belongs to the
      // caller — a doomed transaction, a dropped connection, a rollback of
      // something already rolled back.
      if (err?.code !== 'EREQINPROG' || Date.now() >= deadline) throw err;
      await new Promise((resolve) => { setTimeout(resolve, SETTLE_POLL_MS); });
    }
  }
}

/**
 * Bind an organisation to everything `fn` does, and run it in one transaction.
 *
 * The API calls this once per request. A request that answers with an error
 * should not leave rows behind, so the whole thing commits or rolls back
 * together — same contract the Postgres build had, minus the RLS
 * transaction-local `SET`, which no longer has anything to set.
 */
export async function runInOrg(org, fn) {
  if (!org) throw new Error('runInOrg requires an organisation id');
  return store.run({ orgId: org, transaction: null, inTx: false }, () => tx(fn));
}

/** Escape hatch for work that has no organisation yet (auth, provisioning). */
export const runWithoutOrg = (fn) => store.run({ orgId: null, transaction: null, inTx: false }, fn);

/**
 * Bind an organisation to `fn` without opening a transaction — every write
 * `fn` makes commits on its own as soon as its statement finishes.
 *
 * Not used by the API (every request goes through `runInOrg`, which is one
 * transaction per request, same as the Postgres build). This exists for the
 * test suite: the Postgres-era suite batched many assertions — including
 * expected-failure ones — into one transaction per `test()`, using a
 * savepoint per assertion. On this engine a savepoint cannot recover from a
 * unique-violation or trigger-THROW failure (see the `tx()` comment above),
 * which is exactly the failure class most of those assertions check for. So
 * the suite instead simulates one request per service call — which is what
 * each of those calls actually corresponds to in production anyway.
 */
export const bindOrg = (org, fn) => store.run({ orgId: org, transaction: null, inTx: false }, fn);

// ---------------------------------------------------------------------- utils
/**
 * Drop the columns that exist for tenancy and row ordering.
 *
 * `SELECT v.*` is used in several places, and `org_id` / `seq` were added to
 * every table by the hosted rewrite — neither belongs in a response, and the
 * API contract from the desktop build does not have them.
 */
export function publicRow(row) {
  if (!row) return row;
  const { org_id: _org, seq: _seq, ...rest } = row;
  return rest;
}

/** Round to 2 decimals, the precision the money columns promise. */
export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const nowIso = () => new Date().toISOString();

export const newId = () => crypto.randomUUID();

/**
 * Mint the next sequential document number, e.g. `PUR-00001`.
 *
 * Checks under `UPDLOCK, HOLDLOCK` before deciding insert vs. update, rather
 * than attempting the insert and catching a PK violation on the race — the
 * latter is exactly the pattern that dooms a transaction on this engine (see
 * the file header), and `nextNumber` is usually called from inside a larger
 * transaction (posting an invoice) that must survive it.
 */
export async function nextNumber(key, prefix) {
  const { value } = await tx(() => get(
    `IF NOT EXISTS (SELECT 1 FROM counters WITH (UPDLOCK, HOLDLOCK) WHERE org_id = @org AND [key] = @key)
       INSERT INTO counters (org_id, [key], value) VALUES (@org, @key, 1);
     ELSE
       UPDATE counters SET value = value + 1 WHERE org_id = @org AND [key] = @key;
     SELECT value FROM counters WHERE org_id = @org AND [key] = @key;`,
    { org: orgId(), key },
  ));
  return `${prefix}-${String(value).padStart(5, '0')}`;
}

// -------------------------------------------------------------------- settings
/** Default settings — inserted once per organisation, never overwritten. */
export const DEFAULT_SETTINGS = {
  low_stock_threshold: '5',
  import_max_rows: '5000',
  import_max_file_mb: '10',
  company_name: 'شركتي',
  currency: 'ILS',
  digits: 'latn', // 'latn' (0-9) | 'arab' (٠-٩)
};

/** Seed the settings rows a brand-new organisation needs. */
export async function ensureOrgDefaults() {
  const org = orgId();
  await tx(async () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await run(
        `IF NOT EXISTS (SELECT 1 FROM settings WITH (UPDLOCK, HOLDLOCK) WHERE org_id = @org AND [key] = @key)
           INSERT INTO settings (org_id, [key], value) VALUES (@org, @key, @value);`,
        { org, key, value },
      );
    }
  });
}

export async function getSetting(key) {
  const row = await get('SELECT value FROM settings WHERE org_id = @org AND [key] = @key',
    { org: orgId(), key });
  return row?.value ?? DEFAULT_SETTINGS[key];
}

export async function getSettings() {
  const rows = await all('SELECT [key], value FROM settings WHERE org_id = @org', { org: orgId() });
  // Fall back to the defaults for any key an older organisation never got.
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export async function setSettings(patch) {
  const org = orgId();
  await tx(async () => {
    for (const [key, value] of Object.entries(patch)) {
      await run(
        `IF NOT EXISTS (SELECT 1 FROM settings WITH (UPDLOCK, HOLDLOCK) WHERE org_id = @org AND [key] = @key)
           INSERT INTO settings (org_id, [key], value) VALUES (@org, @key, @value);
         ELSE
           UPDATE settings SET value = @value WHERE org_id = @org AND [key] = @key;`,
        { org, key, value: String(value) },
      );
    }
  });
  return getSettings();
}

export const lowStockThreshold = async () => Number(await getSetting('low_stock_threshold') ?? 5);

/** Close the pool — used by the test suite and the graceful shutdown path. */
export const close = () => (pool ? pool.close() : Promise.resolve());
