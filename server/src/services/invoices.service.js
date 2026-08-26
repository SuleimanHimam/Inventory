import {
  all, get, run, tx, money, newId, nowIso, nextNumber, orgId, publicRow,
} from '../db/index.js';
import { notFound, unprocessable, badRequest, conflict } from '../lib/errors.js';
import { getItem, findByBarcode } from './items.service.js';

/** Invoice type → document-number prefix. */
const PREFIX = { STOCK_IN: 'IN', STOCK_OUT: 'OUT' };

/** Types that add stock when posted; the rest subtract it. */
const INBOUND = new Set(['STOCK_IN']);
export const directionOf = (type) => (INBOUND.has(type) ? 'IN' : 'OUT');

/** Which stored price a posted line propagates to. */
const priceColumnOf = (type) => (INBOUND.has(type) ? 'purchase_price' : 'sale_price');

/**
 * Whole number of base-unit stock a line represents. `conversion_factor` is a
 * per-line snapshot (1 for the item's own base unit), so this is the single
 * point of unit-conversion math shared by the outbound-stock guard and the
 * ledger write — a line entered in a fractional-factor unit that doesn't
 * divide evenly is rejected here rather than tripping the ledger's integer
 * CHECK constraint downstream.
 */
function baseQuantity(line) {
  const raw = line.quantity * line.conversion_factor;
  const rounded = Math.round(raw);
  if (Math.abs(raw - rounded) > 1e-6 || rounded <= 0) {
    throw unprocessable(
      'الكمية المدخلة لا تتحول إلى عدد صحيح من الوحدة الأساسية', 'UNIT_QUANTITY_NOT_WHOLE');
  }
  return rounded;
}

const TOTALS = `
  (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) FROM invoice_lines l WHERE l.invoice_id = v.id)`;

/**
 * What the goods on this document cost, from the per-line snapshot taken when
 * it was posted (see `snapshotCosts`). Never reads today's `purchase_price`:
 * that number moves with every new purchase, so using it here would make the
 * profit on a document from March change tomorrow.
 */
const COST_TOTAL = `
  (SELECT COALESCE(SUM(l.quantity * l.cost_price), 0) FROM invoice_lines l WHERE l.invoice_id = v.id)`;

/** Lines whose cost was reconstructed rather than recorded — the UI flags these. */
const COST_ESTIMATED = `
  (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = v.id AND l.cost_basis = 'ESTIMATED')`;

/** Lines with no cost at all: a draft that has never been posted. */
const COST_MISSING = `
  (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = v.id AND l.cost_price IS NULL)`;

const SELECT_INVOICE = `
  SELECT v.*, ${TOTALS} AS subtotal,
         ${TOTALS} - v.discount_total + v.tax_total AS total,
         ${COST_TOTAL} AS cost_total,
         ${COST_ESTIMATED} AS estimated_cost_lines,
         ${COST_MISSING} AS missing_cost_lines,
         (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = v.id) AS line_count,
         s.name AS supplier_name, c.name AS customer_name,
         sc.number AS stock_count_number
    FROM invoices v
    LEFT JOIN suppliers s ON s.id = v.supplier_id
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN stock_counts sc ON sc.id = v.stock_count_id`;

/**
 * Profit on one document, and the three deliberate choices inside it.
 *
 *  1. Only a STOCK_OUT document has one. A purchase is not a loss — it is
 *     inventory moving from cash to shelf — so `profit` is null on a STOCK_IN
 *     rather than a large negative number that would poison every total it
 *     was ever summed into.
 *
 *  2. Revenue is net of the discount and *excludes* tax. Tax collected on
 *     behalf of an authority was never the seller's money, so counting it as
 *     profit would overstate every margin by the tax rate. A discount is the
 *     opposite: it is revenue genuinely given up, so it reduces profit.
 *
 *  3. Margin is expressed against revenue (gross margin), not against cost
 *     (markup). The two are different numbers and the difference is not small
 *     — 50% margin is 100% markup — so the API names which one it means.
 *
 * `exact` is what keeps the figure honest: false as soon as any line's cost
 * was reconstructed by migration 007 rather than recorded at posting time.
 */
const NO_PROFIT = { cost_total: null, profit: null, margin_pct: null, profit_exact: null };

function profitOf(r) {
  if (r.type !== 'STOCK_OUT') return { ...NO_PROFIT };
  /*
   * A line with no cost yet is not a line that cost nothing, and COST_TOTAL
   * cannot tell them apart: SUM over an all-NULL column is NULL and the
   * COALESCE turns it into 0, which would report a draft's entire value as
   * profit at a 100% margin. `getLines` already answers null for exactly this
   * case per line; this is the same answer for the document.
   *
   * It is reachable through the API rather than the UI -- the list excludes
   * drafts and the status filter offers only POSTED and CANCELLED -- but
   * InvoiceDetail.tsx reads `profit != null` as "this document is posted", and
   * that has to be true where the value is produced, not only where today's
   * callers happen to look.
   */
  if (r.missing_cost_lines > 0) return { ...NO_PROFIT };
  const revenue = money(money(r.subtotal) - money(r.discount_total));
  const cost = money(r.cost_total);
  const profit = money(revenue - cost);
  return {
    cost_total: cost,
    profit,
    margin_pct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
    profit_exact: r.missing_cost_lines === 0 && r.estimated_cost_lines === 0,
  };
}

const shape = (r) => {
  if (!r) return r;
  // The two line counts are how `profitOf` decides `profit_exact`; that
  // boolean is the answer callers want, so the raw counts stay internal.
  const { estimated_cost_lines: _est, missing_cost_lines: _missing, ...rest } = r;
  return {
    ...publicRow(rest),
    subtotal: money(r.subtotal),
    total: money(r.total),
    ...profitOf(r),
    party_name: r.supplier_name || r.customer_name || null,
    is_system: r.source !== 'USER',
    is_reversed: !!r.reversed_at,
  };
};

export async function listInvoices({ type, status, party_id, source, search, date_from, date_to, page, limit }) {
  const where = [
    'v.org_id = @org',
    // An invoice nobody has added a line to yet isn't a document worth
    // surfacing — it's litter from a form opened and abandoned, whatever
    // status it ended up in.
    'EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id)',
  ];
  const params = { org: orgId() };
  if (type) { where.push('v.type = @type'); params.type = type; }
  if (status) { where.push('v.status = @status'); params.status = status; }
  else {
    // A draft isn't a document worth surfacing as an invoice even with lines
    // in it — it's still being built by a scanner mid-invoice, not a
    // finished record. Excluded from every unfiltered list/search; still
    // reachable by explicitly asking for status=DRAFT, since that's the one
    // way to recover a specific in-progress draft after e.g. a dropped
    // connection cut a session short.
    where.push("v.status <> 'DRAFT'");
  }
  if (source) { where.push('v.source = @source'); params.source = source; }
  if (party_id) {
    where.push('(v.customer_id = @party_id OR v.supplier_id = @party_id)');
    params.party_id = party_id;
  }
  if (date_from) { where.push('v.invoice_date >= @date_from'); params.date_from = date_from; }
  if (date_to) { where.push('v.invoice_date <= @date_to'); params.date_to = date_to; }
  if (search) {
    params.q = `%${search}%`;
    where.push(`(v.number LIKE @q OR v.note LIKE @q
              OR s.name LIKE @q OR c.name LIKE @q)`);
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const { n: total } = await get(
    `SELECT COUNT(*) n FROM invoices v
       LEFT JOIN suppliers s ON s.id = v.supplier_id
       LEFT JOIN customers c ON c.id = v.customer_id ${clause}`, params);

  const rows = await all(
    `${SELECT_INVOICE} ${clause}
      ORDER BY v.invoice_date DESC, v.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    { ...params, limit, offset: (page - 1) * limit },
  );

  /*
   * Totals for the filtered set — what the date range being looked at is worth.
   *
   * Same `clause`, deliberately: a summary computed over a different set of
   * rows than the table shows is worse than no summary, because it looks
   * authoritative. Change the filters and both move together, by construction.
   *
   * Two narrowings on top of it, both of which the UI states in words:
   *
   *  • POSTED only. A cancelled document is not money that moved, and a draft
   *    is not a document. Counting either would make the total disagree with
   *    the ledger, which is the one number the whole system is built to keep
   *    honest.
   *  • It spans the whole filter, not the current page — a per-page total is a
   *    number nobody asked for.
   */
  /*
   * The per-invoice net is computed in a CROSS APPLY rather than inline inside
   * the SUM(). SQL Server refuses a subquery within an aggregate — "Cannot
   * perform an aggregate function on an expression containing an aggregate or
   * a subquery" (error 130) — where PostgreSQL accepted it. The APPLY makes
   * `t.net` an ordinary column by the time SUM() sees it. Same trap family as
   * the ones in the migration notes; this one only shows up at runtime.
   */
  const totals = await get(
    `SELECT
       COALESCE(SUM(CASE WHEN v.type = 'STOCK_IN'  THEN t.net END), 0) AS in_total,
       COALESCE(SUM(CASE WHEN v.type = 'STOCK_OUT' THEN t.net END), 0) AS out_total,
       COALESCE(SUM(CASE WHEN v.type = 'STOCK_IN'  THEN 1 ELSE 0 END), 0) AS in_count,
       COALESCE(SUM(CASE WHEN v.type = 'STOCK_OUT' THEN 1 ELSE 0 END), 0) AS out_count,
       COALESCE(SUM(CASE WHEN v.type = 'STOCK_OUT' THEN t.revenue - t.cost END), 0) AS profit_total,
       COALESCE(SUM(CASE WHEN v.type = 'STOCK_OUT' AND t.inexact_lines > 0 THEN 1 ELSE 0 END), 0)
         AS inexact_invoices
       FROM invoices v
       LEFT JOIN suppliers s ON s.id = v.supplier_id
       LEFT JOIN customers c ON c.id = v.customer_id
       CROSS APPLY (
         SELECT (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0)
                   FROM invoice_lines l WHERE l.invoice_id = v.id)
                - v.discount_total + v.tax_total AS net,
                (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0)
                   FROM invoice_lines l WHERE l.invoice_id = v.id)
                - v.discount_total AS revenue,
                (SELECT COALESCE(SUM(l.quantity * l.cost_price), 0)
                   FROM invoice_lines l WHERE l.invoice_id = v.id) AS cost,
                (SELECT COUNT(*) FROM invoice_lines l
                  WHERE l.invoice_id = v.id
                    AND (l.cost_price IS NULL OR l.cost_basis = 'ESTIMATED')) AS inexact_lines
       ) t
      ${clause} AND v.status = 'POSTED'`, params);

  const summary = {
    in_total: money(totals.in_total),
    out_total: money(totals.out_total),
    net_total: money(totals.out_total - totals.in_total),
    in_count: totals.in_count,
    out_count: totals.out_count,
    /*
     * Profit over the same filtered set, on the same terms as `profitOf`:
     * sales only, net of discount, before tax, against the cost snapshotted
     * when each document was posted.
     *
     * `net_total` above and `profit_total` here answer different questions and
     * are routinely confused, so it is worth naming the difference: net_total
     * is money that moved (sales minus purchases in this range), profit_total
     * is what was earned on the sales in it. A month with a large restock has
     * a poor net_total and a perfectly healthy profit_total.
     */
    profit_total: money(totals.profit_total),
    profit_exact: totals.inexact_invoices === 0,
  };

  return { rows: rows.map(shape), total, summary };
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
        WHERE m.invoice_id = @id AND m.org_id = @org ORDER BY m.created_at, m.seq`,
      { id, org: orgId() })).map(publicRow);
  }
  return invoice;
}

export async function getLines(invoiceId) {
  // `seq` replaces SQLite's implicit rowid as the insertion-order tie-break.
  // `item_units_json` comes back as JSON text (FOR JSON PATH), not a parsed
  // value the way Postgres's json_agg was — mssql/Tedious has no JSON column
  // type to auto-parse, so it's parsed below instead.
  const rows = await all(
    `SELECT l.*, l.quantity * l.unit_price AS line_total,
            l.quantity * l.cost_price AS line_cost, v.type AS invoice_type,
            i.name AS item_name, i.barcode AS item_barcode, i.quantity AS item_quantity,
            CASE WHEN i.image_file IS NULL THEN NULL
                 ELSE '/uploads/' + i.image_file END AS item_image_url,
            c.name AS category_name,
            u.name AS unit_name, u.barcode AS unit_barcode,
            ISNULL((SELECT iu.id, iu.name, iu.conversion_factor
                      FROM item_units iu WHERE iu.item_id = l.item_id AND iu.org_id = l.org_id
                     ORDER BY iu.conversion_factor
                     FOR JSON PATH), '[]') AS item_units_json
       FROM invoice_lines l
       JOIN invoices v ON v.id = l.invoice_id AND v.org_id = l.org_id
       JOIN items i ON i.id = l.item_id
       LEFT JOIN categories c ON c.id = i.category_id
       LEFT JOIN item_units u ON u.id = l.unit_id AND u.org_id = l.org_id
      WHERE l.invoice_id = @id AND l.org_id = @org ORDER BY l.sort_order, l.seq`,
    { id: invoiceId, org: orgId() });
  return rows.map(({ item_units_json, invoice_type, ...l }) => ({
    ...publicRow(l),
    line_total: money(l.line_total),
    // Per-line margin, on the same terms as the document-level figure in
    // `profitOf`: outbound only, and null rather than 0 when the line has no
    // cost yet, so "not posted" never reads as "sold at cost".
    line_cost: l.cost_price === null ? null : money(l.line_cost),
    line_profit: invoice_type !== 'STOCK_OUT' || l.cost_price === null
      ? null
      : money(money(l.line_total) - money(l.line_cost)),
    update_item_price: !!l.update_item_price,
    item_units: JSON.parse(item_units_json),
  }));
}

const assertDraft = (invoice) => {
  if (invoice.status !== 'DRAFT') {
    throw unprocessable('لا يمكن تعديل فاتورة مرحّلة أو ملغاة', 'INVOICE_NOT_DRAFT');
  }
};

const loadRaw = async (id) => {
  const row = await get('SELECT * FROM invoices WHERE id = @id AND org_id = @org', { id, org: orgId() });
  if (!row) throw notFound('الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
  return row;
};

/**
 * Reap abandoned invoice rows.
 *
 * The entry screen creates its row on arrival, before anything has been keyed
 * in, so every glance at the form leaves a numbered invoice behind. Those rows
 * are unsaved and never listed, which is exactly what makes them dangerous:
 * they accumulate silently. This deployment had 56 of them, invisible, before
 * anyone noticed.
 *
 * Swept here rather than from the client because a browser that is closed
 * mid-invoice never gets to run its own cleanup — and because doing it on
 * unmount would fire under React StrictMode's double-mount and delete the row
 * the operator is about to type into.
 *
 * Only line-less rows are touched, and only after a grace period: another
 * device may have an empty form open right now, and deleting its row out from
 * under it would 404 the first line they add.
 */
const ABANDONED_AFTER_MS = 2 * 60 * 60_000;

async function sweepAbandoned() {
  const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS).toISOString();
  await run(
    `DELETE FROM invoices
      WHERE org_id = @org AND status = 'DRAFT' AND created_at < @cutoff
        AND NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = invoices.id)`,
    { org: orgId(), cutoff },
  );
}

// ------------------------------------------------------------------ create
export async function createInvoice(input) {
  const type = input.type;
  if (!PREFIX[type]) throw badRequest('نوع فاتورة غير معروف', 'BAD_INVOICE_TYPE');

  // Opening a new invoice is the natural moment to clear the last ones that
  // were opened and never used. Failure here must not block the create.
  await sweepAbandoned().catch(() => {});

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
      // No number yet — see 004_number_on_save.sql. The entry screen creates
      // this row on arrival, so minting here meant every reload consumed a
      // number and the sequence ran away from the invoices that were actually
      // kept. postInvoice() mints it at the moment of saving instead.
      number: null,
      supplier_id: input.supplier_id || null,
      customer_id: input.customer_id || null,
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
  if (patch.supplier_id !== undefined) assign('supplier_id', patch.supplier_id || null);
  if (patch.customer_id !== undefined) assign('customer_id', patch.customer_id || null);

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
export async function addLineByBarcode(invoiceId, { barcode, item_id, unit_id, quantity = 1, unit_price, update_item_price = true, note }) {
  const invoice = await loadRaw(invoiceId);
  assertDraft(invoice);

  let item;
  let matchedUnitId = null;
  if (item_id) {
    item = await getItem(item_id, { withDetail: true });
  } else {
    const code = String(barcode ?? '').trim();
    if (!code) throw badRequest('الباركود مطلوب', 'BARCODE_REQUIRED');
    item = await findByBarcode(code);
    if (!item) {
      throw notFound('لا يوجد صنف بهذا الباركود', 'ITEM_NOT_FOUND', {
        item_not_found: true, barcode: code,
      });
    }
    matchedUnitId = item.matched_unit_id;
  }

  // Explicit unit_id (a client-side selector) wins over whatever the barcode
  // scan itself resolved; otherwise falls back to the item's base unit (null).
  const resolvedUnitId = unit_id !== undefined ? unit_id : matchedUnitId;
  let unit = null;
  if (resolvedUnitId) {
    unit = (item.units || []).find((u) => u.id === resolvedUnitId)
      || await get('SELECT * FROM item_units WHERE id = @id AND item_id = @item_id AND org_id = @org',
        { id: resolvedUnitId, item_id: item.id, org: orgId() });
    if (!unit) throw badRequest('وحدة القياس غير صالحة لهذا الصنف', 'UNIT_NOT_FOUND');
  }
  const conversionFactor = unit ? Number(unit.conversion_factor) : 1;

  const qty = Number(quantity) || 1;
  if (qty <= 0) throw badRequest('الكمية يجب أن تكون أكبر من صفر', 'BAD_QUANTITY');
  baseQuantity({ quantity: qty, conversion_factor: conversionFactor }); // validate up front

  // Same item AND same unit scanned twice → bump the existing line instead of
  // duplicating; different units of the same item cannot be merged into one
  // `quantity` column without losing which unit they were in.
  const existing = await get(
    `SELECT * FROM invoice_lines WHERE invoice_id = @invoice_id AND item_id = @item_id
      AND unit_id IS NOT DISTINCT FROM @unit_id AND org_id = @org`,
    { invoice_id: invoiceId, item_id: item.id, unit_id: resolvedUnitId, org: orgId() });
  if (existing && unit_price === undefined) {
    await run('UPDATE invoice_lines SET quantity = quantity + @qty WHERE id = @id AND org_id = @org',
      { qty, id: existing.id, org: orgId() });
    return { invoice: await getInvoice(invoiceId), line_id: existing.id, merged: true, item };
  }

  const priceSource = unit || item;
  const price = unit_price !== undefined && unit_price !== null
    ? money(unit_price)
    : money(priceSource[priceColumnOf(invoice.type)]);

  const id = newId();
  const { n: sort } = await get(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM invoice_lines
      WHERE invoice_id = @invoice_id AND org_id = @org`, { invoice_id: invoiceId, org: orgId() });
  await run(
    `INSERT INTO invoice_lines (id, org_id, invoice_id, item_id, unit_id, conversion_factor,
                                barcode_scanned, quantity, unit_price, update_item_price, note, sort_order)
     VALUES (@id, @org, @invoice_id, @item_id, @unit_id, @conversion_factor,
             @barcode_scanned, @qty, @price, @update_item_price, @note, @sort)`,
    {
      id,
      org: orgId(),
      invoice_id: invoiceId,
      item_id: item.id,
      unit_id: resolvedUnitId,
      conversion_factor: conversionFactor,
      barcode_scanned: barcode ? String(barcode).trim() : item.barcode,
      qty,
      price,
      update_item_price: update_item_price ? 1 : 0,
      note: note?.trim() || null,
      sort,
    });

  return { invoice: await getInvoice(invoiceId), line_id: id, merged: false, item };
}

export async function updateLine(invoiceId, lineId, patch) {
  assertDraft(await loadRaw(invoiceId));
  const line = await get(
    'SELECT * FROM invoice_lines WHERE id = @id AND invoice_id = @invoice_id AND org_id = @org',
    { id: lineId, invoice_id: invoiceId, org: orgId() });
  if (!line) throw notFound('السطر غير موجود', 'LINE_NOT_FOUND');

  const fields = [];
  const params = { id: lineId, org: orgId() };
  const nextQuantity = patch.quantity !== undefined ? Number(patch.quantity) : line.quantity;
  if (patch.quantity !== undefined) {
    if (!Number.isInteger(nextQuantity) || nextQuantity <= 0) {
      throw badRequest('الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر', 'BAD_QUANTITY');
    }
    fields.push('quantity = @quantity'); params.quantity = nextQuantity;
  }

  // Changing unit re-snapshots its conversion factor (and, unless unit_price
  // is also given in this same call, its price) — a "Box" price and a "Piece"
  // price are unrelated numbers, so silently keeping the old one is wrong.
  let nextConversionFactor = line.conversion_factor;
  if (patch.unit_id !== undefined) {
    let unit = null;
    if (patch.unit_id) {
      unit = await get('SELECT * FROM item_units WHERE id = @id AND item_id = @item_id AND org_id = @org',
        { id: patch.unit_id, item_id: line.item_id, org: orgId() });
      if (!unit) throw badRequest('وحدة القياس غير صالحة لهذا الصنف', 'UNIT_NOT_FOUND');
    }
    nextConversionFactor = unit ? Number(unit.conversion_factor) : 1;
    fields.push('unit_id = @unit_id'); params.unit_id = patch.unit_id || null;
    fields.push('conversion_factor = @conversion_factor'); params.conversion_factor = nextConversionFactor;

    if (patch.unit_price === undefined) {
      const invoice = await loadRaw(invoiceId);
      const item = await getItem(line.item_id);
      const priceSource = unit || item;
      fields.push('unit_price = @unit_price');
      params.unit_price = money(priceSource[priceColumnOf(invoice.type)]);
    }
  }

  baseQuantity({ quantity: nextQuantity, conversion_factor: nextConversionFactor });

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
    'DELETE FROM invoice_lines WHERE id = @id AND invoice_id = @invoice_id AND org_id = @org',
    { id: lineId, invoice_id: invoiceId, org: orgId() });
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

/** Aggregate demand per item (converted to base-unit quantities) and compare against the live balance. */
async function shortages(lines) {
  const needed = new Map();
  for (const l of lines) {
    const cur = needed.get(l.item_id)
      || { requested: 0, item_name: l.item_name, line_id: l.id, item_id: l.item_id };
    cur.requested += baseQuantity(l);
    needed.set(l.item_id, cur);
  }
  const out = [];
  for (const [itemId, agg] of needed) {
    const row = await get('SELECT quantity FROM items WHERE id = @id AND org_id = @org',
      { id: itemId, org: orgId() });
    const available = row?.quantity ?? 0;
    if (agg.requested > available) out.push({ ...agg, available });
  }
  return out;
}

/**
 * The cost behind one line, read at the moment of posting.
 *
 * This is the whole of the profit feature's accuracy: `items.purchase_price`
 * is a live number that the next STOCK_IN will overwrite, so the only moment
 * it answers "what did this cost?" for *this* sale is now. Written to
 * `invoice_lines.cost_price`, where it is never touched again.
 *
 * On a STOCK_IN line there is nothing to look up — the line's own price is
 * what was paid, which is why its basis is ACTUAL rather than SNAPSHOT.
 *
 * A line priced in a non-base unit takes that unit's own purchase price when
 * one has been set, because a carton cost and a piece cost are unrelated
 * numbers — the same rule `postInvoice` already applies when propagating
 * prices the other way. Falling back to the base item's price scaled by the
 * line's stored `conversion_factor` keeps a unit nobody ever priced from
 * silently costing zero and reporting the entire sale as profit.
 *
 * Migration 007's backfill implements this identical rule, deliberately: a
 * reconstructed cost and a recorded one should differ in when they were taken,
 * not in what they mean. That includes landing on zero the same way — see the
 * basis chosen at the bottom of this function.
 */
async function costForLine(invoice, line) {
  if (!INBOUND.has(invoice.type)) {
    const item = await get('SELECT purchase_price FROM items WHERE id = @id AND org_id = @org',
      { id: line.item_id, org: orgId() });
    const base = money(item?.purchase_price);

    let cost = base;
    if (line.unit_id) {
      const unit = await get(
        'SELECT purchase_price FROM item_units WHERE id = @id AND org_id = @org',
        { id: line.unit_id, org: orgId() });
      const own = money(unit?.purchase_price);
      cost = own > 0 ? own : money(base * line.conversion_factor);
    }

    /*
     * Zero is not a cost, it is the absence of one. `items.purchase_price` is
     * NOT NULL DEFAULT 0, so an item quick-added or imported without a cost
     * carries 0 rather than NULL, and nothing above can tell that apart from a
     * genuinely free good. Calling it SNAPSHOT would let `profit_exact` claim
     * the resulting 100% margin was recorded fact.
     *
     * ESTIMATED is the honest label and costs nothing to apply: the counting in
     * COST_ESTIMATED, the `profit_exact` flag and the UI's badge all already
     * exist, and this is exactly the case they were built for. Migration 007's
     * backfill reaches the same 0 by the same route, so the two now agree in
     * meaning as well as in arithmetic.
     */
    return { cost, basis: cost > 0 ? 'SNAPSHOT' : 'ESTIMATED' };
  }
  return { cost: money(line.unit_price), basis: 'ACTUAL' };
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
      const ledgerQty = baseQuantity(line);

      // Cost first, then effect. Nothing in a posting run moves a *purchase*
      // price for the document it is costing — an outbound line propagates to
      // sale_price, an inbound one is its own cost — so the read is stable
      // either way; the order is kept because it stays correct if that ever
      // changes, and because it reads in the direction the money moves.
      const { cost, basis } = await costForLine(invoice, line);
      await run(
        'UPDATE invoice_lines SET cost_price = @cost, cost_basis = @basis WHERE id = @id AND org_id = @org',
        { cost, basis, id: line.id, org: orgId() });

      await run(
        `INSERT INTO stock_movements (id, org_id, item_id, type, quantity, invoice_id,
                                      reference_type, note, created_at)
         VALUES (@id, @org, @item_id, @type, @qty, @invoice_id, @reference, @note, @now)`,
        {
          id: newId(),
          org: orgId(),
          item_id: line.item_id,
          type,
          qty: ledgerQty,
          invoice_id: invoiceId,
          reference,
          note: line.note || invoice.note || null,
          now,
        });
      if (line.update_item_price) {
        // A non-base-unit line propagates to that unit's own price, never the
        // base item's — a carton price and a piece price are unrelated numbers.
        if (line.unit_id) {
          await run(`UPDATE item_units SET ${priceCol} = @price, updated_at = @now WHERE id = @id AND org_id = @org`,
            { price: money(line.unit_price), now, id: line.unit_id, org: orgId() });
        } else {
          await run(`UPDATE items SET ${priceCol} = @price, updated_at = @now WHERE id = @id AND org_id = @org`,
            { price: money(line.unit_price), now, id: line.item_id, org: orgId() });
        }
      }
    }

    // The number is minted here, inside the posting transaction, so the
    // sequence only ever advances for invoices that were actually saved and
    // the result has no gaps. Re-posting is impossible (validateForPost
    // rejects anything not DRAFT), so this cannot mint twice for one invoice.
    const number = invoice.number || await nextNumber(invoice.type, PREFIX[invoice.type]);
    await run(
      "UPDATE invoices SET status = 'POSTED', number = @number, posted_at = @now WHERE id = @id AND org_id = @org",
      { number, now, id: invoiceId, org: orgId() });
    return getInvoice(invoiceId);
  });
}

export async function cancelInvoice(invoiceId) {
  const invoice = await loadRaw(invoiceId);
  if (invoice.status === 'POSTED') {
    throw unprocessable(
      'لا يمكن إلغاء فاتورة مرحّلة — أنشئ فاتورة عكسية لتصحيح الأثر', 'INVOICE_POSTED');
  }
  await run("UPDATE invoices SET status = 'CANCELLED' WHERE id = @id AND org_id = @org",
    { id: invoiceId, org: orgId() });
  return getInvoice(invoiceId);
}

/* ==========================================================================
 *  Correcting a posted document (manager only — see invoices.routes.js).
 *
 *  A posted invoice used to be final: cancelInvoice and deleteInvoice both
 *  refused one outright, and the error told the operator to enter a reversing
 *  invoice by hand. That instruction was right about the accounting and wrong
 *  about whose job it was, so the app performs it now.
 *
 *  What has NOT changed is the ledger. `trg_movements_immutable_upd` / `_del`
 *  still THROW on any attempt to update or delete a stock movement, and this
 *  code never tries: a correction is written as new movements in the opposite
 *  direction, each pointing at the entry it undoes. The stock lands where it
 *  should, and both the original error and its correction stay on the record —
 *  which is the difference between an audit trail and a story.
 * ========================================================================== */

/** Movements of this invoice that are still in force — not themselves reversals, and not yet reversed. */
const liveMovements = (invoiceId) => all(
  `SELECT m.* FROM stock_movements m
    WHERE m.invoice_id = @id AND m.org_id = @org
      AND m.reverses_movement_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM stock_movements r
                       WHERE r.reverses_movement_id = m.id AND r.org_id = m.org_id)
    ORDER BY m.seq`,
  { id: invoiceId, org: orgId() });

/**
 * Write the compensating entries for one invoice.
 *
 * Reversing a STOCK_OUT puts stock back and is always safe. Reversing a
 * STOCK_IN takes stock away, and the goods may well have been sold in the
 * meantime — so the same balance guard the posting path applies runs here
 * first, over the net effect per item. Refusing is the right answer: the
 * alternative is a negative balance, which this schema has no representation
 * for and every report downstream would quietly mis-state.
 */
async function reverseLedger(invoiceId, { note }) {
  const movements = await liveMovements(invoiceId);
  if (!movements.length) return 0;

  const delta = new Map();
  for (const m of movements) {
    // The reversal moves the opposite way, so an OUT entry gives stock back.
    const change = m.type === 'IN' ? -m.quantity : m.quantity;
    delta.set(m.item_id, (delta.get(m.item_id) || 0) + change);
  }
  for (const [itemId, change] of delta) {
    if (change >= 0) continue;
    const row = await get('SELECT name, quantity FROM items WHERE id = @id AND org_id = @org',
      { id: itemId, org: orgId() });
    const available = row?.quantity ?? 0;
    if (available + change < 0) {
      throw unprocessable(
        `${row?.name ?? 'الصنف'}: المتوفر ${available} ولا يكفي للتراجع عن ${-change}`,
        'REVERSAL_INSUFFICIENT_STOCK',
        { item_id: itemId, available, required: -change });
    }
  }

  const now = nowIso();
  for (const m of movements) {
    await run(
      `INSERT INTO stock_movements (id, org_id, item_id, type, quantity, invoice_id,
                                    reference_type, note, created_at, reverses_movement_id)
       VALUES (@id, @org, @item_id, @type, @qty, @invoice_id, 'REVERSAL', @note, @now, @reverses)`,
      {
        id: newId(),
        org: orgId(),
        item_id: m.item_id,
        type: m.type === 'IN' ? 'OUT' : 'IN',
        qty: m.quantity,
        invoice_id: invoiceId,
        note,
        now,
        reverses: m.id,
      });
  }
  return movements.length;
}

/**
 * POSTED → CANCELLED, with the ledger effect undone. The "delete" an admin
 * asks for on a document that has already moved stock.
 *
 * The row is not removed. A posted invoice consumed a document number and its
 * movements are on the record permanently; deleting the header would leave a
 * numbered gap and orphan entries pointing at nothing. It is marked instead,
 * and `reversed_at` is what tells this apart from a draft someone abandoned.
 */
export function reverseInvoice(invoiceId, { by } = {}) {
  return tx(async () => {
    const invoice = await loadRaw(invoiceId);
    if (invoice.status !== 'POSTED') {
      throw unprocessable('هذه الفاتورة ليست مرحّلة', 'INVOICE_NOT_POSTED');
    }
    await reverseLedger(invoiceId, { note: `عكس الفاتورة ${invoice.number}` });
    await run(
      `UPDATE invoices SET status = 'CANCELLED', reversed_at = @now, reversed_by = @by
        WHERE id = @id AND org_id = @org`,
      { now: nowIso(), by: by || 'المدير', id: invoiceId, org: orgId() });
    return getInvoice(invoiceId);
  });
}

/**
 * POSTED → DRAFT, with the ledger effect undone: the "edit" half.
 *
 * Reopening deliberately reuses the whole existing draft machinery rather than
 * adding a parallel edit path — once the status is DRAFT again, every line
 * endpoint, `assertDraft`, `validateForPost` and `postInvoice` already do the
 * right thing, and re-posting mints no new number because `postInvoice` only
 * mints when there isn't one. So an edited invoice keeps its identity, and the
 * ledger shows the original entries, their reversal, and the new entries, in
 * that order.
 *
 * `revision` counts the round trips, so "this document has been amended twice"
 * is a fact the UI can state rather than infer.
 */
export function reopenInvoice(invoiceId, { by } = {}) {
  return tx(async () => {
    const invoice = await loadRaw(invoiceId);
    if (invoice.status !== 'POSTED') {
      throw unprocessable('لا يمكن فتح فاتورة غير مرحّلة للتعديل', 'INVOICE_NOT_POSTED');
    }
    if (invoice.stock_count_id) {
      throw conflict('لا يمكن تعديل فاتورة ناتجة عن جلسة جرد', 'INVOICE_FROM_STOCK_COUNT');
    }
    await reverseLedger(invoiceId, { note: `فتح الفاتورة ${invoice.number} للتعديل` });
    await run(
      `UPDATE invoices SET status = 'DRAFT', posted_at = NULL, reopened_at = @now,
                          reopened_by = @by, revision = revision + 1
        WHERE id = @id AND org_id = @org`,
      { now: nowIso(), by: by || 'المدير', id: invoiceId, org: orgId() });
    return getInvoice(invoiceId);
  });
}

export async function deleteInvoice(invoiceId) {
  const invoice = await loadRaw(invoiceId);
  if (invoice.status === 'POSTED') throw unprocessable('لا يمكن حذف فاتورة مرحّلة', 'INVOICE_POSTED');
  if (invoice.stock_count_id) {
    throw conflict('لا يمكن حذف فاتورة ناتجة عن جلسة جرد', 'INVOICE_FROM_STOCK_COUNT');
  }
  await run('DELETE FROM invoices WHERE id = @id AND org_id = @org', { id: invoiceId, org: orgId() });
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
  if (date_from) { where.push('LEFT(m.created_at, 10) >= @date_from'); params.date_from = date_from; }
  if (date_to) { where.push('LEFT(m.created_at, 10) <= @date_to'); params.date_to = date_to; }
  const clause = `WHERE ${where.join(' AND ')}`;

  const { n: total } = await get(`SELECT COUNT(*) n FROM stock_movements m ${clause}`, params);
  const rows = await all(
    `SELECT m.*, i.name AS item_name, i.barcode AS item_barcode,
            v.number AS invoice_number, v.type AS invoice_type, v.source AS invoice_source
       FROM stock_movements m
       JOIN items i ON i.id = m.item_id
       LEFT JOIN invoices v ON v.id = m.invoice_id
       ${clause}
      ORDER BY m.created_at DESC, m.seq DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    { ...params, limit, offset: (page - 1) * limit },
  );

  return { rows: rows.map(publicRow), total };
}
