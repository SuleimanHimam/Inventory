<#
.SYNOPSIS
  Gives the API service the access it needs to copy backups to a device -- a
  USB disk, a second drive, or a folder on another computer.

.DESCRIPTION
  The backup screen can copy every backup to a second location ("نسخ إلى مكان
  آخر"). That copy is made by the **API service**, not by SQL Server and not by
  the person who set it up, so it succeeds or fails on that service account's
  access -- which is usually nobody's account and has no relation to what works
  in Explorer.

  This script finds out which account the service actually runs as, grants it
  access to the destination, and then *proves* it by writing a file there as
  that exact account rather than as you.

  ---------------------------------------------------------------------------
  The two cases, which are not alike
  ---------------------------------------------------------------------------
  A LOCAL destination -- a USB stick, an external disk, a second internal drive
  -- is straightforward. The service runs as LocalSystem by default, which has
  full rights to everything on this machine, so it usually already works; the
  grant below is belt and braces for a drive with unusual permissions.

  A NETWORK destination is a different problem entirely, and no amount of
  sharing permissions on the other machine will fix it:

    LocalSystem has no network identity. Reaching \\OTHER\Backups, it
    authenticates as the computer account -- and on a machine that is not in a
    domain, that means it arrives as ANONYMOUS LOGON, which every sensibly
    configured share refuses.

  So for a network destination the service has to run as a *real user account*
  that exists on both machines with the same name and password. Pass
  -ServiceAccount and -ServicePassword and this script will switch it over,
  restart the service, and verify. Or don't: `backup-pull.ps1` on the other
  machine fetches the backups instead, needs no credential here at all, and is
  the sturdier arrangement anyway (see deploy\windows\README.md).

.PARAMETER Destination
  Where backups should be copied. A local path (E:\Backups) or a UNC path
  (\\OTHER\Backups).

.PARAMETER ServiceAccount
  Switch the API service to this account first -- required for a network
  destination. Format: MACHINE\user, DOMAIN\user, or .\user for a local one.

.EXAMPLE
  .\grant-destination.ps1 -Destination E:\InventoryBackups
  A USB or external disk. Grants and verifies.

.EXAMPLE
  .\grant-destination.ps1 -Destination \\OFFICE-PC\Backups -ServiceAccount OFFICE-PC\inventory
  A folder on another computer. Creates nothing on the other machine -- the
  account and the share must already exist there.

.NOTES
  Elevated PowerShell. After it succeeds, set the same path in the app under
  الإعدادات -> النسخ الاحتياطي -> ضبط -> نسخ إلى مكان آخر.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string] $Destination,

  [string] $ServiceName = 'inventory-api',
  [string] $ServiceAccount = '',
  [string] $ServicePassword = ''
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

<#
  Write a file at $Path as $Account -- not as the caller.

  This is the whole point of the script, so it cannot be approximated by
  `Test-Path` or by an ACL read: both answer for *you*, and you are not who
  copies the backup at 02:00. A one-shot scheduled task is the only way to run
  something as LocalSystem, and it handles a named account with the same code,
  so both cases are proven identically.
#>
function Test-WriteAsAccount {
  param([string] $Path, [string] $Account, [string] $Password)

  $taskName = "InventoryBackupWriteTest_$(Get-Random)"
  $probe = Join-Path $Path ".inventory-service-write-test-$(Get-Random).tmp"
  # -Command with a literal path, quoted: a destination containing a space is
  # normal (E:\My Backups) and would otherwise split into two arguments.
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"Set-Content -LiteralPath '$probe' -Value ok`""

  try {
    if ($Account -match '^(LocalSystem|NT AUTHORITY\\SYSTEM|SYSTEM)$') {
      Register-ScheduledTask -TaskName $taskName -Action $action `
        -User 'NT AUTHORITY\SYSTEM' -RunLevel Highest -Force | Out-Null
    } elseif ($Password) {
      Register-ScheduledTask -TaskName $taskName -Action $action `
        -User $Account -Password $Password -RunLevel Highest -Force | Out-Null
    } else {
      # No password to hand: the task cannot be registered as that user, so say
      # so rather than testing as the wrong identity and reporting success.
      return @{ Tested = $false; Ok = $false
        Reason = "no password available for $Account -- cannot test as that account" }
    }

    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      if (Test-Path -LiteralPath $probe) { break }
      Start-Sleep -Milliseconds 400
    }

    if (Test-Path -LiteralPath $probe) {
      Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
      return @{ Tested = $true; Ok = $true; Reason = $null }
    }
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    return @{ Tested = $true; Ok = $false
      Reason = "no file appeared (task result 0x{0:X})" -f ($info.LastTaskResult) }
  } finally {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host '  Inventory -- grant the backup destination to the API service' -ForegroundColor White
Write-Host '  ==========================================================='

if (-not (Test-Admin)) { throw 'This needs an elevated PowerShell (Run as administrator).' }

$isUnc = $Destination.StartsWith('\\')

# ------------------------------------------------------------- 1. the service
Step "Reading the $ServiceName service"

$svc = Get-CimInstance Win32_Service -Filter "Name = '$ServiceName'" -ErrorAction SilentlyContinue
if (-not $svc) {
  throw "Service '$ServiceName' is not installed. If you run the API another way (npm start, " +
        'Task Scheduler), grant the destination to whichever account that runs as instead.'
}
$account = $svc.StartName
Info "runs as $account"

$computer = Get-CimInstance Win32_ComputerSystem
$inDomain = $computer.PartOfDomain
Info ("machine is {0}" -f ($(if ($inDomain) { "in domain $($computer.Domain)" } else { "in workgroup $($computer.Workgroup)" })))

# ------------------------------------------------------- 2. the network trap
if ($isUnc -and -not $ServiceAccount) {
  $isSystem = $account -match '^(LocalSystem|NT AUTHORITY\\SYSTEM)$'
  if ($isSystem) {
    Warn ''
    Warn "$ServiceName runs as $account, which has no identity on the network."
    if (-not $inDomain) {
      Warn 'This machine is not in a domain, so it reaches other computers as'
      Warn 'ANONYMOUS LOGON -- which shares refuse. No permission you set on'
      Warn "$Destination will change that."
    } else {
      Warn "It reaches other computers as the computer account $($computer.Name)`$,"
      Warn 'which the share would have to grant explicitly.'
    }
    Warn ''
    Warn 'Two ways forward:'
    Warn '  1. Re-run with a real account that exists on BOTH machines with the'
    Warn '     same password:'
    Warn "       .\grant-destination.ps1 -Destination $Destination ``"
    Warn '         -ServiceAccount OTHERPC\inventory -ServicePassword ...'
    Warn '  2. Leave this alone and let the other machine pull instead --'
    Warn '     deploy\windows\backup-pull.ps1. It needs no credential here,'
    Warn '     and survives this machine being compromised. Recommended.'
    Warn ''
    throw 'Refusing to pretend a network copy will work from LocalSystem.'
  }
}

# ------------------------------------------------- 3. switch the account
if ($ServiceAccount) {
  Step "Switching $ServiceName to run as $ServiceAccount"

  if (-not $ServicePassword) { throw '-ServiceAccount requires -ServicePassword.' }

  # The service must be able to start at all as that account.
  $nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
  if ($nssm) {
    & $nssm set $ServiceName ObjectName $ServiceAccount $ServicePassword | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "nssm failed to set the service account." }
  } else {
    # sc.exe obj= works for any service, nssm-installed or not.
    & sc.exe config $ServiceName obj= $ServiceAccount password= $ServicePassword | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'sc.exe config failed to set the service account.' }
  }
  Ok 'service account set'

  # "Log on as a service" is granted automatically by the Services MMC but not
  # by sc.exe or nssm, and without it the service simply refuses to start.
  Info 'if the service fails to start, grant "Log on as a service" to this account'
  Info '  (secpol.msc -> Local Policies -> User Rights Assignment)'

  Restart-Service $ServiceName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  $state = (Get-Service $ServiceName).Status
  if ($state -ne 'Running') {
    Warn "$ServiceName is $state after the change -- check the log and the right above."
  } else {
    Ok "$ServiceName restarted as $ServiceAccount"
  }
  $account = $ServiceAccount
}

# -------------------------------------------------------- 4. the destination
Step "Preparing $Destination"

if (-not (Test-Path -LiteralPath $Destination)) {
  if ($isUnc) {
    throw "$Destination is not reachable from this machine at all. Check the other " +
          'computer is on and the folder is shared before granting anything.'
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Ok 'created'
} else {
  Ok 'exists'
}

# A removable drive is the likeliest destination and the likeliest to break in
# a way nobody notices, because the letter is assigned by plug order.
if (-not $isUnc) {
  $root = [System.IO.Path]::GetPathRoot($Destination)
  $vol = Get-Volume -ErrorAction SilentlyContinue |
    Where-Object { $_.DriveLetter -and "$($_.DriveLetter):\" -eq $root }
  if ($vol) {
    Info "drive $root  label='$($vol.FileSystemLabel)'  type=$($vol.DriveType)  free=$([math]::Round($vol.SizeRemaining/1GB,1)) GB"
    if ($vol.DriveType -eq 'Removable') {
      Warn "$root is a removable drive. Its letter is assigned when it is plugged in,"
      Warn 'so if it comes back as a different letter the copy stops silently.'
      Warn 'Pin the letter: Disk Management -> right-click the volume -> Change Drive Letter.'
    }
  }
}

# ACLs are only ours to set on a local path. On a share, permissions live on
# the other machine and this script has no business changing them.
if (-not $isUnc) {
  & icacls $Destination /grant "${account}:(OI)(CI)M" | Out-Null
  if ($LASTEXITCODE -ne 0) { Warn "icacls could not grant $account on $Destination" }
  else { Ok "modify granted to $account" }
} else {
  Info 'network path -- permissions are set on the other machine, not here'
}

# --------------------------------------------------------------- 5. prove it
Step "Writing a test file as $account"

$result = Test-WriteAsAccount -Path $Destination -Account $account -Password $ServicePassword

if ($result.Ok) {
  Ok "$account can write to $Destination"
} elseif (-not $result.Tested) {
  Warn "Could not verify: $($result.Reason)."
  Warn 'Set the path in the app and use the "استعراض" button -- its writable badge'
  Warn 'runs the same test from inside the service.'
} else {
  Warn "$account could NOT write to $Destination -- $($result.Reason)"
  if ($isUnc) {
    Warn "On the other machine, share the folder and grant $account write access to"
    Warn 'both the share and the folder (Sharing tab AND Security tab -- both).'
  } else {
    Warn 'Check the drive is not read-only or write-protected.'
  }
  throw 'Destination is not writable by the service account.'
}

Write-Host ''
Write-Host '  Done.' -ForegroundColor Green
Write-Host '  Now set it in the app:' -ForegroundColor White
Write-Host '    الإعدادات -> النسخ الاحتياطي -> ضبط -> نسخ إلى مكان آخر' -ForegroundColor White
Write-Host "    $Destination" -ForegroundColor White
Write-Host ''
