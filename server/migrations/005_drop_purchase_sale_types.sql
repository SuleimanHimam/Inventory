-- ============================================================================
--  Collapse invoice types down to STOCK_IN / STOCK_OUT.
--
--  PURCHASE and SALE were direction-locked variants of STOCK_IN/STOCK_OUT that
--  also required a supplier or customer respectively. That distinction is
--  gone: any stock-in/stock-out invoice can now optionally carry a supplier
--  and/or a customer as a free-text party reference, nothing more. Existing
--  PURCHASE/SALE invoices are relabelled in place — no data is lost, only the
--  type column's value changes (their document numbers keep their historical
--  PUR-/SAL- prefixes, which is fine, those are just opaque strings).
-- ============================================================================

UPDATE invoices SET type = 'STOCK_IN'  WHERE type = 'PURCHASE';
UPDATE invoices SET type = 'STOCK_OUT' WHERE type = 'SALE';

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_type_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_type_check
  CHECK (type IN ('STOCK_IN', 'STOCK_OUT'));
