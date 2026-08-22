import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Printer, ArrowRight, FileText, Lock, ClipboardList, Loader2,
} from 'lucide-react';
import {
  Button, Card, PageHeader, Badge, EmptyState, Stat,
} from '@/components/ui';
import {
  BarcodeChip, INVOICE_TYPES, InvoiceStatusBadge, MovementBadge, SourceBadge,
} from '@/components/domain';
import { Thumb } from '@/components/ImagePicker';
import { useInvoice } from '@/hooks';
import { fmtCurrency, fmtDate, fmtDateTime, fmtInt } from '@/lib/format';
import { usePrefs } from '@/store/prefs';
import { usePermissions } from '@/lib/permissions';

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: invoice, isLoading } = useInvoice(id);
  const { canSeePrices } = usePermissions();
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
  if (invoice.status === 'DRAFT') {
    navigate(`/invoices/${invoice.id}/edit`, { replace: true });
    return null;
  }

  const config = INVOICE_TYPES[invoice.type];
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
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>طباعة</Button>
        }
      />

      {invoice.status === 'POSTED' && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-2.5 text-sm no-print">
          <Lock className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-muted">
            فاتورة مرحّلة وغير قابلة للتعديل — أي تصحيح يتم عبر فاتورة جديدة.
            {invoice.posted_at && <span className="nums"> رُحّلت في {fmtDateTime(invoice.posted_at)}.</span>}
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
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-line p-6">
          <div>
            <p className="text-lg font-bold">{companyName}</p>
            <p className="mt-0.5 text-xs text-muted">{config.label}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Stat label="رقم الفاتورة" value={<span className="font-mono">{invoice.number}</span>} />
            <Stat label="التاريخ" value={fmtDate(invoice.invoice_date)} />
            <Stat label={partyLabel} value={invoice.party_name || '—'} />
            <Stat label="أنشأها" value={invoice.created_by} />
          </div>
        </div>

        {/* Lines */}
        <div className="overflow-x-auto">
          <table className="data-table stacked">
            <thead>
              <tr>
                <th className="w-10 text-center">#</th>
                <th className="w-px" aria-label="الصورة" />
                <th>الصنف</th>
                <th>الباركود</th>
                <th className="text-center">الكمية</th>
                {canSeePrices && <th className="text-center">سعر الوحدة</th>}
                {canSeePrices && <th className="text-center">الإجمالي</th>}
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
                  {canSeePrices && (
                    <td data-label="الإجمالي" className="nums text-center font-bold">{fmtCurrency(line.line_total)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex flex-wrap justify-between gap-6 border-t border-line bg-surface-2 p-6">
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
