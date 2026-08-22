/**
 * Connection doctor — checks the SQL Server connection env vars before you
 * trust them in production.
 *
 * Usage:
 *   npm run doctor
 *   npm run doctor:prod   (loads .env.prod instead)
 */
import { pool, configError, runInOrg, get } from './index.js';

const PROBE_ORG = '00000000-0000-4000-8000-0000000000ff';
const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

let failures = 0;
const fail = (message) => { failures += 1; console.log(`\n  ✖ ${message}`); };

if (configError) {
  console.log(`\n  ✖ ${configError.message}\n`);
  process.exit(1);
}

try {
  const server = await get(
    'SELECT @@VERSION AS v, SUSER_SNAME() AS u, DB_NAME() AS d, IS_MEMBER(\'db_ddladmin\') AS ddladmin');
  line('server', server.v.split('\n')[0]);
  line('database', server.d);
  line('connected as', server.u);
  line('can run migrations (db_ddladmin)', server.ddladmin ? 'yes' : 'no — npm run migrate will fail on a pending one');

  const migrations = await get(
    'SELECT COUNT(*) AS n, MAX(id) AS latest FROM schema_migrations').catch(() => null);
  line('migrations applied', migrations ? `${migrations.n} (latest: ${migrations.latest})` : 'none — run npm run migrate');

  // Tenant isolation is application-level only on this engine (no Row-Level-
  // Security equivalent was ported — see db/index.js's file header for why).
  // The one thing worth probing here is that org binding itself works, since
  // every service query depends on it.
  const seen = await runInOrg(PROBE_ORG, () => get('SELECT @org AS value', { org: PROBE_ORG }));
  const reaches = seen?.value === PROBE_ORG;
  line('org binding', reaches ? 'ok' : `BROKEN (saw ${seen?.value ?? 'NULL'})`);

  if (!migrations?.n) fail('Schema is not migrated. Run: npm run migrate');
  if (!server.ddladmin) fail('This login cannot run migrations — see provision-mssql.sql (db_ddladmin).');
  if (!reaches) fail('Something is wrong with parameter binding — this should never happen.');

  console.log(failures ? `\n  ${failures} problem(s) found.\n` : '\n  All checks passed.\n');
} catch (err) {
  console.log(`\n  ✖ could not connect: ${err.code ?? ''} ${err.number ?? ''} ${err.message}\n`);
  if (err.code === 'ELOGIN' || err.number === 18456) {
    console.log('  Login failed. Check DB_USER/DB_PASSWORD, and that the login exists —\n'
      + '  see provision-mssql.sql.\n');
  }
  if (err.code === 'ESOCKET' || err.code === 'ETIMEOUT') {
    console.log('  Could not reach the server. Check DB_SERVER (the "host\\INSTANCE" form needs\n'
      + '  the SQL Server Browser service running to resolve a named instance\'s port),\n'
      + '  and that the SQL Server service itself is running.\n');
  }
  failures = 1;
}

await pool.close();
process.exit(failures ? 1 : 0);
