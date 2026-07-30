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

    const existing = barcode
      ? await get('SELECT id, name FROM items WHERE barcode = ? AND org_id = ?', [barcode, orgId()])
        ?? await get(
          `SELECT i.id, i.name FROM sub_barcodes sb JOIN items i ON i.id = sb.item_id
            WHERE sb.barcode = ? AND sb.org_id = ?`, [barcode, orgId()])
      : null;

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
    'INSERT INTO import_batches (id, org_id, filename, payload, created_at) VALUES (?,?,?,?,?)',
    [id, orgId(), filename || 'items.xlsx', JSON.stringify(rows), nowIso()]);

  return { upload_id: id, filename, ...summarise(rows), rows };
}

const summarise = (rows) => ({
  total: rows.length,
  valid_count: rows.filter((r) => r.valid && !r.duplicate).length,
  duplicate_count: rows.filter((r) => r.valid && r.duplicate).length,
  invalid_count: rows.filter((r) => !r.valid).length,
});

/**
 * Commit a previewed batch. Valid rows are created (or upserted); invalid rows
 * are skipped and kept for the downloadable error report. Any opening quantity
 * is posted through a single auto Stock-In invoice so the ledger stays uniform.
 */
export async function commitImport(uploadId, onDuplicate = 'skip') {
  const batch = await get('SELECT * FROM import_batches WHERE id = ? AND org_id = ?',
    [uploadId, orgId()]);
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

      try {
        // Nested tx = savepoint. Postgres aborts the whole transaction on a
        // failed statement, so a row that trips the barcode constraint must be
        // rolled back to a savepoint for the import to carry on past it.
        const item = await tx(async () => createItem({
          name: row.name,
          category_id: row.category ? await ensureCategory(row.category) : null,
          barcode: row.barcode,
          purchase_price: row.purchase_price,
          sale_price: row.sale_price,
          source: 'IMPORT',
        }));
        created.push({ ...row, item_id: item.id });
        if (row.opening_quantity > 0) opening.push({ item_id: item.id, qty: row.opening_quantity });
      } catch (err) {
        rejected.push({
          ...row,
          // `createItem` has already mapped the constraint violation to a domain
          // error, so the code is what identifies it — not the message text.
          reason: err.code === 'BARCODE_TAKEN' || /BARCODE_TAKEN|duplicate key/i.test(String(err.message))
            ? 'الباركود مستخدم بالفعل' : String(err.message),
        });
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
    await run('UPDATE import_batches SET result = ? WHERE id = ? AND org_id = ?',
      [JSON.stringify(result), uploadId, orgId()]);
    return result;
  });
}

/** Excel error report: the rejected rows plus a column explaining each rejection. */
export async function buildErrorReport(uploadId) {
  const batch = await get('SELECT * FROM import_batches WHERE id = ? AND org_id = ?',
    [uploadId, orgId()]);
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
