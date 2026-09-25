-- ============================================================================
--  A file names itself.
--
--  Each "file" (ملف) is now a database of its own — its own items, its own
--  users, its own backups. The display name the manager gave it lives HERE,
--  inside the file, and not in a central registry, for one operational
--  reason: a `.bak` is the unit customers copy between machines. Restored
--  anywhere, a file that carries its own name appears in the picker correctly
--  with no registry row to repair by hand. A catalogue outside the file would
--  have to be reconciled after every restore, and would be wrong in exactly
--  the moment it mattered.
--
--  One row, enforced by the CHECK — this table describes the database it
--  lives in, and there is only ever one of those.
-- ============================================================================
CREATE TABLE file_info (
  id         int NOT NULL PRIMARY KEY CHECK (id = 1),
  name       nvarchar(200) NOT NULL,
  created_at nvarchar(40) NOT NULL DEFAULT (dbo.iso_now())
);
GO

-- An existing deployment is already a file — the first one. It is named after
-- whatever the company called itself in settings, so the picker shows
-- something the operator recognises on the very first run rather than a
-- placeholder they have to go and fix.
INSERT INTO file_info (id, name)
SELECT 1, COALESCE(
  (SELECT TOP 1 value FROM settings WHERE [key] = 'company_name' AND value <> ''),
  N'الملف الرئيسي');
GO
