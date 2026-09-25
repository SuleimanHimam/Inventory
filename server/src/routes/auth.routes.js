/**
 * Local email + password accounts — only meaningful under AUTH_MODE=local.
 *
 * Mounted outside the `authenticate` chain (register/login have to work
 * before there is a token to check), so this file does its own guard: every
 * handler refuses up front when the deployment is not actually running in
 * local mode, rather than quietly succeeding against the wrong provider.
 */
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { get, run, newId, runWithoutOrg, bindFile, DB_NAME } from '../db/index.js';
import { hashPassword, verifyPassword, hasNoPassword } from '../lib/password.js';
import {
  AUTH_MODE, authConfigError, issueLocalToken, authenticate, fileContext,
} from '../lib/auth.js';
import { resolveOrg } from '../lib/orgs.js';
import { listFiles, fileOr404 } from '../lib/files.js';
import { badRequest, conflict, unauthorized, unavailable, guard } from '../lib/errors.js';

const router = Router();

/**
 * Sign-in credentials.
 *
 * No minimum length, and the password may be omitted entirely: what protects
 * an account is the manager's decision, not this schema's (see
 * users.routes.js). The floor used to be 8 characters, which only ever ran at
 * *login* — where it could reject a correct password that predated the rule
 * rather than protect anything.
 */
const credentials = z.object({
  email: z.string().trim().toLowerCase().min(1, 'اسم المستخدم مطلوب').max(320),
  password: z.string().max(200).optional().default(''),
  /*
   * Which file to sign in to.
   *
   * Optional, and absent means the configured one — the shape a single-file
   * deployment (and the test suite) still sends. An account lives in exactly
   * one file, so this is not a preference the server can infer: two files may
   * each have a `manager`, and they are different people.
   */
  file_id: z.string().trim().max(128).optional(),
});

/** The file a request names, confirmed to exist. */
async function resolveFile(fileId) {
  if (!fileId || fileId === DB_NAME) return DB_NAME;
  await fileOr404(fileId);
  return fileId;
}

/** Every handler below needs AUTH_MODE=local, correctly configured. */
function requireLocalMode(_req, _res, next) {
  if (AUTH_MODE !== 'local') {
    return next(unavailable('هذا الخادم لا يستخدم تسجيل الدخول المحلي', 'AUTH_MODE_MISMATCH'));
  }
  if (authConfigError) return next(unavailable(authConfigError, 'AUTH_NOT_CONFIGURED'));
  return next();
}
router.use(requireLocalMode);

/**
 * A crude brute-force brake: five failed attempts against one email locks it
 * out for fifteen minutes. In-memory and per-process — good enough for a
 * single-instance deployment, and it costs no new dependency or table.
 */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;

function checkLockout(email) {
  const entry = attempts.get(email);
  if (entry && entry.count >= MAX_ATTEMPTS && Date.now() - entry.since < LOCKOUT_MS) {
    throw unauthorized('محاولات كثيرة فاشلة — حاول مرة أخرى بعد 15 دقيقة', 'TOO_MANY_ATTEMPTS');
  }
}
function recordFailure(email) {
  const entry = attempts.get(email);
  if (entry && Date.now() - entry.since < LOCKOUT_MS) entry.count += 1;
  else attempts.set(email, { count: 1, since: Date.now() });
}
function clearFailures(email) {
  attempts.delete(email);
}

/**
 * The files on this server, for the picker on the login screen.
 *
 * Unauthenticated by necessity — it is what the login form needs *before*
 * anyone can prove who they are. It answers with names and ids only: no
 * counts, no users, nothing about what is inside. On a LAN deployment reached
 * through a shortcut that is the right trade, but it does mean a file's name
 * is visible to anyone who can open the login page, so managers should name
 * files for recognition rather than for secrecy.
 */
router.get('/files', wrap(async (_req, res) => {
  const files = await listFiles();
  res.json({ data: files.map((f) => ({ id: f.id, name: f.name })) });
}));

router.post('/register', wrap(async (req, res) => {
  const { email, password, file_id: fileId } = parse(credentials, req.body);
  const file = await resolveFile(fileId);

  // The login page has no sign-up option — this deployment is single-admin.
  // Guarded here too, not just in the UI, so the endpoint itself refuses a
  // second account rather than relying on the button being hidden.
  // Every statement below runs inside the chosen file's database, which is
  // where that file's accounts live — `users` is per-file now, so the same
  // username may exist in another file and is none of this file's business.
  const { token } = await bindFile(file, async () => {
    const anyUser = await runWithoutOrg(() => get('SELECT id FROM users', {}));
    if (anyUser) throw unavailable('التسجيل الذاتي غير متاح — تواصل مع مسؤول النظام', 'REGISTRATION_DISABLED');

    const existing = await runWithoutOrg(() => get(
      'SELECT id FROM users WHERE lower(email) = @email', { email },
    ));
    if (existing) throw conflict('اسم المستخدم هذا مسجّل بالفعل — سجّل الدخول', 'EMAIL_TAKEN');

    const userId = newId();
    const password_hash = await hashPassword(password);
    await guard(() => runWithoutOrg(() => run(
      'INSERT INTO users (id, email, password_hash) VALUES (@id, @email, @password_hash)',
      { id: userId, email, password_hash },
    )));

    await runWithoutOrg(() => resolveOrg({ userId, email }));
    return { token: await issueLocalToken({ userId, email, file }) };
  });
  res.status(201).json({ token, email });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password, file_id: fileId } = parse(credentials, req.body);
  const file = await resolveFile(fileId);
  // Keyed by file as well as username: the same name in two files belongs to
  // two different people, and one of them failing to sign in must not lock
  // out the other.
  const lockKey = `${file}:${email}`;
  checkLockout(lockKey);

  const user = await bindFile(file, () => runWithoutOrg(() => get(
    'SELECT id, password_hash FROM users WHERE lower(email) = @email', { email },
  )));
  // Same message whether the email is unknown or the password is wrong — the
  // difference is not this API's to reveal.
  const invalid = () => unauthorized('اسم المستخدم أو كلمة المرور غير صحيحة', 'INVALID_CREDENTIALS');

  /*
   * The one place a passwordless account is allowed through.
   *
   * `verifyPassword` deliberately answers false for such an account (asking
   * "does this secret match" of an account with no secret is the wrong
   * question), so the decision is made here, explicitly, where it can be read.
   *
   * The account still has to exist and the username still has to be right —
   * the username is the whole credential. That is exactly as weak as it
   * sounds, which is why the UI says so plainly when a manager creates one.
   */
  const open = user && hasNoPassword(user.password_hash);

  if (!user || !(open || await verifyPassword(password, user.password_hash))) {
    recordFailure(lockKey);
    throw invalid();
  }
  clearFailures(lockKey);

  const token = await issueLocalToken({ userId: user.id, email, file });
  res.json({ token, email });
}));

/**
 * Local tokens are stateless HS256 JWTs with no session table behind them
 * (see auth.js's header comment), so there is nothing server-side to
 * invalidate — the client discarding the token already ends the session.
 * This endpoint exists so the frontend's idle-timeout / logout flow has a
 * single call to make regardless of backend, and so a future revocation
 * list (e.g. a blacklisted-jti table) has a place to plug in without a
 * client-side contract change.
 */
router.post('/logout', authenticate, wrap(async (_req, res) => {
  res.status(204).end();
}));

router.post('/change-username', authenticate, fileContext, wrap(async (req, res) => {
  const { new_username, current_password } = parse(z.object({
    new_username: z.string().trim().toLowerCase().min(1, 'اسم المستخدم مطلوب').max(320),
    current_password: z.string(),
  }), req.body);

  const user = await runWithoutOrg(() => get(
    'SELECT id, password_hash FROM users WHERE id = @id', { id: req.auth.userId },
  ));
  if (!user) throw badRequest('حساب محلي غير موجود لهذا المستخدم', 'NOT_LOCAL_USER');
  // Nothing to confirm against on an account that has no password — demanding
  // the "current" one would lock its owner out of ever setting one.
  if (!hasNoPassword(user.password_hash)
      && !(await verifyPassword(current_password, user.password_hash))) {
    throw unauthorized('كلمة المرور الحالية غير صحيحة', 'INVALID_CREDENTIALS');
  }

  const existing = await runWithoutOrg(() => get(
    'SELECT id FROM users WHERE lower(email) = @email AND id <> @id',
    { email: new_username, id: user.id },
  ));
  if (existing) throw conflict('اسم المستخدم هذا مستخدم بالفعل', 'EMAIL_TAKEN');

  await runWithoutOrg(() => run('UPDATE users SET email = @email WHERE id = @id',
    { email: new_username, id: user.id }));
  // Denormalised copy on the membership row — not the source of truth (the
  // row above is), but kept in sync so anything displaying it stays correct.
  await runWithoutOrg(() => run('UPDATE memberships SET email = @email WHERE user_id = @id',
    { email: new_username, id: user.id }));

  // The old token's `email` claim is now stale, so a fresh one goes out with
  // the response — the client swaps it in immediately, no re-login needed.
  const token = await issueLocalToken({ userId: user.id, email: new_username, file: req.auth.file });
  res.json({ token, email: new_username });
}));

router.post('/change-password', authenticate, fileContext, wrap(async (req, res) => {
  const { current_password, new_password } = parse(z.object({
    current_password: z.string(),
    // No floor, and an empty value removes the password entirely — the same
    // freedom the manager has in users.routes.js, for the same reason.
    new_password: z.string().max(200),
  }), req.body);

  const user = await runWithoutOrg(() => get(
    'SELECT id, password_hash FROM users WHERE id = @id', { id: req.auth.userId },
  ));
  if (!user) throw badRequest('حساب محلي غير موجود لهذا المستخدم', 'NOT_LOCAL_USER');
  // Nothing to confirm against on an account that has no password — demanding
  // the "current" one would lock its owner out of ever setting one.
  if (!hasNoPassword(user.password_hash)
      && !(await verifyPassword(current_password, user.password_hash))) {
    throw unauthorized('كلمة المرور الحالية غير صحيحة', 'INVALID_CREDENTIALS');
  }

  const password_hash = await hashPassword(new_password);
  await runWithoutOrg(() => run(
    'UPDATE users SET password_hash = @password_hash WHERE id = @id',
    { id: user.id, password_hash },
  ));
  res.status(204).end();
}));

export default router;
