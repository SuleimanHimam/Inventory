import { useMemo, useState, type FormEvent } from 'react';
import {
  ChevronLeft, ChevronDown, Plus, Pencil, Trash2, Search as SearchIcon,
  FolderTree, CheckCircle2, XCircle, Ban,
} from 'lucide-react';
import {
  Button, Card, Input, Select, Textarea, Modal, PageHeader, EmptyState,
  Skeleton, Badge, Toggle, ConfirmDialog,
} from '@/components/ui';
import { useAccounts, useAccountTypes, useAccountMutations } from '@/hooks';
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
        subtitle="شجرة حسابات ديناميكية — الحسابات الفرعية فقط تقبل القيود"
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
        {!account.is_posting && <Badge tone="neutral" className="shrink-0">مجموعة</Badge>}
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
  const { setActive, remove } = useAccountMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        {row('النوع', account.type_name ?? '—')}
        {row('التصنيف', account.is_posting
          ? <Badge tone="success">حساب فرعي (يقبل القيود)</Badge>
          : <Badge tone="neutral">مجموعة (لا يقبل القيود)</Badge>)}
        {row('الحالة', account.is_active
          ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" /> مفعّل</span>
          : <span className="inline-flex items-center gap-1 text-accent-600 dark:text-accent-400"><XCircle className="size-4" /> معطّل</span>)}
        {account.statement_section && row('القسم الختامي', account.statement_section)}
        {account.child_count > 0 && row('حسابات فرعية', fmtInt(account.child_count))}
        {account.description && row('ملاحظات', account.description)}

        {/* Balances arrive with the vouchers phase; shown honestly as zero
            with no transactions rather than a fake figure. */}
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted">الرصيد الحالي</span>
            <span className="nums text-xl font-bold text-brand-600 dark:text-brand-400">
              {fmtCurrency(0)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-subtle">لا توجد حركات بعد — كشف الحساب يتوفّر بعد إضافة السندات.</p>
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
  const { data: types } = useAccountTypes();
  const [number, setNumber] = useState(account?.account_number ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [parentId, setParentId] = useState(account?.parent_account_id ?? '');
  const [typeId, setTypeId] = useState(account?.account_type_id ?? '');
  const [isPosting, setIsPosting] = useState(account?.is_posting ?? true);
  const [description, setDescription] = useState(account?.description ?? '');

  const busy = create.isPending || update.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = {
      account_number: number.trim(),
      name: name.trim(),
      parent_account_id: parentId || null,
      account_type_id: typeId || null,
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
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">رقم الحساب</span>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} dir="ltr" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">النوع</span>
            <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">— بدون —</option>
              {types?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">اسم الحساب</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted">الحساب الأب</span>
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— حساب رئيسي (بلا أب) —</option>
            {parentOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.account_number} — {a.name}</option>
            ))}
          </Select>
        </label>

        <Toggle
          checked={isPosting}
          onChange={setIsPosting}
          label="حساب فرعي يقبل القيود"
          hint="أطفئه لجعله مجموعة تنظيمية فقط"
        />

        <label className="block">
          <span className="mb-1 block text-xs text-muted">ملاحظات</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full" />
        </label>
      </form>
    </Modal>
  );
}
