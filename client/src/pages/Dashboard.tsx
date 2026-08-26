import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Package, Boxes, PackageX, ArrowDownLeft, ArrowUpRight, Wallet,
  ArrowLeft, ClipboardList, FileText, TrendingUp, TriangleAlert,
} from 'lucide-react';
import { Card, PageHeader, Skeleton, EmptyState, Button, Select } from '@/components/ui';
import { useDashboard, useMovements } from '@/hooks';
import { fmtInt, fmtCurrency, fmtRelative, fmtDateShort } from '@/lib/format';
import { MovementBadge, ItemLink, InvoiceLink } from '@/components/domain';
import { usePrefs } from '@/store/prefs';
import { usePermissions } from '@/lib/permissions';
import { cn } from '@/lib/cn';
import type { DashboardPeriod } from '@/lib/types';

/** Stock in reads teal (the brand/"good, arriving"), stock out reads coral.
 *  Recharts needs literal colour values, not CSS custom properties. */
const CHART = { in: '#0e6b64', out: '#f2634c' };

const PERIODS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: 'today', label: 'اليوم' },
  { value: 'month', label: 'هذا الشهر' },
  { value: '30d', label: 'آخر ٣٠ يوماً' },
  { value: 'all', label: 'كل الفترات' },
];

const PERIOD_KEY = 'inv.dash_period';
const storedPeriod = (): DashboardPeriod => {
  try {
    const saved = localStorage.getItem(PERIOD_KEY);
    return PERIODS.some((p) => p.value === saved) ? saved as DashboardPeriod : 'month';
  } catch {
    return 'month';
  }
};

export default function Dashboard() {
  /*
   * The window is the viewer's to choose -- "this month" is how a shop counts
   * its takings, a rolling thirty days is smoother, and at 4pm behind a
   * counter the only interesting number is today's. Remembered per device, so
   * the choice survives the next visit without becoming an org-wide setting
   * that one person's preference imposes on everyone.
   */
  const [period, setPeriod] = useState<DashboardPeriod>(storedPeriod);
  const { data, isLoading } = useDashboard(true, period);
  const { data: recent } = useMovements({ page: 1, limit: 8 });
  const { canSeePrices } = usePermissions();
  const theme = usePrefs((s) => s.theme);
  const axis = theme === 'dark'
    ? { grid: '#2a3531', tick: '#9fa8a2', tooltipBg: '#1a221e' }
    : { grid: '#e2e5e9', tick: '#5a6068', tooltipBg: '#ffffff' };

  return (
    <>
      {/* On phone this is the first screen after opening the app — the KPI
          row right below already says where you are, so the title/subtitle
          and the "بدء جرد" shortcut (also reachable from stock-counts) just
          cost a row of scroll for no new information. */}
      <div className="hidden sm:block">
        <PageHeader
          title="لوحة المعلومات"
          subtitle="نظرة سريعة على حالة المخزون وحركته"
          actions={
            <Link to="/stock-counts">
              <Button icon={<ClipboardList className="size-4" />}>بدء جرد</Button>
            </Link>
          }
        />
      </div>

      {/* KPI row. Extra top margin on phone only — the PageHeader above (with
          its own spacing) is hidden there, so without this the cards would
          sit flush against the top of the screen. */}
      <div className="stagger mt-4 grid grid-cols-2 gap-4 sm:mt-0 lg:grid-cols-4">
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
          hint={canSeePrices
            ? `قيمة المخزون ${fmtCurrency(data?.stock_value)}`
            : `عبر ${fmtInt(data?.total_items)} صنف`}
          to="/items"
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
        {/* The fourth slot is financial for a manager and operational for
            everyone else — an empty cell would leave a hole in the 4-column
            grid, and a blanked-out card would advertise what it is hiding. */}
        {canSeePrices ? (
          <KpiCard
            loading={isLoading}
            icon={<TrendingUp className="size-5" />}
            tone="success"
            label="الربح المتوقع"
            value={fmtCurrency(data?.stock_profit)}
            hint="بأسعار البيع الحالية للمخزون بأكمله"
            to="/items"
          />
        ) : (
          <KpiCard
            loading={isLoading}
            icon={<TriangleAlert className="size-5" />}
            tone="warning"
            label="نواقص المخزون"
            value={fmtInt(data?.low_stock_count)}
            hint="أصناف بلغت حد النقص"
            to="/reports/low-stock"
          />
        )}
      </div>

      {/* Purchases, sales and profit — the three figures that used to sit above
          the invoices list, where they only ever described whatever filter
          happened to be applied. On the dashboard they answer the question
          directly, over a window the viewer picks.

          Manager-only: the API strips all three for anyone else (roles.js), so
          for a staff account this would be three empty cards. */}
      {canSeePrices && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold">الحركة المالية</h2>
            <Select
              value={period}
              onChange={(e) => {
                const next = e.target.value as DashboardPeriod;
                setPeriod(next);
                try { localStorage.setItem(PERIOD_KEY, next); } catch { /* private window */ }
              }}
              className="w-auto min-w-36"
              aria-label="الفترة"
            >
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
          <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-3">
            <KpiCard
              loading={isLoading}
              icon={<ArrowDownLeft className="size-5" />}
              tone="brand"
              label="المشتريات"
              value={fmtCurrency(data?.trading.purchases)}
              hint="فواتير الإدخال المرحّلة"
              to="/invoices?type=STOCK_IN"
            />
            <KpiCard
              loading={isLoading}
              icon={<ArrowUpRight className="size-5" />}
              tone="success"
              label="المبيعات"
              value={fmtCurrency(data?.trading.sales)}
              hint="فواتير الإخراج المرحّلة"
              to="/invoices?type=STOCK_OUT"
            />
            <KpiCard
              loading={isLoading}
              icon={<Wallet className="size-5" />}
              tone={(data?.trading.profit ?? 0) < 0 ? 'danger' : 'success'}
              label="الربح"
              value={fmtCurrency(data?.trading.profit)}
              hint={data?.trading.profit_exact === false
                ? 'المبيعات − التكلفة · يتضمن تكلفة تقديرية'
                : 'المبيعات − تكلفة البضاعة المباعة'}
              to="/invoices?type=STOCK_OUT"
              className="max-lg:col-span-2"
            />
          </div>
        </div>
      )}

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
                      <stop offset="0%" stopColor={CHART.in} stopOpacity={0.42} />
                      <stop offset="100%" stopColor={CHART.in} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.out} stopOpacity={0.34} />
                      <stop offset="100%" stopColor={CHART.out} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={axis.grid} vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(d) => fmtDateShort(d).slice(0, 5)}
                    tick={{ fontSize: 11, fill: axis.tick }}
                    axisLine={false}
                    tickLine={false}
                    reversed
                  />
                  <YAxis
                    orientation="right"
                    tick={{ fontSize: 11, fill: axis.tick }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: axis.tooltipBg,
                      border: `1px solid ${axis.grid}`,
                      borderRadius: 14,
                      fontSize: 12,
                      direction: 'rtl',
                      fontFamily: 'inherit',
                      boxShadow: '0 10px 28px -14px rgba(20,26,23,0.35)',
                    }}
                    labelFormatter={(d) => fmtDateShort(String(d))}
                    formatter={(value: number, key: string) =>
                      [fmtInt(value), key === 'in_qty' ? 'وارد' : 'صادر']}
                  />
                  <Area type="monotone" dataKey="in_qty" stroke={CHART.in} strokeWidth={2.5}
                    fill="url(#inGrad)" animationDuration={650} />
                  <Area type="monotone" dataKey="out_qty" stroke={CHART.out} strokeWidth={2.5}
                    fill="url(#outGrad)" animationDuration={650} />
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
                tone="text-brand-700 dark:text-brand-300 bg-gradient-to-br from-brand-400/25 to-brand-500/10"
                label="وارد"
                value={fmtInt(data?.today.in_qty)}
              />
              <TodayRow
                icon={<ArrowUpRight className="size-4" />}
                tone="text-accent-600 dark:text-accent-300 bg-gradient-to-br from-accent-400/25 to-accent-500/10"
                label="صادر"
                value={fmtInt(data?.today.out_qty)}
              />
              <TodayRow
                icon={<Wallet className="size-4" />}
                tone="text-sky-700 dark:text-sky-300 bg-gradient-to-br from-sky-400/25 to-sky-500/10"
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
                          className={cn('h-full rounded-full', RANK_BARS[index % RANK_BARS.length])}
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
            <table className="data-table stacked">
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
                    <td data-primary>
                      <ItemLink id={movement.item_id} name={movement.item_name} />
                    </td>
                    <td data-label="النوع"><MovementBadge type={movement.type} /></td>
                    <td data-label="الكمية" className="nums font-bold">{fmtInt(movement.quantity)}</td>
                    <td data-label="المستند"><InvoiceLink id={movement.invoice_id!} number={movement.invoice_number} /></td>
                    <td data-label="الوقت" className="whitespace-nowrap text-xs text-muted">{fmtRelative(movement.created_at)}</td>
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

/** One shade per rank (TOP 5 query) — no red/rose, since a "most moved"
 * ranking isn't a danger signal and shouldn't read like one. */
const RANK_BARS = [
  'bg-gradient-to-l from-brand-500 to-brand-400',
  'bg-gradient-to-l from-sky-500 to-sky-400',
  'bg-gradient-to-l from-lime-500 to-lime-400',
  'bg-gradient-to-l from-accent-500 to-accent-400',
  'bg-gradient-to-l from-accent-500 to-accent-400',
];

/*
 * KPI identities. Each card owns a hue so the row is scannable by colour
 * before it's read: teal = the catalogue, sky = volume on hand, coral =
 * something needs attention, lime = money. Light mode uses the 700 steps
 * (the 600s fail AA on the cream page); dark mode uses the bright 300/400s.
 */
const TONES = {
  brand: 'from-brand-400/25 to-brand-500/10 text-brand-700 dark:text-brand-300',
  info: 'from-sky-400/25 to-sky-500/10 text-sky-700 dark:text-sky-300',
  warning: 'from-accent-400/30 to-accent-500/10 text-accent-700 dark:text-accent-300',
  danger: 'from-accent-400/25 to-accent-500/10 text-accent-600 dark:text-accent-300',
  success: 'from-lime-400/25 to-lime-500/10 text-lime-800 dark:text-lime-300',
};

function KpiCard({
  icon, label, value, hint, tone, to, loading, className,
}: {
  icon: React.ReactNode; label: string; value: string; hint?: string;
  tone: keyof typeof TONES; to: string; loading?: boolean; className?: string;
}) {
  return (
    <Link to={to} className={cn('card card-interactive group block p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn(
          'grid size-11 place-items-center rounded-2xl bg-gradient-to-br shadow-sm', TONES[tone],
        )}>
          {icon}
        </span>
        <ArrowLeft className="size-4 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="mt-3 text-xs font-medium text-muted">{label}</p>
      {/* `truncate` and a smaller step on a phone for the same reason the
          invoices strip needed them: two cards to a row leaves about 160px,
          and a currency figure at 2xl does not fit that. */}
      {loading ? (
        <Skeleton className="mt-1.5 h-7 w-20" />
      ) : (
        <p className="nums mt-0.5 truncate text-lg font-bold tracking-tight sm:text-2xl" title={value}>
          {value}
        </p>
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
