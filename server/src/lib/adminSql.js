/**
 * The `master` connection — everything this app does *to* a database rather
 * than *in* one.
 *
 * Backing up, restoring, creating a file and dropping one all share the same
 * constraint: they cannot run on a connection to the database they are acting
 * on. A RESTORE needs every other session evicted; a DROP needs the same; a
 * CREATE has no database to connect to yet. So they all go through one pool
 * bound to `master`, which is what this module owns.
 *
 * It was private to lib/backup.js until files became databases. Two modules
 * opening their own `master` pool would mean two idle connections and, worse,
 * two copies of the error translation below — and that translation is the only
 * thing standing between the operator and "RESTORE HEADERONLY is terminating
 * abnormally" as an explanation for a permissions problem.
 */
import sql from 'mssql';
import {
  DB_SERVER, DB_USER, DB_PASSWORD, DB_OPTIONS, configError,
} from '../db/index.js';

let admin = null;
let adminPromise = null;

/**
 * A second pool, bound to `master`.
 *
 * `requestTimeout: 0` because a BACKUP or RESTORE is measured in minutes on a
 * large database and the application pool's 20-second ceiling would abort it
 * halfway. `max: 2` because only one maintenance operation runs at a time and
 * an idle pool here should cost nothing.
 */
export async function adminPool() {
  if (configError) throw configError;
  if (!adminPromise) {
    admin = new sql.ConnectionPool({
      server: DB_SERVER,
      database: 'master',
      user: DB_USER,
      password: DB_PASSWORD,
      options: DB_OPTIONS,
      pool: { max: 2, idleTimeoutMillis: 30_000 },
      requestTimeout: 0,
      connectionTimeout: 15_000,
    });
    admin.on('error', (err) => console.error('[admin] master pool error', err));
    adminPromise = admin.connect().catch((err) => {
      adminPromise = null;
      throw err;
    });
  }
  await adminPromise;
  return admin;
}

/** Run one statement on the master connection. `params` are bound, never interpolated. */
export async function adminQuery(text, params = {}) {
  const pool = await adminPool();
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) request.input(name, value);
  return request.query(text);
}

/**
 * The message a failed maintenance statement actually deserves.
 *
 * SQL Server reports these as a chain and the driver surfaces only the last
 * link, which is invariably the useless one: a `RESTORE HEADERONLY` refused
 * for lack of permission arrives as "RESTORE HEADERONLY is terminating
 * abnormally", with the real reason — "CREATE DATABASE permission denied in
 * database 'master'" — sitting in `precedingErrors` where nobody looks. Every
 * error surfaced from these modules goes through here.
 */
export function sqlDetail(err) {
  const chain = err?.precedingErrors ?? [];
  const causes = chain.map((e) => String(e.message).split('\n')[0]).filter(Boolean);
  const last = String(err?.message ?? '').split('\n')[0];
  return causes.length ? `${causes.join(' — ')} (${last})` : last;
}

/** True when SQL Server refused for lack of permission rather than a bad file. */
export function isPermissionError(err) {
  const numbers = [err?.number, ...(err?.precedingErrors ?? []).map((e) => e.number)];
  // 262 CREATE DATABASE permission denied, 229/230 generic permission denied.
  return numbers.some((n) => n === 262 || n === 229 || n === 230)
    || /permission (was )?denied/i.test(sqlDetail(err));
}

export const closeAdminPool = () => (admin ? admin.close().catch(() => {}) : Promise.resolve());
