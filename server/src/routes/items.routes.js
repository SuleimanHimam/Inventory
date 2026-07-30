import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import * as items from '../services/items.service.js';
import { recordQuickMovement, listMovements } from '../services/invoices.service.js';
import {
  addItemImages, removeItemImage, setPrimaryImage, clearItemImages, listItemImages,
  MAX_IMAGE_BYTES, MAX_IMAGES_PER_ITEM,
} from '../services/images.service.js';

// Held in memory: images are small and the service stores the file itself,
// so multer never leaves a stray temp file behind on a rejected upload.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_ITEM },
});

const router = Router();

const priceSchema = z.coerce.number().min(0).default(0);
const itemBody = z.object({
  name: z.string().trim().min(1, 'اسم الصنف مطلوب').max(255),
  category_id: z.string().nullish(),
  barcode: z.string().trim().min(1, 'الباركود مطلوب').max(100),
  purchase_price: priceSchema,
  sale_price: priceSchema,
  low_stock_threshold: z.coerce.number().int().min(0).nullish(),
  source: z.enum(['MANUAL', 'IMPORT']).optional(),
});

// --- specific paths first so they are not swallowed by `/:id` ---------------

router.get('/search', wrap(async (req, res) => {
  const { q, limit } = parse(
    z.object({ q: z.string().default(''), limit: z.coerce.number().int().min(1).max(50).default(12) }),
    req.query);
  res.json({ data: await items.searchItems(q, limit) });
}));

router.get('/barcode/:code', wrap(async (req, res) => {
  const item = await items.findByBarcode(req.params.code);
  if (!item) throw notFound('لا يوجد صنف بهذا الباركود', 'ITEM_NOT_FOUND', { item_not_found: true });
  res.json(item);
}));

router.get('/low-stock', wrap(async (req, res) => {
  const q = parse(pageQuery.extend({ category_id: z.string().optional() }), req.query);
  const { rows, total } = await items.lowStockReport(q);
  res.json(paginated(rows, total, q));
}));

// --- collection ------------------------------------------------------------

router.get('/', wrap(async (req, res) => {
  const q = parse(
    pageQuery.extend({
      search: z.string().trim().optional(),
      category_id: z.string().optional(),
      // Not z.coerce.boolean(): it maps the string "false" to true.
      low_stock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
      sort: z.enum(['name', 'quantity', 'newest', 'price']).optional(),
    }), req.query);
  const { rows, total } = await items.listItems(q);
  res.json(paginated(rows, total, q));
}));

router.post('/', wrap(async (req, res) => {
  res.status(201).json(await items.createItem(parse(itemBody, req.body)));
}));

router.get('/:id', wrap(async (req, res) => {
  res.json(await items.getItem(req.params.id, { withDetail: true }));
}));

router.patch('/:id', wrap(async (req, res) => {
  res.json(await items.updateItem(req.params.id, parse(itemBody.partial(), req.body)));
}));

router.delete('/:id', wrap(async (req, res) => {
  res.json(await items.deleteItem(req.params.id));
}));

// --- sub-barcodes ----------------------------------------------------------

router.get('/:id/subbarcodes', wrap(async (req, res) => {
  await items.getItem(req.params.id);
  res.json({ data: await items.listSubBarcodes(req.params.id) });
}));

router.post('/:id/subbarcodes', wrap(async (req, res) => {
  const body = parse(
    z.object({ barcode: z.string().trim().min(1, 'الباركود مطلوب').max(100), label: z.string().trim().max(120).nullish() }),
    req.body);
  res.status(201).json(await items.addSubBarcode(req.params.id, body));
}));

router.delete('/:id/subbarcodes/:sid', wrap(async (req, res) => {
  res.json(await items.removeSubBarcode(req.params.id, req.params.sid));
}));

/* --------------------------------------------------------- product images */
router.get('/:id/images', wrap(async (req, res) => {
  await items.getItem(req.params.id);
  res.json({ data: await listItemImages(req.params.id) });
}));

// `images` (plural) accepts a batch; `image` stays accepted so an older client
// that posts a single field keeps working.
router.post(
  '/:id/images',
  upload.fields([{ name: 'images' }, { name: 'image' }]),
  wrap(async (req, res) => {
    const files = [...(req.files?.images ?? []), ...(req.files?.image ?? [])];
    res.json({ data: await addItemImages(req.params.id, files) });
  }),
);

router.delete('/:id/images/:imageId', wrap(async (req, res) => {
  res.json({ data: await removeItemImage(req.params.id, req.params.imageId) });
}));

router.post('/:id/images/:imageId/primary', wrap(async (req, res) => {
  res.json({ data: await setPrimaryImage(req.params.id, req.params.imageId) });
}));

router.delete('/:id/images', wrap(async (req, res) => {
  res.json({ data: await clearItemImages(req.params.id) });
}));

// --- movements -------------------------------------------------------------

router.get('/:id/movements', wrap(async (req, res) => {
  await items.getItem(req.params.id);
  const q = parse(pageQuery.extend({ type: z.enum(['IN', 'OUT']).optional() }), req.query);
  const { rows, total } = await listMovements({ ...q, item_id: req.params.id });
  res.json(paginated(rows, total, q));
}));

router.post('/:id/movements', wrap(async (req, res) => {
  const body = parse(
    z.object({
      type: z.enum(['IN', 'OUT']),
      quantity: z.coerce.number().int().min(1, 'الكمية يجب أن تكون 1 على الأقل'),
      note: z.string().trim().max(500).nullish(),
      unit_price: z.coerce.number().min(0).nullish(),
    }), req.body);
  res.status(201).json(await recordQuickMovement(req.params.id, body));
}));

export default router;
