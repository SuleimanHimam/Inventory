<#
.SYNOPSIS
  Nightly backup: the database and the product photos, together.

.DESCRIPTION
  They have to be one backup. `items.image_file` holds a bare filename and the
  bytes live on disk, so a database restored without its uploads folder gives
  you a catalogue of broken images -- and an uploads folder without the database
  is a pile of UUIDs no one can identify.

  Runs as SYSTEM (see Register-ScheduledTask below), so authentication cannot
  be interactive: it connects to SQL Server via Windows Authentication as
  NT AUTHORITY\SYSTEM, which is granted db_backupoperator on the database --
  see provision-mssql.sql. No password is needed or stored, unlike the
  .pgpass file the Postgres build relied on for the same reason.

  BACKUP DATABASE runs *inside* the SQL Server service process, not in this
  script, so $BackupRoot must be writable by the SQL Server service account
  (NT AUTHORITY\NETWORK SERVICE, per the install script), not just by SYSTEM.

  Register it as a 02:00 task:

    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
                 -Argument '-NoProfile -File D:\Inventory\deploy\windows\backup.ps1'
    $trigger = New-ScheduledTaskTrigger -Daily -At 2am
    Register-ScheduledTask -TaskName 'Inventory backup' -Action $action `
      -Trigger $trigger -RunLevel Highest -User 'SYSTEM'

  A backup on the same disk as the data protects against a bad migration, not
  against the disk dying or the building burning. Copy $BackupRoot somewhere
  else -- another machine, or object storage -- or this is only half a backup.
#>
[CmdletBinding()]
param(
  [string] $BackupRoot     = 'D:\Inventory\backups',
  [string] $UploadsDir     = 'D:\Inventory\data\uploads',
  [string] $Database       = 'inventory',
  [string] $ServerInstance = '127.0.0.1\INVENTORY',
  [int]    $KeepDays       = 30
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
Start-Transcript -Path (Join-Path $BackupRoot 'backup.log') -Append | Out-Null

try {
  if (-not (Get-Command Invoke-Sqlcmd -ErrorAction SilentlyContinue)) {
    Import-Module SqlServer -ErrorAction SilentlyContinue
  }
  if (-not (Get-Command Invoke-Sqlcmd -ErrorAction SilentlyContinue)) {
    Import-Module SQLPS -DisableNameChecking -ErrorAction Stop
  }

  $stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
  $dest  = Join-Path $BackupRoot $stamp
  New-Item -ItemType Directory -Path $dest -Force | Out-Null

  # COMPRESSION halves the file for the same reason -Fc did for pg_dump;
  # CHECKSUM catches a corrupt backup at RESTORE time instead of at 3am on the
  # day you actually need it.
  $bakFile = Join-Path $dest 'database.bak'
  $query = "BACKUP DATABASE [$Database] TO DISK = N'$bakFile' WITH COMPRESSION, CHECKSUM, INIT;"
  Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -QueryTimeout 0
  if (-not (Test-Path $bakFile)) { throw 'BACKUP DATABASE did not produce a file -- check the SQL Server error log.' }

  if (Test-Path $UploadsDir) {
    Compress-Archive -Path (Join-Path $UploadsDir '*') `
      -DestinationPath (Join-Path $dest 'uploads.zip') -ErrorAction SilentlyContinue
  }

  # Prune old sets. Restoring is never tested by writing a backup script, so:
  #   RESTORE DATABASE inventory_restore_test FROM DISK = 'database.bak'
  #     WITH MOVE 'inventory' TO 'D:\SQLData\inventory_restore_test.mdf',
  #          MOVE 'inventory_log' TO 'D:\SQLData\inventory_restore_test_log.ldf';
  # is worth running once, before you need it -- the logical file names after
  # MOVE come from: RESTORE FILELISTONLY FROM DISK = 'database.bak';
  Get-ChildItem $BackupRoot -Directory |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
    Remove-Item -Recurse -Force

  $size = '{0:N1} MB' -f ((Get-ChildItem $dest -Recurse | Measure-Object Length -Sum).Sum / 1MB)
  Write-Host "[backup] $dest -- $size"
} finally {
  Stop-Transcript | Out-Null
}
