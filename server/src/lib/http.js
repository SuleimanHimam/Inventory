import { z } from 'zod';
import { AppError, badRequest, mapDbError } from './errors.js';

/** Wrap an async route handler so thrown errors reach the error middleware. */
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Parse `data` with a zod schema, converting failures into a 400. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    throw badRequest(issues[0] ? `${issues[0].field}: ${issues[0].message}` : 'بيانات غير صالحة',
      'VALIDATION_FAILED', { issues });
  }
  return result.data;
}

/** Normalised pagination params shared by every list endpoint. */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export const paginated = (rows, total, { page, limit }) => ({
  data: rows,
  meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
});

/** Terminal error middleware — the single place that shapes error responses. */
export function errorHandler(err, _req, res, _next) {
  // multer rejects oversized uploads before the route runs.
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'حجم الصورة يتجاوز 5 ميغابايت',
      code: 'IMAGE_TOO_LARGE',
    });
  }

  const mapped = mapDbError(err);
  if (mapped instanceof AppError) {
    return res.status(mapped.status).json({
      error: mapped.message,
      code: mapped.code,
      ...(mapped.details || {}),
    });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم', code: 'INTERNAL' });
}
