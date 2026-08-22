/**
 * End-to-end business-rule tests against a throwaway SQL Server organisation.
 *
 * Run with:  npm test
 *   DB_SERVER / DB_USER / DB_PASSWORD as usual; TEST_DB_NAME overrides DB_NAME
 *   so the suite can point at a separate database from the dev one.
 *
 * Every test runs its statements through `bindOrg`, which binds `org_id` for
 * the service layer's application-level filtering but opens no transaction of
 * its own — see the comment on `bindOrg` in db/index.js for why: this suite's
 * Postgres-era design batched many assertions (including expected-failure
 * ones) into one transaction per test via savepoints, and a savepoint on this
 * engine cannot recover from a unique-violation or trigger-THROW, which is
 * exactly the failure class most of those assertions check for. Simulating
 * one request per service call sidesteps that, and matches how the API
 * actually uses these functions in production (`runInOrg` — a real
 * transaction — wraps exactly one call, per request).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DB_NAME = process.env.TEST_DB_NAME ?? process.env.DB_NAME;
if (!process.env.DB_SERVER || !process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD) {
  throw new Error(
    'DB_SERVER, DB_NAME (or TEST_DB_NAME), DB_USER and DB_PASSWORD must all be set to point at your SQL Server test database');
}
// The suite talks to the services directly, so it needs no JWT verification.
process.env.AUTH_MODE = 'none';

// Imported dynamically so the environment above is set before the modules load.
const { pool, get, run, runInOrg, bindOrg } = await import('../src/db/index.js');
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

/** Run a test body with the organisation bound — see the file header. */
const inOrg = (fn, org = ORG) => () => bindOrg(org, fn);

/** Extra organisations created by the tenancy tests, cleaned up at the end. */
const extraOrgs = [];

test.after(async () => {
  // Deleting the organisation cascades everywhere; the ledger's delete guard has
  // to stand down for that, exactly as in the seed script. Needs ALTER
  // permission on the table (db_ddladmin) — see provision-mssql.sql.
  await pool.batch('ALTER TABLE stock_movements DISABLE TRIGGER trg_movements_immutable_del');
  try {
    const ids = [ORG, ...extraOrgs];
    const params = {};
    const placeholders = ids.map((id, i) => { params[`id${i}`] = id; return `@id${i}`; });
    await run(`DELETE FROM orgs WHERE id IN (${placeholders.join(',')})`, params);
  } finally {
    await pool.batch('ALTER TABLE stock_movements ENABLE TRIGGER trg_movements_immutable_del');
  }
  await pool.close();
});

/**
 * The raw SQL probes below are scoped to the test organisation explicitly —
 * app-level `org_id` filtering is the only tenant-isolation layer now (see
 * the file header), so every query has to carry its own predicate.
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

test('barcode uniqueness now spans units too, in every direction', inOrg(async () => {
  await items.addUnit(itemA.id, { name: 'كرتونة', barcode: 'UNIT-777', conversion_factor: 12 });

  // A new item may not steal a unit barcode…
  await rejectsWith(() => items.createItem({ name: 'مكرر٣', barcode: 'UNIT-777', purchase_price: 1, sale_price: 2 }), 'BARCODE_TAKEN');
  // …a sub-barcode may not collide with a unit barcode…
  await rejectsWith(() => items.addSubBarcode(itemB.id, { barcode: 'UNIT-777' }), 'BARCODE_TAKEN');
  // …and a unit may not steal an existing primary or sub-barcode.
  await rejectsWith(() => items.addUnit(itemB.id, { name: 'دزينة', barcode: 'AAA-111', conversion_factor: 12 }), 'BARCODE_TAKEN');
  await rejectsWith(() => items.addUnit(itemB.id, { name: 'دزينة', barcode: 'SUB-999', conversion_factor: 12 }), 'BARCODE_TAKEN');

  // The UPDATE OF barcode path is exercised too, not just INSERT.
  const other = await items.addUnit(itemB.id, { name: 'علبة', barcode: 'UNIT-OK', conversion_factor: 6 });
  await rejectsWith(() => items.updateUnit(itemB.id, other.id, { barcode: 'UNIT-777' }), 'BARCODE_TAKEN');
}));

test('barcode lookup resolves primary, sub-barcodes, and unit barcodes to the same item', inOrg(async () => {
  assert.equal((await items.findByBarcode('AAA-111')).id, itemA.id);
  const viaSub = await items.findByBarcode('SUB-999');
  assert.equal(viaSub.id, itemA.id);
  assert.equal(viaSub.matched_on, 'SUB');
  const viaUnit = await items.findByBarcode('UNIT-777');
  assert.equal(viaUnit.id, itemA.id);
  assert.equal(viaUnit.matched_on, 'UNIT');
  assert.equal(viaUnit.matched_unit_id, viaUnit.units.find((u) => u.barcode === 'UNIT-777').id);
  assert.equal(await items.findByBarcode('does-not-exist'), null);
}));

test('an item may be created and kept with no barcode at all', inOrg(async () => {
  const first = await items.createItem({ name: 'صنف بلا باركود ١', purchase_price: 1, sale_price: 2 });
  assert.equal(first.barcode, null);
  // A second barcode-less item must not collide with the first — NULL is
  // never equal to NULL, in the unique index and in the app-level trigger.
  const second = await items.createItem({ name: 'صنف بلا باركود ٢', barcode: 'HAS-CODE', purchase_price: 1, sale_price: 2 });
  assert.equal(second.barcode, 'HAS-CODE');

  // Still reachable by name, and clearing an existing barcode via update works too.
  const [found] = await items.searchItems('صنف بلا باركود ١');
  assert.equal(found.id, first.id);
  const cleared = await items.updateItem(second.id, { barcode: null });
  assert.equal(cleared.barcode, null);
}));

test('category deletion is blocked while items are assigned', inOrg(async () => {
  await rejectsWith(() => categories.deleteCategory(cat.id), 'CATEGORY_HAS_ITEMS');
}));

test('posting a stock-in adds stock and propagates the purchase price', inOrg(async () => {
  const inv = await invoices.createInvoice({ type: 'STOCK_IN', supplier_id: null });
  // An empty draft reports the missing line first…
  await rejectsWith(() => invoices.postInvoice(inv.id), 'NO_LINES');

  await invoices.addLineByBarcode(inv.id, { barcode: 'AAA-111', quantity: 50, unit_price: 12 });
  // The supplier is an optional note, not required to post.
  const supplier = await parties.createParty('suppliers', { name: 'مورد الاختبار' });
  await invoices.updateInvoice(inv.id, { supplier_id: supplier.id });

  const posted = await invoices.postInvoice(inv.id);
  assert.equal(posted.status, 'POSTED');
  assert.equal(posted.subtotal, 600);
  assert.equal(posted.supplier_id, supplier.id, 'the optional supplier note was kept');

  const after = await items.getItem(itemA.id);
  assert.equal(after.quantity, 50);
  assert.equal(after.purchase_price, 12, 'purchase price propagated from the line');
}));

test('PURCHASE and SALE are no longer valid invoice types; STOCK_OUT can also carry a supplier note', inOrg(async () => {
  await rejectsWith(() => invoices.createInvoice({ type: 'PURCHASE' }), 'BAD_INVOICE_TYPE');
  await rejectsWith(() => invoices.createInvoice({ type: 'SALE' }), 'BAD_INVOICE_TYPE');

  const supplier = await parties.createParty('suppliers', { name: 'مورد اختياري' });
  const outInv = await invoices.createInvoice({ type: 'STOCK_OUT', supplier_id: supplier.id });
  assert.equal(outInv.supplier_id, supplier.id, 'the party field is not gated by direction');
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
    "SELECT TOP (1) id FROM invoices WHERE status='POSTED' AND org_id = @org", ORG_SCOPED);
  await rejectsWith(() => invoices.updateInvoice(posted.id, { note: 'تعديل' }), 'INVOICE_NOT_DRAFT');
  await rejectsWith(() => invoices.addLineByBarcode(posted.id, { barcode: 'AAA-111' }), 'INVOICE_NOT_DRAFT');
  await rejectsWith(() => invoices.cancelInvoice(posted.id), 'INVOICE_POSTED');
  await rejectsWith(() => invoices.deleteInvoice(posted.id), 'INVOICE_POSTED');
}));

test('the stock ledger rejects updates and deletes', inOrg(async () => {
  const m = await get('SELECT TOP (1) id FROM stock_movements WHERE org_id = @org', ORG_SCOPED);
  await rejectsWith(() => run('UPDATE stock_movements SET quantity = 1 WHERE id = @id', { id: m.id }), 'LEDGER_IMMUTABLE');
  await rejectsWith(() => run('DELETE FROM stock_movements WHERE id = @id', { id: m.id }), 'LEDGER_IMMUTABLE');
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
    "SELECT COUNT(*) n FROM invoices WHERE stock_count_id = @id AND status='POSTED'", { id: session.id })).n,
  0, 'rolled back auto-invoices left no posted document');
  // The rollback undoes the draft documents too, not just their postings.
  assert.equal((await get(
    'SELECT COUNT(*) n FROM invoices WHERE stock_count_id = @id', { id: session.id })).n,
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
  assert.ok((await get('SELECT COUNT(*) n FROM stock_movements WHERE item_id = @id', { id: item.id })).n > 0);
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
// Units of measure — each test uses its own fresh item so it does not disturb
// itemA/itemB's quantity, which earlier tests assert exact values for.
// ---------------------------------------------------------------------------

test('addLineByBarcode resolves a unit barcode with its own price and conversion factor', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف بوحدات', barcode: 'UNITS-BASE', purchase_price: 1, sale_price: 2 });
  const box = await items.addUnit(item.id, {
    name: 'كرتونة', barcode: 'UNITS-BOX', conversion_factor: 12, purchase_price: 10, sale_price: 20,
  });

  const inv = await invoices.createInvoice({ type: 'STOCK_IN' });
  const { line_id, item: matched } = await invoices.addLineByBarcode(inv.id, { barcode: 'UNITS-BOX', quantity: 3 });
  assert.equal(matched.matched_on, 'UNIT');

  const line = (await invoices.getInvoice(inv.id)).lines.find((l) => l.id === line_id);
  assert.equal(line.unit_id, box.id);
  assert.equal(line.conversion_factor, 12);
  assert.equal(line.unit_price, 10, "defaulted from the unit's own purchase price, not the item's");
  await invoices.deleteInvoice(inv.id);
}));

test('merge semantics: same unit barcode merges, base and unit barcodes stay separate lines', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف دمج', barcode: 'MERGE-BASE', purchase_price: 1, sale_price: 2 });
  const box = await items.addUnit(item.id, { name: 'كرتونة', barcode: 'MERGE-BOX', conversion_factor: 10 });

  const inv = await invoices.createInvoice({ type: 'STOCK_IN' });
  const first = await invoices.addLineByBarcode(inv.id, { barcode: 'MERGE-BOX', quantity: 2 });
  const second = await invoices.addLineByBarcode(inv.id, { barcode: 'MERGE-BOX', quantity: 3 });
  assert.equal(second.merged, true);
  assert.equal(second.line_id, first.line_id);

  const third = await invoices.addLineByBarcode(inv.id, { barcode: 'MERGE-BASE', quantity: 1 });
  assert.equal(third.merged, false, 'a different unit (the base unit) cannot merge into the box line');

  const lines = (await invoices.getInvoice(inv.id)).lines;
  assert.equal(lines.length, 2);
  assert.equal(lines.find((l) => l.unit_id === box.id).quantity, 5);
  await invoices.deleteInvoice(inv.id);
}));

test('posting converts unit quantity to base-unit stock in the ledger', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف تحويل', barcode: 'CONV-BASE', purchase_price: 1, sale_price: 2 });
  await items.addUnit(item.id, { name: 'كرتونة', barcode: 'CONV-BOX', conversion_factor: 12 });

  const inv = await invoices.createInvoice({ type: 'STOCK_IN' });
  await invoices.addLineByBarcode(inv.id, { barcode: 'CONV-BOX', quantity: 3 });
  await invoices.postInvoice(inv.id);

  assert.equal((await items.getItem(item.id)).quantity, 36, '3 cartons of 12 = 36 base units, not 3');
  const movement = await get('SELECT quantity FROM stock_movements WHERE invoice_id = @id AND org_id = @org',
    { id: inv.id, ...ORG_SCOPED });
  assert.equal(movement.quantity, 36);
}));

test('the outbound guard aggregates base-unit quantity across different units of one item', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف مختلط', barcode: 'MIX-BASE', purchase_price: 1, sale_price: 2 });
  await items.addUnit(item.id, { name: 'كرتونة', barcode: 'MIX-BOX', conversion_factor: 12 });
  await invoices.recordQuickMovement(item.id, { type: 'IN', quantity: 55 });

  const inv = await invoices.createInvoice({ type: 'STOCK_OUT' });
  // 2 boxes (24 base) + 40 pieces = 64 base units, over the 55 available — even
  // though 24 alone and 40 alone are each individually fine.
  await invoices.addLineByBarcode(inv.id, { barcode: 'MIX-BOX', quantity: 2 });
  await invoices.addLineByBarcode(inv.id, { barcode: 'MIX-BASE', quantity: 40 });
  await rejectsWith(() => invoices.postInvoice(inv.id), 'INSUFFICIENT_STOCK');
  assert.equal((await items.getItem(item.id)).quantity, 55, 'nothing partially applied');
}));

test('a unit quantity that does not convert to a whole number of base units is rejected', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف كسري', barcode: 'FRAC-BASE', purchase_price: 1, sale_price: 2 });
  await items.addUnit(item.id, { name: 'نصف كرتونة', barcode: 'FRAC-HALF', conversion_factor: 0.5 });

  const inv = await invoices.createInvoice({ type: 'STOCK_IN' });
  // 3 * 0.5 = 1.5 base units — not a whole number.
  await rejectsWith(
    () => invoices.addLineByBarcode(inv.id, { barcode: 'FRAC-HALF', quantity: 3 }), 'UNIT_QUANTITY_NOT_WHOLE');

  // A quantity that does divide evenly is fine.
  await invoices.addLineByBarcode(inv.id, { barcode: 'FRAC-HALF', quantity: 4 });
  await invoices.postInvoice(inv.id);
  assert.equal((await items.getItem(item.id)).quantity, 2, '4 * 0.5 = 2 base units');

  // The same guard applies when editing an existing line's quantity.
  const inv2 = await invoices.createInvoice({ type: 'STOCK_IN' });
  const added = await invoices.addLineByBarcode(inv2.id, { barcode: 'FRAC-HALF', quantity: 2 });
  await rejectsWith(
    () => invoices.updateLine(inv2.id, added.line_id, { quantity: 3 }), 'UNIT_QUANTITY_NOT_WHOLE');
  await invoices.deleteInvoice(inv2.id);
}));

test('posting a non-base-unit line propagates price to the unit, never the base item', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف أسعار', barcode: 'PRICE-BASE', purchase_price: 5, sale_price: 8 });
  const box = await items.addUnit(item.id, {
    name: 'كرتونة', barcode: 'PRICE-BOX', conversion_factor: 10, purchase_price: 40, sale_price: 70,
  });

  const inv = await invoices.createInvoice({ type: 'STOCK_IN' });
  await invoices.addLineByBarcode(inv.id, { barcode: 'PRICE-BOX', quantity: 1, unit_price: 45 });
  const supplier = await parties.createParty('suppliers', { name: 'مورد الوحدات' });
  await invoices.updateInvoice(inv.id, { supplier_id: supplier.id });
  await invoices.postInvoice(inv.id);

  const updatedUnit = (await items.listUnits(item.id)).find((u) => u.id === box.id);
  assert.equal(updatedUnit.purchase_price, 45, "the unit's own price was updated");
  assert.equal((await items.getItem(item.id)).purchase_price, 5, 'the base item price is untouched');
}));

test('a unit referenced by an invoice line cannot be deleted', inOrg(async () => {
  const item = await items.createItem({ name: 'صنف محمي', barcode: 'GUARD-BASE', purchase_price: 1, sale_price: 2 });
  const box = await items.addUnit(item.id, { name: 'كرتونة', barcode: 'GUARD-BOX', conversion_factor: 5 });
  const inv = await invoices.createInvoice({ type: 'STOCK_IN' });
  await invoices.addLineByBarcode(inv.id, { barcode: 'GUARD-BOX', quantity: 1 });

  await rejectsWith(() => items.removeUnit(item.id, box.id), 'UNIT_IN_USE');

  await invoices.deleteInvoice(inv.id);
  // Once nothing references it, deletion succeeds.
  await items.removeUnit(item.id, box.id);
  assert.equal((await items.listUnits(item.id)).length, 0);
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
  const twin = await bindOrg(other.orgId, () => items.createItem({
    name: 'صنف بنفس الباركود', barcode: 'AAA-111', purchase_price: 1, sale_price: 2,
  }));
  assert.notEqual(twin.id, itemA.id);

  // A unit barcode already used in the first organisation is free here too.
  const twinUnit = await bindOrg(other.orgId, () =>
    items.addUnit(twin.id, { name: 'كرتونة', barcode: 'UNIT-777', conversion_factor: 12 }));
  assert.ok(twinUnit.id);

  // An id belonging to the first organisation, to try reaching across with.
  const foreignInvoice = await bindOrg(ORG, () =>
    get('SELECT TOP (1) id FROM invoices WHERE org_id = @org', ORG_SCOPED));

  await bindOrg(other.orgId, async () => {
    // Listing shows only this organisation's catalogue…
    const { rows } = await items.listItems({ page: 1, limit: 200 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, twin.id);
    // …a lookup by barcode resolves to the local twin, not the neighbour's item…
    assert.equal((await items.findByBarcode('AAA-111')).id, twin.id);
    // …and an id from the other organisation is simply not found — the
    // application-level org_id predicate on every query is the only tenant
    // isolation layer on this engine (no Row-Level-Security equivalent; see
    // db/index.js's file header for why that layer was dropped rather than
    // ported).
    await rejectsWith(() => items.getItem(itemA.id), 'ITEM_NOT_FOUND');
    await rejectsWith(() => invoices.getInvoice(foreignInvoice.id), 'INVOICE_NOT_FOUND');
  });
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
