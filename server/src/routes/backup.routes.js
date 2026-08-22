/**
 * Backup, export, import and restore — manager only.
 *
 * Mounted between `authenticate` and `orgContext` in app.js, which is unusual
 * and deliberate. Every other route runs inside one transaction on the
 * inventory database, held open for the whole request; a restore kills every
 * session on that database, so a restore served from inside such a transaction
 * would be killing the connection it is answering on. These handlers therefore
 * have no ambient organisation, and the one place that needs the database
 * (nothing here, currently) would have to open its own.
 *
 * That also means the money-redaction filters do not apply. Nothing below
 * returns anything money-shaped, and `requireManager` guards the router, so
 * the only role that can reach it is the one those filters exempt anyway.
 *
 * Scope worth being explicit about: a backup is of the whole database, not of
 * one organisation. On this deployment they are the same thing, but a restore
 * replaces *everything* — the screen says so, and so does this comment.
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import {
  BACKUP_DIR, MAX_UPLOAD_MB, capabilities, listSets, createSet, streamSet,
  importUpload, restoreSet, deleteSet, pruneSets, copySetTo,
  readConfig, writeConfig, listDirectory,
} from '../lib/backup.js';
import { nextRunAt, lastAutoRun } from '../lib/backupScheduler.js';

const router = Router();

/**
 * To disk, not to memory: a set is tens to hundreds of megabytes and
 * `memoryStorage` would hold the whole thing in the heap — and SQL Server has
 * to read the file from a path anyway, so it has to land on disk regardless.
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(BACKUP_DIR, '.incoming');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, `upload-${Date.now()}-${path.basename(file.originalname)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(zip|bak)$/i.test(file.originalname);
    cb(ok ? null : badRequest('يُقبل ملف ‎.zip‎ أو ‎.bak‎ فقط', 'BAD_FILE_TYPE'), ok);
  },
});

/** Everything the backup screen needs in one request. */
router.get('/', wrap(async (_req, res) => {
  const [caps, sets, config] = await Promise.all([
    capabilities(), listSets(), readConfig(),
  ]);
  res.json({
    capabilities: caps,
    config,
    sets,
    directory: BACKUP_DIR,
    max_upload_mb: MAX_UPLOAD_MB,
    next_run_at: config.auto ? nextRunAt(config).toISOString() : null,
    last_auto_run: lastAutoRun(),
  });
}));

router.post('/', wrap(async (_req, res) => {
  const set = await createSet({ source: 'manual' });

  // A manual backup honours `copy_to` as well. Someone who has configured a
  // second destination means "backups go there", not "scheduled ones do".
  const config = await readConfig();
  let copied = null;
  if (config.copy_to) {
    copied = await copySetTo(set.name, config.copy_to).catch((err) => {
      set.copy_error = err.message;
      return null;
    });
  }

  res.status(201).json({ ...set, copied_to: copied });
}));

/** Export: the set as one `.zip`, streamed. */
router.get('/:name/download', wrap((req, res) => streamSet(req.params.name, res)));

/** Import: a `.zip` or `.bak` produced here or on another machine. */
router.post('/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw badRequest('لم يتم رفع أي ملف', 'NO_FILE');
  res.status(201).json(await importUpload(req.file.path, req.file.originalname));
}));

/**
 * Restore. Destructive, so the client has to name the set *and* say so twice —
 * `confirm: true` is not a UI courtesy, it is what stops a replayed or
 * mistyped request from replacing the database.
 */
router.post('/:name/restore', wrap(async (req, res) => {
  const { confirm } = parse(z.object({ confirm: z.literal(true) }), req.body ?? {});
  void confirm;
  res.json(await restoreSet(req.params.name));
}));

router.delete('/:name', wrap(async (req, res) => {
  await deleteSet(req.params.name);
  res.status(204).end();
}));

/**
 * Folders on the server, for picking a copy destination.
 *
 * A GET with no `path` answers with the drive list. Directory names only —
 * see `listDirectory` for what this deliberately does not expose.
 */
router.get('/browse', wrap(async (req, res) => {
  const { path: target } = parse(z.object({
    path: z.string().trim().max(400).optional(),
  }), req.query);
  res.json(await listDirectory(target || null));
}));

router.patch('/config', wrap(async (req, res) => {
  const patch = parse(z.object({
    auto: z.boolean().optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت بصيغة HH:MM').optional(),
    keep_days: z.coerce.number().int().min(1).max(3650).optional(),
    copy_to: z.string().trim().max(400).optional(),
  }), req.body);

  const config = await writeConfig(patch);
  // Applied straight away rather than at the next scheduled run, so shortening
  // the retention window has a visible effect now.
  const pruned = patch.keep_days ? await pruneSets(config.keep_days) : [];

  res.json({
    config,
    pruned,
    next_run_at: config.auto ? nextRunAt(config).toISOString() : null,
  });
}));

export default router;
