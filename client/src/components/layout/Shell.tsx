import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Circle, Loader2, LogOut } from 'lucide-react';
import { Ribbon } from './Ribbon';
import { MobileNav } from './MobileNav';
import { Toaster } from '@/components/ui/Toaster';
import { usePrefs } from '@/store/prefs';
import { useDashboard, useSettings } from '@/hooks';
import { AUTH_ENABLED, useSession, signOut } from '@/lib/session';
import { fmtDateTime, fmtInt } from '@/lib/format';

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-brand-500" />
    </div>
  );
}

export function Shell() {
  const { hydrate } = usePrefs();
  const { data: settings } = useSettings();
  const { data: stats } = useDashboard();
  const location = useLocation();
  const email = useSession((s) => s.email);

  // Adopt server settings (currency, digits) once loaded.
  useEffect(() => { if (settings) hydrate(settings); }, [settings, hydrate]);

  // Scroll back to the top on navigation.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col" dir="rtl">
      {/* The ribbon needs a pointer and width; phones get the bottom nav. */}
      <div className="topnav sticky top-0 z-30 hidden shrink-0 sm:block">
        <Ribbon />
      </div>

      {/* pb-20 on phones clears the fixed bottom nav. */}
      <main className="flex-1 px-3 pb-20 pt-3 sm:px-4 sm:pb-4 sm:pt-4">
        <div className="mx-auto w-full max-w-[1700px]">
          {/* Routes are lazy, so the boundary lives here — one place rather
              than one per route. */}
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* Status bar — desktop only; the phone's bottom edge belongs to the nav */}
      <footer className="no-print sticky bottom-0 z-20 hidden h-7 shrink-0 items-center gap-4 border-t border-line bg-surface px-4 text-[11px] text-muted sm:flex">
        <span className="flex items-center gap-1.5">
          <Circle className="size-2 fill-emerald-500 text-emerald-500" />
          {email ?? 'متصل'}
        </span>
        {AUTH_ENABLED && (
          <button type="button" onClick={() => signOut()}
            className="flex items-center gap-1 hover:text-fg" title="تسجيل الخروج">
            <LogOut className="size-3" /> خروج
          </button>
        )}
        {!!stats && (
          <>
            <span className="nums">الأصناف: {fmtInt(stats.total_items)}</span>
            <span className="nums">الوحدات: {fmtInt(stats.total_units)}</span>
            {stats.low_stock_count > 0 && (
              <span className="nums text-amber-600 dark:text-amber-400">
                نواقص: {fmtInt(stats.low_stock_count)}
              </span>
            )}
          </>
        )}
        <span className="nums ms-auto">{fmtDateTime(new Date().toISOString())}</span>
      </footer>

      <MobileNav />
      <Toaster />
    </div>
  );
}
