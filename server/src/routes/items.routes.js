import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { runInOrg } from '../db/index.js';
import { wrap, parse, pageQuery, paginated } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { canSeePrices, canSeeSalePrice, requireItemWrite } from '../lib/roles.js';
import * as items from '../services/items.service.js';
import { listMovements } from '../services/invoices.service.js';
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
const dimensionSchema = z.coerce.number().min(0).nullish();
const itemBody = z.object({
  name: z.string().trim().min(1, 'اسم الصنف مطلوب').max(255),
  category_id: z.string().nullish(),
  barcode: z.string().trim().max(100).nullish(),
  notes: z.string().trim().max(4000).nullish(),
  purchase_price: priceSchema,
  sale_price: priceSchema,
  low_stock_threshold: z.coerce.number().int().min(0).nullish(),
  source: z.enum(['MANUAL', 'IMPORT']).optional(),
  weight_kg: dimensionSchema,
  length_cm: dimensionSchema,
  width_cm: dimensionSchema,
  height_cm: dimensionSchema,
  cbm_m3: dimensionSchema,
});

const unitBody = z.object({
  name: z.string().trim().min(1, 'اسم الوحدة مطلوب').max(120),
  barcode: z.string().trim().min(1, 'باركود الوحدة مطلوب').max(100),
  conversion_factor: z.coerce.number().positive('عامل التحويل يجب أن يكون أكبر من صفر'),
  purchase_price: priceSchema,
  sale_price: priceSchema,
  weight_kg: dimensionSchema,
  length_cm: dimensionSchema,
  width_cm: dimensionSchema,
  height_cm: dimensionSchema,
  cbm_m3: dimensionSchema,
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
      // Same string-not-boolean treatment, same reason.
      in_stock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
      sort: z.enum(['name', 'quantity', 'quantity_desc', 'newest', 'price']).optional(),
    }), req.query);
  // Sorting by price is itself a price disclosure — it orders the whole
  // catalogue by a number this role is not allowed to read. Fall back to the
  // default rather than erroring: the option is not offered in their UI, so
  // reaching here means a hand-made request.
  if (q.sort === 'price' && !canSeeSalePrice(req.auth.role)) q.sort = 'name';
  const { rows, total } = await items.listItems(q);
  res.json(paginated(rows, total, q));
}));

router.post('/', requireItemWrite, wrap(async (req, res) => {
  res.status(201).json(await items.createItem(parse(itemBody, req.body)));
}));

router.get('/:id', wrap(async (req, res) => {
  res.json(await items.getItem(req.params.id, { withDetail: true }));
}));

router.patch('/:id', requireItemWrite, wrap(async (req, res) => {
  res.json(await items.updateItem(req.params.id, parse(itemBody.partial(), req.body)));
}));

router.delete('/:id', requireItemWrite, wrap(async (req, res) => {
  res.json(await items.deleteItem(req.params.id));
}));

// --- sub-barcodes ----------------------------------------------------------

router.get('/:id/subbarcodes', wrap(async (req, res) => {
  await items.getItem(req.params.id);
  res.json({ data: await items.listSubBarcodes(req.params.id) });
}));

router.post('/:id/subbarcodes', requireItemWrite, wrap(async (req, res) => {
  const body = parse(
    z.object({ barcode: z.string().trim().min(1, 'الباركود مطلوب').max(100), label: z.string().trim().max(120).nullish() }),
    req.body);
  res.status(201).json(await items.addSubBarcode(req.params.id, body));
}));

router.delete('/:id/subbarcodes/:sid', requireItemWrite, wrap(async (req, res) => {
  res.json(await items.removeSubBarcode(req.params.id, req.params.sid));
}));

// --- units of measure -------------------------------------------------------

router.get('/:id/units', wrap(async (req, res) => {
  await items.getItem(req.params.id);
  res.json({ data: await items.listUnits(req.params.id) });
}));

router.post('/:id/units', requireItemWrite, wrap(async (req, res) => {
  res.status(201).json(await items.addUnit(req.params.id, parse(unitBody, req.body)));
}));

router.patch('/:id/units/:uid', requireItemWrite, wrap(async (req, res) => {
  res.json(await items.updateUnit(req.params.id, req.params.uid, parse(unitBody.partial(), req.body)));
}));

router.delete('/:id/units/:uid', requireItemWrite, wrap(async (req, res) => {
  res.json(await items.removeUnit(req.params.id, req.params.uid));
}));

/* --------------------------------------------------------- product images */
router.get('/:id/images', wrap(async (req, res) => {
  await items.getItem(req.params.id);
  res.json({ data: await listItemImages(req.params.id) });
}));

// `images` (plural) accepts a batch; `image` stays accepted so an older client
// that posts a single field keeps working.
//
// multer's multipart parsing is event-driven (busboy reading the raw request
// stream), and that async gap does not reliably carry the AsyncLocalStorage
// context the outer `orgContext` middleware set up — by the time this handler
// runs, `orgId()` can throw ORG_CONTEXT_MISSING even though the request is
// authenticated. `req.auth.orgId` was set synchronously by `authenticate`
// before multer ever ran, so it is unaffected; re-entering `runInOrg` here
// re-establishes a scoped connection for the actual database work.
router.post(
  '/:id/images',
  requireItemWrite,
  upload.fields([{ name: 'images' }, { name: 'image' }]),
  wrap(async (req, res) => {
    const files = [...(req.files?.images ?? []), ...(req.files?.image ?? [])];
    const data = await runInOrg(req.auth.orgId, () => addItemImages(req.params.id, files));
    res.json({ data });
  }),
);

router.delete('/:id/images/:imageId', requireItemWrite, wrap(async (req, res) => {
  res.json({ data: await removeItemImage(req.params.id, req.params.imageId) });
}));

router.post('/:id/images/:imageId/primary', requireItemWrite, wrap(async (req, res) => {
  res.json({ data: await setPrimaryImage(req.params.id, req.params.imageId) });
}));

router.delete('/:id/images', requireItemWrite, wrap(async (req, res) => {
  res.json({ data: await clearItemImages(req.params.id) });
}));

// --- movements -------------------------------------------------------------

router.get('/:id/movements', wrap(async (req, res) => {
  await items.getItem(req.params.id);
  const q = parse(pageQuery.extend({ type: z.enum(['IN', 'OUT']).optional() }), req.query);
  const { rows, total } = await listMovements({ ...q, item_id: req.params.id });
  res.json(paginated(rows, total, q));
}));

/*
 * `POST /items/:id/movements` — removed.
 *
 * It was the "quick stock movement" button on an item card: one modal that
 * created and posted a single-line invoice in one step. Removed on request,
 * for every role, and the route goes with the buttons rather than staying
 * behind as an endpoint that devtools could still reach — hiding a control
 * while leaving its endpoint live is not removing the capability.
 *
 * Stock now changes through exactly one user-facing path: build an invoice
 * and post it. That was always the invariant the ledger was designed around
 * (see the service layer's header); this deletes the shortcut that let a
 * stock change look like something other than a document.
 *
 * `recordQuickMovement` itself survives in invoices.service.js: the seed
 * script and the business-rule tests still call it directly, and stocktaking
 * and the Excel importer rely on the same one-line-invoice machinery. Nothing
 * user-facing reaches it any more.
 */

export default router;
