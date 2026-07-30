import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import * as counts from '../services/stockCounts.service.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const q = parse(
    pageQuery.extend({ status: z.enum(['OPEN', 'SUBMITTED', 'APPLIED', 'CANCELLED']).optional() }),
    req.query);
  const { rows, total } = await counts.listStockCounts(q);
  res.json(paginated(rows, total, q));
}));

router.post('/', wrap(async (req, res) => {
  const body = parse(
    z.object({
      scope: z.enum(['ALL', 'CATEGORY', 'ITEM']),
      category_id: z.string().nullish(),
      item_id: z.string().nullish(),
      created_by: z.string().trim().max(120).optional(),
    }), req.body);
  res.status(201).json(await counts.createStockCount({
    ...body, created_by: body.created_by || req.auth?.email,
  }));
}));

router.get('/:id', wrap(async (req, res) => res.json(await counts.getStockCount(req.params.id))));

router.patch('/:id/lines/:lineId', wrap(async (req, res) => {
  const body = parse(
    z.object({
      counted_quantity: z.coerce.number().int().min(0).nullable().optional(),
      note: z.string().trim().nullish(),
      skipped: z.boolean().optional(),
    }), req.body);
  res.json(await counts.updateCountLine(req.params.id, req.params.lineId, body));
}));

router.post('/:id/refresh-expected', wrap(async (req, res) =>
  res.json(await counts.refreshExpected(req.params.id))));

router.post('/:id/submit', wrap(async (req, res) =>
  res.json(await counts.submitStockCount(req.params.id))));

router.post('/:id/apply', wrap(async (req, res) =>
  res.json(await counts.applyStockCount(req.params.id))));

router.post('/:id/cancel', wrap(async (req, res) =>
  res.json(await counts.cancelStockCount(req.params.id))));

export default router;
