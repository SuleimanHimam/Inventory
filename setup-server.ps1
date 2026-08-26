<#
.SYNOPSIS
  One-shot setup of this application on a fresh Windows machine.

.DESCRIPTION
  Takes a clean Windows Server (or Windows 10/11) from nothing to a running
  inventory system: prerequisites, dependencies, database, schema, frontend
  build, and optionally the always-on services.

  Every step is idempotent. Re-running after a failure resumes rather than
  breaking: existing packages are skipped, the database is only created if
  absent, and the migration runner records what it applied.

.PARAMETER AppRoot
  Where the code lives. If this script is run from inside a checkout, that
  checkout is used and nothing is cloned.

.PARAMETER Domain
  Public hostname, e.g. inventory.example.com. Used for CORS and the frontend
  build. Leave empty for a LAN-only install and the machine's own address is
  used instead.

.PARAMETER DbPassword
  Password for the application's database login (app_api). Generated if
  omitted -- but the login itself has to already exist: run
  server\provision-mssql.sql once, as sa, before this script (see
  deploy\windows\README.md step 1). This script does not install or
  provision SQL Server itself -- that is a heavier, more environment-specific
  step than a generic setup script should attempt silently.

.PARAMETER SupabaseUrl
  Enables login. Without it the API runs with AUTH_MODE=none, which serves
  every request as one shared user -- acceptable on a private LAN, not on a
  public address.

.PARAMETER InstallServices
  Also register the Windows services, so the app survives reboots. Requires
  elevation, a domain, and Caddy.

.EXAMPLE
  .\setup-server.ps1
  Local install for evaluation. No login, no TLS, http://localhost:4317.

.EXAMPLE
  .\setup-server.ps1 -Domain inventory.example.com -SupabaseUrl https://abc.supabase.co -InstallServices
  Full production install.

.NOTES
  Run from an elevated PowerShell if you pass -InstallPrereqs or
  -InstallServices. Otherwise a normal prompt is enough.
#>
[CmdletBinding()]
param(
  [string] $AppRoot = '',
  [string] $Domain = '',
  [string] $DbServer = '127.0.0.1\INVENTORY',
  [string] $DbName = 'inventory',
  [string] $DbUser = 'app_api',
  [string] $DbPassword = '',
  [string] $SupabaseUrl = '',
  [switch] $InstallPrereqs,
  [switch] $InstallServices,
  [switch] $Seed
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:StepNumber = 0
function Step([string] $Text) {
  $script:StepNumber++
  Write-Host ''
  Write-Host ("[{0}] {1}" -f $script:StepNumber, $Text) -ForegroundColor Cyan
}
function Ok([string] $Text)   { Write-Host "    ok   $Text" -ForegroundColor Green }
function Info([string] $Text) { Write-Host "         $Text" -ForegroundColor DarkGray }
function Warn([string] $Text) { Write-Host "    warn $Text" -ForegroundColor Yellow }

function Test-Admin {
  ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Re-read PATH from the registry. winget updates the machine PATH but the
# running shell keeps its old copy, so a freshly installed node is invisible
# without this.
function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ($machine, $user | Where-Object { $_ }) -join ';'
}

function Find-Exe([string] $Name, [string[]] $Globs) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($g in $Globs) {
    $hit = Get-ChildItem $g -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

Write-Host ''
Write-Host '  Inventory Management System -- server setup' -ForegroundColor White
Write-Host '  ============================================'

# ---------------------------------------------------------------- 1. prereqs
Step 'Checking prerequisites'

if ($InstallPrereqs) {
  if (-not (Test-Admin)) { throw '-InstallPrereqs needs an elevated PowerShell.' }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget not available. Install the prerequisites by hand -- see deploy\windows\README.md'
  }
  # SQL Server itself is deliberately not in this list -- see deploy\windows\README.md
  # for the unattended-install command. It needs a named instance and a
  # provisioning script (provision-mssql.sql), not a silent package install.
  foreach ($pkg in 'OpenJS.NodeJS.LTS', 'Git.Git') {
    Info "winget install $pkg"
    winget install --id $pkg --silent --accept-package-agreements --accept-source-agreements 2>&1 |
      Out-Null
  }
  Update-PathFromRegistry
}

Update-PathFromRegistry

$node = Find-Exe 'node' @('C:\Program Files\nodejs\node.exe')
if (-not $node) {
  throw 'Node.js not found. Install it, or re-run with -InstallPrereqs. Needs 20.12 or newer.'
}
$nodeVersion = (& $node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion -split '\.')[0]
$nodeMinor = [int]($nodeVersion -split '\.')[1]
if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 12)) {
  throw "Node.js $nodeVersion is too old. 20.12 is the floor -- the service loads its configuration with --env-file."
}
Ok "Node.js $nodeVersion"

$sqlcmd = Find-Exe 'sqlcmd' @('C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\*\Tools\Binn\sqlcmd.exe')
if (-not $sqlcmd) {
  throw 'sqlcmd not found. Install the SQL Server command-line tools, or SQL Server itself -- see deploy\windows\README.md.'
}
Ok "sqlcmd at $sqlcmd"

$instanceName = ($DbServer -split '\\')[-1]
$sqlService = Get-Service "MSSQL`$$instanceName" -ErrorAction SilentlyContinue
if (-not $sqlService) {
  throw "SQL Server service 'MSSQL`$$instanceName' not found. Provision the INVENTORY instance first -- see deploy\windows\README.md."
} elseif ($sqlService.Status -ne 'Running') {
  Info "starting $($sqlService.Name)"
  Start-Service $sqlService.Name
  Ok "$($sqlService.Name) started"
} else {
  Ok "$($sqlService.Name) running"
}

# ---------------------------------------------------------------- 2. the code
Step 'Locating the application'

if (-not $AppRoot) {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  if (Test-Path (Join-Path $here 'server\package.json')) {
    $AppRoot = $here
  } else {
    $AppRoot = 'C:\inventory'
  }
}

if (-not (Test-Path (Join-Path $AppRoot 'server\package.json'))) {
  $git = Find-Exe 'git' @('C:\Program Files\Git\cmd\git.exe')
  if (-not $git) { throw "No checkout at $AppRoot and git is not installed." }
  Info "cloning into $AppRoot"
  & $git clone --quiet https://github.com/SuleimanHimam/Inventory.git $AppRoot
}
Ok $AppRoot

$serverDir = Join-Path $AppRoot 'server'
$clientDir = Join-Path $AppRoot 'client'

# ---------------------------------------------------------------- 3. deps
Step 'Installing dependencies'
Push-Location $AppRoot
try {
  & npm install --prefix server --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed for server (exit $LASTEXITCODE)" }
  Ok 'server'
  & npm install --prefix client --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed for client (exit $LASTEXITCODE)" }
  Ok 'client'
} finally { Pop-Location }

# ---------------------------------------------------------------- 4. database
Step 'Database'

# Provisioning the database and the app_api login is a separate, manual step
# (server\provision-mssql.sql, run once as sa) rather than something this
# script does silently -- unlike a Postgres CREATE DATABASE/CREATE ROLE, it
# involves a collation choice worth spot-checking against real data first,
# and this script has no good way to prompt for or validate an sa password.
if (-not $DbPassword) {
  throw "-DbPassword is required. Run server\provision-mssql.sql as sa first (see deploy\windows\README.md step 1), then pass the app_api password you set there."
}

Info "checking the '$instanceName' instance is reachable as app_api"
& $sqlcmd -S $DbServer -U $DbUser -P $DbPassword -d $DbName -Q "SELECT 1" -C -h -1 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not connect to $DbServer as '$DbUser'. Check DbPassword, and that provision-mssql.sql has been run."
}
Ok "database '$DbName' reachable as '$DbUser'"

# ---------------------------------------------------------------- 5. config
Step 'Configuration'

$envPath = Join-Path $serverDir '.env'
if (Test-Path $envPath) {
  $backup = "$envPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $envPath $backup
  Info "existing .env backed up to $(Split-Path -Leaf $backup)"
}

$publicUrl = if ($Domain) { "https://$Domain" } else { 'http://127.0.0.1:5173' }
$authMode  = if ($SupabaseUrl) { 'supabase' } else { 'none' }
$uploads   = Join-Path $AppRoot 'data\uploads'

$envLines = @(
  '# Generated by setup-server.ps1. Safe to edit; restart the service after.',
  'NODE_ENV=production',
  '',
  '# Loopback only when a reverse proxy fronts this. Set HOST=0.0.0.0 to expose',
  '# the API directly on the LAN (no TLS -- traffic is readable in transit).',
  $(if ($Domain) { 'HOST=127.0.0.1' } else { 'HOST=0.0.0.0' }),
  'PORT=4317',
  '',
  "DB_SERVER=$DbServer",
  "DB_NAME=$DbName",
  "DB_USER=$DbUser",
  "DB_PASSWORD=$DbPassword",
  'DB_ENCRYPT=false',
  '',
  "AUTH_MODE=$authMode"
)
if ($SupabaseUrl) {
  $envLines += "SUPABASE_URL=$SupabaseUrl"
} else {
  $envLines += '# WARNING: AUTH_MODE=none serves every request as one shared user.'
  $envLines += '# Set SUPABASE_URL and AUTH_MODE=supabase before exposing this publicly.'
}
$envLines += @(
  'ALLOW_AUTO_PROVISION=1',
  '',
  'STORAGE_DRIVER=local',
  "UPLOADS_DIR=$uploads",
  '',
  "CORS_ORIGIN=$publicUrl"
)

$envLines -join "`r`n" | Set-Content -Path $envPath -Encoding utf8
Ok "wrote $envPath"

if (-not (Test-Path $uploads)) { New-Item -ItemType Directory -Path $uploads -Force | Out-Null }
Ok "uploads directory $uploads"

# ---------------------------------------------------------------- 6. schema
Step 'Applying the schema'
Push-Location $serverDir
try {
  & $node --env-file=.env src/db/migrate.js
  if ($LASTEXITCODE -ne 0) { throw "Migrations failed (exit $LASTEXITCODE)" }
  Ok 'migrations applied'

  if ($Seed) {
    & $node --env-file=.env src/db/seed.js
    if ($LASTEXITCODE -ne 0) { Warn 'Seeding failed -- the schema is fine, sample data is not loaded.' }
    else { Ok 'sample data loaded' }
  }

  Info 'checking the connection'
  & $node --env-file=.env src/db/doctor.js
} finally { Pop-Location }

# ---------------------------------------------------------------- 7. frontend
Step 'Building the frontend'

$clientEnv = @("VITE_API_URL=$publicUrl")
if ($SupabaseUrl) {
  $clientEnv += "VITE_SUPABASE_URL=$SupabaseUrl"
  $clientEnv += '# VITE_SUPABASE_ANON_KEY is required for the login screen to work.'
  $clientEnv += '# Project settings -> API -> anon/public key. Then rebuild:'
  $clientEnv += '#   cd client; npm run build'
  $clientEnv += 'VITE_SUPABASE_ANON_KEY='
  Warn 'VITE_SUPABASE_ANON_KEY is empty -- add it to client\.env.production and rebuild.'
}
$clientEnv -join "`r`n" | Set-Content -Path (Join-Path $clientDir '.env.production') -Encoding utf8

Push-Location $clientDir
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed (exit $LASTEXITCODE)" }
  Ok "built to $clientDir\dist"
} finally { Pop-Location }

# ---------------------------------------------------------------- 8. services
if ($InstallServices) {
  Step 'Registering Windows services'
  if (-not (Test-Admin)) { throw '-InstallServices needs an elevated PowerShell.' }
  $installer = Join-Path $AppRoot 'deploy\windows\install-services.ps1'
  if (-not (Test-Path $installer)) { throw "Not found: $installer" }
  & $installer -AppRoot $AppRoot
}

# ---------------------------------------------------------------- done
Write-Host ''
Write-Host '  Done.' -ForegroundColor Green
Write-Host ''

if (-not $InstallServices) {
  Write-Host '  Start it:'
  Write-Host "    cd $serverDir"
  Write-Host '    npm start'
  Write-Host ''
}

Write-Host '  Check it:'
Write-Host '    curl.exe http://127.0.0.1:4317/api/v1/health'
Write-Host ''
Write-Host '  Read the payload, not just the status code:'
Write-Host '    "db":"ready"        healthy'
Write-Host '    "dbError"           listening, but the database is unreachable'
Write-Host '    "insecure":true     NO LOGIN -- anyone who reaches this can change your data'
Write-Host ''

if (-not $SupabaseUrl) {
  Write-Host '  This install has no authentication.' -ForegroundColor Yellow
  Write-Host '  Fine on a private network. Before exposing it to the internet, set'
  Write-Host '  SUPABASE_URL in server\.env and AUTH_MODE=supabase -- the login code is'
  Write-Host '  already there on both sides and needs no changes.'
  Write-Host ''
}
