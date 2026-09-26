import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { requirePermission } from '../lib/roles.js';
import * as categories from '../services/categories.service.js';

const router = Router();
const nameBody = z.object({ name: z.string().trim().min(1, 'اسم التصنيف مطلوب').max(120) });

// Reads stay open (money is redacted elsewhere); writes follow the grid.
router.get('/', wrap(async (_req, res) => res.json({ data: await categories.listCategories() })));

router.post('/', requirePermission('categories', 'add'), wrap(async (req, res) =>
  res.status(201).json(await categories.createCategory(parse(nameBody, req.body).name))));

router.patch('/:id', requirePermission('categories', 'edit'), wrap(async (req, res) =>
  res.json(await categories.renameCategory(req.params.id, parse(nameBody, req.body).name))));

router.delete('/:id', requirePermission('categories', 'delete'), wrap(async (req, res) =>
  res.json(await categories.deleteCategory(req.params.id))));

export default router;
