/**
 * Domain error carrying an HTTP status plus an optional machine-readable code
 * and detail payload. The error middleware renders it as
 * `{ error, code?, ...details }` exactly as the API contract specifies.
 */
export class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, code, details) => new AppError(400, msg, code, details);
export const unauthorized = (msg = 'تسجيل الدخول مطلوب', code, details) => new AppError(401, msg, code, details);
export const forbidden = (msg = 'لا تملك صلاحية الوصول', code, details) => new AppError(403, msg, code, details);
export const notFound = (msg = 'غير موجود', code, details) => new AppError(404, msg, code, details);
export const conflict = (msg, code, details) => new AppError(409, msg, code, details);
/** 422 — the request was well-formed but violates a business rule. */
export const unprocessable = (msg, code, details) => new AppError(422, msg, code, details);
/** 503 — the request is fine; this deployment is not configured to serve it. */
export const unavailable = (msg, code, details) => new AppError(503, msg, code, details);

/**
 * Translate raw Postgres failures into meaningful API errors.
 *
 * Note the difference from the SQLite build: SQLite named the offending
 * `table.column` in the message, Postgres names the *constraint* and puts the
 * SQLSTATE in `err.code` — so the patterns below match index names, which is
 * why migrations/001_core.sql keeps the original `ux_…` names.
 */
export function mapDbError(err) {
  if (err instanceof AppError) return err;

  const message = String(err?.message || '');
  const constraint = err?.constraint || '';
  const sqlstate = err?.code || '';

  // Raised by trg_barcode_unique(), or hit directly on the per-org unique index.
  if (message.includes('BARCODE_TAKEN')
    || constraint === 'ux_items_barcode' || constraint === 'ux_sub_barcodes_barcode') {
    return conflict('هذا الباركود مستخدم بالفعل لصنف آخر', 'BARCODE_TAKEN');
  }
  if (constraint === 'ux_categories_name') {
    return conflict('يوجد تصنيف بنفس الاسم', 'CATEGORY_NAME_TAKEN');
  }
  if (message.includes('LEDGER_IMMUTABLE')) {
    return unprocessable('سجل الحركات غير قابل للتعديل أو الحذف', 'LEDGER_IMMUTABLE');
  }
  if (sqlstate === '23503') { // foreign_key_violation
    return conflict('لا يمكن إتمام العملية بسبب ارتباط السجل بسجلات أخرى', 'FK_CONSTRAINT');
  }
  if (sqlstate === '23505') { // unique_violation
    return conflict('القيمة مستخدمة بالفعل', 'DUPLICATE_VALUE');
  }
  // RLS rejecting a write is a tenancy bug on our side, not a user error, so it
  // is deliberately left to surface as a 500 with the original message logged.
  return err;
}

/**
 * Run a database write, converting constraint failures into domain errors at
 * the service boundary so no caller — HTTP, importer or seed — ever sees a
 * raw Postgres error.
 */
export async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    throw mapDbError(err);
  }
}
