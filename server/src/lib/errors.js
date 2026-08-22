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
 * Translate raw SQL Server failures into meaningful API errors.
 *
 * mssql/Tedious gives no `.constraint` field the way `pg` did — the numeric
 * SQL Server error number lands in `err.number` (not `err.code`, which is
 * always the generic `'EREQUEST'`), and the offending index/constraint name
 * has to be parsed out of `err.message` instead. 2601 is a duplicate key in a
 * unique *index* (what this schema mostly uses, via `CREATE UNIQUE INDEX`);
 * 2627 is the equivalent for a named `UNIQUE`/`PRIMARY KEY` *constraint*. 547
 * covers both FOREIGN KEY and CHECK violations, disambiguated by the
 * constraint-type phrase SQL Server puts in the message text. The custom
 * BARCODE_TAKEN/LEDGER_IMMUTABLE messages are `THROW`n from triggers as plain
 * text, so matching on `message` for those keeps working unchanged.
 */
export function mapDbError(err) {
  if (err instanceof AppError) return err;

  const message = String(err?.message || '');
  const number = err?.number;

  // Raised by the barcode-uniqueness triggers (cross-table), or hit directly
  // on one of the three tables' own unique index (same-table duplicate).
  if (message.includes('BARCODE_TAKEN')
    || (number === 2601 && /ux_(items|sub_barcodes|item_units)_barcode/.test(message))) {
    return conflict('هذا الباركود مستخدم بالفعل لصنف آخر', 'BARCODE_TAKEN');
  }
  if (message.includes('LEDGER_IMMUTABLE')) {
    return unprocessable('سجل الحركات غير قابل للتعديل أو الحذف', 'LEDGER_IMMUTABLE');
  }
  if (number === 2601 && /ux_categories_name/.test(message)) {
    return conflict('يوجد تصنيف بنفس الاسم', 'CATEGORY_NAME_TAKEN');
  }
  if (number === 547) {
    if (/FOREIGN KEY constraint/i.test(message)) {
      return conflict('لا يمكن إتمام العملية بسبب ارتباط السجل بسجلات أخرى', 'FK_CONSTRAINT');
    }
    // A CHECK violation reaching here means application-level validation
    // missed something — a bug on our side, not a user error — so it is
    // deliberately left to surface as a 500 with the original message logged.
  }
  if (number === 2601 || number === 2627) {
    return conflict('القيمة مستخدمة بالفعل', 'DUPLICATE_VALUE');
  }
  return err;
}

/**
 * Run a database write, converting constraint failures into domain errors at
 * the service boundary so no caller — HTTP, importer or seed — ever sees a
 * raw SQL Server error.
 */
export async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    throw mapDbError(err);
  }
}
