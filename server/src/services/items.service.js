import { all, get, run, money, newId, nowIso, orgId, lowStockThreshold } from '../db/index.js';
import { notFound, conflict, badRequest, guard } from '../lib/errors.js';
import { listItemImages } from './images.service.js';

/** Columns every item response exposes, including derived stock signals. */
const SELECT_ITEM = `
  SELECT i.id, i.name, i.category_id, c.name AS category_name, i.barcode,
         i.purchase_price, i.sale_price, i.quantity, i.low_stock_threshold,
         i.source, i.image_file, i.created_at, i.updated_at,
         CASE WHEN i.image_file IS NULL THEN NULL
              ELSE '/uploads/' || i.image_file END AS image_url,
         COALESCE(i.low_stock_threshold, @globalThreshold) AS effective_threshold,
         CASE WHEN i.quantity <= COALESCE(i.low_stock_threshold, @globalThreshold)
              THEN 1 ELSE 0 END AS is_low_stock
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id`;

const toItem = (r) =>
  r && { ...r, is_low_stock: !!r.is_low_stock, sub_barcodes: r.sub_barcodes };

export async function listItems({ search, category_id, low_stock, page, limit, sort }) {
  const params = { globalThreshold: await lowStockThreshold(), org: orgId() };
  const where = ['i.org_id = @org', 'i.deleted_at IS NULL'];

  if (search) {
    // Name OR primary barcode OR any sub-barcode, de-duplicated to item level.
    params.q = `%${search}%`;
    params.exact = search;
    where.push(`(i.name ILIKE @q
              OR i.barcode LIKE @q
              OR EXISTS (SELECT 1 FROM sub_barcodes sb
                          WHERE sb.item_id = i.id AND (sb.barcode LIKE @q OR sb.barcode = @exact)))`);
  }
  if (category_id) {
    if (category_id === 'none') where.push('i.category_id IS NULL');
    else { params.category_id = category_id; where.push('i.category_id = @category_id'); }
  }
  if (low_stock) where.push('i.quantity <= COALESCE(i.low_stock_threshold, @globalThreshold)');

  const clause = `WHERE ${where.join(' AND ')}`;
  const orderBy = {
    name: 'lower(i.name) ASC',
    quantity: 'i.quantity ASC',
    newest: 'i.created_at DESC',
    price: 'i.sale_price DESC',
  }[sort] || 'lower(i.name) ASC';

  const { n: total } = await get(`SELECT COUNT(*) n FROM items i ${clause}`, params);
  const rows = await all(
    `${SELECT_ITEM} ${clause} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset: (page - 1) * limit },
  );

  return { rows: rows.map(toItem), total };
}

export async function getItem(id, { withDetail = false } = {}) {
  const row = await get(`${SELECT_ITEM} WHERE i.id = @id AND i.org_id = @org`,
    { id, org: orgId(), globalThreshold: await lowStockThreshold() });
  if (!row) throw notFound('الصنف غير موجود', 'ITEM_NOT_FOUND');
  const item = toItem(row);
  if (withDetail) {
    item.images = await listItemImages(id);
    item.sub_barcodes = await listSubBarcodes(id);
    item.stats = await get(
      `SELECT COALESCE(SUM(CASE WHEN type='IN'  THEN quantity END),0) AS total_in,
              COALESCE(SUM(CASE WHEN type='OUT' THEN quantity END),0) AS total_out,
              COUNT(*) AS movement_count
         FROM stock_movements WHERE item_id = ? AND org_id = ?`, [id, orgId()]);
  }
  return item;
}

/** Resolve a scanned/typed barcode against primary barcodes AND sub-barcodes. */
export async function findByBarcode(code) {
  const value = String(code ?? '').trim();
  if (!value) return null;
  const hit = await get(
    // Two differences from the SQLite original: NULL needs an explicit type in a
    // UNION, and the branches are ordered explicitly — SQLite happened to
    // evaluate them in order, Postgres makes no such promise, and a primary
    // barcode must win over a sub-barcode that shares the value.
    `SELECT * FROM (
       SELECT i.id, 'PRIMARY' AS matched_on, NULL::text AS matched_label
         FROM items i
        WHERE i.barcode = @code AND i.deleted_at IS NULL AND i.org_id = @org
       UNION ALL
       SELECT sb.item_id, 'SUB', sb.label
         FROM sub_barcodes sb
         JOIN items i2 ON i2.id = sb.item_id AND i2.deleted_at IS NULL
        WHERE sb.barcode = @code AND sb.org_id = @org
     ) hits
     ORDER BY CASE matched_on WHEN 'PRIMARY' THEN 0 ELSE 1 END
     LIMIT 1`, { code: value, org: orgId() });
  if (!hit) return null;
  return {
    ...await getItem(hit.id, { withDetail: true }),
    matched_on: hit.matched_on,
    matched_barcode: value,
  };
}

/** Global search used by the top-nav bar: returns items with match context. */
export async function searchItems(q, limit = 12) {
  const term = String(q ?? '').trim();
  if (!term) return [];
  const like = `%${term}%`;
  const rows = await all(
    `${SELECT_ITEM}
      WHERE i.org_id = @org AND i.deleted_at IS NULL
        AND (i.name ILIKE @like OR i.barcode LIKE @like
             OR EXISTS (SELECT 1 FROM sub_barcodes sb WHERE sb.item_id = i.id AND sb.barcode LIKE @like))
      ORDER BY
        CASE WHEN i.barcode = @term THEN 0
             WHEN EXISTS (SELECT 1 FROM sub_barcodes sb WHERE sb.item_id=i.id AND sb.barcode=@term) THEN 1
             WHEN i.name ILIKE @prefix THEN 2 ELSE 3 END,
        lower(i.name)
      LIMIT @limit`,
    { like, term, prefix: `${term}%`, limit, org: orgId(), globalThreshold: await lowStockThreshold() },
  );

  return Promise.all(rows.map(async (r) => {
    const sub = await get(
      'SELECT barcode, label FROM sub_barcodes WHERE item_id = ? AND barcode LIKE ? LIMIT 1',
      [r.id, like]);
    const matched_on = r.barcode.includes(term) ? 'barcode' : sub ? 'sub_barcode' : 'name';
    return { ...toItem(r), matched_on, matched_barcode: matched_on === 'barcode' ? r.barcode : sub?.barcode };
  }));
}

export async function createItem(input) {
  const id = newId();
  const now = nowIso();
  await guard(() => run(
    `INSERT INTO items (id, org_id, name, category_id, barcode, purchase_price, sale_price,
                        low_stock_threshold, source, created_at, updated_at)
     VALUES (@id, @org, @name, @category_id, @barcode, @purchase_price, @sale_price,
             @low_stock_threshold, @source, @now, @now)`,
    {
      id,
      org: orgId(),
      name: input.name.trim(),
      category_id: input.category_id || null,
      barcode: String(input.barcode).trim(),
      purchase_price: money(input.purchase_price),
      sale_price: money(input.sale_price),
      low_stock_threshold: input.low_stock_threshold ?? null,
      source: input.source || 'MANUAL',
      now,
    }));
  return getItem(id, { withDetail: true });
}

export async function updateItem(id, patch) {
  await getItem(id);
  const fields = [];
  const params = { id, org: orgId(), now: nowIso() };
  const assign = (col, value) => { fields.push(`${col} = @${col}`); params[col] = value; };

  if (patch.name !== undefined) assign('name', patch.name.trim());
  if (patch.category_id !== undefined) assign('category_id', patch.category_id || null);
  if (patch.barcode !== undefined) assign('barcode', String(patch.barcode).trim());
  if (patch.purchase_price !== undefined) assign('purchase_price', money(patch.purchase_price));
  if (patch.sale_price !== undefined) assign('sale_price', money(patch.sale_price));
  if (patch.low_stock_threshold !== undefined) {
    assign('low_stock_threshold',
      patch.low_stock_threshold === null ? null : Number(patch.low_stock_threshold));
  }

  if (fields.length) {
    await guard(() => run(
      `UPDATE items SET ${fields.join(', ')}, updated_at = @now
        WHERE id = @id AND org_id = @org`, params));
  }
  return getItem(id, { withDetail: true });
}

/** Soft delete — movement history is preserved for audit. */
export async function deleteItem(id) {
  await getItem(id);
  const { n: draft } = await get(
    `SELECT COUNT(*) n FROM invoice_lines l
       JOIN invoices v ON v.id = l.invoice_id
      WHERE l.item_id = ? AND v.status = 'DRAFT' AND l.org_id = ?`, [id, orgId()]);
  if (draft) throw conflict('الصنف مستخدم في فواتير مسودة — احذف السطور أولاً', 'ITEM_IN_DRAFT');

  const { n: open } = await get(
    `SELECT COUNT(*) n FROM stock_count_lines l
       JOIN stock_counts s ON s.id = l.stock_count_id
      WHERE l.item_id = ? AND s.status IN ('OPEN','SUBMITTED') AND l.org_id = ?`, [id, orgId()]);
  if (open) throw conflict('الصنف مُدرج في جلسة جرد جارية', 'ITEM_IN_STOCK_COUNT');

  await run('UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ? AND org_id = ?',
    [nowIso(), nowIso(), id, orgId()]);
  return { ok: true };
}

// ------------------------------------------------------------- sub-barcodes
export function listSubBarcodes(itemId) {
  return all(
    `SELECT id, item_id, barcode, label, created_at FROM sub_barcodes
      WHERE item_id = ? AND org_id = ? ORDER BY created_at`, [itemId, orgId()]);
}

export async function addSubBarcode(itemId, { barcode, label }) {
  await getItem(itemId);
  const code = String(barcode ?? '').trim();
  if (!code) throw badRequest('الباركود مطلوب', 'BARCODE_REQUIRED');
  const id = newId();
  await guard(() => run(
    `INSERT INTO sub_barcodes (id, org_id, item_id, barcode, label, created_at)
     VALUES (?,?,?,?,?,?)`,
    [id, orgId(), itemId, code, label?.trim() || null, nowIso()]));
  return get(
    `SELECT id, item_id, barcode, label, created_at FROM sub_barcodes
      WHERE id = ? AND org_id = ?`, [id, orgId()]);
}

export async function removeSubBarcode(itemId, subId) {
  const res = await run(
    'DELETE FROM sub_barcodes WHERE id = ? AND item_id = ? AND org_id = ?',
    [subId, itemId, orgId()]);
  if (!res.changes) throw notFound('الباركود الفرعي غير موجود', 'SUB_BARCODE_NOT_FOUND');
  return { ok: true };
}

// ------------------------------------------------------------------ reports
export function lowStockReport({ category_id, page, limit }) {
  return listItems({ category_id, low_stock: true, page, limit, sort: 'quantity' });
}

export async function dashboardStats() {
  const threshold = await lowStockThreshold();
  const org = orgId();

  const base = await get(
    // Every aggregate is COALESCE'd: SUM() over zero rows returns NULL, which
    // would surface as "null" on the dashboard of a brand-new installation.
    `SELECT COUNT(*)                                    AS total_items,
            COALESCE(SUM(quantity), 0)                  AS total_units,
            COALESCE(SUM(quantity * purchase_price), 0) AS stock_value,
            COALESCE(SUM(CASE WHEN quantity <= COALESCE(low_stock_threshold, @t) THEN 1 ELSE 0 END), 0)
              AS low_stock_count,
            COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END), 0)
              AS out_of_stock_count
       FROM items WHERE deleted_at IS NULL AND org_id = @org`, { t: threshold, org });

  // Timestamps are ISO-8601 text, so a day is the first 10 characters.
  const today = await get(
    `SELECT COALESCE(SUM(CASE WHEN type='IN'  THEN quantity END),0) AS in_qty,
            COALESCE(SUM(CASE WHEN type='OUT' THEN quantity END),0) AS out_qty,
            COUNT(*) AS movements
       FROM stock_movements
      WHERE left(created_at, 10) = iso_today() AND org_id = @org`, { org });

  // 14-day IN/OUT trend for the dashboard chart.
  const trend = await all(
    `WITH days AS (
        SELECT to_char(d, 'YYYY-MM-DD') AS day
          FROM generate_series((now() AT TIME ZONE 'utc')::date - 13,
                               (now() AT TIME ZONE 'utc')::date,
                               interval '1 day') AS g(d))
      SELECT day,
             COALESCE((SELECT SUM(quantity) FROM stock_movements m
                        WHERE m.type='IN'  AND left(m.created_at,10)=day AND m.org_id=@org),0) AS in_qty,
             COALESCE((SELECT SUM(quantity) FROM stock_movements m
                        WHERE m.type='OUT' AND left(m.created_at,10)=day AND m.org_id=@org),0) AS out_qty
        FROM days`, { org });

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const topMoving = await all(
    `SELECT i.id, i.name, SUM(m.quantity) AS moved
       FROM stock_movements m JOIN items i ON i.id = m.item_id
      WHERE m.type='OUT' AND m.created_at >= @since AND i.deleted_at IS NULL AND m.org_id = @org
      GROUP BY i.id, i.name ORDER BY moved DESC LIMIT 5`, { since, org });

  const counts = await get(
    `SELECT
       (SELECT COUNT(*) FROM categories WHERE org_id=@org)                    AS categories,
       (SELECT COUNT(*) FROM customers WHERE is_active=1 AND org_id=@org)     AS customers,
       (SELECT COUNT(*) FROM suppliers WHERE is_active=1 AND org_id=@org)     AS suppliers,
       (SELECT COUNT(*) FROM invoices WHERE status='DRAFT' AND org_id=@org)   AS draft_invoices,
       (SELECT COUNT(*) FROM stock_counts
         WHERE status IN ('OPEN','SUBMITTED') AND org_id=@org)                AS open_counts`,
    { org });

  return {
    ...base, stock_value: money(base.stock_value), today, trend, top_moving: topMoving, counts, threshold,
  };
}
