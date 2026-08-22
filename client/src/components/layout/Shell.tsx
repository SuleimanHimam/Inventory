import { Suspense, useCallback, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Circle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Ribbon } from './Ribbon';
import { MobileNav } from './MobileNav';
import { usePrefs } from '@/store/prefs';
import { usePermissions } from '@/lib/permissions';
import { useDashboard, useSettings } from '@/hooks';
import { AUTH_BACKEND, AUTH_ENABLED, signOut, useSession } from '@/lib/session';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { useIdleTimer } from '@/hooks/useIdleTimer';
import { IDLE_TIMEOUT_ENABLED } from '@/lib/idleTimeout';
import { ExitPrompt } from '@/components/layout/ExitPrompt';
import { IdleWarningModal } from '@/components/IdleWarningModal';
import { toast } from '@/store/toast';
import { api } from '@/lib/api';

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-brand-500" />
    </div>
  );
}

export function Shell() {
  const { hydrate } = usePrefs();
  const { canSeeDashboard } = usePermissions();
  const { data: settings } = useSettings();
  const { data: stats } = useDashboard(canSeeDashboard);
  const location = useLocation();
  const email = useSession((s) => s.email);
  const { t } = useTranslation();

  // Adopt server settings (currency, digits) once loaded.
  useEffect(() => { if (settings) hydrate(settings); }, [settings, hydrate]);

  // Scroll back to the top on navigation.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

  /*
   * Publish the sticky header's height as `--topnav-h`.
   *
   * Screens that stick something of their own below it — the items filter bar —
   * need to clear it, and the height is not a constant that can be hardcoded:
   * the ribbon collapses, and the whole bar is hidden below the `sm` breakpoint
   * (where a hidden element measures 0, which is the right answer). Measured
   * rather than assumed, so it stays correct through rotation and collapsing.
   */
  const topnavRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = topnavRef.current;
    if (!el) return undefined;
    const publish = () => document.documentElement.style
      .setProperty('--topnav-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener('orientationchange', publish);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', publish); };
  }, []);

  const handleIdleTimeout = useCallback(async () => {
    // Pushed before signOut() flips the app back to the Login screen and
    // unmounts this tree (Toaster included) — see main App shell.
    toast.warning(t('idle.loggedOutTitle'), t('idle.loggedOutMessage'));
    // Local-auth only: the endpoint lives under AUTH_MODE=local's router and
    // 503s otherwise, and under Supabase, signOut() below already calls the
    // SDK's own server-side sign-out. Best-effort either way — a stateless
    // JWT is already inert once discarded client-side (see auth.routes.js).
    if (AUTH_BACKEND === 'local') api.post('/auth/logout').catch(() => {});
    await signOut();
  }, [t]);

  // Off unless a deployment explicitly asks for it — see idleTimeout.ts.
  const { warning, secondsLeft, stayLoggedIn } =
    useIdleTimer(AUTH_ENABLED && IDLE_TIMEOUT_ENABLED, handleIdleTimeout);

  return (
    <div className="flex min-h-dvh flex-col" dir="rtl">
      {/* The ribbon needs a pointer and width; phones get the bottom nav. */}
      <div ref={topnavRef} className="topnav sticky top-0 z-30 hidden shrink-0 sm:block">
        <Ribbon />
      </div>

      {/* pb-20 on phones clears the fixed bottom nav. */}
      <main className="flex-1 px-3 pb-20 pt-3 sm:px-4 sm:pb-4 sm:pt-4">
        <div className="mx-auto w-full max-w-[1700px]">
          {/* Routes are lazy, so the boundary lives here — one place rather
              than one per route.

              `key` on the animated wrapper is what makes the entrance replay
              per navigation: without it React reuses the element and the
              animation only ever runs once, on first mount. */}
          <Suspense fallback={<PageLoader />}>
            <div key={location.pathname} className="page-enter">
              <Outlet />
            </div>
          </Suspense>
        </div>
      </main>

      {/* Status bar — desktop only; the phone's bottom edge belongs to the nav */}
      <footer className="no-print sticky bottom-0 z-20 hidden h-7 shrink-0 items-center gap-4 border-t border-line bg-surface px-4 text-[11px] text-muted sm:flex">
        <span className="flex items-center gap-1.5">
          <Circle className="size-2 fill-emerald-500 text-emerald-500" />
          {email ?? 'متصل'}
        </span>
        {!!stats && (
          <>
            <span className="nums">الأصناف: {fmtInt(stats.total_items)}</span>
            <span className="nums">الوحدات: {fmtInt(stats.total_units)}</span>
            {stats.low_stock_count > 0 && (
              <span className="nums text-accent-600 dark:text-accent-400">
                نواقص: {fmtInt(stats.low_stock_count)}
              </span>
            )}
          </>
        )}
        <span className="nums ms-auto">{fmtDateTime(new Date().toISOString())}</span>
      </footer>

      <MobileNav />
      <IdleWarningModal open={warning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />
      <ExitPrompt />
    </div>
  );
}
