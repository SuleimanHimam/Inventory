-- ============================================================================
--  Row Level Security — the second line of defence for tenant isolation.
--
--  The application layer is the first line: every query in server/src/services
--  carries an explicit `org_id = @org` predicate, sourced from the verified JWT
--  and never from client input. These policies exist so that a *missing*
--  predicate — a future bug, a hand-written query, a psql session — cannot leak
--  or corrupt another organisation's data.
--
--  How it is wired: the API opens one transaction per request and sets
--  `app.org_id` on it (see server/src/db/index.js → runInOrg). Every policy
--  compares org_id against that setting, so a connection with no setting sees
--  nothing at all.
--
--  IMPORTANT — this is only effective when the API connects as a role that is
--  neither superuser nor BYPASSRLS. Supabase's default `postgres` role bypasses
--  RLS entirely. Create the least-privilege login role below and point
--  DATABASE_URL at it in production; see DEPLOYMENT.md.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

DO $rls$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'categories', 'items', 'sub_barcodes', 'customers', 'suppliers',
    'stock_counts', 'invoices', 'invoice_lines', 'stock_movements',
    'stock_count_lines', 'counters', 'settings', 'import_batches', 'item_images'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE also subjects the table owner to the policies. Superusers still
    -- bypass them, which is why the API must not connect as one.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (org_id = app_current_org())
                                    WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END
$rls$;

-- ---------------------------------------------------------------------------
-- Least-privilege role for the API.
--
-- Created without a password here so no secret lives in the repository. Grant
-- it one out of band, then use it in DATABASE_URL:
--
--   ALTER ROLE app_api WITH LOGIN PASSWORD '…';
--
-- `orgs` and `memberships` are deliberately NOT under org_id RLS: they are the
-- table the API reads *to determine* the org, before any org context exists.
-- The API only ever queries them by the JWT subject.
-- ---------------------------------------------------------------------------
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN;
  END IF;
END
$role$;

GRANT USAGE ON SCHEMA public TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_api;

-- Tables added by later migrations should be reachable without re-granting.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;
