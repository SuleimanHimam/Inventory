import { useMemo, useState, type FormEvent } from 'react';
import { Wallet, Plus } from 'lucide-react';
import {
  Button, Card, Input, Select, Textarea, PageHeader, EmptyState, Skeleton, Badge,
} from '@/components/ui';
import { useVouchers, useVoucherMutations, useAccounts } from '@/hooks';
import { toast, toastError } from '@/store/toast';
import { fmtCurrency, fmtDate } from '@/lib/format';
import type { Account, Voucher } from '@/lib/types';

/**
 * Quick Expenses (مصروفات سريعة) — the fast path for "we spent money on X".
 *
 * An expense is not a separate document kind: it is a Payment voucher whose
 * counter side is an expense account, so this posts through the very same
 * endpoint the Vouchers screen uses and lands in the same ledger. What makes it
 * "quick" is the stripped form — amount, what for, paid from — and that the
 * pay-from account is remembered between entries.
 */
const CASH_KEY = 'inv.expense.cash';

export default function QuickExpenses() {
  const { data: accountsData } = useAccounts({ active: true });
  const posting = useMemo<Account[]>(
    () => (accountsData?.data ?? []).filter((a) => a.is_posting),
    [accountsData],
  );
  const expenseAccounts = useMemo(() => {
    const exp = posting.filter((a) => a.type_code === 'EXPENSE');
    return exp.length ? exp : posting;
  }, [posting]);
  const cashAccounts = useMemo(() => {
    const money = posting.filter((a) => a.type_code === 'CASH' || a.type_code === 'BANK');
    return money.length ? money : posting;
  }, [posting]);

  const { create } = useVoucherMutations();
  const { data, isLoading } = useVouchers({ expense_only: true, limit: 15 });
  const recent = data?.data ?? [];

  const [amount, setAmount] = useState('');
  const [expenseId, setExpenseId] = useState('');
  const [cashId, setCashId] = useState(() => {
    try { return localStorage.getItem(CASH_KEY) ?? ''; } catch { return ''; }
  });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');

  const amountNum = Number(amount);
  const valid = amountNum > 0 && expenseId && cashId && expenseId !== cashId;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    create.mutate({
      type: 'PAYMENT',
      amount: amountNum,
      cash_account_id: cashId,
      counter_account_id: expenseId,
      voucher_date: date,
      description: description.trim() || null,
    }, {
      onSuccess: (v) => {
        toast.success(`تم تسجيل المصروف ${v.number}`);
        try { localStorage.setItem(CASH_KEY, cashId); } catch { /* private window */ }
        setAmount('');
        setDescription('');
        // Keep the expense account and pay-from selected — entries usually come
        // in runs of the same kind.
      },
      onError: (err: Error) => toastError(err, 'تعذّر تسجيل المصروف'),
    });
  };

  return (
    <>
      <PageHeader title="مصروف سريع" subtitle="تسجيل مصروف بخطوة واحدة — يُرحّل كسند صرف على الحساب المختار" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">المبلغ</span>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min="0"
                step="any"
                dir="ltr"
                inputMode="decimal"
                autoFocus
                className="text-lg font-bold"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">نوع المصروف (الحساب)</span>
              <Select value={expenseId} onChange={(e) => setExpenseId(e.target.value)} required>
                <option value="">— اختر حساب المصروف —</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.account_number} — {a.name}</option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">مدفوع من (صندوق/بنك)</span>
              <Select value={cashId} onChange={(e) => setCashId(e.target.value)} required>
                <option value="">— اختر الحساب —</option>
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.id === expenseId}>
                    {a.account_number} — {a.name}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">التاريخ</span>
              <Input value={date} onChange={(e) => setDate(e.target.value)} type="date" dir="ltr" />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">البيان</span>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full" placeholder="اختياري" />
            </label>

            <Button type="submit" variant="primary" className="w-full" loading={create.isPending} disabled={!valid} icon={<Plus className="size-4" />}>
              تسجيل المصروف
            </Button>
          </form>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">أحدث المصروفات</div>
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : recent.length === 0 ? (
            <EmptyState icon={<Wallet className="size-6" />} title="لا توجد مصروفات بعد" message="سجّل أول مصروف من النموذج." />
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((v) => <ExpenseRow key={v.id} voucher={v} />)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ExpenseRow({ voucher }: { voucher: Voucher }) {
  const what = voucher.counter_account_name
    || voucher.description
    || voucher.counter_account_number
    || '—';
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Wallet className="size-5 shrink-0 text-accent-600 dark:text-accent-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{what}</span>
          {voucher.status === 'REVERSED' && <Badge tone="warning">معكوس</Badge>}
        </div>
        <div className="nums text-[11px] text-subtle">{voucher.number} · {fmtDate(voucher.voucher_date)}</div>
      </div>
      <div className="nums shrink-0 font-bold text-accent-600 dark:text-accent-400">
        {fmtCurrency(voucher.amount)}
      </div>
    </li>
  );
}
