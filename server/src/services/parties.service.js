import { all, get, run, newId, nowIso, orgId, publicRow } from '../db/index.js';
import { notFound } from '../lib/errors.js';

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

export async function listParties(kind, { search, is_active, page, limit }) {
  const { table } = cfg(kind);
  const where = ['org_id = @org'];
  const params = { org: orgId() };
  if (search) {
    params.q = `%${search}%`;
    where.push('(name LIKE @q OR phone LIKE @q OR email LIKE @q)');
  }
  if (is_active !== undefined && is_active !== null) {
    params.active = is_active ? 1 : 0;
    where.push('is_active = @active');
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const { n: total } = await get(`SELECT COUNT(*) n FROM ${table} ${clause}`, params);
  const rows = await all(
    `SELECT * FROM ${table} ${clause} ORDER BY name OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    { ...params, limit, offset: (page - 1) * limit },
  );

  return { rows: rows.map(withFlags), total };
}

const withFlags = (r) => r && { ...publicRow(r), is_active: !!r.is_active };

export async function getParty(kind, id, { withDetail = false } = {}) {
  const { table, label } = cfg(kind);
  const row = await get(`SELECT * FROM ${table} WHERE id = @id AND org_id = @org`, { id, org: orgId() });
  if (!row) throw notFound(`${label} غير موجود`, 'PARTY_NOT_FOUND');
  const party = withFlags(row);

  if (withDetail) {
    const col = kind === 'customers' ? 'customer_id' : 'supplier_id';
    // A draft is not a finished invoice — excluded from this party's count,
    // total, and recent-invoices history the same way it's excluded from the
    // main invoice list (see listInvoices).
    party.stats = await get(
      `SELECT COUNT(*) AS invoice_count,
              COALESCE(SUM(CASE WHEN status='POSTED' THEN
                (SELECT COALESCE(SUM(l.quantity * l.unit_price),0) FROM invoice_lines l WHERE l.invoice_id = v.id)
                - v.discount_total + v.tax_total END), 0) AS total_value,
              MAX(CASE WHEN status='POSTED' THEN invoice_date END) AS last_invoice_date
         FROM invoices v WHERE v.${col} = @id AND v.org_id = @org AND v.status <> 'DRAFT'`, { id, org: orgId() });
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
