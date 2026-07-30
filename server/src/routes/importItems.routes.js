import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import * as imports from '../services/import.service.js';

const router = Router();

// The upload cap is read from the environment rather than the settings table:
// multer runs before any organisation is known, and this is a transport limit,
// not a business rule. The per-organisation `import_max_rows` setting still
// governs how large a workbook may be.
const maxMb = Number(process.env.IMPORT_MAX_FILE_MB ?? 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname)
      || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    cb(ok ? null : badRequest('يُقبل ملف Excel بصيغة ‎.xlsx‎ فقط', 'BAD_FILE_TYPE'), ok);
  },
});

const xlsx = (res, filename) => {
  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
};

router.get('/template', wrap(async (_req, res) => {
  const buffer = await imports.buildTemplate();
  xlsx(res, 'items-import-template.xlsx');
  res.send(Buffer.from(buffer));
}));

router.post('/preview', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw badRequest('لم يتم رفع أي ملف', 'NO_FILE');
  res.json(await imports.previewImport(req.file.buffer, req.file.originalname));
}));

router.post('/commit', wrap(async (req, res) => {
  const body = parse(
    z.object({
      upload_id: z.string().min(1),
      on_duplicate: z.enum(['skip', 'update']).default('skip'),
    }), req.body);
  res.json(await imports.commitImport(body.upload_id, body.on_duplicate));
}));

router.get('/:id/errors', wrap(async (req, res) => {
  const buffer = await imports.buildErrorReport(req.params.id);
  xlsx(res, 'import-errors.xlsx');
  res.send(Buffer.from(buffer));
}));

export default router;
