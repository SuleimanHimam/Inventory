-- Custom roles with a per-screen permission grid.
--
-- Until now a member's role was one of three fixed strings on `memberships`
-- (OWNER/MEMBER/CLERK). This adds:
--   • `roles`            — named roles per file/org. The three fixed ones are
--                          seeded as built-ins (is_builtin=1, builtin_key set);
--                          a manager can add more.
--   • `role_permissions` — one row per (role, screen), with the core actions
--                          view/add/edit/delete and the see-prices flag.
--   • memberships.role_id — which role a member has. NULL falls back to the
--                          fixed `role` string, so nothing changes until a role
--                          is actually assigned.
--
-- Seeding of the built-in roles and their permissions is done per-org by the
-- service (ensureRoles), the same ensure-on-first-use pattern the chart of
-- accounts uses — a migration runs once per database, but roles are per-org.

IF OBJECT_ID('dbo.roles') IS NULL
CREATE TABLE roles (
  id          uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
  org_id      uniqueidentifier NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        nvarchar(80) NOT NULL,
  is_builtin  bit NOT NULL DEFAULT 0,
  builtin_key nvarchar(20) NULL,
  created_at  nvarchar(24) NOT NULL DEFAULT (dbo.iso_now()),
  updated_at  nvarchar(24) NOT NULL DEFAULT (dbo.iso_now())
);
GO

-- One built-in row per key per org.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_roles_builtin')
CREATE UNIQUE INDEX ux_roles_builtin ON roles(org_id, builtin_key) WHERE builtin_key IS NOT NULL;
GO

IF OBJECT_ID('dbo.role_permissions') IS NULL
CREATE TABLE role_permissions (
  id             uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
  -- org_id is a plain column (no FK): role_permissions already cascades from
  -- roles, and a second cascade path to orgs is what SQL Server refuses.
  org_id         uniqueidentifier NOT NULL,
  role_id        uniqueidentifier NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource       nvarchar(40) NOT NULL,
  can_view       bit NOT NULL DEFAULT 0,
  can_add        bit NOT NULL DEFAULT 0,
  can_edit       bit NOT NULL DEFAULT 0,
  can_delete     bit NOT NULL DEFAULT 0,
  can_see_prices bit NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_role_perm')
CREATE UNIQUE INDEX ux_role_perm ON role_permissions(role_id, resource);
GO

IF COL_LENGTH('memberships', 'role_id') IS NULL
ALTER TABLE memberships ADD role_id uniqueidentifier NULL;
GO
