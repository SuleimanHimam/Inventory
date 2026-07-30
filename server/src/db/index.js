/**
 * PostgreSQL data access layer.
 *
 * Replaces the synchronous better-sqlite3 layer of v5.0. Three things are worth
 * knowing before reading the services:
 *
 *  1. `@name` bind parameters are kept. The SQL in the services is unchanged
 *     from the SQLite build wherever the dialect allowed it, so `compile()`
 *     rewrites `@name` / `?` into `$1…$n` on the way out.
 *
 *  2. Tenant isolation has two layers. Every service query carries an explicit
 *     `org_id = @org` predicate, and every request additionally runs inside a
 *     transaction that sets `app.org_id`, which the Row Level Security policies
 *     in migrations/002_rls.sql key on. The org id comes from the verified JWT,
 *     never from the request body.
 *
 *  3. The org id and the current transaction travel in AsyncLocalStorage rather
 *     than through every function signature, so the service layer keeps the
 *     exact same public API it had as a desktop app.
 */
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

// COUNT(*), SUM(int) and friends come back as int8, which node-postgres hands
// over as a string to protect 64-bit precision. Every count in this schema is
// far below 2^53, and the services (and the API contract) expect numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

export const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Missing configuration is recorded, not thrown at import time.
 *
 * Throwing here used to kill the process before `app.listen` ever ran, and a
 * host that only knows "the port never opened" reports that as a failed health
 * check — the same message it gives for a missing dependency, a wrong password
 * or an unreachable database. The one thing the operator needs, which of those
 * it is, was the thing that got lost. Now the API starts, `/api/v1/health`
 * names the problem, and the error still surfaces on the first query.
 */
export const configError = DATABASE_URL ? null : new Error(
  'DATABASE_URL is not set. Point it at your Postgres instance '
  + '(Supabase: Project settings → Database → Connection string → URI).',
);

/**
 * Supabase (and every other hosted Postgres) requires TLS; a local Docker
 * database does not have a certificate at all. `sslmode=` in the URL wins when
 * present, otherwise TLS is used for everything except loopback.
 */
function sslOption(url) {
  if (/[?&]sslmode=disable/.test(url)) return false;
  if (/[?&]sslmode=(require|prefer|verify-full|verify-ca)/.test(url)) {
    return { rejectUnauthorized: /verify/.test(url) };
  }
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
    ? false
    // Supabase terminates TLS with a certificate chain Node does not ship a
    // root for. The connection is still encrypted.
    : { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: sslOption(DATABASE_URL),
  // The API runs as a single instance and Supabase's free pooler allows few
  // connections; a small pool leaves headroom for migrations and psql.
  max: Number(process.env.PG_POOL_MAX ?? 8),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  // A runaway query must not pin a free-tier connection forever.
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 20_000),
});

pool.on('error', (err) => console.error('[pg] idle client error', err));

/**
 * Borrow a connection, refusing early and by name when there is no connection
 * string. Without this, `pg` falls back to its own defaults (localhost, the
 * OS user) and a missing DATABASE_URL arrives as a puzzling ECONNREFUSED.
 */
export async function connect() {
  if (configError) throw configError;
  return pool.connect();
}

// ---------------------------------------------------------------- ambient context
/**
 * @typedef {object} Ctx
 * @property {string|null} orgId  organisation every query is scoped to
 * @property {import('pg').PoolClient|null} client dedicated connection, if any
 * @property {boolean} inTx  whether that connection is inside a transaction
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

/** Rewrite `@name` (object params) or `?` (array params) into `$1…$n`. */
export function compile(sql, params) {
  if (params === undefined || params === null) return { text: sql, values: [] };

  if (Array.isArray(params)) {
    let i = 0;
    return { text: sql.replace(/\?/g, () => `$${(i += 1)}`), values: params };
  }

  const values = [];
  const seen = new Map();
  const text = sql.replace(NAMED, (_match, name) => {
    if (!seen.has(name)) {
      if (!(name in params)) throw new Error(`missing bind parameter @${name}`);
      values.push(params[name]);
      seen.set(name, values.length);
    }
    return `$${seen.get(name)}`;
  });
  return { text, values };
}

/** Run a statement on the ambient transaction if there is one, else the pool. */
export async function query(sql, params) {
  if (configError) throw configError;
  const { text, values } = compile(sql, params);
  const client = store.getStore()?.client;
  return (client ?? pool).query(text, values);
}

/** All rows. */
export const all = async (sql, params) => (await query(sql, params)).rows;

/** The first row, or undefined — the shape better-sqlite3's `.get()` returned. */
export const get = async (sql, params) => (await query(sql, params)).rows[0];

/** `{ changes }`, so callers that checked `res.changes` keep working. */
export const run = async (sql, params) => ({ changes: (await query(sql, params)).rowCount });

// ---------------------------------------------------------------- transactions
let savepointSeq = 0;

/**
 * Run `fn` inside a transaction.
 *
 * Nested calls become savepoints, which matters in two places: posting an
 * invoice is itself transactional and is called from inside the stocktaking
 * apply and the importer. It also matters for error handling — in Postgres a
 * failed statement poisons the whole transaction, so any code that catches a
 * constraint violation and carries on (the importer does, per row) must have
 * its own savepoint to roll back to.
 */
export async function tx(fn) {
  const current = store.getStore();

  // Already inside a transaction → savepoint, so a failure here rolls back only
  // this unit of work and the caller decides what to do next.
  if (current?.inTx && current.client) {
    const name = `sp_${(savepointSeq += 1)}`;
    await current.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await current.client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (err) {
      await current.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw err;
    }
  }

  // Reuse the request's dedicated connection when there is one, so the
  // transaction sees the writes made before it on the same connection.
  const borrowed = current?.client ?? null;
  const client = borrowed ?? await connect();
  try {
    await client.query('BEGIN');
    if (!borrowed && current?.orgId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.org_id', current.orgId]);
    }
    let result;
    try {
      result = await store.run({ orgId: current?.orgId ?? null, client, inTx: true }, fn);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    await client.query('COMMIT');
    return result;
  } finally {
    if (!borrowed) client.release();
  }
}

/**
 * Bind an organisation to everything `fn` does.
 *
 * Runs the whole unit of work in one transaction with `app.org_id` set
 * *transaction-locally*, which is what makes the RLS policies effective — a
 * connection with no setting can read nothing.
 *
 * Transaction-scoped rather than session-scoped on purpose. A session-level
 * `SET` only survives if the connection maps to one backend for its lifetime,
 * and that is exactly what a transaction pooler does not promise: Supabase's
 * Supavisor on port 6543, and PgBouncer in transaction mode, hand consecutive
 * statements to different backends. `SET LOCAL` inside a transaction is safe
 * under both pooling modes, because a pooler pins one backend for the duration
 * of a transaction. Free-tier Supabase reaches the pooler over IPv4 while the
 * direct connection is IPv6-only, so the pooler is not really optional.
 *
 * The cost is that a request is one transaction: an error part-way through rolls
 * back everything it wrote, rather than leaving earlier statements committed the
 * way autocommit did against SQLite. For this API that is the better default —
 * a request that answers with an error should not leave rows behind.
 *
 * The API calls this once per request.
 */
export async function runInOrg(org, fn) {
  if (!org) throw new Error('runInOrg requires an organisation id');
  const client = await connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.org_id', org]);
    let result;
    try {
      result = await store.run({ orgId: org, client, inTx: true }, fn);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    await client.query('COMMIT');
    return result;
  } finally {
    client.release();
  }
}

/** Escape hatch for work that has no organisation yet (auth, provisioning). */
export const runWithoutOrg = (fn) => store.run({ orgId: null, client: null, inTx: false }, fn);

/**
 * Verify at boot that the organisation context actually reaches the RLS
 * policies: bind a probe org, then ask the policy function what it sees.
 *
 * This is the one thing that, if silently broken by a connection-string change,
 * turns the second line of tenant isolation off without any visible symptom.
 */
export async function checkOrgContextReachesPolicies() {
  const probe = '00000000-0000-4000-8000-0000000000ff';
  const seen = await runInOrg(probe, () =>
    get('SELECT app_current_org()::text AS value'));
  const ok = seen?.value === probe;
  if (!ok) {
    console.error(
      '\n  ⚠  app.org_id is not reaching the RLS policies.\n'
      + `     Bound ${probe} but app_current_org() reported ${seen?.value ?? 'NULL'}.\n`
      + '     Row Level Security will match no rows. Check DATABASE_URL, and that\n'
      + '     migrations/002_rls.sql has been applied.\n',
    );
  }
  return ok;
}

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

/** Mint the next sequential document number, e.g. `PUR-00001`. */
export async function nextNumber(key, prefix) {
  const { value } = await get(
    `INSERT INTO counters (org_id, key, value) VALUES (@org, @key, 1)
     ON CONFLICT (org_id, key) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    { org: orgId(), key },
  );
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
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await run(
      `INSERT INTO settings (org_id, key, value) VALUES (@org, @key, @value)
       ON CONFLICT (org_id, key) DO NOTHING`,
      { org: orgId(), key, value },
    );
  }
}

export async function getSetting(key) {
  const row = await get('SELECT value FROM settings WHERE org_id = @org AND key = @key',
    { org: orgId(), key });
  return row?.value ?? DEFAULT_SETTINGS[key];
}

export async function getSettings() {
  const rows = await all('SELECT key, value FROM settings WHERE org_id = @org', { org: orgId() });
  // Fall back to the defaults for any key an older organisation never got.
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export async function setSettings(patch) {
  await tx(async () => {
    for (const [key, value] of Object.entries(patch)) {
      await run(
        `INSERT INTO settings (org_id, key, value) VALUES (@org, @key, @value)
         ON CONFLICT (org_id, key) DO UPDATE SET value = excluded.value`,
        { org: orgId(), key, value: String(value) },
      );
    }
  });
  return getSettings();
}

export const lowStockThreshold = async () => Number(await getSetting('low_stock_threshold') ?? 5);

/** Close the pool — used by the test suite and the graceful shutdown path. */
export const close = () => pool.end();
