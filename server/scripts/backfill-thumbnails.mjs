/**
 * One-off: generate the missing thumbnail sibling for every image already in
 * the uploads folder.
 *
 * New uploads get one automatically (services/images.service.js); this covers
 * everything stored before that existed. Safe to re-run — it skips any image
 * whose thumbnail is already there.
 *
 *   node scripts/backfill-thumbnails.mjs [--dry-run]
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { makeThumbnail, thumbName, isThumbnailable } from '../src/lib/thumbnails.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR
  || path.resolve(process.cwd(), '..', 'data', 'uploads');
const dryRun = process.argv.includes('--dry-run');

const mb = (n) => (n / 1048576).toFixed(2);

const files = await readdir(UPLOADS_DIR);
const originals = files.filter((f) => !f.startsWith('thumb-') && isThumbnailable(f));
const existing = new Set(files.filter((f) => f.startsWith('thumb-')));

console.log(`${UPLOADS_DIR}\n${originals.length} images, ${existing.size} thumbnails already present`);
if (dryRun) console.log('(dry run — nothing will be written)\n');

let made = 0; let skipped = 0; let failed = 0;
let sourceBytes = 0; let thumbBytes = 0;

for (const file of originals) {
  const target = thumbName(file);
  if (existing.has(target)) { skipped += 1; continue; }

  const full = path.join(UPLOADS_DIR, file);
  const { size } = await stat(full);
  const buffer = await readFile(full);
  const thumb = await makeThumbnail(buffer, file);

  if (!thumb) { failed += 1; console.warn(`  ! ${file} — could not render`); continue; }

  sourceBytes += size;
  thumbBytes += thumb.length;
  if (!dryRun) await writeFile(path.join(UPLOADS_DIR, target), thumb);
  made += 1;
  console.log(`  ${file}  ${mb(size)}MB -> ${mb(thumb.length)}MB`);
}

console.log(
  `\n${made} created, ${skipped} already had one, ${failed} failed`
  + (made ? `\n${mb(sourceBytes)}MB of originals -> ${mb(thumbBytes)}MB of thumbnails` : ''),
);
