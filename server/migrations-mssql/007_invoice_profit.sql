-- ============================================================================
--  Invoice profitability, and the admin's ability to correct a posted invoice.
--
--  Two features that turn out to be the same migration, because both hinge on
--  the same missing fact: what an item *cost* at the moment it was sold.
--
--  ---------------------------------------------------------------- profit --
--  `invoice_lines.unit_price` is the sale price on a STOCK_OUT line and the
--  purchase price on a STOCK_IN one (see priceColumnOf in the service). What
--  it has never carried is the *cost* behind an outbound line, so profit was
--  not recoverable after the fact: `items.purchase_price` moves every time a
--  new STOCK_IN is posted, so reading it today to explain a sale from March
--  answers a different question than the one being asked.
--
--  `cost_price` fixes that by snapshotting the cost onto the line at posting
--  time, in the same unit the line is priced in. Once written it never moves
--  again — the profit on a posted invoice is therefore a fact about that
--  document, not a number recomputed from today's prices.
--
--  `cost_basis` records how the figure was arrived at, because the three
--  cases are not equally trustworthy and the UI says so:
--    ACTUAL    — a STOCK_IN line: the cost *is* what was paid, by definition.
--    SNAPSHOT  — captured at posting from the price then in effect. Exact.
--    ESTIMATED — reconstructed by this migration for invoices posted before
--                the column existed. Honest, but not recorded history.
--
--  ------------------------------------------------- correcting a document --
--  The stock ledger is immutable by construction (trg_movements_immutable_upd
--  / _del in 002_triggers.sql THROW on any update or delete), and that stays
--  true here. An admin correcting a posted invoice does not rewrite history;
--  a compensating movement is written in the opposite direction, which is why
--  `reference_type` gains REVERSAL and movements gain a pointer to the entry
--  they undo. Stock lands where it should and both halves remain on the
--  record — the same remedy the old error message told users to perform by
--  hand ("أنشئ فاتورة عكسية لتصحيح الأثر"), now performed by the app.
--
--  The invoice's own status stays within its existing CHECK: a reversed
--  document is CANCELLED, with `reversed_at` telling it apart from a draft
--  that was simply abandoned. `revision` counts how many times the document
--  has been reopened and re-posted, so "edited twice" is legible.
-- ============================================================================

-- ------------------------------------------------------------------- lines
ALTER TABLE invoice_lines ADD
  cost_price float NULL,
  cost_basis nvarchar(20) NULL;
GO

ALTER TABLE invoice_lines ADD CONSTRAINT CK_invoice_lines_cost_basis
  CHECK (cost_basis IS NULL OR cost_basis IN ('ACTUAL', 'SNAPSHOT', 'ESTIMATED'));
GO

-- ---------------------------------------------------------------- invoices
ALTER TABLE invoices ADD
  reversed_at  nvarchar(24) NULL,
  reversed_by  nvarchar(max) NULL,
  reopened_at  nvarchar(24) NULL,
  reopened_by  nvarchar(max) NULL,
  revision     int NOT NULL DEFAULT 0;
GO

-- --------------------------------------------------------------- movements
-- REVERSAL joins the reference types. The original CHECK was written inline
-- and so carries a generated name — found by column, exactly as 006 had to.
DECLARE @ref_constraint nvarchar(200);
SELECT @ref_constraint = cc.name
FROM sys.check_constraints cc
JOIN sys.columns col
  ON col.object_id = cc.parent_object_id AND col.column_id = cc.parent_column_id
WHERE cc.parent_object_id = OBJECT_ID('stock_movements') AND col.name = 'reference_type';

IF @ref_constraint IS NOT NULL
  EXEC('ALTER TABLE stock_movements DROP CONSTRAINT ' + @ref_constraint);

ALTER TABLE stock_movements ADD CONSTRAINT CK_stock_movements_reference_type
  CHECK (reference_type IN ('MANUAL', 'STOCK_COUNT', 'IMPORT', 'INVOICE', 'REVERSAL'));
GO

-- Which entry this one undoes. No FK: stock_movements already reaches orgs by
-- a cascading path, and a self-referencing FK on the same table would add a
-- second one for SQL Server to refuse. The service is the only writer.
ALTER TABLE stock_movements ADD reverses_movement_id nvarchar(64) NULL;
GO
CREATE INDEX ix_movements_reverses ON stock_movements(reverses_movement_id);
GO

-- ==========================================================================
--  Backfill. Runs once, over documents that predate the column.
-- ==========================================================================

-- A STOCK_IN line's cost is not an estimate — it is the line itself.
UPDATE l SET l.cost_price = l.unit_price, l.cost_basis = 'ACTUAL'
FROM invoice_lines l
JOIN invoices v ON v.id = l.invoice_id AND v.org_id = l.org_id
WHERE l.cost_price IS NULL AND v.type = 'STOCK_IN';
GO

/*
 * Outbound lines get today's purchase price, marked ESTIMATED.
 *
 * A line priced in a non-base unit takes that unit's own purchase price when
 * it has one, because a carton cost and a piece cost are unrelated numbers
 * (the same rule postInvoice applies when propagating prices). A unit whose
 * purchase price was never set falls back to the base item's, scaled by the
 * line's stored conversion factor — the factor is a per-line snapshot, so
 * this scales by what the line actually meant, not by what the unit means now.
 */
UPDATE l SET
  l.cost_price = COALESCE(NULLIF(u.purchase_price, 0), i.purchase_price * l.conversion_factor),
  l.cost_basis = 'ESTIMATED'
FROM invoice_lines l
JOIN invoices v ON v.id = l.invoice_id AND v.org_id = l.org_id
JOIN items i ON i.id = l.item_id AND i.org_id = l.org_id
LEFT JOIN item_units u ON u.id = l.unit_id AND u.org_id = l.org_id
WHERE l.cost_price IS NULL AND v.type = 'STOCK_OUT';
GO
