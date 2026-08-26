import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import { requireNotClerk, requireManager, isManager, CLERK } from '../lib/roles.js';
import { forbidden } from '../lib/errors.js';
import * as invoices from '../services/invoices.service.js';

const router = Router();

const INVOICE_TYPE = z.enum(['STOCK_IN', 'STOCK_OUT']);

/**
 * A clerk sees a sale price, never a purchase price — and `unit_price` is the
 * same key on both, so the redaction filter in lib/roles.js cannot tell them
 * apart by shape alone (see its `canSeeSalePrice`). The boundary that keeps a
 * clerk off a STOCK_IN invoice's purchase prices has to sit here instead,
 * where the invoice's own `type` is available: refuse anything that is not
 * STOCK_OUT, for a clerk, before the handler runs.
 *
 * For `POST /` the type comes from the still-unvalidated body — good enough,
 * since anything else fails `INVOICE_TYPE` in the handler anyway. Every other
 * route here is keyed by `:id`, so its existing invoice is checked instead;
 * this costs one extra lightweight lookup (`withDetail: false`) per request,
 * which is fine at this application's scale.
 */
async function requireStockOutForClerk(req, _res, next) {
  if (req.auth?.role !== CLERK) return next();
  try {
    const type = req.params.id
      ? (await invoices.getInvoice(req.params.id, { withDetail: false })).type
      : req.body?.type;
    if (type !== 'STOCK_OUT') {
      return next(forbidden('حساب موظف الإخراج يعمل على فواتير الإخراج فقط', 'CLERK_STOCK_OUT_ONLY'));
    }
    return next();
  } catch (err) { return next(err); }
}

// The list/search screen only — a clerk still creates, edits and posts its
// own invoices below, it just cannot browse everyone else's.
router.get('/', requireNotClerk, wrap(async (req, res) => {
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
  const { rows, total, summary } = await invoices.listInvoices(q);
  // `summary` carries money, so it is emptied for a staff role by the response
  // filter in lib/roles.js — its keys are listed there.
  res.json({ ...paginated(rows, total, q), summary });
}));

router.post('/', requireStockOutForClerk, wrap(async (req, res) => {
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

router.get('/:id', requireStockOutForClerk, wrap(async (req, res) => res.json(await invoices.getInvoice(req.params.id))));

router.patch('/:id', requireStockOutForClerk, wrap(async (req, res) => {
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

/**
 * Deletes a draft outright. A posted invoice cannot be deleted by anyone —
 * it has consumed a document number and moved stock — so for a manager this
 * reverses it instead: the ledger effect is undone by compensating entries
 * and the document is marked cancelled. Anything else (an already-cancelled
 * document) takes the plain cancel path.
 *
 * The manager check is here rather than as route middleware because the rule
 * is about the invoice's state, not the route: any role may still delete its
 * own draft, which is what it always could do.
 */
router.delete('/:id', requireStockOutForClerk, wrap(async (req, res) => {
  const invoice = await invoices.getInvoice(req.params.id, { withDetail: false });
  if (invoice.status === 'DRAFT') {
    return res.json(await invoices.deleteInvoice(req.params.id));
  }
  if (invoice.status === 'POSTED') {
    if (!isManager(req.auth?.role)) {
      throw forbidden('عكس فاتورة مرحّلة صلاحية للمدير فقط', 'MANAGER_ONLY');
    }
    return res.json(await invoices.reverseInvoice(req.params.id, { by: req.auth?.email }));
  }
  return res.json(await invoices.cancelInvoice(req.params.id));
}));

// ------------------------------------------------------------------- lines
router.post('/:id/lines', requireStockOutForClerk, wrap(async (req, res) => {
  const body = parse(
    z.object({
      barcode: z.string().trim().optional(),
      item_id: z.string().optional(),
      unit_id: z.string().optional(),
      quantity: z.coerce.number().int().min(1).default(1),
      unit_price: z.coerce.number().min(0).nullish(),
      update_item_price: z.boolean().optional(),
      note: z.string().trim().nullish(),
    }), req.body);
  res.status(201).json(await invoices.addLineByBarcode(req.params.id, body));
}));

router.patch('/:id/lines/:lineId', requireStockOutForClerk, wrap(async (req, res) => {
  const body = parse(
    z.object({
      quantity: z.coerce.number().int().min(1).optional(),
      unit_id: z.string().nullish(),
      unit_price: z.coerce.number().min(0).optional(),
      update_item_price: z.boolean().optional(),
      note: z.string().trim().nullish(),
    }), req.body);
  res.json(await invoices.updateLine(req.params.id, req.params.lineId, body));
}));

router.delete('/:id/lines/:lineId', requireStockOutForClerk, wrap(async (req, res) =>
  res.json(await invoices.removeLine(req.params.id, req.params.lineId))));

// ---------------------------------------------------------------- lifecycle
router.get('/:id/validate', requireStockOutForClerk, wrap(async (req, res) =>
  res.json(await invoices.validateForPost(req.params.id))));

router.post('/:id/post', requireStockOutForClerk, wrap(async (req, res) =>
  res.json(await invoices.postInvoice(req.params.id))));

router.post('/:id/cancel', requireStockOutForClerk, wrap(async (req, res) =>
  res.json(await invoices.cancelInvoice(req.params.id))));

/**
 * Manager-only corrections to a posted document. Both undo the ledger effect
 * with compensating entries rather than touching what is already written —
 * see the block comment above `reverseInvoice` in the service.
 *
 * `requireManager` and not a state check inside the handler: unlike DELETE
 * above, there is no version of either action that a non-manager may perform.
 */
router.post('/:id/reverse', requireManager, wrap(async (req, res) =>
  res.json(await invoices.reverseInvoice(req.params.id, { by: req.auth?.email }))));

/** POSTED → DRAFT, keeping the number, so the normal edit endpoints apply. */
router.post('/:id/reopen', requireManager, wrap(async (req, res) =>
  res.json(await invoices.reopenInvoice(req.params.id, { by: req.auth?.email }))));

export default router;
