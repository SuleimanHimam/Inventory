import ExcelJS from 'exceljs';
import { get, run, tx, money, newId, nowIso, orgId, getSetting } from '../db/index.js';
import { notFound, badRequest, unprocessable } from '../lib/errors.js';
import { ensureCategory } from './categories.service.js';
import { createItem, updateItem } from './items.service.js';
import { createInvoice, addLineByBarcode, postInvoice } from './invoices.service.js';

/** Template columns, with the Arabic headers the importer also accepts. */
export const COLUMNS = [
  { key: 'name', header: 'name', arabic: 'الاسم', width: 34, required: true },
  { key: 'category', header: 'category', arabic: 'التصنيف', width: 20 },
  { key: 'barcode', header: 'barcode', arabic: 'الباركود', width: 22, required: true },
  { key: 'purchase_price', header: 'purchase_price', arabic: 'سعر الشراء', width: 16, numeric: true },
  { key: 'sale_price', header: 'sale_price', arabic: 'سعر البيع', width: 16, numeric: true },
  { key: 'opening_quantity', header: 'opening_quantity', arabic: 'الكمية الافتتاحية', width: 18, numeric: true },
];

const HEADER_LOOKUP = new Map();
for (const c of COLUMNS) {
  HEADER_LOOKUP.set(c.header, c.key);
  HEADER_LOOKUP.set(c.arabic, c.key);
  HEADER_LOOKUP.set(c.header.replace(/_/g, ' '), c.key);
}

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Which item (if any) already owns this barcode, across every table the
 * uniqueness triggers check — items, sub_barcodes, and item_units. Preview
 * and commit both need this and must agree: previously preview only checked
 * the first two, so a row colliding with a unit-level barcode showed as
 * "ready" and was only rejected later, silently, at commit.
 */
async function findBarcodeOwner(barcode) {
  return get(
    `SELECT TOP (1) id, name FROM (
       SELECT id, name FROM items WHERE org_id = @org AND barcode = @bc
       UNION ALL
       SELECT i.id, i.name FROM sub_barcodes sb JOIN items i ON i.id = sb.item_id
        WHERE sb.org_id = @org AND sb.barcode = @bc
       UNION ALL
       SELECT i.id, i.name FROM item_units iu JOIN items i ON i.id = iu.item_id
        WHERE iu.org_id = @org AND iu.barcode = @bc
     ) owner`,
    { org: orgId(), bc: barcode },
  );
}

/** Build the blank .xlsx template, RTL-aware and pre-styled. */
export async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'نظام إدارة المخزون';
  const ws = wb.addWorksheet('الأصناف', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  ws.getRow(1).height = 24;
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // A worked example so the expected shape is obvious at a glance.
  ws.addRow({
    name: 'قلم حبر أزرق', category: 'قرطاسية', barcode: '6001234567890',
    purchase_price: 1.5, sale_price: 2.5, opening_quantity: 100,
  });
  ws.getRow(2).font = { italic: true, color: { argb: 'FF94A3B8' } };

  const notes = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  notes.columns = [{ width: 26 }, { width: 70 }];
  notes.addRow(['العمود', 'الوصف']).font = { bold: true };
  for (const c of COLUMNS) {
    notes.addRow([
      c.header,
      `${c.arabic}${c.required ? ' — إلزامي' : ' — اختياري'}${c.numeric ? ' (رقم)' : ''}`,
    ]);
  }
  notes.addRow([]);
  notes.addRow(['ملاحظة', 'التصنيف يُنشأ تلقائياً إذا لم يكن موجوداً. احذف صف المثال قبل الرفع.']);

  return wb.xlsx.writeBuffer();
}

/** Parse + validate an uploaded workbook, storing the result for a later commit. */
export async function previewImport(buffer, filename) {
  const maxRows = Number(await getSetting('import_max_rows') ?? 5000);

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw badRequest('تعذّر قراءة الملف — تأكد أنه بصيغة ‎.xlsx‎ صالحة', 'BAD_XLSX');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('الملف لا يحتوي على أي ورقة عمل', 'NO_SHEET');

  // Map the header row onto our known column keys.
  const headerRow = ws.getRow(1);
  const colMap = {};
  headerRow.eachCell((cell, col) => {
    const key = HEADER_LOOKUP.get(norm(cell.value)) ?? HEADER_LOOKUP.get(String(cell.value ?? '').trim());
    if (key) colMap[key] = col;
  });

  const missing = COLUMNS.filter((c) => c.required && !colMap[c.key]).map((c) => c.header);
  if (missing.length) {
    throw badRequest(`أعمدة إلزامية مفقودة: ${missing.join('، ')}`, 'MISSING_COLUMNS', { missing });
  }

  const cellValue = (row, key) => {
    if (!colMap[key]) return null;
    const v = row.getCell(colMap[key]).value;
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return v.result ?? v.text ?? v.richText?.map((t) => t.text).join('') ?? null;
    return v;
  };

  const rows = [];
  const seenBarcodes = new Map();
  let scanned = 0;

  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const raw = Object.fromEntries(COLUMNS.map((c) => [c.key, cellValue(row, c.key)]));
    const isBlank = Object.values(raw).every((v) => v === null || String(v).trim() === '');
    if (isBlank) continue;

    scanned += 1;
    if (scanned > maxRows) {
      throw unprocessable(
        `الملف يتجاوز الحد الأقصى (${maxRows} صف). قسّم الملف إلى أجزاء أصغر.`,
        'TOO_MANY_ROWS', { max_rows: maxRows });
    }

    const errors = [];
    const name = String(raw.name ?? '').trim();
    const barcode = String(raw.barcode ?? '').trim();

    if (!name) errors.push('الاسم مطلوب');
    if (!barcode) errors.push('الباركود مطلوب');
    // A barcode typed into an unformatted Excel cell is stored as a *number*,
    // which drops any leading zero before this code ever sees it — the value
    // is already wrong, not just formatted oddly, and there's no reliable way
    // to reconstruct how many zeros were lost. Reject rather than silently
    // import a barcode that may not match the physical one.
    else if (colMap.barcode && row.getCell(colMap.barcode).type === ExcelJS.ValueType.Number) {
      errors.push('الباركود مخزَّن كرقم في الملف وقد فقد أصفاراً في البداية — نسّق العمود كنص في Excel ثم أعد الرفع');
    }

    const num = (value, label, { integer = false } = {}) => {
      if (value === null || String(value).trim() === '') return 0;
      const n = Number(String(value).replace(/,/g, '').trim());
      if (!Number.isFinite(n) || n < 0) { errors.push(`${label} يجب أن يكون رقماً غير سالب`); return 0; }
      if (integer && !Number.isInteger(n)) { errors.push(`${label} يجب أن يكون عدداً صحيحاً`); return 0; }
      return n;
    };
    const purchase_price = num(raw.purchase_price, 'سعر الشراء');
    const sale_price = num(raw.sale_price, 'سعر البيع');
    const opening_quantity = num(raw.opening_quantity, 'الكمية الافتتاحية', { integer: true });

    if (barcode && seenBarcodes.has(barcode)) {
      errors.push(`باركود مكرر داخل الملف (الصف ${seenBarcodes.get(barcode)})`);
    } else if (barcode) seenBarcodes.set(barcode, r);

    const existing = barcode ? await findBarcodeOwner(barcode) : null;

    rows.push({
      row_number: r,
      name, category: String(raw.category ?? '').trim() || null, barcode,
      purchase_price: money(purchase_price), sale_price: money(sale_price),
      opening_quantity,
      valid: errors.length === 0,
      errors,
      duplicate: !!existing,
      existing_item_id: existing?.id ?? null,
      existing_item_name: existing?.name ?? null,
    });
  }

  if (!rows.length) throw badRequest('لا توجد صفوف بيانات في الملف', 'NO_ROWS');

  const id = newId();
  await run(
    'INSERT INTO import_batches (id, org_id, filename, payload, created_at) VALUES (@id, @org, @filename, @payload, @created_at)',
    { id, org: orgId(), filename: filename || 'items.xlsx', payload: JSON.stringify(rows), created_at: nowIso() });

  return { upload_id: id, filename, ...summarise(rows), rows };
}

const summarise = (rows) => ({
  total: rows.length,
  valid_count: rows.filter((r) => r.valid && !r.duplicate).length,
  duplicate_count: rows.filter((r) => r.valid && r.duplicate).length,
  invalid_count: rows.filter((r) => !r.valid).length,
});

/**
 * Does any item already claim this barcode, across every table the
 * uniqueness triggers check? A plain read, so — unlike attempting the insert
 * and catching a rejection — it can never doom the transaction. SQL Server
 * has no savepoint recovery from a unique-index violation or a trigger THROW
 * (proven in Phase 2: it recovers cleanly from a CHECK violation, but not
 * from either of those), so `commitImport` checks first instead of asking
 * forgiveness — the only path that keeps one bad row from taking the rest of
 * the batch down with it.
 */
async function barcodeTaken(barcode) {
  return !!(await findBarcodeOwner(barcode));
}

/**
 * Commit a previewed batch. Valid rows are created (or upserted); invalid rows
 * are skipped and kept for the downloadable error report. Any opening quantity
 * is posted through a single auto Stock-In invoice so the ledger stays uniform.
 */
export async function commitImport(uploadId, onDuplicate = 'skip') {
  const batch = await get('SELECT * FROM import_batches WHERE id = @id AND org_id = @org',
    { id: uploadId, org: orgId() });
  if (!batch) throw notFound('لم يتم العثور على ملف الاستيراد — أعد رفعه', 'IMPORT_NOT_FOUND');
  if (batch.result) throw unprocessable('تم تنفيذ هذا الاستيراد مسبقاً', 'IMPORT_ALREADY_COMMITTED');

  const rows = JSON.parse(batch.payload);

  return tx(async () => {
    const created = [];
    const updated = [];
    const skipped = [];
    const rejected = rows.filter((r) => !r.valid)
      .map((r) => ({ ...r, reason: r.errors.join('؛ ') }));
    const opening = [];

    for (const row of rows) {
      if (!row.valid) continue;

      if (row.duplicate) {
        if (onDuplicate === 'skip') {
          skipped.push({ ...row, reason: 'باركود موجود مسبقاً — تم تخطي الصف' });
          continue;
        }
        const patch = {
          name: row.name,
          purchase_price: row.purchase_price,
          sale_price: row.sale_price,
        };
        if (row.category) patch.category_id = await ensureCategory(row.category);
        await updateItem(row.existing_item_id, patch);
        updated.push({ ...row, item_id: row.existing_item_id });
        if (row.opening_quantity > 0) opening.push({ item_id: row.existing_item_id, qty: row.opening_quantity });
        continue;
      }

      // Re-checked here, not just at preview time: the two happen in separate
      // requests, and this read is what keeps createItem() below from ever
      // hitting the barcode-uniqueness trigger for an expected collision.
      if (await barcodeTaken(row.barcode)) {
        rejected.push({ ...row, reason: 'الباركود مستخدم بالفعل' });
        continue;
      }

      try {
        const item = await createItem({
          name: row.name,
          category_id: row.category ? await ensureCategory(row.category) : null,
          barcode: row.barcode,
          purchase_price: row.purchase_price,
          sale_price: row.sale_price,
          source: 'IMPORT',
        });
        created.push({ ...row, item_id: item.id });
        if (row.opening_quantity > 0) opening.push({ item_id: item.id, qty: row.opening_quantity });
      } catch (err) {
        // The barcodeTaken() check above should make this unreachable in
        // practice — a genuine race with a concurrent writer is the only way
        // to still land here. If it doomed the transaction, there is nothing
        // left to recover: every row after this one would fail too, so the
        // whole commit aborts and the caller has to resubmit.
        if (err.transactionDoomed) throw err;
        rejected.push({ ...row, reason: String(err.message) });
      }
    }

    // Opening balances become one auto Stock-In document.
    let openingInvoice = null;
    if (opening.length) {
      const invoice = await createInvoice({
        type: 'STOCK_IN', source: 'IMPORT',
        note: `أرصدة افتتاحية — استيراد ${batch.filename}`,
      });
      for (const o of opening) {
        await addLineByBarcode(invoice.id, {
          item_id: o.item_id, quantity: o.qty, unit_price: 0, update_item_price: false,
        });
      }
      openingInvoice = await postInvoice(invoice.id, { referenceType: 'IMPORT' });
    }

    const result = {
      created_count: created.length,
      updated_count: updated.length,
      skipped_count: skipped.length,
      rejected_count: rejected.length,
      opening_invoice: openingInvoice && { id: openingInvoice.id, number: openingInvoice.number },
      rejected: [...rejected, ...skipped],
    };
    await run('UPDATE import_batches SET result = @result WHERE id = @id AND org_id = @org',
      { result: JSON.stringify(result), id: uploadId, org: orgId() });
    return result;
  });
}

/** Excel error report: the rejected rows plus a column explaining each rejection. */
export async function buildErrorReport(uploadId) {
  const batch = await get('SELECT * FROM import_batches WHERE id = @id AND org_id = @org',
    { id: uploadId, org: orgId() });
  if (!batch) throw notFound('لم يتم العثور على ملف الاستيراد', 'IMPORT_NOT_FOUND');

  const rows = batch.result
    ? JSON.parse(batch.result).rejected
    : JSON.parse(batch.payload).filter((r) => !r.valid).map((r) => ({ ...r, reason: r.errors.join('؛ ') }));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الصفوف المرفوضة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'الصف', key: 'row_number', width: 8 },
    ...COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width })),
    { header: 'سبب الرفض', key: 'reason', width: 46 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
  for (const r of rows) ws.addRow(r);

  return wb.xlsx.writeBuffer();
}
