import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import {
  Button, Card, Input, Textarea, Combobox, PageHeader,
} from '@/components/ui';
import { useVoucherMutations, useAccounts, useSettings } from '@/hooks';
import { toast, toastError } from '@/store/toast';
import type { Account } from '@/lib/types';

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
  // Only the accounts under the expenses parent ("المصروفات") — the leaves a
  // shop actually spends against — not every EXPENSE-typed account. The parent
  // is chosen as the topmost group whose name is about expenses (so a leaf like
  // "مصاريف نقل المشتريات" is never mistaken for it); its whole subtree of
  // posting accounts is offered. Falls back to EXPENSE-typed, then all posting.
  const expenseOptions = useMemo(() => {
    const accts = accountsData?.data ?? [];
    const norm = (s: string) => s.replace(/[إأآ]/g, 'ا').trim();
    const isExpenseName = (n: string) => n.includes('مصروف') || n.includes('مصاريف');
    const candidates = accts.filter((a) => isExpenseName(norm(a.name)));
    const groups = candidates.filter((a) => !a.is_posting);
    const byTop = (a: Account, b: Account) =>
      a.account_number.length - b.account_number.length
      || a.account_number.localeCompare(b.account_number);
    const parent = (groups.length ? groups : candidates).sort(byTop)[0];

    let pool = posting;
    if (parent) {
      const childrenOf = new Map<string, Account[]>();
      for (const a of accts) {
        const key = a.parent_account_id ?? '';
        if (!childrenOf.has(key)) childrenOf.set(key, []);
        childrenOf.get(key)!.push(a);
      }
      const ids = new Set<string>();
      const stack = [parent.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const c of childrenOf.get(cur) ?? []) { ids.add(c.id); stack.push(c.id); }
      }
      const under = posting.filter((a) => ids.has(a.id));
      if (under.length) pool = under;
    } else {
      const exp = posting.filter((a) => a.type_code === 'EXPENSE');
      if (exp.length) pool = exp;
    }
    return pool.map((a) => ({ value: a.id, label: a.name, hint: a.account_number }));
  }, [accountsData, posting]);
  const cashOptions = useMemo(() => {
    const money = posting.filter((a) => a.type_code === 'CASH' || a.type_code === 'BANK');
    return (money.length ? money : posting).map((a) => ({ value: a.id, label: a.name, hint: a.account_number }));
  }, [posting]);

  const { create } = useVoucherMutations();
  const { data: settings } = useSettings();

  const [amount, setAmount] = useState('');
  const [expenseId, setExpenseId] = useState('');
  const [cashId, setCashId] = useState(() => {
    try { return localStorage.getItem(CASH_KEY) ?? ''; } catch { return ''; }
  });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');

  // Pay-from defaults to the last one used on this device, then to the payment
  // default set in voucher settings — whichever exists first, without ever
  // overriding a live selection.
  useEffect(() => {
    if (settings) setCashId((c) => c || settings.voucher_payment_cash_account || '');
  }, [settings]);

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
      <PageHeader title="مصروف سريع" />

      <div className="mx-auto max-w-md">
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">نوع المصروف (الحساب)</span>
              <Combobox
                value={expenseId}
                onChange={setExpenseId}
                options={expenseOptions}
                placeholder="— اختر حساب المصروف —"
                searchPlaceholder="ابحث برقم الحساب أو اسمه…"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">مدفوع من (صندوق/بنك)</span>
              <Combobox
                value={cashId}
                onChange={setCashId}
                options={cashOptions.filter((o) => o.value !== expenseId)}
                placeholder="— اختر الحساب —"
                searchPlaceholder="ابحث برقم الحساب أو اسمه…"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">التاريخ</span>
              <Input value={date} onChange={(e) => setDate(e.target.value)} type="date" dir="ltr" />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">البيان</span>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full" />
            </label>

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
                className="text-lg font-bold"
                required
              />
            </label>

            <Button type="submit" variant="primary" className="w-full" loading={create.isPending} disabled={!valid} icon={<Plus className="size-4" />}>
              تسجيل المصروف
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
