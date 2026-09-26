import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, Receipt, ArrowLeft, Scale,
} from 'lucide-react';
import {
  Card, PageHeader, Skeleton, EmptyState, Select, Input,
} from '@/components/ui';
import { useAccountingDashboard } from '@/hooks';
import { fmtCurrency, fmtDateShort, fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Accounting dashboard — where the money stands. Balances are all-time snapshots
 * (cash on hand does not change with the date filter); flows — receipts,
 * payments, expenses, the trend — follow the chosen window. Manager-only.
 */
const CHART = { receipts: '#0e6b64', payments: '#f2634c' };

type Period = 'today' | 'month' | '30d' | 'all' | 'custom';
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'اليوم' },
  { value: 'month', label: 'هذا الشهر' },
  { value: '30d', label: 'آخر ٣٠ يوماً' },
  { value: 'all', label: 'كل الفترات' },
  { value: 'custom', label: 'فترة مخصصة' },
];
const PERIOD_KEY = 'inv.acc_dash_period';

const iso = (d: Date) => d.toISOString().slice(0, 10);
function rangeFor(period: Period, custom: { from: string; to: string }) {
  const today = new Date();
  switch (period) {
    case 'today': return { date_from: iso(today), date_to: iso(today) };
    case 'month': return { date_from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), date_to: iso(today) };
    case '30d': {
      const from = new Date(today); from.setDate(from.getDate() - 29);
      return { date_from: iso(from), date_to: iso(today) };
    }
    case 'custom': return { date_from: custom.from || undefined, date_to: custom.to || undefined };
    default: return { date_from: undefined, date_to: undefined };
  }
}

export default function AccountingDashboard() {
  const [period, setPeriod] = useState<Period>(() => {
    try {
      const s = localStorage.getItem(PERIOD_KEY);
      return PERIODS.some((p) => p.value === s) ? (s as Period) : 'month';
    } catch { return 'month'; }
  });
  const [custom, setCustom] = useState({ from: '', to: iso(new Date()) });
  const range = useMemo(() => rangeFor(period, custom), [period, custom]);
  const { data, isLoading } = useAccountingDashboard(range);

  const setP = (p: Period) => {
    setPeriod(p);
    try { localStorage.setItem(PERIOD_KEY, p); } catch { /* private window */ }
  };

  return (
    <>
      <PageHeader
        title="المحاسبة"
        subtitle="نظرة عامة على الحركة المالية والأرصدة"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onChange={(e) => setP(e.target.value as Period)} className="w-auto">
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            {period === 'custom' && (
              <>
                <Input value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} type="date" dir="ltr" className="w-auto" />
                <Input value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} type="date" dir="ltr" className="w-auto" />
              </>
            )}
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi loading={isLoading} icon={<Wallet className="size-5" />} tone="brand" label="النقد والبنوك" value={fmtCurrency(data?.cash_on_hand)} hint="الرصيد الحالي (كل الفترات)" />
        <Kpi loading={isLoading} icon={<ArrowDownCircle className="size-5" />} tone="success" label="إجمالي القبض" value={fmtCurrency(data?.receipts_total)} hint="خلال الفترة" />
        <Kpi loading={isLoading} icon={<ArrowUpCircle className="size-5" />} tone="danger" label="إجمالي الصرف" value={fmtCurrency(data?.payments_total)} hint="خلال الفترة" />
        <Kpi loading={isLoading} icon={<Receipt className="size-5" />} tone="warning" label="المصروفات" value={fmtCurrency(data?.expenses_total)} hint="خلال الفترة" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">القبض مقابل الصرف</h2>
            <span className={cn('nums text-sm font-bold', (data?.net_total ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-accent-600 dark:text-accent-400')}>
              الصافي {fmtCurrency(data?.net_total)}
            </span>
          </div>
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : !data || data.trend.length === 0 ? (
            <EmptyState icon={<Scale className="size-6" />} title="لا توجد حركة في هذه الفترة" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART.receipts} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART.receipts} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gPay" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART.payments} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART.payments} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="day" tickFormatter={(d) => fmtDateShort(d)} tick={{ fontSize: 11 }} reversed />
                  <YAxis tick={{ fontSize: 11 }} width={48} />
                  <Tooltip
                    labelFormatter={(d) => fmtDate(String(d))}
                    formatter={(v: number, name) => [fmtCurrency(v), name === 'receipts' ? 'قبض' : 'صرف']}
                  />
                  <Area type="monotone" dataKey="receipts" stroke={CHART.receipts} fill="url(#gRec)" strokeWidth={2} />
                  <Area type="monotone" dataKey="payments" stroke={CHART.payments} fill="url(#gPay)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">الأرصدة حسب النوع</h2>
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : !data || data.balances_by_type.length === 0 ? (
            <EmptyState icon={<Scale className="size-6" />} title="لا توجد أرصدة بعد" />
          ) : (
            <ul className="space-y-2">
              {data.balances_by_type.map((b) => (
                <li key={b.code} className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-0">
                  <span className="text-sm">{b.name}</span>
                  <span className="nums text-sm font-semibold">
                    {fmtCurrency(Math.abs(b.balance))}
                    <span className="ms-1 text-[11px] font-normal text-muted">{b.balance > 0 ? 'مدين' : 'دائن'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">أعلى المصروفات</h2>
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : !data || data.top_expenses.length === 0 ? (
            <EmptyState icon={<Receipt className="size-6" />} title="لا مصروفات في هذه الفترة" />
          ) : (
            <ul className="space-y-2">
              {data.top_expenses.map((e) => (
                <li key={e.id}>
                  <Link to={`/accounts/${e.id}/statement`} className="flex items-baseline justify-between gap-3 rounded-lg px-1 py-1 text-sm transition hover:bg-surface-2">
                    <span className="min-w-0 truncate">
                      <span className="nums font-mono text-xs text-subtle">{e.account_number}</span> {e.name}
                    </span>
                    <span className="nums shrink-0 font-semibold text-accent-600 dark:text-accent-400">{fmtCurrency(e.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">أحدث السندات</h2>
            <Link to="/vouchers" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline dark:text-brand-400">
              الكل <ArrowLeft className="size-3.5" />
            </Link>
          </div>
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : !data || data.recent.length === 0 ? (
            <EmptyState icon={<Receipt className="size-6" />} title="لا توجد سندات" />
          ) : (
            <ul className="divide-y divide-line">
              {data.recent.map((v) => {
                const inbound = v.type === 'RECEIPT';
                return (
                  <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                    {inbound
                      ? <ArrowDownCircle className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      : <ArrowUpCircle className="size-4 shrink-0 text-accent-600 dark:text-accent-400" />}
                    <div className="min-w-0 flex-1">
                      <div className="nums text-xs font-medium text-muted">{v.number}</div>
                      <div className="truncate text-[11px] text-subtle">{v.counterparty || v.counter_account_name || '—'}</div>
                    </div>
                    <span className={cn('nums shrink-0 text-sm font-semibold', inbound ? 'text-emerald-600 dark:text-emerald-400' : 'text-accent-600 dark:text-accent-400')}>
                      {fmtCurrency(v.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

const TONES: Record<string, string> = {
  brand: 'text-brand-600 dark:text-brand-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  danger: 'text-accent-600 dark:text-accent-400',
  warning: 'text-amber-600 dark:text-amber-400',
};

function Kpi({
  loading, icon, tone, label, value, hint,
}: {
  loading: boolean; icon: ReactNode; tone: string; label: string; value: ReactNode; hint?: string;
}) {
  return (
    <Card className="p-3.5">
      <div className={cn('mb-1.5', TONES[tone])}>{icon}</div>
      <div className="text-xs text-muted">{label}</div>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-20" />
      ) : (
        <div className={cn('nums mt-0.5 text-lg font-bold', TONES[tone])}>{value}</div>
      )}
      {hint && <div className="mt-0.5 text-[11px] text-subtle">{hint}</div>}
    </Card>
  );
}
