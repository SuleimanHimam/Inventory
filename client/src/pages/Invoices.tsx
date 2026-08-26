import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FileText, Pencil, Eye, Printer, FileDown, Loader2,
} from 'lucide-react';
import {
  Button, Card, Pagination, SearchInput, Select, EmptyState, TableSkeleton, Input,
  ConfirmDialog,
} from '@/components/ui';
import { toast, toastError } from '@/store/toast';
import {
  InvoiceStatusBadge, InvoiceTypeBadge, SourceBadge,
} from '@/components/domain';
import { useDebounced, useInvoice, useInvoiceMutations, useInvoices } from '@/hooks';
import { fmtCurrency, fmtDateShort, fmtInt } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { cn } from '@/lib/cn';
import type { Invoice } from '@/lib/types';

const TYPE_TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'الكل' },
  { value: 'STOCK_IN', label: 'إدخال' },
  { value: 'STOCK_OUT', label: 'إخراج' },
];

export default function Invoices() {
  const navigate = useNavigate();
  const { canSeePrices, isManager } = usePermissions();
  /** One row open at a time: two open lists is a worse view of both. */
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reopening, setReopening] = useState<Invoice | null>(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const debouncedSearch = useDebounced(search, 250);
  const { data, isLoading, isFetching } = useInvoices({
    type: type || undefined,
    status: status || undefined,
    search: debouncedSearch || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page,
    limit,
  });

  useEffect(() => { setPage(1); }, [type, status, debouncedSearch, dateFrom, dateTo, limit]);

  const invoices = data?.data ?? [];
  const hasFilters = !!(type || status || debouncedSearch || dateFrom || dateTo);

  return (
    <>
      {/* No header row. The title said which page this is, which the nav
          already answers, and "فاتورة جديدة" duplicated a control that exists
          twice over in the shell: the ribbon carries إدخال and إخراج as its two
          largest buttons on a desktop, and the bottom nav carries the same pair
          on a phone. Nothing here was the only way to reach anything. */}
      <Card className="overflow-hidden">
        {/* Type tabs */}
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-3.5 pt-3">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setType(tab.value)}
              className={cn(
                'relative rounded-t-lg px-3.5 py-2 text-sm font-semibold transition',
                type === tab.value
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-muted hover:text-ink',
              )}
            >
              {tab.label}
              {type === tab.value && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-3.5">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="ابحث برقم الفاتورة أو اسم الجهة أو الملاحظة…"
            className="min-w-56 flex-1"
          />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-32">
            <option value="">كل الحالات</option>
            {/* Unsaved invoices are deliberately unlistable. Saving is what
                creates the record, so a half-entered one is not a document
                yet — it is a form still open on someone's screen, and giving
                it a filter would invite browsing a category that is meant to
                be transient. */}
            <option value="POSTED">محفوظة</option>
            <option value="CANCELLED">ملغاة</option>
          </Select>
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="nums min-w-0 flex-1 sm:w-auto sm:flex-none" aria-label="من تاريخ" />
            <span className="shrink-0 text-xs text-subtle">إلى</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="nums min-w-0 flex-1 sm:w-auto sm:flex-none" aria-label="إلى تاريخ" />
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton cols={7} />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-6" />}
            title={hasFilters ? 'لا توجد فواتير مطابقة' : 'لم تُنشأ أي فاتورة بعد'}
            message={hasFilters
              ? 'جرّب توسيع نطاق البحث أو إزالة عوامل التصفية.'
              : 'كل حركات المخزون تمر عبر فاتورة، ما يمنح سجلاً كاملاً قابلاً للتتبع.'}
            action={hasFilters
              ? <Button onClick={() => { setType(''); setStatus(''); setSearch(''); setDateFrom(''); setDateTo(''); }}>
                إزالة عوامل التصفية
              </Button>
              : <Link to="/invoices/new?type=STOCK_OUT"><Button variant="primary">إنشاء فاتورة إخراج</Button></Link>}
          />
        ) : (
          <div className={cn(isFetching && 'opacity-60 transition-opacity')}>
            {/* Phone/tablet: a purpose-built card — the amount is what an
                operator actually scans for, so it gets its own prominent
                line rather than sharing weight with six other fields. */}
            <div className="stagger space-y-2 p-2.5 lg:hidden">
              {/*
                * A <div>, not a <button>. The card carries real controls now --
                * print, PDF, edit -- and a button inside a button is invalid
                * markup that browsers resolve by guessing. The tap target that
                * opens the invoice is the Link over the information; the
                * controls sit outside it and answer for themselves.
                */}
              {invoices.map((invoice) => (
                <div key={invoice.id} className="card w-full p-3 text-start">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/invoices/${invoice.id}`}
                      className="-m-1 min-w-0 flex-1 rounded-lg p-1 transition active:bg-surface-2"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="nums font-mono text-xs font-bold">{invoice.number}</span>
                        <InvoiceTypeBadge type={invoice.type} />
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">
                        {fmtDateShort(invoice.invoice_date)}
                        {invoice.party_name ? ` · ${invoice.party_name}` : ''}
                      </p>
                    </Link>
                    <RowActions
                      invoice={invoice}
                      isManager={isManager}
                      onReopen={() => setReopening(invoice)}
                    />
                  </div>

                  {/* What the invoice is for, on the phone too: the count on
                      its own said as little here as it did in the table. */}
                  <div className="mt-1.5">
                    <ItemsCell
                      invoice={invoice}
                      expanded={expanded === invoice.id}
                      onToggle={() => setExpanded(expanded === invoice.id ? null : invoice.id)}
                    />
                  </div>
                  {expanded === invoice.id && (
                    <div className="mt-1.5 rounded-lg bg-surface-2">
                      <ExpandedLines id={invoice.id} />
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <InvoiceStatusBadge status={invoice.status} />
                      <SourceBadge source={invoice.source} />
                    </div>
                    {canSeePrices && (
                      <div className="shrink-0 text-end">
                        <span className="nums block text-lg font-bold leading-tight text-brand-600 dark:text-brand-400">
                          {fmtCurrency(invoice.total)}
                        </span>
                        {/* Under the total, not beside it: the total is what
                            the customer pays and the profit is what the shop
                            keeps, and a phone card is exactly where two
                            currency figures on one line would be read as one.
                            Absent on a purchase and on anything not yet
                            costed, where `profit` is null by design. */}
                        {invoice.profit != null && (
                          <span className={cn('nums mt-0.5 block text-[11px] font-bold',
                            invoice.profit < 0
                              ? 'text-accent-600 dark:text-accent-400'
                              : 'text-emerald-600 dark:text-emerald-400')}
                          >
                            ربح {fmtCurrency(invoice.profit)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop/tablet-wide: the full table. */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>النوع</th>
                    <th>التاريخ</th>
                    <th>الجهة</th>
                    <th className="text-center">الأصناف</th>
                    {canSeePrices && <th className="text-center">الإجمالي</th>}
                    {canSeePrices && <th className="text-center">الربح</th>}
                    <th>الحالة</th>
                    <th className="w-px" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <Fragment key={invoice.id}>
                    <tr
                      className="cursor-pointer"
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                    >
                      <td data-primary className="nums font-mono text-xs font-bold">{invoice.number}</td>
                      <td data-label="النوع"><InvoiceTypeBadge type={invoice.type} /></td>
                      <td data-label="التاريخ" className="nums whitespace-nowrap text-xs text-muted">{fmtDateShort(invoice.invoice_date)}</td>
                      <td data-label="الجهة" className="max-w-[14rem] truncate">
                        {invoice.party_name || <span className="text-xs text-subtle">—</span>}
                      </td>
                      {/* What the invoice is for, not how many rows it has.
                          "1" answers a question nobody asked; the first item
                          and its quantity is the thing a person scanning this
                          list is actually looking for. */}
                      <td data-label="الأصناف" className="max-w-[18rem]">
                        <ItemsCell
                          invoice={invoice}
                          expanded={expanded === invoice.id}
                          onToggle={() => setExpanded(expanded === invoice.id ? null : invoice.id)}
                        />
                      </td>
                      {canSeePrices && (
                        <td data-label="الإجمالي" className="nums text-center font-bold">{fmtCurrency(invoice.total)}</td>
                      )}
                      {/* Blank, not zero, on a purchase: a STOCK_IN has no
                          margin, and a column of 0.00 would read as one. */}
                      {canSeePrices && (
                        <td
                          data-label="الربح"
                          className={cn('nums text-center font-bold',
                            invoice.profit == null ? 'text-subtle'
                              : invoice.profit < 0 ? 'text-accent-600 dark:text-accent-400'
                                : 'text-emerald-600 dark:text-emerald-400')}
                        >
                          {invoice.profit == null ? '—' : fmtCurrency(invoice.profit)}
                        </td>
                      )}
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <InvoiceStatusBadge status={invoice.status} />
                          <SourceBadge source={invoice.source} />
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          invoice={invoice}
                          isManager={isManager}
                          onReopen={() => setReopening(invoice)}
                        />
                      </td>
                    </tr>
                    {/* A sibling row, not a nested one: a <tr> cannot contain
                        another <tr>, and a browser handed one silently moves
                        it out of the table. */}
                    {expanded === invoice.id && (
                      <tr className="bg-surface-2">
                        <td colSpan={canSeePrices ? 9 : 7} className="p-0">
                          <ExpandedLines id={invoice.id} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && (
          <Pagination
            page={data.meta.page} pages={data.meta.pages} total={data.meta.total}
            limit={data.meta.limit} onPage={setPage} onLimit={setLimit}
          />
        )}
      </Card>

      {reopening && (
        <ReopenConfirm invoice={reopening} onClose={() => setReopening(null)} />
      )}
    </>
  );
}

/* ------------------------------------------------------------ row contents */

/**
 * What the invoice is for, in one line.
 *
 * The first item and its quantity, and a count of the rest that opens them.
 * The count alone used to be the whole cell, which told a reader scanning for
 * a particular sale nothing at all.
 */
function ItemsCell(
  { invoice, expanded, onToggle }:
  { invoice: Invoice; expanded: boolean; onToggle: () => void },
) {
  const others = Math.max(0, (invoice.line_count ?? 0) - 1);
  if (!invoice.first_item_name) {
    return <span className="text-xs text-subtle">—</span>;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="truncate text-sm font-medium">{invoice.first_item_name}</span>
      <span className="nums shrink-0 text-xs font-bold text-muted">
        × {fmtInt(invoice.first_item_qty ?? 0)}
      </span>
      {others > 0 && (
        <button
          type="button"
          // The row itself navigates; opening the lines must not.
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="nums shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-muted transition hover:bg-brand-500/15 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {expanded ? 'إخفاء' : `+${fmtInt(others)} أخرى`}
        </button>
      )}
    </div>
  );
}

/**
 * Every line of one invoice, fetched only when its row is opened.
 *
 * `useInvoice` is the same query the detail page uses, so opening a row here
 * warms the cache for the page it links to rather than duplicating a request.
 */
function ExpandedLines({ id }: { id: string }) {
  const { data, isLoading } = useInvoice(id);
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted">
        <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
      </div>
    );
  }
  if (!data?.lines?.length) {
    return <div className="p-4 text-xs text-subtle">لا توجد أصناف.</div>;
  }
  return (
    <ul className="divide-y divide-line px-4 py-1.5">
      {data.lines.map((line) => (
        <li key={line.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="min-w-0 truncate">{line.item_name}</span>
          <span className="nums shrink-0 font-bold">× {fmtInt(line.quantity)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The things you want to do to an invoice without opening it.
 *
 * Print and PDF hand the work to the detail page through router state: the
 * document only exists where it is rendered, and re-rendering it invisibly
 * here would be a second copy of the same markup to keep in step.
 *
 * A draft edits in place. A posted one can only be *reopened*, which undoes
 * its stock effect -- manager-only, and behind a confirmation, so it is raised
 * to the page rather than fired from a row.
 */
function RowActions(
  { invoice, isManager, onReopen }:
  { invoice: Invoice; isManager: boolean; onReopen: () => void },
) {
  const navigate = useNavigate();
  const posted = invoice.status === 'POSTED';
  const act = (state: Record<string, boolean>) =>
    navigate(`/invoices/${invoice.id}`, { state });

  return (
    <div className="flex items-center justify-end gap-0.5">
      {invoice.status === 'DRAFT' ? (
        <Link to={`/invoices/${invoice.id}/edit`}>
          <Button size="icon" variant="ghost" title="متابعة التحرير">
            <Pencil className="size-4" />
          </Button>
        </Link>
      ) : (
        <>
          {isManager && posted && (
            <Button size="icon" variant="ghost" title="تعديل الفاتورة" onClick={onReopen}>
              <Pencil className="size-4" />
            </Button>
          )}
          <Button size="icon" variant="ghost" title="طباعة" onClick={() => act({ print: true })}>
            <Printer className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" title="ملف PDF" onClick={() => act({ pdf: true })}>
            <FileDown className="size-4" />
          </Button>
        </>
      )}
      <Link to={`/invoices/${invoice.id}`}>
        <Button size="icon" variant="ghost" title="عرض">
          <Eye className="size-4" />
        </Button>
      </Link>
    </div>
  );
}

/**
 * Reopening from the list. Owns the mutation for one invoice, so the page does
 * not have to hold a hook per row.
 */
function ReopenConfirm({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const navigate = useNavigate();
  const { reopen } = useInvoiceMutations(invoice.id);
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => reopen.mutate(invoice.id, {
        onSuccess: () => {
          onClose();
          toast.success('فُتحت الفاتورة للتعديل', `أُعيد أثرها على المخزون. رقمها ${invoice.number} كما هو.`);
          navigate(`/invoices/${invoice.id}/edit`);
        },
        onError: (error) => toastError(error, 'تعذّر فتح الفاتورة'),
      })}
      title="فتح الفاتورة للتعديل؟"
      tone="primary"
      confirmLabel="فتح للتعديل"
      loading={reopen.isPending}
      message={(
        <>
          سيُعاد أثر الفاتورة
          <span className="nums font-semibold"> {invoice.number} </span>
          على المخزون بقيود معاكسة، وتعود مسودة برقمها نفسه لتعديلها ثم ترحيلها من جديد.
          <span className="mt-2 block text-xs">
            لا يُحذف من سجل الحركات شيء — تبقى القيود الأصلية وقيود العكس ظاهرة معاً.
          </span>
        </>
      )}
    />
  );
}
