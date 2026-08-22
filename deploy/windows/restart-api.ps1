<#
.SYNOPSIS
  Restarts the Inventory API service, asking for administrator rights itself.

.DESCRIPTION
  Restarting a Windows service needs administrator rights, and the error you
  get without them says "Cannot open 'inventory-api' service on computer '.'",
  which does not mention administrator rights at all. That message has cost
  enough time already, so this script asks for them instead of failing.

  Run it any way you like -- double-click, right-click "Run with PowerShell",
  or from a normal prompt. If it is not already elevated it re-launches itself
  and a UAC prompt appears; answer Yes.

  Afterwards it waits for the API to answer and prints what it found, so you
  know it actually came back rather than merely that the command returned.

.EXAMPLE
  .\restart-api.ps1
#>
[CmdletBinding()]
param(
  [string] $ServiceName = 'inventory-api',
  [string] $HealthUrl = 'http://127.0.0.1:4317/api/v1/health',

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
    FilePath     = (Get-Process -Id $PID).Path   # the same PowerShell that is running this
    Verb         = 'RunAs'
    ArgumentList = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', "`"$PSCommandPath`"",
      '-ServiceName', $ServiceName,
      '-HealthUrl', $HealthUrl,
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
    Write-Host "  3. Run:  Restart-Service $ServiceName"
    Write-Host ''
    Write-Host 'Or without any typing: press Win+R, run  services.msc ,'
    Write-Host '  find "Inventory API", right-click it -> Restart.'
    exit 1
  }
  exit 0
}

# ------------------------------------------------------------------ elevated
Write-Host ''
Write-Host "  Restarting $ServiceName" -ForegroundColor White

$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { throw "Service '$ServiceName' is not installed on this machine." }

Restart-Service $ServiceName
Write-Host '    ok   service restarted' -ForegroundColor Green

# The service comes back before the API has finished booting -- it opens the
# port first and connects to the database after (see server.js). So wait for a
# real answer rather than reporting success the instant the service is running.
Write-Host '         waiting for the API to answer...' -ForegroundColor DarkGray
$deadline = (Get-Date).AddSeconds(60)
$body = $null
while ((Get-Date) -lt $deadline) {
  try {
    $body = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
    if ($body.db -eq 'ready') { break }
  } catch {
    # Not up yet.
  }
  Start-Sleep -Seconds 2
}

Write-Host ''
if (-not $body) {
  Write-Host '    warn the API did not answer within 60 seconds.' -ForegroundColor Yellow
  Write-Host '         Check D:\Inventory\logs\api.err.log' -ForegroundColor Yellow
  exit 1
}

if ($body.db -eq 'ready') {
  Write-Host "    ok   API is up -- version $($body.version), database ready" -ForegroundColor Green
  Write-Host '         Sign in again in your browser.' -ForegroundColor DarkGray
} else {
  Write-Host "    warn API is listening but the database is '$($body.db)'" -ForegroundColor Yellow
  if ($body.dbError) { Write-Host "         $($body.dbError)" -ForegroundColor Yellow }
}
Write-Host ''
if ($Elevated) { Write-Host 'Press Enter to close.'; [void](Read-Host) }
