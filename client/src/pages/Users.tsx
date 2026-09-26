import { useState } from 'react';
import {
  UserPlus, KeyRound, Trash2, Users as UsersIcon, ShieldCheck, User, Info, TriangleAlert,
  PackageMinus, UserCog, ShieldEllipsis, Plus, Pencil, Check,
} from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal,
  PageHeader, Select, TableSkeleton, Fab, Tabs,
} from '@/components/ui';
import {
  useUsers, useUserMutations, useRoles, useRoleMeta, useRoleMutations,
} from '@/hooks';
import { ROLE_LABEL, ROLE_HINT } from '@/lib/permissions';
import { fmtDateShort } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import { cn } from '@/lib/cn';
import { AUTH_ENABLED, useSession } from '@/lib/session';
import { AccountCard } from '@/components/AccountCard';
import type { AppRole, RolePermissions, ResourcePerm } from '@/lib/types';
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
  const { data: rolesData } = useRoles();
  const roles = rolesData?.data ?? [];
  const email = useSession((s) => s.email);
  const [tab, setTab] = useState<'users' | 'roles' | 'account'>('users');

  /** The role id a member effectively has: their assigned role, or the built-in. */
  const currentRoleId = (user: OrgUser) =>
    user.role_id ?? roles.find((r) => r.builtin_key === user.role)?.id ?? '';

  const [showAdd, setShowAdd] = useState(false);
  const [resetFor, setResetFor] = useState<OrgUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [removeTarget, setRemoveTarget] = useState<OrgUser | null>(null);

  const users = data?.data ?? [];
  const managers = users.filter((u) => u.role === 'OWNER').length;
  const clerks = users.filter((u) => u.role === 'CLERK').length;
  const staff = users.length - managers - clerks;

  const changeRole = async (user: OrgUser, roleId: string) => {
    try {
      await update.mutateAsync({ id: user.id, role_id: roleId });
      const name = roles.find((r) => r.id === roleId)?.name ?? '';
      toast.success('تم تغيير الصلاحية', `${user.email} — ${name}`);
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
      />

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as 'users' | 'roles' | 'account')}
        items={[
          { id: 'users', label: 'المستخدمون', icon: <UsersIcon className="size-4" /> },
          { id: 'roles', label: 'الأدوار والصلاحيات', icon: <ShieldEllipsis className="size-4" /> },
          ...(AUTH_ENABLED ? [{ id: 'account', label: 'حسابي', icon: <UserCog className="size-4" /> }] : []),
        ]}
      />

      {tab === 'roles' && <RolesTab />}

      {tab === 'users' && (
      <>
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
                    roles={roles}
                    roleId={currentRoleId(user)}
                    lastManager={isLastManager(user)}
                    busy={update.isPending}
                    onRole={(rid) => changeRole(user, rid)}
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
                            roles={roles}
                            value={currentRoleId(user)}
                            disabled={lastManager || update.isPending}
                            lastManager={lastManager}
                            onChange={(rid) => changeRole(user, rid)}
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
      </>
      )}

      {/* The signed-in manager's own credentials — its own tab so everything
          about accounts lives on one screen. */}
      {tab === 'account' && AUTH_ENABLED && (
        <div className="lg:max-w-xl">
          <AccountCard email={email} />
        </div>
      )}

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

      {tab === 'users' && data?.can_create && (
        <Fab icon={<UserPlus className="size-5" />} label="إضافة مستخدم" onClick={() => setShowAdd(true)} />
      )}
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
  roles, value, disabled, lastManager, onChange, className,
}: {
  roles: AppRole[];
  value: string;
  disabled?: boolean;
  lastManager: boolean;
  onChange: (roleId: string) => void;
  className?: string;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      className={className}
      title={lastManager ? 'لا يمكن تغيير صلاحية آخر مدير' : undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      {/* Built-in roles first, then any custom ones the manager defined. */}
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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
  user, roles, roleId, lastManager, busy, onRole, onReset, onRemove,
}: {
  user: OrgUser;
  roles: AppRole[];
  roleId: string;
  lastManager: boolean;
  busy: boolean;
  onRole: (roleId: string) => void;
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
            roles={roles}
            value={roleId}
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

/* ------------------------------------------------------------- roles & perms */

const ACTION_LABELS: Array<{ key: keyof ResourcePerm; label: string }> = [
  { key: 'view', label: 'عرض' },
  { key: 'add', label: 'إضافة' },
  { key: 'edit', label: 'تعديل' },
  { key: 'delete', label: 'حذف' },
  { key: 'see_prices', label: 'الأسعار' },
];

const EMPTY_PERM: ResourcePerm = { view: false, add: false, edit: false, delete: false, see_prices: false };

/** How many screens a role can at least view — a quick summary on its card. */
function viewableCount(role: AppRole) {
  return Object.values(role.permissions).filter((p) => p.view).length;
}

/** The «الأدوار والصلاحيات» tab: define roles and their per-screen grid. */
function RolesTab() {
  const { data, isLoading } = useRoles();
  const roles = data?.data ?? [];
  const [editing, setEditing] = useState<AppRole | 'new' | null>(null);
  const { remove } = useRoleMutations();
  const [deleteTarget, setDeleteTarget] = useState<AppRole | null>(null);

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      toast.success('تم حذف الدور', deleteTarget.name);
      setDeleteTarget(null);
    } catch (err) {
      toastError(err, 'تعذّر حذف الدور');
    }
  };

  return (
    <>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        لكل دور صلاحيات لكل شاشة (عرض/إضافة/تعديل/حذف ورؤية الأسعار). الأدوار المدمجة
        تُعدَّل صلاحياتها ولا تُحذف، ويمكنك إنشاء أدوار جديدة وإسنادها للمستخدمين.
      </p>

      {isLoading ? (
        <TableSkeleton cols={2} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-2 p-3.5">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <ShieldEllipsis className="size-4 text-subtle" />
                  <span className="truncate">{r.name}</span>
                  {r.is_builtin && <Badge tone="neutral">مدمج</Badge>}
                </p>
                <p className="mt-0.5 text-[11px] text-subtle">
                  {viewableCount(r)} شاشة مسموحة
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="icon" variant="ghost" title="تعديل" onClick={() => setEditing(r)}>
                  <Pencil className="size-4" />
                </Button>
                {!r.is_builtin && (
                  <Button size="icon" variant="ghost" className="hover:text-red-500"
                    title="حذف" onClick={() => setDeleteTarget(r)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Fab icon={<Plus className="size-5" />} label="دور جديد" onClick={() => setEditing('new')} />

      {editing && (
        <RoleEditor role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        loading={remove.isPending}
        tone="danger"
        title="حذف الدور"
        confirmLabel="حذف"
        message={<>سيُحذف الدور <strong className="text-ink">{deleteTarget?.name}</strong>. لا يمكن حذف دور مُسنَد إلى مستخدمين.</>}
      />
    </>
  );
}

function RoleEditor({ role, onClose }: { role: AppRole | null; onClose: () => void }) {
  const isEdit = !!role;
  const { data: meta } = useRoleMeta();
  const resources = meta?.resources ?? [];
  const { create, update } = useRoleMutations();

  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState<RolePermissions>(role?.permissions ?? {});

  const permOf = (key: string): ResourcePerm => perms[key] ?? EMPTY_PERM;
  const toggle = (key: string, action: keyof ResourcePerm) =>
    setPerms((p) => {
      const cur = p[key] ?? EMPTY_PERM;
      const next = { ...cur, [action]: !cur[action] };
      if (action !== 'view' && next[action]) next.view = true;
      if (action === 'view' && !next.view) { next.add = false; next.edit = false; next.delete = false; next.see_prices = false; }
      return { ...p, [key]: next };
    });
  const setRow = (key: string, on: boolean) =>
    setPerms((p) => ({
      ...p,
      [key]: on
        ? { view: true, add: true, edit: true, delete: true, see_prices: true }
        : { ...EMPTY_PERM },
    }));

  const save = async () => {
    if (!name.trim() && !role?.is_builtin) { toast.error('اسم الدور مطلوب'); return; }
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: role!.id,
          name: role!.is_builtin ? undefined : name.trim(),
          permissions: perms,
        });
        toast.success('تم حفظ الدور');
      } else {
        await create.mutateAsync({ name: name.trim(), permissions: perms });
        toast.success('تم إنشاء الدور');
      }
      onClose();
    } catch (err) {
      toastError(err, 'تعذّر حفظ الدور');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `تعديل الدور: ${role!.name}` : 'دور جديد'}
      footer={(
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" onClick={save} loading={create.isPending || update.isPending}>
            حفظ
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Field label="اسم الدور">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={role?.is_builtin}
            placeholder="مثال: أمين مخزن، محاسب" />
        </Field>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>الشاشة</th>
                {ACTION_LABELS.map((a) => <th key={a.key} className="w-14 text-center">{a.label}</th>)}
                <th className="w-12 text-center">الكل</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => {
                const p = permOf(r.key);
                const allOn = p.view && p.add && p.edit && p.delete && p.see_prices;
                return (
                  <tr key={r.key}>
                    <td className="font-medium">{r.label}</td>
                    {ACTION_LABELS.map((a) => (
                      <td key={a.key} className="text-center">
                        <input
                          type="checkbox"
                          checked={p[a.key]}
                          onChange={() => toggle(r.key, a.key)}
                          className="size-4 cursor-pointer accent-brand-600"
                          aria-label={`${r.label} — ${a.label}`}
                        />
                      </td>
                    ))}
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => setRow(r.key, !allOn)}
                        className={cn('grid size-6 place-items-center rounded transition',
                          allOn ? 'bg-brand-600 text-white' : 'bg-surface-2 text-subtle hover:bg-surface-3')}
                        aria-label={`تحديد الكل — ${r.label}`}
                      >
                        <Check className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
