import { useEffect, useState } from 'react';
import {
  Save, Monitor, Database, Languages, Building2, Info, Download, AppWindow, UserCog, KeyRound,
} from 'lucide-react';
import { Button, Card, PageHeader, Field, Input, Select, Toggle, Stat } from '@/components/ui';
import { useSettings, useUpdateSettings, useInstallPrompt, useUsers } from '@/hooks';
import { usePrefs } from '@/store/prefs';
import { API_BASE } from '@/lib/api';
import {
  AUTH_BACKEND, AUTH_ENABLED, useSession, changePassword, changeUsername,
} from '@/lib/session';
import { fmtCurrency, fmtInt } from '@/lib/format';
import { usePermissions, ROLE_LABEL } from '@/lib/permissions';
import { Link } from 'react-router-dom';
import { Users, ArrowLeft } from 'lucide-react';
import { toast, toastError } from '@/store/toast';
import type { Settings as SettingsType } from '@/lib/types';

const IS_LOCAL = AUTH_BACKEND === 'local';

export default function SettingsPage() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { theme, setTheme } = usePrefs();
  const email = useSession((s) => s.email);
  const { canInstall, promptInstall } = useInstallPrompt();
  const { isManager, role } = usePermissions();
  const [draft, setDraft] = useState<Partial<SettingsType>>({});

  useEffect(() => { if (settings) setDraft(settings); }, [settings]);

  const set = <K extends keyof SettingsType>(key: K) => (value: SettingsType[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const dirty = !!settings && (Object.keys(draft) as Array<keyof SettingsType>)
    .some((key) => String(draft[key]) !== String(settings[key]));

  const save = async () => {
    try {
      await update.mutateAsync(draft);
      toast.success('تم حفظ الإعدادات');
    } catch (error) {
      toastError(error, 'تعذّر حفظ الإعدادات');
    }
  };

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') toast.success('تم تثبيت التطبيق');
  };

  /**
   * A real PWA install needs HTTPS, which this deployment doesn't have yet —
   * so this is the desktop fallback: a tiny downloadable launcher rather than
   * a browser-mediated install. `--app=` is what makes Edge open with no
   * address bar/tabs at all, matching the fullscreen shortcut set up manually
   * earlier; this button just saves doing that by hand.
   */
  const downloadShortcut = () => {
    const script = `@echo off\r\nstart msedge --app="${window.location.origin}" --start-fullscreen\r\n`;
    const blob = new Blob([script], { type: 'application/bat' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'فتح نظام المخزون.bat';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <PageHeader
        title="الإعدادات"
        subtitle="إعدادات عامة تسري على كامل النظام"
        actions={isManager ? (
          <Button variant="primary" icon={<Save className="size-4" />} onClick={save}
            loading={update.isPending} disabled={!dirty}>
            حفظ التغييرات
          </Button>
        ) : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Organisation-wide settings: the API rejects PATCH /settings from a
            non-manager, so showing the fields would only produce a 403 on save. */}
        {isManager && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Building2 className="size-4 text-subtle" /> بيانات المنشأة
          </h2>
          <div className="mt-4 space-y-4">
            <Field label="اسم المنشأة" hint="يظهر في القائمة الجانبية وعلى الفواتير المطبوعة">
              <Input value={draft.company_name ?? ''} onChange={(e) => set('company_name')(e.target.value)} />
            </Field>
            <Field label="رمز العملة" hint="يظهر بجانب كل مبلغ، مثال: ILS أو JOD أو USD">
              <Input value={draft.currency ?? ''} onChange={(e) => set('currency')(e.target.value)}
                className="nums" maxLength={10} />
            </Field>
          </div>
        </Card>
        )}

        {isManager && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Database className="size-4 text-subtle" /> المخزون
          </h2>
          <div className="mt-4 space-y-4">
            <Field
              label="حد التنبيه العام للنواقص"
              hint="يُستخدم لكل صنف لم يُحدَّد له حد خاص. الأصناف التي يقل رصيدها عن هذا الحد أو يساويه تظهر في تقرير النواقص."
            >
              <Input type="number" min="0" step="1" inputMode="numeric" className="nums"
                value={draft.low_stock_threshold ?? ''}
                onChange={(e) => set('low_stock_threshold')(e.target.value)} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="أقصى عدد صفوف للاستيراد">
                <Input type="number" min="1" step="100" inputMode="numeric" className="nums"
                  value={draft.import_max_rows ?? ''}
                  onChange={(e) => set('import_max_rows')(e.target.value)} />
              </Field>
              <Field label="أقصى حجم للملف (ميغابايت)">
                <Input type="number" min="1" step="1" inputMode="numeric" className="nums"
                  value={draft.import_max_file_mb ?? ''}
                  onChange={(e) => set('import_max_file_mb')(e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>
        )}

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Languages className="size-4 text-subtle" /> اللغة والعرض
          </h2>
          <div className="mt-4 space-y-4">
            <Field label="لغة الواجهة" hint="العربية هي اللغة الأساسية مع تخطيط من اليمين إلى اليسار">
              <Select value="ar" disabled>
                <option value="ar">العربية (RTL)</option>
              </Select>
            </Field>

            <Field label="شكل الأرقام"
              hint={isManager
                ? 'الأرقام اللاتينية أوضح في الجداول المالية'
                : 'يضبطه المدير — يسري على كل مستخدمي المؤسسة'}>
              <Select value={draft.digits ?? 'latn'} disabled={!isManager}
                onChange={(e) => set('digits')(e.target.value as 'latn' | 'arab')}>
                <option value="latn">لاتينية (0 1 2 3)</option>
                <option value="arab">عربية هندية (٠ ١ ٢ ٣)</option>
              </Select>
            </Field>

            <div className="border-t border-line pt-4">
              <Toggle
                checked={theme === 'dark'}
                onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                label="الوضع الداكن"
                hint="مريح للعين في الإضاءة المنخفضة — يُحفظ على هذا الجهاز"
              />
            </div>

            <div className="rounded-lg bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-semibold text-muted">معاينة التنسيق</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="nums">{fmtInt(1250)} وحدة</span>
                <span className="nums">{fmtCurrency(1250.5)}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Monitor className="size-4 text-subtle" /> معلومات النظام
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat label="الإصدار" value="6.0.0" />
            <Stat label="الحساب" value={email ?? (AUTH_ENABLED ? '—' : 'وضع التطوير')} />
            <Stat label="الصلاحية" value={role ? ROLE_LABEL[role] : '—'} />
            <Stat label="قاعدة البيانات" value="PostgreSQL مُستضافة" />
            <Stat label="واجهة API" value={<span className="font-mono text-[11px]" dir="ltr">{API_BASE}</span>} />
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-surface-2 px-3 py-3 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              يعمل النظام على الإنترنت: تُحفظ البيانات في قاعدة بيانات PostgreSQL مُستضافة،
              وكل مؤسسة ترى بياناتها فقط. الإعدادات أعلاه تسري على مؤسستك وحدها.
            </span>
          </div>

          {canInstall && (
            <Button className="mt-3 w-full" icon={<Download className="size-4" />} onClick={install}>
              تثبيت التطبيق على هذا الجهاز
            </Button>
          )}
          {!canInstall && (
            <p className="mt-3 text-[11px] leading-relaxed text-subtle">
              زر التثبيت يظهر هنا فقط عند فتح النظام عبر اتصال آمن (HTTPS)، أو من هذا الجهاز
              عبر 127.0.0.1 — وهو قيد من المتصفح نفسه.
            </p>
          )}

          <Button variant="secondary" className="mt-3 w-full" icon={<AppWindow className="size-4" />}
            onClick={downloadShortcut}>
            تنزيل اختصار لسطح المكتب
          </Button>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            يفتح النظام بملء الشاشة بدون شريط عنوان المتصفح. عند أول تشغيل قد يُظهر Windows
            تحذير حماية لأنه ملف مُنزَّل من الإنترنت — اختر «معلومات إضافية» ثم «تشغيل على أي حال».
          </p>
        </Card>

        {isManager && <UsersLinkCard />}
        {AUTH_ENABLED && <AccountCard email={email} />}
      </div>
    </>
  );
}

/** Change the signed-in account's own username/password — both require the current password to confirm. */
function AccountCard({ email }: { email: string | null }) {
  const [newUsername, setNewUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const submitUsername = async (event: React.FormEvent) => {
    event.preventDefault();
    setUsernameError(null);
    if (!newUsername.trim() || !usernamePassword) return;
    setUsernameBusy(true);
    try {
      await changeUsername(newUsername.trim(), usernamePassword);
      toast.success('تم تغيير اسم المستخدم');
      setNewUsername('');
      setUsernamePassword('');
    } catch (error) {
      setUsernameError(error instanceof Error ? error.message : 'تعذّر تغيير اسم المستخدم');
    } finally {
      setUsernameBusy(false);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    // No minimum: the length of your own password is your call. Clearing it
    // entirely is done from the users screen, deliberately — it is a decision
    // about an account's exposure, not a routine password change.
    if (!newPassword) { setPasswordError('أدخل كلمة المرور الجديدة'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('كلمتا المرور غير متطابقتين'); return; }
    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success('تم تغيير كلمة المرور');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'تعذّر تغيير كلمة المرور');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <UserCog className="size-4 text-subtle" /> الحساب
      </h2>

      <form onSubmit={submitUsername} className="mt-4 space-y-3 border-b border-line pb-4">
        <p className="text-xs font-semibold text-muted">تغيير اسم المستخدم</p>
        <Field label={IS_LOCAL ? 'اسم المستخدم الحالي' : 'البريد الإلكتروني الحالي'}>
          <Input value={email ?? ''} disabled dir={IS_LOCAL ? 'auto' : 'ltr'} />
        </Field>
        <Field label={IS_LOCAL ? 'اسم المستخدم الجديد' : 'البريد الإلكتروني الجديد'}>
          <Input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            dir={IS_LOCAL ? 'auto' : 'ltr'}
            autoComplete="username"
          />
        </Field>
        <Field label="كلمة المرور الحالية" hint="للتأكيد">
          <Input
            type="password"
            value={usernamePassword}
            onChange={(e) => setUsernamePassword(e.target.value)}
            dir="ltr"
            autoComplete="current-password"
          />
        </Field>
        {usernameError && <p className="text-xs text-accent-600 dark:text-accent-400">{usernameError}</p>}
        <Button type="submit" size="sm" loading={usernameBusy} disabled={!newUsername.trim() || !usernamePassword}>
          حفظ اسم المستخدم
        </Button>
      </form>

      <form onSubmit={submitPassword} className="mt-4 space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <KeyRound className="size-3.5" /> تغيير كلمة المرور
        </p>
        <Field label="كلمة المرور الحالية">
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            dir="ltr"
            autoComplete="current-password"
          />
        </Field>
        <Field label="كلمة المرور الجديدة">
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            dir="ltr"
            autoComplete="new-password"
          />
        </Field>
        <Field label="تأكيد كلمة المرور الجديدة">
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            dir="ltr"
            autoComplete="new-password"
          />
        </Field>
        {passwordError && <p className="text-xs text-accent-600 dark:text-accent-400">{passwordError}</p>}
        <Button type="submit" size="sm" loading={passwordBusy} disabled={!newPassword}>
          حفظ كلمة المرور
        </Button>
      </form>
    </Card>
  );
}

/**
 * User administration lives on its own screen now — it outgrew a card. This
 * keeps the entry point where a manager looks for it first.
 */
function UsersLinkCard() {
  const { data } = useUsers();
  const users = data?.data ?? [];
  const managers = users.filter((u) => u.role === 'OWNER').length;

  return (
    <Card className="p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Users className="size-4 text-subtle" /> المستخدمون
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {users.length
              ? `${fmtInt(users.length)} حساب — ${fmtInt(managers)} مدير و${fmtInt(users.length - managers)} موظف`
              : 'حسابات الدخول وصلاحية كل منها'}
          </p>
        </div>
        <Link to="/users">
          <Button icon={<ArrowLeft className="size-4" />}>إدارة المستخدمين</Button>
        </Link>
      </div>
    </Card>
  );
}
