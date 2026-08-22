import crypto from 'node:crypto';
import { all, get, run, tx, orgId } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { putObject, deleteObject } from '../lib/storage.js';
import { makeThumbnail, thumbName, isThumbnailable } from '../lib/thumbnails.js';

/**
 * Every format a browser can display directly via <img>, without conversion.
 * Deliberately excludes HEIC/HEIF (the default format on iPhone cameras) and
 * TIFF/RAW — no browser renders those natively, so accepting the upload would
 * just trade "rejected at upload" for "silently broken image everywhere it's
 * shown". An iPhone can be switched to save photos as JPEG instead: Settings →
 * Camera → Formats → Most Compatible.
 */
const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/bmp', '.bmp'],
  ['image/avif', '.avif'],
  ['image/svg+xml', '.svg'],
]);

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Cap per item. Not a technical limit — a shelf photo, a label close-up and a
 * packaging shot cover the job, and an unbounded gallery turns the uploads
 * folder into a dumping ground.
 */
export const MAX_IMAGES_PER_ITEM = 8;

/** Remove an image, ignoring an already-missing one. */
async function unlinkQuietly(file) {
  try {
    await deleteObject(file);
  } catch (error) {
    console.warn('[images] could not remove', file, error.message);
  }
}

/**
 * Remove a stored image *and* its derived thumbnail.
 *
 * The thumbnail has no database row of its own, so nothing else would ever
 * clean it up — without this every delete would leak a file into the uploads
 * folder forever. Missing siblings are ignored: images uploaded before
 * thumbnailing existed simply have none.
 */
async function unlinkWithThumb(file) {
  await unlinkQuietly(file);
  if (isThumbnailable(file)) await unlinkQuietly(thumbName(file));
}

async function requireItem(itemId) {
  const item = await get(
    'SELECT id FROM items WHERE id = @id AND deleted_at IS NULL AND org_id = @org', { id: itemId, org: orgId() });
  if (!item) throw new AppError(404, 'الصنف غير موجود', 'ITEM_NOT_FOUND');
  return item;
}

function touch(itemId) {
  return run('UPDATE items SET updated_at = dbo.iso_now() WHERE id = @id AND org_id = @org',
    { id: itemId, org: orgId() });
}

/** Every photo of an item, primary first. */
export function listItemImages(itemId) {
  return all(
    `SELECT id, item_id, [file], sort_order, created_at,
            '/uploads/' + [file] AS url
       FROM item_images
      WHERE item_id = @id AND org_id = @org
      ORDER BY sort_order, created_at`, { id: itemId, org: orgId() });
}

function validate(file) {
  const extension = ALLOWED.get(file.mimetype);
  if (!extension) {
    throw new AppError(
      415,
      'صيغة الصورة غير مدعومة — استخدم JPG أو PNG أو WEBP أو GIF أو BMP أو SVG أو AVIF '
        + '(صور iPhone بصيغة HEIC غير مدعومة — غيّر الإعداد إلى JPEG من الكاميرا: '
        + 'الإعدادات ← الكاميرا ← التنسيقات ← الأكثر توافقاً)',
      'UNSUPPORTED_IMAGE_TYPE',
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AppError(413, 'حجم الصورة يتجاوز 20 ميغابايت', 'IMAGE_TOO_LARGE');
  }
  return extension;
}

/**
 * Append one or more photos to an item's gallery.
 *
 * Files are stored before the insert, and deleted again if the insert throws,
 * so a failed upload never leaves either a stray object or a row pointing at
 * nothing.
 */
export async function addItemImages(itemId, files) {
  if (!files?.length) throw new AppError(400, 'لم يتم إرسال أي ملف', 'NO_FILE');
  await requireItem(itemId);

  const { n: existing } = await get(
    'SELECT COUNT(*) n FROM item_images WHERE item_id = @id AND org_id = @org', { id: itemId, org: orgId() });
  if (existing + files.length > MAX_IMAGES_PER_ITEM) {
    throw new AppError(
      422,
      `الحد الأقصى ${MAX_IMAGES_PER_ITEM} صور للصنف الواحد — الحالي ${existing}`,
      'TOO_MANY_IMAGES',
    );
  }

  // `written` is every file put in storage, for rollback. `originals` is only
  // the images themselves — thumbnails are derived files with no row of their
  // own, so they must never reach the INSERT loop below.
  const written = [];
  const originals = [];
  try {
    for (const file of files) {
      const extension = validate(file);
      // Random name: the original filename is untrusted and could collide.
      const name = `${crypto.randomUUID()}${extension}`;
      await putObject(name, file.buffer, file.mimetype);
      written.push(name);
      originals.push(name);

      // Best-effort sibling thumbnail — list views load this instead of the
      // multi-megabyte original (see lib/thumbnails.js). A failure here is
      // deliberately not fatal: the original is already stored, and the
      // client falls back to it when no thumbnail exists.
      const thumb = await makeThumbnail(file.buffer, name);
      if (thumb) {
        const tname = thumbName(name);
        await putObject(tname, thumb, 'image/webp');
        written.push(tname);
      }
    }

    const { n: nextOrder } = await get(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM item_images WHERE item_id = @id AND org_id = @org',
      { id: itemId, org: orgId() });

    await tx(async () => {
      for (const [index, name] of originals.entries()) {
        await run(
          'INSERT INTO item_images (id, org_id, item_id, [file], sort_order) VALUES (@rid, @org, @id, @name, @order)',
          { rid: crypto.randomUUID(), org: orgId(), id: itemId, name, order: nextOrder + index });
      }
      await touch(itemId);
    });
  } catch (error) {
    await Promise.all(written.map(unlinkQuietly));
    throw error;
  }

  return listItemImages(itemId);
}

/** Delete one photo. The trigger promotes the next one to primary. */
export async function removeItemImage(itemId, imageId) {
  await requireItem(itemId);
  const image = await get(
    'SELECT id, [file] FROM item_images WHERE id = @id AND item_id = @item AND org_id = @org',
    { id: imageId, item: itemId, org: orgId() });
  if (!image) throw new AppError(404, 'الصورة غير موجودة', 'IMAGE_NOT_FOUND');

  await tx(async () => {
    await run('DELETE FROM item_images WHERE id = @id AND org_id = @org', { id: imageId, org: orgId() });
    await touch(itemId);
  });

  await unlinkWithThumb(image.file);
  return listItemImages(itemId);
}

/** Make one photo the primary by moving it to the front of the order. */
export async function setPrimaryImage(itemId, imageId) {
  await requireItem(itemId);
  const images = await listItemImages(itemId);
  const chosen = images.find((i) => i.id === imageId);
  if (!chosen) throw new AppError(404, 'الصورة غير موجودة', 'IMAGE_NOT_FOUND');

  const reordered = [chosen, ...images.filter((i) => i.id !== imageId)];
  await tx(async () => {
    for (const [index, image] of reordered.entries()) {
      await run('UPDATE item_images SET sort_order = @order WHERE id = @id AND org_id = @org',
        { order: index, id: image.id, org: orgId() });
    }
    await touch(itemId);
  });

  return listItemImages(itemId);
}

/** Remove every photo of an item. */
export async function clearItemImages(itemId) {
  await requireItem(itemId);
  const images = await listItemImages(itemId);
  await tx(async () => {
    await run('DELETE FROM item_images WHERE item_id = @id AND org_id = @org', { id: itemId, org: orgId() });
    await touch(itemId);
  });
  await Promise.all(images.map((image) => unlinkWithThumb(image.file)));
  return [];
}
