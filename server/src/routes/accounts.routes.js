/**
 * Chart of Accounts routes.
 *
 * Mounted inside the authenticated chain, under orgContext. Viewing is open to
 * any non-clerk staff (they need to pick accounts on vouchers); creating,
 * editing and deleting are manager-only (requireManager), matching the decision
 * to map accounting access onto the existing roles rather than a new permission
 * system.
 *
 * The chart seeds itself the first time it is read (ensureAccountsSeeded), so a
 * file that predates the accounting module gets the default chart with no
 * migration backfill and no duplicate on later reads.
 */
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { requireManager, requireNotClerk } from '../lib/roles.js';
import * as accounts from '../services/accounts.service.js';

const router = Router();

const accountBody = z.object({
  account_number: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(1).max(400).optional(),
  parent_account_id: z.string().trim().max(64).nullable().optional(),
  account_type_id: z.string().trim().max(64).nullable().optional(),
  is_posting: z.boolean().optional(),
  statement_section: z.string().trim().max(100).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
});

// A clerk has no accounting at all; everyone else may at least read the chart.
router.use(requireNotClerk);

router.get('/types', wrap(async (_req, res) => {
  await accounts.ensureAccountsSeeded();
  res.json({ data: await accounts.listAccountTypes() });
}));

router.get('/', wrap(async (req, res) => {
  await accounts.ensureAccountsSeeded();
  const data = await accounts.listAccounts({
    search: req.query.search,
    activeOnly: String(req.query.active ?? '') === 'true',
  });
  res.json({ data });
}));

router.get('/:id', wrap(async (req, res) => res.json(await accounts.getAccount(req.params.id))));

/**
 * Account statement (كشف حساب) — the ledger lines for one account over a date
 * range, with a running balance. It is a money report, so manager-only, unlike
 * the read routes above which staff use to browse the chart. The balance
 * figures a non-manager could otherwise glimpse on GET /:id are also stripped
 * by the money-redaction filter (see lib/roles.js).
 */
router.get('/:id/statement', requireManager, wrap(async (req, res) => {
  const { date_from: dateFrom, date_to: dateTo } = parse(
    z.object({ date_from: z.string().optional(), date_to: z.string().optional() }),
    req.query,
  );
  res.json(await accounts.accountStatement(req.params.id, { dateFrom, dateTo }));
}));

router.post('/', requireManager, wrap(async (req, res) =>
  res.status(201).json(await accounts.createAccount(parse(accountBody, req.body), req.auth.userId))));

router.patch('/:id', requireManager, wrap(async (req, res) =>
  res.json(await accounts.updateAccount(req.params.id, parse(accountBody, req.body), req.auth.userId))));

router.patch('/:id/active', requireManager, wrap(async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  res.json(await accounts.setAccountActive(req.params.id, active, req.auth.userId));
}));

router.delete('/:id', requireManager, wrap(async (req, res) =>
  res.json(await accounts.deleteAccount(req.params.id))));

export default router;
