/**
 * Authentication and tenant resolution.
 *
 * The desktop app had no auth — one machine, one user, one database file. Once
 * the same API answers over the internet that is not defensible, so every
 * request now has to arrive with a Supabase Auth access token.
 *
 * Supabase Auth is used rather than a hand-rolled login because it is free with
 * the Postgres project this app already needs, and it keeps password hashes,
 * email verification and password resets out of this codebase entirely. This
 * module never issues tokens — it only verifies them:
 *
 *   • HS256 tokens (Supabase's shared JWT secret)      → SUPABASE_JWT_SECRET
 *   • asymmetric tokens (Supabase's newer signing keys) → JWKS from SUPABASE_URL
 *
 * The verified `sub` claim is then mapped to an organisation through the
 * `memberships` table. An org id is never read from the request itself.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { runInOrg } from '../db/index.js';
import { resolveOrg, DEV_USER_ID, DEV_USER_EMAIL } from './orgs.js';
import { unauthorized, unavailable } from './errors.js';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

/**
 * `AUTH_MODE=none` disables verification and puts every request in one fixed
 * organisation. It exists for local development and the test suite, and refuses
 * to start when NODE_ENV=production so it can never be the reason a hosted
 * deployment is wide open.
 */
export const AUTH_MODE = process.env.AUTH_MODE ?? 'supabase';

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
  if (AUTH_MODE === 'none' && process.env.NODE_ENV === 'production') {
    return 'AUTH_MODE=none is refused in production — configure Supabase Auth';
  }
  if (AUTH_MODE === 'supabase' && !JWT_SECRET && !SUPABASE_URL) {
    return 'Set SUPABASE_JWT_SECRET (or SUPABASE_URL for JWKS verification), '
      + 'or AUTH_MODE=none for local development';
  }
  return null;
})();

const secretKey = JWT_SECRET ? new TextEncoder().encode(JWT_SECRET) : null;
const jwks = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;

/** Verify a Supabase access token, whichever signing scheme the project uses. */
async function verifyToken(token) {
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

  runInOrg(req.auth.orgId, () => new Promise((resolve) => {
    // 'close' fires once the response has been sent, or if the client hung up.
    res.on('close', resolve);
    next();
  })).catch((err) => {
    // Route errors are handled by the error middleware; anything arriving here
    // is a failure of the context itself, and the response is already gone.
    console.error('[db] request context failed', err);
  });

  return undefined;
}
