import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList, Package, PlayCircle, History, ArrowLeft, Info, PackageSearch,
} from 'lucide-react';
import {
  Button, Card, PageHeader, Pagination, SearchInput, Select, EmptyState, TableSkeleton,
  Badge, ConfirmDialog,
} from '@/components/ui';
import { BarcodeChip, COUNT_STATUS, ItemLink, QuantityCell } from '@/components/domain';
import { Thumb } from '@/components/ImagePicker';
import {
  useCategories, useDashboard, useDebounced, useItems, useStockCountMutations, useStockCounts,
} from '@/hooks';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { toastError } from '@/store/toast';
import { cn } from '@/lib/cn';

type Tab = 'items' | 'sessions';

export default function StockCounts() {
  const [tab, setTab] = useState<Tab>('items');

  return (
    <>
      <PageHeader
        title="الجرد"
        subtitle="راجع الكميات الحالية ثم ابدأ جلسة جرد لمطابقتها بالواقع"
      />

      <div className="mb-4 flex items-center gap-1 border-b border-line">
        {([
          { key: 'items', label: 'الأصناف والكميات', icon: Package },
          { key: 'sessions', label: 'سجل الجلسات', icon: History },
        ] as const).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition',
              tab === item.key ? 'text-brand-600 dark:text-brand-400' : 'text-muted hover:text-ink',
            )}
          >
            <item.icon className="size-4" />
            {item.label}
            {tab === item.key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />
            )}
          </button>
        ))}
      </div>

      {tab === 'items' ? <ItemsOverview /> : <SessionsHistory />}
    </>
  );
}

/**
 * Pre-count overview: every item with its live system quantity. The category
 * and name controls filter this table only — the count itself always covers
 * the whole catalogue, so nothing can be missed by an active filter.
 */
function ItemsOverview() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [confirmStart, setConfirmStart] = useState(false);

  const debouncedSearch = useDebounced(search, 250);
  const { data: categories = [] } = useCategories();
  const { data: stats } = useDashboard();
  const { create } = useStockCountMutations();

  const { data, isLoading, isFetching } = useItems({
    search: debouncedSearch || undefined,
    category_id: categoryId || undefined,
    sort: 'name',
    page,
    limit,
  });

  // Surface an unfinished session so a second one isn't started by mistake.
  const { data: openSessions } = useStockCounts({ status: 'OPEN', page: 1, limit: 1 });
  const { data: submittedSessions } = useStockCounts({ status: 'SUBMITTED', page: 1, limit: 1 });
  const inProgress = openSessions?.data[0] ?? submittedSessions?.data[0];

  useEffect(() => { setPage(1); }, [debouncedSearch, categoryId, limit]);

  const start = async () => {
    try {
      const session = await create.mutateAsync({ scope: 'ALL' });
      navigate(`/stock-counts/${session.id}`);
    } catch (error) {
      toastError(error, 'تعذّر بدء جلسة الجرد');
    }
  };

  const items = data?.data ?? [];
  const filtered = !!(debouncedSearch || categoryId);
  const totalItems = stats?.total_items ?? 0;

  return (
    <>
      {inProgress && (
        <Card className="mb-4 border-accent-500/30 bg-accent-500/8 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <ClipboardList className="size-5 shrink-0 text-accent-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">
                لديك جلسة جرد غير مكتملة —{' '}
                <span className="nums font-mono">{inProgress.number}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {COUNT_STATUS[inProgress.status].label} · أُدخل{' '}
                {fmtInt(inProgress.counted_count)} من {fmtInt(inProgress.line_count)} صنف
              </p>
            </div>
            <Link to={`/stock-counts/${inProgress.id}`}>
              <Button variant="primary">متابعة الجلسة</Button>
            </Link>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {/* Filters + the start action */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-3.5">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="تصفية باسم الصنف أو الباركود…"
            className="min-w-56 flex-1"
          />
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-auto min-w-44"
          >
            <option value="">كل التصنيفات</option>
            <option value="none">بدون تصنيف</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.item_count})
              </option>
            ))}
          </Select>

          <Button
            variant="primary"
            size="lg"
            icon={<PlayCircle className="size-4.5" />}
            onClick={() => setConfirmStart(true)}
            loading={create.isPending}
            disabled={!totalItems}
          >
            بدء الجرد
          </Button>
        </div>

        {filtered && (
          <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-[11px] text-muted">
            <Info className="size-3.5 shrink-0" />
            التصفية تخص العرض فقط — جلسة الجرد تشمل كل الأصناف
            ({fmtInt(totalItems)} صنف).
          </div>
        )}

        {isLoading ? (
          <TableSkeleton cols={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={filtered ? <PackageSearch className="size-6" /> : <Package className="size-6" />}
            title={filtered ? 'لا توجد أصناف مطابقة' : 'لا توجد أصناف بعد'}
            message={filtered
              ? 'جرّب كلمة أخرى أو أزل التصفية.'
              : 'أضف أصنافاً أو استوردها من Excel قبل بدء الجرد.'}
            action={filtered
              ? <Button onClick={() => { setSearch(''); setCategoryId(''); }}>إزالة التصفية</Button>
              : <Link to="/items"><Button variant="primary">إدارة الأصناف</Button></Link>}
          />
        ) : (
          <div className={cn('overflow-x-auto', isFetching && 'opacity-60 transition-opacity')}>
            <table className="data-table stacked">
              <thead>
                <tr>
                  <th className="w-px" />
                  <th>الصنف</th>
                  <th>التصنيف</th>
                  <th>الباركود</th>
                  <th className="text-center">الكمية الحالية</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-thumb className="pe-0"><Thumb url={item.image_url} alt={item.name} /></td>
                    <td data-primary className="max-w-md">
                      <ItemLink id={item.id} name={item.name} />
                    </td>
                    <td data-label="التصنيف">
                      {item.category_name
                        ? <Badge tone="brand">{item.category_name}</Badge>
                        : <span className="text-xs text-subtle">—</span>}
                    </td>
                    <td data-label="الباركود"><BarcodeChip code={item.barcode} /></td>
                    <td data-label="الكمية الحالية" className="text-center">
                      <QuantityCell quantity={item.quantity} threshold={item.effective_threshold} />
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

      <ConfirmDialog
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        onConfirm={start}
        loading={create.isPending}
        tone="primary"
        title="بدء جلسة جرد"
        confirmLabel="بدء الجرد"
        message={
          <>
            سيلتقط النظام صورة للكميات الحالية لـ{' '}
            <strong className="text-ink">{fmtInt(totalItems)} صنف</strong>، ثم تُدخل
            الكمية الفعلية لكل صنف. عند الاعتماد تُنشأ فاتورة إدخال للزيادات وفاتورة
            إخراج للنواقص تلقائياً.
            <p className="mt-2 text-xs">
              يمكنك حفظ الجلسة والعودة إليها لاحقاً قبل الاعتماد.
            </p>
          </>
        }
      />
    </>
  );
}

/** Audit trail of previous sessions and the invoices they produced. */
function SessionsHistory() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useStockCounts({ status: status || undefined, page, limit: 25 });

  useEffect(() => { setPage(1); }, [status]);
  const sessions = data?.data ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line p-3.5">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-44">
          <option value="">كل الحالات</option>
          <option value="OPEN">قيد الإدخال</option>
          <option value="SUBMITTED">بانتظار الاعتماد</option>
          <option value="APPLIED">مطبّقة</option>
          <option value="CANCELLED">ملغاة</option>
        </Select>
      </div>

      {isLoading ? (
        <TableSkeleton cols={6} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="لا توجد جلسات جرد سابقة"
          message="ستظهر هنا كل الجلسات مع عدد الفروقات والفواتير الناتجة عنها."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th className="text-center">الأصناف</th>
                <th className="text-center">التقدّم</th>
                <th className="text-center">فروقات</th>
                <th>الحالة</th>
                <th>الفواتير الناتجة</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const progress = session.line_count
                  ? Math.round((session.counted_count / session.line_count) * 100) : 0;
                return (
                  <tr key={session.id}>
                    <td>
                      <Link to={`/stock-counts/${session.id}`}
                        className="nums font-mono text-xs font-bold hover:text-brand-600 dark:hover:text-brand-400">
                        {session.number}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(session.created_at)}</td>
                    <td className="nums text-center">{fmtInt(session.line_count)}</td>
                    <td>
                      <div className="mx-auto w-24">
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                          <div className={cn('h-full rounded-full transition-all',
                            progress === 100 ? 'bg-emerald-500' : 'bg-brand-500')}
                            style={{ width: `${progress}%` }} />
                        </div>
                        <p className="nums mt-1 text-center text-[10px] text-subtle">{progress}٪</p>
                      </div>
                    </td>
                    <td className="nums text-center font-bold">
                      {session.variance_count > 0
                        ? <span className="text-accent-600 dark:text-accent-400">{fmtInt(session.variance_count)}</span>
                        : <span className="text-subtle">0</span>}
                    </td>
                    <td>
                      <Badge tone={COUNT_STATUS[session.status].tone}>
                        {COUNT_STATUS[session.status].label}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {session.invoices?.length
                          ? session.invoices.map((invoice) => (
                            <Link key={invoice.id} to={`/invoices/${invoice.id}`}
                              className="nums font-mono text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                              {invoice.number}
                            </Link>
                          ))
                          : <span className="text-xs text-subtle">—</span>}
                      </div>
                    </td>
                    <td>
                      <Link to={`/stock-counts/${session.id}`}>
                        <Button size="icon" variant="ghost" title="فتح الجلسة">
                          <ArrowLeft className="size-4" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <Pagination page={data.meta.page} pages={data.meta.pages} total={data.meta.total}
          limit={data.meta.limit} onPage={setPage} />
      )}
    </Card>
  );
}
