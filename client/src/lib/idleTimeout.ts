/**
 * Idle-session-timeout configuration — sourced from build-time env vars so
 * the durations are a deployment choice, not a code change.
 */
const minutes = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 60_000 : fallback * 60_000;
};

const seconds = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1_000 : fallback * 1_000;
};

/**
 * Idle logout is OPT-IN: with no `VITE_IDLE_TIMEOUT_MINUTES` set, the app
 * never signs anyone out for sitting still.
 *
 * It used to default to 15 minutes, which is wrong for how this system is
 * actually used. The floor device is an Android home-screen shortcut that
 * spends its day locked in a pocket or face-down on a bench between counts,
 * and it was signing itself out during every one of those gaps. A warehouse
 * handset is not a shared bank terminal; the session ending should be
 * something the operator does, not something the clock does to them.
 *
 * Set the env var to re-enable it for a deployment that does want it —
 * a till in a public area, say.
 */
export const IDLE_TIMEOUT_ENABLED = Number(import.meta.env.VITE_IDLE_TIMEOUT_MINUTES) > 0;

/** Milliseconds of no mouse/keyboard/touch/scroll activity before the warning shows. */
export const IDLE_TIMEOUT_MS = minutes(import.meta.env.VITE_IDLE_TIMEOUT_MINUTES, 15);

/** Milliseconds the countdown in the warning modal runs for before logging out. */
export const IDLE_WARNING_MS = seconds(import.meta.env.VITE_IDLE_WARNING_SECONDS, 60);
