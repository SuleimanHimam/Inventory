-- No USE statement here — see the note at the top of 001_core.sql; the
-- migration runner already connects to the right database via DB_NAME.
GO

-- ============================================================================
--  Barcode uniqueness across items / sub_barcodes / item_units, per org.
--  INSTEAD OF (not AFTER+THROW): SQL Server has no BEFORE trigger timing, and
--  INSTEAD OF is correct by construction (the row is never actually written
--  unless the trigger re-issues the DML) rather than relying on an unhandled
--  AFTER-trigger error's rollback guarantee, which the docs leave ambiguous.
-- ============================================================================

CREATE TRIGGER trg_items_barcode_unique_ins ON items INSTEAD OF INSERT AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    WHERE i.barcode IS NOT NULL AND (
      EXISTS (SELECT 1 FROM sub_barcodes s WHERE s.org_id = i.org_id AND s.barcode = i.barcode)
      OR EXISTS (SELECT 1 FROM item_units u WHERE u.org_id = i.org_id AND u.barcode = i.barcode)
    )
  )
    THROW 50001, 'BARCODE_TAKEN', 1;

  INSERT INTO items (id, org_id, name, category_id, barcode, purchase_price, sale_price,
    low_stock_threshold, image_file, quantity, source, deleted_at, created_at, updated_at,
    weight_kg, length_cm, width_cm, height_cm, cbm_m3)
  SELECT id, org_id, name, category_id, barcode, purchase_price, sale_price,
    low_stock_threshold, image_file, quantity, source, deleted_at, created_at, updated_at,
    weight_kg, length_cm, width_cm, height_cm, cbm_m3
  FROM inserted;
END
GO

CREATE TRIGGER trg_items_barcode_unique_upd ON items INSTEAD OF UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON i.id = d.id
    WHERE (
      i.barcode <> d.barcode
      OR (i.barcode IS NULL AND d.barcode IS NOT NULL)
      OR (i.barcode IS NOT NULL AND d.barcode IS NULL)
    )
      AND i.barcode IS NOT NULL
      AND (
        EXISTS (SELECT 1 FROM sub_barcodes s WHERE s.org_id = i.org_id AND s.barcode = i.barcode)
        OR EXISTS (SELECT 1 FROM item_units u WHERE u.org_id = i.org_id AND u.barcode = i.barcode)
      )
  )
    THROW 50001, 'BARCODE_TAKEN', 1;

  UPDATE t SET
    name = i.name, category_id = i.category_id, barcode = i.barcode, purchase_price = i.purchase_price,
    sale_price = i.sale_price, low_stock_threshold = i.low_stock_threshold, image_file = i.image_file,
    quantity = i.quantity, source = i.source, deleted_at = i.deleted_at, created_at = i.created_at,
    updated_at = i.updated_at, weight_kg = i.weight_kg, length_cm = i.length_cm, width_cm = i.width_cm,
    height_cm = i.height_cm, cbm_m3 = i.cbm_m3
  FROM items t JOIN inserted i ON t.id = i.id;
END
GO

CREATE TRIGGER trg_sub_barcodes_barcode_unique_ins ON sub_barcodes INSTEAD OF INSERT AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    WHERE EXISTS (SELECT 1 FROM items t WHERE t.org_id = i.org_id AND t.barcode = i.barcode)
       OR EXISTS (SELECT 1 FROM item_units u WHERE u.org_id = i.org_id AND u.barcode = i.barcode)
  )
    THROW 50001, 'BARCODE_TAKEN', 1;

  INSERT INTO sub_barcodes (id, org_id, item_id, barcode, label, created_at)
  SELECT id, org_id, item_id, barcode, label, created_at FROM inserted;
END
GO

CREATE TRIGGER trg_sub_barcodes_barcode_unique_upd ON sub_barcodes INSTEAD OF UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON i.id = d.id
    WHERE i.barcode <> d.barcode
      AND (
        EXISTS (SELECT 1 FROM items t WHERE t.org_id = i.org_id AND t.barcode = i.barcode)
        OR EXISTS (SELECT 1 FROM item_units u WHERE u.org_id = i.org_id AND u.barcode = i.barcode)
      )
  )
    THROW 50001, 'BARCODE_TAKEN', 1;

  UPDATE s SET item_id = i.item_id, barcode = i.barcode, label = i.label, created_at = i.created_at
  FROM sub_barcodes s JOIN inserted i ON s.id = i.id;
END
GO

CREATE TRIGGER trg_item_units_barcode_unique_ins ON item_units INSTEAD OF INSERT AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    WHERE EXISTS (SELECT 1 FROM items t WHERE t.org_id = i.org_id AND t.barcode = i.barcode)
       OR EXISTS (SELECT 1 FROM sub_barcodes s WHERE s.org_id = i.org_id AND s.barcode = i.barcode)
  )
    THROW 50001, 'BARCODE_TAKEN', 1;

  INSERT INTO item_units (id, org_id, item_id, name, barcode, conversion_factor, purchase_price,
    sale_price, weight_kg, length_cm, width_cm, height_cm, cbm_m3, created_at, updated_at)
  SELECT id, org_id, item_id, name, barcode, conversion_factor, purchase_price,
    sale_price, weight_kg, length_cm, width_cm, height_cm, cbm_m3, created_at, updated_at
  FROM inserted;
END
GO

CREATE TRIGGER trg_item_units_barcode_unique_upd ON item_units INSTEAD OF UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON i.id = d.id
    WHERE i.barcode <> d.barcode
      AND (
        EXISTS (SELECT 1 FROM items t WHERE t.org_id = i.org_id AND t.barcode = i.barcode)
        OR EXISTS (SELECT 1 FROM sub_barcodes s WHERE s.org_id = i.org_id AND s.barcode = i.barcode)
      )
  )
    THROW 50001, 'BARCODE_TAKEN', 1;

  UPDATE u SET item_id = i.item_id, name = i.name, barcode = i.barcode, conversion_factor = i.conversion_factor,
    purchase_price = i.purchase_price, sale_price = i.sale_price, weight_kg = i.weight_kg,
    length_cm = i.length_cm, width_cm = i.width_cm, height_cm = i.height_cm, cbm_m3 = i.cbm_m3,
    created_at = i.created_at, updated_at = i.updated_at
  FROM item_units u JOIN inserted i ON u.id = i.id;
END
GO

-- ============================================================================
--  Ledger immutability. INSTEAD OF with no re-issue at all — the row is
--  guaranteed untouched by construction, no ambiguity about rollback timing.
-- ============================================================================
-- AFTER, not INSTEAD OF: stock_movements.org_id has a cascading FK to orgs,
-- and SQL Server disallows an INSTEAD OF DELETE/UPDATE trigger on a table
-- that itself has an outgoing cascading FK (the two mechanisms conflict).
-- Verified empirically (see Phase 2 notes) that THROW here, under
-- XACT_ABORT OFF, rolls back just the triggering statement and leaves the
-- row untouched, with the outer transaction still usable afterward.
CREATE TRIGGER trg_movements_immutable_upd ON stock_movements AFTER UPDATE AS
BEGIN
  THROW 50002, 'LEDGER_IMMUTABLE', 1;
END
GO

CREATE TRIGGER trg_movements_immutable_del ON stock_movements AFTER DELETE AS
BEGIN
  THROW 50003, 'LEDGER_IMMUTABLE', 1;
END
GO

-- ============================================================================
--  items.quantity cache maintenance. AFTER INSERT, set-based (SQL Server
--  fires once per statement, not once per row like Postgres) — aggregates the
--  delta per item before applying, so a multi-row insert is still correct.
-- ============================================================================
CREATE TRIGGER trg_movements_apply_qty ON stock_movements AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  UPDATE it SET
    quantity = it.quantity + agg.delta,
    updated_at = dbo.iso_now()
  FROM items it
  JOIN (
    SELECT item_id, org_id, SUM(CASE type WHEN 'IN' THEN quantity ELSE -quantity END) AS delta
    FROM inserted
    GROUP BY item_id, org_id
  ) agg ON it.id = agg.item_id AND it.org_id = agg.org_id;
END
GO

-- ============================================================================
--  items.image_file cache maintenance (primary photo = lowest sort_order).
--  One combined AFTER trigger for all three events, set-based, unioning the
--  affected items from both inserted and deleted so every changed item's
--  cache gets recomputed regardless of which event touched it.
-- ============================================================================
CREATE TRIGGER trg_item_images_sync_primary ON item_images AFTER INSERT, UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  ;WITH affected AS (
    SELECT item_id, org_id FROM inserted
    UNION
    SELECT item_id, org_id FROM deleted
  )
  UPDATE it SET image_file = (
    SELECT TOP 1 ii.[file] FROM item_images ii
    WHERE ii.item_id = a.item_id AND ii.org_id = a.org_id
    ORDER BY ii.sort_order, ii.created_at
  )
  FROM items it JOIN affected a ON it.id = a.item_id AND it.org_id = a.org_id;
END
GO

-- ============================================================================
--  ON DELETE SET NULL(col) replacements — SQL Server can't SET NULL a single
--  column of a composite FK without also nulling org_id (NOT NULL). Each of
--  these mirrors exactly one column-specific SET NULL from the Postgres
--  schema. Set-based (JOIN against deleted), safe for multi-row deletes.
-- ============================================================================
CREATE TRIGGER trg_categories_null_refs ON categories AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE i SET category_id = NULL FROM items i JOIN deleted d ON i.category_id = d.id AND i.org_id = d.org_id;
  UPDATE s SET category_id = NULL FROM stock_counts s JOIN deleted d ON s.category_id = d.id AND s.org_id = d.org_id;
END
GO

CREATE TRIGGER trg_items_null_refs ON items AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE s SET item_id = NULL FROM stock_counts s JOIN deleted d ON s.item_id = d.id AND s.org_id = d.org_id;
END
GO

CREATE TRIGGER trg_suppliers_null_refs ON suppliers AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE v SET supplier_id = NULL FROM invoices v JOIN deleted d ON v.supplier_id = d.id AND v.org_id = d.org_id;
END
GO

CREATE TRIGGER trg_customers_null_refs ON customers AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE v SET customer_id = NULL FROM invoices v JOIN deleted d ON v.customer_id = d.id AND v.org_id = d.org_id;
END
GO

CREATE TRIGGER trg_stock_counts_null_refs ON stock_counts AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE v SET stock_count_id = NULL FROM invoices v JOIN deleted d ON v.stock_count_id = d.id AND v.org_id = d.org_id;
END
GO

CREATE TRIGGER trg_invoice_lines_null_refs ON invoice_lines AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE l SET auto_invoice_line_id = NULL FROM stock_count_lines l JOIN deleted d ON l.auto_invoice_line_id = d.id AND l.org_id = d.org_id;
END
GO
