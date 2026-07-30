<#
.SYNOPSIS
  Nightly backup: the database and the product photos, together.

.DESCRIPTION
  They have to be one backup. `items.image_file` holds a bare filename and the
  bytes live on disk, so a database restored without its uploads folder gives
  you a catalogue of broken images -- and an uploads folder without the database
  is a pile of UUIDs no one can identify.

  Register it as a 02:00 task:

    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
                 -Argument '-NoProfile -File C:\inventory\deploy\windows\backup.ps1'
    $trigger = New-ScheduledTaskTrigger -Daily -At 2am
    Register-ScheduledTask -TaskName 'Inventory backup' -Action $action `
      -Trigger $trigger -RunLevel Highest -User 'SYSTEM'

  A backup on the same disk as the data protects against a bad migration, not
  against the disk dying or the building burning. Copy $BackupRoot somewhere
  else -- another machine, or object storage -- or this is only half a backup.
#>
[CmdletBinding()]
param(
  [string] $BackupRoot = 'C:\inventory\backups',
  [string] $UploadsDir = 'C:\inventory\data\uploads',
  [string] $Database   = 'inventory',
  [string] $DbUser     = 'postgres',
  [int]    $KeepDays   = 30
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$dest  = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Path $dest -Force | Out-Null

# pg_dump must match the server's major version; the Postgres bin directory is
# not on PATH by default.
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
  $candidate = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $candidate) { throw 'pg_dump not found. Add PostgreSQL\bin to PATH.' }
  $pgDump = $candidate.FullName
}

# -Fc is the custom format: compressed, and restorable selectively with pg_restore.
& $pgDump -U $DbUser -Fc -f (Join-Path $dest 'database.dump') $Database
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

if (Test-Path $UploadsDir) {
  Compress-Archive -Path (Join-Path $UploadsDir '*') `
    -DestinationPath (Join-Path $dest 'uploads.zip') -ErrorAction SilentlyContinue
}

# Prune old sets. Restoring is never tested by writing a backup script, so:
#   pg_restore -U postgres -d inventory_restore_test --clean database.dump
# is worth running once, before you need it.
Get-ChildItem $BackupRoot -Directory |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  Remove-Item -Recurse -Force

$size = '{0:N1} MB' -f ((Get-ChildItem $dest -Recurse | Measure-Object Length -Sum).Sum / 1MB)
Write-Host "[backup] $dest -- $size"
