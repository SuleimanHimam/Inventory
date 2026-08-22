-- ============================================================================
--  Local (non-Supabase) accounts — email + password, hashed and verified by
--  this API itself, for a deployment that runs AUTH_MODE=local.
--
--  Deliberately outside the tenant model: a row here is just a login, with no
--  org_id of its own. `memberships.user_id` links it to an organisation the
--  same way it already links a Supabase Auth user — this table only replaces
--  where the *identity* comes from, not how tenancy is resolved. No RLS here,
--  same reasoning as `orgs`/`memberships`: it is only ever queried by the
--  login/register routes, before any organisation is known.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    text NOT NULL DEFAULT iso_now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users (lower(email));
