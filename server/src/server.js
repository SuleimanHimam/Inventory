/**
 * API entry point — a plain Express process.
 *
 * Nothing here assumes a parent process: the desktop build used to be handed a
 * free loopback port by the Electron shell and announced it on stdout, which is
 * gone. The host (Railway) sets PORT, the app binds 0.0.0.0, and that is all.
 */
import { createApp } from './app.js';
import { pool, checkOrgContextReachesPolicies } from './db/index.js';
import { migrate } from './db/migrate.js';
import { AUTH_MODE, authConfigError } from './lib/auth.js';
import { STORAGE_DRIVER, storageConfigError } from './lib/storage.js';
import { markReady, markFailed } from './lib/readiness.js';

const port = Number(process.env.PORT ?? 4317);
// 0.0.0.0 by default: a container's port mapping cannot reach a loopback bind.
const host = process.env.HOST ?? '0.0.0.0';

const app = createApp();

const server = app.listen(port, host, () => {
  console.log('\n  نظام إدارة المخزون — Inventory Management API');
  console.log(`  ➜  listening on http://${host}:${port}`);
  console.log(`  ➜  auth: ${AUTH_MODE}   storage: ${STORAGE_DRIVER}`);
  console.log(`  ➜  cors: ${process.env.CORS_ORIGIN ?? '(localhost dev default)'}\n`);
  if (AUTH_MODE === 'none' && !authConfigError) {
    console.warn('  ⚠  AUTH_MODE=none — every request runs as the local dev user\n');
  }
  if (storageConfigError) {
    console.error(
      `\n  ✖  image storage is not configured:\n     ${storageConfigError}\n`
      + '     Everything except uploading and deleting product photos works.\n',
    );
  }
  if (authConfigError) {
    console.error(
      `\n  ✖  authentication is not configured:\n     ${authConfigError}\n`
      + '     Every request is refused with 503 until this is fixed.\n'
      + '     GET /api/v1/health reports the same thing.\n',
    );
  }
});

/**
 * The database half of the boot, deliberately *after* the port is open.
 *
 * Running it first meant any database problem killed the process before
 * `app.listen`, and every distinct cause — no DATABASE_URL, a wrong pooler
 * username, an unreachable host, a failed migration — collapsed into the single
 * message "health check failed", followed by a restart loop. So: serve first,
 * then report. `/api/v1/health` carries the state, the log carries the reason,
 * and a request that needs the database still fails loudly on its own.
 *
 * The trade is that a broken deploy now stays up instead of rolling back. For
 * this API that is the better half of the bargain: the failures above are all
 * configuration, and none of them are fixed by another restart.
 */
try {
  // The advisory lock inside migrate() makes a concurrent run safe, and the
  // host has no release phase to put this in.
  if (process.env.SKIP_MIGRATIONS !== '1') {
    await migrate();
  }
  // Warns (loudly) if the organisation context is not reaching the RLS
  // policies, which would silently disable the database-level half of tenant
  // isolation. Not an error: application-level org scoping still holds.
  await checkOrgContextReachesPolicies();
  markReady();
} catch (err) {
  markFailed(err);
  console.error(
    `\n  ✖  the API is listening, but the database is not usable:\n     ${err.message}\n`
    + '     Every request that touches data will fail until this is fixed.\n'
    + '     GET /api/v1/health reports the same thing. Check DATABASE_URL —\n'
    + '     `npm run doctor` explains the usual Supabase connection mistakes.\n',
  );
}

const shutdown = (signal) => async () => {
  console.log(`\n[server] received ${signal}, shutting down`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
