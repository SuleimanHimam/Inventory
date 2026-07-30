/**
 * Product-photo storage.
 *
 * The desktop build wrote images to a folder next to the SQLite file. That does
 * not survive on Railway, whose container filesystem is ephemeral: every deploy
 * starts from the built image, so uploaded photos would silently disappear. (A
 * Railway volume would persist them, at the cost of another paid resource to
 * back up.) Supabase Storage has a free bucket allowance and is already part of
 * this stack, so it is the default in production.
 *
 * Either way `items.image_file` holds a bare, random filename and the API keeps
 * exposing `/uploads/<file>`, so no query, response shape or client changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'item-images';

export const STORAGE_DRIVER = process.env.STORAGE_DRIVER
  ?? (SUPABASE_URL && SERVICE_KEY ? 'supabase' : 'local');

/** Local uploads folder — the dev default, and the test default. */
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ?? path.join(__dirname, '../../data/uploads');

if (STORAGE_DRIVER === 'local') fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/**
 * Recorded, not thrown at import — see db/index.js for why a configuration
 * error raised while the module graph is loading is the least useful place to
 * raise it.
 *
 * Storage is also the narrowest of these failures: everything except uploading
 * and deleting a product photo works without it. Refusing to start punished the
 * whole API for a feature that might not be used all day.
 */
export const storageConfigError
  = STORAGE_DRIVER === 'supabase' && !(SUPABASE_URL && SERVICE_KEY)
    ? 'STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    : null;

const objectUrl = (name) => `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`;

/** Where a browser can fetch this file, or null when it is served from disk. */
export const publicUrl = (name) =>
  (STORAGE_DRIVER === 'supabase' && !storageConfigError
    ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(name)}`
    : null);

export async function putObject(name, buffer, contentType) {
  if (storageConfigError) {
    throw new AppError(503, storageConfigError, 'STORAGE_NOT_CONFIGURED');
  }
  if (STORAGE_DRIVER === 'local') {
    await fs.promises.writeFile(path.join(UPLOADS_DIR, name), buffer);
    return;
  }

  const response = await fetch(objectUrl(name), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=2592000, immutable',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AppError(502, 'تعذّر تخزين الصورة — حاول مرة أخرى', 'STORAGE_UPLOAD_FAILED',
      { detail: detail.slice(0, 300) });
  }
}

/** Remove an object, treating an already-missing one as success. */
export async function deleteObject(name) {
  if (!name) return;
  if (storageConfigError) {
    throw new AppError(503, storageConfigError, 'STORAGE_NOT_CONFIGURED');
  }
  if (STORAGE_DRIVER === 'local') {
    try {
      await fs.promises.unlink(path.join(UPLOADS_DIR, name));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return;
  }

  const response = await fetch(objectUrl(name), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!response.ok && response.status !== 404) {
    console.warn(`[storage] failed to delete ${name}: ${response.status}`);
  }
}
