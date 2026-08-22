import { all, get, run, newId, nowIso, orgId } from '../db/index.js';
import { notFound, conflict, guard } from '../lib/errors.js';

export function listCategories() {
  return all(
    `SELECT c.id, c.name, c.created_at,
            (SELECT COUNT(*) FROM items i
              WHERE i.category_id = c.id AND i.deleted_at IS NULL) AS item_count
       FROM categories c WHERE c.org_id = @org ORDER BY c.name`,
    { org: orgId() },
  );
}

export async function createCategory(name) {
  const id = newId();
  await guard(() => run(
    'INSERT INTO categories (id, org_id, name, created_at) VALUES (@id, @org, @name, @created_at)',
    { id, org: orgId(), name: name.trim(), created_at: nowIso() },
  ));
  return get('SELECT id, name, created_at FROM categories WHERE id = @id AND org_id = @org',
    { id, org: orgId() });
}

export async function renameCategory(id, name) {
  const res = await guard(() => run(
    'UPDATE categories SET name = @name WHERE id = @id AND org_id = @org',
    { name: name.trim(), id, org: orgId() },
  ));
  if (!res.changes) throw notFound('التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
  return get('SELECT id, name, created_at FROM categories WHERE id = @id AND org_id = @org',
    { id, org: orgId() });
}

/** Deletion is blocked while any live item is still assigned to the category. */
export async function deleteCategory(id) {
  const cat = await get('SELECT id FROM categories WHERE id = @id AND org_id = @org', { id, org: orgId() });
  if (!cat) throw notFound('التصنيف غير موجود', 'CATEGORY_NOT_FOUND');

  const { n } = await get(
    `SELECT COUNT(*) n FROM items
      WHERE category_id = @id AND deleted_at IS NULL AND org_id = @org`, { id, org: orgId() });
  if (n) {
    throw conflict(
      `لا يمكن حذف التصنيف — يحتوي على ${n} صنف. أعد تصنيف الأصناف أولاً.`,
      'CATEGORY_HAS_ITEMS', { item_count: n },
    );
  }

  await run('DELETE FROM categories WHERE id = @id AND org_id = @org', { id, org: orgId() });
  return { ok: true };
}

/** Find-or-create by name — used by the Excel importer. */
export async function ensureCategory(name) {
  const clean = String(name ?? '').trim();
  if (!clean) return null;
  const existing = await get(
    'SELECT id FROM categories WHERE org_id = @org AND name = @name',
    { org: orgId(), name: clean },
  );
  if (existing) return existing.id;
  return (await createCategory(clean)).id;
}
