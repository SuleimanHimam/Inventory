<#
.SYNOPSIS
  Brings the INVENTORY SQL Server instance back up and stops the same outage
  from happening again unattended.

.DESCRIPTION
  On 2026-08-24 the machine lost power twice inside forty minutes. After the
  second reboot the SQL Server (INVENTORY) service exceeded the 30-second
  service-control start timeout -- Windows was starting four SQL Server
  instances, PostgreSQL, MySQL, Analysis Services, Integration Services and
  PolyBase at once, and every database also had crash recovery to run -- so
  Windows gave up on it:

    Event 7009  A timeout was reached (30000 milliseconds) while waiting for
                the SQL Server (INVENTORY) service to connect.

  Nothing retried it, because the service had no recovery actions configured.
  The API stayed up and answered every request with a 500 for the next forty
  minutes.

  This script does two things:

    1. Starts the instance if it is stopped, then restarts the API so its
       connection pool reconnects.

    2. Configures recovery actions so Windows restarts the instance by itself
       after 30s, then 60s, then 120s. `failureflag 1` is what makes those
       actions apply to a start-up timeout as well; without it they only fire
       when an already-running service crashes, which is not what happened.

  Safe to run at any time -- if the instance is already running it only
  applies the configuration.

  It asks for administrator rights itself; answer Yes to the prompt.

.EXAMPLE
  .\repair-database-service.ps1
#>
[CmdletBinding()]
param(
  [string] $InstanceService = 'MSSQL$INVENTORY',
  [string] $ApiService = 'inventory-api',

  # Set automatically when the script re-launches itself elevated.
  [switch] $Elevated
)

$ErrorActionPreference = 'Stop'

function Test-Admin {
  ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  if ($Elevated) {
    throw 'Re-launched but still not elevated. Right-click PowerShell -> Run as administrator, then run this again.'
  }
  Write-Host 'Asking for administrator rights -- answer Yes to the prompt...' -ForegroundColor Yellow
  $psi = @{
    FilePath     = (Get-Process -Id $PID).Path
    Verb         = 'RunAs'
    ArgumentList = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', "`"$PSCommandPath`"",
      '-InstanceService', $InstanceService,
      '-ApiService', $ApiService,
      '-Elevated'
    )
  }
  try {
    Start-Process @psi -Wait
  } catch {
    Write-Host ''
    Write-Host 'The prompt was refused or unavailable. Do it by hand instead:' -ForegroundColor Yellow
    Write-Host '  1. Press Start, type PowerShell'
    Write-Host '  2. Right-click it -> Run as administrator'
    Write-Host "  3. Run:  Start-Service '$InstanceService'; Restart-Service $ApiService"
    Write-Host ''
    Write-Host 'Or without any typing: press Win+R, run  services.msc ,'
    Write-Host '  find "SQL Server (INVENTORY)", right-click it -> Start.'
    exit 1
  }
  exit 0
}

# ------------------------------------------------------------------ elevated
Write-Host ''
Write-Host '  Inventory database service' -ForegroundColor White

$svc = Get-Service $InstanceService -ErrorAction SilentlyContinue
if (-not $svc) { throw "Service '$InstanceService' is not installed on this machine." }

# ---- 1. up ----------------------------------------------------------------
if ($svc.Status -ne 'Running') {
  Write-Host "    ..   $InstanceService is $($svc.Status) -- starting it" -ForegroundColor Yellow
  Start-Service $InstanceService
  # A start after an unclean shutdown runs crash recovery on every database,
  # so allow well past the 30s Windows itself gives up at.
  $svc.WaitForStatus('Running', '00:03:00')
  Write-Host '    ok   instance started' -ForegroundColor Green

  Write-Host "    ..   restarting $ApiService so its pool reconnects" -ForegroundColor DarkGray
  Restart-Service $ApiService -Force
  Write-Host '    ok   API restarted' -ForegroundColor Green
} else {
  Write-Host '    ok   instance already running' -ForegroundColor Green
}

# ---- 2. keep it up --------------------------------------------------------
Write-Host ''
Write-Host '  Recovery actions' -ForegroundColor White

& sc.exe failure $InstanceService reset= 86400 `
  actions= restart/30000/restart/60000/restart/120000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe failure returned $LASTEXITCODE" }

# Without this, recovery actions ignore a start-up timeout -- the exact
# failure mode this script exists for.
& sc.exe failureflag $InstanceService 1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe failureflag returned $LASTEXITCODE" }

Write-Host '    ok   restart after 30s, then 60s, then 120s; counter resets daily' -ForegroundColor Green
Write-Host '    ok   start-up failures count too' -ForegroundColor Green

Write-Host ''
& sc.exe qfailure $InstanceService

Write-Host ''
Write-Host '  Note: this makes the database recover on its own. It does not' -ForegroundColor DarkGray
Write-Host '  address why the machine keeps losing power -- see the unexpected' -ForegroundColor DarkGray
Write-Host '  shutdowns in Event Viewer (Kernel-Power 41, BugcheckCode 0).' -ForegroundColor DarkGray
Write-Host ''
if ($Elevated) { Write-Host 'Press Enter to close.'; [void](Read-Host) }
