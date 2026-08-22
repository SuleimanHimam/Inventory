-- Document numbers are minted when an invoice is SAVED, not when the entry
-- screen opens.
--
-- Previously `createInvoice` called nextNumber(), and the entry screen creates
-- its row on arrival — so every visit to the form, every reload, and every
-- accidental tap on إدخال/إخراج burned a number. The counter reached 137 while
-- the books held zero saved invoices, and the numbers that did survive were
-- full of gaps.
--
-- An unsaved invoice therefore has no number at all now, which is the honest
-- representation: it is not yet a document. That requires the column to be
-- nullable.
--
-- The unique index has to be rebuilt as a FILTERED index to allow it. Unlike
-- Postgres, SQL Server considers two NULLs equal for uniqueness purposes, so
-- the plain index would reject the second unsaved invoice. The same quirk is
-- called out on the barcode columns in 001_core.sql.

DROP INDEX ux_invoices_number ON invoices;
GO

ALTER TABLE invoices ALTER COLUMN number nvarchar(64) NULL;
GO

CREATE UNIQUE INDEX ux_invoices_number ON invoices(org_id, number)
  WHERE number IS NOT NULL;
GO
