import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import { requireManager, requireNotClerk } from '../lib/roles.js';
import { getSettings, setSettings } from '../db/index.js';
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
    }), req.body);
  res.json(await setSettings(body));
}));

export default router;
