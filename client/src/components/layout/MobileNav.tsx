import { useEffect, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Package, PackagePlus, PackageMinus, ClipboardList, MoreHorizontal, Tags,
  ArrowLeftRight, TriangleAlert, FileSpreadsheet, Settings, LayoutDashboard,
  Moon, Sun, X, Download, FileText, Users, LogOut, DatabaseBackup,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePrefs } from '@/store/prefs';
import { useDashboard, useInstallPrompt } from '@/hooks';
import { fmtInt } from '@/lib/format';
import { toast } from '@/store/toast';
import { AUTH_ENABLED, useSession } from '@/lib/session';
import { usePermissions } from '@/lib/permissions';
import { useSignOut } from './SignOut';

type Icon = ComponentType<{ className?: string }>;
type Tone = keyof typeof TONE;
type Dest = { label: string; icon: Icon; to: string; match?: RegExp; badge?: number; tone: Tone };

/**
 * A colour per destination, so the nav is recognisable by shape *and* hue —
 * which is what makes it learnable for someone who doesn't read every label.
 * The assignments are meaningful rather than decorative: stock-in is green,
 * stock-out, low stock and stocktaking are red, settings stays neutral.
 *
 * Light mode uses the 700/800 steps and dark mode the 300s — the mid steps
 * look right but fail AA on the cream page (checked, same exercise as the
 * palette in index.css).
 */
const TONE = {
  teal: { text: 'text-brand-700 dark:text-brand-300', bg: 'bg-brand-500/12' },
  blue: { text: 'text-sky-700 dark:text-sky-300', bg: 'bg-sky-500/12' },
  green: { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/12' },
  red: { text: 'text-accent-600 dark:text-accent-400', bg: 'bg-accent-500/12' },
  violet: { text: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-500/12' },
  lime: { text: 'text-lime-800 dark:text-lime-300', bg: 'bg-lime-500/15' },
  slate: { text: 'text-muted', bg: 'bg-surface-3' },
} as const;

/**
 * Phone navigation.
 *
 * The ribbon is a pointer-and-wide-screen idea: small targets, several rows,
 * and an auto-hide that would fight every tap. Phones get the five things this
 * system is actually for, thumb-height at the bottom, and everything else in a
 * sheet — so the primary actions are always one tap away.
 */
export function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [more, setMore] = useState(false);
  const { theme, toggleTheme } = usePrefs();
  const { canImport, canManageUsers, canSeeDashboard, canSeeFullNav } = usePermissions();
  const { data: stats } = useDashboard(canSeeDashboard);
  const { canInstall, promptInstall } = useInstallPrompt();
  const email = useSession((s) => s.email);
  const { askToSignOut, dialog: signOutDialog } = useSignOut();

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') toast.success('تم تثبيت التطبيق');
  };

  // Any navigation closes the sheet, however it was triggered.
  useEffect(() => { setMore(false); }, [location.pathname, location.search]);

  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [more]);

  /*
   * A clerk's whole system is two destinations, so its bar is those two and
   * nothing else — no home (it has no dashboard), no inbound. Everyone else
   * keeps the full four.
   *
   * `canSeeFullNav`, not `isClerk`: the latter is false while the role is
   * still loading, which would show the full four-item bar to a clerk for an
   * instant on every reload before collapsing to two the moment `/me`
   * answers. `canSeeFullNav` is false in that same instant, so a clerk (and
   * everyone else, briefly) starts on the small bar and it only ever grows,
   * never shrinks out from under a tap.
   */
  const primary: Dest[] = canSeeFullNav ? [
    { label: 'الرئيسية', icon: LayoutDashboard, to: '/', match: /^\/$/, tone: 'teal' },
    { label: 'الأصناف', icon: Package, to: '/items', match: /^\/items/, tone: 'blue' },
    { label: 'إدخال', icon: PackagePlus, to: '/invoices/new?type=STOCK_IN', tone: 'green' },
    { label: 'إخراج', icon: PackageMinus, to: '/invoices/new?type=STOCK_OUT', tone: 'red' },
  ] : [
    { label: 'إخراج', icon: PackageMinus, to: '/invoices/new?type=STOCK_OUT', tone: 'red' },
    { label: 'الأصناف', icon: Package, to: '/items', match: /^\/items/, tone: 'blue' },
  ];

  // Everything in the "more" sheet is off-limits to a clerk; the sheet itself
  // is not rendered for it (see `more` below).
  const rest: Dest[] = canSeeFullNav ? [
    { label: 'الفواتير', icon: FileText, to: '/invoices', tone: 'violet' },
    {
      label: 'الجرد', icon: ClipboardList, to: '/stock-counts',
      badge: stats?.counts.open_counts, tone: 'red',
    },
    { label: 'حركات المخزون', icon: ArrowLeftRight, to: '/movements', tone: 'blue' },
    { label: 'التصنيفات', icon: Tags, to: '/categories', tone: 'lime' },
    { label: 'نواقص المخزون', icon: TriangleAlert, to: '/reports/low-stock', badge: stats?.low_stock_count, tone: 'red' },
    // Manager-only, same as the ribbon's data group — the import template
    // carries the price columns.
    ...(canImport
      ? [{ label: 'استيراد Excel', icon: FileSpreadsheet, to: '/import', tone: 'green' } as Dest]
      : []),
    ...(canManageUsers
      ? [
        { label: 'المستخدمون', icon: Users, to: '/users', tone: 'blue' } as Dest,
        { label: 'النسخ الاحتياطي', icon: DatabaseBackup, to: '/backup', tone: 'violet' } as Dest,
      ]
      : []),
    { label: 'الإعدادات', icon: Settings, to: '/settings', tone: 'slate' },
  ] : [];

  const isActive = (d: Dest) => (d.match ? d.match.test(location.pathname) : false);

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-40 sm:hidden">
          <div
            className="absolute inset-0 bg-[#1c1f1d]/45 backdrop-blur-[2px] animate-fade-in"
            onClick={() => setMore(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="المزيد"
            className="card animate-rise absolute inset-x-2 bottom-[4.75rem] max-h-[70vh] overflow-y-auto p-2"
          >
            <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
              <span className="text-sm font-bold">المزيد</span>
              <button
                type="button"
                onClick={() => setMore(false)}
                aria-label="إغلاق"
                className="rounded-lg p-1.5 text-subtle transition hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            {canInstall && (
              <button
                type="button"
                onClick={install}
                className="flex w-full items-center gap-3 rounded-xl bg-brand-500/10 px-3 py-3 text-start transition active:bg-brand-500/20"
              >
                <Download className="size-5 shrink-0 text-brand-600 dark:text-brand-300" />
                <span className="flex-1 text-sm font-medium text-brand-600 dark:text-brand-300">
                  تثبيت التطبيق على الجهاز
                </span>
              </button>
            )}

            {rest.map((d) => (
              <button
                key={d.to}
                type="button"
                onClick={() => navigate(d.to)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition active:bg-surface-2"
              >
                <span className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-xl',
                  TONE[d.tone].bg, TONE[d.tone].text,
                )}>
                  <d.icon className="size-5" />
                </span>
                <span className="flex-1 text-sm font-medium">{d.label}</span>
                {!!d.badge && (
                  <span className="nums rounded-full bg-accent-600 px-2 text-[11px] font-bold leading-5 text-white">
                    {fmtInt(d.badge)}
                  </span>
                )}
              </button>
            ))}

            <button
              type="button"
              onClick={toggleTheme}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition active:bg-brand-500/10"
            >
              {theme === 'dark'
                ? <Sun className="size-5 shrink-0 text-brand-600 dark:text-brand-300" />
                : <Moon className="size-5 shrink-0 text-brand-600 dark:text-brand-300" />}
              <span className="flex-1 text-sm font-medium">
                {theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
              </span>
            </button>

            {AUTH_ENABLED && (
              <>
                <span aria-hidden className="my-1.5 block h-px bg-line" />
                {email && (
                  <p className="truncate px-3 pb-1 text-[11px] text-subtle">
                    مسجّل الدخول بحساب <span className="font-medium text-muted">{email}</span>
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => { setMore(false); askToSignOut(); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start text-accent-600 transition active:bg-accent-500/10 dark:text-accent-400"
                >
                  <LogOut className="size-5 shrink-0" />
                  <span className="flex-1 text-sm font-medium">تسجيل الخروج</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {signOutDialog}

      <nav
        aria-label="التنقّل"
        className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {primary.map((d) => (
          <button
            key={d.to}
            type="button"
            onClick={() => navigate(d.to)}
            aria-current={isActive(d) ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-1 py-1.5 transition',
              isActive(d) ? TONE[d.tone].text : 'text-muted',
            )}
          >
            {/* The icon keeps its own colour whether or not it's the current
                page — that's what makes the bar readable at a glance. The
                pill behind it, not the colour, is what marks "you are here". */}
            <span className={cn(
              'relative grid h-7 w-12 place-items-center rounded-full transition-colors',
              isActive(d) ? TONE[d.tone].bg : 'bg-transparent',
            )}>
              <d.icon className={cn('size-[1.3rem]', !isActive(d) && TONE[d.tone].text)} />
              {!!d.badge && (
                <span className="nums absolute -end-1 -top-0.5 rounded-full bg-accent-600 px-1 text-[9px] font-bold leading-4 text-white">
                  {fmtInt(d.badge)}
                </span>
              )}
            </span>
            <span className="text-[11px] font-medium leading-none">{d.label}</span>
          </button>
        ))}

        {/* Kept for every role, including a clerk: `rest` is the only thing
            that shrinks to nothing for it. The install prompt, the theme
            toggle and sign-out inside this sheet are not navigation — they
            apply regardless of role, and a clerk that cannot reach the
            install button is also a clerk whose shortcut never becomes a
            true installed app, which is what the exit-confirmation dialog
            (ExitPrompt) needs to arm itself and offer "stay signed in". */}
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className={cn(
            'flex flex-1 flex-col items-center gap-1 py-1.5 transition',
            more ? 'text-ink' : 'text-muted',
          )}
        >
          <span className={cn(
            'grid h-7 w-12 place-items-center rounded-full transition-colors',
            more ? 'bg-surface-3' : 'bg-transparent',
          )}>
            <MoreHorizontal className="size-[1.3rem]" />
          </span>
          <span className="text-[11px] font-medium leading-none">المزيد</span>
        </button>
      </nav>
    </>
  );
}
