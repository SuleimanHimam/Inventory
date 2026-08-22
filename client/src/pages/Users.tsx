import { useState } from 'react';
import {
  UserPlus, KeyRound, Trash2, Users as UsersIcon, ShieldCheck, User, Info, TriangleAlert,
  PackageMinus,
} from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal,
  PageHeader, Select, TableSkeleton,
} from '@/components/ui';
import { useUsers, useUserMutations } from '@/hooks';
import { ROLE_LABEL, ROLE_HINT } from '@/lib/permissions';
import { fmtDateShort } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import { cn } from '@/lib/cn';
import type { OrgUser } from '@/lib/types';

/**
 * User administration — its own screen rather than a card inside Settings.
 *
 * Layout follows the same rule as the items list: cards on anything held in
 * the hand, the dense table only where there is a real pointer
 * (`.device-cards` / `.device-table` in index.css — a `pointer: fine` query,
 * not a width one, so a tablet in landscape still gets cards).
 *
 * Everything destructive is confirmed, and the two rules that keep an
 * organisation administrable — you cannot delete yourself, and the last
 * manager cannot be demoted or removed — are enforced by the API
 * (`users.routes.js`) and mirrored here as disabled controls so they read as
 * rules rather than as errors after the fact.
 */
export default function Users() {
  const { data, isLoading } = useUsers();
  const { create, update, remove } = useUserMutations();

  const [showAdd, setShowAdd] = useState(false);
  const [resetFor, setResetFor] = useState<OrgUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [removeTarget, setRemoveTarget] = useState<OrgUser | null>(null);

  const users = data?.data ?? [];
  const managers = users.filter((u) => u.role === 'OWNER').length;
  const clerks = users.filter((u) => u.role === 'CLERK').length;
  const staff = users.length - managers - clerks;

  const changeRole = async (user: OrgUser, next: OrgUser['role']) => {
    try {
      await update.mutateAsync({ id: user.id, role: next });
      toast.success('تم تغيير الصلاحية', `${user.email} — ${ROLE_LABEL[next]}`);
    } catch (err) {
      toastError(err, 'تعذّر تغيير الصلاحية');
    }
  };

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetFor) return;
    try {
      await update.mutateAsync({ id: resetFor.id, password: resetPassword });
      toast.success('تم تعيين كلمة مرور جديدة', resetFor.email);
      setResetFor(null);
      setResetPassword('');
    } catch (err) {
      toastError(err, 'تعذّر تعيين كلمة المرور');
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    try {
      await remove.mutateAsync(removeTarget.id);
      toast.success('تم حذف الحساب', removeTarget.email);
      setRemoveTarget(null);
    } catch (err) {
      toastError(err, 'تعذّر حذف الحساب');
    }
  };

  /** True when this row is the only thing standing between the org and nobody. */
  const isLastManager = (user: OrgUser) => user.role === 'OWNER' && managers <= 1;

  return (
    <>
      <PageHeader
        title="المستخدمون"
        subtitle="حسابات الدخول إلى النظام وصلاحية كل منها"
        actions={data?.can_create && (
          <Button variant="primary" icon={<UserPlus className="size-4" />}
            onClick={() => setShowAdd(true)}>
            {/* The word alone on a phone — the icon already carries "add". */}
            <span className="max-sm:hidden">إضافة مستخدم</span>
            <span className="sm:hidden">إضافة</span>
          </Button>
        )}
      />

      {/* Role legend — three columns from `lg`, two from `sm`, stacked on a phone. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RoleLegend
          icon={<ShieldCheck className="size-4" />}
          role="OWNER"
          count={managers}
          tone="brand"
        />
        <RoleLegend
          icon={<User className="size-4" />}
          role="MEMBER"
          count={staff}
          tone="neutral"
        />
        <RoleLegend
          icon={<PackageMinus className="size-4" />}
          role="CLERK"
          count={clerks}
          tone="neutral"
        />
      </div>

      {data && !data.can_create && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-3 text-xs leading-relaxed text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            إنشاء الحسابات وتغيير كلمات المرور متاح فقط عندما يكون الدخول محلياً
            (<code className="font-mono">AUTH_MODE=local</code>). تغيير صلاحيات
            الأعضاء الحاليين يعمل في كل الأحوال.
          </span>
        </div>
      )}

      {/* Deliberately *not* `.list-pane`: that caps a list at the viewport and
          gives it its own scroller, which earns its keep on the items screen
          (hundreds of rows, a filter bar and a pager to keep pinned). A user
          list is a handful of rows with neither — the same treatment would
          reserve a screen-tall box and leave most of it blank. This card sizes
          to its content and the page scrolls, which is also what makes the
          phone layout behave with the keyboard open. */}
      <Card className="overflow-hidden">
        <div>
          {isLoading ? (
            <TableSkeleton cols={3} />
          ) : users.length === 0 ? (
            <div className="grid min-h-[16rem] place-items-center p-4">
              <EmptyState
                icon={<UsersIcon className="size-8" />}
                title="لا يوجد مستخدمون"
                message="أضف أول حساب ليتمكن فريقك من الدخول إلى النظام."
                action={data?.can_create && (
                  <Button variant="primary" icon={<UserPlus className="size-4" />}
                    onClick={() => setShowAdd(true)}>
                    إضافة مستخدم
                  </Button>
                )}
              />
            </div>
          ) : (
            <>
              {/* Touch: one card per user, two per row from `sm` up. */}
              <div className="device-cards grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                {users.map((user) => (
                  <UserCard
                    key={user.id}
                    user={user}
                    lastManager={isLastManager(user)}
                    busy={update.isPending}
                    onRole={(next) => changeRole(user, next)}
                    onReset={() => { setResetFor(user); setResetPassword(''); }}
                    onRemove={() => setRemoveTarget(user)}
                  />
                ))}
              </div>

              {/* Pointer devices: the dense table. */}
              <table className="data-table device-table">
                <thead>
                  <tr>
                    <th>اسم المستخدم</th>
                    <th className="w-44">الصلاحية</th>
                    <th className="w-32">أُضيف في</th>
                    <th className="w-px" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const lastManager = isLastManager(user);
                    return (
                      <tr key={user.id}>
                        <td data-primary>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'grid size-8 shrink-0 place-items-center rounded-full',
                              user.role === 'OWNER'
                                ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                                : 'bg-surface-3 text-muted',
                            )}>
                              <RoleIcon role={user.role} className="size-4" />
                            </span>
                            <span className="truncate font-semibold">{user.email}</span>
                            {user.is_self && <Badge tone="brand">أنت</Badge>}
                            {user.has_local_account && !user.has_password && (
                              <Badge tone="warning">بلا كلمة مرور</Badge>
                            )}
                          </div>
                        </td>
                        <td data-label="الصلاحية">
                          <RoleSelect
                            value={user.role}
                            disabled={lastManager || update.isPending}
                            lastManager={lastManager}
                            onChange={(next) => changeRole(user, next)}
                          />
                        </td>
                        <td data-label="أُضيف في" className="nums text-xs text-muted">
                          {fmtDateShort(user.created_at)}
                        </td>
                        <td>
                          <RowActions
                            user={user}
                            lastManager={lastManager}
                            onReset={() => { setResetFor(user); setResetPassword(''); }}
                            onRemove={() => setRemoveTarget(user)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Card>

      <AddUserModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreate={create.mutateAsync}
        busy={create.isPending}
      />

      <Modal
        open={!!resetFor}
        onClose={() => setResetFor(null)}
        title="تعيين كلمة مرور جديدة"
        description={resetFor?.email}
        size="sm"
        /* Pinned, not inside the scrolling body: with the Android keyboard up
           the body is only a couple of fields tall, and buttons that scroll
           away with it are buttons you cannot reach without dismissing the
           keyboard first. `form=` lets them submit from outside the form. */
        footer={(
          <>
            <Button type="button" onClick={() => setResetFor(null)}>إلغاء</Button>
            <Button type="submit" form="reset-password-form" variant="primary"
              loading={update.isPending}>
              حفظ
            </Button>
          </>
        )}
      >
        <form id="reset-password-form" onSubmit={submitReset} className="space-y-4">
          <Field label="كلمة المرور الجديدة" hint="أي طول تريده — اتركها فارغة لإلغاء كلمة المرور">
            <Input type="text" value={resetPassword} dir="ltr"
              autoComplete="new-password"
              onChange={(e) => setResetPassword(e.target.value)} />
          </Field>
          <p className="text-[11px] leading-relaxed text-subtle">
            لا تُطلب كلمة المرور القديمة — أنت مدير ولا تملكها. بلّغ المستخدم بالكلمة الجديدة مباشرة.
          </p>
          {resetPassword === '' && <OpenAccountWarning action="سيصبح هذا الحساب" />}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        title="حذف الحساب"
        message={`سيفقد ${removeTarget?.email ?? ''} إمكانية الدخول فوراً. الفواتير والحركات التي سجّلها تبقى كما هي.`}
        confirmLabel="حذف"
        tone="danger"
        loading={remove.isPending}
      />
    </>
  );
}

/* -------------------------------------------------------------- fragments */

/** One glyph per role, so a row is identifiable before its label is read. */
function RoleIcon({ role, className }: { role: OrgUser['role']; className?: string }) {
  if (role === 'OWNER') return <ShieldCheck className={className} />;
  if (role === 'CLERK') return <PackageMinus className={className} />;
  return <User className={className} />;
}

/**
 * What "no password" actually means, said plainly at the moment it is chosen.
 *
 * Not a confirmation step and not a block — the manager asked for this and it
 * is their system. But this deployment answers on a public address, so the
 * consequence is worth one sentence rather than a silent checkbox.
 */
function OpenAccountWarning({ action }: { action: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-accent-50 px-3 py-2.5 text-[11px] leading-relaxed text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {action} <strong>مفتوحاً</strong>: يكفي معرفة اسم المستخدم للدخول به.
        النظام متاح من الإنترنت، ومن يدخل باسمه يستطيع ترحيل فواتير لا يمكن التراجع عنها.
      </span>
    </div>
  );
}

function RoleLegend({
  icon, role, count, tone,
}: {
  icon: React.ReactNode; role: OrgUser['role']; count: number; tone: 'brand' | 'neutral';
}) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className={cn(
        'grid size-9 shrink-0 place-items-center rounded-xl',
        tone === 'brand'
          ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
          : 'bg-surface-3 text-muted',
      )}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="flex items-baseline gap-2 text-sm font-bold">
          {ROLE_LABEL[role]}
          <span className="nums text-xs font-normal text-subtle">{count}</span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{ROLE_HINT[role]}</p>
      </div>
    </Card>
  );
}

function RoleSelect({
  value, disabled, lastManager, onChange, className,
}: {
  value: OrgUser['role'];
  disabled?: boolean;
  lastManager: boolean;
  onChange: (next: OrgUser['role']) => void;
  className?: string;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      className={className}
      title={lastManager ? 'لا يمكن تغيير صلاحية آخر مدير' : undefined}
      onChange={(e) => onChange(e.target.value as OrgUser['role'])}
    >
      {/* Every role the API accepts, in order of how much they may see. */}
      <option value="CLERK">{ROLE_LABEL.CLERK}</option>
      <option value="MEMBER">{ROLE_LABEL.MEMBER}</option>
      <option value="OWNER">{ROLE_LABEL.OWNER}</option>
    </Select>
  );
}

function RowActions({
  user, lastManager, onReset, onRemove,
}: {
  user: OrgUser; lastManager: boolean; onReset: () => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {user.has_local_account && (
        <Button size="icon" variant="ghost" title="تعيين كلمة مرور جديدة" onClick={onReset}>
          <KeyRound className="size-4" />
        </Button>
      )}
      <Button
        size="icon" variant="ghost"
        className="hover:text-accent-600 dark:hover:text-accent-400"
        title={user.is_self ? 'لا يمكنك حذف حسابك'
          : lastManager ? 'لا يمكن حذف آخر مدير' : 'حذف الحساب'}
        disabled={user.is_self || lastManager}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function UserCard({
  user, lastManager, busy, onRole, onReset, onRemove,
}: {
  user: OrgUser;
  lastManager: boolean;
  busy: boolean;
  onRole: (next: OrgUser['role']) => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  return (
    <Card className="flex flex-col p-3.5">
      <div className="flex items-start gap-2.5">
        <span className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          user.role === 'OWNER'
            ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
            : 'bg-surface-3 text-muted',
        )}>
          <RoleIcon role={user.role} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-bold">{user.email}</span>
            {user.is_self && <Badge tone="brand">أنت</Badge>}
            {user.has_local_account && !user.has_password && (
              <Badge tone="warning">بلا كلمة مرور</Badge>
            )}
          </p>
          <p className="nums mt-0.5 text-[11px] text-subtle">
            أُضيف في {fmtDateShort(user.created_at)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2 border-t border-line pt-3">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-subtle">الصلاحية</span>
          <RoleSelect
            value={user.role}
            disabled={lastManager || busy}
            lastManager={lastManager}
            onChange={onRole}
            className="w-full"
          />
        </label>
        <RowActions user={user} lastManager={lastManager} onReset={onReset} onRemove={onRemove} />
      </div>

      {lastManager && (
        <p className="mt-2 text-[11px] leading-relaxed text-subtle">
          آخر مدير في المؤسسة — لا يمكن تغيير صلاحيته أو حذفه.
        </p>
      )}
    </Card>
  );
}

/**
 * Create a user. A modal rather than an inline row: on a phone the three
 * fields need the full width each, and a form that pushes the list down the
 * screen every time it opens is worse than one that covers it.
 */
function AddUserModal({
  open, onClose, onCreate, busy,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (body: { username: string; password: string; role: OrgUser['role'] }) => Promise<unknown>;
  busy: boolean;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<OrgUser['role']>('MEMBER');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setUsername(''); setPassword(''); setRole('MEMBER'); setError(null);
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onCreate({ username: username.trim(), password, role });
      toast.success('تم إنشاء الحساب', `${username.trim()} — ${ROLE_LABEL[role]}`);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء الحساب');
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="إضافة مستخدم"
      size="sm"
      footer={(
        <>
          <Button type="button" onClick={close}>إلغاء</Button>
          <Button type="submit" form="add-user-form" variant="primary" loading={busy}
            disabled={!username.trim()}>
            إنشاء الحساب
          </Button>
        </>
      )}
    >
      <form id="add-user-form" onSubmit={submit} className="space-y-4">
        <Field label="اسم المستخدم">
          <Input value={username} onChange={(e) => setUsername(e.target.value)}
            autoComplete="off" dir="auto" required />
        </Field>

        <Field label="كلمة المرور" hint="اختيارية — اتركها فارغة لإنشاء حساب بلا كلمة مرور">
          {/* type="text", not "password": there is no email delivery behind
              these accounts, so the manager has to be able to read the value
              back to the person they are creating it for.
              No `required`, no `minLength`: the manager decides. */}
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password" dir="ltr" className="nums" />
        </Field>

        {password === '' && <OpenAccountWarning action="سيكون هذا الحساب" />}

        <Field label="الصلاحية" hint={ROLE_HINT[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as OrgUser['role'])}>
            <option value="CLERK">{ROLE_LABEL.CLERK}</option>
            <option value="MEMBER">{ROLE_LABEL.MEMBER}</option>
            <option value="OWNER">{ROLE_LABEL.OWNER}</option>
          </Select>
        </Field>

        {error && (
          <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
            {error}
          </p>
        )}

      </form>
    </Modal>
  );
}
