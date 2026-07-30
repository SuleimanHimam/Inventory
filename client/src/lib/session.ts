/**
 * Supabase Auth session.
 *
 * The frontend is a static bundle on Vercel, so it talks to Supabase Auth
 * directly for sign-in and only ever sends the resulting access token to our
 * API — no password, hash or refresh token ever passes through the backend.
 *
 * When `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are absent the app runs in
 * open development mode: no login screen, no token. That is the counterpart of
 * the server's `AUTH_MODE=none` and is refused there in production.
 */
import { createClient, type Session } from '@supabase/supabase-js';
import { create } from 'zustand';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const AUTH_ENABLED = !!(url && anonKey);

export const supabase = AUTH_ENABLED
  ? createClient(url!, anonKey!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : null;

/** The bearer token for the next API call, refreshed by supabase-js if stale. */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

type Status = 'loading' | 'signedIn' | 'signedOut';

type SessionState = {
  status: Status;
  email: string | null;
  setSession: (session: Session | null) => void;
};

export const useSession = create<SessionState>((set) => ({
  // With auth disabled every request is already "signed in" as the dev user.
  status: AUTH_ENABLED ? 'loading' : 'signedIn',
  email: null,
  setSession: (session) => set({
    status: session ? 'signedIn' : 'signedOut',
    email: session?.user?.email ?? null,
  }),
}));

if (supabase) {
  supabase.auth.getSession().then(({ data }) => useSession.getState().setSession(data.session));
  // Fires on sign-in, sign-out, token refresh and the magic-link callback.
  supabase.auth.onAuthStateChange((_event, session) => {
    useSession.getState().setSession(session);
  });
}

/** Called by the API client when the server rejects the token. */
export function onUnauthorized() {
  if (!supabase) return;
  useSession.getState().setSession(null);
  supabase.auth.signOut().catch(() => {});
}

export const signInWithPassword = async (email: string, password: string) => {
  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) throw error;
};

export const signUpWithPassword = async (email: string, password: string) => {
  const { data, error } = await supabase!.auth.signUp({ email, password });
  if (error) throw error;
  // With email confirmation switched on, Supabase returns a user but no session.
  return { needsConfirmation: !data.session };
};

export const sendMagicLink = async (email: string) => {
  const { error } = await supabase!.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
};

export const signOut = async () => {
  await supabase?.auth.signOut();
  useSession.getState().setSession(null);
};
