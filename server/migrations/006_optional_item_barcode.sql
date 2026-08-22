-- ============================================================================
--  The item's own barcode becomes optional.
--
--  Some items genuinely have no barcode (loose/bulk goods, in-house services)
--  and forcing one meant users typed junk values just to satisfy the form.
--  Sub-barcodes and unit barcodes are unaffected — a row in those tables only
--  exists to be scannable, so a barcode is still required there.
--
--  The cross-table uniqueness trigger (trg_barcode_unique) already treats a
--  NULL comparison as never-equal, so it silently allows any number of items
--  with no barcode — no trigger change needed. Same for the UNIQUE index:
--  Postgres never considers two NULLs a duplicate.
-- ============================================================================

ALTER TABLE items ALTER COLUMN barcode DROP NOT NULL;
