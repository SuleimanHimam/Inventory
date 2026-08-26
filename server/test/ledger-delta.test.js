/*
 * The arithmetic behind "edit in place".
 *
 * `planLedgerDelta` decides what a re-posting writes to the stock ledger, and
 * therefore whether a warehouse balance is right. It is pure on purpose, so
 * these run against no database at all — which is what makes them the tests
 * that can be trusted on a machine that cannot reach a SQL Server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planLedgerDelta, desiredQuantities } from '../src/services/invoices.service.js';

const map = (o) => new Map(Object.entries(o));
const plan = (applied, desired) =>
  planLedgerDelta(map(applied), map(desired))
    .sort((a, b) => a.item_id.localeCompare(b.item_id));

test('a first posting writes the whole effect', () => {
  assert.deepEqual(plan({}, { a: -5 }), [{ item_id: 'a', type: 'OUT', quantity: 5 }]);
  assert.deepEqual(plan({}, { a: 12 }), [{ item_id: 'a', type: 'IN', quantity: 12 }]);
});

test('re-posting an untouched invoice writes nothing', () => {
  assert.deepEqual(plan({ a: -5, b: 3 }, { a: -5, b: 3 }), []);
});

test('a sale increased writes only the increase', () => {
  // 5 sold, corrected to 7: two more leave the shelf, not seven.
  assert.deepEqual(plan({ a: -5 }, { a: -7 }), [{ item_id: 'a', type: 'OUT', quantity: 2 }]);
});

test('a sale reduced gives back only the difference', () => {
  assert.deepEqual(plan({ a: -5 }, { a: -3 }), [{ item_id: 'a', type: 'IN', quantity: 2 }]);
});

test('a purchase reduced takes stock back off the shelf', () => {
  // The case the old direction-based guard could not see: an inbound document
  // that, amended, moves stock *out*.
  assert.deepEqual(plan({ a: 10 }, { a: 3 }), [{ item_id: 'a', type: 'OUT', quantity: 7 }]);
});

test('a line removed entirely is undone', () => {
  assert.deepEqual(plan({ a: -5, b: -2 }, { a: -5 }), [{ item_id: 'b', type: 'IN', quantity: 2 }]);
});

test('a line added is applied', () => {
  assert.deepEqual(plan({ a: -5 }, { a: -5, b: -4 }), [{ item_id: 'b', type: 'OUT', quantity: 4 }]);
});

test('swapping one item for another moves both', () => {
  assert.deepEqual(plan({ a: -5 }, { b: -5 }), [
    { item_id: 'a', type: 'IN', quantity: 5 },
    { item_id: 'b', type: 'OUT', quantity: 5 },
  ]);
});

test('an invoice reversed under the old edit path reads as nothing applied', () => {
  // liveMovements drops a reversed entry and its reversal together, so a
  // document written before this change re-posts its full effect. This is
  // what makes OUT-00017 and its kind safe to edit.
  assert.deepEqual(plan({}, { a: -5 }), [{ item_id: 'a', type: 'OUT', quantity: 5 }]);
});

test('desiredQuantities signs by direction and merges lines of one item', () => {
  const lines = [
    { item_id: 'a', quantity: 2, conversion_factor: 1 },
    { item_id: 'a', quantity: 3, conversion_factor: 1 },
    { item_id: 'b', quantity: 1, conversion_factor: 12 },
  ];
  assert.deepEqual(desiredQuantities(lines, 'STOCK_OUT'), map({ a: -5, b: -12 }));
  assert.deepEqual(desiredQuantities(lines, 'STOCK_IN'), map({ a: 5, b: 12 }));
});

test('two lines of one item merge into a single entry', () => {
  const desired = desiredQuantities(
    [{ item_id: 'a', quantity: 30, conversion_factor: 1 },
     { item_id: 'a', quantity: 25, conversion_factor: 1 }], 'STOCK_OUT');
  assert.deepEqual(planLedgerDelta(new Map(), desired),
    [{ item_id: 'a', type: 'OUT', quantity: 55 }]);
});
