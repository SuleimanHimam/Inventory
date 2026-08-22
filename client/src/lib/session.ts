/**
 * Sign-in session — one of two backends, chosen at build time.
 *
 *  • 'supabase' — Supabase Auth. The frontend talks to it directly; the API
 *    only ever sees the resulting access token, never a password.
 *  • 'local'    — this API's own email + password accounts
 *    (server `AUTH_MODE=local`). The frontend calls `/api/v1/auth/*` and
 *    holds the resulting token itself; there is no third party involved.
 *
 * Neither configured → open development mode: no login screen, no token.
 * That is the counterpart of the server's `AUTH_MODE=none`.
 */
import { createClient } from '@supabase/supabase-js';
import { create } from 'zustand';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const AUTH_BACKEND: 'supabase' | 'local' | null =
  import.meta.env.VITE_AUTH_MODE === 'local'
    ? 'local'
    : (supabaseUrl && supabaseAnonKey) ? 'supabase' : null;

export const AUTH_ENABLED = AUTH_BACKEND !== null;

export const supabase = AUTH_BACKEND === 'supabase'
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : null;

// Duplicated from api.ts's API_BASE rather than imported: api.ts already
// imports getAccessToken/onUnauthorized from this module, and a two-way
// import cycle is worth two lines to avoid.
const API_BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api/v1`;
const LOCAL_TOKEN_KEY = 'inv.local_token';
const LOCAL_EMAIL_KEY = 'inv.local_email';

/** The `exp` claim (ms since epoch) of a JWT, read without verifying it — the API does that. */
function tokenExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** The stored local session, or null if there isn't one or it has expired. */
function storedLocalSession(): { token: string; email: string } | null {
  const token = sessionStorage.getItem(LOCAL_TOKEN_KEY);
  const email = sessionStorage.getItem(LOCAL_EMAIL_KEY);
  if (!token || !email) return null;
  const expiry = tokenExpiryMs(token);
  if (expiry && expiry < Date.now()) return null;
  return { token, email };
}

function persistLocalSession(token: string, email: string) {
  sessionStorage.setItem(LOCAL_TOKEN_KEY, token);
  sessionStorage.setItem(LOCAL_EMAIL_KEY, email);
  useSession.getState().setSession({ email });
}

function clearLocalSession() {
  sessionStorage.removeItem(LOCAL_TOKEN_KEY);
  sessionStorage.removeItem(LOCAL_EMAIL_KEY);
  forgetSession();
}

/*
 * "Keep me signed in" — the opt-in that survives the app being closed.
 *
 * The live session lives in sessionStorage, which dies with the process; that
 * is what makes killing the app from Android's recents mean "signed out". A
 * copy is only written to localStorage when the operator explicitly asks for
 * it on the way out (see ExitPrompt), and it is the one thing that outlives a
 * cold start.
 *
 * So the rule the app actually implements is: closing the app signs you out,
 * unless you said otherwise as you closed it. Pressing تسجيل الخروج clears
 * both copies, so an explicit sign-out always wins over a remembered one.
 */
const REMEMBER_TOKEN_KEY = 'inv.remember_token';
const REMEMBER_EMAIL_KEY = 'inv.remember_email';

/*
 * Storage access can throw outright rather than return null — a sandboxed
 * iframe, or Chrome with third-party cookies and site data blocked, raises
 * SecurityError on the property itself. Every access here is guarded because
 * the adopt step below runs at module load: an uncaught throw there takes the
 * bundle down before React mounts, turning a recoverable "please log in" into
 * a white screen.
 */
function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function rememberSession() {
  const current = storedLocalSession();
  if (!current) return;
  safely(() => {
    localStorage.setItem(REMEMBER_TOKEN_KEY, current.token);
    localStorage.setItem(REMEMBER_EMAIL_KEY, current.email);
  }, undefined);
}

export function forgetSession() {
  safely(() => {
    localStorage.removeItem(REMEMBER_TOKEN_KEY);
    localStorage.removeItem(REMEMBER_EMAIL_KEY);
  }, undefined);
}

/** Whether the next cold start would restore a session rather than ask to log in. */
export function isSessionRemembered() {
  return safely(() => !!localStorage.getItem(REMEMBER_TOKEN_KEY), false);
}

/*
 * Runs before `localInitial` below reads the session, so a cold start that
 * finds a remembered token comes up already signed in. An expired one is
 * dropped rather than adopted — the API would reject it and bounce straight
 * back to the login screen.
 */
safely(() => {
  if (typeof window === 'undefined' || sessionStorage.getItem(LOCAL_TOKEN_KEY)) return;
  const token = localStorage.getItem(REMEMBER_TOKEN_KEY);
  const email = localStorage.getItem(REMEMBER_EMAIL_KEY);
  const expiry = token ? tokenExpiryMs(token) : null;
  if (token && email && !(expiry && expiry < Date.now())) {
    sessionStorage.setItem(LOCAL_TOKEN_KEY, token);
    sessionStorage.setItem(LOCAL_EMAIL_KEY, email);
  } else if (token) {
    forgetSession();
  }
}, undefined);

async function localRequest(path: string, body: unknown): Promise<{ token: string; email: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'حدث خطأ غير متوقع');
  return payload;
}

/** Same as `localRequest`, but for the routes behind `authenticate` — change-password/-username. */
async function localAuthedRequest<T = { token: string; email: string }>(path: string, body: unknown): Promise<T> {
  const token = storedLocalSession()?.token;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'حدث خطأ غير متوقع');
  return payload;
}

/** The bearer token for the next API call. */
export async function getAccessToken(): Promise<string | null> {
  if (AUTH_BACKEND === 'local') return storedLocalSession()?.token ?? null;
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

type Status = 'loading' | 'signedIn' | 'signedOut';

type SessionState = {
  status: Status;
  email: string | null;
  setSession: (session: { email: string | null } | null) => void;
};

const localInitial = AUTH_BACKEND === 'local' ? storedLocalSession() : null;

export const useSession = create<SessionState>((set) => ({
  status: AUTH_BACKEND === 'local'
    ? (localInitial ? 'signedIn' : 'signedOut')
    // Supabase's session lives in IndexedDB and is read back asynchronously,
    // so the app starts in 'loading' until the first getSession() resolves.
    : AUTH_ENABLED ? 'loading' : 'signedIn',
  email: localInitial?.email ?? null,
  setSession: (session) => set({
    status: session ? 'signedIn' : 'signedOut',
    email: session?.email ?? null,
  }),
}));

if (supabase) {
  supabase.auth.getSession().then(({ data }) =>
    useSession.getState().setSession(data.session ? { email: data.session.user?.email ?? null } : null));
  // Fires on sign-in, sign-out, token refresh and the magic-link callback.
  supabase.auth.onAuthStateChange((_event, session) => {
    useSession.getState().setSession(session ? { email: session.user?.email ?? null } : null);
  });
}

/** Called by the API client when the server rejects the token. */
export function onUnauthorized() {
  if (AUTH_BACKEND === 'local') {
    clearLocalSession();
    useSession.getState().setSession(null);
    return;
  }
  if (!supabase) return;
  useSession.getState().setSession(null);
  supabase.auth.signOut().catch(() => {});
}

export const signInWithPassword = async (email: string, password: string) => {
  if (AUTH_BACKEND === 'local') {
    const session = await localRequest('/auth/login', { email, password });
    persistLocalSession(session.token, session.email);
    return;
  }
  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) throw error;
};

export const signUpWithPassword = async (email: string, password: string) => {
  if (AUTH_BACKEND === 'local') {
    const session = await localRequest('/auth/register', { email, password });
    persistLocalSession(session.token, session.email);
    // No email step for a local account — signing up signs you in.
    return { needsConfirmation: false };
  }
  const { data, error } = await supabase!.auth.signUp({ email, password });
  if (error) throw error;
  // With email confirmation switched on, Supabase returns a user but no session.
  return { needsConfirmation: !data.session };
};

/** Supabase only — the Login screen hides this option under local auth. */
export const sendMagicLink = async (email: string) => {
  if (AUTH_BACKEND === 'local') throw new Error('الدخول برابط غير متاح في هذا الإعداد');
  const { error } = await supabase!.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
};

/** Supabase only — local accounts have no email delivery to reset through. */
export const sendPasswordReset = async (email: string) => {
  if (AUTH_BACKEND === 'local') {
    throw new Error('إعادة التعيين التلقائية غير متاحة هنا — تواصل مع مسؤول النظام');
  }
  const { error } = await supabase!.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
};

export const changePassword = async (currentPassword: string, newPassword: string) => {
  if (AUTH_BACKEND === 'local') {
    await localAuthedRequest('/auth/change-password', {
      current_password: currentPassword, new_password: newPassword,
    });
    return;
  }
  const { error } = await supabase!.auth.updateUser({ password: newPassword });
  if (error) throw error;
};

/** Local: takes effect immediately. Supabase: `updateUser` sends a confirmation link first. */
export const changeUsername = async (newUsername: string, currentPassword: string) => {
  if (AUTH_BACKEND === 'local') {
    const session = await localAuthedRequest('/auth/change-username', {
      new_username: newUsername, current_password: currentPassword,
    });
    persistLocalSession(session.token, session.email);
    return;
  }
  const { error } = await supabase!.auth.updateUser({ email: newUsername });
  if (error) throw error;
};

export const signOut = async () => {
  if (AUTH_BACKEND === 'local') {
    clearLocalSession();
    useSession.getState().setSession(null);
    return;
  }
  await supabase?.auth.signOut();
  useSession.getState().setSession(null);
};

/*
 * There is deliberately no time-based sign-out here.
 *
 * The session ends in exactly two ways, and both are already handled above:
 *
 *   1. The operator presses تسجيل الخروج — `signOut()` clears the token.
 *   2. The app's process is destroyed (swiped out of Android's recents, or
 *      reclaimed for memory) — `sessionStorage` dies with the process, so the
 *      next launch starts signed out with no code needed to make it happen.
 *
 * Backgrounding is not either of those. An Android home-screen shortcut keeps
 * its task alive for hours while the handset sits in a pocket between stock
 * counts, and this file used to treat a 30-minute absence as grounds for
 * signing out on return — which meant re-logging in all day. Coming back to
 * a still-running app now resumes exactly where it left off.
 *
 * The storage choice is what encodes the rule, so it matters: `sessionStorage`
 * (not `localStorage`) is what makes "killed from RAM" mean "signed out".
 * Moving the token to localStorage would keep it across a process kill and
 * break the second guarantee.
 */
