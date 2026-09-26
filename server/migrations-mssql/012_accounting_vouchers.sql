-- ============================================================================
--  Accounting, part 2 — vouchers and the general ledger.
--
--  A voucher (سند) is a money document: a Cash Receipt (سند قبض, money in) or a
--  Payment (سند صرف, money out). Each one posts a balanced pair of ledger
--  entries into `transactions` — one debit, one credit, of the same amount —
--  so the books are double-entry by construction and can never be one-sided.
--
--  `transactions` is the general ledger every later screen reads: an account's
--  balance is SUM(debit) - SUM(credit) over its rows, and an account statement
--  is those rows for one account over a date range. Vouchers are the only
--  source that writes here today; invoices may join later through `source_type`.
--
--  A voucher is posted the moment it is created — there is no draft — and it is
--  never edited or hard-deleted once it has moved money. A mistake is corrected
--  by reversing it: a compensating pair of entries is written and the voucher
--  is marked REVERSED, so the record of what happened, and of the correction,
--  both survive. Same discipline the invoice ledger already follows.
-- ============================================================================

-- The general ledger. One row is one side of one entry against one account.
-- Debit and credit are kept as separate non-negative columns (not a signed
-- amount) so a statement can print the two columns a bookkeeper expects and so
-- the balanced-pair invariant is visible in the data itself.
CREATE TABLE transactions (
  id          nvarchar(64) NOT NULL PRIMARY KEY,
  org_id      uniqueidentifier NOT NULL,
  seq         bigint IDENTITY(1,1) NOT NULL,
  account_id  nvarchar(64) NOT NULL,
  entry_date  nvarchar(10) NOT NULL DEFAULT (dbo.iso_today()),
  debit       float NOT NULL DEFAULT 0,
  credit      float NOT NULL DEFAULT 0,
  description nvarchar(max) NULL,
  -- What produced this row. VOUCHER today; INVOICE/MANUAL/OPENING are reserved
  -- so the ledger can absorb other sources without another migration.
  source_type nvarchar(20) NOT NULL DEFAULT 'VOUCHER'
              CHECK (source_type IN ('VOUCHER', 'INVOICE', 'MANUAL', 'OPENING')),
  source_id   nvarchar(64) NULL,
  created_by  nvarchar(max) NOT NULL DEFAULT 'system',
  created_at  nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  CONSTRAINT ck_transactions_signs CHECK (debit >= 0 AND credit >= 0),
  -- Each row is exactly one side of an entry: never both, never neither.
  CONSTRAINT ck_transactions_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  CONSTRAINT ux_transactions_id_org UNIQUE (id, org_id),
  CONSTRAINT fk_transactions_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  -- Tenant-safe: an entry can only touch an account in its own file.
  CONSTRAINT fk_transactions_account FOREIGN KEY (account_id, org_id)
    REFERENCES accounts (id, org_id)
);
GO
CREATE INDEX ix_transactions_account ON transactions (org_id, account_id, entry_date);
CREATE INDEX ix_transactions_source ON transactions (org_id, source_type, source_id);
CREATE INDEX ix_transactions_date ON transactions (org_id, entry_date DESC);
GO

-- The voucher document. `cash_account_id` is the money account (a صندوق/بنك
-- leaf) and `counter_account_id` is the other side (the customer, supplier or
-- expense account). Which one is debited and which credited is decided by
-- `type` in the service, not stored, so the two can never disagree.
CREATE TABLE vouchers (
  id                 nvarchar(64) NOT NULL PRIMARY KEY,
  org_id             uniqueidentifier NOT NULL,
  type               nvarchar(20) NOT NULL CHECK (type IN ('RECEIPT', 'PAYMENT')),
  number             nvarchar(64) NOT NULL,
  voucher_date       nvarchar(10) NOT NULL DEFAULT (dbo.iso_today()),
  cash_account_id    nvarchar(64) NOT NULL,
  counter_account_id nvarchar(64) NOT NULL,
  amount             float NOT NULL CHECK (amount > 0),
  -- Optional link to a party, kept polymorphic (customer or supplier) the same
  -- way invoices reference parties: no physical FK, just the pair of columns.
  party_type         nvarchar(20) NULL CHECK (party_type IN ('customer', 'supplier')),
  party_id           nvarchar(64) NULL,
  -- Free-text "received from / paid to", for when there is no party record.
  counterparty       nvarchar(400) NULL,
  payment_method     nvarchar(30) NOT NULL DEFAULT 'CASH'
                     CHECK (payment_method IN ('CASH', 'BANK', 'CHEQUE', 'TRANSFER')),
  reference          nvarchar(200) NULL,   -- cheque no. / transfer ref.
  description        nvarchar(max) NULL,
  status             nvarchar(20) NOT NULL DEFAULT 'POSTED'
                     CHECK (status IN ('POSTED', 'REVERSED')),
  reversed_at        nvarchar(24) NULL,
  reversed_by        nvarchar(max) NULL,
  reversal_of        nvarchar(64) NULL,    -- set on the compensating voucher
  created_by         nvarchar(max) NOT NULL DEFAULT 'system',
  created_at         nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  CONSTRAINT ux_vouchers_id_org UNIQUE (id, org_id),
  CONSTRAINT ux_vouchers_number UNIQUE (org_id, number),
  CONSTRAINT fk_vouchers_org FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  CONSTRAINT fk_vouchers_cash FOREIGN KEY (cash_account_id, org_id)
    REFERENCES accounts (id, org_id),
  CONSTRAINT fk_vouchers_counter FOREIGN KEY (counter_account_id, org_id)
    REFERENCES accounts (id, org_id)
);
GO
CREATE INDEX ix_vouchers_type_status ON vouchers (org_id, type, status);
CREATE INDEX ix_vouchers_date ON vouchers (org_id, voucher_date DESC);
CREATE INDEX ix_vouchers_party ON vouchers (org_id, party_type, party_id);
GO
