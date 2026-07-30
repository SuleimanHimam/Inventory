import {
  all, get, run, tx, money, newId, nowIso, nextNumber, orgId, publicRow,
} from '../db/index.js';
import { notFound, unprocessable, badRequest, conflict } from '../lib/errors.js';
import { getItem, findByBarcode } from './items.service.js';

/** Invoice type → document-number prefix. */
const PREFIX = { STOCK_IN: 'IN', STOCK_OUT: 'OUT', PURCHASE: 'PUR', SALE: 'SAL' };

/** Types that add stock when posted; the rest subtract it. */
const INBOUND = new Set(['STOCK_IN', 'PURCHASE']);
export const directionOf = (type) => (INBOUND.has(type) ? 'IN' : 'OUT');

/** Which stored price a posted line propagates to. */
const priceColumnOf = (type) => (INBOUND.has(type) ? 'purchase_price' : 'sale_price');

const TOTALS = `
  (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) FROM invoice_lines l WHERE l.invoice_id = v.id)`;

const SELECT_INVOICE = `
  SELECT v.*, ${TOTALS} AS subtotal,
         ${TOTALS} - v.discount_total + v.tax_total AS total,
         (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = v.id) AS line_count,
         s.name AS supplier_name, c.name AS customer_name,
         sc.number AS stock_count_number
    FROM invoices v
    LEFT JOIN suppliers s ON s.id = v.supplier_id
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN stock_counts sc ON sc.id = v.stock_count_id`;

const shape = (r) => r && {
  ...publicRow(r),
  subtotal: money(r.subtotal),
  total: money(r.total),
  party_name: r.supplier_name || r.customer_name || null,
  is_system: r.source !== 'USER',
};

export async function listInvoices({ type, status, party_id, source, search, date_from, date_to, page, limit }) {
  const where = ['v.org_id = @org'];
  const params = { org: orgId() };
  if (type) { where.push('v.type = @type'); params.type = type; }
  if (status) { where.push('v.status = @status'); params.status = status; }
  if (source) { where.push('v.source = @source'); params.source = source; }
  if (party_id) {
    where.push('(v.customer_id = @party_id OR v.supplier_id = @party_id)');
    params.party_id = party_id;
  }
  if (date_from) { where.push('v.invoice_date >= @date_from'); params.date_from = date_from; }
  if (date_to) { where.push('v.invoice_date <= @date_to'); params.date_to = date_to; }
  if (search) {
    params.q = `%${search}%`;
    where.push(`(v.number LIKE @q OR v.note ILIKE @q
              OR s.name ILIKE @q OR c.name ILIKE @q)`);
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const { n: total } = await get(
    `SELECT COUNT(*) n FROM invoices v
       LEFT JOIN suppliers s ON s.id = v.supplier_id
       LEFT JOIN customers c ON c.id = v.customer_id ${clause}`, params);

  const rows = await all(
    `${SELECT_INVOICE} ${clause}
      ORDER BY v.invoice_date DESC, v.created_at DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset: (page - 1) * limit },
  );

  return { rows: rows.map(shape), total };
}

export async function getInvoice(id, { withDetail = true } = {}) {
  const row = await get(`${SELECT_INVOICE} WHERE v.id = @id AND v.org_id = @org`,
    { id, org: orgId() });
  if (!row) throw notFound('الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
  const invoice = shape(row);
  if (withDetail) {
    invoice.lines = await getLines(id);
    invoice.movements = (await all(
      `SELECT m.*, i.name AS item_name, i.barcode AS item_barcode
         FROM stock_movements m JOIN items i ON i.id = m.item_id
        WHERE m.invoice_id = ? AND m.org_id = ? ORDER BY m.created_at, m.seq`,
      [id, orgId()])).map(publicRow);
  }
  return invoice;
}

export async function getLines(invoiceId) {
  // `seq` replaces SQLite's implicit rowid as the insertion-order tie-break.
  const rows = await all(
    `SELECT l.*, l.quantity * l.unit_price AS line_total,
            i.name AS item_name, i.barcode AS item_barcode, i.quantity AS item_quantity,
            CASE WHEN i.image_file IS NULL THEN NULL
                 ELSE '/uploads/' || i.image_file END AS item_image_url,
            c.name AS category_name
       FROM invoice_lines l
       JOIN items i ON i.id = l.item_id
       LEFT JOIN categories c ON c.id = i.category_id
      WHERE l.invoice_id = ? AND l.org_id = ? ORDER BY l.sort_order, l.seq`,
    [invoiceId, orgId()]);
  return rows.map((l) => ({
    ...publicRow(l), line_total: money(l.line_total), update_item_price: !!l.update_item_price,
  }));
}

const assertDraft = (invoice) => {
  if (invoice.status !== 'DRAFT') {
    throw unprocessable('لا يمكن تعديل فاتورة مرحّلة أو ملغاة', 'INVOICE_NOT_DRAFT');
  }
};

const loadRaw = async (id) => {
  const row = await get('SELECT * FROM invoices WHERE id = ? AND org_id = ?', [id, orgId()]);
  if (!row) throw notFound('الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
  return row;
};

// ------------------------------------------------------------------ create
export async function createInvoice(input) {
  const type = input.type;
  if (!PREFIX[type]) throw badRequest('نوع فاتورة غير معروف', 'BAD_INVOICE_TYPE');

  const id = newId();
  await run(
    `INSERT INTO invoices (id, org_id, type, number, supplier_id, customer_id, status, source,
                           invoice_date, discount_total, tax_total, note, stock_count_id,
                           created_by, created_at)
     VALUES (@id, @org, @type, @number, @supplier_id, @customer_id, 'DRAFT', @source,
             @invoice_date, @discount_total, @tax_total, @note, @stock_count_id,
             @created_by, @created_at)`,
    {
      id,
      org: orgId(),
      type,
      number: await nextNumber(type, PREFIX[type]),
      supplier_id: type === 'PURCHASE' ? input.supplier_id || null : null,
      customer_id: type === 'SALE' ? input.customer_id || null : null,
      source: input.source || 'USER',
      invoice_date: input.invoice_date || new Date().toISOString().slice(0, 10),
      discount_total: money(input.discount_total),
      tax_total: money(input.tax_total),
      note: input.note?.trim() || null,
      stock_count_id: input.stock_count_id || null,
      created_by: input.created_by || 'المستخدم',
      created_at: nowIso(),
    });
  return getInvoice(id);
}

export async function updateInvoice(id, patch) {
  const invoice = await loadRaw(id);
  assertDraft(invoice);

  const fields = [];
  const params = { id, org: orgId() };
  const assign = (col, value) => { fields.push(`${col} = @${col}`); params[col] = value; };

  if (patch.invoice_date !== undefined) assign('invoice_date', patch.invoice_date);
  if (patch.note !== undefined) assign('note', patch.note?.trim() || null);
  if (patch.discount_total !== undefined) assign('discount_total', money(patch.discount_total));
  if (patch.tax_total !== undefined) assign('tax_total', money(patch.tax_total));
  // A party is only meaningful on the type that requires it.
  if (patch.supplier_id !== undefined && invoice.type === 'PURCHASE') {
    assign('supplier_id', patch.supplier_id || null);
  }
  if (patch.customer_id !== undefined && invoice.type === 'SALE') {
    assign('customer_id', patch.customer_id || null);
  }

  if (fields.length) {
    await run(`UPDATE invoices SET ${fields.join(', ')} WHERE id = @id AND org_id = @org`, params);
  }
  return getInvoice(id);
}

// ------------------------------------------------------------------- lines
/**
 * Add a line by barcode. An unrecognised barcode never silently creates an
 * item — it returns 404 + `item_not_found` so the client can open the inline
 * quick-create modal.
 */
export async function addLineByBarcode(invoiceId, { barcode, item_id, quantity = 1, unit_price, update_item_price = true, note }) {
  const invoice = await loadRaw(invoiceId);
  assertDraft(invoice);

  let item;
  if (item_id) {
    item = await getItem(item_id);
  } else {
    const code = String(barcode ?? '').trim();
    if (!code) throw badRequest('الباركود مطلوب', 'BARCODE_REQUIRED');
    item = await findByBarcode(code);
    if (!item) {
      throw notFound('لا يوجد صنف بهذا الباركود', 'ITEM_NOT_FOUND', {
        item_not_found: true, barcode: code,
      });
    }
  }

  const qty = Number(quantity) || 1;
  if (qty <= 0) throw badRequest('الكمية يجب أن تكون أكبر من صفر', 'BAD_QUANTITY');

  // Same barcode scanned twice → bump the existing line instead of duplicating.
  const existing = await get(
    'SELECT * FROM invoice_lines WHERE invoice_id = ? AND item_id = ? AND org_id = ?',
    [invoiceId, item.id, orgId()]);
  if (existing && unit_price === undefined) {
    await run('UPDATE invoice_lines SET quantity = quantity + ? WHERE id = ? AND org_id = ?',
      [qty, existing.id, orgId()]);
    return { invoice: await getInvoice(invoiceId), line_id: existing.id, merged: true, item };
  }

  const price = unit_price !== undefined && unit_price !== null
    ? money(unit_price)
    : money(item[priceColumnOf(invoice.type)]);

  const id = newId();
  const { n: sort } = await get(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM invoice_lines
      WHERE invoice_id = ? AND org_id = ?`, [invoiceId, orgId()]);
  await run(
    `INSERT INTO invoice_lines (id, org_id, invoice_id, item_id, barcode_scanned, quantity,
                                unit_price, update_item_price, note, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId(), invoiceId, item.id, barcode ? String(barcode).trim() : item.barcode, qty, price,
      update_item_price ? 1 : 0, note?.trim() || null, sort]);

  return { invoice: await getInvoice(invoiceId), line_id: id, merged: false, item };
}

export async function updateLine(invoiceId, lineId, patch) {
  assertDraft(await loadRaw(invoiceId));
  const line = await get(
    'SELECT * FROM invoice_lines WHERE id = ? AND invoice_id = ? AND org_id = ?',
    [lineId, invoiceId, orgId()]);
  if (!line) throw notFound('السطر غير موجود', 'LINE_NOT_FOUND');

  const fields = [];
  const params = { id: lineId, org: orgId() };
  if (patch.quantity !== undefined) {
    const q = Number(patch.quantity);
    if (!Number.isInteger(q) || q <= 0) {
      throw badRequest('الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر', 'BAD_QUANTITY');
    }
    fields.push('quantity = @quantity'); params.quantity = q;
  }
  if (patch.unit_price !== undefined) { fields.push('unit_price = @unit_price'); params.unit_price = money(patch.unit_price); }
  if (patch.update_item_price !== undefined) { fields.push('update_item_price = @uip'); params.uip = patch.update_item_price ? 1 : 0; }
  if (patch.note !== undefined) { fields.push('note = @note'); params.note = patch.note?.trim() || null; }

  if (fields.length) {
    await run(`UPDATE invoice_lines SET ${fields.join(', ')} WHERE id = @id AND org_id = @org`, params);
  }
  return getInvoice(invoiceId);
}

export async function removeLine(invoiceId, lineId) {
  assertDraft(await loadRaw(invoiceId));
  const res = await run(
    'DELETE FROM invoice_lines WHERE id = ? AND invoice_id = ? AND org_id = ?',
    [lineId, invoiceId, orgId()]);
  if (!res.changes) throw notFound('السطر غير موجود', 'LINE_NOT_FOUND');
  return getInvoice(invoiceId);
}

// -------------------------------------------------------------------- post
/**
 * Validate a draft without mutating anything — powers the Post button's
 * inline "why is this disabled" reason.
 */
export async function validateForPost(invoiceId) {
  const invoice = await loadRaw(invoiceId);
  const lines = await getLines(invoiceId);
  const problems = [];

  if (invoice.status !== 'DRAFT') problems.push({ code: 'NOT_DRAFT', message: 'الفاتورة ليست مسودة' });
  if (!lines.length) problems.push({ code: 'NO_LINES', message: 'أضف صنفاً واحداً على الأقل' });
  if (invoice.type === 'SALE' && !invoice.customer_id) {
    problems.push({ code: 'CUSTOMER_REQUIRED', message: 'اختر العميل' });
  }
  if (invoice.type === 'PURCHASE' && !invoice.supplier_id) {
    problems.push({ code: 'SUPPLIER_REQUIRED', message: 'اختر المورد' });
  }

  if (directionOf(invoice.type) === 'OUT') {
    for (const s of await shortages(lines)) {
      problems.push({
        code: 'INSUFFICIENT_STOCK', line_id: s.line_id, item_id: s.item_id,
        message: `${s.item_name}: المتوفر ${s.available} والمطلوب ${s.requested}`,
        ...s,
      });
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Aggregate demand per item and compare against the live balance. */
async function shortages(lines) {
  const needed = new Map();
  for (const l of lines) {
    const cur = needed.get(l.item_id)
      || { requested: 0, item_name: l.item_name, line_id: l.id, item_id: l.item_id };
    cur.requested += l.quantity;
    needed.set(l.item_id, cur);
  }
  const out = [];
  for (const [itemId, agg] of needed) {
    const row = await get('SELECT quantity FROM items WHERE id = ? AND org_id = ?',
      [itemId, orgId()]);
    const available = row?.quantity ?? 0;
    if (agg.requested > available) out.push({ ...agg, available });
  }
  return out;
}

/**
 * DRAFT → POSTED. The single action with side effects: writes the stock
 * ledger and propagates prices. Runs as one transaction so a failing line
 * leaves nothing partially applied.
 */
export function postInvoice(invoiceId, { referenceType } = {}) {
  return tx(async () => {
    const invoice = await loadRaw(invoiceId);
    const check = await validateForPost(invoiceId);
    if (!check.ok) {
      const stock = check.problems.filter((p) => p.code === 'INSUFFICIENT_STOCK');
      if (stock.length) {
        throw unprocessable('الكمية غير كافية في المخزون لبعض الأصناف', 'INSUFFICIENT_STOCK', { lines: stock });
      }
      throw unprocessable(check.problems[0].message, check.problems[0].code, { problems: check.problems });
    }

    const lines = await getLines(invoiceId);
    const type = directionOf(invoice.type);
    const priceCol = priceColumnOf(invoice.type);
    const reference = referenceType
      || (invoice.source === 'STOCK_COUNT' ? 'STOCK_COUNT'
        : invoice.source === 'IMPORT' ? 'IMPORT'
          : invoice.source === 'QUICK' ? 'MANUAL' : 'INVOICE');
    const now = nowIso();

    for (const line of lines) {
      await run(
        `INSERT INTO stock_movements (id, org_id, item_id, type, quantity, invoice_id,
                                      reference_type, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [newId(), orgId(), line.item_id, type, line.quantity, invoiceId, reference,
          line.note || invoice.note || null, now]);
      if (line.update_item_price) {
        await run(`UPDATE items SET ${priceCol} = ?, updated_at = ? WHERE id = ? AND org_id = ?`,
          [money(line.unit_price), now, line.item_id, orgId()]);
      }
    }

    await run("UPDATE invoices SET status = 'POSTED', posted_at = ? WHERE id = ? AND org_id = ?",
      [now, invoiceId, orgId()]);
    return getInvoice(invoiceId);
  });
}

export async function cancelInvoice(invoiceId) {
  const invoice = await loadRaw(invoiceId);
  if (invoice.status === 'POSTED') {
    throw unprocessable(
      'لا يمكن إلغاء فاتورة مرحّلة — أنشئ فاتورة عكسية لتصحيح الأثر', 'INVOICE_POSTED');
  }
  await run("UPDATE invoices SET status = 'CANCELLED' WHERE id = ? AND org_id = ?",
    [invoiceId, orgId()]);
  return getInvoice(invoiceId);
}

export async function deleteInvoice(invoiceId) {
  const invoice = await loadRaw(invoiceId);
  if (invoice.status === 'POSTED') throw unprocessable('لا يمكن حذف فاتورة مرحّلة', 'INVOICE_POSTED');
  if (invoice.stock_count_id) {
    throw conflict('لا يمكن حذف فاتورة ناتجة عن جلسة جرد', 'INVOICE_FROM_STOCK_COUNT');
  }
  await run('DELETE FROM invoices WHERE id = ? AND org_id = ?', [invoiceId, orgId()]);
  return { ok: true };
}

// --------------------------------------------------------- quick movements
/**
 * The Stock Movement modal. Every movement must belong to an invoice, so a
 * single-line STOCK_IN/STOCK_OUT document is created and posted atomically —
 * the user sees a one-step action, the ledger stays uniform and auditable.
 */
export async function recordQuickMovement(itemId, { type, quantity, note, unit_price }) {
  const item = await getItem(itemId);
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw badRequest('الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر', 'BAD_QUANTITY');
  }
  if (type !== 'IN' && type !== 'OUT') throw badRequest('نوع الحركة غير صالح', 'BAD_TYPE');

  if (type === 'OUT' && item.quantity < qty) {
    throw unprocessable(
      `الكمية غير كافية — المتوفر ${item.quantity} والمطلوب ${qty}`,
      'INSUFFICIENT_STOCK', { available: item.quantity, requested: qty, item_id: itemId });
  }

  return tx(async () => {
    const invoiceType = type === 'IN' ? 'STOCK_IN' : 'STOCK_OUT';
    const invoice = await createInvoice({
      type: invoiceType, source: 'QUICK', note: note?.trim() || 'حركة مخزون سريعة',
    });
    await addLineByBarcode(invoice.id, {
      item_id: itemId,
      quantity: qty,
      unit_price: unit_price ?? item[priceColumnOf(invoiceType)],
      update_item_price: unit_price !== undefined && unit_price !== null,
      note: note?.trim() || null,
    });
    const posted = await postInvoice(invoice.id, { referenceType: 'MANUAL' });
    return { invoice: posted, item: await getItem(itemId, { withDetail: true }) };
  });
}

// --------------------------------------------------------------- movements
export async function listMovements({ item_id, type, reference_type, date_from, date_to, page, limit }) {
  const where = ['m.org_id = @org'];
  const params = { org: orgId() };
  if (item_id) { where.push('m.item_id = @item_id'); params.item_id = item_id; }
  if (type) { where.push('m.type = @type'); params.type = type; }
  if (reference_type) { where.push('m.reference_type = @reference_type'); params.reference_type = reference_type; }
  // created_at is ISO-8601 text, so the calendar day is its first 10 characters.
  if (date_from) { where.push('left(m.created_at, 10) >= @date_from'); params.date_from = date_from; }
  if (date_to) { where.push('left(m.created_at, 10) <= @date_to'); params.date_to = date_to; }
  const clause = `WHERE ${where.join(' AND ')}`;

  const { n: total } = await get(`SELECT COUNT(*) n FROM stock_movements m ${clause}`, params);
  const rows = await all(
    `SELECT m.*, i.name AS item_name, i.barcode AS item_barcode,
            v.number AS invoice_number, v.type AS invoice_type, v.source AS invoice_source
       FROM stock_movements m
       JOIN items i ON i.id = m.item_id
       LEFT JOIN invoices v ON v.id = m.invoice_id
       ${clause}
      ORDER BY m.created_at DESC, m.seq DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset: (page - 1) * limit },
  );

  return { rows: rows.map(publicRow), total };
}
