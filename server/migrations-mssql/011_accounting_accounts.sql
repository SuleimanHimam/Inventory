-- ============================================================================
--  Accounting, part 1 — the Chart of Accounts.
--
--  A dynamic, unlimited-depth tree: each account points at its parent through
--  `parent_account_id`, never through fixed Level1/Level2 columns. The seed for
--  a new file is the customer's default chart (see db/accounts.seed.js), applied
--  idempotently on (org_id, account_number).
--
--  Tenant-safe self-reference: parent is matched on (parent_account_id, org_id)
--  -> (id, org_id), the same composite-FK pattern the rest of the schema uses,
--  so an account can never parent to another file's account.
-- ============================================================================

-- The kinds of account. Small and org-scoped so a file can add its own later;
-- seeded with the standard set (see db/index.js DEFAULT_ACCOUNT_TYPES).
CREATE TABLE account_types (
  id         nvarchar(64) NOT NULL PRIMARY KEY,
  org_id     uniqueidentifier NOT NULL,
  code       nvarchar(30) NOT NULL,
  name       nvarchar(100) NOT NULL,
  created_at nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  CONSTRAINT ux_account_types_id_org UNIQUE (id, org_id),
  CONSTRAINT ux_account_types_code UNIQUE (org_id, code),
  CONSTRAINT fk_account_types_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
GO

CREATE TABLE accounts (
  id                nvarchar(64) NOT NULL PRIMARY KEY,
  org_id            uniqueidentifier NOT NULL,
  account_number    nvarchar(50) NOT NULL,
  name              nvarchar(400) NOT NULL,
  parent_account_id nvarchar(64) NULL,
  account_type_id   nvarchar(64) NULL,
  is_posting        bit NOT NULL DEFAULT 0,
  is_active         bit NOT NULL DEFAULT 1,
  statement_section nvarchar(100) NULL,
  description       nvarchar(max) NULL,
  created_at        nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  created_by        uniqueidentifier NULL,
  updated_at        nvarchar(24) NULL,
  updated_by        uniqueidentifier NULL,
  CONSTRAINT ux_accounts_id_org UNIQUE (id, org_id),
  CONSTRAINT ux_accounts_number UNIQUE (org_id, account_number),
  CONSTRAINT fk_accounts_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  -- Tenant-safe parent: NO ACTION because a tree cannot cascade in SQL Server,
  -- and the app forbids deleting a parent that still has children anyway.
  CONSTRAINT fk_accounts_parent FOREIGN KEY (parent_account_id, org_id)
    REFERENCES accounts (id, org_id),
  CONSTRAINT fk_accounts_type FOREIGN KEY (account_type_id, org_id)
    REFERENCES account_types (id, org_id)
);
GO
CREATE INDEX ix_accounts_parent ON accounts (org_id, parent_account_id);
CREATE INDEX ix_accounts_active ON accounts (org_id, is_active);
CREATE INDEX ix_accounts_type ON accounts (org_id, account_type_id);
GO
