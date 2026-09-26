/**
 * Accounting dashboard route — the money-standing summary (phase 5).
 *
 * Manager-only, like every other money screen: balances, receipts, payments and
 * expenses are exactly what the price-visibility boundary exists to protect.
 */
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { requireManager } from '../lib/roles.js';
import * as accounting from '../services/accounting.service.js';

const router = Router();

router.use(requireManager);

router.get('/dashboard', wrap(async (req, res) => {
  const { date_from: dateFrom, date_to: dateTo } = parse(
    z.object({ date_from: z.string().optional(), date_to: z.string().optional() }),
    req.query,
  );
  res.json(await accounting.accountingDashboard({ dateFrom, dateTo }));
}));

export default router;
