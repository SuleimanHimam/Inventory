-- ============================================================================
-- Lets the application create and delete FILES (ملفات) from the UI.
--
-- A file in this app is a whole SQL Server database of its own: its own items,
-- its own invoices, its own users, its own backups. Creating one is
-- CREATE DATABASE; deleting one is DROP DATABASE. Neither is something an
-- application login can do with the rights provision-mssql.sql grants it
-- (db_datareader + db_datawriter + db_ddladmin on one database), which is why
-- this is opted into here rather than granted by default.
--
-- Run once as sa (or another sysadmin) on the SQL Server instance:
--
--   sqlcmd -S 127.0.0.1\INVENTORY -E -C -i grant-files.sql
--
-- Then restart the API so it re-reads what it is allowed to do:
--
--   Restart-Service inventory-api
--
-- ---------------------------------------------------------------------------
-- WHAT THIS COSTS — read before running it
-- ---------------------------------------------------------------------------
-- `dbcreator` is a SERVER-level role. It does not mean "may create this app's
-- databases"; it means may create databases on this instance, and may DROP ANY
-- DATABASE IT OWNS — which, after this, includes every file the app creates.
-- SQL Server has no narrower grant for this: there is no per-prefix or
-- per-folder CREATE DATABASE permission.
--
-- So the question to answer before running this is not "do I trust the app"
-- but "what else lives on this instance". On a dedicated inventory server the
-- answer is nothing, and the cost is small. On an instance shared with other
-- applications' databases, an attacker who reached the app's SQL login could
-- destroy them too — and there the honest answer may be to leave this ungranted
-- and create files by hand in SSMS instead.
--
-- Without this grant the app is fully functional except that the "ملفات"
-- screen shows creating and deleting as unavailable, and says why. Nothing
-- breaks; the feature is simply not offered.
-- ============================================================================

USE master;
GO

-- The login the API connects as. Change if DB_USER in server\.env is not app_api.
DECLARE @login sysname = N'app_api';

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @login)
BEGIN
  RAISERROR('Login %s does not exist on this instance — run provision-mssql.sql first.', 16, 1, @login);
  RETURN;
END

DECLARE @sql nvarchar(max) = N'ALTER SERVER ROLE dbcreator ADD MEMBER ' + QUOTENAME(@login) + N';';
EXEC sp_executesql @sql;

PRINT 'Granted dbcreator to ' + @login + '. Restart inventory-api for it to take effect.';
GO

-- ---------------------------------------------------------------------------
-- To undo, if you decide against it:
--
--   ALTER SERVER ROLE dbcreator DROP MEMBER [app_api];
--
-- Files already created keep working — they are ordinary databases and the app
-- reads and writes them with the rights it already had. Only creating and
-- deleting them stops being offered.
-- ---------------------------------------------------------------------------
