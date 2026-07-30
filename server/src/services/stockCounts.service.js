import {
  all, get, run, tx, newId, nowIso, nextNumber, orgId, publicRow,
} from '../db/index.js';
import { notFound, unprocessable, badRequest } from '../lib/errors.js';
import { createInvoice, addLineByBarcode, postInvoice } from './invoices.service.js';

const SELECT_SESSION = `
  SELECT s.*, c.name AS category_name, i.name AS item_name,
         (SELECT COUNT(*) FROM stock_count_lines l WHERE l.stock_count_id = s.id) AS line_count,
         (SELECT COUNT(*) FROM stock_count_lines l
           WHERE l.stock_count_id = s.id AND (l.counted_quantity IS NOT NULL OR l.skipped = 1)) AS counted_count,
         (SELECT COUNT(*) FROM stock_count_lines l
           WHERE l.stock_count_id = s.id AND l.skipped = 0 AND l.counted_quantity IS NOT NULL
             AND l.counted_quantity <> l.expected_quantity) AS variance_count
    FROM stock_counts s
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN items i ON i.id = s.item_id`;

const loadRaw = async (id) => {
  const row = await get('SELECT * FROM stock_counts WHERE id = ? AND org_id = ?', [id, orgId()]);
  if (!row) throw notFound('جلسة الجرد غير موجودة', 'STOCK_COUNT_NOT_FOUND');
  return row;
};

export async function listStockCounts({ status, page, limit }) {
  const where = status ? 'WHERE s.org_id = @org AND s.status = @status' : 'WHERE s.org_id = @org';
  const params = status ? { status, org: orgId() } : { org: orgId() };
  const { n: total } = await get(`SELECT COUNT(*) n FROM stock_counts s ${where}`, params);
  const rows = (await all(
    `${SELECT_SESSION} ${where} ORDER BY s.created_at DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset: (page - 1) * limit },
  )).map(publicRow);

  for (const r of rows) {
    r.invoices = await all(
      'SELECT id, number, type, status FROM invoices WHERE stock_count_id = ? AND org_id = ?',
      [r.id, orgId()]);
  }
  return { rows, total };
}

export async function getStockCount(id, { withLines = true } = {}) {
  const row = await get(`${SELECT_SESSION} WHERE s.id = @id AND s.org_id = @org`,
    { id, org: orgId() });
  if (!row) throw notFound('جلسة الجرد غير موجودة', 'STOCK_COUNT_NOT_FOUND');
  const session = publicRow(row);
  if (withLines) session.lines = await getCountLines(id, row.created_at);
  session.invoices = await all(
    'SELECT id, number, type, status FROM invoices WHERE stock_count_id = ? AND org_id = ?',
    [id, orgId()]);
  session.summary = await summarise(id);
  return session;
}

/**
 * Lines with live variance. `is_stale` marks items whose stock moved after the
 * snapshot was taken, so the UI can offer to refresh the expected quantity.
 */
export async function getCountLines(stockCountId, sessionCreatedAt) {
  const createdAt = sessionCreatedAt
    ?? (await get('SELECT created_at FROM stock_counts WHERE id = ? AND org_id = ?',
      [stockCountId, orgId()]))?.created_at;

  const rows = await all(
    `SELECT l.*, i.name AS item_name, i.barcode AS item_barcode, i.quantity AS live_quantity,
            c.name AS category_name,
            CASE WHEN l.counted_quantity IS NULL THEN NULL
                 ELSE l.counted_quantity - l.expected_quantity END AS variance,
            EXISTS (SELECT 1 FROM stock_movements m
                     WHERE m.item_id = l.item_id AND m.org_id = @org
                       AND m.created_at > @createdAt) AS is_stale
       FROM stock_count_lines l
       JOIN items i ON i.id = l.item_id
       LEFT JOIN categories c ON c.id = i.category_id
      WHERE l.stock_count_id = @id AND l.org_id = @org
      ORDER BY lower(i.name)`,
    { id: stockCountId, createdAt, org: orgId() });

  return rows.map((l) => ({ ...publicRow(l), skipped: !!l.skipped, is_stale: !!l.is_stale }));
}

async function summarise(id) {
  const lines = await getCountLines(id);
  const counted = lines.filter((l) => !l.skipped && l.counted_quantity !== null);
  return {
    total: lines.length,
    entered: lines.filter((l) => l.counted_quantity !== null || l.skipped).length,
    skipped: lines.filter((l) => l.skipped).length,
    surplus: counted.filter((l) => l.variance > 0),
    shortage: counted.filter((l) => l.variance < 0),
    unchanged: counted.filter((l) => l.variance === 0).length,
    surplus_units: counted.filter((l) => l.variance > 0).reduce((s, l) => s + l.variance, 0),
    shortage_units: counted.filter((l) => l.variance < 0).reduce((s, l) => s - l.variance, 0),
  };
}

/** Start a session, snapshotting the current quantity of every item in scope. */
export function createStockCount({ scope, category_id, item_id, created_by }) {
  if (!['ALL', 'CATEGORY', 'ITEM'].includes(scope)) {
    throw badRequest('نطاق الجرد غير صالح', 'BAD_SCOPE');
  }
  if (scope === 'CATEGORY' && !category_id) {
    throw badRequest('اختر التصنيف المطلوب جرده', 'CATEGORY_REQUIRED');
  }
  if (scope === 'ITEM' && !item_id) throw badRequest('اختر الصنف المطلوب جرده', 'ITEM_REQUIRED');

  return tx(async () => {
    const id = newId();
    await run(
      `INSERT INTO stock_counts (id, org_id, number, scope, category_id, item_id, status,
                                 created_by, created_at)
       VALUES (?,?,?,?,?,?, 'OPEN', ?, ?)`,
      [id, orgId(), await nextNumber('STOCK_COUNT', 'SC'), scope,
        scope === 'CATEGORY' ? category_id : null,
        scope === 'ITEM' ? item_id : null,
        created_by || 'المستخدم', nowIso()]);

    const items = scope === 'ALL'
      ? await all('SELECT id, quantity FROM items WHERE deleted_at IS NULL AND org_id = ?',
        [orgId()])
      : scope === 'CATEGORY'
        ? await all(
          `SELECT id, quantity FROM items
            WHERE deleted_at IS NULL AND category_id = ? AND org_id = ?`, [category_id, orgId()])
        : await all(
          `SELECT id, quantity FROM items
            WHERE deleted_at IS NULL AND id = ? AND org_id = ?`, [item_id, orgId()]);

    if (!items.length) throw unprocessable('لا توجد أصناف ضمن النطاق المحدد', 'NO_ITEMS_IN_SCOPE');

    for (const it of items) {
      await run(
        `INSERT INTO stock_count_lines (id, org_id, stock_count_id, item_id, expected_quantity)
         VALUES (?,?,?,?,?)`, [newId(), orgId(), id, it.id, it.quantity]);
    }

    return getStockCount(id);
  });
}

export async function updateCountLine(stockCountId, lineId, { counted_quantity, note, skipped }) {
  const session = await loadRaw(stockCountId);
  if (session.status !== 'OPEN' && session.status !== 'SUBMITTED') {
    throw unprocessable('لا يمكن تعديل جلسة مطبّقة أو ملغاة', 'STOCK_COUNT_LOCKED');
  }

  const line = await get(
    'SELECT * FROM stock_count_lines WHERE id = ? AND stock_count_id = ? AND org_id = ?',
    [lineId, stockCountId, orgId()]);
  if (!line) throw notFound('سطر الجرد غير موجود', 'COUNT_LINE_NOT_FOUND');

  const fields = [];
  const params = { id: lineId, org: orgId() };
  if (counted_quantity !== undefined) {
    if (counted_quantity !== null) {
      const q = Number(counted_quantity);
      if (!Number.isInteger(q) || q < 0) {
        throw badRequest('الكمية الفعلية يجب أن تكون عدداً صحيحاً غير سالب', 'BAD_QUANTITY');
      }
      params.counted_quantity = q;
    } else params.counted_quantity = null;
    fields.push('counted_quantity = @counted_quantity', 'skipped = 0');
  }
  if (skipped !== undefined) {
    fields.push('skipped = @skipped');
    params.skipped = skipped ? 1 : 0;
    if (skipped) fields.push('counted_quantity = NULL');
  }
  if (note !== undefined) { fields.push('note = @note'); params.note = note?.trim() || null; }

  if (fields.length) {
    await run(
      `UPDATE stock_count_lines SET ${fields.join(', ')} WHERE id = @id AND org_id = @org`, params);
  }

  // Re-open a submitted session that gets edited again.
  if (session.status === 'SUBMITTED') {
    await run(
      "UPDATE stock_counts SET status = 'OPEN', submitted_at = NULL WHERE id = ? AND org_id = ?",
      [stockCountId, orgId()]);
  }

  return getStockCount(stockCountId);
}

/** Re-snapshot expected quantities from live stock (concurrency escape hatch). */
export async function refreshExpected(stockCountId) {
  const session = await loadRaw(stockCountId);
  if (session.status === 'APPLIED' || session.status === 'CANCELLED') {
    throw unprocessable('لا يمكن تحديث جلسة مطبّقة أو ملغاة', 'STOCK_COUNT_LOCKED');
  }

  await run(
    `UPDATE stock_count_lines
        SET expected_quantity = (SELECT quantity FROM items WHERE items.id = stock_count_lines.item_id)
      WHERE stock_count_id = ? AND org_id = ?`, [stockCountId, orgId()]);
  await run('UPDATE stock_counts SET created_at = ? WHERE id = ? AND org_id = ?',
    [nowIso(), stockCountId, orgId()]);
  return getStockCount(stockCountId);
}

export async function submitStockCount(stockCountId) {
  const session = await loadRaw(stockCountId);
  if (session.status !== 'OPEN') {
    throw unprocessable('يمكن تسليم الجلسات المفتوحة فقط', 'STOCK_COUNT_NOT_OPEN');
  }

  const { n: pending } = await get(
    `SELECT COUNT(*) n FROM stock_count_lines
      WHERE stock_count_id = ? AND counted_quantity IS NULL AND skipped = 0 AND org_id = ?`,
    [stockCountId, orgId()]);
  if (pending) {
    throw unprocessable(
      `${pending} صنف بلا كمية فعلية — أدخل الكميات أو علّمها كـ"غير مجرودة"`,
      'LINES_NOT_COUNTED', { pending });
  }

  await run("UPDATE stock_counts SET status = 'SUBMITTED', submitted_at = ? WHERE id = ? AND org_id = ?",
    [nowIso(), stockCountId, orgId()]);
  return getStockCount(stockCountId);
}

/**
 * SUBMITTED → APPLIED. Generates and immediately posts one Stock-In invoice
 * for surpluses and one Stock-Out invoice for shortages, in a single
 * transaction: if either post fails the whole apply rolls back and the session
 * stays SUBMITTED for the user to correct.
 */
export async function applyStockCount(stockCountId) {
  const session = await loadRaw(stockCountId);
  if (session.status !== 'SUBMITTED') {
    throw unprocessable('يجب تسليم الجلسة قبل تطبيقها', 'STOCK_COUNT_NOT_SUBMITTED');
  }

  return tx(async () => {
    const lines = await getCountLines(stockCountId);
    const surplus = lines.filter((l) => !l.skipped && l.counted_quantity !== null && l.variance > 0);
    const shortage = lines.filter((l) => !l.skipped && l.counted_quantity !== null && l.variance < 0);
    const label = `تسوية جرد — جلسة ${session.number}`;
    const created = [];

    const build = async (type, group) => {
      if (!group.length) return;
      const invoice = await createInvoice({
        type, source: 'STOCK_COUNT', stock_count_id: stockCountId, note: label,
      });
      for (const line of group) {
        const { line_id } = await addLineByBarcode(invoice.id, {
          item_id: line.item_id,
          quantity: Math.abs(line.variance),
          unit_price: 0,
          update_item_price: false,     // a count never rewrites prices
          note: line.note || label,
        });
        await run('UPDATE stock_count_lines SET auto_invoice_line_id = ? WHERE id = ? AND org_id = ?',
          [line_id, line.id, orgId()]);
      }
      created.push(await postInvoice(invoice.id, { referenceType: 'STOCK_COUNT' }));
    };

    await build('STOCK_IN', surplus);
    await build('STOCK_OUT', shortage);

    await run("UPDATE stock_counts SET status = 'APPLIED', applied_at = ? WHERE id = ? AND org_id = ?",
      [nowIso(), stockCountId, orgId()]);

    return { session: await getStockCount(stockCountId), invoices: created };
  });
}

export async function cancelStockCount(stockCountId) {
  const session = await loadRaw(stockCountId);
  if (session.status === 'APPLIED') {
    throw unprocessable('لا يمكن إلغاء جلسة تم تطبيقها', 'STOCK_COUNT_APPLIED');
  }
  await run("UPDATE stock_counts SET status = 'CANCELLED' WHERE id = ? AND org_id = ?",
    [stockCountId, orgId()]);
  return getStockCount(stockCountId);
}
