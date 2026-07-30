import { useEffect, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Package, PackagePlus, PackageMinus, ClipboardList, MoreHorizontal, Tags,
  ArrowLeftRight, TriangleAlert, FileSpreadsheet, Settings, LayoutDashboard,
  Moon, Sun, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePrefs } from '@/store/prefs';
import { useDashboard } from '@/hooks';
import { fmtInt } from '@/lib/format';

type Icon = ComponentType<{ className?: string }>;
type Dest = { label: string; icon: Icon; to: string; match?: RegExp; badge?: number };

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
  const { data: stats } = useDashboard();

  // Any navigation closes the sheet, however it was triggered.
  useEffect(() => { setMore(false); }, [location.pathname, location.search]);

  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [more]);

  const primary: Dest[] = [
    { label: 'الأصناف', icon: Package, to: '/items', match: /^\/items/ },
    { label: 'إدخال', icon: PackagePlus, to: '/invoices/new?type=STOCK_IN' },
    { label: 'إخراج', icon: PackageMinus, to: '/invoices/new?type=STOCK_OUT' },
    {
      label: 'الجرد', icon: ClipboardList, to: '/stock-counts',
      match: /^\/stock-counts/, badge: stats?.counts.open_counts,
    },
  ];

  const rest: Dest[] = [
    { label: 'لوحة المعلومات', icon: LayoutDashboard, to: '/' },
    { label: 'حركات المخزون', icon: ArrowLeftRight, to: '/movements' },
    { label: 'التصنيفات', icon: Tags, to: '/categories' },
    { label: 'نواقص المخزون', icon: TriangleAlert, to: '/reports/low-stock', badge: stats?.low_stock_count },
    { label: 'استيراد Excel', icon: FileSpreadsheet, to: '/import' },
    { label: 'الإعدادات', icon: Settings, to: '/settings' },
  ];

  const isActive = (d: Dest) => (d.match ? d.match.test(location.pathname) : false);

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-40 sm:hidden">
          <div
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
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

            {rest.map((d) => (
              <button
                key={d.to}
                type="button"
                onClick={() => navigate(d.to)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition active:bg-brand-500/10"
              >
                <d.icon className="size-5 shrink-0 text-brand-600 dark:text-brand-300" />
                <span className="flex-1 text-sm font-medium">{d.label}</span>
                {!!d.badge && (
                  <span className="nums rounded-full bg-rose-500 px-2 text-[11px] font-bold leading-5 text-white">
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
          </div>
        </div>
      )}

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
              'relative flex flex-1 flex-col items-center gap-0.5 py-2 transition active:bg-brand-500/10',
              isActive(d) ? 'text-brand-600 dark:text-brand-300' : 'text-muted',
            )}
          >
            <span className="relative">
              <d.icon className="size-[1.35rem]" />
              {!!d.badge && (
                <span className="nums absolute -end-2 -top-1 rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-4 text-white">
                  {fmtInt(d.badge)}
                </span>
              )}
            </span>
            <span className="text-[10.5px] font-medium leading-none">{d.label}</span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className={cn(
            'flex flex-1 flex-col items-center gap-0.5 py-2 transition active:bg-brand-500/10',
            more ? 'text-brand-600 dark:text-brand-300' : 'text-muted',
          )}
        >
          <MoreHorizontal className="size-[1.35rem]" />
          <span className="text-[10.5px] font-medium leading-none">المزيد</span>
        </button>
      </nav>
    </>
  );
}
