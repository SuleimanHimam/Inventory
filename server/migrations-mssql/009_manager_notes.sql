-- ============================================================================
--  The manager's private notepad.
--
--  One free-text note per file (per org), written and read only by a manager
--  (see the requireManager guard on /notes in meta.routes.js). Deliberately
--  NOT kept in the settings table: GET /settings is readable by every role, so
--  a note there would be visible to staff and clerks -- the opposite of
--  "just the manager".
--
--  One row per org, created on first save.
-- ============================================================================
CREATE TABLE manager_notes (
  org_id     uniqueidentifier NOT NULL PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  body       nvarchar(max) NOT NULL DEFAULT (N''),
  updated_at nvarchar(40) NOT NULL DEFAULT (dbo.iso_now())
);
GO
