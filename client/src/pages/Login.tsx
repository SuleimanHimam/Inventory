import { useState, type FormEvent } from 'react';
import {
  Boxes, KeyRound, Mail, ArrowLeft, Eye, EyeOff, Sun, Moon,
  PackageSearch, FileText, TrendingUp, ShieldCheck,
} from 'lucide-react';
import { Button, Card, Field, Input } from '@/components/ui';
import {
  signInWithPassword, sendMagicLink, sendPasswordReset, AUTH_BACKEND,
} from '@/lib/session';

/** Local accounts have no email delivery behind them — hide what needs one. */
const HAS_EMAIL_DELIVERY = AUTH_BACKEND !== 'local';
/** Local accounts log in with a plain username, not a verified email address. */
const IS_LOCAL = AUTH_BACKEND === 'local';
import { usePrefs } from '@/store/prefs';
import { cn } from '@/lib/cn';

type Mode = 'password' | 'magic' | 'reset';

const MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  'Email not confirmed': 'لم يتم تأكيد البريد الإلكتروني — راجع رسالة التأكيد',
  'User already registered': 'هذا البريد مسجّل بالفعل — استخدم تسجيل الدخول',
};

const explain = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return MESSAGES[raw] ?? raw;
};

const FEATURES = [
  { icon: PackageSearch, text: 'تتبّع الأصناف والمخزون لحظة بلحظة' },
  { icon: FileText, text: 'فواتير دخول وإخراج منظّمة وقابلة للتتبع' },
  { icon: TrendingUp, text: 'تقارير نواقص وحركات مخزون فورية' },
];

/**
 * Sign-in screen. Email + password by default, with a magic link and a
 * password-reset flow as alternatives. The branding panel only shows from
 * `lg:` up — on phone (the primary surface for this app) every pixel goes
 * to the form itself.
 */
export default function Login() {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { theme, toggleTheme } = usePrefs();

  const resetMessages = () => { setError(null); setNotice(null); };
  const switchMode = (next: Mode) => { setMode(next); resetMessages(); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    resetMessages();
    try {
      if (mode === 'magic') {
        await sendMagicLink(email.trim());
        setNotice('أرسلنا رابط الدخول إلى بريدك الإلكتروني. الرابط صالح لمدة قصيرة.');
      } else if (mode === 'reset') {
        await sendPasswordReset(email.trim());
        setNotice('أرسلنا رابطاً لإعادة تعيين كلمة المرور إلى بريدك الإلكتروني.');
      } else {
        await signInWithPassword(email.trim(), password);
      }
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'magic' ? 'الدخول برابط بريدي'
    : mode === 'reset' ? 'إعادة تعيين كلمة المرور'
      : 'تسجيل الدخول';

  const submitLabel = mode === 'magic' ? 'إرسال الرابط'
    : mode === 'reset' ? 'إرسال رابط إعادة التعيين'
      : 'دخول';

  const submitIcon = mode === 'magic' || mode === 'reset'
    ? <Mail className="size-4" />
    : <KeyRound className="size-4" />;

  const needsPassword = mode === 'password';

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-page px-4 py-8 sm:px-6 lg:p-6">
      {/* Ambient brand-colour glow — decorative only, clipped by the parent's overflow-hidden. */}
      <div className="pointer-events-none absolute -top-24 -end-24 size-96 rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -start-24 size-96 rounded-full bg-brand-400/15 blur-3xl" aria-hidden />

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
        className="absolute end-4 top-4 z-10 grid size-9 place-items-center rounded-full border border-line bg-surface/80 text-muted backdrop-blur transition hover:text-ink"
      >
        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>

      <div className="animate-rise relative z-0 grid w-full max-w-4xl overflow-hidden rounded-[1.75rem] lg:grid-cols-2 lg:shadow-2xl lg:shadow-brand-900/10">
        {/* Branding panel — desktop/tablet only. */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 to-brand-800 p-9 text-white lg:flex">
          <div className="pointer-events-none absolute -end-16 -top-16 size-64 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-20 -start-10 size-72 rounded-full bg-black/10 blur-2xl" aria-hidden />

          <div className="relative">
            <span className="grid size-12 place-items-center rounded-xl bg-white/15 backdrop-blur">
              <Boxes className="size-6" />
            </span>
            <h1 className="mt-5 text-2xl font-bold leading-tight">نظام إدارة المخزون</h1>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/80">
              كل ما يخص أصنافك وفواتيرك وحركات مخزونك، في مكان واحد منظّم.
            </p>
          </div>

          <ul className="relative space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>

          <div className="relative flex items-center gap-2 text-xs text-white/70">
            <ShieldCheck className="size-4 shrink-0" />
            الدخول محمي — بياناتك مقتصرة على مؤسستك فقط
          </div>
        </div>

        {/* Form panel. */}
        <Card className="flex flex-col justify-center rounded-[1.75rem] p-6 lg:rounded-none lg:border-0 lg:p-10">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-7 flex flex-col items-center gap-2 text-center lg:hidden">
              <span className="grid size-12 place-items-center rounded-xl bg-brand-500 text-white">
                <Boxes className="size-6" />
              </span>
              <h1 className="text-lg font-bold">نظام إدارة المخزون</h1>
              <p className="text-xs text-muted">سجّل الدخول للوصول إلى بيانات مؤسستك</p>
            </div>

            <h2 className="mb-5 text-base font-bold">{title}</h2>

            <form onSubmit={submit} className="space-y-4">
              <Field label={IS_LOCAL ? 'اسم المستخدم' : 'البريد الإلكتروني'}>
                <Input type={IS_LOCAL ? 'text' : 'email'} dir={IS_LOCAL ? 'auto' : 'ltr'} required
                  autoComplete={IS_LOCAL ? 'username' : 'email'} autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>

              {needsPassword && (
                <Field label="كلمة المرور" hint="اتركها فارغة إذا كان حسابك بلا كلمة مرور">
                  <div className="relative">
                    {/* Neither `required` nor `minLength`: an account may have
                        no password at all, and a length rule here could only
                        ever reject a correct one. The server decides. */}
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      autoComplete="current-password"
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      className="pe-9 text-right"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      /* Aligned to the value's line, not the box's centre: the
                         field reserves extra block-start padding for the
                         floating label, so its midpoint sits above the text. */
                      className="absolute end-2.5 top-[1.925rem] -translate-y-1/2 rounded p-0.5 text-subtle transition hover:bg-surface-2 hover:text-ink"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>
              )}

              {mode === 'password' && HAS_EMAIL_DELIVERY && (
                <div className="flex justify-end -mt-1.5">
                  <button type="button"
                    className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    onClick={() => switchMode('reset')}>
                    نسيت كلمة المرور؟
                  </button>
                </div>
              )}

              {error && (
                <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:bg-accent-950/40 dark:text-accent-300">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {notice}
                </p>
              )}

              <Button type="submit" variant="primary" size="lg" loading={busy}
                className={cn('w-full', busy && 'opacity-90')}
                icon={submitIcon}>
                {submitLabel}
              </Button>
            </form>

            {HAS_EMAIL_DELIVERY && (
              <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs">
                {mode !== 'password' ? (
                  <button type="button" className="flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                    onClick={() => switchMode('password')}>
                    <ArrowLeft className="size-3" /> العودة إلى تسجيل الدخول
                  </button>
                ) : (
                  <button type="button" className="block text-brand-600 hover:underline dark:text-brand-400"
                    onClick={() => switchMode('magic')}>
                    الدخول برابط يُرسل إلى البريد بدلاً من كلمة المرور
                  </button>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
