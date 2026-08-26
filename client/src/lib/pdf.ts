/**
 * The invoice as a PDF file, made in the browser.
 *
 * There is no server-side renderer to ask: this deployment is one Node process
 * on a LAN with no internet, and a headless Chromium next to it would cost more
 * than the feature is worth. So the page renders itself.
 *
 * It is a *picture* of the invoice inside a PDF, not typeset text, and that is
 * the deliberate half of the trade. jsPDF can place text, but it does not shape
 * Arabic -- letters come out isolated and left-to-right, which is worse than
 * useless on a document a customer reads. Rasterising what the browser has
 * already shaped is the one approach that cannot get the Arabic wrong. The cost
 * is that text inside the PDF cannot be selected or searched.
 *
 * Both libraries are imported dynamically: ~550KB that a till printing receipts
 * all day never has to download.
 */
import type { PaperFormat } from './print';

/** Rendered width, in CSS pixels, that each format's layout is composed at. */
const CAPTURE_WIDTH: Record<PaperFormat, number> = {
  // Wide enough that the responsive table stays a table (the breakpoint is
  // 1024px) without composing text so small it turns to mush at 2x scale.
  a4: 1100,
  // 80mm at 96dpi is 302px; this is inside the stacked breakpoint, so the
  // one-field-per-line layout the roll needs falls out of the existing CSS.
  receipt: 300,
};

const MM = { a4Width: 210, a4Height: 297, margin: 10, rollWidth: 80, rollMargin: 3 };

/**
 * Rasterise the invoice card.
 *
 * Everything that makes it a screen lives in `onclone`, on a copy the user
 * never sees:
 *   • the dark theme comes off -- a PDF is printed and read on white
 *   • `.no-print` goes, which is what keeps the profit panel and the cost and
 *     profit columns out of a file that gets sent to the customer it names
 *   • photos go, as they do on paper
 */
async function rasterise(node: HTMLElement, format: PaperFormat) {
  const { default: html2canvas } = await import('html2canvas');
  const width = CAPTURE_WIDTH[format];

  return html2canvas(node, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    width,
    windowWidth: width,
    onclone: (doc: Document) => {
      doc.documentElement.classList.remove('dark');
      doc.querySelectorAll('.no-print').forEach((el) => el.remove());
      doc.querySelectorAll('[data-thumb]').forEach((el) => el.remove());
      const target = doc.querySelector<HTMLElement>('.print-area');
      if (target) {
        target.style.width = `${width}px`;
        target.style.maxWidth = 'none';
        target.style.boxShadow = 'none';
        target.style.borderRadius = '0';
      }
    },
  });
}

export async function invoicePdfBlob(node: HTMLElement, format: PaperFormat): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const canvas = await rasterise(node, format);
  const image = canvas.toDataURL('image/png');
  const ratio = canvas.height / canvas.width;

  if (format === 'receipt') {
    // A roll has no page length. The page becomes exactly as long as the
    // receipt, which is also what stops a viewer from padding it to A4.
    const w = MM.rollWidth - MM.rollMargin * 2;
    const h = w * ratio;
    const pdf = new jsPDF({ unit: 'mm', format: [MM.rollWidth, h + MM.rollMargin * 2] });
    pdf.addImage(image, 'PNG', MM.rollMargin, MM.rollMargin, w, h);
    return pdf.output('blob');
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = MM.a4Width - MM.margin * 2;
  const h = w * ratio;
  const usable = MM.a4Height - MM.margin * 2;

  // A long invoice spans sheets. The same image is placed on each page, shifted
  // up by a page's worth every time, so the seam falls where the paper ends
  // rather than where a slice was cut.
  let remaining = h;
  let offset = 0;
  while (remaining > 0.5) {
    if (offset > 0) pdf.addPage();
    pdf.addImage(image, 'PNG', MM.margin, MM.margin - offset, w, h);
    remaining -= usable;
    offset += usable;
  }
  return pdf.output('blob');
}

/**
 * Hand the file to the person.
 *
 * The native share sheet needs a secure context, and this deployment is served
 * over plain http on a LAN -- so `navigator.share` is simply absent there and
 * the file downloads instead, to be attached by hand. The check is written the
 * way it is so that moving the site to https lights the share sheet up with no
 * further change here.
 */
export async function deliverPdf(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'application/pdf' });

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (error) {
      // The user closing the sheet is not a failure worth reporting as one.
      if ((error as DOMException)?.name === 'AbortError') return 'shared';
      // Anything else: fall through and give them the file the other way.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
