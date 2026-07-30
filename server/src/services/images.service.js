import crypto from 'node:crypto';
import { all, get, run, tx, orgId } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { putObject, deleteObject } from '../lib/storage.js';

/** Formats a browser can display without conversion. */
const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

async function requireItem(itemId) {
  const item = await get(
    'SELECT id FROM items WHERE id = ? AND deleted_at IS NULL AND org_id = ?', [itemId, orgId()]);
  if (!item) throw new AppError(404, 'الصنف غير موجود', 'ITEM_NOT_FOUND');
  return item;
}

function touch(itemId) {
  return run('UPDATE items SET updated_at = iso_now() WHERE id = ? AND org_id = ?',
    [itemId, orgId()]);
}

/** Every photo of an item, primary first. */
export function listItemImages(itemId) {
  return all(
    `SELECT id, item_id, file, sort_order, created_at,
            '/uploads/' || file AS url
       FROM item_images
      WHERE item_id = ? AND org_id = ?
      ORDER BY sort_order, created_at`, [itemId, orgId()]);
}

function validate(file) {
  const extension = ALLOWED.get(file.mimetype);
  if (!extension) {
    throw new AppError(
      415,
      'صيغة الصورة غير مدعومة — استخدم JPG أو PNG أو WEBP',
      'UNSUPPORTED_IMAGE_TYPE',
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AppError(413, 'حجم الصورة يتجاوز 5 ميغابايت', 'IMAGE_TOO_LARGE');
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
    'SELECT COUNT(*) n FROM item_images WHERE item_id = ? AND org_id = ?', [itemId, orgId()]);
  if (existing + files.length > MAX_IMAGES_PER_ITEM) {
    throw new AppError(
      422,
      `الحد الأقصى ${MAX_IMAGES_PER_ITEM} صور للصنف الواحد — الحالي ${existing}`,
      'TOO_MANY_IMAGES',
    );
  }

  const written = [];
  try {
    for (const file of files) {
      const extension = validate(file);
      // Random name: the original filename is untrusted and could collide.
      const name = `${crypto.randomUUID()}${extension}`;
      await putObject(name, file.buffer, file.mimetype);
      written.push(name);
    }

    const { n: nextOrder } = await get(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM item_images WHERE item_id = ? AND org_id = ?',
      [itemId, orgId()]);

    await tx(async () => {
      for (const [index, name] of written.entries()) {
        await run(
          'INSERT INTO item_images (id, org_id, item_id, file, sort_order) VALUES (?,?,?,?,?)',
          [crypto.randomUUID(), orgId(), itemId, name, nextOrder + index]);
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
    'SELECT id, file FROM item_images WHERE id = ? AND item_id = ? AND org_id = ?',
    [imageId, itemId, orgId()]);
  if (!image) throw new AppError(404, 'الصورة غير موجودة', 'IMAGE_NOT_FOUND');

  await tx(async () => {
    await run('DELETE FROM item_images WHERE id = ? AND org_id = ?', [imageId, orgId()]);
    await touch(itemId);
  });

  await unlinkQuietly(image.file);
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
      await run('UPDATE item_images SET sort_order = ? WHERE id = ? AND org_id = ?',
        [index, image.id, orgId()]);
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
    await run('DELETE FROM item_images WHERE item_id = ? AND org_id = ?', [itemId, orgId()]);
    await touch(itemId);
  });
  await Promise.all(images.map((image) => unlinkQuietly(image.file)));
  return [];
}
