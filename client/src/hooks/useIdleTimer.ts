import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS } from '@/lib/idleTimeout';

const CHANNEL_NAME = 'inv.idle';
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
/** Local resets are throttled to this — mousemove alone would otherwise fire hundreds of times a minute. */
const RESET_THROTTLE_MS = 1000;

type Message = { type: 'activity' } | { type: 'logout' };

/**
 * Whole-app inactivity tracker. Mouse movement, keys, touches, wheel and
 * scroll count as activity; background `react-query` polling does not,
 * because a refetch never dispatches a DOM event this hook listens for.
 *
 * Synced across tabs with a BroadcastChannel: real activity in any tab
 * resets every tab's clock, so working in one tab doesn't let a second,
 * merely-open tab time out from under the user. Once the warning is showing
 * *locally*, ambient mouse movement in that tab is deliberately ignored —
 * only the modal's "stay logged in" button (or confirmed activity relayed
 * from another tab) cancels it, so the countdown can't be dismissed by a
 * stray cursor twitch while someone is reading it. When the countdown does
 * reach zero, every open tab logs out together.
 */
export function useIdleTimer(enabled: boolean, onTimeout: () => void) {
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const warnTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const logoutTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tickTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const logoutAt = useRef(0);
  const lastLocalReset = useRef(0);
  const warningRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => { warningRef.current = warning; }, [warning]);

  const clearAll = useCallback(() => {
    clearTimeout(warnTimer.current);
    clearTimeout(logoutTimer.current);
    clearInterval(tickTimer.current);
  }, []);

  const doLogout = useCallback((broadcast: boolean) => {
    clearAll();
    setWarning(false);
    if (broadcast) channelRef.current?.postMessage({ type: 'logout' } as Message);
    onTimeoutRef.current();
  }, [clearAll]);

  /** (Re)start the warn/logout timers from now — used on every confirmed activity. */
  const armTimers = useCallback(() => {
    clearAll();
    setWarning(false);
    warnTimer.current = setTimeout(() => {
      logoutAt.current = Date.now() + IDLE_WARNING_MS;
      setWarning(true);
      setSecondsLeft(Math.ceil(IDLE_WARNING_MS / 1000));
      tickTimer.current = setInterval(() => {
        setSecondsLeft(Math.max(0, Math.ceil((logoutAt.current - Date.now()) / 1000)));
      }, 1000);
      logoutTimer.current = setTimeout(() => doLogout(true), IDLE_WARNING_MS);
    }, IDLE_TIMEOUT_MS);
  }, [clearAll, doLogout]);

  useEffect(() => {
    if (!enabled) { clearAll(); setWarning(false); return undefined; }

    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;
    channelRef.current = channel;

    const onMessage = (event: MessageEvent<Message>) => {
      if (event.data.type === 'activity') armTimers();
      else if (event.data.type === 'logout') doLogout(false);
    };
    channel?.addEventListener('message', onMessage);

    const onActivity = () => {
      // A warning already showing needs a deliberate "stay logged in" click,
      // not an incidental mouse twitch, to be dismissed.
      if (warningRef.current) return;
      const now = Date.now();
      if (now - lastLocalReset.current < RESET_THROTTLE_MS) return;
      lastLocalReset.current = now;
      armTimers();
      channel?.postMessage({ type: 'activity' } as Message);
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    armTimers();

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      clearAll();
    };
  }, [enabled, armTimers, doLogout, clearAll]);

  const stayLoggedIn = useCallback(() => {
    armTimers();
    channelRef.current?.postMessage({ type: 'activity' } as Message);
  }, [armTimers]);

  return { warning, secondsLeft, stayLoggedIn };
}
