<#
.SYNOPSIS
  Restores a backup set onto this machine -- database and product photos
  together -- so the standby can take over.

.DESCRIPTION
  Takes one of the folders produced by `backup.ps1` (and copied down by
  `backup-pull.ps1`) and rebuilds the system from it:

    database.bak  ->  RESTORE DATABASE
    uploads.zip   ->  the uploads folder

  Both, always. `items.image_file` holds a bare filename and the bytes live on
  disk, so a database restored without its uploads gives you a catalogue of
  broken images, and uploads without the database are a pile of UUIDs nobody
  can identify.

  ---------------------------------------------------------------------------
  The trap this script exists to handle: orphaned users
  ---------------------------------------------------------------------------
  A database carries its *users* inside it; a SQL Server carries its *logins*.
  They are joined by a SID. Restore this database onto a different machine and
  the `app_api` user inside it points at a SID that machine has never heard
  of, so the login exists, the user exists, and the API still cannot connect --
  "Login failed for user 'app_api'", with everything apparently configured
  correctly.

  Nothing in the restore output warns you. `ALTER USER ... WITH LOGIN` below
  re-points the user at the local login and is the difference between a
  standby that works and one that looks fine until you need it.

.EXAMPLE
  # Newest set, standard paths. Stop the API first -- see the guard below.
  .\restore.ps1

.EXAMPLE
  # A specific night, on the standby.
  .\restore.ps1 -BackupSet D:\Inventory\backups-from-primary\2026-08-16_0200

.NOTES
  Destructive: it replaces the target database. Refuses to run against an
  existing database unless -Force is given, and refuses while the API service
  is running, because restoring underneath a live connection pool gives you
  a half-restored database and an API serving errors.
#>
[CmdletBinding()]
param(
  # Defaults to the newest set under -BackupRoot.
  [string] $BackupSet,

  [string] $BackupRoot     = 'D:\Inventory\backups-from-primary',
  [string] $Database       = 'inventory',
  [string] $ServerInstance = '127.0.0.1\INVENTORY',
  [string] $UploadsDir     = 'D:\Inventory\data\uploads',
  [string] $AppLogin       = 'app_api',
  [string] $ServiceName    = 'inventory-api',

  # Required to overwrite a database that already exists.
  [switch] $Force
)

$ErrorActionPreference = 'Stop'

function Invoke-Sql {
  param([string] $Query, [switch] $Raw)
  $out = & sqlcmd -S $ServerInstance -E -C -b -h -1 -W -Q $Query 2>&1
  if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed:`n$($out -join "`n")" }
  if ($Raw) { return $out }
}

# ---------------------------------------------------------------- pick a set
if (-not $BackupSet) {
  $BackupSet = (Get-ChildItem $BackupRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' } |
    Sort-Object Name | Select-Object -Last 1).FullName
  if (-not $BackupSet) { throw "No backup sets under $BackupRoot. Run backup-pull.ps1 first." }
}

$bak = Join-Path $BackupSet 'database.bak'
$zip = Join-Path $BackupSet 'uploads.zip'
if (-not (Test-Path $bak)) { throw "No database.bak in $BackupSet." }

Write-Host "[restore] set      : $BackupSet"
Write-Host "[restore] database : $Database on $ServerInstance"

# ------------------------------------------------------------------- guards
$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
  throw "$ServiceName is running. Stop it first (Stop-Service $ServiceName), restore, then start it again."
}

$q = "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name = N'$Database';"
$exists = (Invoke-Sql -Raw -Query $q) -join ''
if ($exists.Trim() -ne '0' -and -not $Force) {
  throw "Database [$Database] already exists. Re-run with -Force to replace it -- everything currently in it is discarded."
}

# ------------------------------------------------------- where the files go
# The logical names inside the backup are whatever the primary called them,
# and its data directory may not exist here. FILELISTONLY reads both out of
# the backup so this works between machines with different layouts.
$q = "SET NOCOUNT ON; SELECT CONVERT(nvarchar(400), SERVERPROPERTY('InstanceDefaultDataPath'));"
$dataPath = ((Invoke-Sql -Raw -Query $q) -join '').Trim()
$q = "SET NOCOUNT ON; SELECT CONVERT(nvarchar(400), SERVERPROPERTY('InstanceDefaultLogPath'));"
$logPath = ((Invoke-Sql -Raw -Query $q) -join '').Trim()

$fileList = & sqlcmd -S $ServerInstance -E -C -b -h -1 -W -s '|' `
  -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$bak';" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Could not read the backup header:`n$($fileList -join "`n")" }

$moves = @()
foreach ($line in $fileList) {
  $cols = "$line".Split('|')
  if ($cols.Count -lt 3) { continue }
  $logical = $cols[0].Trim()
  $type    = $cols[2].Trim()          # 'D' = data, 'L' = log
  if ($type -eq 'D') {
    $moves += "MOVE N'$logical' TO N'$(Join-Path $dataPath ($Database + '.mdf'))'"
  } elseif ($type -eq 'L') {
    $moves += "MOVE N'$logical' TO N'$(Join-Path $logPath ($Database + '_log.ldf'))'"
  }
}
if (-not $moves) { throw "RESTORE FILELISTONLY returned no data/log files -- is $bak a valid backup?" }

# ------------------------------------------------------------------ restore
Write-Host '[restore] verifying the backup before touching anything...'
Invoke-Sql -Query "RESTORE VERIFYONLY FROM DISK = N'$bak';"

Write-Host '[restore] restoring database...'
# SINGLE_USER + ROLLBACK IMMEDIATE evicts anything still connected; without it
# RESTORE fails with "database is in use" whenever a stray session exists.
if ($exists.Trim() -ne '0') {
  Invoke-Sql -Query "ALTER DATABASE [$Database] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;"
}
Invoke-Sql -Query "RESTORE DATABASE [$Database] FROM DISK = N'$bak' WITH $($moves -join ', '), REPLACE, RECOVERY;"
Invoke-Sql -Query "ALTER DATABASE [$Database] SET MULTI_USER;"

# --------------------------------------------------- re-point the app login
# See the header: this is the step whose absence looks like a working restore.
$q = "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.server_principals WHERE name = N'$AppLogin';"
$hasLogin = ((Invoke-Sql -Raw -Query $q) -join '').Trim()

if ($hasLogin -eq '0') {
  Write-Warning "Login [$AppLogin] does not exist on this server. Create it with the same password the app's .env uses, then re-run:"
  Write-Warning "  CREATE LOGIN $AppLogin WITH PASSWORD = N'...', CHECK_POLICY = ON;"
  Write-Warning "  USE [$Database]; ALTER USER $AppLogin WITH LOGIN = $AppLogin;"
} else {
  Invoke-Sql -Query "USE [$Database]; IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$AppLogin') ALTER USER [$AppLogin] WITH LOGIN = [$AppLogin];"
  Write-Host "[restore] re-pointed [$AppLogin] at the local login"
}

# ------------------------------------------------------------------ uploads
if (Test-Path $zip) {
  New-Item -ItemType Directory -Path $UploadsDir -Force | Out-Null
  Expand-Archive -Path $zip -DestinationPath $UploadsDir -Force
  $n = (Get-ChildItem $UploadsDir -File -ErrorAction SilentlyContinue).Count
  Write-Host "[restore] uploads restored -- $n file(s) in $UploadsDir"
} else {
  Write-Warning "No uploads.zip in this set. Product photos will be missing."
}

# -------------------------------------------------------------- sanity read
$counts = Invoke-Sql -Raw -Query @"
SET NOCOUNT ON;
USE [$Database];
SELECT CONCAT('items=', (SELECT COUNT(*) FROM items),
              ' invoices=', (SELECT COUNT(*) FROM invoices),
              ' movements=', (SELECT COUNT(*) FROM stock_movements),
              ' users=', (SELECT COUNT(*) FROM users));
"@
Write-Host "[restore] restored contents: $(($counts -join '').Trim())"

Write-Host ''
Write-Host '[restore] done. Before this machine can serve:'
Write-Host "  1. server\.env must point at this instance, and carry the SAME AUTH_SECRET as the primary"
Write-Host '     (a different secret invalidates every signed-in session).'
Write-Host "  2. Start-Service $ServiceName"
Write-Host '  3. Check http://127.0.0.1:4317/api/v1/health reports db: ready'
