/**
 * Generate the app icon set from one vector source.
 *
 *   node scripts/make-icons.mjs
 *
 * Re-run whenever the brand colour changes — the icons are raster files and
 * do not follow the CSS palette on their own, which is exactly how they were
 * left showing the old indigo long after the app had gone teal.
 *
 * Two shapes are produced, because Android needs both:
 *   • the plain icon, which draws its own rounded corners, and
 *   • a `maskable` one, which is full-bleed and keeps its glyph inside the
 *     central 80% "safe zone" — the launcher crops this to whatever shape the
 *     device uses (circle, squircle, teardrop). Shipping only the first is why
 *     PWA icons so often end up with their corners sliced off.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', 'public');
const ICONS = path.join(PUBLIC, 'icons');

/*
 * These are copies of tokens in src/index.css, and copies drift: by the time
 * this was last looked at, TEAL_DEEP and ACCENT had both been left behind by
 * palette edits and named colours the app no longer contains anywhere. If you
 * change a brand or accent step there, change it here and re-run.
 */
/** --color-brand-500: the identity colour, unchanged since the app went teal. */
const TEAL = '#0d9488';
/** --color-brand-700, ending the gradient a step deeper than the old 600 so
 *  the tile has some depth at 48px instead of reading as one flat fill. */
const TEAL_DEEP = '#115e59';
/** --color-accent-600, the CTA red — a single spot of contrast so the mark
 *  isn't monochrome. Was #dc2626, which the palette moved off. */
const ACCENT = '#cc1f1f';

/*
 * Three marks to choose between. Each is drawn on the same 100×100 artboard
 * and then centred on whatever canvas it lands on — `canvas` is the full icon
 * size and `frac` how much of it the glyph should occupy, so the two never
 * have to be kept in sync by hand.
 *
 * All three follow the same rules, learned from the wireframe cube they
 * replaced: a home-screen icon is often rendered under 48px, where thin
 * strokes and interior detail turn to mush. Solid shapes, one accent colour,
 * and a silhouette that still reads at a few pixels across.
 */

/** One taped shipping carton, seen straight on. The current icon. */
const carton = `
  <!-- carton body -->
  <rect x="14" y="34" width="72" height="52" rx="7" fill="#ffffff"/>
  <!-- lid, sitting slightly proud of the body -->
  <rect x="8" y="16" width="84" height="20" rx="6" fill="#ffffff" opacity="0.9"/>
  <!-- packing tape, the one accent colour -->
  <rect x="43" y="16" width="14" height="70" fill="${ACCENT}"/>
  <!-- shadow under the lid, so the two planes separate -->
  <rect x="14" y="34" width="72" height="4" fill="${TEAL_DEEP}" opacity="0.18"/>`;

/**
 * Three cartons in a row on a shelf.
 *
 * Reads as *stock* rather than as a single parcel — which is what the app is
 * actually about. Two things it took a look at the rendered PNG to get right:
 * tall narrow boxes read as a bar chart (or batteries), so these are wider
 * than they are tall; and a strip of tape on each made three red bars of a
 * busy mark, so only the front box is taped and the others get a lid seam.
 */
const row = `
  <!-- shelf, grounding the group so they sit rather than float -->
  <rect x="6" y="82" width="88" height="5" rx="2.5" fill="#ffffff" opacity="0.55"/>
  <!-- left -->
  <rect x="7"  y="46" width="27" height="36" rx="4" fill="#ffffff" opacity="0.88"/>
  <rect x="7"  y="54" width="27" height="3"  fill="${TEAL_DEEP}" opacity="0.18"/>
  <!-- right -->
  <rect x="66" y="41" width="27" height="41" rx="4" fill="#ffffff" opacity="0.88"/>
  <rect x="66" y="50" width="27" height="3"  fill="${TEAL_DEEP}" opacity="0.18"/>
  <!-- front centre box, tallest and taped: the one accent spot -->
  <rect x="34" y="34" width="33" height="48" rx="4" fill="#ffffff"/>
  <rect x="46" y="34" width="9"  height="48" fill="${ACCENT}"/>
  <rect x="34" y="44" width="33" height="3"  fill="${TEAL_DEEP}" opacity="0.18"/>`;

/**
 * Three cartons stacked — two down, one up.
 *
 * The most icon-like of the three: a compact, roughly square silhouette that
 * holds its shape when a launcher crops it to a circle, where the row above
 * loses its outer boxes to the mask.
 */
const stack = `
  <!-- top box, centred on the pair below -->
  <rect x="30" y="14" width="40" height="32" rx="5" fill="#ffffff"/>
  <rect x="46" y="14" width="8"  height="32" fill="${ACCENT}"/>
  <!-- bottom pair -->
  <rect x="8"  y="52" width="40" height="34" rx="5" fill="#ffffff" opacity="0.9"/>
  <rect x="24" y="52" width="8"  height="34" fill="${ACCENT}" opacity="0.9"/>
  <rect x="52" y="52" width="40" height="34" rx="5" fill="#ffffff" opacity="0.9"/>
  <rect x="68" y="52" width="8"  height="34" fill="${ACCENT}" opacity="0.9"/>
  <!-- seam under the top box, so the layers separate -->
  <rect x="30" y="42" width="40" height="4" fill="${TEAL_DEEP}" opacity="0.18"/>`;

const MARKS = { carton, row, stack };

const glyph = (mark, canvas, frac) => {
  const size = canvas * frac;
  return `
  <g transform="translate(${canvas / 2} ${canvas / 2}) scale(${size / 100}) translate(-50 -50)">
    ${MARKS[mark]}
  </g>`;
};

/** Full-bleed square with its own rounded corners. */
const plain = (mark, s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${TEAL}"/><stop offset="100%" stop-color="${TEAL_DEEP}"/>
  </linearGradient></defs>
  <rect width="${s}" height="${s}" rx="${s * 0.22}" fill="url(#g)"/>
  ${glyph(mark, s, 0.62)}
</svg>`;

/** Edge-to-edge; glyph kept inside the central 80% the launcher won't crop. */
const maskable = (mark, s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${TEAL}"/><stop offset="100%" stop-color="${TEAL_DEEP}"/>
  </linearGradient></defs>
  <rect width="${s}" height="${s}" fill="url(#g)"/>
  ${glyph(mark, s, 0.46)}
</svg>`;

const png = (svg, file) =>
  sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);

/*
 * Which mark ships, and what the icon files are called.
 *
 *   node scripts/make-icons.mjs [mark] [version]
 *
 * The version is part of every icon's *filename*, and that is deliberate.
 * Android launchers — Hermit's shortcuts especially — read a shortcut's icon
 * once, at the moment it is created, and keep the bitmap. Replacing the bytes
 * behind an unchanged URL therefore changes nothing on a device that already
 * has the shortcut, no matter what the cache headers say. A new filename is a
 * new icon as far as any of them are concerned, so bump this whenever the
 * mark changes and the manifest will point somewhere genuinely new.
 */
const MARK = process.argv[2] ?? 'stack';
const VERSION = process.argv[3] ?? 'v2';

if (!MARKS[MARK]) {
  console.error(`unknown mark "${MARK}" — expected one of: ${Object.keys(MARKS).join(', ')}`);
  process.exit(1);
}

await mkdir(ICONS, { recursive: true });

await Promise.all([
  png(plain(MARK, 192), path.join(ICONS, `icon-192.${VERSION}.png`)),
  png(plain(MARK, 512), path.join(ICONS, `icon-512.${VERSION}.png`)),
  // iOS composites onto its own rounded mask and shows no transparency, so it
  // gets the plain full-bleed square.
  png(plain(MARK, 180), path.join(ICONS, `apple-touch-icon.${VERSION}.png`)),
  png(maskable(MARK, 512), path.join(ICONS, `icon-maskable-512.${VERSION}.png`)),
  writeFile(path.join(PUBLIC, 'favicon.svg'), plain(MARK, 32).replace(/\n\s*/g, ' ')),

  // Every mark at one size, so all three can be compared side by side without
  // running this three times. Not referenced by the manifest.
  ...Object.keys(MARKS).map((m) =>
    png(plain(m, 256), path.join(ICONS, `choice-${m}.png`))),
]);

console.log(`wrote ${MARK} icons at ${VERSION}, plus choice-{${Object.keys(MARKS).join(',')}}.png`);
