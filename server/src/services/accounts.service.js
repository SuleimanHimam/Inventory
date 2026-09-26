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
  all, get, run, newId, orgId, nowIso, tx, publicRow,
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

/** One account, or 404. */
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
  return { ...publicRow(row), is_posting: !!row.is_posting, is_active: !!row.is_active };
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
  // Transactions/vouchers guard is added with those tables in the next phase;
  // the check lives here so there is one place that owns "is it safe to delete".
  await run('DELETE FROM accounts WHERE id = @id AND org_id = @org', { id, org });
  return { id };
}
