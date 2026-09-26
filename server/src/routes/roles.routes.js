/**
 * Role administration — manager only.
 *
 * A role is a named permission grid (see services/roles.service.js). The three
 * built-in roles can have their grids tuned but not be renamed or deleted;
 * custom roles are fully editable. Assigning a role to a user lives on the users
 * routes, next to the rest of the membership edits.
 */
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { requireManager } from '../lib/roles.js';
import {
  listRoles, createRole, updateRole, deleteRole, RESOURCES, ACTIONS,
} from '../services/roles.service.js';

const router = Router();
router.use(requireManager);

// A permission grid: resource -> the five action flags. Loose by design — any
// unknown resource key is simply ignored by the service, which writes one row
// per known screen.
const permsSchema = z.record(
  z.string(),
  z.object({
    view: z.boolean().optional(),
    add: z.boolean().optional(),
    edit: z.boolean().optional(),
    delete: z.boolean().optional(),
    see_prices: z.boolean().optional(),
  }),
).optional();

/** The screen catalogue and action list, so the editor renders the same grid. */
router.get('/meta', wrap(async (_req, res) => res.json({ resources: RESOURCES, actions: ACTIONS })));

router.get('/', wrap(async (_req, res) => res.json({ data: await listRoles() })));

router.post('/', wrap(async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(1).max(80),
    permissions: permsSchema,
  }), req.body);
  res.status(201).json(await createRole(body));
}));

router.patch('/:id', wrap(async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(1).max(80).optional(),
    permissions: permsSchema,
  }), req.body);
  res.json(await updateRole(req.params.id, body));
}));

router.delete('/:id', wrap(async (req, res) => res.json(await deleteRole(req.params.id))));

export default router;
