<#
.SYNOPSIS
  Register the API and Caddy as Windows services, so the app runs unattended and
  comes back by itself after a reboot or a crash.

.DESCRIPTION
  "Runs all the time" is really four separate guarantees, and a console window
  running `npm start` provides none of them:

    1. survives you logging off        -> a service, not a session process
    2. starts after a reboot           -> Automatic start type
    3. restarts after a crash          -> NSSM's exit action / SC failure actions
    4. starts after Postgres is ready  -> service dependency

  NSSM (the Non-Sucking Service Manager) supplies all four for a plain
  node.exe. Install it first with:  winget install NSSM.NSSM

.NOTES
  Run from an elevated PowerShell. Re-running is safe: existing services are
  removed and recreated.
#>
[CmdletBinding()]
param(
  # Where the repository is checked out on the server.
  [string] $AppRoot = 'C:\inventory',
  # Where Caddy and its Caddyfile live.
  [string] $CaddyExe = 'C:\caddy\caddy.exe',
  [string] $Caddyfile = 'C:\caddy\Caddyfile',
  # The Postgres service name -- `Get-Service postgresql*` if unsure.
  [string] $PostgresService = 'postgresql-x64-16'
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an elevated PowerShell (Run as Administrator).'
}

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { throw 'nssm not found on PATH. Install it: winget install NSSM.NSSM' }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node not found on PATH. Install Node.js 20.12 or newer.' }

$logs = Join-Path $AppRoot 'logs'
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs | Out-Null }

function Remove-ServiceIfPresent([string] $Name) {
  if (Get-Service -Name $Name -ErrorAction SilentlyContinue) {
    Write-Host "  removing existing service $Name"
    & $nssm stop $Name confirm | Out-Null
    & $nssm remove $Name confirm | Out-Null
    Start-Sleep -Seconds 1
  }
}

# ---------------------------------------------------------------- the API
Write-Host 'Registering inventory-api...'
Remove-ServiceIfPresent 'inventory-api'

$serverDir = Join-Path $AppRoot 'server'
# Configuration comes from server\.env via Node's own --env-file, not from the
# service definition, so rotating a secret is editing a file and restarting --
# no re-registration, and no credentials in the registry.
if (-not (Test-Path (Join-Path $serverDir '.env'))) {
  throw "Missing $serverDir\.env -- copy deploy\windows\env.production.example to it first."
}

& $nssm install inventory-api $node '--env-file=.env src/server.js'
& $nssm set inventory-api AppDirectory $serverDir
& $nssm set inventory-api DisplayName 'Inventory API'
& $nssm set inventory-api Description 'Arabic inventory management API (Express, port 4317, loopback only)'
& $nssm set inventory-api Start SERVICE_AUTO_START

# Restart on any unexpected exit, backing off so a crash loop cannot pin the CPU.
& $nssm set inventory-api AppExit Default Restart
& $nssm set inventory-api AppRestartDelay 5000
& $nssm set inventory-api AppThrottle 10000

# stdout/stderr to files, rotated -- this is where the boot banner and the
# migration output land.
& $nssm set inventory-api AppStdout (Join-Path $logs 'api.log')
& $nssm set inventory-api AppStderr (Join-Path $logs 'api.err.log')
& $nssm set inventory-api AppRotateFiles 1
& $nssm set inventory-api AppRotateBytes 10485760

# Do not start before the database is accepting connections.
if (Get-Service -Name $PostgresService -ErrorAction SilentlyContinue) {
  & $nssm set inventory-api DependOnService $PostgresService
} else {
  Write-Warning "Postgres service '$PostgresService' not found -- skipping the dependency."
  Write-Warning "Find the real name with: Get-Service postgresql*"
}

# ---------------------------------------------------------------- Caddy (TLS)
Write-Host 'Registering caddy...'
Remove-ServiceIfPresent 'caddy'

& $nssm install caddy $CaddyExe 'run' '--config' $Caddyfile
& $nssm set caddy AppDirectory (Split-Path $CaddyExe)
& $nssm set caddy DisplayName 'Caddy (TLS reverse proxy)'
& $nssm set caddy Start SERVICE_AUTO_START
& $nssm set caddy AppExit Default Restart
& $nssm set caddy AppRestartDelay 5000
& $nssm set caddy AppStdout (Join-Path $logs 'caddy.log')
& $nssm set caddy AppStderr (Join-Path $logs 'caddy.err.log')
& $nssm set caddy AppRotateFiles 1
& $nssm set caddy AppRotateBytes 10485760
& $nssm set caddy DependOnService 'inventory-api'

# ---------------------------------------------------------------- firewall
# 80 and 443 inbound; 4317 is deliberately absent. The API binds 127.0.0.1, so
# it is not reachable from the network even if a rule appeared by accident.
Write-Host 'Firewall rules...'
foreach ($port in 80, 443) {
  $name = "Inventory HTTP $port"
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP `
    -LocalPort $port -Action Allow -Profile Any | Out-Null
}

Write-Host ''
Write-Host 'Starting services...'
Start-Service inventory-api
Start-Service caddy

Get-Service inventory-api, caddy | Format-Table Name, Status, StartType -AutoSize

Write-Host ''
Write-Host 'Check it:'
Write-Host '  curl.exe http://127.0.0.1:4317/api/v1/health     # the API directly'
Write-Host '  curl.exe https://YOUR-DOMAIN/api/v1/health       # through Caddy + TLS'
Write-Host ''
Write-Host 'Logs:'
Write-Host "  Get-Content $logs\api.log -Tail 40 -Wait"
