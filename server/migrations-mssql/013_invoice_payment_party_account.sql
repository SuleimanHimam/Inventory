-- ============================================================================
--  Cash vs. credit invoices, and per-party accounts.
--
--  An invoice is now نقدي (cash) or آجل (credit): a cash sale moves the cash
--  box, a credit sale moves the customer's own account (a receivable), and the
--  mirror for purchases against a supplier's account (a payable). `payment_type`
--  records which, defaulting to CASH so every existing invoice keeps its meaning.
--
--  For "the customer's account" to mean something, each customer and supplier
--  can carry `account_id` — a leaf under the العملاء / موردون parent — which the
--  posting path credits/debits on a credit invoice. Nullable: a party without a
--  linked account (or a cash invoice) falls back to the cash account.
-- ============================================================================

ALTER TABLE invoices
  ADD payment_type nvarchar(10) NOT NULL
      CONSTRAINT df_invoices_payment_type DEFAULT 'CASH';
GO
ALTER TABLE invoices
  ADD CONSTRAINT ck_invoices_payment_type CHECK (payment_type IN ('CASH', 'CREDIT'));
GO

ALTER TABLE customers ADD account_id nvarchar(64) NULL;
GO
ALTER TABLE suppliers ADD account_id nvarchar(64) NULL;
GO

-- Tenant-safe links: a party's account must live in the same file.
ALTER TABLE customers
  ADD CONSTRAINT fk_customers_account FOREIGN KEY (account_id, org_id)
      REFERENCES accounts (id, org_id);
GO
ALTER TABLE suppliers
  ADD CONSTRAINT fk_suppliers_account FOREIGN KEY (account_id, org_id)
      REFERENCES accounts (id, org_id);
GO
