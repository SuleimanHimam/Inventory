/**
 * Voucher routes — Cash Receipt (سند قبض) and Payment (سند صرف).
 *
 * A voucher is money end to end — an amount, a cash account, the party it came
 * from or went to — so the whole resource is manager-only, the same role that
 * sees prices everywhere else. Staff read the Chart of Accounts but never touch
 * the ledger; a clerk has no accounting at all. Hence `requireManager` on the
 * router rather than a per-route guard.
 */
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import { requireManager } from '../lib/roles.js';
import * as vouchers from '../services/vouchers.service.js';

const router = Router();

router.use(requireManager);

const VOUCHER_TYPE = z.enum(['RECEIPT', 'PAYMENT']);

router.get('/', wrap(async (req, res) => {
  const q = parse(
    pageQuery.extend({
      type: VOUCHER_TYPE.optional(),
      status: z.enum(['POSTED', 'REVERSED']).optional(),
      party_id: z.string().optional(),
      search: z.string().trim().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      expense_only: z.coerce.boolean().optional(),
    }), req.query);
  const { rows, total, summary } = await vouchers.listVouchers(q);
  res.json({ ...paginated(rows, total, q), summary });
}));

router.get('/:id', wrap(async (req, res) => res.json(await vouchers.getVoucher(req.params.id))));

router.post('/', wrap(async (req, res) => {
  const body = parse(
    z.object({
      type: VOUCHER_TYPE,
      amount: z.coerce.number().positive(),
      cash_account_id: z.string().trim().min(1),
      counter_account_id: z.string().trim().min(1),
      voucher_date: z.string().optional(),
      party_type: z.enum(['customer', 'supplier']).nullish(),
      party_id: z.string().trim().nullish(),
      counterparty: z.string().trim().max(400).nullish(),
      payment_method: z.enum(['CASH', 'BANK', 'CHEQUE', 'TRANSFER']).optional(),
      reference: z.string().trim().max(200).nullish(),
      description: z.string().trim().max(4000).nullish(),
    }), req.body);
  res.status(201).json(await vouchers.createVoucher(body, req.auth?.email));
}));

/** Manager correction: compensating entries, voucher marked REVERSED. */
router.post('/:id/reverse', wrap(async (req, res) =>
  res.json(await vouchers.reverseVoucher(req.params.id, req.auth?.email))));

export default router;
