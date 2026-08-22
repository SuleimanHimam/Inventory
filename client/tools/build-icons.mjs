/**
 * App icon generator — one vector source, every exported size.
 *
 * Run: node tools/build-icons.mjs
 *
 * Everything is rendered *from vector at its final size* rather than
 * downscaled from one big PNG. At 48px that is the difference between crisp
 * facet edges and grey mush, and 48px is the size the icon has to survive.
 *
 * The symbol: a single cream shipping crate at a 3/4 view on a teal squircle,
 * with one amber stock tag. Deliberately one crate and not a stack — three
 * small boxes read as texture, not as boxes, once the icon is 48px wide, and
 * silhouette clarity outranks literal "there are many things in a warehouse".
 * Volume comes from three distinctly lit faces, which is what makes it read as
 * a physical object rather than a flat pictogram.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ICONS = join(here, '..', 'public', 'icons');
const SRC = join(ICONS, 'src');
mkdirSync(SRC, { recursive: true });

/* ------------------------------------------------------------------ palette */
const TEAL_TOP = '#14B8A6';
const TEAL_BOT = '#0D9488';
const AMBER = '#F59E0B';
const AMBER_HI = '#FBBF24';
const AMBER_LO = '#D97C06';

/* --------------------------------------------------------------- geometry */
// Base crate, then scaled about the canvas centre. The scale is chosen so the
// crate fits Android's adaptive safe circle (66/108 of the canvas = r313 on a
// 1024 grid); the furthest corner lands at r295, leaving real margin.
const C = 512;
const S = 1.18;
const p = (x, y) => [C + (x - C) * S, C + (y - C) * S];

const [Tx, Ty] = p(512, 300);   // top corner of the lid
const [Rx, Ry] = p(722, 405);   // right corner
const [Fx, Fy] = p(512, 510);   // front corner (nearest the viewer)
const [Lx, Ly] = p(302, 405);   // left corner
const [L2x, L2y] = p(302, 620); // bottom of the left face
const [F2x, F2y] = p(512, 725); // bottom front
const [R2x, R2y] = p(722, 620); // bottom of the right face

const lid = `${Tx},${Ty} ${Rx},${Ry} ${Fx},${Fy} ${Lx},${Ly}`;
const faceL = `${Lx},${Ly} ${Fx},${Fy} ${F2x},${F2y} ${L2x},${L2y}`;
const faceR = `${Fx},${Fy} ${Rx},${Ry} ${R2x},${R2y} ${F2x},${F2y}`;

// Amber tag, sitting in the plane of the left face.
const along = (t) => [Lx + (Fx - Lx) * t, Ly + (Fy - Ly) * t];
const [g1x, g1y] = along(0.20);
const [g2x, g2y] = along(0.74);
const TAG_DROP = 88;
const TAG_H = 78;
const tag = `${g1x},${g1y + TAG_DROP} ${g2x},${g2y + TAG_DROP} `
  + `${g2x},${g2y + TAG_DROP + TAG_H} ${g1x},${g1y + TAG_DROP + TAG_H}`;

/**
 * iOS-style squircle. A plain rounded rect with r=225 is close, but the
 * continuous curvature is most of what makes an icon sit right next to
 * system icons, so it is worth sampling properly. n=4.6 matches the Apple
 * shape closely; the path is emitted as line segments, which at 1024px are
 * far below one pixel apart.
 */
function squircle(size, n = 5.6, steps = 512) {
  const a = size / 2;
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * 2 * Math.PI;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const x = Math.sign(ct) * a * Math.abs(ct) ** (2 / n);
    const y = Math.sign(st) * a * Math.abs(st) ** (2 / n);
    pts.push(`${(a + x).toFixed(2)},${(a + y).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/* ----------------------------------------------------------------- pieces */
const defs = ({ grain }) => `
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${TEAL_TOP}"/>
    <stop offset="1" stop-color="${TEAL_BOT}"/>
  </linearGradient>

  <!-- Light sits top-left, so the lid is brightest, the left face catches a
       little of it, and the right face falls away into shade. Three clearly
       separated values are what sell the volume. -->
  <linearGradient id="gLid" x1="0.1" y1="0" x2="0.75" y2="1">
    <stop offset="0" stop-color="#FFFDF8"/>
    <stop offset="1" stop-color="#F3EDDF"/>
  </linearGradient>
  <linearGradient id="gLeft" x1="0.15" y1="0" x2="0.6" y2="1">
    <stop offset="0" stop-color="#F0E7D5"/>
    <stop offset="1" stop-color="#D9CCB1"/>
  </linearGradient>
  <linearGradient id="gRight" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#E0D2B7"/>
    <stop offset="1" stop-color="#C8B693"/>
  </linearGradient>
  <linearGradient id="gTag" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0" stop-color="${AMBER_HI}"/>
    <stop offset="0.55" stop-color="${AMBER}"/>
    <stop offset="1" stop-color="${AMBER_LO}"/>
  </linearGradient>

  <clipPath id="clipLid"><polygon points="${lid}"/></clipPath>

  <filter id="contact" x="-60%" y="-200%" width="220%" height="500%">
    <feGaussianBlur stdDeviation="26"/>
  </filter>
  <filter id="contactTight" x="-60%" y="-300%" width="220%" height="700%">
    <feGaussianBlur stdDeviation="9"/>
  </filter>
  ${grain ? `
  <!-- Cardboard tooth. Clipped to the crate, kept faint: at icon sizes this
       should register as matte material, never as visible noise. -->
  <filter id="grain" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" seed="11" result="n"/>
    <feColorMatrix in="n" type="matrix" result="g"
      values="0 0 0 0 0.42  0 0 0 0 0.38  0 0 0 0 0.31  0 0 0 0.13 0"/>
    <feComposite in="g" in2="SourceGraphic" operator="in" result="gc"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="gc"/></feMerge>
  </filter>` : ''}
`;

/**
 * The crate itself — also the Android adaptive *foreground* layer.
 *
 * `k` compensates for the crop. A launcher only ever shows the middle 72 of an
 * adaptive layer's 108 units, keeping the rest in reserve for parallax, so a
 * foreground drawn at the same scale as the flat icon arrives on the home
 * screen about 1.5x too big and crowding the mask. Drawing it at 72/108 makes
 * the crate land at the same visual size in both.
 */
const crate = ({ grain, shadow, k = 1 }) => `
  <g transform="translate(${C * (1 - k)},${C * (1 - k)}) scale(${k})">
  ${shadow ? `
  <ellipse cx="${C + 22}" cy="${F2y + 16}" rx="248" ry="40"
           fill="#04413E" opacity="0.34" filter="url(#contact)"/>
  <ellipse cx="${C + 12}" cy="${F2y + 4}" rx="196" ry="17"
           fill="#04413E" opacity="0.30" filter="url(#contactTight)"/>` : ''}

  <g ${grain ? 'filter="url(#grain)"' : ''}>
    <polygon points="${faceR}" fill="url(#gRight)"/>
    <polygon points="${faceL}" fill="url(#gLeft)"/>
    <polygon points="${lid}"   fill="url(#gLid)"/>
  </g>

  <!-- The join where the two lid flaps meet. This is what separates "carton"
       from "generic 3D cube", so it carries a real occlusion line down one
       side rather than being a flat tint: the near flap sits fractionally
       proud of the far one and casts into the gap. Clipped to the lid so the
       ends stop cleanly on the diamond edges. Neutral, not amber — the tag is
       the single accent and a second amber element would split the eye. -->
  <g clip-path="url(#clipLid)">
    <rect x="${C - 15}" y="${Ty - 30}" width="30" height="${Fy - Ty + 60}"
          fill="#D5C8AD" opacity="0.60"/>
    <rect x="${C - 15}" y="${Ty - 30}" width="9" height="${Fy - Ty + 60}"
          fill="#8A7458" opacity="0.34"/>
  </g>

  <!-- Ambient occlusion in the inner corner, where the two faces and the lid
       meet and least light reaches. -->
  <polygon points="${faceR}" fill="#8A7458" opacity="0.07"/>

  <polygon points="${tag}" fill="url(#gTag)"/>

  <!-- Edge highlights: the two lid ridges facing the light, and the near
       vertical corner. Thin and low-opacity — they read as a catch of light,
       not as an outline. -->
  <path d="M${Lx},${Ly} L${Tx},${Ty} L${Rx},${Ry}" fill="none"
        stroke="#FFF8E8" stroke-opacity="0.30" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M${Fx},${Fy} L${F2x},${F2y}" fill="none"
        stroke="#FFFBF0" stroke-opacity="0.38" stroke-width="2.5"/>
  </g>
`;

/**
 * @param mode  'full'      squircle background + crate (store / iOS / favicon)
 *              'maskable'  full-bleed background + crate (system applies mask)
 *              'bg'        background layer only (Android adaptive)
 *              'fg'        crate only, transparent (Android adaptive)
 * @param plate presentation drop shadow — never baked into a launcher icon.
 */
function svg(size, mode, { plate = false, grain: grainOpt } = {}) {
  // Texture is dropped below 96px: at that size the noise stops reading as
  // material and starts reading as dirt on the facets. Callers can force it
  // off regardless (the favicon does).
  const grain = grainOpt ?? size >= 96;
  const shadow = mode !== 'bg';
  const pad = plate ? 0.09 * size : 0;
  const inner = size - pad * 2;

  const body = {
    full: `<path d="${squircle(1024)}" fill="url(#bg)"/>${crate({ grain, shadow })}`,
    maskable: `<rect width="1024" height="1024" fill="url(#bg)"/>${crate({ grain, shadow })}`,
    bg: `<rect width="1024" height="1024" fill="url(#bg)"/>`,
    fg: crate({ grain, shadow, k: 72 / 108 }),
  }[mode];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>${defs({ grain })}${plate ? `
    <filter id="plate" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="${0.0078 * size}" stdDeviation="${0.0117 * size}"
                    flood-color="#1C1917" flood-opacity="0.20"/>
    </filter>` : ''}
  </defs>
  <g ${plate ? 'filter="url(#plate)"' : ''} transform="translate(${pad},${pad}) scale(${inner / 1024})">
    ${body}
  </g>
</svg>`;
}

/* ------------------------------------------------------------------ build */
const png = async (name, size, mode, opts) => {
  const markup = svg(size, mode, opts);
  await sharp(Buffer.from(markup)).png({ compressionLevel: 9 }).toFile(join(ICONS, name));
  return `${name.padEnd(34)} ${size}×${size}`;
};

const out = [];
// Vector sources, kept beside the exports so the shape is editable.
writeFileSync(join(SRC, 'icon-master.svg'), svg(1024, 'full'));
writeFileSync(join(SRC, 'icon-background.svg'), svg(1024, 'bg'));
writeFileSync(join(SRC, 'icon-foreground.svg'), svg(1024, 'fg'));

out.push(await png('icon-1024.v3.png', 1024, 'full'));
out.push(await png('icon-512.v3.png', 512, 'full'));
out.push(await png('icon-192.v3.png', 192, 'full'));
out.push(await png('icon-96.v3.png', 96, 'full'));
out.push(await png('icon-72.v3.png', 72, 'full'));
out.push(await png('icon-48.v3.png', 48, 'full'));
out.push(await png('apple-touch-icon.v3.png', 180, 'full'));

// Maskable + the two Android adaptive layers. 432px = 108dp at xxxhdpi.
out.push(await png('icon-maskable-512.v3.png', 512, 'maskable'));
out.push(await png('adaptive-background-432.v3.png', 432, 'bg'));
out.push(await png('adaptive-foreground-432.v3.png', 432, 'fg'));

// For docs and store listings only — the shadow must not ship in a launcher
// icon, where the platform draws its own and a baked one looks like a halo.
out.push(await png('presentation-1024.v3.png', 1024, 'full', { plate: true }));

// Browser-tab favicon, as vector. Rendered from the same geometry so the tab
// and the home screen cannot drift apart, but with the grain filter dropped:
// at 16px it is pure cost, and some feed readers and RSS clients render SVG
// favicons without filter support at all.
writeFileSync(join(here, '..', 'public', 'favicon.svg'), svg(1024, 'full', { grain: false }));
out.push('favicon.svg'.padEnd(34) + 'vector');

console.log(out.join('\n'));
