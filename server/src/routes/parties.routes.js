import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import * as parties from '../services/parties.service.js';

/** One router factory serving both /customers and /suppliers. */
export function partiesRouter(kind) {
  const router = Router();

  const base = {
    name: z.string().trim().min(1, 'الاسم مطلوب').max(255),
    phone: z.string().trim().max(30).nullish(),
    email: z.string().trim().max(255).nullish(),
    address: z.string().trim().nullish(),
    tax_number: z.string().trim().max(50).nullish(),
    notes: z.string().trim().nullish(),
  };
  const body = z.object(
    kind === 'suppliers' ? { ...base, contact_person: z.string().trim().max(255).nullish() } : base,
  );

  router.get('/', wrap(async (req, res) => {
    const q = parse(
      pageQuery.extend({
        search: z.string().trim().optional(),
        is_active: z.enum(['true', 'false']).optional(),
      }), req.query);
    const { rows, total } = await parties.listParties(kind, {
      ...q, is_active: q.is_active === undefined ? undefined : q.is_active === 'true',
    });
    res.json(paginated(rows, total, q));
  }));

  // Non-blocking duplicate-name warning for the create/edit form.
  router.get('/check-name', wrap(async (req, res) => {
    const { name, exclude_id } = parse(
      z.object({ name: z.string().default(''), exclude_id: z.string().optional() }), req.query);
    res.json({ duplicate: await parties.findDuplicateName(kind, name, exclude_id) });
  }));

  router.post('/', wrap(async (req, res) =>
    res.status(201).json(await parties.createParty(kind, parse(body, req.body)))));

  router.get('/:id', wrap(async (req, res) =>
    res.json(await parties.getParty(kind, req.params.id, { withDetail: true }))));

  router.patch('/:id', wrap(async (req, res) =>
    res.json(await parties.updateParty(kind, req.params.id,
      parse(body.partial().extend({ is_active: z.boolean().optional() }), req.body)))));

  router.delete('/:id', wrap(async (req, res) =>
    res.json(await parties.archiveParty(kind, req.params.id))));

  router.post('/:id/restore', wrap(async (req, res) =>
    res.json(await parties.restoreParty(kind, req.params.id))));

  return router;
}
