/**
 * Roles and per-screen permissions.
 *
 * A role is a named set of permissions, one row per screen with the core
 * actions (view/add/edit/delete) and a see-prices flag. Three roles are built
 * in — OWNER (مدير), MEMBER (موظف), CLERK (موظف مبيع) — seeded per org to match
 * the behaviour the app has always had, so nothing changes until a manager adds
 * or edits a role. A member's `memberships.role_id` points at the role they
 * have; when it is NULL the fixed `memberships.role` string is used instead,
 * which is what keeps existing accounts working before any role is assigned.
 *
 * This module owns the schema seeded by 014_role_permissions.sql. All queries
 * are org-scoped through the ambient context, and — per the project rule — run
 * sequentially, never Promise.all over the shared transaction connection.
 */
import { all, get, run, newId, nowIso, orgId } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/** The screens a permission grid has a row for, in display order. */
export const RESOURCES = [
  { key: 'items', label: 'الأصناف' },
  { key: 'categories', label: 'التصنيفات' },
  { key: 'invoices_sale', label: 'فواتير المبيع' },
  { key: 'invoices_purchase', label: 'فواتير الشراء' },
  { key: 'customers', label: 'العملاء' },
  { key: 'suppliers', label: 'الموردون' },
  { key: 'accounts', label: 'دليل الحسابات' },
  { key: 'vouchers', label: 'السندات' },
  { key: 'expenses', label: 'المصروفات' },
  { key: 'reports', label: 'التقارير ولوحة المعلومات' },
  { key: 'movements', label: 'حركات المخزون' },
  { key: 'stock_counts', label: 'الجرد' },
  { key: 'users', label: 'المستخدمون' },
  { key: 'settings', label: 'الإعدادات' },
  { key: 'files', label: 'الملفات' },
];
export const RESOURCE_KEYS = RESOURCES.map((r) => r.key);

/** The columns of one permission row. */
export const ACTIONS = ['view', 'add', 'edit', 'delete', 'see_prices'];

const ALL = { view: true, add: true, edit: true, delete: true, see_prices: true };
const NONE = { view: false, add: false, edit: false, delete: false, see_prices: false };
const rw = (see_prices = false) => ({ view: true, add: true, edit: true, delete: true, see_prices });
const viewOnly = (see_prices = false) => ({ view: true, add: false, edit: false, delete: false, see_prices });

/**
 * The built-in roles, and what each may do per screen — set to mirror exactly
 * what the app enforced before roles existed (see lib/roles.js): a manager sees
 * everything; a member does the daily work but never sees a price; a clerk only
 * enters sale invoices and reads the sale price there.
 */
export const BUILTINS = [
  { key: 'OWNER', name: 'مدير' },
  { key: 'MEMBER', name: 'موظف' },
  { key: 'CLERK', name: 'موظف مبيع' },
];

function defaultPermissions(builtinKey) {
  const map = {};
  for (const k of RESOURCE_KEYS) map[k] = { ...NONE };

  if (builtinKey === 'OWNER') {
    for (const k of RESOURCE_KEYS) map[k] = { ...ALL };
    return map;
  }

  if (builtinKey === 'MEMBER') {
    // Daily work, no prices anywhere, no manager-only screens.
    for (const k of ['items', 'categories', 'invoices_sale', 'invoices_purchase',
      'customers', 'suppliers', 'stock_counts']) map[k] = rw(false);
    map.movements = viewOnly(false);
    map.reports = viewOnly(false);
    return map;
  }

  if (builtinKey === 'CLERK') {
    // One screen: enter sale invoices via item search, sees the sale price.
    map.items = viewOnly(true);
    map.invoices_sale = { view: true, add: true, edit: true, delete: false, see_prices: true };
    return map;
  }

  return map;
}

/**
 * Seed the three built-in roles and their permissions for the current org, once.
 * Idempotent on (org_id, builtin_key), so it doubles as a lazy backfill for a
 * file that predates roles — the same ensure-on-first-use the chart uses.
 */
export async function ensureRoles() {
  const org = orgId();
  for (const b of BUILTINS) {
    let role = await get(
      'SELECT id FROM roles WHERE org_id = @org AND builtin_key = @key',
      { org, key: b.key },
    );
    if (!role) {
      const id = newId();
      await run(
        `INSERT INTO roles (id, org_id, name, is_builtin, builtin_key)
         VALUES (@id, @org, @name, 1, @key)`,
        { id, org, name: b.name, key: b.key },
      );
      role = { id };
      await writePermissions(role.id, defaultPermissions(b.key));
    }
  }
}

/** Replace a role's permission rows with the given map (resource -> actions). */
async function writePermissions(roleId, map) {
  const org = orgId();
  await run('DELETE FROM role_permissions WHERE role_id = @role AND org_id = @org',
    { role: roleId, org });
  for (const key of RESOURCE_KEYS) {
    const p = map[key] ?? NONE;
    await run(
      `INSERT INTO role_permissions
         (id, org_id, role_id, resource, can_view, can_add, can_edit, can_delete, can_see_prices)
       VALUES (@id, @org, @role, @res, @v, @a, @e, @d, @s)`,
      {
        id: newId(), org, role: roleId, res: key,
        v: p.view ? 1 : 0, a: p.add ? 1 : 0, e: p.edit ? 1 : 0,
        d: p.delete ? 1 : 0, s: p.see_prices ? 1 : 0,
      },
    );
  }
}

/** A role's permissions as a map { resource: {view,add,edit,delete,see_prices} }. */
async function permissionsOf(roleId) {
  const rows = await all(
    `SELECT resource, can_view, can_add, can_edit, can_delete, can_see_prices
       FROM role_permissions WHERE role_id = @role AND org_id = @org`,
    { role: roleId, org: orgId() },
  );
  const map = {};
  for (const k of RESOURCE_KEYS) map[k] = { ...NONE };
  for (const r of rows) {
    map[r.resource] = {
      view: !!r.can_view,
      add: !!r.can_add,
      edit: !!r.can_edit,
      delete: !!r.can_delete,
      see_prices: !!r.can_see_prices,
    };
  }
  return map;
}

/**
 * The effective permission map for a member — from their assigned role when one
 * is set, otherwise from the built-in defaults for their fixed role string. Used
 * by /me (for the UI) and, later, by the route guards.
 */
export async function effectivePermissions({ role, roleId }) {
  await ensureRoles();
  if (roleId) {
    const found = await get('SELECT id FROM roles WHERE id = @id AND org_id = @org',
      { id: roleId, org: orgId() });
    if (found) return permissionsOf(roleId);
  }
  // Fall back to the built-in role's seeded permissions (read from the DB so a
  // manager's edits to a built-in role are honoured too).
  const builtin = await get(
    'SELECT id FROM roles WHERE org_id = @org AND builtin_key = @key',
    { org: orgId(), key: role },
  );
  if (builtin) return permissionsOf(builtin.id);
  return defaultPermissions(role);
}

/* --------------------------------------------------------------- management */

/** Every role with its permission map — for the role editor. */
export async function listRoles() {
  await ensureRoles();
  const roles = await all(
    'SELECT id, name, is_builtin, builtin_key FROM roles WHERE org_id = @org ORDER BY is_builtin DESC, name',
    { org: orgId() },
  );
  const out = [];
  for (const r of roles) {
    // Sequential, not Promise.all — shared transaction connection.
    const permissions = await permissionsOf(r.id); // eslint-disable-line no-await-in-loop
    out.push({ id: r.id, name: r.name, is_builtin: !!r.is_builtin, builtin_key: r.builtin_key, permissions });
  }
  return out;
}

export async function createRole({ name, permissions }) {
  await ensureRoles();
  const org = orgId();
  const trimmed = String(name || '').trim();
  if (!trimmed) throw badRequest('اسم الدور مطلوب', 'ROLE_NAME_REQUIRED');
  const dupe = await get('SELECT id FROM roles WHERE org_id = @org AND name = @name', { org, name: trimmed });
  if (dupe) throw conflict('اسم الدور مستخدم بالفعل', 'ROLE_NAME_TAKEN');
  const id = newId();
  await run('INSERT INTO roles (id, org_id, name, is_builtin) VALUES (@id, @org, @name, 0)',
    { id, org, name: trimmed });
  await writePermissions(id, permissions ?? {});
  return getRole(id);
}

export async function getRole(id) {
  const role = await get(
    'SELECT id, name, is_builtin, builtin_key FROM roles WHERE id = @id AND org_id = @org',
    { id, org: orgId() },
  );
  if (!role) throw notFound('الدور غير موجود', 'ROLE_NOT_FOUND');
  return { id: role.id, name: role.name, is_builtin: !!role.is_builtin, builtin_key: role.builtin_key, permissions: await permissionsOf(id) };
}

export async function updateRole(id, { name, permissions }) {
  const role = await getRole(id);
  const org = orgId();
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) throw badRequest('اسم الدور مطلوب', 'ROLE_NAME_REQUIRED');
    // A built-in role keeps its name (it is referenced by key); only its
    // permissions may be tuned.
    if (!role.is_builtin) {
      const dupe = await get('SELECT id FROM roles WHERE org_id = @org AND name = @name AND id <> @id',
        { org, name: trimmed, id });
      if (dupe) throw conflict('اسم الدور مستخدم بالفعل', 'ROLE_NAME_TAKEN');
      await run('UPDATE roles SET name = @name, updated_at = @now WHERE id = @id AND org_id = @org',
        { name: trimmed, now: nowIso(), id, org });
    }
  }
  if (permissions) await writePermissions(id, permissions);
  return getRole(id);
}

export async function deleteRole(id) {
  const role = await getRole(id);
  const org = orgId();
  if (role.is_builtin) throw conflict('لا يمكن حذف دور مدمج', 'ROLE_BUILTIN');
  const { n } = await get('SELECT COUNT(*) n FROM memberships WHERE role_id = @id AND org_id = @org',
    { id, org });
  if (n > 0) throw conflict('لا يمكن حذف دور مُسنَد إلى مستخدمين', 'ROLE_IN_USE');
  await run('DELETE FROM roles WHERE id = @id AND org_id = @org', { id, org });
  return { id };
}
