/**
 * Password hashing for local (non-Supabase) accounts.
 *
 * Node's own `crypto.scrypt` rather than bcrypt/argon2 — both need a native
 * build (node-gyp + a C++ toolchain), which this deployment target does not
 * reliably have. scrypt is memory-hard and built in, so it is the honest
 * zero-dependency choice.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;

/**
 * `salt:hash`, both hex — self-contained, so verification needs no other input.
 *
 * An empty password hashes to `null`, not to a hash of the empty string: an
 * account with no password is a *state*, and storing a real hash for it would
 * make "no password" indistinguishable from "the password happens to be
 * empty", which `verifyPassword` would then happily accept from anyone sending
 * `password: ""`. See migrations-mssql/005_optional_password.sql.
 */
export async function hashPassword(password) {
  if (password === null || password === undefined || password === '') return null;
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** True when this account is open — no secret stands in front of it. */
export const hasNoPassword = (stored) => stored === null || stored === undefined || stored === '';

/**
 * Verify a password against a stored hash.
 *
 * Returns false for a passwordless account: "does this secret match" is not the
 * question to ask about an account that has no secret, and answering `true`
 * here would mean any string logs in. The decision to let such an account
 * through is made explicitly at the one call site that is allowed to make it —
 * see `/auth/login`.
 */
export async function verifyPassword(password, stored) {
  if (hasNoPassword(stored)) return false;
  const [saltHex, hashHex] = String(stored ?? '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  // Constant-time compare — a length mismatch would throw, so guard first.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
