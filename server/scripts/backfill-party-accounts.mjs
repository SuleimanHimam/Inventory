/**
 * One-off: give every existing customer and supplier its own account in the
 * chart, the same way a newly created one now gets it (parties.service →
 * getPartyAccountId → ensurePartyParentId + ensureChildAccount).
 *
 * Walks every file, every org inside it, and links any party whose account_id
 * is still NULL. Idempotent — a party that already has an account is skipped,
 * so it is safe to re-run.
 *
 *   node scripts/backfill-party-accounts.mjs [--dry-run]
 */
import { all, get, runInOrg, bindFile, runWithoutOrg } from '../src/db/index.js';
import { listFiles } from '../src/lib/files.js';
import { getPartyAccountId } from '../src/services/parties.service.js';

const dryRun = process.argv.includes('--dry-run');

const files = await listFiles();
console.log(`${files.length} file(s)${dryRun ? '  (dry run — nothing will be written)' : ''}\n`);

let linked = 0;

for (const file of files) {
  const orgs = await bindFile(file.id, () => runWithoutOrg(
    () => all('SELECT id, name FROM orgs', {}),
  )).catch(() => []);

  for (const org of orgs) {
    await bindFile(file.id, () => runInOrg(org.id, async () => {
      for (const kind of ['customers', 'suppliers']) {
        const table = kind;
        const rows = await all(
          `SELECT id, name FROM ${table} WHERE org_id = @org AND account_id IS NULL`,
          { org: org.id },
        );
        for (const p of rows) {
          if (dryRun) {
            console.log(`  ${file.id} / ${org.name} / ${kind}: ${p.name}  → would link`);
            linked += 1;
            continue;
          }
          const acc = await getPartyAccountId(kind, p.id);
          if (acc) {
            const a = await get('SELECT account_number FROM accounts WHERE id = @id AND org_id = @org',
              { id: acc, org: org.id });
            console.log(`  ${file.id} / ${org.name} / ${kind}: ${p.name}  → ${a?.account_number ?? acc}`);
            linked += 1;
          } else {
            console.warn(`  ! ${file.id} / ${org.name} / ${kind}: ${p.name}  — no account created`);
          }
        }
      }
    }));
  }
}

console.log(`\n${linked} ${dryRun ? 'to link' : 'linked'}`);
process.exit(0);
