/**
 * One-off Postgres → SQL Server data migration (Phase 6 of the SQL Server
 * cutover — see the migration plan for the full context).
 *
 * Copies every table in FK-dependency order, disabling the two triggers that
 * would otherwise recompute cached values the source data already carries
 * correctly (items.quantity from stock_movements, items.image_file from
 * item_images) — see the plan's Phase 6 note. Row-by-row, table-by-table
 * copying is deliberate, not a placeholder for something fancier: this is a
 * small pilot dataset, not a bulk-ETL job, and the row-count comparison at
 * the end is the real correctness check either way.
 *
 * Usage:
 *   DATABASE_URL=postgres://…  DB_SERVER=…  DB_NAME=…  DB_USER=…  DB_PASSWORD=… \
 *     node scripts/migrate-pg-to-mssql.mjs [--dry-run]
 *
 * --dry-run reads and reports source row counts per table without touching
 * the target at all — safe to run against production Postgres any time.
 */
import pg from 'pg';
import { pool as mssqlPool, configError } from '../src/db/index.js';

const DRY_RUN = process.argv.includes('--dry-run');

// FK-dependency order — a table never appears before something it references.
const TABLES = [
  'orgs', 'memberships', 'users', 'categories', 'items', 'item_units',
  'sub_barcodes', 'customers', 'suppliers', 'stock_counts', 'invoices',
  'invoice_lines', 'stock_movements', 'stock_count_lines', 'import_batches',
  'item_images', 'counters', 'settings',
];

// bigint IDENTITY columns on the SQL Server side — never insert these
// explicitly; letting the target assign fresh values is fine, since they are
// sort-order bookkeeping only (not a PK, not referenced by any FK) and
// row-insertion order below already preserves what the app relies on.
const IDENTITY_COLUMNS = { invoice_lines: 'seq', stock_movements: 'seq' };

async function migrateTable(pgClient, table) {
  const exists = await pgClient.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [table]);
  if (!exists.rowCount) {
    console.log(`[migrate-data] ${table}: not present in source, skipping`);
    return 0;
  }

  const colRows = await pgClient.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table]);
  const identityCol = IDENTITY_COLUMNS[table];
  const columns = colRows.rows.map((r) => r.column_name).filter((c) => c !== identityCol);
  const names = new Set(columns);
  const orderCol = names.has('created_at') ? 'created_at' : names.has('id') ? 'id' : columns[0];

  const { rows } = await pgClient.query(
    `SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM ${table} ORDER BY ${orderCol}`);
  console.log(`[migrate-data] ${table}: ${rows.length} row(s) in source`);
  if (DRY_RUN || !rows.length) return rows.length;

  const colList = columns.map((c) => `[${c}]`).join(', ');
  const paramList = columns.map((c) => `@${c}`).join(', ');
  for (const row of rows) {
    const request = mssqlPool.request();
    for (const c of columns) request.input(c, row[c]);
    await request.query(`INSERT INTO ${table} (${colList}) VALUES (${paramList})`);
  }
  return rows.length;
}

async function main() {
  if (configError) throw configError;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point at the source Postgres database');

  const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  await mssqlPool.connect();

  const sourceCounts = {};
  try {
    if (!DRY_RUN) {
      await mssqlPool.batch('ALTER TABLE stock_movements DISABLE TRIGGER trg_movements_apply_qty');
      await mssqlPool.batch('ALTER TABLE item_images DISABLE TRIGGER trg_item_images_sync_primary');
    }

    for (const table of TABLES) {
      sourceCounts[table] = await migrateTable(pgClient, table);
    }
  } finally {
    if (!DRY_RUN) {
      await mssqlPool.batch('ALTER TABLE stock_movements ENABLE TRIGGER trg_movements_apply_qty');
      await mssqlPool.batch('ALTER TABLE item_images ENABLE TRIGGER trg_item_images_sync_primary');
    }
  }

  if (DRY_RUN) {
    console.log('\n[migrate-data] dry run — source row counts:');
    console.table(sourceCounts);
  } else {
    console.log('\n[migrate-data] verifying target row counts…');
    const mismatches = [];
    for (const [table, n] of Object.entries(sourceCounts)) {
      const r = await mssqlPool.request().query(`SELECT COUNT(*) AS n FROM ${table}`);
      const targetN = r.recordset[0].n;
      const ok = targetN === n;
      console.log(`  ${table}: source=${n} target=${targetN} ${ok ? 'OK' : 'MISMATCH'}`);
      if (!ok) mismatches.push(table);
    }
    if (mismatches.length) throw new Error(`row count mismatch in: ${mismatches.join(', ')}`);
    console.log('\n[migrate-data] all row counts match.');
  }

  await pgClient.end();
  await mssqlPool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
