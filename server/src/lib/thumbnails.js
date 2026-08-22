import sharp from 'sharp';

/**
 * Derived thumbnails.
 *
 * The gallery stores whatever the camera produced — phone photos here run
 * 3–11 MB each. That is right for the original, and completely wrong for the
 * 40px square the items list draws: showing 22 items was pulling ~38 MB, one
 * full-resolution photo at a time, which is what made that screen slow.
 *
 * So every image gets a small WebP sibling, and list views ask for that
 * instead. Originals are never touched — the detail gallery still shows them.
 *
 * The naming is deliberately a convention rather than a database column
 * (`abc.jpg` → `thumb-abc.webp`): the client can derive the thumbnail URL
 * from the image URL it already has, so this needed no API change, no schema
 * change, and no migration.
 */

/** Long edge in px. Comfortably covers the 40px list square on a 3x screen. */
const THUMB_SIZE = 240;
const THUMB_QUALITY = 72;

/** `abc123.jpg` → `thumb-abc123.webp`. Must match the client's derivation. */
export const thumbName = (file) => `thumb-${file.replace(/\.[^.]+$/, '')}.webp`;

/** True for files this module should not try to rasterise. */
export const isThumbnailable = (file) => !/\.svg$/i.test(file);

/**
 * Render a thumbnail, or return null if the source can't be processed.
 *
 * Never throws: a corrupt or exotic source image must not fail the upload it
 * came from — the original is already stored and displayable, and the client
 * falls back to it when a thumbnail is missing.
 */
export async function makeThumbnail(buffer, file) {
  if (!isThumbnailable(file)) return null;
  try {
    return await sharp(buffer, { failOn: 'none' })
      // `inside` keeps the aspect ratio; `withoutEnlargement` leaves an
      // already-small image alone rather than upscaling it into a blur.
      .rotate() // honour EXIF orientation before dropping the metadata
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
  } catch (error) {
    console.warn('[thumbnails] could not render', file, error.message);
    return null;
  }
}
