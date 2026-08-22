/**
 * Organisations — the unit of tenant isolation.
 *
 * Kept separate from auth.js so the seed script and the test suite can obtain an
 * organisation without pulling in JWT verification (and its environment
 * requirements).
 */
import { get, run, newId, runInOrg, runWithoutOrg, ensureOrgDefaults } from '../db/index.js';
import { forbidden } from './errors.js';

/** The identity every request runs as when AUTH_MODE=none (local dev, tests). */
export const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEV_USER_EMAIL = 'dev@localhost';

/**
 * Whether a first-time user gets an organisation created for them. On by
 * default, so signing up to a pilot deployment just works; turn it off once
 * organisations are provisioned deliberately and invitations exist.
 */
export const AUTO_PROVISION = (process.env.ALLOW_AUTO_PROVISION ?? '1') !== '0';

/**
 * Resolve — or, for a first-time user, create — the organisation a user belongs
 * to. Runs outside any org context: `memberships` and `orgs` are the tables
 * consulted *to determine* the org, so they carry no RLS policy and are only
 * ever queried by the verified JWT subject.
 */
export async function resolveOrg({ userId, email, autoProvision = AUTO_PROVISION }) {
  const existing = await runWithoutOrg(() => get(
    'SELECT org_id, role FROM memberships WHERE user_id = @user_id', { user_id: userId },
  ));
  if (existing) return { orgId: existing.org_id, role: existing.role };

  if (!autoProvision) {
    throw forbidden(
      'لا يوجد حساب مؤسسة مرتبط بهذا المستخدم — تواصل مع مسؤول النظام',
      'NO_ORGANISATION',
    );
  }

  const org = await runWithoutOrg(async () => {
    const created = await get('INSERT INTO orgs (name) OUTPUT INSERTED.id VALUES (@name)',
      { name: email ? `مؤسسة ${email.split('@')[0]}` : 'مؤسستي' });
    await run(
      `INSERT INTO memberships (id, org_id, user_id, email, role)
       VALUES (@id, @org_id, @user_id, @email, 'OWNER')`,
      { id: newId(), org_id: created.id, user_id: userId, email: email ?? null });
    return created;
  });

  // Settings rows are tenant-scoped, so seeding them needs the org context.
  await runInOrg(org.id, ensureOrgDefaults);

  return { orgId: org.id, role: 'OWNER' };
}

/** The organisation used by local development, the seed script and the tests. */
export const devOrg = () => resolveOrg({
  userId: DEV_USER_ID, email: DEV_USER_EMAIL, autoProvision: true,
});
