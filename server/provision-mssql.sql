-- ============================================================================
-- One-time provisioning for a new SQL Server instance: database, least-
-- privilege app login, and the grants that role needs beyond db_datareader/
-- db_datawriter. Run once as sa (or another sysadmin) before the first
-- `npm run migrate`; migrations themselves run as this same app_api login.
--
-- Arabic_CI_AS was chosen after spot-checking real Arabic sample strings from
-- db/seed.js under a few candidate collations — see the Phase 1 notes. The
-- `barcode` columns override this per-column with a binary collation in
-- 001_core.sql, since barcode matching must stay case-sensitive.
-- ============================================================================
IF DB_ID('inventory') IS NULL
  CREATE DATABASE inventory COLLATE Arabic_CI_AS;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'app_api')
  CREATE LOGIN app_api WITH PASSWORD = N'CHANGE_ME', CHECK_POLICY = ON;
GO

USE inventory;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'app_api')
  CREATE USER app_api FOR LOGIN app_api;
GO
ALTER ROLE db_datareader ADD MEMBER app_api;
ALTER ROLE db_datawriter ADD MEMBER app_api;
-- db/migrate.js runs as this same login (see its header comment), and needs
-- to CREATE/ALTER TABLE/FUNCTION/TRIGGER for every migration from here on —
-- confirmed empirically in Phase 5 (migrate.js failed with "CREATE FUNCTION
-- permission denied" against a fresh database until this was added). This
-- mirrors what the Postgres build's app_api role already had (it ran its own
-- migrations too); it is not a broader grant than before, just this engine's
-- equivalent.
ALTER ROLE db_ddladmin ADD MEMBER app_api;
GO

-- db_datawriter does not cover EXECUTE. iso_now()/iso_today() are called from
-- column DEFAULTs and from trigger bodies (002_triggers.sql), and ownership
-- chaining does NOT extend to scalar functions the way it does to tables —
-- confirmed empirically in Phase 3 (every write failed with "The EXECUTE
-- permission was denied on the object 'iso_now'" until this grant was added).
-- Run this again after 001_core.sql if the functions did not exist yet.
IF OBJECT_ID('dbo.iso_now') IS NOT NULL
  GRANT EXECUTE ON dbo.iso_now TO app_api;
IF OBJECT_ID('dbo.iso_today') IS NOT NULL
  GRANT EXECUTE ON dbo.iso_today TO app_api;
GO
