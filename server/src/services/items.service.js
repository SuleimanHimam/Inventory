import { all, get, run, money, newId, nowIso, orgId, lowStockThreshold } from '../db/index.js';
import { notFound, conflict, badRequest, guard } from '../lib/errors.js';
import { listItemImages } from './images.service.js';

/**
 * Columns every item response exposes, including derived stock signals.
 * Takes an optional `TOP (…) ` clause — T-SQL puts TOP right after SELECT,
 * so a caller that needs it (searchItems) parameterises this instead of
 * wrapping the whole thing in a derived table, which would drop `i.org_id`/
 * `i.deleted_at` out of scope since neither is in this column list.
 */
const selectItemCols = (top = '') => `
  SELECT ${top}i.id, i.name, i.category_id, c.name AS category_name, i.barcode, i.notes,
         i.purchase_price, i.sale_price, i.quantity, i.low_stock_threshold,
         i.source, i.image_file, i.created_at, i.updated_at,
         i.weight_kg, i.length_cm, i.width_cm, i.height_cm, i.cbm_m3,
         CASE WHEN i.image_file IS NULL THEN NULL
              ELSE '/uploads/' + i.image_file END AS image_url,
         COALESCE(i.low_stock_threshold, @globalThreshold) AS effective_threshold,
         CASE WHEN i.quantity <= COALESCE(i.low_stock_threshold, @globalThreshold)
              THEN 1 ELSE 0 END AS is_low_stock
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id`;
const SELECT_ITEM = selectItemCols();

const toItem = (r) =>
  r && { ...r, is_low_stock: !!r.is_low_stock, sub_barcodes: r.sub_barcodes };

export async function listItems({ search, category_id, low_stock, in_stock, page, limit, sort }) {
  const params = { globalThreshold: await lowStockThreshold(), org: orgId() };
  const where = ['i.org_id = @org', 'i.deleted_at IS NULL'];

  if (search) {
    // Name OR primary barcode OR any sub-barcode OR any unit barcode, de-duplicated to item level.
    params.q = `%${search}%`;
    params.exact = search;
    where.push(`(i.name LIKE @q
              OR i.barcode LIKE @q
              OR EXISTS (SELECT 1 FROM sub_barcodes sb
                          WHERE sb.item_id = i.id AND (sb.barcode LIKE @q OR sb.barcode = @exact))
              OR EXISTS (SELECT 1 FROM item_units u
                          WHERE u.item_id = i.id AND (u.barcode LIKE @q OR u.barcode = @exact)))`);
  }
  if (category_id) {
    if (category_id === 'none') where.push('i.category_id IS NULL');
    else { params.category_id = category_id; where.push('i.category_id = @category_id'); }
  }
  if (low_stock) where.push('i.quantity <= COALESCE(i.low_stock_threshold, @globalThreshold)');
  /*
   * "In stock" is `> 0`, not "above the low-stock threshold". The two filters
   * are deliberately independent and combining them is meaningful rather than
   * contradictory: an item can be in stock *and* below its threshold, which is
   * exactly the "running out but still sellable" list worth reordering from.
   */
  if (in_stock) where.push('i.quantity > 0');

  const clause = `WHERE ${where.join(' AND ')}`;
  const orderBy = {
    name: 'i.name ASC',
    /*
     * Both quantity sorts break ties on the name.
     *
     * Without it the order among equal quantities is whatever the engine
     * returns, and that is not stable between the two queries a page costs --
     * so with 46 items sitting at 0, as this catalogue has, rows could repeat
     * on one page and vanish from the next. The tiebreak is not cosmetic.
     */
    quantity: 'i.quantity ASC, i.name ASC',
    quantity_desc: 'i.quantity DESC, i.name ASC',
    newest: 'i.created_at DESC',
    price: 'i.sale_price DESC',
  }[sort] || 'i.name ASC';

  const { n: total } = await get(`SELECT COUNT(*) n FROM items i ${clause}`, params);
  const rows = await all(
    `${SELECT_ITEM} ${clause} ORDER BY ${orderBy} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
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
    item.units = await listUnits(id);
    item.stats = await get(
      `SELECT COALESCE(SUM(CASE WHEN type='IN'  THEN quantity END),0) AS total_in,
              COALESCE(SUM(CASE WHEN type='OUT' THEN quantity END),0) AS total_out,
              COUNT(*) AS movement_count
         FROM stock_movements WHERE item_id = @id AND org_id = @org`, { id, org: orgId() });
  }
  return item;
}

/** Resolve a scanned/typed barcode against primary barcodes, sub-barcodes, AND unit barcodes. */
export async function findByBarcode(code) {
  const value = String(code ?? '').trim();
  if (!value) return null;
  const hit = await get(
    // A primary barcode must win over a sub-barcode or unit barcode that
    // shares the value, hence the explicit ORDER BY rather than relying on
    // engine evaluation order.
    `SELECT TOP (1) * FROM (
       SELECT i.id, 'PRIMARY' AS matched_on, CAST(NULL AS nvarchar(max)) AS matched_label,
              CAST(NULL AS nvarchar(64)) AS matched_unit_id
         FROM items i
        WHERE i.barcode = @code AND i.deleted_at IS NULL AND i.org_id = @org
       UNION ALL
       SELECT sb.item_id, 'SUB', sb.label, CAST(NULL AS nvarchar(64))
         FROM sub_barcodes sb
         JOIN items i2 ON i2.id = sb.item_id AND i2.deleted_at IS NULL
        WHERE sb.barcode = @code AND sb.org_id = @org
       UNION ALL
       SELECT u.item_id, 'UNIT', u.name, u.id
         FROM item_units u
         JOIN items i3 ON i3.id = u.item_id AND i3.deleted_at IS NULL
        WHERE u.barcode = @code AND u.org_id = @org
     ) hits
     ORDER BY CASE matched_on WHEN 'PRIMARY' THEN 0 WHEN 'UNIT' THEN 1 ELSE 2 END`,
    { code: value, org: orgId() });
  if (!hit) return null;
  return {
    ...await getItem(hit.id, { withDetail: true }),
    matched_on: hit.matched_on,
    matched_barcode: value,
    matched_unit_id: hit.matched_unit_id ?? null,
  };
}

/** Global search used by the top-nav bar: returns items with match context. */
export async function searchItems(q, limit = 12) {
  const term = String(q ?? '').trim();
  if (!term) return [];
  const like = `%${term}%`;
  const rows = await all(
    `${selectItemCols('TOP (@limit) ')}
      WHERE i.org_id = @org AND i.deleted_at IS NULL
        AND (i.name LIKE @like OR i.barcode LIKE @like
             OR EXISTS (SELECT 1 FROM sub_barcodes sb WHERE sb.item_id = i.id AND sb.barcode LIKE @like)
             OR EXISTS (SELECT 1 FROM item_units u WHERE u.item_id = i.id AND u.barcode LIKE @like))
      ORDER BY
        CASE WHEN i.barcode = @term THEN 0
             WHEN EXISTS (SELECT 1 FROM sub_barcodes sb WHERE sb.item_id=i.id AND sb.barcode=@term) THEN 1
             WHEN EXISTS (SELECT 1 FROM item_units u WHERE u.item_id=i.id AND u.barcode=@term) THEN 1
             WHEN i.name LIKE @prefix THEN 2 ELSE 3 END,
        i.name`,
    { like, term, prefix: `${term}%`, limit, org: orgId(), globalThreshold: await lowStockThreshold() },
  );

  return Promise.all(rows.map(async (r) => {
    const sub = await get(
      'SELECT TOP (1) barcode, label FROM sub_barcodes WHERE item_id = @id AND barcode LIKE @like',
      { id: r.id, like });
    const unit = !sub && await get(
      'SELECT TOP (1) barcode, name FROM item_units WHERE item_id = @id AND barcode LIKE @like',
      { id: r.id, like });
    const matched_on = (r.barcode ?? '').includes(term) ? 'barcode' : sub ? 'sub_barcode' : unit ? 'unit' : 'name';
    return {
      ...toItem(r),
      matched_on,
      matched_barcode: matched_on === 'barcode' ? r.barcode : sub?.barcode ?? unit?.barcode,
    };
  }));
}

export async function createItem(input) {
  const id = newId();
  const now = nowIso();
  await guard(() => run(
    `INSERT INTO items (id, org_id, name, category_id, barcode, notes, purchase_price, sale_price,
                        low_stock_threshold, source, weight_kg, length_cm, width_cm, height_cm,
                        cbm_m3, created_at, updated_at)
     VALUES (@id, @org, @name, @category_id, @barcode, @notes, @purchase_price, @sale_price,
             @low_stock_threshold, @source, @weight_kg, @length_cm, @width_cm, @height_cm,
             @cbm_m3, @now, @now)`,
    {
      id,
      org: orgId(),
      name: input.name.trim(),
      category_id: input.category_id || null,
      barcode: input.barcode?.trim() || null,
      notes: input.notes?.trim() || null,
      purchase_price: money(input.purchase_price),
      sale_price: money(input.sale_price),
      low_stock_threshold: input.low_stock_threshold ?? null,
      source: input.source || 'MANUAL',
      weight_kg: input.weight_kg ?? null,
      length_cm: input.length_cm ?? null,
      width_cm: input.width_cm ?? null,
      height_cm: input.height_cm ?? null,
      cbm_m3: input.cbm_m3 ?? null,
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
  if (patch.barcode !== undefined) assign('barcode', patch.barcode?.trim() || null);
  if (patch.notes !== undefined) assign('notes', patch.notes?.trim() || null);
  if (patch.purchase_price !== undefined) assign('purchase_price', money(patch.purchase_price));
  if (patch.sale_price !== undefined) assign('sale_price', money(patch.sale_price));
  if (patch.low_stock_threshold !== undefined) {
    assign('low_stock_threshold',
      patch.low_stock_threshold === null ? null : Number(patch.low_stock_threshold));
  }
  for (const col of ['weight_kg', 'length_cm', 'width_cm', 'height_cm', 'cbm_m3']) {
    if (patch[col] !== undefined) assign(col, patch[col] === null ? null : Number(patch[col]));
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
      WHERE l.item_id = @id AND v.status = 'DRAFT' AND l.org_id = @org`, { id, org: orgId() });
  if (draft) throw conflict('الصنف مستخدم في فاتورة غير محفوظة — احذف السطور أولاً', 'ITEM_IN_DRAFT');

  const { n: open } = await get(
    `SELECT COUNT(*) n FROM stock_count_lines l
       JOIN stock_counts s ON s.id = l.stock_count_id
      WHERE l.item_id = @id AND s.status IN ('OPEN','SUBMITTED') AND l.org_id = @org`, { id, org: orgId() });
  if (open) throw conflict('الصنف مُدرج في جلسة جرد جارية', 'ITEM_IN_STOCK_COUNT');

  await run('UPDATE items SET deleted_at = @now, updated_at = @now WHERE id = @id AND org_id = @org',
    { now: nowIso(), id, org: orgId() });
  return { ok: true };
}

// ------------------------------------------------------------- sub-barcodes
export function listSubBarcodes(itemId) {
  return all(
    `SELECT id, item_id, barcode, label, created_at FROM sub_barcodes
      WHERE item_id = @id AND org_id = @org ORDER BY created_at`, { id: itemId, org: orgId() });
}

export async function addSubBarcode(itemId, { barcode, label }) {
  await getItem(itemId);
  const code = String(barcode ?? '').trim();
  if (!code) throw badRequest('الباركود مطلوب', 'BARCODE_REQUIRED');
  const id = newId();
  await guard(() => run(
    `INSERT INTO sub_barcodes (id, org_id, item_id, barcode, label, created_at)
     VALUES (@id, @org, @item_id, @barcode, @label, @created_at)`,
    { id, org: orgId(), item_id: itemId, barcode: code, label: label?.trim() || null, created_at: nowIso() }));
  return get(
    `SELECT id, item_id, barcode, label, created_at FROM sub_barcodes
      WHERE id = @id AND org_id = @org`, { id, org: orgId() });
}

export async function removeSubBarcode(itemId, subId) {
  const res = await run(
    'DELETE FROM sub_barcodes WHERE id = @id AND item_id = @item_id AND org_id = @org',
    { id: subId, item_id: itemId, org: orgId() });
  if (!res.changes) throw notFound('الباركود الفرعي غير موجود', 'SUB_BARCODE_NOT_FOUND');
  return { ok: true };
}

// ------------------------------------------------------------------ units
const UNIT_COLUMNS = `id, item_id, name, barcode, conversion_factor, purchase_price, sale_price,
                       weight_kg, length_cm, width_cm, height_cm, cbm_m3, created_at, updated_at`;

export function listUnits(itemId) {
  return all(
    `SELECT ${UNIT_COLUMNS} FROM item_units
      WHERE item_id = @id AND org_id = @org ORDER BY conversion_factor, created_at`, { id: itemId, org: orgId() });
}

function validateUnitInput({ name, barcode, conversion_factor }, { partial = false } = {}) {
  if (!partial || name !== undefined) {
    if (!String(name ?? '').trim()) throw badRequest('اسم الوحدة مطلوب', 'UNIT_NAME_REQUIRED');
  }
  if (!partial || barcode !== undefined) {
    if (!String(barcode ?? '').trim()) throw badRequest('باركود الوحدة مطلوب', 'BARCODE_REQUIRED');
  }
  if (!partial || conversion_factor !== undefined) {
    const factor = Number(conversion_factor);
    if (!Number.isFinite(factor) || factor <= 0) {
      throw badRequest('عامل التحويل يجب أن يكون رقماً أكبر من صفر', 'BAD_CONVERSION_FACTOR');
    }
  }
}

export async function addUnit(itemId, input) {
  await getItem(itemId);
  validateUnitInput(input);
  const id = newId();
  const now = nowIso();
  await guard(() => run(
    `INSERT INTO item_units (id, org_id, item_id, name, barcode, conversion_factor,
                             purchase_price, sale_price, weight_kg, length_cm, width_cm,
                             height_cm, cbm_m3, created_at, updated_at)
     VALUES (@id, @org, @item_id, @name, @barcode, @conversion_factor, @purchase_price,
             @sale_price, @weight_kg, @length_cm, @width_cm, @height_cm, @cbm_m3, @now, @now)`,
    {
      id,
      org: orgId(),
      item_id: itemId,
      name: String(input.name).trim(),
      barcode: String(input.barcode).trim(),
      conversion_factor: Number(input.conversion_factor),
      purchase_price: money(input.purchase_price ?? 0),
      sale_price: money(input.sale_price ?? 0),
      weight_kg: input.weight_kg ?? null,
      length_cm: input.length_cm ?? null,
      width_cm: input.width_cm ?? null,
      height_cm: input.height_cm ?? null,
      cbm_m3: input.cbm_m3 ?? null,
      now,
    }));
  return get(`SELECT ${UNIT_COLUMNS} FROM item_units WHERE id = @id AND org_id = @org`, { id, org: orgId() });
}

export async function updateUnit(itemId, unitId, patch) {
  const unit = await get('SELECT id FROM item_units WHERE id = @id AND item_id = @item_id AND org_id = @org',
    { id: unitId, item_id: itemId, org: orgId() });
  if (!unit) throw notFound('وحدة القياس غير موجودة', 'UNIT_NOT_FOUND');
  validateUnitInput(patch, { partial: true });

  const fields = [];
  const params = { id: unitId, org: orgId(), now: nowIso() };
  const assign = (col, value) => { fields.push(`${col} = @${col}`); params[col] = value; };

  if (patch.name !== undefined) assign('name', String(patch.name).trim());
  if (patch.barcode !== undefined) assign('barcode', String(patch.barcode).trim());
  if (patch.conversion_factor !== undefined) assign('conversion_factor', Number(patch.conversion_factor));
  if (patch.purchase_price !== undefined) assign('purchase_price', money(patch.purchase_price));
  if (patch.sale_price !== undefined) assign('sale_price', money(patch.sale_price));
  for (const col of ['weight_kg', 'length_cm', 'width_cm', 'height_cm', 'cbm_m3']) {
    if (patch[col] !== undefined) assign(col, patch[col] === null ? null : Number(patch[col]));
  }

  if (fields.length) {
    await guard(() => run(
      `UPDATE item_units SET ${fields.join(', ')}, updated_at = @now
        WHERE id = @id AND org_id = @org`, params));
  }
  return get(`SELECT ${UNIT_COLUMNS} FROM item_units WHERE id = @id AND org_id = @org`, { id: unitId, org: orgId() });
}

export async function removeUnit(itemId, unitId) {
  const existing = await get('SELECT id FROM item_units WHERE id = @id AND item_id = @item_id AND org_id = @org',
    { id: unitId, item_id: itemId, org: orgId() });
  if (!existing) throw notFound('وحدة القياس غير موجودة', 'UNIT_NOT_FOUND');

  const { n } = await get(
    'SELECT COUNT(*) n FROM invoice_lines WHERE unit_id = @id AND org_id = @org', { id: unitId, org: orgId() });
  if (n) throw conflict('الوحدة مستخدمة في فاتورة — لا يمكن حذفها', 'UNIT_IN_USE');

  await run('DELETE FROM item_units WHERE id = @id AND item_id = @item_id AND org_id = @org',
    { id: unitId, item_id: itemId, org: orgId() });
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
            COALESCE(SUM(quantity * (sale_price - purchase_price)), 0) AS stock_profit,
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
      WHERE LEFT(created_at, 10) = dbo.iso_today() AND org_id = @org`, { org });

  // 14-day IN/OUT trend for the dashboard chart. generate_series has no T-SQL
  // equivalent, so the day list is built with a small recursive CTE instead —
  // MAXRECURSION defaults to 100, comfortably above the 14 rows needed here.
  const trend = await all(
    `WITH days AS (
        SELECT CAST(SYSUTCDATETIME() AS date) AS d
        UNION ALL
        SELECT DATEADD(day, -1, d) FROM days WHERE d > DATEADD(day, -13, CAST(SYSUTCDATETIME() AS date))
      )
      SELECT FORMAT(d, 'yyyy-MM-dd') AS day,
             COALESCE((SELECT SUM(quantity) FROM stock_movements m
                        WHERE m.type='IN'  AND LEFT(m.created_at,10)=FORMAT(days.d,'yyyy-MM-dd') AND m.org_id=@org),0) AS in_qty,
             COALESCE((SELECT SUM(quantity) FROM stock_movements m
                        WHERE m.type='OUT' AND LEFT(m.created_at,10)=FORMAT(days.d,'yyyy-MM-dd') AND m.org_id=@org),0) AS out_qty
        FROM days
       ORDER BY d`, { org });

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const topMoving = await all(
    `SELECT TOP (5) i.id, i.name, SUM(m.quantity) AS moved
       FROM stock_movements m JOIN items i ON i.id = m.item_id
      WHERE m.type='OUT' AND m.created_at >= @since AND i.deleted_at IS NULL AND m.org_id = @org
      GROUP BY i.id, i.name ORDER BY moved DESC`, { since, org });

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
    ...base,
    stock_value: money(base.stock_value),
    stock_profit: money(base.stock_profit),
    today, trend, top_moving: topMoving, counts, threshold,
  };
}
