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
import { AUTH_MODE } from './lib/auth.js';
import { STORAGE_DRIVER } from './lib/storage.js';

const port = Number(process.env.PORT ?? 4317);
// 0.0.0.0 by default: a container's port mapping cannot reach a loopback bind.
const host = process.env.HOST ?? '0.0.0.0';

// Schema changes are applied at boot: the host has no release phase, and the
// advisory lock inside migrate() makes a concurrent run safe.
if (process.env.SKIP_MIGRATIONS !== '1') {
  await migrate();
}

// Warns (loudly) if the organisation context is not reaching the RLS policies,
// which would silently disable the database-level half of tenant isolation. Not
// fatal: application-level org scoping still holds, and refusing to boot over a
// second line of defence would be worse.
await checkOrgContextReachesPolicies();

const app = createApp();

const server = app.listen(port, host, () => {
  console.log('\n  نظام إدارة المخزون — Inventory Management API');
  console.log(`  ➜  listening on http://${host}:${port}`);
  console.log(`  ➜  auth: ${AUTH_MODE}   storage: ${STORAGE_DRIVER}`);
  console.log(`  ➜  cors: ${process.env.CORS_ORIGIN ?? '(localhost dev default)'}\n`);
  if (AUTH_MODE === 'none') {
    console.warn('  ⚠  AUTH_MODE=none — every request runs as the local dev user\n');
  }
});

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
