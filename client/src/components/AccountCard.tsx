import { useState } from 'react';
import { UserCog, KeyRound } from 'lucide-react';
import { Button, Card, Field, Input } from '@/components/ui';
import { AUTH_BACKEND, changePassword, changeUsername } from '@/lib/session';
import { toast } from '@/store/toast';

const IS_LOCAL = AUTH_BACKEND === 'local';

/**
 * The signed-in account's own username/password controls — both confirmed with
 * the current password. Shared between the Users screen (where a manager finds
 * it alongside the team) and Settings (where a non-manager, who cannot open the
 * Users screen, still needs to change their own credentials).
 */
export function AccountCard({ email, className }: { email: string | null; className?: string }) {
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
    <Card className={className ?? 'p-5'}>
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <UserCog className="size-4 text-subtle" /> حسابي
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
