-- ============================================================================
--  Manager notes become many, searchable, per file.
--
--  009 gave each org a single note (one row, org_id as the key). The manager
--  wants several, with search and a pinned filter, so the table is rebuilt with
--  its own id per note. 009 shipped but its route was never live (it needed a
--  restart that had not happened), so there is nothing to migrate -- the table
--  is dropped and recreated rather than carried over.
-- ============================================================================
IF OBJECT_ID('dbo.manager_notes', 'U') IS NOT NULL DROP TABLE manager_notes;
GO

CREATE TABLE manager_notes (
  id         nvarchar(64) NOT NULL PRIMARY KEY,
  org_id     uniqueidentifier NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title      nvarchar(200) NOT NULL DEFAULT (N''),
  body       nvarchar(max) NOT NULL DEFAULT (N''),
  pinned     bit NOT NULL DEFAULT (0),
  created_at nvarchar(40) NOT NULL DEFAULT (dbo.iso_now()),
  updated_at nvarchar(40) NOT NULL DEFAULT (dbo.iso_now())
);
GO
CREATE INDEX ix_manager_notes_org ON manager_notes(org_id, pinned, updated_at);
GO
