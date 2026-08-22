/**
 * User administration — manager only.
 *
 * Mounted inside the authenticated chain, so `req.auth` is resolved and
 * `requireManager` can answer from the verified membership rather than from
 * anything the client sent.
 *
 * Creating and deleting accounts needs somewhere to put a password, which only
 * exists under AUTH_MODE=local — the `users` table. Listing and role changes
 * touch `memberships` alone, so they work in any mode; only the two handlers
 * that need a password refuse elsewhere.
 *
 * `users` is global (no org_id) while `memberships` is what binds a user to an
 * organisation, so every statement here runs through `runWithoutOrg` and
 * carries its org predicate explicitly — same pattern as auth.routes.js.
 */
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse } from '../lib/http.js';
import { all, get, run, newId, runWithoutOrg } from '../db/index.js';
import { hashPassword } from '../lib/password.js';
import { AUTH_MODE } from '../lib/auth.js';
import { requireManager, MANAGER, STAFF, CLERK } from '../lib/roles.js';
import { badRequest, conflict, notFound, unavailable, guard } from '../lib/errors.js';

const router = Router();
router.use(requireManager);

const roleSchema = z.enum([MANAGER, STAFF, CLERK]);

/** Accounts with a password only exist under local auth. */
function requireLocalAccounts() {
  if (AUTH_MODE !== 'local') {
    throw unavailable(
      'إدارة الحسابات متاحة فقط عندما يكون الدخول محلياً (AUTH_MODE=local)',
      'LOCAL_ACCOUNTS_ONLY',
    );
  }
}

/**
 * An organisation must keep at least one manager, or nobody can administer it
 * again — the only recovery would be editing the database by hand. Checked
 * before any demotion or deletion, counting managers *other than* the one
 * being changed.
 */
async function assertNotLastManager(orgId, userId) {
  const { n } = await runWithoutOrg(() => get(
    `SELECT COUNT(*) n FROM memberships
      WHERE org_id = @org AND role = @role AND user_id <> @user`,
    { org: orgId, role: MANAGER, user: userId },
  ));
  if (n === 0) {
    throw badRequest('لا يمكن إزالة آخر مدير في المؤسسة', 'LAST_MANAGER');
  }
}

/** The membership being acted on, confirmed to be inside the caller's org. */
async function memberOr404(orgId, userId) {
  const row = await runWithoutOrg(() => get(
    'SELECT user_id, email, role FROM memberships WHERE org_id = @org AND user_id = @user',
    { org: orgId, user: userId },
  ));
  if (!row) throw notFound('المستخدم غير موجود في هذه المؤسسة', 'USER_NOT_FOUND');
  return row;
}

router.get('/', wrap(async (req, res) => {
  const rows = await runWithoutOrg(() => all(
    `SELECT m.user_id, m.role, m.created_at,
            COALESCE(u.email, m.email) AS email,
            CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS has_local_account,
            CASE WHEN u.password_hash IS NULL THEN 0 ELSE 1 END AS has_password
       FROM memberships m
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.org_id = @org
      ORDER BY CASE WHEN m.role = @manager THEN 0 ELSE 1 END, m.created_at`,
    { org: req.auth.orgId, manager: MANAGER },
  ));

  res.json({
    data: rows.map((r) => ({
      id: r.user_id,
      email: r.email,
      role: r.role,
      created_at: r.created_at,
      has_local_account: !!r.has_local_account,
      // False means anyone who knows this username can sign in as them.
      has_password: !!r.has_password,
      // Lets the UI disable the controls that would lock the caller out,
      // rather than letting them fail server-side.
      is_self: r.user_id === req.auth.userId,
    })),
    can_create: AUTH_MODE === 'local',
  });
}));

router.post('/', wrap(async (req, res) => {
  requireLocalAccounts();
  const { username, password, role } = parse(z.object({
    username: z.string().trim().toLowerCase().min(1, 'اسم المستخدم مطلوب').max(320),
    /*
     * No minimum, and omitting it creates an account with no password at all —
     * the username becomes the whole credential.
     *
     * This is the manager's call to make, not this schema's: a shared warehouse
     * tablet is a real setup, and an 8-character rule on it produces a sticky
     * note on the bezel rather than a secret. What the code owes in return is
     * to never hide the consequence — `has_password` is on every row this
     * endpoint returns so the UI can show which accounts are open.
     */
    password: z.string().max(200).optional().default(''),
    role: roleSchema.default(STAFF),
  }), req.body);

  const existing = await runWithoutOrg(() => get(
    'SELECT id FROM users WHERE lower(email) = @email', { email: username },
  ));
  if (existing) throw conflict('اسم المستخدم هذا مستخدم بالفعل', 'EMAIL_TAKEN');

  const userId = newId();
  const password_hash = await hashPassword(password);

  await guard(() => runWithoutOrg(() => run(
    'INSERT INTO users (id, email, password_hash) VALUES (@id, @email, @password_hash)',
    { id: userId, email: username, password_hash },
  )));

  try {
    await runWithoutOrg(() => run(
      `INSERT INTO memberships (id, org_id, user_id, email, role)
       VALUES (@id, @org, @user, @email, @role)`,
      { id: newId(), org: req.auth.orgId, user: userId, email: username, role },
    ));
  } catch (err) {
    // The account is useless without a membership — `resolveOrg` would either
    // refuse it or auto-provision a *second* organisation, which is worse than
    // no account at all. Roll the user row back by hand: these two tables are
    // written outside the request transaction (see the file header).
    await runWithoutOrg(() => run('DELETE FROM users WHERE id = @id', { id: userId }))
      .catch(() => {});
    throw err;
  }

  res.status(201).json({
    id: userId, email: username, role, has_local_account: true,
    has_password: !!password, is_self: false,
  });
}));

router.patch('/:id', wrap(async (req, res) => {
  const { role, password, username } = parse(z.object({
    role: roleSchema.optional(),
    // An empty string is meaningful here — it *removes* the password. Absent
    // means "leave it alone", which is why the two are distinguished below
    // with `!== undefined` rather than a truthiness test.
    password: z.string().max(200).optional(),
    username: z.string().trim().toLowerCase().min(1).max(320).optional(),
  }), req.body);

  const target = await memberOr404(req.auth.orgId, req.params.id);

  if (role && role !== target.role) {
    if (target.role === MANAGER) await assertNotLastManager(req.auth.orgId, target.user_id);
    await runWithoutOrg(() => run(
      'UPDATE memberships SET role = @role WHERE org_id = @org AND user_id = @user',
      { role, org: req.auth.orgId, user: target.user_id },
    ));
  }

  if (username !== undefined || password !== undefined) requireLocalAccounts();

  if (username) {
    const clash = await runWithoutOrg(() => get(
      'SELECT id FROM users WHERE lower(email) = @email AND id <> @id',
      { email: username, id: target.user_id },
    ));
    if (clash) throw conflict('اسم المستخدم هذا مستخدم بالفعل', 'EMAIL_TAKEN');
    await runWithoutOrg(() => run('UPDATE users SET email = @email WHERE id = @id',
      { email: username, id: target.user_id }));
    // Denormalised copy, kept in sync — same as /auth/change-username.
    await runWithoutOrg(() => run('UPDATE memberships SET email = @email WHERE user_id = @id',
      { email: username, id: target.user_id }));
  }

  if (password !== undefined) {
    // A manager resetting someone else's password is not asked for the old
    // one — they do not have it. Changing your *own* password still goes
    // through /auth/change-password, which does demand it.
    // `hashPassword('')` returns null, which is how a password gets removed.
    const password_hash = await hashPassword(password);
    const { changes } = await runWithoutOrg(() => run(
      'UPDATE users SET password_hash = @password_hash WHERE id = @id',
      { id: target.user_id, password_hash },
    ));
    if (!changes) throw badRequest('لا يوجد حساب محلي لهذا المستخدم', 'NOT_LOCAL_USER');
  }

  res.json({
    id: target.user_id,
    email: username ?? target.email,
    role: role ?? target.role,
    is_self: target.user_id === req.auth.userId,
  });
}));

router.delete('/:id', wrap(async (req, res) => {
  const target = await memberOr404(req.auth.orgId, req.params.id);

  if (target.user_id === req.auth.userId) {
    throw badRequest('لا يمكنك حذف حسابك أنت', 'CANNOT_DELETE_SELF');
  }
  if (target.role === MANAGER) await assertNotLastManager(req.auth.orgId, target.user_id);

  // Membership first: it is what grants access, so if the second statement
  // fails the account is already inert rather than orphaned but usable.
  await runWithoutOrg(() => run(
    'DELETE FROM memberships WHERE org_id = @org AND user_id = @user',
    { org: req.auth.orgId, user: target.user_id },
  ));
  await runWithoutOrg(() => run('DELETE FROM users WHERE id = @id', { id: target.user_id }));

  // Documents keep `created_by`, which is a plain string, so the ledger still
  // records who posted what after the account is gone.
  res.status(204).end();
}));

export default router;
