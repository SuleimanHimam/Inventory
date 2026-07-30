import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FileText, Pencil, Eye, ChevronDown } from 'lucide-react';
import {
  Button, Card, PageHeader, Pagination, SearchInput, Select, EmptyState, TableSkeleton, Input,
  Menu, MenuItem,
} from '@/components/ui';
import {
  INVOICE_TYPES, InvoiceStatusBadge, InvoiceTypeBadge, SourceBadge,
} from '@/components/domain';
import { useDebounced, useInvoices } from '@/hooks';
import { fmtCurrency, fmtDateShort, fmtInt } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { InvoiceType } from '@/lib/types';

const TYPE_TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'الكل' },
  { value: 'SALE', label: 'مبيعات' },
  { value: 'PURCHASE', label: 'مشتريات' },
  { value: 'STOCK_IN', label: 'إدخال' },
  { value: 'STOCK_OUT', label: 'إخراج' },
];

export default function Invoices() {
  const navigate = useNavigate();
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
      <PageHeader
        title="الفواتير"
        subtitle="فواتير البيع والشراء وحركات إدخال وإخراج المخزون"
        actions={<NewInvoiceMenu onPick={(t) => navigate(`/invoices/new?type=${t}`)} />}
      />

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
            <option value="DRAFT">مسودة</option>
            <option value="POSTED">مرحّلة</option>
            <option value="CANCELLED">ملغاة</option>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="nums w-auto" aria-label="من تاريخ" />
            <span className="text-xs text-subtle">إلى</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="nums w-auto" aria-label="إلى تاريخ" />
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
              : <Link to="/invoices/new?type=SALE"><Button variant="primary">إنشاء فاتورة بيع</Button></Link>}
          />
        ) : (
          <div className={cn('overflow-x-auto', isFetching && 'opacity-60 transition-opacity')}>
            <table className="data-table stacked">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>النوع</th>
                  <th>التاريخ</th>
                  <th>الجهة</th>
                  <th className="text-center">الأصناف</th>
                  <th className="text-center">الإجمالي</th>
                  <th>الحالة</th>
                  <th className="w-px" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/invoices/${invoice.id}`)}
                  >
                    <td data-primary className="nums font-mono text-xs font-bold">{invoice.number}</td>
                    <td data-label="النوع"><InvoiceTypeBadge type={invoice.type} /></td>
                    <td data-label="التاريخ" className="nums whitespace-nowrap text-xs text-muted">{fmtDateShort(invoice.invoice_date)}</td>
                    <td data-label="الجهة" className="max-w-[14rem] truncate">
                      {invoice.party_name || <span className="text-xs text-subtle">—</span>}
                    </td>
                    <td data-label="الأصناف" className="nums text-center text-muted">{fmtInt(invoice.line_count)}</td>
                    <td data-label="الإجمالي" className="nums text-center font-bold">{fmtCurrency(invoice.total)}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <InvoiceStatusBadge status={invoice.status} />
                        <SourceBadge source={invoice.source} />
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        {invoice.status === 'DRAFT' ? (
                          <Link to={`/invoices/${invoice.id}/edit`}>
                            <Button size="icon" variant="ghost" title="متابعة التحرير">
                              <Pencil className="size-4" />
                            </Button>
                          </Link>
                        ) : (
                          <Link to={`/invoices/${invoice.id}`}>
                            <Button size="icon" variant="ghost" title="عرض">
                              <Eye className="size-4" />
                            </Button>
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <Pagination
            page={data.meta.page} pages={data.meta.pages} total={data.meta.total}
            limit={data.meta.limit} onPage={setPage} onLimit={setLimit}
          />
        )}
      </Card>
    </>
  );
}

function NewInvoiceMenu({ onPick }: { onPick: (type: InvoiceType) => void }) {
  const order: InvoiceType[] = ['SALE', 'PURCHASE', 'STOCK_IN', 'STOCK_OUT'];
  return (
    <Menu
      trigger={({ open, toggle }) => (
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={toggle}
          aria-haspopup="menu" aria-expanded={open}>
          فاتورة جديدة
          <ChevronDown className={cn('size-3.5 opacity-70 transition-transform', open && 'rotate-180')} />
        </Button>
      )}
    >
      {(close) => order.map((type) => {
        const config = INVOICE_TYPES[type];
        const Icon = config.icon;
        return (
          <MenuItem
            key={type}
            onClick={() => { close(); onPick(type); }}
            icon={<Icon className="size-4 text-subtle" />}
          >
            {config.label}
          </MenuItem>
        );
      })}
    </Menu>
  );
}
