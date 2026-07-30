-- ============================================================================
--  SUPERSEDED — nothing loads this file any more.
--
--  The live schema is server/migrations/*.sql (PostgreSQL). This is kept only as
--  the reference for the shape of an existing v5.0 SQLite database: the
--  data-migration sketch in DEPLOYMENT.md reads from it, and a port to
--  Cloudflare D1 (which is SQLite) would start from it. Delete it once neither
--  is on the table.
-- ============================================================================

-- ============================================================================
--  Inventory Management System — SQLite schema (v5.0)
--  Money is stored as REAL rounded to 2 decimals by the service layer.
--  Timestamps are ISO-8601 UTC strings.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- categories
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_name ON categories(name);

-- --------------------------------------------------------------------- items
CREATE TABLE IF NOT EXISTS items (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  category_id         TEXT REFERENCES categories(id) ON DELETE SET NULL,
  barcode             TEXT NOT NULL,
  purchase_price      REAL NOT NULL DEFAULT 0,
  sale_price          REAL NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER,                       -- NULL => use global setting
  -- Stored filename of the product photo, resolved against the uploads dir.
  -- Never a full path: the database must stay portable between machines.
  image_file          TEXT,
  -- Cached running balance. Maintained exclusively by triggers on
  -- stock_movements, which is an append-only ledger, so it can never drift.
  quantity            INTEGER NOT NULL DEFAULT 0,
  source              TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','IMPORT')),
  deleted_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_barcode ON items(barcode);
CREATE INDEX IF NOT EXISTS ix_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS ix_items_name ON items(name);
CREATE INDEX IF NOT EXISTS ix_items_live ON items(deleted_at);

-- -------------------------------------------------------------- sub_barcodes
CREATE TABLE IF NOT EXISTS sub_barcodes (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  barcode    TEXT NOT NULL,
  label      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_barcodes_barcode ON sub_barcodes(barcode);
CREATE INDEX IF NOT EXISTS ix_sub_barcodes_item ON sub_barcodes(item_id);

-- Business rule: a barcode value must be unique ACROSS both tables.
-- Enforced at the DB level so no code path can bypass it.
CREATE TRIGGER IF NOT EXISTS trg_item_barcode_unique_ins
BEFORE INSERT ON items
WHEN EXISTS (SELECT 1 FROM sub_barcodes WHERE barcode = NEW.barcode)
BEGIN SELECT RAISE(ABORT, 'BARCODE_TAKEN'); END;

CREATE TRIGGER IF NOT EXISTS trg_item_barcode_unique_upd
BEFORE UPDATE OF barcode ON items
WHEN NEW.barcode <> OLD.barcode
 AND EXISTS (SELECT 1 FROM sub_barcodes WHERE barcode = NEW.barcode)
BEGIN SELECT RAISE(ABORT, 'BARCODE_TAKEN'); END;

CREATE TRIGGER IF NOT EXISTS trg_sub_barcode_unique_ins
BEFORE INSERT ON sub_barcodes
WHEN EXISTS (SELECT 1 FROM items WHERE barcode = NEW.barcode)
BEGIN SELECT RAISE(ABORT, 'BARCODE_TAKEN'); END;

CREATE TRIGGER IF NOT EXISTS trg_sub_barcode_unique_upd
BEFORE UPDATE OF barcode ON sub_barcodes
WHEN NEW.barcode <> OLD.barcode
 AND EXISTS (SELECT 1 FROM items WHERE barcode = NEW.barcode)
BEGIN SELECT RAISE(ABORT, 'BARCODE_TAKEN'); END;

-- ----------------------------------------------------------------- customers
CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  tax_number TEXT,
  notes      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_customers_name ON customers(name);

-- ----------------------------------------------------------------- suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  tax_number     TEXT,
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_suppliers_name ON suppliers(name);

-- --------------------------------------------------------------- stock_counts
CREATE TABLE IF NOT EXISTS stock_counts (
  id           TEXT PRIMARY KEY,
  number       TEXT NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('ALL','CATEGORY','ITEM')),
  category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  item_id      TEXT REFERENCES items(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'OPEN'
               CHECK (status IN ('OPEN','SUBMITTED','APPLIED','CANCELLED')),
  created_by   TEXT NOT NULL DEFAULT 'system',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  submitted_at TEXT,
  applied_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_counts_number ON stock_counts(number);
CREATE INDEX IF NOT EXISTS ix_stock_counts_status ON stock_counts(status);

-- ---------------------------------------------------------------- invoices
CREATE TABLE IF NOT EXISTS invoices (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type IN ('STOCK_IN','STOCK_OUT','PURCHASE','SALE')),
  number         TEXT NOT NULL,
  supplier_id    TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  customer_id    TEXT REFERENCES customers(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
  -- Who/what produced this document. Drives the "system generated" badge.
  source         TEXT NOT NULL DEFAULT 'USER'
                 CHECK (source IN ('USER','QUICK','STOCK_COUNT','IMPORT')),
  invoice_date   TEXT NOT NULL DEFAULT (date('now')),
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total      REAL NOT NULL DEFAULT 0,
  note           TEXT,
  stock_count_id TEXT REFERENCES stock_counts(id) ON DELETE SET NULL,
  created_by     TEXT NOT NULL DEFAULT 'system',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  posted_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_number ON invoices(number);
CREATE INDEX IF NOT EXISTS ix_invoices_type_status ON invoices(type, status);
CREATE INDEX IF NOT EXISTS ix_invoices_date ON invoices(invoice_date DESC);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id           TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  barcode_scanned   TEXT,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price        REAL NOT NULL DEFAULT 0,
  update_item_price INTEGER NOT NULL DEFAULT 1,
  note              TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS ix_invoice_lines_item ON invoice_lines(item_id);

-- ---------------------------------------------------------- stock_movements
-- Append-only ledger. Updates and deletes are blocked by triggers.
CREATE TABLE IF NOT EXISTS stock_movements (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  type           TEXT NOT NULL CHECK (type IN ('IN','OUT')),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  invoice_id     TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  reference_type TEXT NOT NULL DEFAULT 'INVOICE'
                 CHECK (reference_type IN ('MANUAL','STOCK_COUNT','IMPORT','INVOICE')),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_movements_item ON stock_movements(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_movements_created ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_movements_invoice ON stock_movements(invoice_id);

CREATE TRIGGER IF NOT EXISTS trg_movements_immutable_upd
BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_movements_immutable_del
BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;

-- Running balance maintenance.
CREATE TRIGGER IF NOT EXISTS trg_movements_apply_qty
AFTER INSERT ON stock_movements
BEGIN
  UPDATE items
     SET quantity = quantity + (CASE NEW.type WHEN 'IN' THEN NEW.quantity ELSE -NEW.quantity END),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = NEW.item_id;
END;

-- ----------------------------------------------------------- stock_count_lines
CREATE TABLE IF NOT EXISTS stock_count_lines (
  id                   TEXT PRIMARY KEY,
  stock_count_id       TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id              TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  expected_quantity    INTEGER NOT NULL,
  counted_quantity     INTEGER,
  skipped              INTEGER NOT NULL DEFAULT 0,
  auto_invoice_line_id TEXT REFERENCES invoice_lines(id) ON DELETE SET NULL,
  note                 TEXT
);
CREATE INDEX IF NOT EXISTS ix_count_lines_session ON stock_count_lines(stock_count_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_count_lines_session_item
  ON stock_count_lines(stock_count_id, item_id);

-- ------------------------------------------------------------------ counters
-- Per-document-type sequence used to mint human-readable numbers.
CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ settings
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ------------------------------------------------------------ import staging
CREATE TABLE IF NOT EXISTS import_batches (
  id         TEXT PRIMARY KEY,
  filename   TEXT,
  payload    TEXT NOT NULL,           -- JSON: parsed + validated rows
  result     TEXT,                    -- JSON: committed outcome + rejected rows
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
