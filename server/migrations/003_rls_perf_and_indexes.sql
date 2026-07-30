-- ============================================================================
--  Row Level Security performance, and the indexes the policies need.
--
--  Findings from auditing the live database against Supabase's Postgres
--  best-practice guidance (.agents/skills/supabase-postgres-best-practices):
--
--   1. Every policy read `org_id = app_current_org()`, which calls the function
--      once *per row*. Wrapping it in a scalar subquery turns it into an InitPlan
--      that Postgres evaluates once per statement and caches. `app_current_org()`
--      is STABLE and takes no arguments, so this is a pure win.
--
--   2. Four tenant tables had no index leading with `org_id`, which is the column
--      every policy filters on: import_batches, invoice_lines, item_images,
--      stock_count_lines.
--
--   3. Several foreign keys were unindexed. Postgres does not index them
--      automatically, and it needs them both for joins and to check a parent
--      row's deletion without scanning the child table.
-- ============================================================================

-- ------------------------------------------------- 1. policies, re-expressed
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
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I
         USING (org_id = (SELECT app_current_org()))
         WITH CHECK (org_id = (SELECT app_current_org()))', t);
  END LOOP;
END
$rls$;

-- --------------------------------------- 2. org_id-leading policy indexes
-- Composite rather than org_id alone: within one organisation `org_id` has no
-- selectivity, so the second column is what makes the index worth having.
CREATE INDEX IF NOT EXISTS ix_invoice_lines_org_invoice
  ON invoice_lines(org_id, invoice_id);
CREATE INDEX IF NOT EXISTS ix_invoice_lines_org_item
  ON invoice_lines(org_id, item_id);
CREATE INDEX IF NOT EXISTS ix_count_lines_org_session
  ON stock_count_lines(org_id, stock_count_id);
CREATE INDEX IF NOT EXISTS ix_count_lines_org_item
  ON stock_count_lines(org_id, item_id);
CREATE INDEX IF NOT EXISTS ix_item_images_org_item
  ON item_images(org_id, item_id);
CREATE INDEX IF NOT EXISTS ix_import_batches_org
  ON import_batches(org_id, created_at DESC);

-- ------------------------------------------------ 3. foreign key coverage
-- Leading with the referencing column, which is the order a foreign key check
-- on the parent's deletion looks things up in.
CREATE INDEX IF NOT EXISTS ix_invoices_supplier     ON invoices(supplier_id, org_id);
CREATE INDEX IF NOT EXISTS ix_invoices_customer     ON invoices(customer_id, org_id);
CREATE INDEX IF NOT EXISTS ix_invoices_stock_count  ON invoices(stock_count_id, org_id);
CREATE INDEX IF NOT EXISTS ix_stock_counts_category ON stock_counts(category_id, org_id);
CREATE INDEX IF NOT EXISTS ix_stock_counts_item     ON stock_counts(item_id, org_id);
CREATE INDEX IF NOT EXISTS ix_count_lines_auto_line ON stock_count_lines(auto_invoice_line_id);
