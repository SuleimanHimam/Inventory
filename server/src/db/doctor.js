/**
 * Connection doctor — checks a DATABASE_URL before you trust it in production.
 *
 * There are several ways for a Supabase connection string to be *almost* right,
 * and most of them fail in ways that are hard to read: the direct host resolves
 * to IPv6 only, the pooler needs the project ref in the username, and connecting
 * as a superuser silently turns Row Level Security off. This reports on each.
 *
 * Usage:
 *   npm run doctor
 *   $env:DATABASE_URL='…'; npm run doctor      # check a specific string
 */
import { pool, runInOrg, get } from './index.js';

const PROBE_ORG = '00000000-0000-4000-8000-0000000000ff';
const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

let failures = 0;
const fail = (message) => { failures += 1; console.log(`\n  ✖ ${message}`); };

try {
  const server = await get('SELECT version() AS v, current_user AS u, current_database() AS d');
  line('server', server.v.split(' on ')[0]);
  line('database', server.d);
  line('connected as', server.u);

  // Supabase's `postgres` role is a superuser, and a superuser bypasses every
  // policy. The app still scopes each query by org_id, but the database-level
  // second line of defence is inert.
  const priv = await get(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  const bypasses = priv?.rolsuper || priv?.rolbypassrls;
  line('bypasses RLS', bypasses ? 'YES — policies are inert for this role' : 'no');

  const migrations = await get(
    `SELECT count(*)::int AS n, max(id) AS latest FROM schema_migrations`).catch(() => null);
  line('migrations applied', migrations ? `${migrations.n} (latest: ${migrations.latest})` : 'none — run npm run migrate');

  const policies = await get(
    `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`);
  line('RLS policies', policies.n);

  // The check that matters: does the org context actually reach the policies?
  // A session-level GUC would be lost behind a transaction pooler; the app binds
  // it inside a transaction precisely so this holds either way.
  const seen = await runInOrg(PROBE_ORG, () => get('SELECT app_current_org()::text AS value'));
  const reaches = seen?.value === PROBE_ORG;
  line('org context → policies', reaches ? 'ok' : `BROKEN (saw ${seen?.value ?? 'NULL'})`);

  if (!migrations?.n) fail('Schema is not migrated. Run: npm run migrate');
  if (!policies.n) fail('No RLS policies found — 002_rls.sql has not been applied.');
  if (!reaches) fail('app.org_id is not reaching the policies; check DATABASE_URL.');
  if (bypasses) {
    console.log(
      '\n  ⚠  This role bypasses RLS. Fine for migrations, wrong for the API.\n'
      + '     Create the least-privilege role and use it in the API\'s DATABASE_URL:\n'
      + "       ALTER ROLE app_api WITH LOGIN PASSWORD '…';",
    );
  }

  console.log(failures ? `\n  ${failures} problem(s) found.\n` : '\n  All checks passed.\n');
} catch (err) {
  // The connection itself failed. These are the three mistakes worth naming.
  console.log(`\n  ✖ could not connect: ${err.code ?? ''} ${err.message}\n`);
  if (err.code === 'ENOTFOUND' && /^db\./.test(err.hostname ?? '')) {
    console.log(
      "  That is Supabase's DIRECT host, which resolves to IPv6 only on the free\n"
      + '  plan (an IPv4 address is a paid add-on). Use the pooler instead:\n'
      + '    postgresql://postgres.<PROJECT-REF>:<PW>@aws-0-<region>.pooler.supabase.com:6543/postgres\n',
    );
  }
  if (err.code === '28P01') {
    console.log('  Wrong password. Reset it under Settings → Database → Database password.\n');
  }
  if (/tenant or user not found/i.test(err.message)) {
    console.log(
      '  The pooler could not identify the project. Two usual causes:\n'
      + '    • the username must carry the project ref: postgres.<PROJECT-REF>\n'
      + '    • the region in the host must match the project (aws-0 vs aws-1, etc.)\n',
    );
  }
  failures = 1;
}

await pool.end();
process.exit(failures ? 1 : 0);
