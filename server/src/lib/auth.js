/**
 * Authentication and tenant resolution.
 *
 * The desktop app had no auth — one machine, one user, one database file. Once
 * the same API answers over the internet that is not defensible, so every
 * request now has to arrive with a verified access token. Two providers issue
 * one, chosen by `AUTH_MODE`:
 *
 *   • 'supabase' — Supabase Auth. Free with the Postgres project this app
 *     already needs, and keeps password hashes, email verification and
 *     password resets out of this codebase entirely.
 *   • 'local'    — this API issues and verifies its own HS256 tokens, backed
 *     by the `users` table (see routes/auth.routes.js). The bounded
 *     alternative for a deployment that would rather not depend on Supabase.
 *
 * This module never issues a Supabase token — it only verifies one:
 *
 *   • HS256 tokens (Supabase's shared JWT secret)      → SUPABASE_JWT_SECRET
 *   • asymmetric tokens (Supabase's newer signing keys) → JWKS from SUPABASE_URL
 *
 * Local tokens are both issued (routes/auth.routes.js) and verified (here)
 * with the same HS256 secret, AUTH_SECRET.
 *
 * Either way, the verified `sub` claim is mapped to an organisation through
 * the `memberships` table. An org id is never read from the request itself.
 */
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { runInOrg } from '../db/index.js';
import { resolveOrg, DEV_USER_ID, DEV_USER_EMAIL } from './orgs.js';
import { unauthorized, unavailable } from './errors.js';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const AUTH_SECRET = process.env.AUTH_SECRET;
const LOCAL_TOKEN_TTL = '30d';

/**
 * `AUTH_MODE=none` disables verification and puts every request in one fixed
 * organisation.
 *
 * It used to refuse to start under NODE_ENV=production, on the reasoning that a
 * hosted deployment should never be open by accident. That guard is gone
 * because this deployment runs without Supabase Auth and has nothing else
 * issuing tokens — the openness is now a decision, not an accident.
 *
 * What replaces the guard is noise: `insecure: true` on /api/v1/health and a
 * warning on every boot. Anyone who can reach the URL can read and write every
 * organisation's data, so the URL is the only thing protecting it.
 */
export const AUTH_MODE = process.env.AUTH_MODE ?? 'supabase';

/** True when the API is answering without verifying anyone. */
export const AUTH_DISABLED = AUTH_MODE === 'none';

/**
 * A misconfiguration this module cannot serve safely — recorded rather than
 * thrown at import, for the reason described in db/index.js: a throw here runs
 * before `app.listen`, so the port never opens and the platform reports it as a
 * failed health check, which is the one description that fits every possible
 * cause equally badly.
 *
 * Recording it costs nothing in safety. `authenticate` refuses *every* request
 * while this is set — including the AUTH_MODE=none path — so a deployment that
 * cannot verify a token serves no data, exactly as when it refused to boot. The
 * difference is that now it can be asked why.
 */
export const authConfigError = (() => {
  if (AUTH_MODE === 'supabase' && !JWT_SECRET && !SUPABASE_URL) {
    return 'Set SUPABASE_JWT_SECRET (or SUPABASE_URL for JWKS verification), '
      + 'or AUTH_MODE=none for local development';
  }
  if (AUTH_MODE === 'local' && !AUTH_SECRET) {
    return 'Set AUTH_SECRET (a long random string) to sign local login tokens';
  }
  return null;
})();

const secretKey = JWT_SECRET ? new TextEncoder().encode(JWT_SECRET) : null;
const jwks = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;
const localKey = AUTH_SECRET ? new TextEncoder().encode(AUTH_SECRET) : null;

/** Sign a local access token for a user who just registered or logged in. */
export async function issueLocalToken({ userId, email }) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(LOCAL_TOKEN_TTL)
    .sign(localKey);
}

/** Verify an access token against whichever provider `AUTH_MODE` selects. */
async function verifyToken(token) {
  if (AUTH_MODE === 'local') {
    const { payload } = await jwtVerify(token, localKey, { algorithms: ['HS256'] });
    return payload;
  }
  // Symmetric first: it needs no network call, and is what a project using the
  // shared JWT secret issues.
  if (secretKey) {
    try {
      const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
      return payload;
    } catch (err) {
      if (!jwks) throw err;
    }
  }
  const { payload } = await jwtVerify(token, jwks);
  return payload;
}

const bearer = (req) => {
  const header = req.get('authorization') || '';
  return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
};

/**
 * Express middleware: authenticate, resolve the organisation, and attach both to
 * the request. Route handlers and services are unchanged — they read the org
 * from the ambient context established by `orgContext` below.
 */
export async function authenticate(req, _res, next) {
  try {
    // Nothing is served while auth is unconfigured — see authConfigError.
    if (authConfigError) throw unavailable(authConfigError, 'AUTH_NOT_CONFIGURED');

    if (AUTH_MODE === 'none') {
      const { orgId, role } = await resolveOrg({ userId: DEV_USER_ID, email: DEV_USER_EMAIL });
      req.auth = { userId: DEV_USER_ID, email: DEV_USER_EMAIL, orgId, role };
      return next();
    }

    const token = bearer(req);
    if (!token) throw unauthorized('تسجيل الدخول مطلوب', 'AUTH_REQUIRED');

    let claims;
    try {
      claims = await verifyToken(token);
    } catch {
      throw unauthorized('انتهت صلاحية الجلسة — سجّل الدخول مرة أخرى', 'AUTH_INVALID');
    }
    if (!claims.sub) throw unauthorized('رمز دخول غير صالح', 'AUTH_INVALID');

    const { orgId, role } = await resolveOrg({ userId: claims.sub, email: claims.email });
    req.auth = { userId: claims.sub, email: claims.email ?? null, orgId, role };
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Run the rest of the request inside its organisation's context: one dedicated
 * connection with `app.org_id` set, which is what the RLS policies key on.
 *
 * The connection is held until the response is finished, then returned to the
 * pool with the setting cleared. Individual statements autocommit, exactly as
 * they did against SQLite; the two operations whose atomicity is a business rule
 * — invoice posting and stocktaking apply — open their own transaction.
 */
export function orgContext(req, res, next) {
  if (!req.auth?.orgId) return next(new Error('orgContext used without authenticate'));

  /*
   * The 'close' listener is attached here — synchronously, in the middleware
   * itself — and not inside the callback below. That ordering is the whole
   * point, and getting it wrong took the API down.
   *
   * `runInOrg` awaits a pooled connection and a BEGIN TRANSACTION before it
   * ever calls its callback. Attaching the listener in there left a window of
   * a few milliseconds per request in which the response could close with
   * nobody listening: a page reload, a navigation, React Query cancelling a
   * stale fetch, a phone losing signal. When that happened the promise never
   * settled, so the transaction was never committed or rolled back and its
   * pooled connection was gone for the lifetime of the process.
   *
   * With `DB_POOL_MAX` at 8, the eighth such abort takes the whole API down —
   * every later request waits forever for a connection that is never coming
   * back. Nothing is logged, and `/health` keeps answering `ok` because it
   * touches no database, so the only symptom is that everything hangs.
   *
   * Reproduced deliberately, and this is why a `res.destroyed` check inside
   * the callback is not enough: it narrows the window but does not close it.
   * 40 aborts survived that version; 200 still wedged it. Attached here, the
   * listener exists before the first `await`, so there is no window at all.
   */
  let closed = false;
  const finished = new Promise((resolve) => {
    const done = () => { closed = true; resolve(); };
    /*
     * Check first, listen second, both synchronously.
     *
     * `authenticate` runs a query of its own to resolve the organisation, so
     * by the time this middleware is reached the client may already be gone —
     * in which case 'close' has fired and a listener added now would never be
     * called. Testing the response state up front covers that; attaching the
     * listener before any `await` covers the rest. Neither alone is enough,
     * which is what the reproduction below kept proving.
     */
    if (res.destroyed || res.writableEnded || res.closed) return done();
    res.on('close', done);
    return undefined;
  });

  runInOrg(req.auth.orgId, () => {
    // Gone already: `finished` is resolved, so the transaction is opened and
    // released without running a handler for a response nobody will read.
    if (closed) return finished;
    next();
    return finished;
  }).catch((err) => {
    // Route errors are handled by the error middleware; anything arriving here
    // is a failure of the context itself, and the response is already gone.
    console.error('[db] request context failed', err);
  });

  return undefined;
}
