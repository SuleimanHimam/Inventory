import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import * as invoices from '../services/invoices.service.js';

const router = Router();

const INVOICE_TYPE = z.enum(['STOCK_IN', 'STOCK_OUT', 'PURCHASE', 'SALE']);

router.get('/', wrap(async (req, res) => {
  const q = parse(
    pageQuery.extend({
      type: INVOICE_TYPE.optional(),
      status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
      source: z.enum(['USER', 'QUICK', 'STOCK_COUNT', 'IMPORT']).optional(),
      party_id: z.string().optional(),
      search: z.string().trim().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }), req.query);
  const { rows, total } = await invoices.listInvoices(q);
  res.json(paginated(rows, total, q));
}));

router.post('/', wrap(async (req, res) => {
  const body = parse(
    z.object({
      type: INVOICE_TYPE,
      customer_id: z.string().nullish(),
      supplier_id: z.string().nullish(),
      invoice_date: z.string().optional(),
      note: z.string().trim().nullish(),
      discount_total: z.coerce.number().min(0).default(0),
      tax_total: z.coerce.number().min(0).default(0),
    }), req.body);
  // The signed-in user is recorded on the document, not a client-supplied name.
  res.status(201).json(await invoices.createInvoice({ ...body, created_by: req.auth?.email }));
}));

router.get('/:id', wrap(async (req, res) => res.json(await invoices.getInvoice(req.params.id))));

router.patch('/:id', wrap(async (req, res) => {
  const body = parse(
    z.object({
      customer_id: z.string().nullish(),
      supplier_id: z.string().nullish(),
      invoice_date: z.string().optional(),
      note: z.string().trim().nullish(),
      discount_total: z.coerce.number().min(0).optional(),
      tax_total: z.coerce.number().min(0).optional(),
    }), req.body);
  res.json(await invoices.updateInvoice(req.params.id, body));
}));

/** Deletes a draft; a non-draft is cancelled instead, per the API contract. */
router.delete('/:id', wrap(async (req, res) => {
  const invoice = await invoices.getInvoice(req.params.id, { withDetail: false });
  res.json(invoice.status === 'DRAFT'
    ? await invoices.deleteInvoice(req.params.id)
    : await invoices.cancelInvoice(req.params.id));
}));

// ------------------------------------------------------------------- lines
router.post('/:id/lines', wrap(async (req, res) => {
  const body = parse(
    z.object({
      barcode: z.string().trim().optional(),
      item_id: z.string().optional(),
      quantity: z.coerce.number().int().min(1).default(1),
      unit_price: z.coerce.number().min(0).nullish(),
      update_item_price: z.boolean().optional(),
      note: z.string().trim().nullish(),
    }), req.body);
  res.status(201).json(await invoices.addLineByBarcode(req.params.id, body));
}));

router.patch('/:id/lines/:lineId', wrap(async (req, res) => {
  const body = parse(
    z.object({
      quantity: z.coerce.number().int().min(1).optional(),
      unit_price: z.coerce.number().min(0).optional(),
      update_item_price: z.boolean().optional(),
      note: z.string().trim().nullish(),
    }), req.body);
  res.json(await invoices.updateLine(req.params.id, req.params.lineId, body));
}));

router.delete('/:id/lines/:lineId', wrap(async (req, res) =>
  res.json(await invoices.removeLine(req.params.id, req.params.lineId))));

// ---------------------------------------------------------------- lifecycle
router.get('/:id/validate', wrap(async (req, res) =>
  res.json(await invoices.validateForPost(req.params.id))));

router.post('/:id/post', wrap(async (req, res) =>
  res.json(await invoices.postInvoice(req.params.id))));

router.post('/:id/cancel', wrap(async (req, res) =>
  res.json(await invoices.cancelInvoice(req.params.id))));

export default router;
