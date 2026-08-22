import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2, ImageOff, Star } from 'lucide-react';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';

const MAX_BYTES = 20 * 1024 * 1024;
// Every format a browser can display via <img> — matches server ALLOWED in
// images.service.js. HEIC/HEIF (iPhone's default) is deliberately excluded:
// no browser renders it, so accepting it would just move the failure from
// "rejected here" to "broken image everywhere it's shown".
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,image/svg+xml';

export const MAX_IMAGES = 8;

/** Reject anything the server would reject anyway, but before the round trip. */
function reject(file: File): string | null {
  if (!ACCEPT.split(',').includes(file.type)) {
    return 'صيغة غير مدعومة — استخدم JPG أو PNG أو WEBP أو GIF أو BMP أو SVG أو AVIF '
      + '(صور iPhone بصيغة HEIC: غيّرها إلى JPEG من إعدادات الكاميرا)';
  }
  if (file.size > MAX_BYTES) return `«${file.name}» يتجاوز 20 ميغابايت`;
  return null;
}

/**
 * Product photo picker — several photos per item.
 *
 * Chosen files are held by the parent and uploaded once the item is saved,
 * because a brand-new item has no id to attach photos to yet. Previews use
 * object URLs so the pictures appear immediately.
 */
export function ImagePicker({
  files, onChange, existing = [], onRemoveExisting, busy, max = MAX_IMAGES,
}: {
  /** Newly chosen files that have not been uploaded yet. */
  files: File[];
  onChange: (files: File[]) => void;
  /** Photos already stored on the server, primary first. */
  existing?: { id: string; url: string }[];
  onRemoveExisting?: (id: string) => void;
  busy?: boolean;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  // Object URLs must be revoked or the blobs leak for the page's lifetime.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);

  const total = existing.length + files.length;
  const room = max - total;

  const accept = (picked: FileList | null) => {
    setError('');
    const chosen = [...(picked ?? [])];
    if (!chosen.length) return;

    if (chosen.length > room) {
      setError(`يمكن إضافة ${room} صورة فقط — الحد الأقصى ${max} للصنف الواحد`);
      if (room <= 0) return;
    }

    const taken: File[] = [];
    for (const file of chosen.slice(0, Math.max(0, room))) {
      const problem = reject(file);
      if (problem) { setError(problem); continue; }
      taken.push(file);
    }
    if (taken.length) onChange([...files, ...taken]);
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files); }}
        className={cn(
          'flex flex-wrap gap-2 rounded-xl border-2 border-dashed p-2 transition',
          dragging ? 'border-brand-500 bg-brand-500/10' : 'border-line',
        )}
      >
        {existing.map((image, index) => (
          <span key={image.id} className="group relative size-24 overflow-hidden rounded-lg border border-line">
            <img src={mediaUrl(image.url)} alt="" className="size-full object-cover" />
            {index === 0 && (
              <span className="absolute inset-x-0 top-0 bg-brand-600/85 py-0.5 text-center text-[10px] font-semibold text-white">
                الرئيسية
              </span>
            )}
            {onRemoveExisting && (
              <button
                type="button"
                onClick={() => onRemoveExisting(image.id)}
                aria-label="حذف الصورة"
                className="absolute bottom-1 end-1 grid size-6 place-items-center rounded-md bg-accent-600/90 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </span>
        ))}

        {previews.map((url, index) => (
          <span key={url} className="group relative size-24 overflow-hidden rounded-lg border border-brand-400">
            <img src={url} alt="" className="size-full object-cover" />
            <span className="absolute inset-x-0 top-0 bg-emerald-600/85 py-0.5 text-center text-[10px] font-semibold text-white">
              جديدة
            </span>
            <button
              type="button"
              onClick={() => onChange(files.filter((_, i) => i !== index))}
              aria-label="إزالة الصورة المختارة"
              className="absolute bottom-1 end-1 grid size-6 place-items-center rounded-md bg-accent-600/90 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </span>
        ))}

        {room > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="grid size-24 place-items-center rounded-lg border-2 border-dashed border-line bg-surface-2 text-subtle transition hover:border-brand-400 hover:text-brand-500"
            title="أضف صوراً"
          >
            <span className="flex flex-col items-center gap-1">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-6" />}
              <span className="text-[11px]">أضف صوراً</span>
            </span>
          </button>
        )}
      </div>

      <p className="mt-1.5 text-xs text-muted">
        حتى {max} صور للصنف. الأولى هي الرئيسية التي تظهر في القوائم.
        JPG أو PNG أو WEBP أو GIF أو BMP أو SVG أو AVIF، بحد أقصى 20 ميغابايت للصورة.
      </p>
      {error && <p className="mt-1 text-xs font-medium text-accent-600 dark:text-accent-400">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => { accept(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}

/**
 * Read-only gallery with a large preview — what the item detail page shows.
 * Selecting a thumbnail swaps the main image; it does not reorder anything.
 */
export function ImageGallery({
  images, onSetPrimary, onRemove, busy,
}: {
  images: { id: string; url: string }[];
  onSetPrimary?: (id: string) => void;
  onRemove?: (id: string) => void;
  busy?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Follow the primary when the gallery changes underneath (upload, delete).
  const active = images.find((i) => i.id === activeId) ?? images[0];
  useEffect(() => {
    if (activeId && !images.some((i) => i.id === activeId)) setActiveId(null);
  }, [images, activeId]);

  if (!images.length) {
    return (
      <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-line py-10 text-subtle">
        <ImageOff className="size-7" />
        <p className="text-xs">لا توجد صور لهذا الصنف</p>
        <p className="text-[11px]">استخدم «تعديل» لإضافة صور</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-surface-2">
        <img src={mediaUrl(active.url)} alt="" className="size-full object-contain" />
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-surface/70">
            <Loader2 className="size-6 animate-spin text-brand-600" />
          </span>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActiveId(image.id)}
              aria-label={`عرض الصورة ${index + 1}`}
              aria-current={image.id === active.id}
              className={cn(
                'relative size-14 overflow-hidden rounded-lg border-2 transition',
                image.id === active.id ? 'border-brand-500' : 'border-line hover:border-brand-300',
              )}
            >
              <img src={mediaUrl(image.url)} alt="" loading="lazy" className="size-full object-cover" />
              {index === 0 && (
                <span className="absolute inset-x-0 bottom-0 bg-brand-600/85 text-center text-[9px] font-semibold text-white">
                  رئيسية
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {(onSetPrimary || onRemove) && (
        <div className="flex flex-wrap gap-1.5">
          {onSetPrimary && active.id !== images[0].id && (
            <button
              type="button"
              onClick={() => onSetPrimary(active.id)}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium transition hover:bg-surface-2"
            >
              <Star className="size-3.5" /> اجعلها الرئيسية
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(active.id)}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-accent-600 transition hover:bg-accent-500/10 dark:text-accent-400"
            >
              <Trash2 className="size-3.5" /> حذف هذه الصورة
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Small square thumbnail for table rows.
 *
 * Loads the derived thumbnail rather than the original. Phone photos here run
 * 3–11 MB each, so a 22-row items list was pulling ~38 MB of full-resolution
 * images to draw 40px squares — that was what made the list slow. The
 * thumbnails total 0.15 MB for the same set.
 *
 * The thumbnail URL is derived by convention (`abc.jpg` → `thumb-abc.webp`,
 * matching server/src/lib/thumbnails.js) so this needed no API or schema
 * change. Anything without one — an SVG, a failed conversion, an upload that
 * arrived before the server had thumbnailing — falls back to the original on
 * error, so an image always shows.
 */
export const thumbUrl = (url: string) =>
  url.replace(/([^/]+)\.[^.]+$/, 'thumb-$1.webp');

/**
 * Absolute URL of an image's thumbnail, for the places that need their own
 * `<img>` rather than the `Thumb` box below (the phone card grid, the picker
 * grid). SVGs have no thumbnail and pass through unchanged.
 *
 * Pair this with `useThumbFallback` so a missing thumbnail still renders.
 */
export const thumbSrc = (url?: string | null) =>
  mediaUrl(url && !/\.svg$/i.test(url) ? thumbUrl(url) : url);

/** onError handler that swaps a failed thumbnail for its original. */
export function useThumbFallback(url?: string | null) {
  const [failed, setFailed] = useState(false);
  return {
    src: failed ? mediaUrl(url) : thumbSrc(url),
    onError: () => setFailed(true),
  };
}

export function Thumb({ url, alt = '', className }: { url?: string | null; alt?: string; className?: string }) {
  const img = useThumbFallback(url);

  return (
    <span className={cn(
      'grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface-2',
      className,
    )}>
      {img.src ? (
        <img
          src={img.src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={img.onError}
        />
      ) : <ImageOff className="size-4 text-subtle" />}
    </span>
  );
}
