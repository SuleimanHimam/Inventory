/**
 * Chart of Accounts — the accounting module's foundation.
 *
 * A dynamic tree: every account carries `parent_account_id`, and depth is
 * unlimited. Only posting accounts (`is_posting`) may take voucher lines;
 * groups exist to organise. Nothing is ever hard-deleted once it has history —
 * an account with children, transactions or vouchers can only be deactivated.
 *
 * All queries are org-scoped through the ambient context (orgId()), same as the
 * rest of the services.
 */
import {
  all, get, run, newId, orgId, nowIso, tx, publicRow, money, getSettings, setSettings,
} from '../db/index.js';
import ACCOUNTS_SEED from '../db/accounts.seed.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/**
 * The standard account types, seeded per file. Expandable — a file may add its
 * own rows to `account_types` later; these are only the defaults.
 */
export const DEFAULT_ACCOUNT_TYPES = [
  { code: 'ASSET', name: 'أصول' },
  { code: 'LIABILITY', name: 'خصوم' },
  { code: 'EQUITY', name: 'حقوق ملكية' },
  { code: 'REVENUE', name: 'إيرادات' },
  { code: 'EXPENSE', name: 'مصروفات' },
  { code: 'CASH', name: 'صندوق' },
  { code: 'BANK', name: 'بنك' },
  { code: 'CUSTOMER', name: 'عملاء' },
  { code: 'SUPPLIER', name: 'موردون' },
  { code: 'GENERAL', name: 'عام' },
];

/* ------------------------------------------------------------------- seeding */
/**
 * Create the default types and chart for the current org, once. Idempotent on
 * (org_id, account_number) and (org_id, code), so a second run is a no-op and
 * never duplicates — which is what lets it double as a lazy backfill for files
 * that predate the accounting module.
 */
export async function seedAccounts() {
  const org = orgId();
  await tx(async () => {
    // Types first.
    for (const t of DEFAULT_ACCOUNT_TYPES) {
      await run(
        `IF NOT EXISTS (SELECT 1 FROM account_types WITH (UPDLOCK, HOLDLOCK)
                         WHERE org_id = @org AND code = @code)
           INSERT INTO account_types (id, org_id, code, name)
           VALUES (@id, @org, @code, @name);`,
        { id: newId(), org, code: t.code, name: t.name },
      );
    }
    const types = await all('SELECT id, code FROM account_types WHERE org_id = @org', { org });
    const typeId = Object.fromEntries(types.map((t) => [t.code, t.id]));

    // Accounts, parents-before-children (the seed is already ordered so). A map
    // of account_number -> id, filled as we go, resolves each parent.
    const existing = await all('SELECT id, account_number FROM accounts WHERE org_id = @org', { org });
    const idByNumber = Object.fromEntries(existing.map((a) => [a.account_number, a.id]));

    for (const row of ACCOUNTS_SEED) {
      if (idByNumber[row.number]) continue; // already there
      const id = newId();
      const parentId = row.parent_number ? idByNumber[row.parent_number] ?? null : null;
      await run(
        `INSERT INTO accounts
           (id, org_id, account_number, name, parent_account_id, account_type_id,
            is_posting, is_active, statement_section)
         VALUES (@id, @org, @number, @name, @parent, @type, @posting, 1, @section)`,
        {
          id,
          org,
          number: row.number,
          name: row.name,
          parent: parentId,
          type: typeId[row.type_code] ?? typeId.GENERAL ?? null,
          posting: row.is_posting ? 1 : 0,
          section: row.statement_section || null,
        },
      );
      idByNumber[row.number] = id;
    }
  });
}

/** Seed the chart the first time a file's accounts are touched, and only then. */
export async function ensureAccountsSeeded() {
  const { n } = await get('SELECT COUNT(*) AS n FROM accounts WHERE org_id = @org', { org: orgId() });
  if (n === 0) await seedAccounts();
}

/**
 * A posting leaf under `parentId`, named `name` — created if it does not exist,
 * returned if it does. Its number extends the parent's (1601 → 1601001, …) and
 * it inherits the parent's type. Used to give each customer/supplier its own
 * receivable/payable account.
 */
export async function ensureChildAccount({ parentId, name }) {
  const org = orgId();
  const trimmed = String(name || '').trim();
  const existing = await get(
    'SELECT id FROM accounts WHERE org_id = @org AND parent_account_id = @parent AND name = @name',
    { org, parent: parentId, name: trimmed },
  );
  if (existing) return existing.id;

  const parent = await get(
    'SELECT account_number, account_type_id FROM accounts WHERE id = @id AND org_id = @org',
    { id: parentId, org },
  );
  if (!parent) throw badRequest('الحساب الأب غير موجود', 'PARENT_NOT_FOUND');

  // Next free number that extends the parent's, e.g. 1601 → 1601001.
  const kids = await all(
    'SELECT account_number FROM accounts WHERE org_id = @org AND parent_account_id = @parent',
    { org, parent: parentId },
  );
  const base = parent.account_number;
  let maxSuffix = 0;
  for (const k of kids) {
    const suffix = Number(String(k.account_number).slice(base.length));
    if (Number.isFinite(suffix) && suffix > maxSuffix) maxSuffix = suffix;
  }
  const number = `${base}${String(maxSuffix + 1).padStart(3, '0')}`;
  const id = newId();
  await run(
    `INSERT INTO accounts
       (id, org_id, account_number, name, parent_account_id, account_type_id, is_posting, is_active)
     VALUES (@id, @org, @number, @name, @parent, @type, 1, 1)`,
    { id, org, number, name: trimmed, parent: parentId, type: parent.account_type_id ?? null },
  );
  return id;
}

/**
 * Map the standard chart's well-known accounts into settings, once per file, so
 * a new file's invoices and vouchers post correctly with no manual setup. Only
 * fills a setting that is still empty — a value the manager set is never
 * overwritten — and matches by the seed's fixed account numbers, with a name
 * fallback for a hand-edited chart. Safe to run repeatedly.
 */
export async function autoConfigureAccounting() {
  await ensureAccountsSeeded();
  const org = orgId();
  const accounts = await all(
    `SELECT a.id, a.account_number, a.name, a.is_posting, t.code AS type_code
       FROM accounts a
       LEFT JOIN account_types t ON t.id = a.account_type_id AND t.org_id = a.org_id
      WHERE a.org_id = @org`,
    { org },
  );
  const byNumber = (num) => accounts.find((a) => a.account_number === num);
  const byName = (pred) => accounts.find((a) => pred(a.name.trim(), a));
  const posting = (a) => a && a.is_posting;

  const cash = byNumber('1801001')
    || byName((n, a) => posting(a) && n.includes('صندوق') && (n.includes('شيق') || n.includes('شيكل')))
    || accounts.find((a) => posting(a) && (a.type_code === 'CASH'));
  const sales = byNumber('41101') || byName((n, a) => posting(a) && n === 'المبيعات');
  const purchase = byNumber('31101') || byName((n, a) => posting(a) && n === 'المشتريات');
  const customersParent = byNumber('1601') || byName((n, a) => !a.is_posting && n.includes('العملاء'));
  const suppliersParent = byNumber('261') || byName((n, a) => !a.is_posting && (n.includes('موردون') || n.includes('الموردون')));

  const current = await getSettings();
  const patch = {};
  const fill = (key, acc) => { if (acc && !current[key]) patch[key] = acc.id; };
  fill('invoice_cash_account', cash);
  fill('invoice_sales_account', sales);
  fill('invoice_purchase_account', purchase);
  fill('invoice_customers_parent', customersParent);
  fill('invoice_suppliers_parent', suppliersParent);
  fill('voucher_receipt_cash_account', cash);
  fill('voucher_payment_cash_account', cash);
  if (Object.keys(patch).length) await setSettings(patch);
  return patch;
}

/* ------------------------------------------------------------------ listing */
export async function listAccountTypes() {
  return all('SELECT id, code, name FROM account_types WHERE org_id = @org ORDER BY name',
    { org: orgId() });
}

/**
 * Every account, flat, with its type code and a child count (so the UI can show
 * expand affordances and enforce "no delete with children" without a second
 * query). The client assembles the tree — 93-ish rows is nothing to send whole,
 * and it keeps search/expand instant with no round-trips.
 */
export async function listAccounts({ search, activeOnly } = {}) {
  const params = { org: orgId() };
  let where = 'a.org_id = @org';
  if (activeOnly) where += ' AND a.is_active = 1';
  if (search && search.trim()) {
    params.q = `%${search.trim()}%`;
    where += ' AND (a.account_number LIKE @q OR a.name LIKE @q)';
  }
  const rows = await all(
    `SELECT a.id, a.account_number, a.name, a.parent_account_id, a.account_type_id,
            a.is_posting, a.is_active, a.statement_section, a.description,
            t.code AS type_code, t.name AS type_name,
            (SELECT COUNT(*) FROM accounts c WHERE c.parent_account_id = a.id) AS child_count
       FROM accounts a
       LEFT JOIN account_types t ON t.id = a.account_type_id AND t.org_id = a.org_id
      WHERE ${where}
      ORDER BY a.account_number`,
    params,
  );
  return rows.map((r) => ({
    ...publicRow(r),
    is_posting: !!r.is_posting,
    is_active: !!r.is_active,
    child_count: r.child_count,
  }));
}

/**
 * The ledger balance of an account, rolled up over its whole subtree.
 *
 * A posting account's balance is SUM(debit) - SUM(credit) over its own rows; a
 * group's is the same sum over every account beneath it, so the tree totals the
 * way a reader expects (the file's root asset account shows the sum of all
 * assets). The recursive CTE walks the subtree once, org-scoped at every hop.
 *
 * Debit-positive by convention: a positive balance is a debit balance (assets,
 * expenses, cash on hand), a negative one a credit balance (liabilities,
 * revenue, a customer in credit). The UI labels the side; this returns the
 * signed net plus the two column totals so a summary can show both.
 */
export async function accountBalance(id) {
  const row = await get(
    `WITH subtree AS (
        SELECT id FROM accounts WHERE id = @id AND org_id = @org
        UNION ALL
        SELECT c.id FROM accounts c
          JOIN subtree s ON c.parent_account_id = s.id
         WHERE c.org_id = @org
     )
     SELECT COALESCE(SUM(t.debit), 0) AS debit_total,
            COALESCE(SUM(t.credit), 0) AS credit_total
       FROM transactions t
      WHERE t.org_id = @org AND t.account_id IN (SELECT id FROM subtree)`,
    { id, org: orgId() },
  );
  const debit = row?.debit_total ?? 0;
  const credit = row?.credit_total ?? 0;
  return { debit_total: money(debit), credit_total: money(credit), balance: money(debit - credit) };
}

/**
 * A statement (كشف حساب) for one account over a date range: the opening balance
 * carried in from before the range, every ledger line inside it with a running
 * balance, and the closing balance and column totals.
 *
 * Rolled up over the subtree, same as `accountBalance`, so a group's statement
 * shows every movement beneath it. Voucher lines are labelled with the voucher
 * number so a reader can trace each entry back to its document. The running
 * balance is computed here rather than with a window function so the rounding
 * matches `money()` exactly at every step.
 */
export async function accountStatement(id, { dateFrom, dateTo } = {}) {
  const org = orgId();
  const account = await getAccount(id); // 404s if missing; carries the balance too

  const SUBTREE = `WITH subtree AS (
      SELECT id FROM accounts WHERE id = @id AND org_id = @org
      UNION ALL
      SELECT c.id FROM accounts c
        JOIN subtree s ON c.parent_account_id = s.id
       WHERE c.org_id = @org
     )`;

  // What the account already stood at the moment the range opened.
  let opening = 0;
  if (dateFrom) {
    const o = await get(
      `${SUBTREE}
       SELECT COALESCE(SUM(t.debit), 0) AS d, COALESCE(SUM(t.credit), 0) AS c
         FROM transactions t
        WHERE t.org_id = @org AND t.entry_date < @from
          AND t.account_id IN (SELECT id FROM subtree)`,
      { id, org, from: dateFrom },
    );
    opening = money(o.d - o.c);
  }

  const params = { id, org };
  let range = 't.org_id = @org AND t.account_id IN (SELECT id FROM subtree)';
  if (dateFrom) { params.from = dateFrom; range += ' AND t.entry_date >= @from'; }
  if (dateTo) { params.to = dateTo; range += ' AND t.entry_date <= @to'; }

  const rows = await all(
    `${SUBTREE}
     SELECT t.id, t.entry_date, t.debit, t.credit, t.description,
            t.source_type, t.source_id,
            a.account_number, a.name AS account_name,
            v.number AS voucher_number, v.type AS voucher_type
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.org_id = t.org_id
       LEFT JOIN vouchers v ON v.id = t.source_id AND v.org_id = t.org_id
                           AND t.source_type = 'VOUCHER'
      WHERE ${range}
      ORDER BY t.entry_date, t.seq`,
    params,
  );

  let running = opening;
  const lines = rows.map((r) => {
    running = money(running + r.debit - r.credit);
    return {
      id: r.id,
      entry_date: r.entry_date,
      account_number: r.account_number,
      account_name: r.account_name,
      description: r.description,
      source_type: r.source_type,
      source_id: r.source_id,
      voucher_number: r.voucher_number,
      voucher_type: r.voucher_type,
      debit: money(r.debit),
      credit: money(r.credit),
      running_balance: running,
    };
  });
  const totalDebit = money(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = money(rows.reduce((s, r) => s + r.credit, 0));

  return {
    account: {
      id: account.id,
      account_number: account.account_number,
      name: account.name,
      is_posting: account.is_posting,
      type_name: account.type_name,
    },
    date_from: dateFrom ?? null,
    date_to: dateTo ?? null,
    opening_balance: opening,
    closing_balance: money(opening + totalDebit - totalCredit),
    total_debit: totalDebit,
    total_credit: totalCredit,
    lines,
  };
}

/** One account, or 404 — with its rolled-up ledger balance. */
export async function getAccount(id) {
  const row = await get(
    `SELECT a.*, t.code AS type_code, t.name AS type_name,
            (SELECT COUNT(*) FROM accounts c WHERE c.parent_account_id = a.id) AS child_count
       FROM accounts a
       LEFT JOIN account_types t ON t.id = a.account_type_id AND t.org_id = a.org_id
      WHERE a.id = @id AND a.org_id = @org`,
    { id, org: orgId() },
  );
  if (!row) throw notFound('الحساب غير موجود', 'ACCOUNT_NOT_FOUND');
  const balance = await accountBalance(id);
  return {
    ...publicRow(row), is_posting: !!row.is_posting, is_active: !!row.is_active, ...balance,
  };
}

/* ------------------------------------------------------------------ writing */
async function assertNoCycle(id, parentId) {
  // Walk up from the proposed parent; if we meet this account, it would loop.
  let cursor = parentId;
  const seen = new Set([id]);
  while (cursor) {
    if (seen.has(cursor)) throw badRequest('لا يمكن أن يصبح الحساب أباً لنفسه', 'ACCOUNT_CYCLE');
    seen.add(cursor);
    const row = await get('SELECT parent_account_id FROM accounts WHERE id = @id AND org_id = @org',
      { id: cursor, org: orgId() });
    cursor = row?.parent_account_id ?? null;
  }
}

async function resolveParent(parentId) {
  if (!parentId) return null;
  const parent = await get('SELECT id FROM accounts WHERE id = @id AND org_id = @org',
    { id: parentId, org: orgId() });
  if (!parent) throw badRequest('الحساب الأب غير موجود', 'PARENT_NOT_FOUND');
  return parent.id;
}

export async function createAccount(data, userId) {
  const org = orgId();
  const number = String(data.account_number ?? '').trim();
  const name = String(data.name ?? '').trim();
  if (!number) throw badRequest('رقم الحساب مطلوب', 'NUMBER_REQUIRED');
  if (!name) throw badRequest('اسم الحساب مطلوب', 'NAME_REQUIRED');

  const dupe = await get(
    'SELECT id FROM accounts WHERE org_id = @org AND account_number = @number',
    { org, number },
  );
  if (dupe) throw conflict('رقم الحساب مستخدم بالفعل', 'NUMBER_TAKEN');

  const parentId = await resolveParent(data.parent_account_id);
  const id = newId();
  await run(
    `INSERT INTO accounts
       (id, org_id, account_number, name, parent_account_id, account_type_id,
        is_posting, is_active, statement_section, description, created_by)
     VALUES (@id, @org, @number, @name, @parent, @type,
             @posting, 1, @section, @description, @by)`,
    {
      id,
      org,
      number,
      name,
      parent: parentId,
      type: data.account_type_id ?? null,
      posting: data.is_posting ? 1 : 0,
      section: data.statement_section ?? null,
      description: data.description ?? null,
      by: userId ?? null,
    },
  );
  return getAccount(id);
}

export async function updateAccount(id, data, userId) {
  const org = orgId();
  const current = await getAccount(id); // 404s if missing

  if (data.account_number !== undefined) {
    const number = String(data.account_number).trim();
    if (!number) throw badRequest('رقم الحساب مطلوب', 'NUMBER_REQUIRED');
    const dupe = await get(
      'SELECT id FROM accounts WHERE org_id = @org AND account_number = @number AND id <> @id',
      { org, number, id },
    );
    if (dupe) throw conflict('رقم الحساب مستخدم بالفعل', 'NUMBER_TAKEN');
  }

  let parentId = current.parent_account_id;
  if (data.parent_account_id !== undefined) {
    parentId = await resolveParent(data.parent_account_id);
    if (parentId === id) throw badRequest('لا يمكن أن يصبح الحساب أباً لنفسه', 'ACCOUNT_CYCLE');
    await assertNoCycle(id, parentId);
  }

  await run(
    `UPDATE accounts SET
       account_number   = COALESCE(@number, account_number),
       name             = COALESCE(@name, name),
       parent_account_id = @parent,
       account_type_id  = COALESCE(@type, account_type_id),
       is_posting       = COALESCE(@posting, is_posting),
       statement_section = COALESCE(@section, statement_section),
       description      = COALESCE(@description, description),
       updated_at = @now, updated_by = @by
     WHERE id = @id AND org_id = @org`,
    {
      id,
      org,
      number: data.account_number !== undefined ? String(data.account_number).trim() : null,
      name: data.name !== undefined ? String(data.name).trim() : null,
      parent: parentId,
      type: data.account_type_id ?? null,
      posting: data.is_posting === undefined ? null : (data.is_posting ? 1 : 0),
      section: data.statement_section ?? null,
      description: data.description ?? null,
      now: nowIso(),
      by: userId ?? null,
    },
  );
  return getAccount(id);
}

export async function setAccountActive(id, active, userId) {
  await getAccount(id);
  await run(
    'UPDATE accounts SET is_active = @a, updated_at = @now, updated_by = @by WHERE id = @id AND org_id = @org',
    { id, org: orgId(), a: active ? 1 : 0, now: nowIso(), by: userId ?? null },
  );
  return getAccount(id);
}

/**
 * Delete only when it is genuinely safe: no children, and (once vouchers exist)
 * no transactions. Anything with history is deactivated instead — enforced here,
 * not just in the UI.
 */
export async function deleteAccount(id) {
  const org = orgId();
  await getAccount(id);
  const { n: children } = await get(
    'SELECT COUNT(*) AS n FROM accounts WHERE org_id = @org AND parent_account_id = @id',
    { org, id },
  );
  if (children > 0) {
    throw conflict('لا يمكن حذف حساب له حسابات فرعية — عطّله بدلاً من ذلك', 'HAS_CHILDREN');
  }
  // An account that has moved money is part of the record and cannot be erased —
  // deactivate it instead. This is the one place that owns "is it safe to
  // delete", so both guards live together.
  const { n: entries } = await get(
    'SELECT COUNT(*) AS n FROM transactions WHERE org_id = @org AND account_id = @id',
    { org, id },
  );
  if (entries > 0) {
    throw conflict('لا يمكن حذف حساب له حركات مالية — عطّله بدلاً من ذلك', 'HAS_TRANSACTIONS');
  }
  await run('DELETE FROM accounts WHERE id = @id AND org_id = @org', { id, org });
  return { id };
}
