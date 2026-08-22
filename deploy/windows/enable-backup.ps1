<#
.SYNOPSIS
  Turns on the backup screen -- backup, download, import and restore -- so the
  whole thing works from any device instead of only from this console.

.DESCRIPTION
  Three things have to be true before the backup screen in the app can do
  anything, and they fail in three different and unrelated ways. This script
  does all three, checks each one actually took, and says what changed.

    1. GRANT     the app's SQL login the right to back up and to restore.
    2. FILESYSTEM let the SQL Server *service account* write to the backup
                  folder -- BACKUP DATABASE runs inside that process, not
                  inside the API, so the API's own permissions are irrelevant.
    3. RESTART   the API, so it re-asks SQL Server what it is allowed to do.

  Run it once, elevated, on the server itself. Everything after that happens
  from the app, on a phone, a tablet, or any machine that can reach it.

  ---------------------------------------------------------------------------
  What granting restore actually costs
  ---------------------------------------------------------------------------
  Backing up needs `db_backupoperator`, which is scoped to this one database
  and is narrow and safe.

  Restoring over an existing database has no database-scoped role at all: SQL
  Server reserves it to sysadmin, dbcreator, and the database owner. So
  enabling the restore button means adding the login to the *server*-level
  `dbcreator` role, which can create, alter, drop and restore any database on
  the instance.

  Whether that matters depends entirely on what else the instance hosts. On a
  dedicated instance -- one where the only databases are this application's --
  dbcreator reaches nothing that app_api could not already destroy through the
  application itself, and the trade is a fair one. On a shared instance it is
  not, and you should run this with -BackupOnly and restore from restore.ps1
  instead.

  This script does not decide that for you: it lists the databases it can see
  and refuses to grant dbcreator on an instance that is clearly shared, unless
  -Force says otherwise.

.PARAMETER BackupOnly
  Grant backup, download and import, but not restore. The restore button stays
  disabled and explains itself; restore.ps1 still works from this console.

.EXAMPLE
  .\enable-backup.ps1
  The normal case: everything on, from any device.

.EXAMPLE
  .\enable-backup.ps1 -BackupOnly
  Backups from any device; restoring stays a deliberate trip to the server.

.NOTES
  Needs an elevated PowerShell, and a Windows account that is a sysadmin on the
  SQL Server instance -- the account that installed SQL Server usually is.
  Granting a permission cannot be done by the login that lacks it.
#>
[CmdletBinding()]
param(
  [string] $ServerInstance = '127.0.0.1\INVENTORY',
  [string] $Database       = 'inventory',
  [string] $AppLogin       = 'app_api',
  [string] $BackupRoot     = 'D:\Inventory\backups',
  [string] $ServiceName    = 'inventory-api',

  # Skip the dbcreator grant -- see the header.
  [switch] $BackupOnly,

  # Grant dbcreator even on an instance that hosts other applications.
  [switch] $Force
)

$ErrorActionPreference = 'Stop'

function Step([string] $Text) { Write-Host ''; Write-Host "[*] $Text" -ForegroundColor Cyan }
function Ok([string] $Text)   { Write-Host "    ok   $Text" -ForegroundColor Green }
function Info([string] $Text) { Write-Host "         $Text" -ForegroundColor DarkGray }
function Warn([string] $Text) { Write-Host "    warn $Text" -ForegroundColor Yellow }

function Test-Admin {
  ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# One scalar out of SQL Server. -b makes a failed batch a non-zero exit code,
# which is the only way sqlcmd reports failure to a script.
function Get-Scalar([string] $Query) {
  $out = & sqlcmd -S $ServerInstance -E -C -b -h -1 -W -Q $Query 2>&1
  if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed:`n$($out -join "`n")" }
  return ($out -join '').Trim()
}

function Invoke-Sql([string] $Query) {
  $out = & sqlcmd -S $ServerInstance -E -C -b -Q $Query 2>&1
  if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed:`n$($out -join "`n")" }
}

Write-Host ''
Write-Host '  Inventory -- enable backup and restore from the app' -ForegroundColor White
Write-Host '  =================================================='

if (-not (Test-Admin)) {
  throw 'This needs an elevated PowerShell (right-click -> Run as administrator).'
}

# ------------------------------------------------------------------ 1. reach
Step 'Connecting to SQL Server'

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
  throw 'sqlcmd not found. Install the SQL Server command line tools, or run deploy\windows\grant-backup.sql from SSMS instead.'
}

$who = Get-Scalar "SET NOCOUNT ON; SELECT SUSER_NAME() + '|' + CONVERT(varchar(1), ISNULL(IS_SRVROLEMEMBER('sysadmin'), 0));"
$account, $sysadmin = $who.Split('|')
Info "connected as $account"

if ($sysadmin -ne '1') {
  throw "$account is not a sysadmin on $ServerInstance, so it cannot grant these permissions. " +
        'Use the Windows account that installed SQL Server, or run grant-backup.sql as sa.'
}
Ok 'sysadmin -- can grant'

$exists = Get-Scalar "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.server_principals WHERE name = N'$AppLogin';"
if ($exists.Trim() -eq '0') {
  throw "Login [$AppLogin] does not exist on this instance. Run server\provision-mssql.sql first."
}

# --------------------------------------------------------------- 2. backup
Step "Granting backup rights to [$AppLogin]"

Invoke-Sql "USE [$Database]; IF IS_ROLEMEMBER('db_backupoperator', '$AppLogin') = 0 ALTER ROLE db_backupoperator ADD MEMBER [$AppLogin];"
$isBackup = Get-Scalar "SET NOCOUNT ON; USE [$Database]; SELECT ISNULL(IS_ROLEMEMBER('db_backupoperator', '$AppLogin'), 0);"
if ($isBackup.Trim() -ne '1') { throw 'db_backupoperator did not take -- check the SQL Server error log.' }
Ok "db_backupoperator on [$Database]"

# --------------------------------------------------------------- 3. restore
Step 'Granting restore rights'

if ($BackupOnly) {
  Info 'skipped (-BackupOnly). The restore button stays disabled and says why.'
  Info 'restore.ps1 on this machine still restores any set the app produces.'
} else {
  # What else is on this instance decides whether dbcreator is a fair trade.
  # System databases do not count -- every instance has them.
  $others = (& sqlcmd -S $ServerInstance -E -C -b -h -1 -W -Q @"
SET NOCOUNT ON;
SELECT name FROM sys.databases
 WHERE database_id > 4 AND name NOT LIKE '$Database%';
"@ 2>&1) | Where-Object { $_ -and $_.Trim() -and $_ -notmatch 'rows affected' }

  if ($others -and -not $Force) {
    Warn 'This instance also hosts:'
    foreach ($d in $others) { Warn "    $($d.Trim())" }
    Warn ''
    Warn 'dbcreator would let this application drop those too. Restore from the'
    Warn 'app is NOT being enabled. Either:'
    Warn "  - re-run with -Force if that is acceptable, or"
    Warn '  - leave it off and restore with deploy\windows\restore.ps1, or'
    Warn '  - move this application to its own SQL Server instance.'
  } else {
    if ($others) { Info "-Force: granting despite $($others.Count) other database(s)" }
    else { Info 'dedicated instance -- no other application databases here' }

    Invoke-Sql "IF IS_SRVROLEMEMBER('dbcreator', '$AppLogin') = 0 ALTER SERVER ROLE dbcreator ADD MEMBER [$AppLogin];"
    $isCreator = Get-Scalar "SET NOCOUNT ON; SELECT ISNULL(IS_SRVROLEMEMBER('dbcreator', '$AppLogin'), 0);"
    if ($isCreator.Trim() -ne '1') { throw 'dbcreator did not take -- check the SQL Server error log.' }
    Ok 'dbcreator -- restore from the app is on'
  }
}

# ------------------------------------------------------------ 4. filesystem
Step "Letting SQL Server write to $BackupRoot"

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

# The account BACKUP DATABASE actually writes as. Read it from the service
# rather than assuming NETWORK SERVICE: a domain install often runs SQL Server
# as a domain account, and granting the wrong one fails silently -- the backup
# just keeps returning "Operating system error 5".
#
# Matched by *this* instance's service name, derived from -ServerInstance, not
# by "the first thing running sqlservr.exe". A machine with several instances
# is common -- this one has four -- and enumeration order is not the order
# anyone would guess, so a loose match quietly grants a different instance's
# account and leaves the symptom identical to having granted nothing.
$instance = if ($ServerInstance -match '\\(.+)$') { $Matches[1] } else { 'MSSQLSERVER' }
$serviceName = if ($instance -eq 'MSSQLSERVER') { 'MSSQLSERVER' } else { "MSSQL`$$instance" }

$sqlService = Get-CimInstance Win32_Service -Filter "Name = '$serviceName'" -ErrorAction SilentlyContinue |
  Select-Object -First 1

$serviceAccount = if ($sqlService) { $sqlService.StartName } else { $null }
if (-not $serviceAccount) {
  Warn "Could not find the service '$serviceName' for instance [$instance]."
  Warn 'Assuming NT AUTHORITY\NETWORK SERVICE -- if the test backup below fails,'
  Warn 'find the real account with:  Get-CimInstance Win32_Service | Select Name, StartName'
  $serviceAccount = 'NT AUTHORITY\NETWORK SERVICE'
} else {
  Info "instance [$instance] -> service $serviceName"
}
# Virtual accounts are written NT SERVICE\MSSQL$INSTANCE and icacls accepts them as-is.
Info "SQL Server runs as $serviceAccount"

& icacls $BackupRoot /grant "${serviceAccount}:(OI)(CI)M" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls failed granting $serviceAccount on $BackupRoot" }
Ok "modify on $BackupRoot"

# Prove it, rather than trusting the grant: write a real backup to that folder
# and delete it. This is the step that catches a wrong service account, a
# folder on a drive SQL Server cannot see, and a full disk.
Step 'Testing a real backup'

$probe = Join-Path $BackupRoot ('.permission-probe-{0}.bak' -f (Get-Date -Format 'yyyyMMddHHmmss'))
try {
  Invoke-Sql "BACKUP DATABASE [$Database] TO DISK = N'$probe' WITH COPY_ONLY, COMPRESSION, INIT, FORMAT;"
  if (-not (Test-Path $probe)) { throw 'BACKUP reported success but wrote no file.' }
  $mb = '{0:N1}' -f ((Get-Item $probe).Length / 1MB)
  Ok "wrote and removed a $mb MB test backup"
} catch {
  Warn 'The test backup failed. The grants above are in place, but something'
  Warn 'else is stopping SQL Server writing there:'
  Warn "  $($_.Exception.Message)"
  throw
} finally {
  # COPY_ONLY above means this probe did not disturb any backup chain, and
  # removing it means it never shows up in the app as a set.
  Remove-Item $probe -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------- 5. restart
Step "Restarting $ServiceName"

$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
  Warn "$ServiceName is not installed as a service. Restart the API however you run it --"
  Warn 'it reads these permissions once, at the moment the screen is opened.'
} else {
  Restart-Service $ServiceName
  Start-Sleep -Seconds 3
  $svc.Refresh()
  if ((Get-Service $ServiceName).Status -eq 'Running') { Ok "$ServiceName restarted" }
  else { Warn "$ServiceName did not come back up -- check C:\inventory\logs\api.log" }
}

Write-Host ''
Write-Host '  Done.' -ForegroundColor Green
Write-Host '  Open the app on any device -> الإعدادات -> النسخ الاحتياطي' -ForegroundColor White
if ($BackupOnly) {
  Write-Host '  Backup, download and import are on. Restore stays on this machine.' -ForegroundColor DarkGray
} else {
  Write-Host '  Backup, download, import and restore all work from there.' -ForegroundColor DarkGray
}
Write-Host ''
