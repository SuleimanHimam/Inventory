import { Link } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Package, Boxes, TriangleAlert, PackageX, ArrowDownLeft, ArrowUpRight, Wallet,
  ArrowLeft, ClipboardList, FileText, Plus, TrendingUp,
} from 'lucide-react';
import { Card, PageHeader, Skeleton, EmptyState, Button } from '@/components/ui';
import { useDashboard, useMovements } from '@/hooks';
import { fmtInt, fmtCurrency, fmtRelative, fmtDateShort } from '@/lib/format';
import { MovementBadge, ItemLink, InvoiceLink } from '@/components/domain';
import { usePrefs } from '@/store/prefs';
import { cn } from '@/lib/cn';

export default function Dashboard() {
  const { data, isLoading } = useDashboard();
  const { data: recent } = useMovements({ page: 1, limit: 8 });
  const theme = usePrefs((s) => s.theme);

  return (
    <>
      <PageHeader
        title="لوحة المعلومات"
        subtitle="نظرة سريعة على حالة المخزون وحركته"
        actions={
          <>
            <Link to="/invoices/new?type=SALE">
              <Button variant="primary" icon={<Plus className="size-4" />}>فاتورة بيع</Button>
            </Link>
            <Link to="/stock-counts">
              <Button icon={<ClipboardList className="size-4" />}>بدء جرد</Button>
            </Link>
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          loading={isLoading}
          icon={<Package className="size-5" />}
          tone="brand"
          label="إجمالي الأصناف"
          value={fmtInt(data?.total_items)}
          hint={`${fmtInt(data?.counts.categories)} تصنيف`}
          to="/items"
        />
        <KpiCard
          loading={isLoading}
          icon={<Boxes className="size-5" />}
          tone="info"
          label="إجمالي الوحدات"
          value={fmtInt(data?.total_units)}
          hint={`قيمة المخزون ${fmtCurrency(data?.stock_value)}`}
          to="/items"
        />
        <KpiCard
          loading={isLoading}
          icon={<TriangleAlert className="size-5" />}
          tone="warning"
          label="أصناف تحت الحد"
          value={fmtInt(data?.low_stock_count)}
          hint={`الحد الافتراضي ${fmtInt(data?.threshold)}`}
          to="/reports/low-stock"
        />
        <KpiCard
          loading={isLoading}
          icon={<PackageX className="size-5" />}
          tone="danger"
          label="أصناف نفدت"
          value={fmtInt(data?.out_of_stock_count)}
          hint="بحاجة إلى إعادة طلب"
          to="/reports/low-stock"
        />
      </div>

      {/* Today + chart */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <div>
              <h2 className="text-sm font-bold">حركة المخزون — آخر ١٤ يوماً</h2>
              <p className="mt-0.5 text-xs text-muted">مجموع الوحدات الواردة والصادرة يومياً</p>
            </div>
            <TrendingUp className="size-4 text-subtle" />
          </div>
          <div className="h-64 p-4 pt-5">
            {isLoading ? (
              <Skeleton className="size-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.trend ?? []} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="inGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#263149' : '#e4e8f0'} vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(d) => fmtDateShort(d).slice(0, 5)}
                    tick={{ fontSize: 11, fill: theme === 'dark' ? '#97a3b8' : '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    reversed
                  />
                  <YAxis
                    orientation="right"
                    tick={{ fontSize: 11, fill: theme === 'dark' ? '#97a3b8' : '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: theme === 'dark' ? '#161e30' : '#fff',
                      border: `1px solid ${theme === 'dark' ? '#263149' : '#e4e8f0'}`,
                      borderRadius: 12,
                      fontSize: 12,
                      direction: 'rtl',
                      fontFamily: 'inherit',
                      boxShadow: '0 8px 24px -12px rgba(15,23,42,0.25)',
                    }}
                    labelFormatter={(d) => fmtDateShort(String(d))}
                    formatter={(value: number, key: string) =>
                      [fmtInt(value), key === 'in_qty' ? 'وارد' : 'صادر']}
                  />
                  <Area type="monotone" dataKey="in_qty" stroke="#10b981" strokeWidth={2} fill="url(#inGrad)" />
                  <Area type="monotone" dataKey="out_qty" stroke="#f43f5e" strokeWidth={2} fill="url(#outGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="text-sm font-bold">حركة اليوم</h2>
            <div className="mt-4 space-y-3">
              <TodayRow
                icon={<ArrowDownLeft className="size-4" />}
                tone="text-emerald-500 bg-emerald-500/12"
                label="وارد"
                value={fmtInt(data?.today.in_qty)}
              />
              <TodayRow
                icon={<ArrowUpRight className="size-4" />}
                tone="text-rose-500 bg-rose-500/12"
                label="صادر"
                value={fmtInt(data?.today.out_qty)}
              />
              <TodayRow
                icon={<Wallet className="size-4" />}
                tone="text-brand-500 bg-brand-500/12"
                label="عدد الحركات"
                value={fmtInt(data?.today.movements)}
              />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold">الأكثر صرفاً — ٣٠ يوماً</h2>
            {data?.top_moving.length ? (
              <ul className="mt-3.5 space-y-2.5">
                {data.top_moving.map((item, index) => {
                  const max = data.top_moving[0].moved || 1;
                  return (
                    <li key={item.id}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <ItemLink id={item.id} name={item.name} className="truncate text-xs font-medium" />
                        <span className="nums shrink-0 font-bold text-muted">{fmtInt(item.moved)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className={cn('h-full rounded-full', index === 0 ? 'bg-brand-600' : 'bg-brand-400/70')}
                          style={{ width: `${Math.max(6, (item.moved / max) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-muted">لا توجد حركات صرف خلال آخر ٣٠ يوماً.</p>
            )}
          </Card>
        </div>
      </div>

      {/* Recent activity */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-bold">آخر الحركات</h2>
          <Link
            to="/movements"
            className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
          >
            عرض الكل <ArrowLeft className="size-3.5" />
          </Link>
        </div>

        {recent?.data.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>النوع</th>
                  <th>الكمية</th>
                  <th>المستند</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.map((movement) => (
                  <tr key={movement.id}>
                    <td>
                      <ItemLink id={movement.item_id} name={movement.item_name} />
                    </td>
                    <td><MovementBadge type={movement.type} /></td>
                    <td className="nums font-bold">{fmtInt(movement.quantity)}</td>
                    <td><InvoiceLink id={movement.invoice_id!} number={movement.invoice_number} /></td>
                    <td className="whitespace-nowrap text-xs text-muted">{fmtRelative(movement.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<FileText className="size-6" />}
            title="لا توجد حركات بعد"
            message="ابدأ بإنشاء فاتورة إدخال مخزون أو استيراد الأصناف من ملف Excel."
            action={
              <Link to="/import">
                <Button variant="primary">استيراد الأصناف</Button>
              </Link>
            }
          />
        )}
      </Card>
    </>
  );
}

const TONES = {
  brand: 'bg-brand-500/12 text-brand-600 dark:text-brand-400',
  info: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  warning: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  danger: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
};

function KpiCard({
  icon, label, value, hint, tone, to, loading,
}: {
  icon: React.ReactNode; label: string; value: string; hint?: string;
  tone: keyof typeof TONES; to: string; loading?: boolean;
}) {
  return (
    <Link to={to} className="card group p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className={cn('grid size-10 place-items-center rounded-xl', TONES[tone])}>{icon}</span>
        <ArrowLeft className="size-4 text-subtle opacity-0 transition group-hover:opacity-100" />
      </div>
      <p className="mt-3 text-xs font-medium text-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-7 w-20" />
      ) : (
        <p className="nums mt-0.5 text-2xl font-bold tracking-tight">{value}</p>
      )}
      {hint && <p className="nums mt-1 text-[11px] text-subtle">{hint}</p>}
    </Link>
  );
}

function TodayRow({
  icon, tone, label, value,
}: { icon: React.ReactNode; tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn('grid size-9 place-items-center rounded-lg', tone)}>{icon}</span>
      <span className="flex-1 text-xs font-medium text-muted">{label}</span>
      <span className="nums text-lg font-bold">{value}</span>
    </div>
  );
}
