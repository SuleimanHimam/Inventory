/**
 * The accounting dashboard aggregate — one round trip that answers "where does
 * the money stand?"
 *
 * Two kinds of figure live here, and the difference is deliberate:
 *
 *   • Balances (cash on hand, the balance of each account type) are point-in-time
 *     snapshots. They are NOT period-bound — a balance is what the account holds
 *     right now, over all history — so the date range does not touch them.
 *
 *   • Flows (receipts, payments, expenses, the daily trend, the top expense
 *     accounts) are sums over the chosen window, so they take the range.
 *
 * Everything is org-scoped and reads only the ledger and vouchers the earlier
 * phases fill; nothing here writes.
 */
import { all, get, money, orgId } from '../db/index.js';
import { listVouchers } from './vouchers.service.js';

/** Balances of every cash/bank account, summed — money the business can spend. */
async function cashOnHand(org) {
  const row = await get(
    `SELECT COALESCE(SUM(t.debit - t.credit), 0) AS bal
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.org_id = t.org_id
       JOIN account_types ty ON ty.id = a.account_type_id AND ty.org_id = a.org_id
      WHERE t.org_id = @org AND ty.code IN ('CASH', 'BANK')`,
    { org },
  );
  return money(row?.bal ?? 0);
}

/** Net balance per account type (debit-positive), for the composition panel. */
async function balancesByType(org) {
  const rows = await all(
    `SELECT ty.code, ty.name,
            COALESCE(SUM(t.debit - t.credit), 0) AS bal
       FROM account_types ty
       LEFT JOIN accounts a ON a.account_type_id = ty.id AND a.org_id = ty.org_id
       LEFT JOIN transactions t ON t.account_id = a.id AND t.org_id = a.org_id
      WHERE ty.org_id = @org
      GROUP BY ty.code, ty.name
      ORDER BY ty.name`,
    { org },
  );
  return rows
    .map((r) => ({ code: r.code, name: r.name, balance: money(r.bal) }))
    .filter((r) => r.balance !== 0);
}

/** Build the shared "POSTED voucher in this range" WHERE clause and its params. */
function rangeClause(org, dateFrom, dateTo, alias = 'v') {
  const params = { org };
  let where = `${alias}.org_id = @org AND ${alias}.status = 'POSTED'`;
  if (dateFrom) { params.from = dateFrom; where += ` AND ${alias}.voucher_date >= @from`; }
  if (dateTo) { params.to = dateTo; where += ` AND ${alias}.voucher_date <= @to`; }
  return { params, where };
}

export async function accountingDashboard({ dateFrom, dateTo } = {}) {
  const org = orgId();

  // Sequential, not Promise.all: every query in a request shares one
  // transaction connection, and two in flight on it at once fails with "another
  // request in progress". The dashboard is a handful of fast reads regardless.
  const cash = await cashOnHand(org);
  const byType = await balancesByType(org);

  // Period flows from the voucher documents.
  const { params, where } = rangeClause(org, dateFrom, dateTo);
  const flows = await get(
    `SELECT COALESCE(SUM(CASE WHEN type = 'RECEIPT' THEN amount END), 0) AS receipts,
            COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount END), 0) AS payments,
            COUNT(*) AS voucher_count
       FROM vouchers v WHERE ${where}`,
    params,
  );

  // Expenses = payments landing in an expense account, over the window.
  const expenseRow = await get(
    `SELECT COALESCE(SUM(v.amount), 0) AS expenses
       FROM vouchers v
      WHERE ${where} AND v.type = 'PAYMENT'
        AND EXISTS (
          SELECT 1 FROM accounts a
            JOIN account_types t ON t.id = a.account_type_id AND t.org_id = a.org_id
           WHERE a.id = v.counter_account_id AND a.org_id = v.org_id AND t.code = 'EXPENSE')`,
    params,
  );

  // Top expense accounts by net debit in the window (entry_date, not voucher).
  const tParams = { org };
  let tWhere = "t.org_id = @org AND ty.code = 'EXPENSE'";
  if (dateFrom) { tParams.from = dateFrom; tWhere += ' AND t.entry_date >= @from'; }
  if (dateTo) { tParams.to = dateTo; tWhere += ' AND t.entry_date <= @to'; }
  const topExpenses = await all(
    `SELECT TOP 6 a.id, a.account_number, a.name,
            COALESCE(SUM(t.debit - t.credit), 0) AS total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.org_id = t.org_id
       JOIN account_types ty ON ty.id = a.account_type_id AND ty.org_id = a.org_id
      WHERE ${tWhere}
      GROUP BY a.id, a.account_number, a.name
     HAVING COALESCE(SUM(t.debit - t.credit), 0) <> 0
      ORDER BY COALESCE(SUM(t.debit - t.credit), 0) DESC`,
    tParams,
  );

  // Daily receipts vs payments, for the trend chart.
  const trend = await all(
    `SELECT v.voucher_date AS day,
            COALESCE(SUM(CASE WHEN type = 'RECEIPT' THEN amount ELSE 0 END), 0) AS receipts,
            COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0) AS payments
       FROM vouchers v WHERE ${where}
      GROUP BY v.voucher_date
      ORDER BY v.voucher_date`,
    params,
  );

  const { rows: recent } = await listVouchers({
    date_from: dateFrom, date_to: dateTo, page: 1, limit: 8,
  });

  const receipts = money(flows?.receipts ?? 0);
  const payments = money(flows?.payments ?? 0);
  return {
    date_from: dateFrom ?? null,
    date_to: dateTo ?? null,
    cash_on_hand: cash,
    balances_by_type: byType,
    receipts_total: receipts,
    payments_total: payments,
    net_total: money(receipts - payments),
    expenses_total: money(expenseRow?.expenses ?? 0),
    voucher_count: flows?.voucher_count ?? 0,
    top_expenses: topExpenses.map((r) => ({
      id: r.id, account_number: r.account_number, name: r.name, total: money(r.total),
    })),
    trend: trend.map((r) => ({
      day: r.day, receipts: money(r.receipts), payments: money(r.payments),
    })),
    recent,
  };
}
