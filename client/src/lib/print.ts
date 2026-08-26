/**
 * Paper format for printing a document.
 *
 * Two formats, because they are two different objects: an A4 invoice is a
 * business document that gets filed, and an 80mm slip is what the thermal
 * printer next to the till hands the customer on their way out.
 *
 * The switch has to be made in JavaScript rather than in a class, because the
 * one thing that cannot be scoped to a selector is `@page` — the page box
 * belongs to the document, not to any element in it. So the rule is swapped in
 * a style element and everything else keys off `data-paper` on <html>.
 *
 * The attribute is deliberately NOT cleared after printing. It costs nothing on
 * screen (only `@media print` reads it) and it keeps Ctrl+P — which never goes
 * through these buttons — agreeing with the last format that was chosen here.
 */
export type PaperFormat = 'a4' | 'receipt';

const KEY = 'inv.paper';
const STYLE_ID = 'paper-size';

const PAGE_RULE: Record<PaperFormat, string> = {
  a4: '@page { size: A4; margin: 12mm; }',
  // `auto` height: a roll has no page length, and pinning one would eject a
  // full sheet's worth of blank paper after every short receipt.
  receipt: '@page { size: 80mm auto; margin: 3mm; }',
};

export const PAPER_LABEL: Record<PaperFormat, string> = {
  a4: 'A4',
  receipt: '80mm',
};

function read(): PaperFormat {
  try {
    return localStorage.getItem(KEY) === 'receipt' ? 'receipt' : 'a4';
  } catch {
    // Private windows and locked-down browsers throw on access, not on read.
    return 'a4';
  }
}

/** Point the document at a format without printing — used on load and by the buttons. */
export function applyPaper(format: PaperFormat) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = PAGE_RULE[format];
  document.documentElement.dataset.paper = format;
}

export function printAs(format: PaperFormat) {
  try { localStorage.setItem(KEY, format); } catch { /* nothing to do about it */ }
  applyPaper(format);
  window.print();
}

/** The format last used on this device, so the button that gets pressed most is remembered. */
export const lastPaper = read;

applyPaper(read());
