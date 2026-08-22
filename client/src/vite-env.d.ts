/// <reference types="vite/client" />

/**
 * Build-time configuration. All of it is inlined into the bundle and therefore
 * public — the Supabase anon key is designed to be, and nothing else here is a
 * secret. Service-role keys belong to the API only.
 */
interface ImportMetaEnv {
  /** Origin of the API, without a trailing slash. Unset in dev → Vite proxy. */
  readonly VITE_API_URL?: string;
  /** Supabase project URL. Unset → no login screen (development mode). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /**
   * 'local' switches the login screen to this API's own email + password
   * accounts (server AUTH_MODE=local) instead of Supabase. Any other value,
   * or unset, keeps the Supabase path above.
   */
  readonly VITE_AUTH_MODE?: string;
  /** Minutes of inactivity before the idle-logout warning shows. Default 15. */
  readonly VITE_IDLE_TIMEOUT_MINUTES?: string;
  /** Seconds the idle-logout warning's countdown runs before signing out. Default 60. */
  readonly VITE_IDLE_WARNING_SECONDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
