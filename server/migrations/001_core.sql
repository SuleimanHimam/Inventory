-- ============================================================================
--  Inventory Management System — PostgreSQL schema (v6.0)
--
--  Ported from the SQLite schema of v5.0. Three things are deliberately
--  preserved rather than "modernised", because the application contract and
--  the test suite depend on them:
--
--   1. Ids stay TEXT. They are UUIDv4 strings minted by the API
--      (crypto.randomUUID) — not database sequences.
--   2. Timestamps stay TEXT holding ISO-8601 UTC (`2026-07-29T10:20:30.123Z`).
--      Lexicographic order equals chronological order, every comparison in the
--      services keeps working, and JSON responses are byte-identical to the
--      SQLite build. `iso_now()` replaces strftime('%Y-%m-%dT%H:%M:%fZ','now').
--   3. Money stays double precision (SQLite REAL), rounded to 2 decimals by the
--      service layer. `numeric` would be more correct but pg returns it as a
--      string, which would change every response shape.
--
--  New in this version: every tenant-scoped table carries `org_id`, so one
--  hosted deployment serves many organisations. Row Level Security policies
--  live in 002_rls.sql.
--
--  Requires PostgreSQL 15 or newer, for the column-specific
--  `ON DELETE SET NULL (col)` form. Without it, nulling a composite foreign key
--  would try to null `org_id` too, which is NOT NULL. Supabase runs 15+.
-- ============================================================================

-- gen_random_uuid() is core since PG 13; the extension keeps older servers working.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- helpers
-- The exact format strftime('%Y-%m-%dT%H:%M:%fZ','now') produced in SQLite.
CREATE OR REPLACE FUNCTION iso_now() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

CREATE OR REPLACE FUNCTION iso_today() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD') $$;

-- ------------------------------------------------------------------- tenancy
-- An organisation is the unit of data isolation: one customer of the hosted
-- app. Not itself tenant-scoped, so it carries no org_id and no RLS policy.
CREATE TABLE IF NOT EXISTS orgs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at text NOT NULL DEFAULT iso_now()
);

-- Links a Supabase Auth user (auth.users.id) to an organisation. The API never
-- trusts an org id from the client: it is always resolved through this table
-- from the verified JWT subject.
CREATE TABLE IF NOT EXISTS memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  email      text,
  role       text NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'MEMBER')),
  created_at text NOT NULL DEFAULT iso_now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS ix_memberships_org ON memberships(org_id);

-- ---------------------------------------------------------------- categories
CREATE TABLE IF NOT EXISTS categories (
  id         text PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at text NOT NULL DEFAULT iso_now(),
  UNIQUE (id, org_id)              -- target for composite tenant-safe FKs
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_name ON categories(org_id, name);

-- --------------------------------------------------------------------- items
CREATE TABLE IF NOT EXISTS items (
  id                  text PRIMARY KEY,
  org_id              uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name                text NOT NULL,
  category_id         text,
  barcode             text NOT NULL,
  purchase_price      double precision NOT NULL DEFAULT 0,
  sale_price          double precision NOT NULL DEFAULT 0,
  low_stock_threshold integer,                     -- NULL => use global setting
  -- Stored filename of the product photo, resolved against the uploads dir.
  -- Never a full path: the database must stay portable between machines.
  image_file          text,
  -- Cached running balance. Maintained exclusively by triggers on
  -- stock_movements, which is an append-only ledger, so it can never drift.
  quantity            integer NOT NULL DEFAULT 0,
  source              text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT')),
  deleted_at          text,
  created_at          text NOT NULL DEFAULT iso_now(),
  updated_at          text NOT NULL DEFAULT iso_now(),
  UNIQUE (id, org_id),
  -- A category may only be referenced from inside the same organisation.
  -- Only `category_id` is nulled when the category goes: org_id is NOT NULL.
  FOREIGN KEY (category_id, org_id) REFERENCES categories(id, org_id)
    ON DELETE SET NULL (category_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_barcode ON items(org_id, barcode);
CREATE INDEX IF NOT EXISTS ix_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS ix_items_name ON items(org_id, lower(name));
CREATE INDEX IF NOT EXISTS ix_items_live ON items(org_id, deleted_at);

-- -------------------------------------------------------------- sub_barcodes
CREATE TABLE IF NOT EXISTS sub_barcodes (
  id         text PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  item_id    text NOT NULL,
  barcode    text NOT NULL,
  label      text,
  created_at text NOT NULL DEFAULT iso_now(),
  FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_barcodes_barcode ON sub_barcodes(org_id, barcode);
CREATE INDEX IF NOT EXISTS ix_sub_barcodes_item ON sub_barcodes(item_id);

-- Business rule: a barcode value must be unique ACROSS both tables — within an
-- organisation. Two different customers of the hosted app may legitimately use
-- the same manufacturer barcode, so the check is scoped by org_id.
-- Enforced at the DB level so no code path can bypass it.
CREATE OR REPLACE FUNCTION trg_barcode_unique() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  IF TG_TABLE_NAME = 'items' THEN
    IF EXISTS (SELECT 1 FROM sub_barcodes s
                WHERE s.org_id = NEW.org_id AND s.barcode = NEW.barcode) THEN
      RAISE EXCEPTION 'BARCODE_TAKEN' USING ERRCODE = 'unique_violation';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM items i
                WHERE i.org_id = NEW.org_id AND i.barcode = NEW.barcode) THEN
      RAISE EXCEPTION 'BARCODE_TAKEN' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_item_barcode_unique_ins ON items;
CREATE TRIGGER trg_item_barcode_unique_ins
  BEFORE INSERT ON items
  FOR EACH ROW EXECUTE FUNCTION trg_barcode_unique();

DROP TRIGGER IF EXISTS trg_item_barcode_unique_upd ON items;
CREATE TRIGGER trg_item_barcode_unique_upd
  BEFORE UPDATE OF barcode ON items
  FOR EACH ROW WHEN (NEW.barcode IS DISTINCT FROM OLD.barcode)
  EXECUTE FUNCTION trg_barcode_unique();

DROP TRIGGER IF EXISTS trg_sub_barcode_unique_ins ON sub_barcodes;
CREATE TRIGGER trg_sub_barcode_unique_ins
  BEFORE INSERT ON sub_barcodes
  FOR EACH ROW EXECUTE FUNCTION trg_barcode_unique();

DROP TRIGGER IF EXISTS trg_sub_barcode_unique_upd ON sub_barcodes;
CREATE TRIGGER trg_sub_barcode_unique_upd
  BEFORE UPDATE OF barcode ON sub_barcodes
  FOR EACH ROW WHEN (NEW.barcode IS DISTINCT FROM OLD.barcode)
  EXECUTE FUNCTION trg_barcode_unique();

-- ----------------------------------------------------------------- customers
CREATE TABLE IF NOT EXISTS customers (
  id         text PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  phone      text,
  email      text,
  address    text,
  tax_number text,
  notes      text,
  is_active  integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT iso_now(),
  updated_at text NOT NULL DEFAULT iso_now(),
  UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS ix_customers_name ON customers(org_id, lower(name));

-- ----------------------------------------------------------------- suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id             text PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name           text NOT NULL,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  tax_number     text,
  notes          text,
  is_active      integer NOT NULL DEFAULT 1,
  created_at     text NOT NULL DEFAULT iso_now(),
  updated_at     text NOT NULL DEFAULT iso_now(),
  UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS ix_suppliers_name ON suppliers(org_id, lower(name));

-- -------------------------------------------------------------- stock_counts
CREATE TABLE IF NOT EXISTS stock_counts (
  id           text PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number       text NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('ALL', 'CATEGORY', 'ITEM')),
  category_id  text,
  item_id      text,
  status       text NOT NULL DEFAULT 'OPEN'
               CHECK (status IN ('OPEN', 'SUBMITTED', 'APPLIED', 'CANCELLED')),
  created_by   text NOT NULL DEFAULT 'system',
  created_at   text NOT NULL DEFAULT iso_now(),
  submitted_at text,
  applied_at   text,
  UNIQUE (id, org_id),
  FOREIGN KEY (category_id, org_id) REFERENCES categories(id, org_id)
    ON DELETE SET NULL (category_id),
  FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id)
    ON DELETE SET NULL (item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_counts_number ON stock_counts(org_id, number);
CREATE INDEX IF NOT EXISTS ix_stock_counts_status ON stock_counts(org_id, status);

-- ------------------------------------------------------------------ invoices
CREATE TABLE IF NOT EXISTS invoices (
  id             text PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('STOCK_IN', 'STOCK_OUT', 'PURCHASE', 'SALE')),
  number         text NOT NULL,
  supplier_id    text,
  customer_id    text,
  status         text NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  -- Who/what produced this document. Drives the "system generated" badge.
  source         text NOT NULL DEFAULT 'USER'
                 CHECK (source IN ('USER', 'QUICK', 'STOCK_COUNT', 'IMPORT')),
  invoice_date   text NOT NULL DEFAULT iso_today(),
  discount_total double precision NOT NULL DEFAULT 0,
  tax_total      double precision NOT NULL DEFAULT 0,
  note           text,
  stock_count_id text,
  created_by     text NOT NULL DEFAULT 'system',
  created_at     text NOT NULL DEFAULT iso_now(),
  posted_at      text,
  UNIQUE (id, org_id),
  FOREIGN KEY (supplier_id, org_id) REFERENCES suppliers(id, org_id)
    ON DELETE SET NULL (supplier_id),
  FOREIGN KEY (customer_id, org_id) REFERENCES customers(id, org_id)
    ON DELETE SET NULL (customer_id),
  FOREIGN KEY (stock_count_id, org_id) REFERENCES stock_counts(id, org_id)
    ON DELETE SET NULL (stock_count_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_number ON invoices(org_id, number);
CREATE INDEX IF NOT EXISTS ix_invoices_type_status ON invoices(org_id, type, status);
CREATE INDEX IF NOT EXISTS ix_invoices_date ON invoices(org_id, invoice_date DESC);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                text PRIMARY KEY,
  org_id            uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- SQLite ordered ties by the implicit `rowid`; Postgres has no such column,
  -- so insertion order is captured explicitly.
  seq               bigint GENERATED ALWAYS AS IDENTITY,
  invoice_id        text NOT NULL,
  item_id           text NOT NULL,
  barcode_scanned   text,
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price        double precision NOT NULL DEFAULT 0,
  update_item_price integer NOT NULL DEFAULT 1,
  note              text,
  sort_order        integer NOT NULL DEFAULT 0,
  UNIQUE (id, org_id),
  FOREIGN KEY (invoice_id, org_id) REFERENCES invoices(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ix_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS ix_invoice_lines_item ON invoice_lines(item_id);

-- ----------------------------------------------------------- stock_movements
-- Append-only ledger. Updates and deletes are blocked by triggers.
CREATE TABLE IF NOT EXISTS stock_movements (
  id             text PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  seq            bigint GENERATED ALWAYS AS IDENTITY,   -- replaces SQLite rowid
  item_id        text NOT NULL,
  type           text NOT NULL CHECK (type IN ('IN', 'OUT')),
  quantity       integer NOT NULL CHECK (quantity > 0),
  invoice_id     text,
  reference_type text NOT NULL DEFAULT 'INVOICE'
                 CHECK (reference_type IN ('MANUAL', 'STOCK_COUNT', 'IMPORT', 'INVOICE')),
  note           text,
  created_at     text NOT NULL DEFAULT iso_now(),
  FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE RESTRICT,
  FOREIGN KEY (invoice_id, org_id) REFERENCES invoices(id, org_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ix_movements_item ON stock_movements(org_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_movements_created ON stock_movements(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_movements_invoice ON stock_movements(invoice_id);

-- The ledger is the audit trail: correcting a mistake means posting a
-- compensating document, never editing history.
CREATE OR REPLACE FUNCTION trg_ledger_immutable() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  RAISE EXCEPTION 'LEDGER_IMMUTABLE' USING ERRCODE = 'check_violation';
END
$$;

DROP TRIGGER IF EXISTS trg_movements_immutable_upd ON stock_movements;
CREATE TRIGGER trg_movements_immutable_upd
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_immutable();

DROP TRIGGER IF EXISTS trg_movements_immutable_del ON stock_movements;
CREATE TRIGGER trg_movements_immutable_del
  BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_immutable();

-- Running balance maintenance: items.quantity is a cache of the ledger and is
-- only ever written here.
CREATE OR REPLACE FUNCTION trg_movements_apply_qty() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  UPDATE items
     SET quantity = quantity
                  + CASE NEW.type WHEN 'IN' THEN NEW.quantity ELSE -NEW.quantity END,
         updated_at = iso_now()
   WHERE id = NEW.item_id AND org_id = NEW.org_id;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_movements_apply_qty ON stock_movements;
CREATE TRIGGER trg_movements_apply_qty
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION trg_movements_apply_qty();

-- --------------------------------------------------------- stock_count_lines
CREATE TABLE IF NOT EXISTS stock_count_lines (
  id                   text PRIMARY KEY,
  org_id               uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  stock_count_id       text NOT NULL,
  item_id              text NOT NULL,
  expected_quantity    integer NOT NULL,
  counted_quantity     integer,
  skipped              integer NOT NULL DEFAULT 0,
  auto_invoice_line_id text,
  note                 text,
  FOREIGN KEY (stock_count_id, org_id) REFERENCES stock_counts(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE CASCADE,
  -- MATCH SIMPLE: unenforced while auto_invoice_line_id is NULL, enforced once set.
  FOREIGN KEY (auto_invoice_line_id, org_id) REFERENCES invoice_lines(id, org_id)
    ON DELETE SET NULL (auto_invoice_line_id)
);
CREATE INDEX IF NOT EXISTS ix_count_lines_session ON stock_count_lines(stock_count_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_count_lines_session_item
  ON stock_count_lines(stock_count_id, item_id);

-- ------------------------------------------------------------------ counters
-- Per-document-type sequence used to mint human-readable numbers, per org.
CREATE TABLE IF NOT EXISTS counters (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  key    text NOT NULL,
  value  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, key)
);

-- ------------------------------------------------------------------ settings
CREATE TABLE IF NOT EXISTS settings (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  key    text NOT NULL,
  value  text NOT NULL,
  PRIMARY KEY (org_id, key)
);

-- ------------------------------------------------------------ import staging
CREATE TABLE IF NOT EXISTS import_batches (
  id         text PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  filename   text,
  payload    text NOT NULL,          -- JSON: parsed + validated rows
  result     text,                   -- JSON: committed outcome + rejected rows
  created_at text NOT NULL DEFAULT iso_now()
);

-- ----------------------------------------------------------------- gallery
-- Product photos: one row per image, many per item.
--
-- `items.image_file` stays as the *primary* photo — it is what every list,
-- dropdown and picker already reads. The trigger below keeps it in sync with
-- the gallery: it is always the image with the lowest `sort_order`. That makes
-- the gallery the source of truth while the cheap single-column read stays
-- valid everywhere.
CREATE TABLE IF NOT EXISTS item_images (
  id         text PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  item_id    text NOT NULL,
  file       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT iso_now(),
  FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_item_images_item ON item_images(item_id, sort_order);

CREATE OR REPLACE FUNCTION trg_item_images_sync_primary() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  target_item text;
  target_org  uuid;
BEGIN
  -- On DELETE the NEW record is unassigned, so it must not be touched at all.
  IF TG_OP = 'DELETE' THEN
    target_item := OLD.item_id;
    target_org  := OLD.org_id;
  ELSE
    target_item := NEW.item_id;
    target_org  := NEW.org_id;
  END IF;

  UPDATE items SET image_file = (
    SELECT file FROM item_images
     WHERE item_id = target_item
     ORDER BY sort_order, created_at
     LIMIT 1
  ) WHERE id = target_item AND org_id = target_org;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_item_images_aiud ON item_images;
CREATE TRIGGER trg_item_images_aiud
  AFTER INSERT OR UPDATE OR DELETE ON item_images
  FOR EACH ROW EXECUTE FUNCTION trg_item_images_sync_primary();
