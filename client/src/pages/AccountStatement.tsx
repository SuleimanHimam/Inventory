import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Printer, Download, FileText } from 'lucide-react';
import {
  Button, Card, Input, Combobox, PageHeader, EmptyState, Skeleton,
} from '@/components/ui';
import { useAccountStatement, useAccounts } from '@/hooks';
import { fmtCurrency, fmtDate } from '@/lib/format';
import { printAs } from '@/lib/print';
import { cn } from '@/lib/cn';
import type { StatementLine } from '@/lib/types';

/**
 * Account statement (كشف حساب) — every ledger line for one account over a date
 * range, with a running balance, plus opening and closing figures. Manager-only
 * (the API refuses everyone else). Prints on A4 through the shared paper helper
 * and exports the same rows to a BOM-tagged CSV that Excel opens with Arabic
 * intact, matching how the rest of the app exports.
 */
function sideLabel(balance: number) {
  return balance > 0 ? 'مدين' : balance < 0 ? 'دائن' : '';
}

export default function AccountStatement() {
  // Reached two ways: from an account's summary (/accounts/:id/statement) with
  // the account fixed, or from the home tile (/statement) where the user picks
  // one here. Either way the picker below lets them switch accounts.
  const { id: paramId } = useParams<{ id: string }>();
  const today = new Date().toISOString().slice(0, 10);
  const [accountId, setAccountId] = useState(paramId ?? '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(today);
  const { data, isLoading } = useAccountStatement(
    accountId, { date_from: dateFrom, date_to: dateTo }, !!accountId,
  );

  const { data: accountsData } = useAccounts();
  const accountOptions = useMemo(
    () => (accountsData?.data ?? []).map((a) => ({
      value: a.id, label: a.name, hint: a.account_number,
    })),
    [accountsData],
  );

  const exportCsv = () => {
    if (!data) return;
    const header = ['التاريخ', 'المستند', 'البيان', 'مدين', 'دائن', 'الرصيد'];
    const opening = ['', '', 'رصيد افتتاحي', '', '', String(data.opening_balance)];
    const body = data.lines.map((l) => [
      fmtDate(l.entry_date),
      l.voucher_number ?? '',
      l.description ?? '',
      l.debit ? String(l.debit) : '',
      l.credit ? String(l.credit) : '',
      String(l.running_balance),
    ]);
    const closing = ['', '', 'رصيد ختامي', String(data.total_debit), String(data.total_credit), String(data.closing_balance)];
    const csv = [header, opening, ...body, closing]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `كشف-حساب-${data.account.account_number}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="print-area">
      <PageHeader
        breadcrumb={(
          <Link to="/accounts" className="inline-flex items-center gap-1 hover:text-brand-500">
            <ChevronRight className="size-3.5" /> دليل الحسابات
          </Link>
        )}
        title={data ? `كشف حساب: ${data.account.name}` : 'كشف حساب'}
        subtitle={data ? `رقم الحساب ${data.account.account_number}` : undefined}
        actions={(
          <>
            <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!data || data.lines.length === 0}>
              Excel
            </Button>
            <Button icon={<Printer className="size-4" />} onClick={() => printAs('a4')} disabled={!data}>
              طباعة
            </Button>
          </>
        )}
      />

      <Card className="mb-3 p-2.5 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-64 flex-1">
            <span className="mb-1 block text-xs text-muted">الحساب</span>
            <Combobox
              value={accountId}
              onChange={setAccountId}
              options={accountOptions}
              placeholder="— اختر الحساب —"
              searchPlaceholder="ابحث برقم الحساب أو اسمه…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">من تاريخ</span>
            <Input value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} type="date" dir="ltr" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">إلى تاريخ</span>
            <Input value={dateTo} onChange={(e) => setDateTo(e.target.value)} type="date" dir="ltr" />
          </label>
          {dateFrom && (
            <Button variant="ghost" onClick={() => setDateFrom('')}>من البداية</Button>
          )}
        </div>
      </Card>

      {!accountId ? (
        <Card className="p-6">
          <EmptyState icon={<FileText className="size-6" />} title="اختر حساباً" message="اختر حساباً من القائمة أعلاه لعرض حركاته." />
        </Card>
      ) : isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {/* Print-only heading — the page header's title is hidden on paper by
              default styling, so restate the essentials for the printout. */}
          <div className="mb-3 hidden print:block">
            <h1 className="text-lg font-bold">كشف حساب: {data.account.name}</h1>
            <p className="text-sm text-muted">
              رقم الحساب {data.account.account_number}
              {(dateFrom || dateTo) && ` — ${dateFrom ? fmtDate(dateFrom) : 'البداية'} إلى ${fmtDate(dateTo)}`}
            </p>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label="رصيد افتتاحي" value={data.opening_balance} withSide />
            <Figure label="إجمالي مدين" value={data.total_debit} />
            <Figure label="إجمالي دائن" value={data.total_credit} />
            <Figure label="رصيد ختامي" value={data.closing_balance} withSide strong />
          </div>

          <Card className="overflow-hidden p-0">
            {data.lines.length === 0 ? (
              <EmptyState icon={<FileText className="size-6" />} title="لا توجد حركات" message="لا حركات على هذا الحساب ضمن الفترة المحددة." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="whitespace-nowrap p-2.5 text-start font-medium">التاريخ</th>
                      <th className="whitespace-nowrap p-2.5 text-start font-medium">المستند</th>
                      <th className="p-2.5 text-start font-medium">البيان</th>
                      <th className="whitespace-nowrap p-2.5 text-end font-medium">مدين</th>
                      <th className="whitespace-nowrap p-2.5 text-end font-medium">دائن</th>
                      <th className="whitespace-nowrap p-2.5 text-end font-medium">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    <tr className="bg-surface-2/40 text-xs">
                      <td className="p-2.5" colSpan={5}>رصيد افتتاحي</td>
                      <td className="nums p-2.5 text-end font-medium">{fmtCurrency(data.opening_balance)}</td>
                    </tr>
                    {data.lines.map((l) => <StatementRow key={l.id} line={l} />)}
                    <tr className="border-t-2 border-line bg-surface-2/60 font-bold">
                      <td className="p-2.5" colSpan={3}>الإجمالي / الرصيد الختامي</td>
                      <td className="nums p-2.5 text-end">{fmtCurrency(data.total_debit)}</td>
                      <td className="nums p-2.5 text-end">{fmtCurrency(data.total_credit)}</td>
                      <td className="nums p-2.5 text-end text-brand-600 dark:text-brand-400">
                        {fmtCurrency(Math.abs(data.closing_balance))}
                        {sideLabel(data.closing_balance) && (
                          <span className="ms-1 text-[11px] font-normal text-muted">{sideLabel(data.closing_balance)}</span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Figure({
  label, value, withSide, strong,
}: { label: string; value: number; withSide?: boolean; strong?: boolean }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('nums mt-1 font-bold', strong ? 'text-lg text-brand-600 dark:text-brand-400' : 'text-base')}>
        {fmtCurrency(withSide ? Math.abs(value) : value)}
        {withSide && sideLabel(value) && (
          <span className="ms-1 text-[11px] font-normal text-muted">{sideLabel(value)}</span>
        )}
      </div>
    </Card>
  );
}

function StatementRow({ line }: { line: StatementLine }) {
  return (
    <tr>
      <td className="nums whitespace-nowrap p-2.5 text-muted">{fmtDate(line.entry_date)}</td>
      <td className="whitespace-nowrap p-2.5">
        {line.voucher_number
          ? <span className="nums font-mono text-xs">{line.voucher_number}</span>
          : <span className="text-subtle">—</span>}
      </td>
      <td className="p-2.5">
        <span className="line-clamp-2">{line.description || '—'}</span>
        {/* On a rolled-up group statement the specific account matters. */}
        <span className="block text-[11px] text-subtle">
          <span className="nums font-mono">{line.account_number}</span> {line.account_name}
        </span>
      </td>
      <td className="nums p-2.5 text-end">{line.debit ? fmtCurrency(line.debit) : '—'}</td>
      <td className="nums p-2.5 text-end">{line.credit ? fmtCurrency(line.credit) : '—'}</td>
      <td className="nums p-2.5 text-end font-medium">{fmtCurrency(line.running_balance)}</td>
    </tr>
  );
}
