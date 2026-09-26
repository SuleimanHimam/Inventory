import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, Save, X } from 'lucide-react';
import {
  Button, Card, Input, Textarea, PageHeader, Combobox, type ComboOption,
} from '@/components/ui';
import { useVoucherMutations, useAccounts, useSettings } from '@/hooks';
import { toast, toastError } from '@/store/toast';
import type { Account, VoucherType } from '@/lib/types';

const toOptions = (accounts: Account[]): ComboOption[] =>
  accounts.map((a) => ({ value: a.id, label: a.name, hint: a.account_number }));

const TYPE_META: Record<VoucherType, { label: string; icon: typeof ArrowDownCircle }> = {
  RECEIPT: { label: 'سند قبض', icon: ArrowDownCircle },
  PAYMENT: { label: 'سند صرف', icon: ArrowUpCircle },
};

/**
 * Create a voucher on its own page (a single form), reached from the home tiles
 * and the vouchers list. Posts a balanced pair of ledger entries at once — no
 * draft — then returns to the list. Manager-only (route-guarded, and the API
 * refuses everyone else).
 */
export default function VoucherForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const paramType = params.get('type');
  const type: VoucherType = paramType === 'PAYMENT' ? 'PAYMENT' : 'RECEIPT';
  const meta = TYPE_META[type];

  const { create } = useVoucherMutations();
  const { data: accountsData } = useAccounts({ active: true });
  const posting = useMemo<Account[]>(
    () => (accountsData?.data ?? []).filter((a) => a.is_posting),
    [accountsData],
  );
  const cashAccounts = useMemo(() => {
    const money = posting.filter((a) => a.type_code === 'CASH' || a.type_code === 'BANK');
    return money.length ? money : posting;
  }, [posting]);

  const [amount, setAmount] = useState('');
  const [cashId, setCashId] = useState('');
  const [counterId, setCounterId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');

  const { data: settings } = useSettings();
  useEffect(() => {
    if (!settings) return;
    const cashKey = type === 'RECEIPT' ? 'voucher_receipt_cash_account' : 'voucher_payment_cash_account';
    const counterKey = type === 'RECEIPT' ? 'voucher_receipt_counter_account' : 'voucher_payment_counter_account';
    setCashId((c) => c || settings[cashKey] || '');
    setCounterId((c) => c || settings[counterKey] || '');
  }, [settings, type]);

  const cashOptions = useMemo(() => toOptions(cashAccounts), [cashAccounts]);
  const counterOptions = useMemo(
    () => toOptions(posting.filter((a) => a.id !== cashId)),
    [posting, cashId],
  );

  const amountNum = Number(amount);
  const valid = amountNum > 0 && !!cashId && !!counterId && cashId !== counterId;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    create.mutate({
      type,
      amount: amountNum,
      cash_account_id: cashId,
      counter_account_id: counterId,
      voucher_date: date,
      description: description.trim() || null,
    }, {
      onSuccess: (v) => { toast.success(`تم حفظ ${meta.label} ${v.number}`); navigate('/vouchers'); },
      onError: (err: Error) => toastError(err, 'تعذّر حفظ السند'),
    });
  };

  const cashLabel = type === 'RECEIPT' ? 'المقبوض في (صندوق/بنك)' : 'المصروف من (صندوق/بنك)';
  const counterLabel = type === 'RECEIPT' ? 'المقبوض من (الحساب)' : 'المدفوع إلى (الحساب)';

  return (
    <>
      <PageHeader title={meta.label} />

      <Card className="mx-auto max-w-2xl overflow-visible p-4 sm:p-5">
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">التاريخ</span>
            <Input value={date} onChange={(e) => setDate(e.target.value)} type="date" dir="ltr" />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted">{cashLabel}</span>
            <Combobox
              value={cashId}
              onChange={setCashId}
              options={cashOptions}
              placeholder="— اختر الحساب —"
              searchPlaceholder="ابحث برقم الحساب أو اسمه…"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted">{counterLabel}</span>
            <Combobox
              value={counterId}
              onChange={setCounterId}
              options={counterOptions}
              placeholder="— اختر الحساب —"
              searchPlaceholder="ابحث برقم الحساب أو اسمه…"
            />
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

          <label className="block">
            <span className="mb-1 block text-xs text-muted">البيان</span>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full" />
          </label>

          {cashId && counterId && cashId === counterId && (
            <p className="text-xs text-accent-600 dark:text-accent-400">لا يمكن أن يكون الحسابان متطابقين.</p>
          )}

          <div className="flex items-center gap-2 border-t border-line pt-4">
            <Button type="submit" variant="primary" icon={<Save className="size-4" />}
              loading={create.isPending} disabled={!valid}>
              حفظ السند
            </Button>
            <Button type="button" variant="ghost" icon={<X className="size-4" />}
              className="ms-auto" onClick={() => navigate('/vouchers')}>
              إلغاء
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
