import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Printer, ArrowRight, FileText, Lock, ClipboardList, Loader2,
  Pencil, Trash2, Undo2, TrendingUp, Info, ReceiptText,
} from 'lucide-react';
import {
  Button, Card, PageHeader, Badge, EmptyState, Stat, ConfirmDialog,
} from '@/components/ui';
import {
  BarcodeChip, INVOICE_TYPES, InvoiceStatusBadge, MovementBadge, SourceBadge,
} from '@/components/domain';
import { Thumb } from '@/components/ImagePicker';
import { useInvoice, useInvoiceMutations } from '@/hooks';
import { fmtCurrency, fmtDate, fmtDateTime, fmtInt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePrefs } from '@/store/prefs';
import { usePermissions } from '@/lib/permissions';
import { toast, toastError } from '@/store/toast';
import { printAs, lastPaper, PAPER_LABEL, type PaperFormat } from '@/lib/print';

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: invoice, isLoading } = useInvoice(id);
  const { canSeePrices, isManager } = usePermissions();
  const { reverse, reopen } = useInvoiceMutations(id);
  const [confirming, setConfirming] = useState<'reverse' | 'reopen' | null>(null);
  const companyName = usePrefs((s) => s.companyName);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <Card>
        <EmptyState
          icon={<FileText className="size-6" />}
          title="الفاتورة غير موجودة"
          action={<Link to="/invoices"><Button variant="primary">العودة إلى الفواتير</Button></Link>}
        />
      </Card>
    );
  }

  // An unsaved invoice has no stock effect and nothing to show a record of, so
  // there is no read-only view of one to land on — it goes back to the editor,
  // which is the only place it can be finished. The editor redirects the other
  // way for anything already saved, so the two guards do not chase each other.
  if (invoice.status === 'DRAFT') return <Navigate to={`/invoices/${invoice.id}/edit`} replace />;

  const config = INVOICE_TYPES[invoice.type];

  /*
   * Profit is a sales question. A STOCK_IN document has no margin — it is
   * inventory changing form — so the whole panel and both extra columns are
   * absent on one rather than showing a column of dashes.
   */
  // A draft has already been redirected away above, so status needs no test
  // here; `profit` being non-null is what rules out an unposted document.
  const showsProfit = canSeePrices && invoice.type === 'STOCK_OUT' && invoice.profit != null;

  const correct = (kind: 'reverse' | 'reopen') => {
    const mutation = kind === 'reverse' ? reverse : reopen;
    mutation.mutate(invoice.id, {
      onSuccess: (updated) => {
        setConfirming(null);
        if (kind === 'reopen') {
          toast.success('فُتحت الفاتورة للتعديل', `أُعيد أثرها على المخزون. رقمها ${updated.number} كما هو.`);
          navigate(`/invoices/${invoice.id}/edit`, { replace: true });
        } else {
          toast.success('تم حذف الفاتورة', 'أُعيد أثرها على المخزون، وبقيت في السجل ملغاة وموثّقة.');
        }
      },
      onError: (error) => toastError(error, kind === 'reopen' ? 'تعذّر فتح الفاتورة' : 'تعذّر حذف الفاتورة'),
    });
  };

  const partyLabel = invoice.customer_id
    ? 'العميل'
    : invoice.supplier_id
      ? 'المورد'
      : (config.direction === 'OUT' ? 'العميل' : 'المورد');

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/invoices" className="inline-flex items-center gap-1 hover:text-brand-500">
            <ArrowRight className="size-3" /> الفواتير
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {config.label}
            <span className="nums font-mono text-base text-subtle">{invoice.number}</span>
            <InvoiceStatusBadge status={invoice.status} />
            <SourceBadge source={invoice.source} />
          </span>
        }
        actions={
          <>
            {isManager && invoice.status === 'POSTED' && (
              <>
                <Button
                  icon={<Pencil className="size-4" />}
                  onClick={() => setConfirming('reopen')}
                  loading={reopen.isPending}
                >
                  تعديل
                </Button>
                {/* "عكس" is the accountant's word for it. What the person
                    holding a wrong invoice wants is to delete it, so the button
                    says that -- and the dialog is where the difference gets
                    explained, because the action really is a reversal: the
                    stock comes back, the number stays spent, and the document
                    stays in the record as ملغاة. */}
                <Button
                  variant="danger"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => setConfirming('reverse')}
                  loading={reverse.isPending}
                >
                  حذف الفاتورة
                </Button>
              </>
            )}
            {/* Two objects, not one setting: A4 is the document that gets
                filed, 80mm is the slip the thermal printer hands over the
                counter. Whichever was used last is the one on the left. */}
            {([lastPaper(), lastPaper() === 'a4' ? 'receipt' : 'a4'] as PaperFormat[]).map((format, i) => (
              <Button
                key={format}
                variant={i === 0 ? 'secondary' : 'ghost'}
                icon={format === 'a4' ? <Printer className="size-4" /> : <ReceiptText className="size-4" />}
                onClick={() => printAs(format)}
              >
                {`طباعة ${PAPER_LABEL[format]}`}
              </Button>
            ))}
          </>
        }
      />

      {/* What this banner says depends on who is reading it: a posted invoice is
          still final for everyone except a manager, and telling a staff account
          that it "can be corrected by a manager" only invites a request that
          the API would refuse. */}
      {invoice.status === 'POSTED' && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-2.5 text-sm no-print">
          <Lock className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-muted">
            {isManager
              ? 'فاتورة مرحّلة. التعديل أو العكس يعيد أثرها على المخزون بقيود معاكسة — لا يُحذف من السجل شيء.'
              : 'فاتورة مرحّلة وغير قابلة للتعديل — أي تصحيح يتم عبر فاتورة جديدة.'}
            {invoice.posted_at && <span className="nums"> رُحّلت في {fmtDateTime(invoice.posted_at)}.</span>}
            {invoice.revision > 0 && (
              <span className="nums"> عُدّلت {fmtInt(invoice.revision)} مرة.</span>
            )}
          </span>
        </div>
      )}

      {invoice.is_reversed && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-accent-500/25 bg-accent-500/8 px-4 py-2.5 text-sm no-print">
          <Undo2 className="size-4 shrink-0 text-accent-600 dark:text-accent-400" />
          <span className="text-muted">
            فاتورة معكوسة — أُعيد أثرها على المخزون بالكامل، وبقيت هنا للسجل.
            {invoice.reversed_at && <span className="nums"> عُكست في {fmtDateTime(invoice.reversed_at)}</span>}
            {invoice.reversed_by && <> بواسطة {invoice.reversed_by}</>}.
          </span>
        </div>
      )}

      {invoice.stock_count_id && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/8 px-4 py-2.5 text-sm no-print">
          <ClipboardList className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <span className="text-muted">
            أُنشئت آلياً من جلسة الجرد{' '}
            <Link to={`/stock-counts/${invoice.stock_count_id}`}
              className="nums font-semibold text-sky-600 hover:underline dark:text-sky-400">
              {invoice.stock_count_number}
            </Link>
          </span>
        </div>
      )}

      <Card className="print-area overflow-hidden">
        {/* Document header */}
        <div className="doc-head flex flex-wrap items-start justify-between gap-6 border-b border-line p-6">
          <div>
            <p className="text-lg font-bold">{companyName}</p>
            <p className="mt-0.5 text-xs text-muted">{config.label}</p>
          </div>
          <div className="doc-meta grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Stat label="رقم الفاتورة" value={<span className="font-mono">{invoice.number}</span>} />
            <Stat label="التاريخ" value={fmtDate(invoice.invoice_date)} />
            <Stat label={partyLabel} value={invoice.party_name || '—'} />
            <Stat label="أنشأها" value={invoice.created_by} />
          </div>
        </div>

        {/* Lines */}
        <div className="doc-lines overflow-x-auto">
          <table className="data-table stacked">
            <thead>
              <tr>
                <th className="w-10 text-center">#</th>
                <th className="w-px" aria-label="الصورة" />
                <th>الصنف</th>
                <th>الباركود</th>
                <th className="text-center">الكمية</th>
                {canSeePrices && <th className="text-center">سعر الوحدة</th>}
                {showsProfit && <th className="text-center no-print">التكلفة</th>}
                {canSeePrices && <th className="text-center">الإجمالي</th>}
                {showsProfit && <th className="text-center no-print">الربح</th>}
              </tr>
            </thead>
            <tbody>
              {invoice.lines?.map((line, index) => (
                <tr key={line.id}>
                  <td className="nums text-center text-xs text-subtle">{index + 1}</td>
                  <td data-thumb className="pe-0">
                    <Thumb url={line.item_image_url} alt={line.item_name} className="size-9" />
                  </td>
                  <td data-primary>
                    <Link to={`/items/${line.item_id}`} className="font-semibold hover:text-brand-600 dark:hover:text-brand-400">
                      {line.item_name}
                    </Link>
                    {line.note && <p className="mt-0.5 text-[11px] text-subtle">{line.note}</p>}
                  </td>
                  <td data-label="الباركود"><BarcodeChip code={line.barcode_scanned || line.item_barcode} /></td>
                  <td data-label="الكمية" className="nums text-center font-bold">{fmtInt(line.quantity)}</td>
                  {canSeePrices && (
                    <td data-label="سعر الوحدة" className="nums text-center">{fmtCurrency(line.unit_price)}</td>
                  )}
                  {showsProfit && (
                    <td data-label="التكلفة" className="nums text-center text-muted no-print">{fmtCurrency(line.line_cost)}</td>
                  )}
                  {canSeePrices && (
                    <td data-label="الإجمالي" className="nums text-center font-bold">{fmtCurrency(line.line_total)}</td>
                  )}
                  {/* A loss-making line is worth seeing at a glance, so the
                      sign drives the colour rather than the column doing so. */}
                  {showsProfit && (
                    <td
                      data-label="الربح"
                      className={cn(
                        'nums text-center font-bold no-print',
                        (line.line_profit ?? 0) < 0
                          ? 'text-accent-600 dark:text-accent-400'
                          : 'text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {fmtCurrency(line.line_profit)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="doc-totals flex flex-wrap justify-between gap-6 border-t border-line bg-surface-2 p-6">
          <div className="max-w-md text-xs leading-relaxed text-muted">
            {invoice.note && (
              <>
                <p className="mb-1 font-semibold text-ink">ملاحظات</p>
                <p>{invoice.note}</p>
              </>
            )}
          </div>
          {/* The whole money panel, not just its numbers: a labelled but empty
              "الإجمالي" row is worse than no panel. Staff get the line count,
              which is what they check a delivery against. */}
          {canSeePrices ? (
            <div className="w-full max-w-xs space-y-2 text-sm">
              <Row label="المجموع" value={fmtCurrency(invoice.subtotal)} />
              {(invoice.discount_total ?? 0) > 0 && (
                <Row label="الخصم" value={`− ${fmtCurrency(invoice.discount_total)}`} tone="text-accent-600 dark:text-accent-400" />
              )}
              {(invoice.tax_total ?? 0) > 0 && <Row label="الضريبة" value={`+ ${fmtCurrency(invoice.tax_total)}`} />}
              <div className="flex items-center justify-between border-t border-line pt-2.5">
                <span className="font-bold">الإجمالي</span>
                <span className="nums text-xl font-bold text-brand-600 dark:text-brand-400">
                  {fmtCurrency(invoice.total)}
                </span>
              </div>

              {/* Profit sits below the total and visibly apart from it: the
                  total is what the customer pays, this is what the business
                  keeps, and running them together is how the two get confused.

                  `no-print` on this panel and on the two profit columns above
                  is not cosmetic. This invoice gets handed to the customer or
                  the supplier it names, and a printout that discloses the
                  margin on their own order is a commercial problem, not a
                  layout one. On screen it is manager-only; on paper it is
                  nobody's. */}
              {showsProfit && (
                <div className="no-print mt-3 space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3">
                  <Row label="تكلفة البضاعة" value={fmtCurrency(invoice.cost_total)} />
                  <div className="flex items-center justify-between border-t border-emerald-500/20 pt-2">
                    <span className="flex items-center gap-1.5 font-bold">
                      <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
                      الربح
                    </span>
                    <span
                      className={cn(
                        'nums text-xl font-bold',
                        (invoice.profit ?? 0) < 0
                          ? 'text-accent-600 dark:text-accent-400'
                          : 'text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {fmtCurrency(invoice.profit)}
                    </span>
                  </div>
                  {invoice.margin_pct != null && (
                    <p className="nums text-[11px] text-muted">
                      هامش الربح {invoice.margin_pct}% من صافي المبيعات
                      {(invoice.discount_total ?? 0) > 0 && ' بعد الخصم'}
                      {(invoice.tax_total ?? 0) > 0 && ' وقبل الضريبة'}
                    </p>
                  )}
                  {/* Says so plainly rather than quietly presenting a
                      reconstructed number as a recorded one. */}
                  {invoice.profit_exact === false && (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                      <Info className="mt-px size-3 shrink-0" />
                      تكلفة تقديرية: هذه الفاتورة رُحّلت قبل تفعيل حفظ التكلفة، فحُسبت من سعر الشراء الحالي.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full max-w-xs text-sm">
              <div className="flex items-center justify-between border-t border-line pt-2.5">
                <span className="font-bold">عدد الأصناف</span>
                <span className="nums text-xl font-bold">{fmtInt(invoice.line_count)}</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Both confirmations spell out the stock consequence, because that is
          the part a manager cannot see from the invoice in front of them. */}
      <ConfirmDialog
        open={confirming === 'reopen'}
        onClose={() => setConfirming(null)}
        onConfirm={() => correct('reopen')}
        title="فتح الفاتورة للتعديل؟"
        tone="primary"
        confirmLabel="فتح للتعديل"
        loading={reopen.isPending}
        message={
          <>
            سيُعاد أثر الفاتورة على المخزون بقيود معاكسة، وتعود مسودة برقمها
            <span className="nums font-semibold"> {invoice.number} </span>
            نفسه لتعديلها ثم ترحيلها من جديد.
            <span className="mt-2 block text-xs">
              لا يُحذف من سجل الحركات شيء — تبقى القيود الأصلية وقيود العكس ظاهرة معاً.
            </span>
          </>
        }
      />
      <ConfirmDialog
        open={confirming === 'reverse'}
        onClose={() => setConfirming(null)}
        onConfirm={() => correct('reverse')}
        title="حذف الفاتورة؟"
        confirmLabel="حذف الفاتورة"
        loading={reverse.isPending}
        message={
          <>
            سيُعاد أثر الفاتورة
            <span className="nums font-semibold"> {invoice.number} </span>
            على المخزون بالكامل: ما خرج يعود وما دخل يُخصم، وتُعلَّم الفاتورة كملغاة.
            <span className="mt-2 block text-xs">
              لا تُمحى من السجل: رقمها مستهلك وحركاتها مسجّلة، فتبقى ظاهرة كملغاة مع
              قيود عكسها بجانبها — وهذا ما يجعل الجرد والتقارير تظل متطابقة.
            </span>
          </>
        }
      />

      {/* Generated ledger entries */}
      {!!invoice.movements?.length && (
        <Card className="mt-4 overflow-hidden no-print">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-bold">حركات المخزون الناتجة</h2>
            <Badge tone="neutral">{fmtInt(invoice.movements.length)} حركة</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>النوع</th>
                  <th className="text-center">الكمية</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {invoice.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>
                      <Link to={`/items/${movement.item_id}`} className="font-semibold hover:text-brand-600 dark:hover:text-brand-400">
                        {movement.item_name}
                      </Link>
                    </td>
                    <td><MovementBadge type={movement.type} /></td>
                    <td className="nums text-center font-bold">{fmtInt(movement.quantity)}</td>
                    <td className="text-xs text-muted">{fmtDateTime(movement.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`nums font-semibold ${tone ?? ''}`}>{value}</span>
    </div>
  );
}
