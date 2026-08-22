-- ============================================================================
--  Inventory Management System — SQL Server schema (T-SQL port of the
--  PostgreSQL schema, migrations 001/004/005/006/007; 002/003 (Postgres RLS)
--  intentionally not ported — tenant isolation relies solely on the
--  already-complete application-level org_id predicate on every query).
-- ============================================================================
-- No USE statement here on purpose: the migration runner connects to the
-- target database via DB_NAME (see db/index.js), and a hardcoded USE would
-- silently redirect every batch to whatever database happens to be named
-- that — including a differently-named dev/test database — regardless of
-- which one the connection was actually opened against.
GO

-- ---------------------------------------------------------------- helpers
CREATE FUNCTION dbo.iso_now() RETURNS nvarchar(24)
AS
BEGIN
  RETURN CONVERT(nvarchar(23), SYSUTCDATETIME(), 126) + 'Z';
END
GO

CREATE FUNCTION dbo.iso_today() RETURNS nvarchar(10)
AS
BEGIN
  RETURN CONVERT(nvarchar(10), SYSUTCDATETIME(), 23);
END
GO

-- ------------------------------------------------------------------- tenancy
CREATE TABLE orgs (
  id         uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
  name       nvarchar(max) NOT NULL,
  created_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now())
);
GO

CREATE TABLE memberships (
  id         uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
  org_id     uniqueidentifier NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    uniqueidentifier NOT NULL,
  email      nvarchar(max) NULL,
  role       nvarchar(20) NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'MEMBER')),
  created_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now())
);
CREATE UNIQUE INDEX ux_memberships_user ON memberships(user_id);
CREATE INDEX ix_memberships_org ON memberships(org_id);
GO

-- Local (non-Supabase) accounts. Global, no org_id — mirrors 007_local_users.sql.
CREATE TABLE users (
  id            uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
  email         nvarchar(320) NOT NULL,
  password_hash nvarchar(200) NOT NULL,
  created_at    nvarchar(24) NOT NULL DEFAULT (dbo.iso_now())
);
CREATE UNIQUE INDEX ux_users_email ON users(email);
GO

-- ---------------------------------------------------------------- categories
CREATE TABLE categories (
  id         nvarchar(64) NOT NULL PRIMARY KEY,
  org_id     uniqueidentifier NOT NULL,
  name       nvarchar(400) NOT NULL,
  created_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  CONSTRAINT ux_categories_id_org UNIQUE (id, org_id),
  CONSTRAINT fk_categories_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ux_categories_name ON categories(org_id, name);
GO

-- --------------------------------------------------------------------- items
CREATE TABLE items (
  id                  nvarchar(64) NOT NULL PRIMARY KEY,
  org_id              uniqueidentifier NOT NULL,
  name                nvarchar(400) NOT NULL,
  category_id         nvarchar(64) NULL,
  barcode             nvarchar(200) COLLATE Latin1_General_100_BIN2 NULL,
  purchase_price      float NOT NULL DEFAULT 0,
  sale_price          float NOT NULL DEFAULT 0,
  low_stock_threshold int NULL,
  image_file          nvarchar(max) NULL,
  quantity            int NOT NULL DEFAULT 0,
  source              nvarchar(20) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT')),
  deleted_at          nvarchar(24) NULL,
  created_at          nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  updated_at          nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  weight_kg           float NULL,
  length_cm           float NULL,
  width_cm            float NULL,
  height_cm           float NULL,
  cbm_m3              float NULL,
  CONSTRAINT ux_items_id_org UNIQUE (id, org_id),
  -- Direct link to orgs kept NO ACTION: items already cascades from orgs via
  -- this single path; this is the primary (only) cascade path for this table.
  CONSTRAINT fk_items_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  -- No physical FK for category_id: a FK here (even NO ACTION) blocks
  -- deleting a still-referenced category before trg_categories_null_refs
  -- (below) gets a chance to null this column out -- SQL Server has no "let
  -- the delete through, a trigger will clean up" FK mode. The trigger is the
  -- only enforcement for this relationship now (same-org validation on
  -- write is no longer physically enforced here either, but the app always
  -- resolves category_id within the request's own org context already).
  CONSTRAINT chk_items_weight_nonneg CHECK (weight_kg IS NULL OR weight_kg >= 0),
  CONSTRAINT chk_items_dims_nonneg CHECK (
    (length_cm IS NULL OR length_cm >= 0) AND
    (width_cm  IS NULL OR width_cm  >= 0) AND
    (height_cm IS NULL OR height_cm >= 0)),
  CONSTRAINT chk_items_cbm_nonneg CHECK (cbm_m3 IS NULL OR cbm_m3 >= 0)
);
-- Filtered: SQL Server's non-filtered unique index allows only one NULL,
-- unlike Postgres where any number of NULLs are never considered equal.
CREATE UNIQUE INDEX ux_items_barcode ON items(org_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX ix_items_category ON items(category_id);
-- No lower() wrapping needed: database collation (Arabic_CI_AS) is already
-- case-insensitive, unlike the barcode column above which overrides it.
CREATE INDEX ix_items_name ON items(org_id, name);
CREATE INDEX ix_items_live ON items(org_id, deleted_at);
GO

-- -------------------------------------------------------------- sub_barcodes
CREATE TABLE sub_barcodes (
  id         nvarchar(64) NOT NULL PRIMARY KEY,
  org_id     uniqueidentifier NOT NULL,
  item_id    nvarchar(64) NOT NULL,
  barcode    nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  label      nvarchar(max) NULL,
  created_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  -- Direct org_id link is NO ACTION: this table also cascades from orgs
  -- indirectly via items, and SQL Server rejects two cascade paths to the
  -- same target. The item_id CASCADE below is the one real delete path.
  CONSTRAINT fk_sub_barcodes_org FOREIGN KEY (org_id) REFERENCES orgs(id),
  CONSTRAINT fk_sub_barcodes_item FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ux_sub_barcodes_barcode ON sub_barcodes(org_id, barcode);
CREATE INDEX ix_sub_barcodes_item ON sub_barcodes(item_id);
GO

-- --------------------------------------------------------------- item_units
CREATE TABLE item_units (
  id                nvarchar(64) NOT NULL PRIMARY KEY,
  org_id            uniqueidentifier NOT NULL,
  item_id           nvarchar(64) NOT NULL,
  name              nvarchar(max) NOT NULL,
  barcode           nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  conversion_factor float NOT NULL,
  purchase_price    float NOT NULL DEFAULT 0,
  sale_price        float NOT NULL DEFAULT 0,
  weight_kg         float NULL,
  length_cm         float NULL,
  width_cm          float NULL,
  height_cm         float NULL,
  cbm_m3            float NULL,
  created_at        nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  updated_at        nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  CONSTRAINT ux_item_units_id_org UNIQUE (id, org_id),
  -- Same multi-path reasoning as sub_barcodes above.
  CONSTRAINT fk_item_units_org FOREIGN KEY (org_id) REFERENCES orgs(id),
  CONSTRAINT fk_item_units_item FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE CASCADE,
  CONSTRAINT chk_item_units_factor_positive CHECK (conversion_factor > 0),
  CONSTRAINT chk_item_units_weight_nonneg CHECK (weight_kg IS NULL OR weight_kg >= 0),
  CONSTRAINT chk_item_units_dims_nonneg CHECK (
    (length_cm IS NULL OR length_cm >= 0) AND
    (width_cm  IS NULL OR width_cm  >= 0) AND
    (height_cm IS NULL OR height_cm >= 0)),
  CONSTRAINT chk_item_units_cbm_nonneg CHECK (cbm_m3 IS NULL OR cbm_m3 >= 0)
);
CREATE UNIQUE INDEX ux_item_units_barcode ON item_units(org_id, barcode);
CREATE INDEX ix_item_units_org_item ON item_units(org_id, item_id);
GO

-- ----------------------------------------------------------------- customers
CREATE TABLE customers (
  id         nvarchar(64) NOT NULL PRIMARY KEY,
  org_id     uniqueidentifier NOT NULL,
  name       nvarchar(400) NOT NULL,
  phone      nvarchar(max) NULL,
  email      nvarchar(max) NULL,
  address    nvarchar(max) NULL,
  tax_number nvarchar(max) NULL,
  notes      nvarchar(max) NULL,
  is_active  int NOT NULL DEFAULT 1,
  created_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  updated_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  CONSTRAINT ux_customers_id_org UNIQUE (id, org_id),
  CONSTRAINT fk_customers_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
CREATE INDEX ix_customers_name ON customers(org_id, name);
GO

-- ----------------------------------------------------------------- suppliers
CREATE TABLE suppliers (
  id             nvarchar(64) NOT NULL PRIMARY KEY,
  org_id         uniqueidentifier NOT NULL,
  name           nvarchar(400) NOT NULL,
  contact_person nvarchar(max) NULL,
  phone          nvarchar(max) NULL,
  email          nvarchar(max) NULL,
  address        nvarchar(max) NULL,
  tax_number     nvarchar(max) NULL,
  notes          nvarchar(max) NULL,
  is_active      int NOT NULL DEFAULT 1,
  created_at     nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  updated_at     nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  CONSTRAINT ux_suppliers_id_org UNIQUE (id, org_id),
  CONSTRAINT fk_suppliers_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
CREATE INDEX ix_suppliers_name ON suppliers(org_id, name);
GO

-- -------------------------------------------------------------- stock_counts
CREATE TABLE stock_counts (
  id           nvarchar(64) NOT NULL PRIMARY KEY,
  org_id       uniqueidentifier NOT NULL,
  number       nvarchar(64) NOT NULL,
  scope        nvarchar(20) NOT NULL CHECK (scope IN ('ALL', 'CATEGORY', 'ITEM')),
  category_id  nvarchar(64) NULL,
  item_id      nvarchar(64) NULL,
  status       nvarchar(20) NOT NULL DEFAULT 'OPEN'
               CHECK (status IN ('OPEN', 'SUBMITTED', 'APPLIED', 'CANCELLED')),
  created_by   nvarchar(max) NOT NULL DEFAULT 'system',
  created_at   nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  submitted_at nvarchar(24) NULL,
  applied_at   nvarchar(24) NULL,
  CONSTRAINT ux_stock_counts_id_org UNIQUE (id, org_id),
  CONSTRAINT fk_stock_counts_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
  -- No physical FK for category_id/item_id: see the comment on items.category_id
  -- above. trg_categories_null_refs / trg_items_null_refs (below) are the only
  -- enforcement now -- a plain FK would block deleting a still-referenced
  -- category/item before those triggers get a chance to null this out.
);
CREATE UNIQUE INDEX ux_stock_counts_number ON stock_counts(org_id, number);
CREATE INDEX ix_stock_counts_status ON stock_counts(org_id, status);
GO

-- ------------------------------------------------------------------ invoices
CREATE TABLE invoices (
  id             nvarchar(64) NOT NULL PRIMARY KEY,
  org_id         uniqueidentifier NOT NULL,
  type           nvarchar(20) NOT NULL CHECK (type IN ('STOCK_IN', 'STOCK_OUT')),
  number         nvarchar(64) NOT NULL,
  supplier_id    nvarchar(64) NULL,
  customer_id    nvarchar(64) NULL,
  status         nvarchar(20) NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  source         nvarchar(20) NOT NULL DEFAULT 'USER'
                 CHECK (source IN ('USER', 'QUICK', 'STOCK_COUNT', 'IMPORT')),
  invoice_date   nvarchar(10) NOT NULL DEFAULT (dbo.iso_today()),
  discount_total float NOT NULL DEFAULT 0,
  tax_total      float NOT NULL DEFAULT 0,
  note           nvarchar(max) NULL,
  stock_count_id nvarchar(64) NULL,
  created_by     nvarchar(max) NOT NULL DEFAULT 'system',
  created_at     nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  posted_at      nvarchar(24) NULL,
  CONSTRAINT ux_invoices_id_org UNIQUE (id, org_id),
  CONSTRAINT fk_invoices_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
  -- No physical FK for supplier_id/customer_id/stock_count_id: see the
  -- comment on items.category_id above. trg_suppliers_null_refs /
  -- trg_customers_null_refs / trg_stock_counts_null_refs (below) are the
  -- only enforcement now.
);
CREATE UNIQUE INDEX ux_invoices_number ON invoices(org_id, number);
CREATE INDEX ix_invoices_type_status ON invoices(org_id, type, status);
CREATE INDEX ix_invoices_date ON invoices(org_id, invoice_date DESC);
GO

CREATE TABLE invoice_lines (
  id                nvarchar(64) NOT NULL PRIMARY KEY,
  org_id            uniqueidentifier NOT NULL,
  seq               bigint IDENTITY(1,1) NOT NULL,
  invoice_id        nvarchar(64) NOT NULL,
  item_id           nvarchar(64) NOT NULL,
  barcode_scanned   nvarchar(200) NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_price        float NOT NULL DEFAULT 0,
  update_item_price int NOT NULL DEFAULT 1,
  note              nvarchar(max) NULL,
  sort_order        int NOT NULL DEFAULT 0,
  unit_id           nvarchar(64) NULL,
  conversion_factor float NOT NULL DEFAULT 1,
  CONSTRAINT ux_invoice_lines_id_org UNIQUE (id, org_id),
  -- Direct org_id link is NO ACTION: also reaches orgs via invoices (CASCADE).
  CONSTRAINT fk_invoice_lines_org FOREIGN KEY (org_id) REFERENCES orgs(id),
  CONSTRAINT fk_invoice_lines_invoice FOREIGN KEY (invoice_id, org_id) REFERENCES invoices(id, org_id) ON DELETE CASCADE,
  CONSTRAINT fk_invoice_lines_item FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id),
  CONSTRAINT chk_invoice_lines_factor_positive CHECK (conversion_factor > 0)
);
CREATE INDEX ix_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX ix_invoice_lines_item ON invoice_lines(item_id);
CREATE INDEX ix_invoice_lines_unit ON invoice_lines(unit_id);
GO
-- unit_id FK added after item_units exists (item_units is defined above
-- invoices in this file, so this could inline above too, but kept separate to
-- mirror the historical migration order — item_units's FK back to invoice_lines
-- doesn't exist, so no circular dependency either way).
ALTER TABLE invoice_lines ADD CONSTRAINT fk_invoice_lines_unit
  FOREIGN KEY (unit_id, org_id) REFERENCES item_units(id, org_id);
GO

-- ----------------------------------------------------------- stock_movements
CREATE TABLE stock_movements (
  id             nvarchar(64) NOT NULL PRIMARY KEY,
  org_id         uniqueidentifier NOT NULL,
  seq            bigint IDENTITY(1,1) NOT NULL,
  item_id        nvarchar(64) NOT NULL,
  type           nvarchar(10) NOT NULL CHECK (type IN ('IN', 'OUT')),
  quantity       int NOT NULL CHECK (quantity > 0),
  invoice_id     nvarchar(64) NULL,
  reference_type nvarchar(20) NOT NULL DEFAULT 'INVOICE'
                 CHECK (reference_type IN ('MANUAL', 'STOCK_COUNT', 'IMPORT', 'INVOICE')),
  note           nvarchar(max) NULL,
  created_at     nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  CONSTRAINT fk_movements_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  CONSTRAINT fk_movements_item FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id),
  CONSTRAINT fk_movements_invoice FOREIGN KEY (invoice_id, org_id) REFERENCES invoices(id, org_id)
);
CREATE INDEX ix_movements_item ON stock_movements(org_id, item_id, created_at DESC);
CREATE INDEX ix_movements_created ON stock_movements(org_id, created_at DESC);
CREATE INDEX ix_movements_invoice ON stock_movements(invoice_id);
GO

-- --------------------------------------------------------- stock_count_lines
CREATE TABLE stock_count_lines (
  id                   nvarchar(64) NOT NULL PRIMARY KEY,
  org_id               uniqueidentifier NOT NULL,
  stock_count_id       nvarchar(64) NOT NULL,
  item_id              nvarchar(64) NOT NULL,
  expected_quantity    int NOT NULL,
  counted_quantity     int NULL,
  skipped              int NOT NULL DEFAULT 0,
  auto_invoice_line_id nvarchar(64) NULL,
  note                 nvarchar(max) NULL,
  -- Direct org_id link is NO ACTION: reaches orgs via stock_counts (kept
  -- CASCADE below). item_id is ALSO NO ACTION here (not CASCADE, unlike
  -- Postgres) for the same reason — items already cascades from orgs, so a
  -- THIRD cascade path (orgs -> items -> stock_count_lines) would collide
  -- with the stock_counts path; found only once this DDL was actually
  -- drafted, exactly the kind of thing the plan flagged as needing this step.
  CONSTRAINT fk_count_lines_org FOREIGN KEY (org_id) REFERENCES orgs(id),
  CONSTRAINT fk_count_lines_stock_count FOREIGN KEY (stock_count_id, org_id) REFERENCES stock_counts(id, org_id) ON DELETE CASCADE,
  CONSTRAINT fk_count_lines_item FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id)
  -- No physical FK for auto_invoice_line_id: see the comment on
  -- items.category_id above. trg_invoice_lines_null_refs (below) is the
  -- only enforcement now.
);
CREATE INDEX ix_count_lines_session ON stock_count_lines(stock_count_id);
CREATE UNIQUE INDEX ux_count_lines_session_item ON stock_count_lines(stock_count_id, item_id);
GO

-- ------------------------------------------------------------------ counters
CREATE TABLE counters (
  org_id uniqueidentifier NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  [key]  nvarchar(64) NOT NULL,
  value  int NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, [key])
);
GO

-- ------------------------------------------------------------------ settings
CREATE TABLE settings (
  org_id uniqueidentifier NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  [key]  nvarchar(64) NOT NULL,
  value  nvarchar(max) NOT NULL,
  PRIMARY KEY (org_id, [key])
);
GO

-- ------------------------------------------------------------ import staging
CREATE TABLE import_batches (
  id         nvarchar(64) NOT NULL PRIMARY KEY,
  org_id     uniqueidentifier NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  filename   nvarchar(max) NULL,
  payload    nvarchar(max) NOT NULL,
  result     nvarchar(max) NULL,
  created_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now())
);
GO

-- ----------------------------------------------------------------- gallery
CREATE TABLE item_images (
  id         nvarchar(64) NOT NULL PRIMARY KEY,
  org_id     uniqueidentifier NOT NULL,
  item_id    nvarchar(64) NOT NULL,
  [file]     nvarchar(max) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  -- Same multi-path reasoning as sub_barcodes/item_units.
  CONSTRAINT fk_item_images_org FOREIGN KEY (org_id) REFERENCES orgs(id),
  CONSTRAINT fk_item_images_item FOREIGN KEY (item_id, org_id) REFERENCES items(id, org_id) ON DELETE CASCADE
);
CREATE INDEX ix_item_images_item ON item_images(item_id, sort_order);
GO
