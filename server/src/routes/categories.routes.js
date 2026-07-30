import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import * as categories from '../services/categories.service.js';

const router = Router();
const nameBody = z.object({ name: z.string().trim().min(1, 'اسم التصنيف مطلوب').max(120) });

router.get('/', wrap(async (_req, res) => res.json({ data: await categories.listCategories() })));

router.post('/', wrap(async (req, res) =>
  res.status(201).json(await categories.createCategory(parse(nameBody, req.body).name))));

router.patch('/:id', wrap(async (req, res) =>
  res.json(await categories.renameCategory(req.params.id, parse(nameBody, req.body).name))));

router.delete('/:id', wrap(async (req, res) =>
  res.json(await categories.deleteCategory(req.params.id))));

export default router;
