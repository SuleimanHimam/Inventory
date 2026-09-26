import { all, get, run, newId, nowIso, orgId, publicRow, getSettings } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { ensureChildAccount } from './accounts.service.js';

/**
 * Customers and suppliers are structurally identical apart from one extra
 * column, so a single parameterised implementation serves both resources.
 */
const CONFIG = {
  customers: {
    table: 'customers',
    columns: ['name', 'phone', 'email', 'address', 'tax_number', 'notes'],
    label: 'العميل',
  },
  suppliers: {
    table: 'suppliers',
    columns: ['name', 'contact_person', 'phone', 'email', 'address', 'tax_number', 'notes'],
    label: 'المورد',
  },
};

const cfg = (kind) => CONFIG[kind];

/**
 * The walk-in default party each kind always has: a cash customer on a sale, a
 * cash supplier on a purchase. Created once per file (idempotent on the name),
 * so a new sale/purchase can default its party without the operator first
 * having to add one. Seeded lazily on the first parties read, the same
 * ensure-on-first-use pattern the chart of accounts uses.
 */
const DEFAULT_PARTY_NAME = { customers: 'عميل نقدي', suppliers: 'مورد نقدي' };

export async function ensureDefaultParty(kind) {
  const { table } = cfg(kind);
  const name = DEFAULT_PARTY_NAME[kind];
  if (!name) return;
  await run(
    `IF NOT EXISTS (SELECT 1 FROM ${table} WITH (UPDLOCK, HOLDLOCK)
                     WHERE org_id = @org AND name = @name)
       INSERT INTO ${table} (id, org_id, name) VALUES (@id, @org, @name);`,
    { id: newId(), org: orgId(), name },
  );
  // Link the walk-in party to its own account (عميل نقدي → the عميل نقدي
  // account, مورد نقدي → the existing مورد نقدي account) so it is tied from the
  // start, not only after its first invoice. Cheap: skips once linked.
  const row = await get(`SELECT id, account_id FROM ${table} WHERE org_id = @org AND name = @name`,
    { org: orgId(), name });
  if (row && !row.account_id) await getPartyAccountId(kind, row.id).catch(() => {});
}

/**
 * The party's own ledger account, created on demand under the configured parent
 * (العملاء / موردون) and linked back to the party. Returns null when no parent
 * is configured — a credit invoice then falls back to the cash account. This is
 * what makes "post to the customer's account" mean the customer's own leaf.
 */
export async function getPartyAccountId(kind, partyId) {
  if (!partyId) return null;
  const { table } = cfg(kind);
  const org = orgId();
  const party = await get(`SELECT id, name, account_id FROM ${table} WHERE id = @id AND org_id = @org`,
    { id: partyId, org });
  if (!party) return null;
  if (party.account_id) return party.account_id;

  const settings = await getSettings();
  const parentId = kind === 'customers'
    ? settings.invoice_customers_parent
    : settings.invoice_suppliers_parent;
  if (!parentId) return null;

  const accountId = await ensureChildAccount({ parentId, name: party.name });
  await run(`UPDATE ${table} SET account_id = @acc WHERE id = @id AND org_id = @org`,
    { acc: accountId, id: partyId, org });
  return accountId;
}

export async function listParties(kind, { search, is_active, page, limit }) {
  const { table } = cfg(kind);
  await ensureDefaultParty(kind);
  const where = ['p.org_id = @org'];
  const params = { org: orgId() };
  if (search) {
    params.q = `%${search}%`;
    where.push('(p.name LIKE @q OR p.phone LIKE @q OR p.email LIKE @q)');
  }
  if (is_active !== undefined && is_active !== null) {
    params.active = is_active ? 1 : 0;
    where.push('p.is_active = @active');
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const { n: total } = await get(`SELECT COUNT(*) n FROM ${table} p ${clause}`,
    { ...params });
  const rows = await all(
    `SELECT p.*, a.account_number, a.name AS account_name
       FROM ${table} p
       LEFT JOIN accounts a ON a.id = p.account_id AND a.org_id = p.org_id
       ${clause}
      ORDER BY p.name OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    { ...params, limit, offset: (page - 1) * limit },
  );

  return { rows: rows.map(withFlags), total };
}

const withFlags = (r) => r && { ...publicRow(r), is_active: !!r.is_active };

export async function getParty(kind, id, { withDetail = false } = {}) {
  const { table, label } = cfg(kind);
  const row = await get(
    `SELECT p.*, a.account_number, a.name AS account_name
       FROM ${table} p
       LEFT JOIN accounts a ON a.id = p.account_id AND a.org_id = p.org_id
      WHERE p.id = @id AND p.org_id = @org`,
    { id, org: orgId() },
  );
  if (!row) throw notFound(`${label} غير موجود`, 'PARTY_NOT_FOUND');
  const party = withFlags(row);

  if (withDetail) {
    const col = kind === 'customers' ? 'customer_id' : 'supplier_id';
    // A draft is not a finished invoice — excluded from this party's count,
    // total, and recent-invoices history the same way it's excluded from the
    // main invoice list (see listInvoices).
    // The per-invoice total is a subquery, so it is computed in a derived table
    // first — SQL Server refuses SUM() over an expression that itself contains a
    // subquery/aggregate (error 130), which the previous inline form hit.
    party.stats = await get(
      `SELECT COUNT(*) AS invoice_count,
              COALESCE(SUM(CASE WHEN status = 'POSTED' THEN total END), 0) AS total_value,
              MAX(CASE WHEN status = 'POSTED' THEN invoice_date END) AS last_invoice_date
         FROM (
           SELECT v.status, v.invoice_date,
                  (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0)
                     FROM invoice_lines l WHERE l.invoice_id = v.id)
                  - v.discount_total + v.tax_total AS total
             FROM invoices v
            WHERE v.${col} = @id AND v.org_id = @org AND v.status <> 'DRAFT'
         ) t`, { id, org: orgId() });
    party.recent_invoices = await all(
      `SELECT TOP 10 v.id, v.number, v.type, v.status, v.invoice_date,
              (SELECT COALESCE(SUM(l.quantity * l.unit_price),0) FROM invoice_lines l WHERE l.invoice_id = v.id)
                - v.discount_total + v.tax_total AS total
         FROM invoices v WHERE v.${col} = @id AND v.org_id = @org AND v.status <> 'DRAFT'
        ORDER BY v.invoice_date DESC, v.created_at DESC`, { id, org: orgId() });
  }
  return party;
}

export async function createParty(kind, input) {
  const { table, columns } = cfg(kind);
  const id = newId();
  const now = nowIso();
  const values = { id, org: orgId(), created_at: now, updated_at: now };
  for (const c of columns) values[c] = input[c]?.toString().trim() || null;
  values.name = input.name.trim();

  const cols = ['id', ...columns, 'created_at', 'updated_at'];
  await run(
    `INSERT INTO ${table} (${cols.join(', ')}, org_id)
     VALUES (${cols.map((c) => `@${c}`).join(', ')}, @org)`, values);
  // Give the new party its own account in the chart at once, so it shows up in
  // دليل الحسابات immediately — not only on its first credit invoice.
  await getPartyAccountId(kind, id).catch(() => {});
  return getParty(kind, id);
}

export async function updateParty(kind, id, patch) {
  const { table, columns } = cfg(kind);
  await getParty(kind, id);
  const fields = [];
  const params = { id, org: orgId(), updated_at: nowIso() };
  for (const c of [...columns, 'is_active']) {
    if (patch[c] === undefined) continue;
    fields.push(`${c} = @${c}`);
    params[c] = c === 'is_active' ? (patch[c] ? 1 : 0)
      : (patch[c]?.toString().trim() || null);
  }
  if (fields.length) {
    await run(
      `UPDATE ${table} SET ${fields.join(', ')}, updated_at = @updated_at
        WHERE id = @id AND org_id = @org`, params);
  }
  return getParty(kind, id);
}

/** Archive rather than hard-delete, preserving links from historical invoices. */
export async function archiveParty(kind, id) {
  const { table } = cfg(kind);
  await getParty(kind, id);
  await run(`UPDATE ${table} SET is_active = 0, updated_at = @updated_at WHERE id = @id AND org_id = @org`,
    { updated_at: nowIso(), id, org: orgId() });
  return getParty(kind, id);
}

export async function restoreParty(kind, id) {
  const { table } = cfg(kind);
  await getParty(kind, id);
  await run(`UPDATE ${table} SET is_active = 1, updated_at = @updated_at WHERE id = @id AND org_id = @org`,
    { updated_at: nowIso(), id, org: orgId() });
  return getParty(kind, id);
}

/** Warn (never block) on an exact name match, per the duplicate-name rule. */
export async function findDuplicateName(kind, name, excludeId) {
  const { table } = cfg(kind);
  return await get(
    `SELECT id, name FROM ${table}
      WHERE name = @name AND id IS DISTINCT FROM @exclude AND org_id = @org`,
    { name: String(name ?? '').trim(), exclude: excludeId ?? null, org: orgId() },
  ) ?? null;
}
