import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronDown, Plus, Pencil, Trash2, Search as SearchIcon,
  FolderTree, CheckCircle2, XCircle, Ban, FileText, Wand2,
} from 'lucide-react';
import {
  Button, Card, Input, Textarea, Modal, PageHeader, EmptyState,
  Skeleton, Badge, Combobox, ConfirmDialog,
} from '@/components/ui';
import { useAccounts, useAccountMutations, useAccount } from '@/hooks';
import { usePermissions } from '@/lib/permissions';
import { toast, toastError } from '@/store/toast';
import { fmtCurrency, fmtInt } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Account } from '@/lib/types';

/**
 * Chart of Accounts — a dynamic, unlimited-depth tree.
 *
 * Reads for any non-clerk (they pick accounts on vouchers); a manager adds,
 * edits, (de)activates and deletes, all enforced again on the API. Balances are
 * shown as zero for now — they light up once the voucher/transaction phase
 * lands, and the statement button waits for it too rather than pretending.
 */
export default function ChartOfAccounts() {
  const { isManager } = usePermissions();
  const { data, isLoading } = useAccounts();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Account | null>(null);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  const accounts = useMemo(() => data?.data ?? [], [data]);

  // parent -> children, and the root list, built once per fetch.
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Account[]>();
    for (const a of accounts) {
      const key = a.parent_account_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [accounts]);

  const q = search.trim();
  const matches = useMemo(() => {
    if (!q) return null;
    const lower = q.toLowerCase();
    return accounts.filter((a) =>
      a.account_number.includes(q) || a.name.toLowerCase().includes(lower));
  }, [q, accounts]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const rows: Array<{ account: Account; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const a of childrenOf.get(parentId) ?? []) {
      rows.push({ account: a, depth });
      if (expanded.has(a.id)) walk(a.id, depth + 1);
    }
  };
  if (!q) walk(null, 0);

  return (
    <>
      <PageHeader
        title="دليل الحسابات"
        actions={isManager && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> حساب جديد
          </Button>
        )}
      />

      <Card className="mb-3 p-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث برقم الحساب أو اسمه…"
            className="ps-9"
          />
        </div>
      </Card>

      <Card className="p-1.5">
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : accounts.length === 0 ? (
          <EmptyState icon={<FolderTree className="size-6" />} title="لا توجد حسابات" />
        ) : q ? (
          matches && matches.length > 0 ? (
            <ul className="divide-y divide-line">
              {matches.map((a) => (
                <AccountRow key={a.id} account={a} depth={0} onOpen={() => setSelected(a)} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={<SearchIcon className="size-6" />} title="لا حسابات مطابقة" />
          )
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(({ account, depth }) => (
              <AccountRow
                key={account.id}
                account={account}
                depth={depth}
                expanded={expanded.has(account.id)}
                onToggle={account.child_count > 0 ? () => toggle(account.id) : undefined}
                onOpen={() => setSelected(account)}
              />
            ))}
          </ul>
        )}
      </Card>

      {selected && (
        <AccountSummary
          account={accounts.find((a) => a.id === selected.id) ?? selected}
          isManager={isManager}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); }}
        />
      )}

      {editing && (
        <AccountEditor
          account={editing === 'new' ? null : editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function AccountRow({
  account, depth, expanded, onToggle, onOpen,
}: {
  account: Account;
  depth: number;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
}) {
  return (
    <li className="flex items-center gap-1" style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? 'طي' : 'توسيع'}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-subtle transition hover:bg-surface-2"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      ) : (
        <span className="size-7 shrink-0" />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-start transition hover:bg-surface-2"
      >
        <span className="nums shrink-0 font-mono text-xs font-bold text-muted">{account.account_number}</span>
        <span className={cn('min-w-0 truncate text-sm', !account.is_active && 'text-subtle line-through')}>
          {account.name}
        </span>
        {!account.is_posting && <Badge tone="neutral" className="shrink-0">أب</Badge>}
        {!account.is_active && <Badge tone="warning" className="shrink-0">معطّل</Badge>}
      </button>
    </li>
  );
}

function AccountSummary({
  account, isManager, onClose, onEdit,
}: {
  account: Account;
  isManager: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const { setActive, remove } = useAccountMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The flat list carries no balance; fetch this one account for its rolled-up
  // ledger figure. Falls back to the list row while it loads.
  const { data: detail } = useAccount(account.id);
  const balance = detail?.balance ?? 0;
  const hasMovements = (detail?.debit_total ?? 0) !== 0 || (detail?.credit_total ?? 0) !== 0;
  const side = balance > 0 ? 'مدين' : balance < 0 ? 'دائن' : '';

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
      title={account.name}
      description={`رقم الحساب ${account.account_number}`}
      footer={isManager && (
        <>
          <Button variant="ghost" onClick={() => navigate(`/accounts/${account.id}/statement`)}>
            <FileText className="size-4" /> كشف الحساب
          </Button>
          <Button
            variant="ghost"
            onClick={() => setActive.mutate(
              { id: account.id, active: !account.is_active },
              { onError: (e: Error) => toastError(e, 'تعذّر التحديث') },
            )}
          >
            {account.is_active ? <><Ban className="size-4" /> تعطيل</> : <><CheckCircle2 className="size-4" /> تفعيل</>}
          </Button>
          <Button variant="ghost" onClick={onEdit}><Pencil className="size-4" /> تعديل</Button>
          <Button
            variant="ghost"
            className="text-accent-600 hover:bg-accent-500/10 dark:text-accent-400"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" /> حذف
          </Button>
        </>
      )}
    >
      <div>
        {row('التصنيف', account.is_posting
          ? <Badge tone="success">فرعي</Badge>
          : <Badge tone="neutral">أب</Badge>)}
        {row('الحالة', account.is_active
          ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" /> مفعّل</span>
          : <span className="inline-flex items-center gap-1 text-accent-600 dark:text-accent-400"><XCircle className="size-4" /> معطّل</span>)}
        {account.statement_section && row('القسم الختامي', account.statement_section)}
        {account.child_count > 0 && row('حسابات فرعية', fmtInt(account.child_count))}
        {account.description && row('ملاحظات', account.description)}

        {/* Rolled-up over the account's whole subtree — a group shows the sum of
            everything beneath it. Debit-positive: the side label says which. */}
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted">الرصيد الحالي</span>
            <span className="nums text-xl font-bold text-brand-600 dark:text-brand-400">
              {fmtCurrency(Math.abs(balance))}{side && <span className="ms-1 text-xs font-normal text-muted">{side}</span>}
            </span>
          </div>
          {hasMovements ? (
            <div className="mt-2 flex justify-between text-[11px] text-subtle">
              <span>مدين: {fmtCurrency(detail?.debit_total ?? 0)}</span>
              <span>دائن: {fmtCurrency(detail?.credit_total ?? 0)}</span>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-subtle">لا توجد حركات بعد على هذا الحساب.</p>
          )}
        </div>
      </div>

      {isManager && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate(account.id, {
            onSuccess: () => { toast.success('تم حذف الحساب'); setConfirmDelete(false); onClose(); },
            onError: (e: Error) => toastError(e, 'تعذّر الحذف'),
          })}
          title="حذف الحساب"
          message="لا يمكن حذف حساب له حسابات فرعية أو حركات — عطّله بدلاً من ذلك إن كان له تاريخ."
          confirmLabel="حذف"
          loading={remove.isPending}
        />
      )}
    </Modal>
  );
}

function AccountEditor({
  account, accounts, onClose,
}: {
  account: Account | null;
  accounts: Account[];
  onClose: () => void;
}) {
  const { create, update } = useAccountMutations();
  const [number, setNumber] = useState(account?.account_number ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [parentId, setParentId] = useState(account?.parent_account_id ?? '');
  const [isPosting, setIsPosting] = useState(account?.is_posting ?? true);
  const [description, setDescription] = useState(account?.description ?? '');

  const busy = create.isPending || update.isPending;

  // The next free number under a parent, extending the parent's own (1601 →
  // 1601001) — the same rule the server uses for auto-created party accounts.
  const nextNumberUnder = (pid: string) => {
    const parent = accounts.find((a) => a.id === pid);
    if (!parent) return '';
    const base = parent.account_number;
    let max = 0;
    for (const a of accounts) {
      if (a.parent_account_id !== pid) continue;
      const suffix = Number(String(a.account_number).slice(base.length));
      if (Number.isFinite(suffix) && suffix > max) max = suffix;
    }
    return `${base}${String(max + 1).padStart(3, '0')}`;
  };

  // For a brand-new account, fill the number automatically once a parent is
  // chosen and the field is still empty — no typing the ID by hand.
  useEffect(() => {
    if (!account && parentId && !number) setNumber(nextNumberUnder(parentId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The type is no longer chosen by hand — a new account inherits its parent's
    // type; an edited one keeps its own (null leaves it unchanged server-side).
    const parentType = accounts.find((a) => a.id === parentId)?.account_type_id ?? null;
    const body = {
      account_number: number.trim(),
      name: name.trim(),
      parent_account_id: parentId || null,
      account_type_id: account ? null : parentType,
      is_posting: isPosting,
      description: description.trim() || null,
    };
    const opts = {
      onSuccess: () => { toast.success(account ? 'تم تحديث الحساب' : 'تم إنشاء الحساب'); onClose(); },
      onError: (e: Error) => toastError(e, 'تعذّر الحفظ'),
    };
    if (account) update.mutate({ id: account.id, ...body }, opts);
    else create.mutate(body, opts);
  };

  // A parent cannot be the account itself; deeper cycles are caught server-side.
  const parentOptions = accounts.filter((a) => a.id !== account?.id);

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? 'تعديل حساب' : 'حساب جديد'}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!number.trim() || !name.trim()}>
            حفظ
          </Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">اسم الحساب</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">الحساب الأب</span>
          <Combobox
            value={parentId}
            onChange={setParentId}
            options={parentOptions.map((a) => ({ value: a.id, label: a.name, hint: a.account_number }))}
            placeholder="— حساب رئيسي (بلا أب) —"
            searchPlaceholder="ابحث برقم الحساب أو اسمه…"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">رقم الحساب</span>
            <div className="flex gap-1.5">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} dir="ltr" required className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="توليد رقم تلقائي"
                aria-label="توليد رقم تلقائي"
                disabled={!parentId}
                onClick={() => setNumber(nextNumberUnder(parentId))}
              >
                <Wand2 className="size-4" />
              </Button>
            </div>
          </label>
          <div className="block">
            <span className="mb-1 block text-xs text-muted">تصنيف الحساب</span>
            <div className="flex rounded-lg bg-surface-2 p-0.5">
              {([[true, 'فرعي'], [false, 'أب']] as const).map(([val, lbl]) => (
                <button
                  key={String(val)}
                  type="button"
                  onClick={() => setIsPosting(val)}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition',
                    isPosting === val ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">ملاحظات</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full" />
        </label>
      </form>
    </Modal>
  );
}
