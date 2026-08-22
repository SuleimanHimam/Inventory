-- ============================================================================
-- Lets the application take backups, and (optionally) restore them, from the
-- backup screen in the UI.
--
-- PREFER deploy\windows\enable-backup.ps1 OVER THIS FILE.
--
-- That script does everything below *and* the two things SQL alone cannot: it
-- grants the SQL Server service account write access to the backup folder
-- (BACKUP DATABASE runs inside that process, so without it every backup fails
-- with "Operating system error 5"), and it proves the whole path by writing
-- and deleting a real test backup. It also looks at what else lives on the
-- instance before granting the server-level role in Part 2, which a static
-- script cannot do.
--
-- This file remains for SSMS, for an instance with no PowerShell access, and
-- as the readable statement of what is actually being granted.
--
-- Run once as sa (or another sysadmin) on the SQL Server instance:
--
--   sqlcmd -S 127.0.0.1\INVENTORY -E -C -i grant-backup.sql
--
-- provision-mssql.sql deliberately gives app_api nothing beyond
-- db_datareader + db_datawriter + db_ddladmin, which covers everything the
-- application itself does. Backup and restore are not that, so they are opted
-- into here rather than granted by default.
--
-- The two halves are very different in what they cost, which is why they are
-- separate statements and why the second one is commented out.
-- ============================================================================

USE inventory;
GO

-- ---------------------------------------------------------------------------
-- PART 1 — Backup, export and import.  Safe.
-- ---------------------------------------------------------------------------
-- db_backupoperator is the least-privilege role for this: it permits BACKUP
-- DATABASE, BACKUP LOG, and the RESTORE HEADERONLY / FILELISTONLY / VERIFYONLY
-- reads used to validate an uploaded file. It grants no ability to read or
-- change data that app_api does not already have, and nothing at all outside
-- this database.
--
-- With this alone the backup screen can: take a backup, download one, upload
-- one, verify it, and delete it. Restoring stays disabled and says why.
ALTER ROLE db_backupoperator ADD MEMBER app_api;
GO

-- ---------------------------------------------------------------------------
-- PART 2 — Restore from the UI.  Read this before uncommenting.
-- ---------------------------------------------------------------------------
-- RESTORE over an existing database is reserved to sysadmin, dbcreator, and
-- the database owner. There is no database-scoped role that grants it, so
-- enabling the restore button means adding app_api to a SERVER-level role.
--
-- dbcreator can create, alter, drop and restore ANY database on this instance
-- -- not just `inventory`. If this SQL Server hosts nothing else and the app's
-- password is strong, that is a narrow enough blast radius to be reasonable.
-- If it hosts other applications' databases, it is not, and you should leave
-- this commented out.
--
-- Leaving it out does not cost you the ability to restore. It costs you the
-- ability to restore *from the web UI*. Every backup the screen produces is a
-- plain folder that deploy\windows\restore.ps1 restores from an elevated
-- PowerShell prompt on the server, which is the safer place for an operation
-- that replaces the entire database anyway.

-- USE master;
-- GO
-- ALTER SERVER ROLE dbcreator ADD MEMBER app_api;
-- GO

-- ---------------------------------------------------------------------------
-- Also required, and not grantable from SQL: filesystem permission.
-- ---------------------------------------------------------------------------
-- BACKUP DATABASE runs inside the SQL Server service process, not inside the
-- API, so the backup folder must be writable by the SERVICE account -- by
-- default NT AUTHORITY\NETWORK SERVICE -- and not merely by whoever the API
-- runs as. From an elevated PowerShell prompt:
--
--   icacls D:\Inventory\backups /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)M"
--
-- Without it every backup fails with "Operating system error 5 (Access is
-- denied)". The backup screen recognises that particular failure and repeats
-- this instruction rather than passing the raw error through.
