import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownCircle, ArrowUpCircle, Receipt, RotateCcw,
} from 'lucide-react';
import {
  Button, Card, Input, Select, Textarea, Modal, PageHeader, EmptyState,
  Skeleton, Badge, SearchInput, Pagination, ConfirmDialog,
} from '@/components/ui';
import {
  useVouchers, useVoucher, useVoucherMutations, useAccounts, useDebounced,
} from '@/hooks';
import { toast, toastError } from '@/store/toast';
import { fmtCurrency, fmtDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Account, Voucher, VoucherType, PaymentMethod } from '@/lib/types';

/**
 * Vouchers — Cash Receipt (سند قبض) and Payment (سند صرف).
 *
 * Manager-only end to end (the API refuses everyone else): a voucher is money,
 * and money is the manager's to see. Creating one posts a balanced pair of
 * ledger entries immediately; there is no draft. A mistake is corrected by
 * reversing, never editing — the detail view offers that, manager confirmation
 * included.
 */
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'نقداً', BANK: 'تحويل بنكي', CHEQUE: 'شيك', TRANSFER: 'حوالة',
};

const TYPE_META: Record<VoucherType, { label: string; icon: typeof ArrowDownCircle; tone: string }> = {
  RECEIPT: { label: 'سند قبض', icon: ArrowDownCircle, tone: 'text-emerald-600 dark:text-emerald-400' },
  PAYMENT: { label: 'سند صرف', icon: ArrowUpCircle, tone: 'text-accent-600 dark:text-accent-400' },
};

export default function Vouchers() {
  const [params, setParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState<VoucherType | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const debounced = useDebounced(search);

  // A home tile deep-links here with ?new=RECEIPT|PAYMENT to open the form.
  const newType = params.get('new');
  const [creating, setCreating] = useState<VoucherType | null>(
    newType === 'RECEIPT' || newType === 'PAYMENT' ? newType : null,
  );
  const [viewing, setViewing] = useState<string | null>(null);

  const closeCreate = () => {
    setCreating(null);
    if (params.has('new')) { params.delete('new'); setParams(params, { replace: true }); }
  };

  const { data, isLoading } = useVouchers({
    type: typeFilter || undefined,
    search: debounced || undefined,
    page,
    limit,
  });
  const rows = data?.data ?? [];
  const summary = data?.summary;
  const meta = data?.meta;

  return (
    <>
      <PageHeader
        title="السندات"
        subtitle="سندات القبض والصرف — كل سند يُنشئ قيداً محاسبياً متوازناً"
        actions={(
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setCreating('RECEIPT')}>
              <ArrowDownCircle className="size-4" /> سند قبض
            </Button>
            <Button onClick={() => setCreating('PAYMENT')}>
              <ArrowUpCircle className="size-4" /> سند صرف
            </Button>
          </div>
        )}
      />

      {summary && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <SummaryCard label="إجمالي القبض" value={summary.receipts_total} tone="text-emerald-600 dark:text-emerald-400" />
          <SummaryCard label="إجمالي الصرف" value={summary.payments_total} tone="text-accent-600 dark:text-accent-400" />
          <SummaryCard label="الصافي" value={summary.net_total} tone="text-brand-600 dark:text-brand-400" />
        </div>
      )}

      <Card className="mb-3 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-surface-2 p-0.5">
            {([['', 'الكل'], ['RECEIPT', 'قبض'], ['PAYMENT', 'صرف']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => { setTypeFilter(val); setPage(1); }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                  typeFilter === val ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
                )}
              >
                {lbl}
              </button>
            ))}
          </div>
          <SearchInput
            value={search}
            onValueChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="ابحث برقم السند أو الطرف…"
            className="min-w-48 flex-1"
          />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Receipt className="size-6" />} title="لا توجد سندات" message="ابدأ بإنشاء سند قبض أو صرف." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((v) => <VoucherRow key={v.id} voucher={v} onOpen={() => setViewing(v.id)} />)}
          </ul>
        )}
        {meta && (
          <Pagination
            page={meta.page}
            pages={meta.pages}
            total={meta.total}
            limit={limit}
            onPage={setPage}
            onLimit={(l) => { setLimit(l); setPage(1); }}
          />
        )}
      </Card>

      {creating && <VoucherEditor type={creating} onClose={closeCreate} />}
      {viewing && <VoucherDetail id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('nums mt-1 text-lg font-bold', tone)}>{fmtCurrency(value)}</div>
    </Card>
  );
}

function VoucherRow({ voucher, onOpen }: { voucher: Voucher; onOpen: () => void }) {
  const meta = TYPE_META[voucher.type];
  const Icon = meta.icon;
  const other = voucher.counterparty
    || voucher.counter_account_name
    || voucher.counter_account_number
    || '';
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-3 py-3 text-start transition hover:bg-surface-2">
        <Icon className={cn('size-5 shrink-0', meta.tone)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="nums font-mono text-xs font-bold text-muted">{voucher.number}</span>
            {voucher.status === 'REVERSED' && <Badge tone="warning">معكوس</Badge>}
          </div>
          <div className="truncate text-sm text-muted">{other || '—'}</div>
        </div>
        <div className="shrink-0 text-end">
          <div className={cn('nums font-bold', meta.tone)}>{fmtCurrency(voucher.amount)}</div>
          <div className="nums text-[11px] text-subtle">{fmtDate(voucher.voucher_date)}</div>
        </div>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------- create form */
function VoucherEditor({ type, onClose }: { type: VoucherType; onClose: () => void }) {
  const meta = TYPE_META[type];
  const { create } = useVoucherMutations();
  const { data: accountsData } = useAccounts({ active: true });
  const posting = useMemo<Account[]>(
    () => (accountsData?.data ?? []).filter((a) => a.is_posting),
    [accountsData],
  );
  // Money accounts are cash/bank leaves; fall back to all posting if none typed.
  const cashAccounts = useMemo(() => {
    const money = posting.filter((a) => a.type_code === 'CASH' || a.type_code === 'BANK');
    return money.length ? money : posting;
  }, [posting]);

  const [amount, setAmount] = useState('');
  const [cashId, setCashId] = useState('');
  const [counterId, setCounterId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [counterparty, setCounterparty] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');

  const amountNum = Number(amount);
  const valid = amountNum > 0 && cashId && counterId && cashId !== counterId;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    create.mutate({
      type,
      amount: amountNum,
      cash_account_id: cashId,
      counter_account_id: counterId,
      voucher_date: date,
      payment_method: method,
      counterparty: counterparty.trim() || null,
      reference: reference.trim() || null,
      description: description.trim() || null,
    }, {
      onSuccess: (v) => { toast.success(`تم حفظ ${meta.label} ${v.number}`); onClose(); },
      onError: (err: Error) => toastError(err, 'تعذّر حفظ السند'),
    });
  };

  const cashLabel = type === 'RECEIPT' ? 'المقبوض في (صندوق/بنك)' : 'المصروف من (صندوق/بنك)';
  const counterLabel = type === 'RECEIPT' ? 'المقبوض من (الحساب)' : 'المدفوع إلى (الحساب)';
  const partyLabel = type === 'RECEIPT' ? 'المستلَم منه (اسم)' : 'المدفوع له (اسم)';

  return (
    <Modal
      open
      onClose={onClose}
      title={meta.label}
      description="القيد المحاسبي يُرحّل فور الحفظ"
      footer={(
        <>
          <Button onClick={onClose} disabled={create.isPending}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending} disabled={!valid}>
            حفظ السند
          </Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
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
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">التاريخ</span>
            <Input value={date} onChange={(e) => setDate(e.target.value)} type="date" dir="ltr" />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">{cashLabel}</span>
          <Select value={cashId} onChange={(e) => setCashId(e.target.value)} required>
            <option value="">— اختر الحساب —</option>
            {cashAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.account_number} — {a.name}</option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">{counterLabel}</span>
          <Select value={counterId} onChange={(e) => setCounterId(e.target.value)} required>
            <option value="">— اختر الحساب —</option>
            {posting.map((a) => (
              <option key={a.id} value={a.id} disabled={a.id === cashId}>
                {a.account_number} — {a.name}
              </option>
            ))}
          </Select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">طريقة الدفع</span>
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">مرجع (شيك/حوالة)</span>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">{partyLabel}</span>
          <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="اختياري" />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">البيان</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full" placeholder="اختياري" />
        </label>

        {cashId && counterId && cashId === counterId && (
          <p className="text-xs text-accent-600 dark:text-accent-400">لا يمكن أن يكون الحسابان متطابقين.</p>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------- detail view */
function VoucherDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: voucher, isLoading } = useVoucher(id);
  const { reverse } = useVoucherMutations();
  const [confirmReverse, setConfirmReverse] = useState(false);

  const meta = voucher ? TYPE_META[voucher.type] : null;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-2 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="min-w-0 text-sm font-medium">{value}</span>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={voucher ? `${meta!.label} ${voucher.number}` : 'السند'}
      description={voucher ? fmtDate(voucher.voucher_date) : undefined}
      footer={voucher && voucher.status === 'POSTED' && (
        <Button
          variant="ghost"
          className="text-accent-600 hover:bg-accent-500/10 dark:text-accent-400"
          onClick={() => setConfirmReverse(true)}
        >
          <RotateCcw className="size-4" /> عكس السند
        </Button>
      )}
    >
      {isLoading || !voucher ? (
        <Skeleton className="h-48" />
      ) : (
        <div>
          <div className="mb-3 rounded-xl bg-surface-2 p-3 text-center">
            <div className={cn('nums text-2xl font-bold', meta!.tone)}>{fmtCurrency(voucher.amount)}</div>
            {voucher.status === 'REVERSED' && <Badge tone="warning" className="mt-1">معكوس</Badge>}
          </div>

          {row('الصندوق/البنك', voucher.cash_account_name
            ? `${voucher.cash_account_number} — ${voucher.cash_account_name}` : '—')}
          {row('الحساب المقابل', voucher.counter_account_name
            ? `${voucher.counter_account_number} — ${voucher.counter_account_name}` : '—')}
          {voucher.counterparty && row(voucher.type === 'RECEIPT' ? 'المستلَم منه' : 'المدفوع له', voucher.counterparty)}
          {row('طريقة الدفع', METHOD_LABEL[voucher.payment_method])}
          {voucher.reference && row('المرجع', voucher.reference)}
          {voucher.description && row('البيان', voucher.description)}
          {voucher.reversed_at && row('تاريخ العكس', fmtDate(voucher.reversed_at))}

          {voucher.entries && voucher.entries.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-medium text-muted">القيد المحاسبي</div>
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="p-2 text-start font-medium">الحساب</th>
                      <th className="p-2 text-end font-medium">مدين</th>
                      <th className="p-2 text-end font-medium">دائن</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {voucher.entries.map((e) => (
                      <tr key={e.id}>
                        <td className="p-2">
                          <span className="nums font-mono text-xs text-muted">{e.account_number}</span> {e.account_name}
                        </td>
                        <td className="nums p-2 text-end">{e.debit ? fmtCurrency(e.debit) : '—'}</td>
                        <td className="nums p-2 text-end">{e.credit ? fmtCurrency(e.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmReverse}
        onClose={() => setConfirmReverse(false)}
        onConfirm={() => reverse.mutate(id, {
          onSuccess: () => { toast.success('تم عكس السند'); setConfirmReverse(false); onClose(); },
          onError: (e: Error) => toastError(e, 'تعذّر عكس السند'),
        })}
        title="عكس السند"
        message="سيتم إنشاء قيد عكسي يلغي أثر هذا السند على الأرصدة. لا يمكن التراجع عن ذلك."
        confirmLabel="عكس السند"
        loading={reverse.isPending}
      />
    </Modal>
  );
}
