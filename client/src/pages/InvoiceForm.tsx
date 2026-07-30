import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, Save, CheckCircle2, AlertCircle, X, Trash2,
} from 'lucide-react';
import {
  Button, Card, Input, Select, ConfirmDialog, Modal, Badge,
} from '@/components/ui';
import { ItemFormModal } from '@/components/ItemFormModal';
import { Thumb } from '@/components/ImagePicker';
import {
  AnchoredPopover, ItemBrowserModal, ItemListDropdown, ItemPickerButtons,
} from '@/components/ItemPicker';
import { BarcodeChip, INVOICE_TYPES, InvoiceTypeBadge } from '@/components/domain';
import {
  useInvoice, useInvoiceMutations, useInvoiceValidation, useItemSearch, useParties,
} from '@/hooks';
import { ApiError } from '@/lib/api';
import { fmtCurrency, fmtInt, todayIso } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import { cn } from '@/lib/cn';
import type { Invoice, InvoiceLine, InvoiceType, Item } from '@/lib/types';

/**
 * Deleting is idempotent: a 404 means the invoice is already gone, which is
 * exactly the end state the operator asked for. It happens routinely here
 * because the database is shared — another device may have removed the same
 * draft first — and reporting it as a failure both alarms the operator and
 * strands them on a form whose invoice no longer exists.
 */
const alreadyGone = (error: unknown) => error instanceof ApiError && error.status === 404;

export default function InvoiceForm() {
  const { id: routeId } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const requestedType = (params.get('type') as InvoiceType) || 'SALE';
  const [invoiceId, setInvoiceId] = useState<string | undefined>(routeId);
  const creatingRef = useRef(false);

  const { data: invoice, isLoading } = useInvoice(invoiceId);
  const mutations = useInvoiceMutations(invoiceId);

  /**
   * Asking for a different type is asking for a different document.
   *
   * `/invoices/new?type=STOCK_IN` and `?type=STOCK_OUT` share a pathname, so
   * without this the draft already on screen simply stayed — the ribbon's
   * إخراج button appeared to do nothing at all.
   */
  const servedType = useRef(requestedType);
  useEffect(() => {
    if (routeId || servedType.current === requestedType) return;
    servedType.current = requestedType;
    creatingRef.current = false;

    // The draft being left behind was auto-created on arrival. If nothing was
    // ever entered into it, it is litter — a numbered row nobody asked for —
    // so drop it rather than leaving it in the invoice list. A draft *with*
    // lines has already been decided on by the leave dialog; leave it alone.
    const abandoned = invoiceId;
    if (abandoned && !invoice?.lines?.length) {
      mutations.remove.mutateAsync(abandoned).catch(() => {
        /* Losing an empty draft is not worth interrupting the user for. */
      });
    }
    setInvoiceId(undefined);
  }, [requestedType, routeId, invoiceId, invoice, mutations.remove]);

  // Create the draft on first render when arriving at /invoices/new.
  useEffect(() => {
    if (routeId || invoiceId || creatingRef.current) return;
    creatingRef.current = true;
    mutations.create.mutateAsync({ type: requestedType, invoice_date: todayIso() })
      .then((created) => setInvoiceId(created.id))
      .catch((error) => { toastError(error, 'تعذّر إنشاء الفاتورة'); navigate('/invoices'); });
  }, [routeId, invoiceId, requestedType, mutations.create, navigate]);

  if (isLoading || !invoice) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (invoice.status !== 'DRAFT') {
    navigate(`/invoices/${invoice.id}`, { replace: true });
    return null;
  }

  // Keyed by id: a new draft must start with clean editor state, or the
  // "already decided to leave" flag would carry over and disarm its guard.
  return <DraftEditor key={invoice.id} invoice={invoice} />;
}

function DraftEditor({ invoice }: { invoice: Invoice }) {
  const navigate = useNavigate();
  const mutations = useInvoiceMutations(invoice.id);
  const { data: validation } = useInvoiceValidation(invoice.id);

  const config = INVOICE_TYPES[invoice.type];
  const needsParty = invoice.type === 'SALE' || invoice.type === 'PURCHASE';
  const partyKind = invoice.type === 'SALE' ? 'customers' : 'suppliers';
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
   * Set before a departure the operator already decided on (posting, deleting,
   * or choosing "keep as draft"), so the guard below does not ask twice about
   * a navigation that *is* the answer.
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

  /** Add a line for an item picked from the name-search results. */
  const addSearchResult = async (item: Item) => {
    try {
      const result = await mutations.addLine.mutateAsync({
        id: invoice.id, item_id: item.id, quantity: nextQuantity(),
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
      toast.success(`تم ترحيل الفاتورة ${posted.number}`, 'تم تسجيل حركات المخزون وتحديث الأرصدة');
      navigate(`/invoices/${posted.id}`);
    } catch (error) {
      inFlightRef.current = false;
      decidedRef.current = false;
      setConfirmPost(false);
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
        const details = (error.payload.lines ?? []) as Array<{ item_name: string; available: number; requested: number }>;
        toast.error('الكمية غير كافية في المخزون',
          details.map((d) => `${d.item_name}: المتوفر ${d.available} والمطلوب ${d.requested}`).join(' • '));
      } else {
        toastError(error, 'تعذّر ترحيل الفاتورة');
      }
    }
  };

  const discard = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      decidedRef.current = true;
      await mutations.remove.mutateAsync(invoice.id);
      toast.info('تم حذف المسودة');
      navigate('/invoices');
    } catch (error) {
      if (alreadyGone(error)) { navigate('/invoices'); return; }
      inFlightRef.current = false;
      decidedRef.current = false;
      toastError(error, 'تعذّر حذف المسودة');
    }
  };

  /**
   * Leaving an unposted invoice that already has lines is almost always a
   * mistake — the stock has not moved yet. An empty draft is deliberately not
   * guarded: there is nothing to lose, and asking would be noise.
   */
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => {
      if (!lines.length || decidedRef.current) return false;
      // Compare the search string too: switching إدخال → إخراج only changes
      // `?type=`, and that starts a different document just as surely as
      // leaving the page does.
      const key = (l: { pathname: string; search: string }) => l.pathname + l.search;
      return key(currentLocation) !== key(nextLocation);
    },
  );

  // Closing the window or reloading bypasses the router entirely, so the
  // browser's own prompt covers that route out.
  useEffect(() => {
    if (!lines.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [lines.length]);

  /** Leave and keep the draft — it is already stored server-side. */
  const keepDraft = () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    decidedRef.current = true;
    toast.success('المسودة محفوظة', `يمكنك متابعتها لاحقاً من الفواتير — ${invoice.number}`);
    blocker.proceed?.();
  };

  /** Leave and throw the draft away. */
  const dropDraft = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      decidedRef.current = true;
      await mutations.remove.mutateAsync(invoice.id);
      toast.info('تم حذف المسودة');
      blocker.proceed?.();
    } catch (error) {
      if (alreadyGone(error)) { blocker.proceed?.(); return; }
      inFlightRef.current = false;
      decidedRef.current = false;
      blocker.reset?.();
      toastError(error, 'تعذّر حذف المسودة');
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
          <div className="space-y-2">
            {needsParty ? (
              <FormRow label={invoice.type === 'SALE' ? 'حـ/العميل' : 'حـ/المورد'} required>
                <Select
                  value={(invoice.type === 'SALE' ? invoice.customer_id : invoice.supplier_id) ?? ''}
                  onChange={(e) => patchHeader(
                    invoice.type === 'SALE'
                      ? { customer_id: e.target.value || null }
                      : { supplier_id: e.target.value || null },
                  )}
                  className="h-8 py-0 text-xs"
                >
                  <option value="">— اختر —</option>
                  {parties?.data.map((party) => (
                    <option key={party.id} value={party.id}>{party.name}</option>
                  ))}
                </Select>
              </FormRow>
            ) : (
              <FormRow label="النوع">
                <span className="flex h-8 items-center gap-2 text-[11px] text-muted">
                  <InvoiceTypeBadge type={invoice.type} />
                  تسوية داخلية — لا تتطلب عميلاً أو مورداً
                </span>
              </FormRow>
            )}
          </div>

          {/* One column on a phone: side by side, the date input is clipped. */}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <FormRow label="الرقم" labelWidth="w-14">
              <span className="nums flex h-8 items-center font-mono text-xs font-bold">
                {invoice.number}
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
                <th className="w-28 text-center">{priceLabel}</th>
                <th className="w-32 text-center">الإجمالي</th>
                <th className="w-16 text-center" title="تحديث سعر الصنف عند الترحيل">تحديث السعر</th>
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

              {/* Entry row */}
              <tr className="bg-brand-500/5">
                <td className="nums text-center text-xs font-bold text-brand-600 max-sm:hidden dark:text-brand-400">
                  {lines.length + 1}
                </td>
                {/* No data-label: on a phone the label would share the row
                    with the field and the two picker buttons, leaving the
                    scan box too narrow to read a barcode in. */}
                <td ref={entryCellRef}>
                  <span className="flex w-full items-center gap-1">
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
                    className="field h-9 min-w-0 flex-1 py-0 text-sm sm:h-8 sm:text-xs"
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
                <td className="max-sm:hidden" />
                <td className="text-[11px] text-subtle max-sm:hidden">
                  {searching
                    ? <span className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> جارٍ البحث…</span>
                    : 'اكتب ثم اختر من القائمة، أو امسح الباركود'}
                </td>
                <td data-label="الكمية">
                  <input
                    type="number" min="1" step="1" inputMode="numeric"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusBarcode(); } }}
                    aria-label="الكمية المضافة"
                    className="field nums h-8 py-0 text-center text-xs font-bold"
                  />
                </td>
                <td colSpan={4} className="text-[11px] text-subtle max-sm:hidden">
                  يُؤخذ السعر من بطاقة الصنف ويمكن تعديله بعد الإضافة
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Balances */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line bg-surface-2 px-3 py-2.5 sm:gap-x-8 sm:px-4">
          <Balance label="عدد السجلات" value={fmtInt(lines.length)} />
          <Balance label="الكميات" value={fmtInt(lines.reduce((sum, l) => sum + l.quantity, 0))} />
          {/* Discount and tax are no longer enterable, so they can only ever be
              zero here — showing them would be decoration. `subtotal` is dropped
              for the same reason: without them it always equals the net. */}
          <div className="ms-auto flex items-baseline gap-2">
            <span className="text-xs font-bold">الصافي</span>
            <span className="nums text-xl font-bold text-brand-600 dark:text-brand-400">
              {fmtCurrency(invoice.total)}
            </span>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5 max-sm:[&>button]:whitespace-nowrap sm:px-4">
          <Button
            variant="primary"
            icon={<CheckCircle2 className="size-4" />}
            disabled={!canPost}
            onClick={() => setConfirmPost(true)}
            title={blockingReason}
          >
            ترحيل الفاتورة
          </Button>

          {/* The banner that used to carry this is gone, but a disabled button
              with no stated reason is a dead end — so the reason moves here,
              as one line rather than a block. */}
          {!canPost && blockingReason && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-3.5 shrink-0" />
              {validation?.problems.map((p) => p.message).join(' • ')}
            </span>
          )}

          <Button
            icon={<Save className="size-4" />}
            onClick={() => {
              // An explicit answer — do not ask again on the way out.
              decidedRef.current = true;
              toast.success('المسودة محفوظة');
              navigate('/invoices');
            }}
          >
            حفظ كمسودة
          </Button>
          <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>حذف المسودة</Button>
          <Button variant="ghost" className="ms-auto" onClick={() => navigate('/invoices')}>خروج</Button>
        </div>
      </Card>

      {/* Leaving with lines on an unposted invoice — decide, do not lose it */}
      <Modal
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        size="sm"
        title="الفاتورة لم تُرحّل بعد"
        description={`الفاتورة ${invoice.number} تحتوي ${fmtInt(lines.length)} سطراً ولم تؤثر على المخزون بعد. ماذا تريد أن تفعل بها؟`}
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>البقاء في الفاتورة</Button>
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              loading={mutations.remove.isPending}
              onClick={dropDraft}
            >
              تجاهل وحذف
            </Button>
            <Button variant="primary" icon={<Save className="size-4" />} onClick={keepDraft}>
              حفظ كمسودة
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          <strong className="text-ink">حفظ كمسودة</strong> يبقيها في قائمة الفواتير لتكملها لاحقاً.
          <br />
          <strong className="text-ink">تجاهل وحذف</strong> يزيلها نهائياً — لا يمكن التراجع.
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
        title="ترحيل الفاتورة"
        confirmLabel="ترحيل نهائي"
        message={
          <>
            سيتم تسجيل {fmtInt(lines.length)} حركة مخزون
            {config.direction === 'IN' ? ' واردة' : ' صادرة'} وتحديث الأرصدة، وتحديث أسعار
            الأصناف المحددة. <strong className="text-ink">بعد الترحيل لا يمكن تعديل الفاتورة</strong> —
            يُصحَّح الخطأ بفاتورة جديدة.
          </>
        }
      />

      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={discard}
        loading={mutations.remove.isPending}
        title="حذف المسودة"
        confirmLabel="حذف"
        message="سيتم حذف هذه المسودة نهائياً. لم تؤثر على المخزون بعد."
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
  const [price, setPrice] = useState(String(line.unit_price));

  useEffect(() => { setQuantity(String(line.quantity)); }, [line.quantity]);
  useEffect(() => { setPrice(String(line.unit_price)); }, [line.unit_price]);

  const commit = (patch: { quantity?: number; unit_price?: number; update_item_price?: boolean }) => {
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
    if (!Number.isFinite(value) || value < 0) { setPrice(String(line.unit_price)); return; }
    if (value !== line.unit_price) commit({ unit_price: value });
  };

  // Outbound lines that exceed the balance are flagged before posting is attempted.
  const short = direction === 'OUT' && line.quantity > line.item_quantity;

  return (
    <tr className={cn(flash && 'animate-flash', short && 'bg-rose-500/5')}>
      <td className="nums text-center text-xs text-subtle max-sm:hidden">{index}</td>
      <td data-label="رمز المادة"><BarcodeChip code={line.barcode_scanned || line.item_barcode} /></td>
      <td data-thumb className="pe-0">
        <Thumb url={line.item_image_url} alt={line.item_name} className="size-9" />
      </td>
      <td data-primary>
        <Link
          to={`/items/${line.item_id}`}
          className="text-sm font-semibold hover:text-brand-600 dark:hover:text-brand-400"
        >
          {line.item_name}
        </Link>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={cn('nums text-[11px]', short ? 'font-bold text-rose-500' : 'text-subtle')}>
            الرصيد {fmtInt(line.item_quantity)}
          </span>
          {short && <Badge tone="danger">كمية غير كافية</Badge>}
        </div>
      </td>
      <td data-label="الكمية">
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={commitQuantity}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitQuantity(); onDone(); }
          }}
          onFocus={(e) => e.currentTarget.select()}
          type="number" min="1" step="1" inputMode="numeric"
          className="field nums h-8 py-0 text-center font-bold"
          aria-label="الكمية"
        />
      </td>
      <td data-label="السعر">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={commitPrice}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitPrice(); onDone(); } }}
          onFocus={(e) => e.currentTarget.select()}
          type="number" min="0" step="0.01" inputMode="decimal"
          className="field nums h-8 py-0 text-center"
          aria-label="سعر الوحدة"
        />
      </td>
      <td data-label="الإجمالي" className="nums text-center font-bold">{fmtCurrency(line.line_total)}</td>
      <td data-label="تحديث السعر" className="text-center">
        <input
          type="checkbox"
          checked={line.update_item_price}
          onChange={(e) => commit({ update_item_price: e.target.checked })}
          className="size-4 cursor-pointer accent-brand-600"
          title="عند الترحيل، حدّث سعر الصنف المخزَّن ليساوي سعر هذا السطر"
        />
      </td>
      <td>
        <Button
          size="icon" variant="ghost" className="size-8 hover:text-rose-500" title="حذف السطر"
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
        {label}{required && <span className="text-rose-500"> *</span>}
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
