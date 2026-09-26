import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import { requireManager, requireNotClerk } from '../lib/roles.js';
import { notFound } from '../lib/errors.js';
import { getSettings, setSettings, get, all, run, newId } from '../db/index.js';
import { dashboardStats, DASHBOARD_PERIODS } from '../services/items.service.js';
import { listMovements } from '../services/invoices.service.js';

const router = Router();

/*
 * `period` picks the window the trading figures cover. Validated against the
 * known list rather than passed through: it reaches a date computation and an
 * unrecognised value should fall back to the default, not produce a window
 * nobody asked for.
 */
/** `invoice_date` is stored as an ISO day, and only that shape may reach it. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (value) => (ISO_DAY.test(String(value ?? '')) ? String(value) : undefined);

router.get('/dashboard', requireNotClerk, wrap(async (req, res) => {
  const asked = String(req.query.period ?? '');
  const period = DASHBOARD_PERIODS.includes(asked) ? asked : 'month';
  // Shape-checked rather than trusted. The values are bound as parameters
  // either way, but a date that is not a date can only produce a window nobody
  // asked for, and silently dropping it is the better failure.
  res.json(await dashboardStats({
    period,
    from: day(req.query.from),
    to: day(req.query.to),
  }));
}));

/** Who am I, and which organisation am I in — drives the account menu. */
router.get('/me', wrap((req, res) => res.json({
  user: { id: req.auth.userId, email: req.auth.email },
  org: { id: req.auth.orgId, role: req.auth.role },
})));

/** Global movement log across every item. */
router.get('/movements', wrap(async (req, res) => {
  const q = parse(
    pageQuery.extend({
      item_id: z.string().optional(),
      type: z.enum(['IN', 'OUT']).optional(),
      reference_type: z.enum(['MANUAL', 'STOCK_COUNT', 'IMPORT', 'INVOICE']).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }), req.query);
  const { rows, total } = await listMovements(q);
  res.json(paginated(rows, total, q));
}));

// Readable by everyone — currency and digit system drive number formatting on
// every screen. Writable by a manager only, one line below.
router.get('/settings', wrap(async (_req, res) => res.json(await getSettings())));

router.patch('/settings', requireManager, wrap(async (req, res) => {
  const body = parse(
    z.object({
      low_stock_threshold: z.coerce.number().int().min(0).optional(),
      import_max_rows: z.coerce.number().int().min(1).max(100000).optional(),
      import_max_file_mb: z.coerce.number().int().min(1).max(100).optional(),
      company_name: z.string().trim().max(200).optional(),
      currency: z.string().trim().max(10).optional(),
      digits: z.enum(['latn', 'arab']).optional(),
      // Default voucher accounts — an account id, or '' to clear the default.
      voucher_receipt_cash_account: z.string().trim().max(64).optional(),
      voucher_receipt_counter_account: z.string().trim().max(64).optional(),
      voucher_payment_cash_account: z.string().trim().max(64).optional(),
      voucher_payment_counter_account: z.string().trim().max(64).optional(),
      invoice_sales_account: z.string().trim().max(64).optional(),
      invoice_purchase_account: z.string().trim().max(64).optional(),
      invoice_cash_account: z.string().trim().max(64).optional(),
      invoice_customers_parent: z.string().trim().max(64).optional(),
      invoice_suppliers_parent: z.string().trim().max(64).optional(),
    }), req.body);
  res.json(await setSettings(body));
}));

/*
 * The manager's private notepad — many notes now, searchable and filterable,
 * manager-only on every verb. Kept out of /settings precisely because that
 * endpoint is readable by every role (migration 010).
 */
const noteBody = z.object({
  title: z.string().trim().max(200).optional(),
  body: z.string().max(20000).optional(),
  pinned: z.boolean().optional(),
});

router.get('/notes', requireManager, wrap(async (req, res) => {
  const params = { org: req.auth.orgId };
  let where = 'org_id = @org';
  const search = String(req.query.search ?? '').trim();
  if (search) { params.q = `%${search}%`; where += ' AND (title LIKE @q OR body LIKE @q)'; }
  if (String(req.query.pinned ?? '') === 'true') where += ' AND pinned = 1';

  const rows = await all(
    `SELECT id, title, body, pinned, created_at, updated_at
       FROM manager_notes WHERE ${where}
      ORDER BY pinned DESC, updated_at DESC`,
    params,
  );
  res.json({ data: rows.map((r) => ({ ...r, pinned: !!r.pinned })) });
}));

router.post('/notes', requireManager, wrap(async (req, res) => {
  const { title = '', body = '', pinned = false } = parse(noteBody, req.body);
  const id = newId();
  await run(
    `INSERT INTO manager_notes (id, org_id, title, body, pinned)
     VALUES (@id, @org, @title, @body, @pinned)`,
    { id, org: req.auth.orgId, title, body, pinned: pinned ? 1 : 0 },
  );
  res.status(201).json({ id });
}));

router.patch('/notes/:id', requireManager, wrap(async (req, res) => {
  const { title, body, pinned } = parse(noteBody, req.body);
  // COALESCE keeps any field the request left out, so a pin toggle from the
  // list and a full edit from the editor both use one statement.
  const result = await run(
    `UPDATE manager_notes SET
       title = COALESCE(@title, title),
       body = COALESCE(@body, body),
       pinned = COALESCE(@pinned, pinned),
       updated_at = dbo.iso_now()
     WHERE id = @id AND org_id = @org`,
    {
      id: req.params.id,
      org: req.auth.orgId,
      title: title ?? null,
      body: body ?? null,
      pinned: pinned === undefined ? null : (pinned ? 1 : 0),
    },
  );
  if (!result.changes) throw notFound('الملاحظة غير موجودة', 'NOTE_NOT_FOUND');
  res.json({ ok: true });
}));

router.delete('/notes/:id', requireManager, wrap(async (req, res) => {
  await run('DELETE FROM manager_notes WHERE id = @id AND org_id = @org',
    { id: req.params.id, org: req.auth.orgId });
  res.status(204).end();
}));

export default router;
