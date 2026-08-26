import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, Save, AlertCircle, X, Trash2, LogOut,
} from 'lucide-react';
import {
  Button, Card, Input, Select, ConfirmDialog, Modal, Badge,
} from '@/components/ui';
import { ItemFormModal } from '@/components/ItemFormModal';
import { Thumb } from '@/components/ImagePicker';
import {
  AnchoredPopover, ItemBrowserModal, ItemListDropdown, ItemPickerButtons,
} from '@/components/ItemPicker';
import { BarcodeChip, INVOICE_TYPES } from '@/components/domain';
import {
  useInvoice, useInvoiceMutations, useInvoiceValidation, useItemSearch, useParties,
} from '@/hooks';
import { ApiError } from '@/lib/api';
import { fmtCurrency, fmtInt, todayIso } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import type { Invoice, InvoiceLine, InvoiceType, Item } from '@/lib/types';

/**
 * Deleting is idempotent: a 404 means the invoice is already gone, which is
 * exactly the end state the operator asked for. It happens routinely here
 * because the database is shared — another device may have removed the same
 * invoice first — and reporting it as a failure both alarms the operator and
 * strands them on a form whose invoice no longer exists.
 */
const alreadyGone = (error: unknown) => error instanceof ApiError && error.status === 404;

export default function InvoiceForm() {
  const { id: routeId } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isClerk } = usePermissions();

  const requestedType = (params.get('type') as InvoiceType) || 'STOCK_OUT';
  // A clerk's create side is stock-out only — the API refuses a STOCK_IN
  // creation outright (`requireStockOutForClerk`). Caught here too, so a
  // stale link or a hand-edited URL redirects instead of round-tripping to
  // the API for an error toast.
  const blockedForClerk = isClerk && !routeId && requestedType === 'STOCK_IN';
  const [invoiceId, setInvoiceId] = useState<string | undefined>(routeId);
  const creatingRef = useRef(false);

  const { data: invoice, isLoading } = useInvoice(invoiceId);
  const mutations = useInvoiceMutations(invoiceId);

  /**
   * Asking for a different type is asking for a different document.
   *
   * `/invoices/new?type=STOCK_IN` and `?type=STOCK_OUT` share a pathname, so
   * without this the invoice already on screen simply stayed — the ribbon's
   * إخراج button appeared to do nothing at all.
   */
  const servedType = useRef(requestedType);
  useEffect(() => {
    if (routeId || servedType.current === requestedType) return;
    servedType.current = requestedType;
    creatingRef.current = false;

    // The invoice being left behind was auto-created on arrival. If nothing
    // was ever entered into it, it is litter — a numbered row nobody asked
    // for — so drop it rather than leaving it behind. One *with* lines has
    // already been decided on by the leave dialog; leave it alone.
    const abandoned = invoiceId;
    if (abandoned && !invoice?.lines?.length) {
      mutations.remove.mutateAsync(abandoned).catch(() => {
        /* Losing an empty invoice is not worth interrupting the user for. */
      });
    }
    setInvoiceId(undefined);
  }, [requestedType, routeId, invoiceId, invoice, mutations.remove]);

  // Create the invoice row on first render when arriving at /invoices/new.
  // It stays unsaved (status DRAFT) and invisible in the list until حفظ posts
  // it; see the sweep in invoices.service.js for how abandoned rows are reaped.
  useEffect(() => {
    if (routeId || invoiceId || creatingRef.current || blockedForClerk) return;
    creatingRef.current = true;
    mutations.create.mutateAsync({ type: requestedType, invoice_date: todayIso() })
      .then((created) => setInvoiceId(created.id))
      .catch((error) => { toastError(error, 'تعذّر إنشاء الفاتورة'); navigate('/invoices'); });
  }, [routeId, invoiceId, requestedType, mutations.create, navigate, blockedForClerk]);

  if (blockedForClerk) return <Navigate to="/invoices/new" replace />;

  if (isLoading || !invoice) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-500" />
      </div>
    );
  }

  // Rendered, not called: navigate() during render updates the router while
  // React is rendering this component. `Navigate` does the same job as an
  // element, the way blockedForClerk above already does.
  if (invoice.status !== 'DRAFT') return <Navigate to={`/invoices/${invoice.id}`} replace />;

  // Keyed by id: a new invoice must start with clean editor state, or the
  // "already decided to leave" flag would carry over and disarm its guard.
  return <InvoiceEditor key={invoice.id} invoice={invoice} />;
}

function InvoiceEditor({ invoice }: { invoice: Invoice }) {
  const navigate = useNavigate();
  const mutations = useInvoiceMutations(invoice.id);
  const { data: validation } = useInvoiceValidation(invoice.id);
  const { canSeeSalePrice, canEditPrices } = usePermissions();

  const config = INVOICE_TYPES[invoice.type];
  const partyKind = config.direction === 'OUT' ? 'customers' : 'suppliers';
  const { data: parties } = useParties(partyKind, { limit: 200, is_active: 'true', page: 1 });

  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState('1');
  /** -1 = nothing chosen, so Enter keeps the fast barcode path for scanners. */
  const [highlight, setHighlight] = useState(-1);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  /** The two no-typing routes to an item: the search screen and the full list. */
  const [browserOpen, setBrowserOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [flashLineId, setFlashLineId] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  /** Both entry dropdowns hang off this cell, from outside the grid's clip. */
  const entryCellRef = useRef<HTMLTableCellElement>(null);
  /**
   * Set before a departure the operator already decided on (saving or
   * deleting), so the guard below does not ask twice about a navigation that
   * *is* the answer.
   */
  const decidedRef = useRef(false);
  /**
   * Set the instant a departing action starts, so a second click cannot repeat
   * it. `loading` on the button is not enough: React has not committed the
   * pending state yet when a fast double-click lands, and the second delete
   * then fails with "الفاتورة غير موجودة" on an invoice that is already gone.
   */
  const inFlightRef = useRef(false);

  const lines = invoice.lines ?? [];
  const focusBarcode = useCallback(() => setTimeout(() => barcodeRef.current?.focus(), 30), []);

  // Name/barcode lookahead. Pure digits are almost always a scan in progress,
  // so no dropdown is shown for them — it would flicker as the scanner types.
  const typed = barcode.trim();
  const searchTerm = typed.length >= 2 && !/^\d+$/.test(typed) ? typed : '';
  const { data: results = [], isFetching: searching } = useItemSearch(searchTerm, 8);

  useEffect(() => { focusBarcode(); }, [focusBarcode]);

  // F2 / F4 reach the two pickers without leaving the keyboard, the way the
  // accounting packages operators come from bind them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); setListOpen(false); setBrowserOpen(true); }
      if (e.key === 'F4') { e.preventDefault(); setBrowserOpen(false); setListOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Quantity applied to the next line added; resets to 1 after each add. */
  const nextQuantity = () => Math.max(1, Number(quantity) || 1);

  const afterAdd = (lineId: string) => {
    setFlashLineId(lineId);
    setTimeout(() => setFlashLineId(null), 700);
    setBarcode('');
    setQuantity('1');
    setHighlight(-1);
    focusBarcode();
  };

  /** Resolve a scanned/typed barcode into a line, or offer inline creation. */
  const addLine = async (code: string) => {
    const value = code.trim();
    if (!value) return;
    try {
      const result = await mutations.addLine.mutateAsync({
        id: invoice.id, barcode: value, quantity: nextQuantity(),
      });
      afterAdd(result.line_id);
    } catch (error) {
      if (error instanceof ApiError && error.isUnknownBarcode) {
        // Never create an item silently — open the quick-create modal instead.
        setUnknownBarcode(value);
        setBarcode('');
      } else {
        toastError(error, 'تعذّر إضافة السطر');
        focusBarcode();
      }
    }
  };

  /**
   * Add a line for an item picked from the name-search results. The browser
   * modal's cards carry their own quantity field; the quicker autocomplete
   * and list pickers don't, so they fall back to the shared quantity box.
   */
  const addSearchResult = async (item: Item, quantity = nextQuantity()) => {
    try {
      const result = await mutations.addLine.mutateAsync({
        id: invoice.id, item_id: item.id, quantity,
      });
      afterAdd(result.line_id);
    } catch (error) {
      toastError(error, 'تعذّر إضافة الصنف');
      focusBarcode();
    }
  };

  const addCreatedItem = async (itemId: string) => {
    try {
      const result = await mutations.addLine.mutateAsync({ id: invoice.id, item_id: itemId });
      setFlashLineId(result.line_id);
      setTimeout(() => setFlashLineId(null), 700);
    } catch (error) {
      toastError(error, 'تعذّر إضافة الصنف إلى الفاتورة');
    } finally {
      setUnknownBarcode(null);
      focusBarcode();
    }
  };

  const patchHeader = (patch: Record<string, unknown>) =>
    mutations.update.mutate({ id: invoice.id, ...patch });

  const post = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const posted = await mutations.post.mutateAsync(invoice.id);
      decidedRef.current = true;
      toast.success(`تم حفظ الفاتورة ${posted.number}`, 'تم تسجيل حركات المخزون وتحديث الأرصدة');
      /*
       * `replace`, not a push. Once this invoice is posted the editor URL is no
       * longer a page anyone can be on -- the guard below sends a non-draft
       * straight to the detail view. Pushing left /edit sitting in the history
       * behind us, so Back landed there, was redirected forward again, and the
       * button looked broken: you had to press it twice to reach the list.
       */
      navigate(`/invoices/${posted.id}`, { replace: true });
    } catch (error) {
      inFlightRef.current = false;
      decidedRef.current = false;
      setConfirmPost(false);
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
        const details = (error.payload.lines ?? []) as Array<{ item_name: string; available: number; requested: number }>;
        toast.error('الكمية غير كافية في المخزون',
          details.map((d) => `${d.item_name}: المتوفر ${d.available} والمطلوب ${d.requested}`).join(' • '));
      } else {
        toastError(error, 'تعذّر حفظ الفاتورة');
      }
    }
  };

  const discard = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      decidedRef.current = true;
      await mutations.remove.mutateAsync(invoice.id);
      toast.info('تم حذف الفاتورة');
      navigate('/invoices');
    } catch (error) {
      if (alreadyGone(error)) { navigate('/invoices'); return; }
      inFlightRef.current = false;
      decidedRef.current = false;
      toastError(error, 'تعذّر حذف الفاتورة');
    }
  };

  /**
   * Leaving an unsaved invoice that already has lines is almost always a
   * mistake — the stock has not moved yet, and there is no draft list to
   * recover it from any more. An empty one is deliberately not guarded:
   * there is nothing to lose, and asking would be noise.
   *
   * Only the pathname counts, so switching type via the ribbon's إدخال/إخراج
   * buttons — same pathname, `?type=` changes — jumps straight to the new
   * invoice instead of interrupting with a leave-confirmation. The effect
   * above deletes the old row if it was still empty.
   */
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !!lines.length && !decidedRef.current && currentLocation.pathname !== nextLocation.pathname,
  );

  // Closing the window or reloading bypasses the router entirely, so the
  // browser's own prompt covers that route out.
  useEffect(() => {
    if (!lines.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [lines.length]);

  /** Leave and throw the unsaved invoice away. */
  const dropDraft = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      decidedRef.current = true;
      await mutations.remove.mutateAsync(invoice.id);
      toast.info('تم حذف الفاتورة');
      blocker.proceed?.();
    } catch (error) {
      if (alreadyGone(error)) { blocker.proceed?.(); return; }
      inFlightRef.current = false;
      decidedRef.current = false;
      blocker.reset?.();
      toastError(error, 'تعذّر حذف الفاتورة');
    }
  };

  const blockingReason = validation?.problems?.[0]?.message;
  const canPost = validation?.ok ?? false;
  const priceLabel = config.direction === 'IN' ? 'سعر الشراء' : 'سعر البيع';

  return (
    <>
      {/* Header band — label beside field, dense, like a classic entry form */}
      <Card className="mb-2.5 p-3">
        <div className="grid gap-x-8 gap-y-2 lg:grid-cols-2">
          {/* The party field is a rarely-needed optional note (see partyKind
              above) — on phone it costs a whole row for something most
              invoices leave empty, so it only shows from `sm:` up. */}
          <div className="hidden space-y-2 sm:block">
            <FormRow label={partyKind === 'customers' ? 'حـ/العميل' : 'حـ/المورد'}>
              <Select
                value={(partyKind === 'customers' ? invoice.customer_id : invoice.supplier_id) ?? ''}
                onChange={(e) => patchHeader(
                  partyKind === 'customers'
                    ? { customer_id: e.target.value || null }
                    : { supplier_id: e.target.value || null },
                )}
                className="h-8 py-0 text-xs"
              >
                <option value="">— بدون —</option>
                {parties?.data.map((party) => (
                  <option key={party.id} value={party.id}>{party.name}</option>
                ))}
              </Select>
            </FormRow>
          </div>

          {/* Asymmetric, not 50/50 — the number is a short fixed-width label,
              while a native date input needs real room to show dd/mm/yyyy
              without clipping, especially on a phone-width column. Stacked
              on a narrow phone instead: side by side at that width wrapped
              the number onto two lines and squeezed the date picker. */}
          <div className="grid grid-cols-1 gap-y-2 sm:grid-cols-[2fr_3fr] sm:gap-x-6">
            {/* An unsaved invoice genuinely has no number yet: the sequence
                only advances when one is saved, so opening the screen (or
                reloading it) no longer consumes one. */}
            <FormRow label="الرقم" labelWidth="w-14">
              <span className="nums flex h-8 items-center font-mono text-xs font-bold">
                {invoice.number ?? <span className="font-sans font-normal text-subtle">يُحدَّد عند الحفظ</span>}
              </span>
            </FormRow>
            <FormRow label="التاريخ" labelWidth="w-14">
              <Input
                type="date"
                defaultValue={invoice.invoice_date}
                onChange={(e) => patchHeader({ invoice_date: e.target.value })}
                className="nums h-8 py-0 text-xs"
              />
            </FormRow>
          </div>
        </div>
      </Card>

      {/* Line grid — the last row is always blank and ready for the next entry */}
      <Card className="overflow-visible">
        <div className="overflow-x-auto">
          <table className="data-table stacked">
            <thead>
              <tr>
                <th className="w-10 text-center">#</th>
                {/* Wide enough for the input plus the two picker buttons. */}
                <th className="w-[17.5rem]">رمز المادة</th>
                <th className="w-px" aria-label="الصورة" />
                <th>اسم المادة</th>
                <th className="w-24 text-center">الكمية</th>
                <th className="w-28 text-center">الوحدة</th>
                {canSeeSalePrice && <th className="w-28 text-center">{priceLabel}</th>}
                {canSeeSalePrice && <th className="w-32 text-center">الإجمالي</th>}
                {canEditPrices && (
                  <th className="w-16 text-center" title="تحديث سعر الصنف عند الحفظ">تحديث السعر</th>
                )}
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <LineRow
                  key={line.id}
                  line={line}
                  index={index + 1}
                  invoiceId={invoice.id}
                  direction={config.direction}
                  flash={flashLineId === line.id}
                  onDone={focusBarcode}
                />
              ))}

              {/* Entry row — a form, not data, so it opts out of the stacked
                  phone/tablet card layout (see .entry-row in index.css) and
                  keeps the search box and quantity field side by side. */}
              <tr className="entry-row bg-brand-500/5">
                <td className="nums text-center text-xs font-bold text-brand-600 max-lg:hidden dark:text-brand-400">
                  {lines.length + 1}
                </td>
                {/* No data-label: on a phone the label would share the row
                    with the field and the two picker buttons, leaving the
                    scan box too narrow to read a barcode in. */}
                <td ref={entryCellRef} className="entry-cell">
                  <span className="flex w-full items-center gap-1.5">
                  <input
                    ref={barcodeRef}
                    value={barcode}
                    onChange={(e) => { setBarcode(e.target.value); setHighlight(-1); }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setHighlight((i) => Math.min(i + 1, results.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setHighlight((i) => Math.max(i - 1, -1));
                      } else if (e.key === 'Escape') {
                        setBarcode(''); setHighlight(-1);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        // A highlighted result wins; otherwise use the barcode
                        // path so a hardware scanner stays instant.
                        if (highlight >= 0 && results[highlight]) addSearchResult(results[highlight]);
                        else addLine(barcode);
                      }
                    }}
                    placeholder="امسح الباركود أو اكتب الاسم…"
                    className="field h-8 min-w-0 flex-1 px-2 py-0 text-xs sm:h-8"
                    autoComplete="off"
                    spellCheck={false}
                  />
                    <ItemPickerButtons
                      listOpen={listOpen}
                      onSearch={() => { setListOpen(false); setBrowserOpen(true); }}
                      onList={() => setListOpen((v) => !v)}
                    />
                  </span>

                  <ItemListDropdown
                    anchorRef={entryCellRef}
                    open={listOpen}
                    onClose={() => setListOpen(false)}
                    onPick={addSearchResult}
                    onOpenBrowser={() => setBrowserOpen(true)}
                  />

                  <AnchoredPopover anchorRef={entryCellRef} open={!listOpen && !!results.length}>
                    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                      {results.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          onMouseEnter={() => setHighlight(index)}
                          onClick={() => addSearchResult(item)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition',
                            index === highlight ? 'bg-brand-500/12' : 'hover:bg-surface-2',
                          )}
                        >
                          <Thumb url={item.image_url} alt={item.name} className="size-9" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{item.name}</span>
                            <span className="nums block font-mono text-[11px] text-subtle">{item.barcode}</span>
                          </span>
                          <span className="shrink-0 text-end">
                            <span className="nums block text-sm font-bold">{fmtInt(item.quantity)}</span>
                            <span className="block text-[10px] text-subtle">الرصيد</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </AnchoredPopover>
                </td>
                <td className="max-lg:hidden" />
                <td className="text-[11px] text-subtle max-lg:hidden">
                  {searching
                    ? <span className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> جارٍ البحث…</span>
                    : 'اكتب ثم اختر من القائمة، أو امسح الباركود'}
                </td>
                <td data-label="الكمية" className="qty-cell">
                  <input
                    type="number" min="1" step="1" inputMode="numeric"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusBarcode(); } }}
                    aria-label="الكمية المضافة"
                    className="field nums h-8 px-1 py-0 text-center text-xs font-bold"
                  />
                </td>
                <td className="max-lg:hidden" />
                <td colSpan={4} className="text-[11px] text-subtle max-lg:hidden">
                  {canEditPrices
                    ? 'يُؤخذ السعر من بطاقة الصنف ويمكن تعديله بعد الإضافة'
                    : 'يُؤخذ السعر من بطاقة الصنف'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Balances */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line bg-surface-2 px-3 py-2.5 sm:gap-x-8 sm:px-4">
          <Balance label="عدد السجلات" value={fmtInt(lines.length)} />
          <Balance
            label="الكميات"
            value={fmtInt(lines.reduce((sum, l) => sum + l.quantity * l.conversion_factor, 0))}
          />
          {/* Discount and tax are no longer enterable, so they can only ever be
              zero here — showing them would be decoration. `subtotal` is dropped
              for the same reason: without them it always equals the net. */}
          {/* The net is a sum of line prices this role can already read, so it
              follows `canSeeSalePrice`, not `canSeePrices`. On a stock-out
              invoice — the only kind a clerk can open — that is sale money
              throughout. */}
          {canSeeSalePrice && (
            <div className="ms-auto flex items-baseline gap-2">
              <span className="text-xs font-bold">الصافي</span>
              <span className="nums text-xl font-bold text-brand-600 dark:text-brand-400">
                {fmtCurrency(invoice.total)}
              </span>
            </div>
          )}
        </div>

        {/* Action bar. Phone: the primary action gets its own full-width row
            and the other three share a single row below it, short labels so
            all three fit without wrapping. `sm:` and up: the original
            single-row toolbar, unchanged. */}
        <div className="border-t border-line px-3 py-2.5 sm:px-4">
          <div className="sm:hidden">
            <Button
              variant="primary"
              icon={<Save className="size-4" />}
              disabled={!canPost}
              onClick={() => setConfirmPost(true)}
              title={blockingReason}
              className="w-full"
            >
              حفظ الفاتورة
            </Button>

            {!canPost && blockingReason && (
              <span className="mt-2 flex items-center gap-1.5 text-[11px] text-accent-600 dark:text-accent-400">
                <AlertCircle className="size-3.5 shrink-0" />
                {validation?.problems.map((p) => p.message).join(' • ')}
              </span>
            )}

            {/* grid, not flex: equal-width columns cannot exceed the viewport
                the way flex-basis-from-content could on a narrow phone — that
                let a label get clipped past the screen edge. Two columns now:
                saving is the full-width button above, and there is no longer a
                separate "save as draft" to sit down here beside it. */}
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Button
                variant="ghost" icon={<Trash2 className="size-4" />}
                className="justify-center whitespace-nowrap px-2"
                onClick={() => setConfirmDiscard(true)}
              >
                حذف
              </Button>
              <Button
                variant="ghost" icon={<LogOut className="size-4" />}
                className="justify-center whitespace-nowrap px-2"
                onClick={() => navigate('/')}
              >
                خروج
              </Button>
            </div>
          </div>

          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <Button
              variant="primary"
              icon={<Save className="size-4" />}
              disabled={!canPost}
              onClick={() => setConfirmPost(true)}
              title={blockingReason}
            >
              حفظ الفاتورة
            </Button>

            {/* The banner that used to carry this is gone, but a disabled button
                with no stated reason is a dead end — so the reason moves here,
                as one line rather than a block. */}
            {!canPost && blockingReason && (
              <span className="flex items-center gap-1.5 text-[11px] text-accent-600 dark:text-accent-400">
                <AlertCircle className="size-3.5 shrink-0" />
                {validation?.problems.map((p) => p.message).join(' • ')}
              </span>
            )}

            <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>حذف الفاتورة</Button>
            <Button variant="ghost" className="ms-auto" onClick={() => navigate('/')}>خروج</Button>
          </div>
        </div>
      </Card>

      {/* Leaving with lines but without saving. There is no "keep for later"
          any more: an unsaved invoice is not stored anywhere the operator can
          reach it, so the only honest choices are to go back and save it, or
          to lose it knowingly. */}
      <Modal
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        size="sm"
        title="الفاتورة لم تُحفظ بعد"
        description={`هذه الفاتورة تحتوي ${fmtInt(lines.length)} سطراً ولم تؤثر على المخزون بعد. إذا خرجت الآن ستفقدها.`}
        footer={
          <>
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              loading={mutations.remove.isPending}
              onClick={dropDraft}
            >
              الخروج دون حفظ
            </Button>
            <Button variant="primary" onClick={() => blocker.reset?.()}>
              العودة والحفظ
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          <strong className="text-ink">العودة والحفظ</strong> يعيدك إلى الفاتورة لتحفظها — الحفظ
          يسجّل حركات المخزون مباشرة.
          <br />
          <strong className="text-ink">الخروج دون حفظ</strong> يزيلها نهائياً — لا يمكن التراجع.
        </p>
      </Modal>

      <ItemBrowserModal
        open={browserOpen}
        onClose={() => { setBrowserOpen(false); focusBarcode(); }}
        onPick={addSearchResult}
        priceKind={config.direction === 'IN' ? 'purchase' : 'sale'}
      />

      <ItemFormModal
        open={!!unknownBarcode}
        onClose={() => { setUnknownBarcode(null); focusBarcode(); }}
        lockedBarcode={unknownBarcode ?? undefined}
        title="تعريف صنف جديد"
        onCreated={(item) => addCreatedItem(item.id)}
      />

      <ConfirmDialog
        open={confirmPost}
        onClose={() => setConfirmPost(false)}
        onConfirm={post}
        loading={mutations.post.isPending}
        tone="success"
        title="حفظ الفاتورة"
        confirmLabel="حفظ نهائي"
        message={
          <>
            سيتم تسجيل {fmtInt(lines.length)} حركة مخزون
            {config.direction === 'IN' ? ' واردة' : ' صادرة'} وتحديث الأرصدة، وتحديث أسعار
            الأصناف المحددة. <strong className="text-ink">بعد الحفظ لا يمكن تعديل الفاتورة</strong> —
            يُصحَّح الخطأ بفاتورة جديدة.
          </>
        }
      />

      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={discard}
        loading={mutations.remove.isPending}
        title="حذف الفاتورة"
        confirmLabel="حذف"
        message="سيتم حذف هذه الفاتورة نهائياً. لم تؤثر على المخزون بعد."
      />
    </>
  );
}

/** One editable line. Values commit on blur or Enter, never on every keystroke. */
function LineRow({
  line, index, invoiceId, direction, flash, onDone,
}: {
  line: InvoiceLine; index: number; invoiceId: string;
  direction: 'IN' | 'OUT'; flash: boolean; onDone: () => void;
}) {
  const mutations = useInvoiceMutations(invoiceId);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const { canSeeSalePrice, canEditPrices } = usePermissions();
  // Absent for a staff role — the three price cells below are not rendered
  // for them, so this state is simply unused rather than wrong.
  const [price, setPrice] = useState(String(line.unit_price ?? ''));

  useEffect(() => { setQuantity(String(line.quantity)); }, [line.quantity]);
  useEffect(() => { setPrice(String(line.unit_price ?? '')); }, [line.unit_price]);

  const commit = (patch: { quantity?: number; unit_id?: string | null; unit_price?: number; update_item_price?: boolean }) => {
    mutations.updateLine.mutate({ id: invoiceId, lineId: line.id, ...patch },
      { onError: (error) => toastError(error, 'تعذّر تحديث السطر') });
  };

  const commitQuantity = () => {
    const value = Number(quantity);
    if (!Number.isInteger(value) || value < 1) { setQuantity(String(line.quantity)); return; }
    if (value !== line.quantity) commit({ quantity: value });
  };

  const commitPrice = () => {
    const value = Number(price);
    if (!Number.isFinite(value) || value < 0) { setPrice(String(line.unit_price ?? '')); return; }
    if (value !== line.unit_price) commit({ unit_price: value });
  };

  // Outbound lines that exceed the balance are flagged before posting is attempted.
  // This is a per-line visual hint only — the authoritative check on the server
  // aggregates base-unit quantity across all lines of the same item.
  const short = direction === 'OUT' && line.quantity * line.conversion_factor > line.item_quantity;

  return (
    // line-row: on phone/tablet, photo + name + unit + price + quantity +
    // total all flow onto one row (wrapping to a second line if a phone is
    // too narrow) — see the .line-row rules in index.css. Order-only, so
    // the desktop table's column order (matching its <thead>) never moves.
    <tr className={cn('line-row', flash && 'animate-flash', short && 'bg-accent-500/5')}>
      {/* Row number is a desktop-table affordance. Below lg it was claiming a
          full-width row of the card for a single digit. */}
      <td className="nums text-center text-xs text-subtle max-lg:hidden">{index}</td>
      <td data-label="رمز المادة" className="line-code">
        <BarcodeChip code={line.barcode_scanned || line.item_barcode} />
      </td>
      <td data-thumb className="pe-0">
        <Thumb url={line.item_image_url} alt={line.item_name} className="size-9" />
      </td>
      <td data-primary>
        <Link
          to={`/items/${line.item_id}`}
          className="block truncate text-sm font-semibold max-lg:text-xs hover:text-brand-600 dark:hover:text-brand-400"
        >
          {line.item_name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {/* The unit, spelled out — but only when the line actually uses one.
              Its picker sits in a 4rem cell on this row and clips longer names
              to "أسا…", so the readable copy lives here and the control stays
              a control. A line on the base unit says nothing here: "أساسية" is
              the default on every such line, so it was pure repetition. */}
          {!!line.unit_name && (
            <span className="text-[11px] font-medium text-muted">{line.unit_name}</span>
          )}
          {/* Below lg the barcode's own cell is hidden (it cost a whole row for
              one chip) and the code rides here instead — but only when there
              *is* one: a "بدون باركود" placeholder is noise on a phone, where
              the photo and name already identify the line. */}
          {!!(line.barcode_scanned || line.item_barcode) && (
            <BarcodeChip
              code={line.barcode_scanned || line.item_barcode}
              className="lg:hidden"
            />
          )}
          {short && <Badge tone="danger">كمية غير كافية</Badge>}
        </div>
      </td>
      {/* Quantity + unit ride the name's row on a narrow phone (fixed, tight
          widths — see .line-compact--tight in index.css) instead of forming
          their own row; the name shrinks to make room (truncate + min-width:
          0 above). Price still gets forced onto a fresh row of its own via
          .line-break, since a third field wouldn't fit here. */}
      <td data-label="الكمية" className="line-compact line-compact--tight">
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={commitQuantity}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitQuantity(); onDone(); }
          }}
          onFocus={(e) => e.currentTarget.select()}
          type="number" min="1" step="1" inputMode="numeric"
          className="field nums h-8 py-0 text-center text-xs font-bold"
          aria-label="الكمية"
        />
      </td>
      {/*
        The unit picker only appears for items that actually have units. With
        none configured, `item_units` is empty and the whole control offers a
        single choice — "أساسية" — so it was a field that could not be filled
        in wrongly or rightly, taking width on the row from the item name.

        The cell itself stays either way: this is one column of a table on
        desktop, and dropping the <td> for some rows would shift every cell
        after it out of its heading. Left empty it holds the column open
        there, and on phone the stacked layout's `td:empty` rule removes it
        from the flex row entirely, so the name reclaims the space.
      */}
      <td data-label="الوحدة" className="line-compact line-compact--tight line-compact--unit">
        {line.item_units.length > 0 && (
          <select
            value={line.unit_id ?? ''}
            onChange={(e) => commit({ unit_id: e.target.value || null })}
            className="field h-8 py-0 text-center text-xs"
            aria-label="الوحدة"
          >
            <option value="">أساسية</option>
            {line.item_units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
      </td>
      {/* Price and line total are one group: a role that cannot read a price
          has no use for either, and the server fills the price from the item
          when the field is absent. Dropping the cells (rather than blanking
          them) keeps the row aligned with the <thead>, which drops the same
          columns. A clerk gets both cells — it can read a sale price — but a
          plain read-out instead of the input: `canEditPrices` is false for
          it, and the server drops `unit_price` from any body it sends
          anyway (see stripMoneyFromBody), so an editable-looking field would
          be a control that lies about what it does. */}
      {canSeeSalePrice && (
        <>
          <td className="line-break lg:hidden" aria-hidden />
          <td data-label="السعر" className="line-compact line-compact--tight line-compact--price">
            {canEditPrices ? (
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onBlur={commitPrice}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitPrice(); onDone(); } }}
                onFocus={(e) => e.currentTarget.select()}
                type="number" min="0" step="0.01" inputMode="decimal"
                className="field nums h-8 py-0 text-center text-xs"
                aria-label="سعر الوحدة"
              />
            ) : (
              <span className="nums flex h-8 items-center justify-center text-xs font-bold" aria-label="سعر الوحدة">
                {fmtCurrency(line.unit_price)}
              </span>
            )}
          </td>
          <td data-label="الإجمالي" className="line-total nums text-center font-bold max-lg:text-brand-600 dark:max-lg:text-brand-400">
            {fmtCurrency(line.line_total)}
          </td>
        </>
      )}
      {/* Two captions: the full one heads the desktop column, the short one is
          what the phone renders. "تحديث السعر" is the widest fixed thing on the
          second row, and at 320px it was the difference between two rows and
          three. Manager-only: it rewrites the item's stored price, which is
          an edit like any other — gated on `canEditPrices`, not
          `canSeeSalePrice`, so a clerk that can read this line's price still
          cannot use the toggle. */}
      {canEditPrices && (
        <td
          data-label="تحديث السعر"
          data-label-short="تحديث"
          className="line-tail line-tail--toggle text-center"
        >
          <input
            type="checkbox"
            checked={line.update_item_price}
            onChange={(e) => commit({ update_item_price: e.target.checked })}
            className="size-4 cursor-pointer accent-brand-600"
            title="عند الحفظ، حدّث سعر الصنف المخزَّن ليساوي سعر هذا السطر"
          />
        </td>
      )}
      <td className="line-tail">
        <Button
          size="icon" variant="ghost" className="size-8 hover:text-accent-600 dark:hover:text-accent-400" title="حذف السطر"
          onClick={() => mutations.removeLine.mutate({ id: invoiceId, lineId: line.id },
            { onSuccess: onDone, onError: (e) => toastError(e, 'تعذّر حذف السطر') })}
        >
          <X className="size-4" />
        </Button>
      </td>
    </tr>
  );
}


/** Label beside its field, as classic data-entry forms are laid out. */
function FormRow({
  label, children, required, labelWidth = 'w-20',
}: {
  label: string; children: React.ReactNode; required?: boolean; labelWidth?: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className={cn('shrink-0 text-[11px] text-muted', labelWidth)}>
        {label}{required && <span className="text-accent-600 dark:text-accent-400"> *</span>}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function Balance({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[11px] text-subtle">{label}</span>
      <span className="nums text-xs font-bold">{value}</span>
    </span>
  );
}
