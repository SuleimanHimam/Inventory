<#
.SYNOPSIS
  Nightly backup: every file's database and its product photos, together.

.DESCRIPTION
  A "file" (ملف) is a whole database of its own -- its own items, its own
  users, its own backups. This script backs up all of them in one run, each
  into its own folder, so restoring one file never costs another file its
  history. See server/src/lib/files.js for why the separation exists.

  Which databases: the one named by -Database (the original, and still the
  one the API is configured with) plus every `inv_*` database on the instance
  that carries a `dbo.file_info` table -- that table is what makes a database
  one of this app's files rather than a stranger that happens to match the
  prefix.

  Where each set lands:

    $BackupRoot\2026-09-25_0200\           the -Database file, unchanged
    $BackupRoot\inv_ab12cd34\2026-09-25_0200\   every other file

  The original keeps the root folder rather than moving into a subfolder of
  its own. backup-pull.ps1, restore.ps1 and every set an existing deployment
  has already written all live there, and relocating them would present an
  operator with an empty backup list on the morning after an upgrade -- the
  exact moment confidence in backups matters most. server/src/lib/backup.js
  (`setsDir`) resolves the same two cases the same way, so a set written here
  appears in the UI and vice versa.

  The database and its photos have to travel together. `items.image_file`
  holds a bare filename and the bytes live on disk, so a database restored
  without its uploads gives you a catalogue of broken images -- and an uploads
  folder without the database is a pile of UUIDs no one can identify.

  Files share one uploads folder on disk (the names are UUIDs, so they cannot
  collide), which means a set must not simply zip the whole folder: that would
  put every other file's photos into this file's backup, and restoring it
  would scatter images across files that never owned them. So each set is
  packed from the filenames that file's own rows reference -- exactly what
  restoring it needs, and nothing else.

  A note on rights, because this is where per-file backups can fail quietly.
  SYSTEM backs up the original database every night, which proves it can back
  up *that* one. A file created later is a database SYSTEM was never granted
  anything on explicitly: if it is sysadmin on the instance (the SQL Server
  setup default) it covers every file automatically, and if it merely holds
  db_backupoperator on the original, new files will fail. Either way this
  script now says so out loud rather than reporting a good night -- see the
  failure handling below. The first run after creating a file is worth
  reading.

  One file failing does not stop the others. Each is backed up inside its own
  try/catch, the failures are reported together at the end, and the script
  exits non-zero if any file was missed -- so a monitored scheduled task still
  goes red.

  Runs as SYSTEM (see Register-ScheduledTask below), so authentication cannot
  be interactive: it connects to SQL Server via Windows Authentication as
  NT AUTHORITY\SYSTEM, which is granted db_backupoperator on the database --
  see provision-mssql.sql. No password is needed or stored.

  BACKUP DATABASE runs *inside* the SQL Server service process, not in this
  script, so $BackupRoot must be writable by the SQL Server service account
  (NT AUTHORITY\NETWORK SERVICE, per the install script), not just by SYSTEM.
  That applies to the per-file subfolders too.

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

# A set folder, and only a set folder. Pruning matches against this rather
# than deleting any old directory it finds: $BackupRoot now also holds one
# folder per file, and `Get-ChildItem -Directory` on its own would happily
# delete a whole file's backup history the first quiet month it had.
$SetPattern = '^\d{4}-\d{2}-\d{2}_\d{4}$'

$failures = @()

try {
  if (-not (Get-Command Invoke-Sqlcmd -ErrorAction SilentlyContinue)) {
    Import-Module SqlServer -ErrorAction SilentlyContinue
  }
  if (-not (Get-Command Invoke-Sqlcmd -ErrorAction SilentlyContinue)) {
    Import-Module SQLPS -DisableNameChecking -ErrorAction Stop
  }

  $stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'

  # ---------------------------------------------------------------- discover
  # `file_info` is the marker. A database matching the prefix without it is
  # half-created, mid-restore, or somebody else's -- none of which this script
  # should be writing backups of.
  $discover = @"
SELECT d.name
  FROM sys.databases d
 WHERE d.state_desc = 'ONLINE'
   AND (d.name = '$Database'
        OR (d.name LIKE 'inv[_]%'
            AND OBJECT_ID(QUOTENAME(d.name) + '.dbo.file_info') IS NOT NULL))
 ORDER BY CASE WHEN d.name = '$Database' THEN 0 ELSE 1 END, d.name;
"@
  $databases = @(Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $discover |
                   Select-Object -ExpandProperty name)

  if (-not $databases) {
    throw "No files found on $ServerInstance -- expected at least [$Database]."
  }
  Write-Host ("[backup] {0} file(s): {1}" -f $databases.Count, ($databases -join ', '))

  foreach ($db in $databases) {
    try {
      # The original keeps the root; every other file gets a folder named
      # after its database. See the header for why they differ.
      $setsDir = if ($db -eq $Database) { $BackupRoot } else { Join-Path $BackupRoot $db }
      New-Item -ItemType Directory -Path $setsDir -Force | Out-Null

      $dest = Join-Path $setsDir $stamp
      New-Item -ItemType Directory -Path $dest -Force | Out-Null

      # COMPRESSION halves the file for the same reason -Fc did for pg_dump;
      # CHECKSUM catches a corrupt backup at RESTORE time instead of at 3am on
      # the day you actually need it.
      $bakFile = Join-Path $dest 'database.bak'
      $query = "BACKUP DATABASE [$db] TO DISK = N'$bakFile' WITH COMPRESSION, CHECKSUM, INIT;"
      Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -QueryTimeout 0
      if (-not (Test-Path $bakFile)) {
        throw "BACKUP DATABASE [$db] did not produce a file -- check the SQL Server error log."
      }

      # ------------------------------------------------------------- photos
      # Only this file's own, by name. See the header for why not the folder.
      if (Test-Path $UploadsDir) {
        $imageQuery = "SELECT DISTINCT image_file FROM [$db].dbo.items " +
                      "WHERE image_file IS NOT NULL AND image_file <> '';"
        $names = @(Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $imageQuery -QueryTimeout 0 |
                     Select-Object -ExpandProperty image_file)

        # A row whose photo is missing from disk is a known, survivable state;
        # it must not fail the whole backup.
        $paths = @($names |
                    ForEach-Object { Join-Path $UploadsDir $_ } |
                    Where-Object { Test-Path $_ })

        if ($paths.Count -gt 0) {
          Compress-Archive -Path $paths `
            -DestinationPath (Join-Path $dest 'uploads.zip') -ErrorAction SilentlyContinue
        }
        if ($paths.Count -lt $names.Count) {
          Write-Host ("[backup]   {0}: {1} of {2} photo(s) missing from disk" -f `
                      $db, ($names.Count - $paths.Count), $names.Count)
        }
      }

      # -------------------------------------------------------------- prune
      # Scoped to this file's own sets, and to folders that are actually sets.
      Get-ChildItem $setsDir -Directory |
        Where-Object { $_.Name -match $SetPattern -and
                       $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
        Remove-Item -Recurse -Force

      $size = '{0:N1} MB' -f ((Get-ChildItem $dest -Recurse | Measure-Object Length -Sum).Sum / 1MB)
      Write-Host "[backup] $dest -- $size"
    } catch {
      # One file's failure must not cost the rest their backup.
      $failures += "$db : $($_.Exception.Message)"
      Write-Host "[backup] FAILED $db -- $($_.Exception.Message)"
    }
  }

  if ($failures.Count -gt 0) {
    # Non-zero exit, so a monitored scheduled task goes red rather than
    # reporting success for a night that backed up only some of the files.
    Write-Host "[backup] $($failures.Count) file(s) failed:"
    $failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
  }
} finally {
  Stop-Transcript | Out-Null
}
