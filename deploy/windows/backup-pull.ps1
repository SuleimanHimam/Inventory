<#
.SYNOPSIS
  Runs on the SECOND machine. Pulls the primary server's nightly backup sets
  and keeps a local copy.

.DESCRIPTION
  `backup.ps1` on the primary writes one folder per night into its backups
  root -- `2026-08-16_0200\database.bak` + `uploads.zip`. That protects against
  a bad migration. It does not protect against the disk dying or the building
  burning, because the copy sits on the same disk as the data.

  This script is the other half. It runs on a second machine, reaches into the
  primary's backup folder over the network, and copies down anything it does
  not already have.

  ---------------------------------------------------------------------------
  Why the second machine pulls, instead of the primary pushing
  ---------------------------------------------------------------------------
  Pushing would mean the primary holds a credential that can write to the
  standby. Anything that compromises or corrupts the primary -- ransomware
  above all -- then reaches the backups too, and you have one failure taking
  out both copies.

  Pulling inverts that: the standby holds the credential, the primary needs to
  know nothing about the standby, and the primary has no write path to the
  copies at all. It also matches how this is actually operated -- the standby
  is the machine someone tends to, so it is the machine that should be able to
  say "I have last night's backup".

  ---------------------------------------------------------------------------
  What the primary needs (once)
  ---------------------------------------------------------------------------
  A read-only share over its backup folder, readable by the account this task
  runs as. On the primary, elevated:

    New-SmbShare -Name 'InventoryBackups' -Path 'D:\Inventory\backups' `
      -ReadAccess 'DOMAIN\standby-account'

  Use a dedicated account with nothing but read access to that one share. If
  the two machines are in a workgroup rather than a domain, create the same
  local user and password on both, and pass -Credential below.

.EXAMPLE
  # Register on the standby as a 04:00 task -- two hours after the primary's
  # 02:00 backup, so the set is finished and closed before it is copied.
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
               -Argument '-NoProfile -ExecutionPolicy Bypass -File D:\Inventory\deploy\windows\backup-pull.ps1 -PrimaryShare \\HDS\InventoryBackups'
  $trigger = New-ScheduledTaskTrigger -Daily -At 4am
  Register-ScheduledTask -TaskName 'Inventory backup pull' -Action $action `
    -Trigger $trigger -RunLevel Highest -User 'SYSTEM'

.NOTES
  Exits non-zero on failure, so Task Scheduler's "Last Run Result" is
  meaningful. A backup job that fails silently is worse than none, because you
  believe you are covered.
#>
[CmdletBinding()]
param(
  # The primary's backup folder, as a UNC path.
  [Parameter(Mandatory)]
  [string] $PrimaryShare,

  # Where the copies land on this machine.
  [string] $LocalRoot = 'D:\Inventory\backups-from-primary',

  # Credential for the share. Needed in a workgroup; omit inside a domain
  # where the task account already has read access.
  [System.Management.Automation.PSCredential] $Credential,

  [int] $KeepDays = 30,

  # Skip the RESTORE VERIFYONLY pass (which needs SQL Server on this machine).
  [switch] $SkipVerify,

  [string] $ServerInstance = '127.0.0.1\INVENTORY'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $LocalRoot -Force | Out-Null
Start-Transcript -Path (Join-Path $LocalRoot 'pull.log') -Append | Out-Null

# A set folder is named by the primary's timestamp; anything else in that
# folder (logs, ad-hoc dumps) is not a backup set and is left alone.
$setPattern = '^\d{4}-\d{2}-\d{2}_\d{4}$'
$drive = $null
$copied = 0

try {
  if ($Credential) {
    # A temporary PSDrive is how you authenticate to a UNC path without
    # storing anything: it lives for this process only.
    $drive = New-PSDrive -Name 'InvBackup' -PSProvider FileSystem `
      -Root $PrimaryShare -Credential $Credential -ErrorAction Stop
    $source = 'InvBackup:\'
  } else {
    $source = $PrimaryShare
  }

  if (-not (Test-Path $source)) {
    throw "Cannot reach $PrimaryShare -- is the primary on, and the share readable by $(whoami)?"
  }

  $remote = Get-ChildItem $source -Directory |
    Where-Object { $_.Name -match $setPattern } |
    Sort-Object Name

  if (-not $remote) { throw "No backup sets found under $PrimaryShare." }

  # Anything already older than the retention window is skipped *before* it is
  # copied. Without this the two halves of the script fight each other: the
  # copy step sees an old set missing locally and fetches it, the prune step
  # deletes it for being old, and the next run fetches it again -- re-pulling
  # the same tens of megabytes every night, forever.
  $cutoff = (Get-Date).AddDays(-$KeepDays)

  foreach ($set in $remote) {
    $stamp = [datetime]::ParseExact($set.Name, 'yyyy-MM-dd_HHmm', $null)
    if ($stamp -lt $cutoff) { continue }         # older than we keep

    $target = Join-Path $LocalRoot $set.Name
    if (Test-Path $target) { continue }          # already have it

    $wanted = Get-ChildItem $set.FullName -File
    if (-not ($wanted | Where-Object Name -eq 'database.bak')) {
      Write-Warning "[pull] $($set.Name): no database.bak yet -- still being written? skipped"
      continue
    }

    # Copy into a staging folder first and rename only once every file is
    # down. An interrupted copy must never leave something that looks like a
    # complete set, or the next run will skip it forever and the gap is
    # invisible until a restore fails.
    $staging = "$target.partial"
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    foreach ($file in $wanted) {
      Copy-Item $file.FullName -Destination $staging -Force
      $local = Join-Path $staging $file.Name
      if ((Get-Item $local).Length -ne $file.Length) {
        throw "[pull] $($set.Name)/$($file.Name): size mismatch after copy."
      }
    }

    Rename-Item $staging $target
    $copied += 1
    $mb = '{0:N1}' -f (($wanted | Measure-Object Length -Sum).Sum / 1MB)
    Write-Host "[pull] copied $($set.Name) -- $mb MB"
  }

  if ($copied -eq 0) { Write-Host '[pull] nothing new -- already up to date' }

  # Verify the newest local set actually restores. A backup nobody has tried
  # to read is a hope, not a backup -- and VERIFYONLY reads every page and
  # checks the CHECKSUM that backup.ps1 wrote, without touching any database.
  if (-not $SkipVerify) {
    $newest = Get-ChildItem $LocalRoot -Directory |
      Where-Object { $_.Name -match $setPattern } |
      Sort-Object Name | Select-Object -Last 1
    if ($newest) {
      $bak = Join-Path $newest.FullName 'database.bak'
      $out = & sqlcmd -S $ServerInstance -E -C -b -Q "RESTORE VERIFYONLY FROM DISK = N'$bak';" 2>&1
      if ($LASTEXITCODE -ne 0) { throw "[pull] VERIFYONLY failed on $($newest.Name):`n$out" }
      Write-Host "[pull] verified $($newest.Name)"
    }
  }

  # Prune by set name (the primary's timestamp), not by file date -- a copy
  # made today of a set from three weeks ago is three weeks old.
  Get-ChildItem $LocalRoot -Directory |
    Where-Object {
      $_.Name -match $setPattern -and
      [datetime]::ParseExact($_.Name, 'yyyy-MM-dd_HHmm', $null) -lt $cutoff
    } |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force; Write-Host "[pull] pruned $($_.Name)" }

  $sets = @(Get-ChildItem $LocalRoot -Directory | Where-Object { $_.Name -match $setPattern })
  $newestName = ($sets | Sort-Object Name | Select-Object -Last 1).Name
  Write-Host "[pull] $($sets.Count) set(s) held locally, newest $newestName"
}
catch {
  Write-Error $_
  Stop-Transcript | Out-Null
  exit 1
}
finally {
  if ($drive) { Remove-PSDrive $drive -ErrorAction SilentlyContinue }
  # Stop-Transcript twice is harmless; the catch above exits before this.
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
