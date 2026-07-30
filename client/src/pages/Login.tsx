import { useState, type FormEvent } from 'react';
import { Boxes, KeyRound, Mail, ArrowLeft } from 'lucide-react';
import { Button, Card, Field, Input } from '@/components/ui';
import {
  signInWithPassword, signUpWithPassword, sendMagicLink,
} from '@/lib/session';

type Mode = 'password' | 'signup' | 'magic';

const MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  'Email not confirmed': 'لم يتم تأكيد البريد الإلكتروني — راجع رسالة التأكيد',
  'User already registered': 'هذا البريد مسجّل بالفعل — استخدم تسجيل الدخول',
};

const explain = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return MESSAGES[raw] ?? raw;
};

/**
 * Sign-in screen. Email + password by default, with a magic link as the
 * alternative for users who would rather not keep another password.
 */
export default function Login() {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'magic') {
        await sendMagicLink(email.trim());
        setNotice('أرسلنا رابط الدخول إلى بريدك الإلكتروني. الرابط صالح لمدة قصيرة.');
      } else if (mode === 'signup') {
        const { needsConfirmation } = await signUpWithPassword(email.trim(), password);
        setNotice(needsConfirmation
          ? 'تم إنشاء الحساب — أكّد بريدك الإلكتروني من الرسالة المُرسلة ثم سجّل الدخول.'
          : 'تم إنشاء الحساب وتسجيل الدخول.');
      } else {
        await signInWithPassword(email.trim(), password);
      }
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'signup' ? 'إنشاء حساب جديد'
    : mode === 'magic' ? 'الدخول برابط بريدي' : 'تسجيل الدخول';

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-brand-500 text-white">
            <Boxes className="size-6" />
          </span>
          <h1 className="text-lg font-bold">نظام إدارة المخزون</h1>
          <p className="text-xs text-muted">سجّل الدخول للوصول إلى بيانات مؤسستك</p>
        </div>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-bold">{title}</h2>

          <form onSubmit={submit} className="space-y-4">
            <Field label="البريد الإلكتروني">
              <Input type="email" dir="ltr" required autoComplete="email" autoFocus
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>

            {mode !== 'magic' && (
              <Field label="كلمة المرور"
                hint={mode === 'signup' ? '8 أحرف على الأقل' : undefined}>
                <Input type="password" dir="ltr" required minLength={8}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}

            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            )}
            {notice && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {notice}
              </p>
            )}

            <Button type="submit" variant="primary" loading={busy} className="w-full"
              icon={mode === 'magic' ? <Mail className="size-4" /> : <KeyRound className="size-4" />}>
              {mode === 'signup' ? 'إنشاء الحساب' : mode === 'magic' ? 'إرسال الرابط' : 'دخول'}
            </Button>
          </form>

          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
            {mode !== 'password' ? (
              <button type="button" className="flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                onClick={() => { setMode('password'); setError(null); setNotice(null); }}>
                <ArrowLeft className="size-3" /> العودة إلى تسجيل الدخول
              </button>
            ) : (
              <>
                <button type="button" className="block text-brand-600 hover:underline dark:text-brand-400"
                  onClick={() => { setMode('magic'); setError(null); setNotice(null); }}>
                  الدخول برابط يُرسل إلى البريد بدلاً من كلمة المرور
                </button>
                <button type="button" className="block text-brand-600 hover:underline dark:text-brand-400"
                  onClick={() => { setMode('signup'); setError(null); setNotice(null); }}>
                  ليس لديك حساب؟ إنشاء حساب جديد
                </button>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
