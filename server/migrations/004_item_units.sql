-- ============================================================================
--  Units of measure for items.
--
--  An item's own quantity is still tracked in one base unit (unchanged) — this
--  adds optional *alternate* purchase/sale units (e.g. "Box of 12", "Carton of
--  144"), each with its own barcode, price, weight and carton size, and a
--  conversion factor back to the base unit. Invoice lines can now be entered
--  in any unit; `conversion_factor` is snapshotted onto the line exactly like
--  `unit_price` already is, so editing a unit later never changes what an
--  existing draft/posted line converts to. `invoice_lines.unit_id IS NULL`
--  means "the item's own base unit" (factor 1) — there is no explicit
--  item_units row for the base unit itself; its physical attributes live
--  directly on `items`.
-- ============================================================================

-- ---------------------------------------------------- items: base unit attrs
ALTER TABLE items ADD COLUMN IF NOT EXISTS weight_kg double precision;
ALTER TABLE items ADD COLUMN IF NOT EXISTS length_cm double precision;
ALTER TABLE items ADD COLUMN IF NOT EXISTS width_cm  double precision;
ALTER TABLE items ADD COLUMN IF NOT EXISTS height_cm double precision;
ALTER TABLE items ADD COLUMN IF NOT EXISTS cbm_m3    double precision;

DO $items_chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_weight_nonneg') THEN
    ALTER TABLE items ADD CONSTRAINT chk_items_weight_nonneg CHECK (weight_kg IS NULL OR weight_kg >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_dims_nonneg') THEN
    ALTER TABLE items ADD CONSTRAINT chk_items_dims_nonneg CHECK (
      (length_cm IS NULL OR length_cm >= 0) AND
      (width_cm  IS NULL OR width_cm  >= 0) AND
      (height_cm IS NULL OR height_cm >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_cbm_nonneg') THEN
    ALTER TABLE items ADD CONSTRAINT chk_items_cbm_nonneg CHECK (cbm_m3 IS NULL OR cbm_m3 >= 0);
  END IF;
END
$items_chk$;

-- --------------------------------------------------------------- item_units
-- Alternate units of measure for an item. Same tenant-safety shape as
-- sub_barcodes: text UUID id, composite FK into items(id, org_id).
CREATE TABLE IF NOT EXISTS item_units (
  id                text PRIMARY KEY,
  org_id            uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  item_id           text NOT NULL,
  name              text NOT NULL,
  barcode           text NOT NULL,
  -- Multiplier to the item's base unit, e.g. 12 for a box of 12 pieces.
  -- double precision (not integer) so fractional factors are representable;
  -- entered_quantity * conversion_factor is validated to land on a whole
  -- number of base units at the application layer (invoices.service.js),
  -- not enforced here.
  conversion_factor double precision NOT NULL,
  purchase_price    double precision NOT NULL DEFAULT 0,
  sale_price        double precision NOT NULL DEFAULT 0,
  weight_kg         double precision,
  length_cm         double precision,
  width_cm          double precision,
  height_cm         double precision,
  cbm_m3            double precision,
  created_at        text NOT NULL DEFAULT iso_now(),
  updated_at        text NOT NULL DEFAULT iso_now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE CASCADE,
  CONSTRAINT chk_item_units_factor_positive CHECK (conversion_factor > 0),
  CONSTRAINT chk_item_units_weight_nonneg CHECK (weight_kg IS NULL OR weight_kg >= 0),
  CONSTRAINT chk_item_units_dims_nonneg CHECK (
    (length_cm IS NULL OR length_cm >= 0) AND
    (width_cm  IS NULL OR width_cm  >= 0) AND
    (height_cm IS NULL OR height_cm >= 0)),
  CONSTRAINT chk_item_units_cbm_nonneg CHECK (cbm_m3 IS NULL OR cbm_m3 >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_item_units_barcode ON item_units(org_id, barcode);
CREATE INDEX IF NOT EXISTS ix_item_units_org_item ON item_units(org_id, item_id);

-- -------------------------------------------------- invoice_lines: unit ref
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS unit_id text;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS conversion_factor double precision NOT NULL DEFAULT 1;

DO $lines_chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_lines_factor_positive') THEN
    ALTER TABLE invoice_lines ADD CONSTRAINT chk_invoice_lines_factor_positive CHECK (conversion_factor > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoice_lines_unit') THEN
    ALTER TABLE invoice_lines ADD CONSTRAINT fk_invoice_lines_unit
      FOREIGN KEY (unit_id, org_id) REFERENCES item_units(id, org_id) ON DELETE RESTRICT;
  END IF;
END
$lines_chk$;
CREATE INDEX IF NOT EXISTS ix_invoice_lines_unit ON invoice_lines(unit_id);

-- ---------------------------------------- barcode uniqueness, now 3-way
-- Was a hardcoded items<->sub_barcodes if/else; rewritten table-driven so a
-- future 4th barcode-bearing table needs only one more CASE branch. Same
-- RAISE contract as before, so the 4 existing triggers on items/sub_barcodes
-- keep working against this replaced function body unmodified.
CREATE OR REPLACE FUNCTION trg_barcode_unique() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  other text;
  hit boolean;
BEGIN
  FOREACH other IN ARRAY (
    CASE TG_TABLE_NAME
      WHEN 'items'        THEN ARRAY['sub_barcodes', 'item_units']
      WHEN 'sub_barcodes'  THEN ARRAY['items', 'item_units']
      WHEN 'item_units'    THEN ARRAY['items', 'sub_barcodes']
      ELSE ARRAY[]::text[]
    END
  ) LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE org_id = $1 AND barcode = $2)', other)
      INTO hit USING NEW.org_id, NEW.barcode;
    IF hit THEN
      RAISE EXCEPTION 'BARCODE_TAKEN' USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_item_unit_barcode_unique_ins ON item_units;
CREATE TRIGGER trg_item_unit_barcode_unique_ins
  BEFORE INSERT ON item_units
  FOR EACH ROW EXECUTE FUNCTION trg_barcode_unique();

DROP TRIGGER IF EXISTS trg_item_unit_barcode_unique_upd ON item_units;
CREATE TRIGGER trg_item_unit_barcode_unique_upd
  BEFORE UPDATE OF barcode ON item_units
  FOR EACH ROW WHEN (NEW.barcode IS DISTINCT FROM OLD.barcode)
  EXECUTE FUNCTION trg_barcode_unique();

-- ------------------------------------------------------------------- RLS
-- Fresh block for the one new table — 002/003 are already applied and are
-- never edited after the fact.
DO $rls$
BEGIN
  ALTER TABLE item_units ENABLE ROW LEVEL SECURITY;
  ALTER TABLE item_units FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS org_isolation ON item_units;
  CREATE POLICY org_isolation ON item_units
    USING (org_id = (SELECT app_current_org()))
    WITH CHECK (org_id = (SELECT app_current_org()));
END
$rls$;

-- app_api's ALTER DEFAULT PRIVILEGES from 002_rls.sql already covers tables
-- created by the same role that ran it (postgres) — no explicit GRANT needed
-- here as long as this migration is applied as postgres, same as 001-003.
