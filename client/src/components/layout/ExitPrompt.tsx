import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LogOut, DoorOpen, Undo2 } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { api } from '@/lib/api';
import {
  AUTH_BACKEND, AUTH_ENABLED, forgetSession, rememberSession, signOut,
} from '@/lib/session';

/**
 * Is this the installed shortcut rather than a browser tab?
 *
 * Both display modes have to be tested. The manifest asks for `fullscreen`
 * with `standalone` as the fallback, so on a device that honours the first
 * choice a `standalone`-only check — which is what the old idle-logout code
 * used — never matches and the whole feature silently does nothing.
 */
function isInstalledApp() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return ['fullscreen', 'standalone', 'minimal-ui']
    .some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

/**
 * Asks what to do with the session when the operator leaves the app.
 *
 * Android gives no moment to intervene once a task is swiped out of recents —
 * the process is gone and no script runs — so there is no way to prompt at the
 * literal instant of quitting. What *is* interceptable is the Back press that
 * would leave the app, which is how a shortcut is normally exited, and that is
 * where this hooks in. Back everywhere else keeps its ordinary meaning of
 * "previous page".
 *
 * The choice is recorded in storage rather than acted on at exit time, which
 * is what makes it robust: whether the app then actually closes, or the
 * operator swipes it away a minute later, or the system reclaims it overnight,
 * the next launch behaves the way they asked.
 */
export function ExitPrompt() {
  const [open, setOpen] = useState(false);
  const armed = AUTH_ENABLED && isInstalledApp();

  const location = useLocation();

  /**
   * How many screens deep into the app the operator currently is.
   *
   * This is what separates "Back means previous page" from "Back means leave",
   * and it cannot be answered from the URL: the spare history entry sits at the
   * same address as the first screen, so *arriving* there by pressing Back
   * looks identical to *already being* there. Only the previous value tells
   * them apart, so exactly one place is allowed to change it — the popstate
   * handler below.
   */
  const depth = useRef(0);
  const seeded = useRef(false);

  /**
   * Depth is stamped onto each history entry as we visit it, rather than read
   * from the router.
   *
   * Two approaches were tried first and both failed. Counting PUSH/POP in an
   * effect drifts, because effects are asynchronous and the router has already
   * moved by the time one runs. Reading React Router's own `history.state.idx`
   * looks exact but is `null` on this hash history, so every entry reported
   * position 0 and every Back looked like a quit. A marker we write ourselves
   * is the only value that is guaranteed to be there and to travel with the
   * entry through back and forward.
   */
  const readDepth = () => {
    const state = history.state as { __invDepth?: number; __invExitGuard?: boolean } | null;
    if (state?.__invExitGuard) return 0;
    return typeof state?.__invDepth === 'number' ? state.__invDepth : null;
  };

  useEffect(() => {
    if (!seeded.current) return; // the first entry is stamped by the effect below
    // Only ever *stamps* new entries. It deliberately does not update the
    // live position on the way back, because this effect is flushed
    // synchronously by React Router's own popstate listener — which runs
    // before ours — and assigning here overwrote the "where we came from"
    // value the handler below depends on, making every Back look like a quit.
    if (readDepth() !== null) return; // already stamped; the handler owns position
    depth.current += 1;
    history.replaceState({ ...history.state, __invDepth: depth.current }, '');
  }, [location.key]);

  useEffect(() => {
    if (!armed) return undefined;

    // Stamp the entry the app opened on as the floor, then park a spare entry
    // above it so the Back press that would otherwise leave has somewhere to
    // land and we get one chance to ask.
    history.replaceState({ ...history.state, __invDepth: 0 }, '');
    history.pushState({ __invExitGuard: true }, '');
    depth.current = 0;
    seeded.current = true;

    const onPop = () => {
      // Read first: popstate listeners run synchronously, ahead of React's
      // re-render, so this still holds where the operator was standing.
      const from = depth.current;
      const to = readDepth() ?? 0;
      depth.current = to;

      if (to > 0) return; // still inside the app — ordinary previous-page Back

      // Back on the floor. Restore the spare entry so the next Back always has
      // somewhere to land instead of dropping out of the app unanswered.
      history.pushState({ __invExitGuard: true }, '');
      depth.current = 0;

      // Arriving at the first screen from somewhere deeper is just navigation.
      // It is Back pressed while *already* on the first screen that means quit.
      if (from > 0) return;
      setOpen(true);
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [armed]);

  /**
   * Best effort. `window.close()` is only honoured for script-opened windows,
   * which an installed PWA sometimes counts as and sometimes does not, so this
   * may do nothing at all — by design that is harmless, because the session
   * decision has already been written by the time it runs.
   */
  const leave = useCallback(() => {
    setOpen(false);
    setTimeout(() => window.close(), 60);
  }, []);

  const stayLoggedIn = () => {
    rememberSession();
    leave();
  };

  const logOut = async () => {
    forgetSession();
    setOpen(false);
    if (AUTH_BACKEND === 'local') api.post('/auth/logout').catch(() => {});
    await signOut();
    setTimeout(() => window.close(), 60);
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      size="sm"
      title="الخروج من التطبيق"
      description="هل تريد إبقاء تسجيل الدخول في المرة القادمة؟"
      footer={
        <>
          <Button icon={<Undo2 className="size-4" />} onClick={() => setOpen(false)}>
            البقاء في التطبيق
          </Button>
          <Button variant="danger" icon={<LogOut className="size-4" />} onClick={logOut}>
            خروج وتسجيل الخروج
          </Button>
          <Button variant="primary" icon={<DoorOpen className="size-4" />} onClick={stayLoggedIn}>
            خروج مع إبقاء الدخول
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">
        <strong className="text-ink">خروج مع إبقاء الدخول</strong> يفتح التطبيق في المرة القادمة
        دون طلب كلمة المرور.
        <br />
        <strong className="text-ink">خروج وتسجيل الخروج</strong> ينهي الجلسة، وسيُطلب منك تسجيل
        الدخول عند العودة.
      </p>
    </Modal>
  );
}
