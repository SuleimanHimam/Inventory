/**
 * End-to-end business-rule tests against a throwaway Postgres organisation.
 *
 * Run with:  npm test
 *   TEST_DATABASE_URL=postgres://…   (falls back to DATABASE_URL)
 *
 * A local server is enough — `docker compose up -d db` in the repo root starts
 * one. Every test runs inside its own organisation context, which means the
 * suite also exercises the Row Level Security path the hosted deployment relies
 * on, not just the application-level `org_id` predicates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL (or DATABASE_URL) must point at a Postgres database');
}
// The suite talks to the services directly, so it needs no JWT verification.
process.env.AUTH_MODE = 'none';

// Imported dynamically so the environment above is set before the modules load.
const { pool, get, run, runInOrg } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { resolveOrg } = await import('../src/lib/orgs.js');
const categories = await import('../src/services/categories.service.js');
const items = await import('../src/services/items.service.js');
const invoices = await import('../src/services/invoices.service.js');
const counts = await import('../src/services/stockCounts.service.js');
const parties = await import('../src/services/parties.service.js');

await migrate({ log: () => {} });

/** A fresh organisation per run, so repeated runs never see each other's data. */
const owner = crypto.randomUUID();
const { orgId: ORG } = await resolveOrg({ userId: owner, email: `test-${owner}@example.test` });

/** Run a test body inside the organisation's database context. */
const inOrg = (fn, org = ORG) => () => runInOrg(org, fn);

/** Extra organisations created by the tenancy tests, cleaned up at the end. */
const extraOrgs = [];

test.after(async () => {
  // Deleting the organisation cascades everywhere; the ledger's delete guard has
  // to stand down for that, exactly as in the seed script.
  await pool.query('ALTER TABLE stock_movements DISABLE TRIGGER trg_movements_immutable_del');
  await pool.query('DELETE FROM orgs WHERE id = ANY($1::uuid[])', [[ORG, ...extraOrgs]]);
  await pool.query('ALTER TABLE stock_movements ENABLE TRIGGER trg_movements_immutable_del');
  await pool.end();
});

/**
 * The raw SQL probes below are scoped to the test organisation explicitly.
 * `runInOrg` binds `app.org_id` so RLS does the scoping, but a superuser
 * connection — which is what a local development database usually gives you —
 * bypasses RLS and would happily see a neighbouring organisation's rows.
 */
const ORG_SCOPED = { org: ORG };

/** Assert that a promise rejects with a given business error code. */
const rejectsWith = (fn, code) =>
  assert.rejects(fn, (err) => err.code === code || String(err.message).includes(code),
    `expected error code ${code}`);

let cat, itemA, itemB;

test('setup: category + items', inOrg(async () => {
  cat = await categories.createCategory('اختبار');
  itemA = await items.createItem({ name: 'صنف أ', category_id: cat.id, barcode: 'AAA-111', purchase_price: 10, sale_price: 15 });
  itemB = await items.createItem({ name: 'صنف ب', category_id: cat.id, barcode: 'BBB-222', purchase_price: 4, sale_price: 9 });
  assert.equal(itemA.quantity, 0);
  assert.equal(itemA.category_name, 'اختبار');
}));

test('barcode uniqueness spans items and sub-barcodes', inOrg(async () => {
  await rejectsWith(() => items.createItem({ name: 'مكرر', barcode: 'AAA-111', purchase_price: 1, sale_price: 2 }), 'BARCODE_TAKEN');

  await items.addSubBarcode(itemA.id, { barcode: 'SUB-999', label: 'كود المورد' });
  // A new item may not steal an existing sub-barcode…
  await rejectsWith(() => items.createItem({ name: 'مكرر٢', barcode: 'SUB-999', purchase_price: 1, sale_price: 2 }), 'BARCODE_TAKEN');
  // …and a sub-barcode may not collide with a primary barcode.
  await rejectsWith(() => items.addSubBarcode(itemB.id, { barcode: 'AAA-111' }), 'BARCODE_TAKEN');
}));

test('barcode lookup resolves primary and sub-barcodes to the same item', inOrg(async () => {
  assert.equal((await items.findByBarcode('AAA-111')).id, itemA.id);
  const viaSub = await items.findByBarcode('SUB-999');
  assert.equal(viaSub.id, itemA.id);
  assert.equal(viaSub.matched_on, 'SUB');
  assert.equal(await items.findByBarcode('does-not-exist'), null);
}));

test('category deletion is blocked while items are assigned', inOrg(async () => {
  await rejectsWith(() => categories.deleteCategory(cat.id), 'CATEGORY_HAS_ITEMS');
}));

test('posting a purchase adds stock and propagates the purchase price', inOrg(async () => {
  const inv = await invoices.createInvoice({ type: 'PURCHASE', supplier_id: null });
  // An empty draft reports the missing line first…
  await rejectsWith(() => invoices.postInvoice(inv.id), 'NO_LINES');

  await invoices.addLineByBarcode(inv.id, { barcode: 'AAA-111', quantity: 50, unit_price: 12 });
  // …and once it has lines, the missing party is what blocks posting.
  await rejectsWith(() => invoices.postInvoice(inv.id), 'SUPPLIER_REQUIRED');

  const supplier = await parties.createParty('suppliers', { name: 'مورد الاختبار' });
  await invoices.updateInvoice(inv.id, { supplier_id: supplier.id });

  const posted = await invoices.postInvoice(inv.id);
  assert.equal(posted.status, 'POSTED');
  assert.equal(posted.subtotal, 600);

  const after = await items.getItem(itemA.id);
  assert.equal(after.quantity, 50);
  assert.equal(after.purchase_price, 12, 'purchase price propagated from the line');
}));

test('update_item_price = false records a one-off price', inOrg(async () => {
  const inv = await invoices.createInvoice({ type: 'STOCK_IN' });
  await invoices.addLineByBarcode(inv.id, { barcode: 'AAA-111', quantity: 5, unit_price: 99, update_item_price: false });
  await invoices.postInvoice(inv.id);
  assert.equal((await items.getItem(itemA.id)).purchase_price, 12, 'stored price left untouched');
  assert.equal((await items.getItem(itemA.id)).quantity, 55);
}));

test('negative stock is rejected and nothing is partially applied', inOrg(async () => {
  const inv = await invoices.createInvoice({ type: 'STOCK_OUT' });
  await invoices.addLineByBarcode(inv.id, { barcode: 'AAA-111', quantity: 10 });
  await invoices.addLineByBarcode(inv.id, { barcode: 'BBB-222', quantity: 3 }); // itemB has 0 in stock

  await rejectsWith(() => invoices.postInvoice(inv.id), 'INSUFFICIENT_STOCK');

  assert.equal((await items.getItem(itemA.id)).quantity, 55, 'no movement written for the valid line');
  assert.equal((await items.getItem(itemB.id)).quantity, 0);
  assert.equal((await invoices.getInvoice(inv.id)).status, 'DRAFT', 'invoice stays editable');
}));

test('the guard aggregates quantity across duplicate lines of one item', inOrg(async () => {
  const inv = await invoices.createInvoice({ type: 'STOCK_OUT' });
  await invoices.addLineByBarcode(inv.id, { barcode: 'AAA-111', quantity: 30, unit_price: 1 });
  await invoices.addLineByBarcode(inv.id, { barcode: 'AAA-111', quantity: 30, unit_price: 2 });
  // 30 + 30 > 55 even though each line alone would pass.
  await rejectsWith(() => invoices.postInvoice(inv.id), 'INSUFFICIENT_STOCK');
  await invoices.deleteInvoice(inv.id);
}));

test('quick movement posts through an auto invoice', inOrg(async () => {
  const { invoice, item } = await invoices.recordQuickMovement(itemB.id, { type: 'IN', quantity: 20, note: 'رصيد أولي' });
  assert.equal(invoice.status, 'POSTED');
  assert.equal(invoice.source, 'QUICK');
  assert.equal(item.quantity, 20);

  const movement = await get(
    'SELECT * FROM stock_movements WHERE invoice_id = @id AND org_id = @org',
    { id: invoice.id, ...ORG_SCOPED });
  assert.equal(movement.reference_type, 'MANUAL');
  assert.ok(movement.invoice_id, 'every movement carries an invoice');

  await rejectsWith(() => invoices.recordQuickMovement(itemB.id, { type: 'OUT', quantity: 999 }), 'INSUFFICIENT_STOCK');
}));

test('posted invoices are immutable', inOrg(async () => {
  const posted = await get(
    "SELECT id FROM invoices WHERE status='POSTED' AND org_id = @org LIMIT 1", ORG_SCOPED);
  await rejectsWith(() => invoices.updateInvoice(posted.id, { note: 'تعديل' }), 'INVOICE_NOT_DRAFT');
  await rejectsWith(() => invoices.addLineByBarcode(posted.id, { barcode: 'AAA-111' }), 'INVOICE_NOT_DRAFT');
  await rejectsWith(() => invoices.cancelInvoice(posted.id), 'INVOICE_POSTED');
  await rejectsWith(() => invoices.deleteInvoice(posted.id), 'INVOICE_POSTED');
}));

test('the stock ledger rejects updates and deletes', inOrg(async () => {
  const m = await get('SELECT id FROM stock_movements WHERE org_id = @org LIMIT 1', ORG_SCOPED);
  await rejectsWith(() => run('UPDATE stock_movements SET quantity = 1 WHERE id = ?', [m.id]), 'LEDGER_IMMUTABLE');
  await rejectsWith(() => run('DELETE FROM stock_movements WHERE id = ?', [m.id]), 'LEDGER_IMMUTABLE');
}));

test('an unknown barcode reports item_not_found instead of creating an item', inOrg(async () => {
  const inv = await invoices.createInvoice({ type: 'STOCK_IN' });
  await assert.rejects(() => invoices.addLineByBarcode(inv.id, { barcode: 'NOT-A-REAL-CODE' }),
    (err) => err.status === 404 && err.details?.item_not_found === true);
  assert.equal((await get(
    'SELECT COUNT(*) n FROM items WHERE barcode = @code AND org_id = @org',
    { code: 'NOT-A-REAL-CODE', ...ORG_SCOPED })).n, 0);
  await invoices.deleteInvoice(inv.id);
}));

test('stocktaking: full count → submit → apply generates both auto invoices', inOrg(async () => {
  const before = {
    a: (await items.getItem(itemA.id)).quantity,
    b: (await items.getItem(itemB.id)).quantity,
  };

  const session = await counts.createStockCount({ scope: 'CATEGORY', category_id: cat.id });
  assert.equal(session.status, 'OPEN');
  assert.equal(session.lines.length, 2);

  const lineA = session.lines.find((l) => l.item_id === itemA.id);
  const lineB = session.lines.find((l) => l.item_id === itemB.id);
  assert.equal(lineA.expected_quantity, before.a, 'snapshot taken at session creation');

  // Cannot apply before submitting.
  await rejectsWith(() => counts.applyStockCount(session.id), 'STOCK_COUNT_NOT_SUBMITTED');
  // Cannot submit with lines still blank.
  await rejectsWith(() => counts.submitStockCount(session.id), 'LINES_NOT_COUNTED');

  await counts.updateCountLine(session.id, lineA.id, { counted_quantity: before.a + 7 }); // surplus
  await counts.updateCountLine(session.id, lineB.id, { counted_quantity: before.b - 3, note: 'تالف' }); // shortage

  const submitted = await counts.submitStockCount(session.id);
  assert.equal(submitted.status, 'SUBMITTED');
  assert.equal(submitted.summary.surplus.length, 1);
  assert.equal(submitted.summary.shortage.length, 1);

  const { session: applied, invoices: generated } = await counts.applyStockCount(session.id);
  assert.equal(applied.status, 'APPLIED');
  assert.equal(generated.length, 2);
  assert.deepEqual(generated.map((i) => i.type).sort(), ['STOCK_IN', 'STOCK_OUT']);
  assert.ok(generated.every((i) => i.status === 'POSTED' && i.stock_count_id === session.id));

  // Stock now matches what was physically counted.
  assert.equal((await items.getItem(itemA.id)).quantity, before.a + 7);
  assert.equal((await items.getItem(itemB.id)).quantity, before.b - 3);

  // Variance lines link back to the invoice line they produced.
  assert.ok((await counts.getCountLines(session.id)).every((l) => l.auto_invoice_line_id));
  // Applied sessions are locked.
  await rejectsWith(() => counts.cancelStockCount(session.id), 'STOCK_COUNT_APPLIED');
  await rejectsWith(() => counts.updateCountLine(session.id, lineA.id, { counted_quantity: 1 }), 'STOCK_COUNT_LOCKED');
}));

test('stocktaking with no variance still applies, generating no invoices', inOrg(async () => {
  const session = await counts.createStockCount({ scope: 'ITEM', item_id: itemA.id });
  const line = session.lines[0];
  await counts.updateCountLine(session.id, line.id, { counted_quantity: line.expected_quantity });
  await counts.submitStockCount(session.id);

  const { session: applied, invoices: generated } = await counts.applyStockCount(session.id);
  assert.equal(applied.status, 'APPLIED');
  assert.equal(generated.length, 0);
}));

test('a shortage that would go negative rolls the whole apply back', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف ناقص', barcode: 'NEG-001', purchase_price: 1, sale_price: 2 });
  await invoices.recordQuickMovement(item.id, { type: 'IN', quantity: 5 });

  const session = await counts.createStockCount({ scope: 'ITEM', item_id: item.id });
  const line = session.lines[0];
  await counts.updateCountLine(session.id, line.id, { counted_quantity: 0 }); // variance -5
  await counts.submitStockCount(session.id);

  // Someone sells the stock while the count is pending review.
  await invoices.recordQuickMovement(item.id, { type: 'OUT', quantity: 5 });

  await rejectsWith(() => counts.applyStockCount(session.id), 'INSUFFICIENT_STOCK');
  assert.equal((await counts.getStockCount(session.id)).status, 'SUBMITTED', 'session stays correctable');
  assert.equal((await items.getItem(item.id)).quantity, 0, 'no partial effect');
  assert.equal((await get(
    "SELECT COUNT(*) n FROM invoices WHERE stock_count_id = ? AND status='POSTED'", [session.id])).n,
  0, 'rolled back auto-invoices left no posted document');
  // The rollback undoes the draft documents too, not just their postings.
  assert.equal((await get(
    'SELECT COUNT(*) n FROM invoices WHERE stock_count_id = ?', [session.id])).n,
  0, 'no orphaned draft left behind');
}));

test('the concurrency flag marks lines whose stock moved after the snapshot', inOrg(async () => {
  const session = await counts.createStockCount({ scope: 'ITEM', item_id: itemB.id });
  assert.equal(session.lines[0].is_stale, false);

  await invoices.recordQuickMovement(itemB.id, { type: 'IN', quantity: 1 });
  assert.equal((await counts.getCountLines(session.id))[0].is_stale, true);

  const refreshed = await counts.refreshExpected(session.id);
  assert.equal(refreshed.lines[0].expected_quantity, (await items.getItem(itemB.id)).quantity);
  assert.equal(refreshed.lines[0].is_stale, false);
  await counts.cancelStockCount(session.id);
}));

test('soft-deleted items keep their movement history', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف محذوف', barcode: 'DEL-001', purchase_price: 1, sale_price: 2 });
  await invoices.recordQuickMovement(item.id, { type: 'IN', quantity: 3 });
  await items.deleteItem(item.id);

  const listed = await items.listItems({ page: 1, limit: 100 });
  assert.equal(listed.rows.some((i) => i.id === item.id), false);
  assert.equal(await items.findByBarcode('DEL-001'), null);
  assert.ok((await get('SELECT COUNT(*) n FROM stock_movements WHERE item_id = ?', [item.id])).n > 0);
}));

test('search matches name, primary barcode and sub-barcodes, de-duplicated', inOrg(async () => {
  assert.ok((await items.searchItems('صنف أ')).some((i) => i.id === itemA.id));
  assert.equal((await items.searchItems('SUB-999'))[0].id, itemA.id);
  assert.equal((await items.searchItems('AAA-111')).filter((i) => i.id === itemA.id).length, 1);
}));

test('archiving a party keeps the record and its invoice links', inOrg(async () => {
  const c = await parties.createParty('customers', { name: 'عميل الاختبار', phone: '0599000000' });
  assert.equal((await parties.archiveParty('customers', c.id)).is_active, false);
  assert.equal((await parties.getParty('customers', c.id)).name, 'عميل الاختبار');
  assert.ok(await parties.findDuplicateName('customers', 'عميل الاختبار'), 'duplicate name is detectable');
  assert.equal((await parties.restoreParty('customers', c.id)).is_active, true);
}));

// ---------------------------------------------------------------------------
// New with the hosted, multi-tenant deployment.
// ---------------------------------------------------------------------------

test('one organisation cannot see or reach another organisation\'s data', async () => {
  const stranger = crypto.randomUUID();
  const other = await resolveOrg({ userId: stranger, email: `other-${stranger}@example.test` });
  extraOrgs.push(other.orgId);

  // The same barcode is free in a different organisation: uniqueness is per
  // tenant, not global.
  const twin = await runInOrg(other.orgId, () => items.createItem({
    name: 'صنف بنفس الباركود', barcode: 'AAA-111', purchase_price: 1, sale_price: 2,
  }));
  assert.notEqual(twin.id, itemA.id);

  // An id belonging to the first organisation, to try reaching across with.
  const foreignInvoice = await runInOrg(ORG, () =>
    get('SELECT id FROM invoices WHERE org_id = @org LIMIT 1', ORG_SCOPED));

  await runInOrg(other.orgId, async () => {
    // Listing shows only this organisation's catalogue…
    const { rows } = await items.listItems({ page: 1, limit: 200 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, twin.id);
    // …a lookup by barcode resolves to the local twin, not the neighbour's item…
    assert.equal((await items.findByBarcode('AAA-111')).id, twin.id);
    // …and an id from the other organisation is simply not found.
    await rejectsWith(() => items.getItem(itemA.id), 'ITEM_NOT_FOUND');
    await rejectsWith(() => invoices.getInvoice(foreignInvoice.id), 'INVOICE_NOT_FOUND');
  });

  // Row Level Security is the backstop: with no organisation bound to the
  // connection, the tables are empty even for a hand-written query. (A superuser
  // connection bypasses RLS — see migrations/002_rls.sql.)
  const bypasses = (await pool.query('SELECT usesuper FROM pg_user WHERE usename = current_user'))
    .rows[0]?.usesuper;
  if (!bypasses) {
    const leaked = await pool.query('SELECT COUNT(*)::int n FROM items');
    assert.equal(leaked.rows[0].n, 0, 'no rows are visible without app.org_id');
  }
});

test('settings are per organisation', async () => {
  const { getSettings, setSettings } = await import('../src/db/index.js');
  const mine = await runInOrg(ORG, () => setSettings({ low_stock_threshold: 42 }));
  assert.equal(mine.low_stock_threshold, '42');

  const other = extraOrgs[0];
  const theirs = await runInOrg(other, getSettings);
  assert.equal(theirs.low_stock_threshold, '5', 'default is untouched in the other organisation');

  await runInOrg(ORG, () => setSettings({ low_stock_threshold: 5 }));
});
