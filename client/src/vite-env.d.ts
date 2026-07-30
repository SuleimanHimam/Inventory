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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
