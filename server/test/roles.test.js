/**
 * Money redaction — the filter that makes the staff role mean something.
 *
 * No database: `scrubMoney` is a pure function over a response body, and the
 * failure mode worth testing is "a key that should have been dropped survived",
 * which needs nothing but a payload shaped like the real ones.
 *
 * The shapes below are copied from what the service layer actually returns
 * (see the alias lists in items.service.js / invoices.service.js), so a new
 * money column that nobody adds to MONEY_KEYS fails here rather than in
 * production.
 *
 *   node --test test/roles.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  scrubMoney, canSeePrices, redactMoney, stripMoneyFromBody, requireManager,
  MANAGER, STAFF,
} from '../src/lib/roles.js';

/**
 * A one-route app carrying a fixed role, exercised over a real socket.
 *
 * The filters work by replacing `res.json`, which is the kind of thing that
 * can pass a unit test and still not fire in Express's actual response path —
 * so these go through `fetch` rather than calling the middleware directly.
 */
async function serve(role, mount, fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { role, orgId: 'o1', userId: 'u1' }; next(); });
  app.use(redactMoney, stripMoneyFromBody);
  mount(app);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('only a manager sees prices', () => {
  assert.equal(canSeePrices(MANAGER), true);
  assert.equal(canSeePrices(STAFF), false);
  assert.equal(canSeePrices(undefined), false);
  assert.equal(canSeePrices('SOMETHING_ELSE'), false);
});

test('item rows keep everything except the two prices', () => {
  const item = {
    id: 'i1', name: 'صنف', barcode: '600', quantity: 12,
    purchase_price: 3.5, sale_price: 5, is_low_stock: false,
  };
  const out = scrubMoney(item);
  assert.deepEqual(Object.keys(out), ['id', 'name', 'barcode', 'quantity', 'is_low_stock']);
  assert.equal(out.quantity, 12);
});

test('the pagination envelope keeps its row count', () => {
  // `total` is money on an invoice and a row count in `meta` — the one case
  // where the key alone is not enough to decide.
  const body = {
    data: [{ id: 'v1', number: 'IN-00001', total: 90, line_count: 2 }],
    meta: { page: 1, limit: 25, total: 137, pages: 6 },
  };
  const out = scrubMoney(body);
  assert.equal(out.meta.total, 137, 'row count must survive');
  assert.equal(out.meta.pages, 6);
  assert.equal('total' in out.data[0], false, 'invoice total must be dropped');
  assert.equal(out.data[0].line_count, 2);
});

test('invoice lines lose price and line total but keep quantities', () => {
  const invoice = {
    id: 'v1', number: 'OUT-00007', status: 'POSTED',
    subtotal: 120, discount_total: 0, tax_total: 0, total: 120,
    lines: [
      { id: 'l1', item_name: 'أ', quantity: 3, conversion_factor: 1, unit_price: 20, line_total: 60 },
      { id: 'l2', item_name: 'ب', quantity: 2, conversion_factor: 12, unit_price: 30, line_total: 60 },
    ],
  };
  const out = scrubMoney(invoice);
  for (const key of ['subtotal', 'discount_total', 'tax_total', 'total']) {
    assert.equal(key in out, false, `${key} must be dropped`);
  }
  assert.equal(out.lines.length, 2);
  assert.equal(out.lines[0].quantity, 3);
  assert.equal(out.lines[1].conversion_factor, 12);
  assert.equal('unit_price' in out.lines[0], false);
  assert.equal('line_total' in out.lines[0], false);
});

/*
 * Profitability (migration 007) is manager-only, and stricter than the rest of
 * the money set: a clerk keeps sale prices and totals, but never cost or
 * profit. `cost_price` is the one to watch — it is a purchase price under
 * another name, so a clerk keeping it would defeat the boundary these tests
 * exist to hold.
 */
const PROFIT_KEYS = ['cost_total', 'profit', 'margin_pct', 'profit_exact'];
const PROFIT_LINE_KEYS = ['cost_price', 'line_cost', 'line_profit'];

const profitInvoice = () => ({
  id: 'v1', number: 'OUT-00007', status: 'POSTED', type: 'STOCK_OUT',
  subtotal: 120, discount_total: 0, tax_total: 0, total: 120,
  cost_total: 70, profit: 50, margin_pct: 41.7, profit_exact: true,
  lines: [
    {
      id: 'l1', item_name: 'أ', quantity: 3, unit_price: 20, line_total: 60,
      cost_price: 12, line_cost: 36, line_profit: 24,
    },
  ],
});

test('a staff account loses profit, cost and margin', () => {
  const out = scrubMoney(profitInvoice());
  for (const key of PROFIT_KEYS) {
    assert.equal(key in out, false, `${key} must be dropped`);
  }
  for (const key of PROFIT_LINE_KEYS) {
    assert.equal(key in out.lines[0], false, `lines[].${key} must be dropped`);
  }
  assert.equal(out.lines[0].quantity, 3, 'quantities still survive');
});

test('a clerk keeps sale prices but still loses cost and profit', () => {
  const out = scrubMoney(profitInvoice(), { keepSalePrice: true });
  // What a clerk is meant to keep, so it can tell a customer what to pay.
  assert.equal(out.total, 120);
  assert.equal(out.lines[0].unit_price, 20);
  assert.equal(out.lines[0].line_total, 60);
  // What it must not learn: what the goods cost, or what was made on them.
  for (const key of PROFIT_KEYS) {
    assert.equal(key in out, false, `${key} must be dropped for a clerk too`);
  }
  for (const key of PROFIT_LINE_KEYS) {
    assert.equal(key in out.lines[0], false, `lines[].${key} must be dropped for a clerk too`);
  }
});

test('the summary loses profit_total alongside the other money', () => {
  const body = {
    data: [],
    meta: { page: 1, limit: 25, total: 0, pages: 1 },
    summary: {
      in_total: 400, out_total: 950, net_total: 550,
      profit_total: 310, profit_exact: true, in_count: 2, out_count: 1,
    },
  };
  for (const keep of [false, true]) {
    const out = scrubMoney(body, { keepSalePrice: keep });
    assert.equal('profit_total' in out.summary, false,
      `profit_total must be dropped (keepSalePrice: ${keep})`);
    assert.equal('profit_exact' in out.summary, false,
      `profit_exact must be dropped (keepSalePrice: ${keep})`);
    assert.equal(out.summary.out_count, 1, 'counts still survive');
  }
});

test('the invoices summary loses its money but keeps its counts', () => {
  // The shape of GET /invoices: a paginated envelope plus a totals block for
  // the current filter. The counts are how many documents, which is not a
  // price; the three totals are.
  const body = {
    data: [{ id: 'v1', number: 'OUT-00001', total: 90 }],
    meta: { page: 1, limit: 25, total: 3, pages: 1 },
    summary: {
      in_total: 400, out_total: 950, net_total: 550, in_count: 2, out_count: 1,
    },
  };
  const out = scrubMoney(body);
  for (const key of ['in_total', 'out_total', 'net_total']) {
    assert.equal(key in out.summary, false, `${key} must be dropped`);
  }
  assert.equal(out.summary.in_count, 2);
  assert.equal(out.summary.out_count, 1);
  assert.equal(out.meta.total, 3, 'the row count still survives alongside it');
});

test('dashboard keeps counts, loses value and profit', () => {
  const stats = {
    total_items: 40, total_units: 900, stock_value: 5000, stock_profit: 1200,
    low_stock_count: 3, out_of_stock_count: 1,
    today: { in_qty: 10, out_qty: 4, movements: 6 },
  };
  const out = scrubMoney(stats);
  assert.equal('stock_value' in out, false);
  assert.equal('stock_profit' in out, false);
  assert.equal(out.total_units, 900);
  assert.equal(out.today.movements, 6, 'nested plain objects are walked');
});

test('party stats lose the transaction total', () => {
  const party = {
    id: 'p1', name: 'مورّد',
    stats: { invoice_count: 9, total_value: 4300, last_invoice_date: '2026-08-01' },
    recent_invoices: [{ id: 'v1', number: 'IN-00003', total: 500 }],
  };
  const out = scrubMoney(party);
  assert.equal(out.stats.invoice_count, 9);
  assert.equal('total_value' in out.stats, false);
  assert.equal('total' in out.recent_invoices[0], false);
  assert.equal(out.recent_invoices[0].number, 'IN-00003');
});

test('units carry their own prices, and lose them too', () => {
  const out = scrubMoney({
    units: [{ id: 'u1', name: 'كرتون', conversion_factor: 24, purchase_price: 60, sale_price: 80 }],
  });
  assert.equal(out.units[0].conversion_factor, 24);
  assert.equal('purchase_price' in out.units[0], false);
  assert.equal('sale_price' in out.units[0], false);
});

test('scrubbing does not mutate the input', () => {
  const item = { id: 'i1', sale_price: 5 };
  scrubMoney(item);
  assert.equal(item.sale_price, 5, 'the caller\'s object must be untouched');
});

test('non-objects and nulls pass through unchanged', () => {
  assert.equal(scrubMoney(null), null);
  assert.equal(scrubMoney(undefined), undefined);
  assert.equal(scrubMoney('IN-00001'), 'IN-00001');
  assert.equal(scrubMoney(7), 7);
  assert.deepEqual(scrubMoney([1, 2]), [1, 2]);
  // A Date is not a plain object — it must survive as itself, not be walked
  // into an empty `{}`.
  const date = new Date('2026-08-15T00:00:00.000Z');
  assert.equal(scrubMoney(date), date);
});

test('request bodies are stripped with the same rule', () => {
  // What `stripMoneyFromBody` does to a staff user's invoice-line POST: the
  // price is dropped, so the service falls back to the item's own price.
  const body = { barcode: '600123', quantity: 4, unit_price: 99, update_item_price: true };
  const out = scrubMoney(body);
  assert.equal('unit_price' in out, false);
  assert.equal(out.quantity, 4);
  assert.equal(out.barcode, '600123');
});

/* -------------------------------------------------- the filters over HTTP */

const ITEM = { id: 'i1', name: 'صنف', quantity: 5, purchase_price: 3, sale_price: 7 };

test('a staff response really arrives without prices', async () => {
  await serve(STAFF, (app) => app.get('/items', (_req, res) => res.json({ data: [ITEM] })),
    async (base) => {
      const body = await fetch(`${base}/items`).then((r) => r.json());
      assert.equal(body.data[0].quantity, 5);
      assert.equal('purchase_price' in body.data[0], false);
      assert.equal('sale_price' in body.data[0], false);
    });
});

test('a manager response arrives untouched', async () => {
  await serve(MANAGER, (app) => app.get('/items', (_req, res) => res.json({ data: [ITEM] })),
    async (base) => {
      const body = await fetch(`${base}/items`).then((r) => r.json());
      assert.equal(body.data[0].purchase_price, 3);
      assert.equal(body.data[0].sale_price, 7);
    });
});

test('a staff request cannot set a price', async () => {
  await serve(STAFF, (app) => app.post('/lines', (req, res) => res.json({ received: req.body })),
    async (base) => {
      const body = await fetch(`${base}/lines`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ barcode: '600', quantity: 2, unit_price: 999 }),
      }).then((r) => r.json());
      assert.equal(body.received.quantity, 2);
      assert.equal('unit_price' in body.received, false, 'the price must not reach the service');
    });
});

test('requireManager refuses staff with 403 and lets a manager through', async () => {
  const mount = (app) => {
    app.get('/admin', requireManager, (_req, res) => res.json({ ok: true }));
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ code: err.code }));
  };
  await serve(STAFF, mount, async (base) => {
    const res = await fetch(`${base}/admin`);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'MANAGER_ONLY');
  });
  await serve(MANAGER, mount, async (base) => {
    assert.equal((await fetch(`${base}/admin`)).status, 200);
  });
});
