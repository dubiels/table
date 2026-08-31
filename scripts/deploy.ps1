<#
.SYNOPSIS
  Deploys the build in the current directory to the live Table service.

.DESCRIPTION
  Run from a checkout that has already had `npm ci` and `npm run build` done in
  it — normally the GitHub Actions runner workspace, but it works by hand too,
  which is the point: a deploy you cannot run manually is one you cannot debug
  at 1am.

  The order is deliberate. The snapshot is taken before migrations because
  migrations are forward-only; the service is stopped before the swap because
  Windows will not replace a file a running process holds open; and the health
  check gates a rollback because a build that starts and then dies is the
  failure this exists to catch.

.NOTES
  Rollback restores the previous *build*, never the previous *schema*. If a
  migration is the thing that broke, restore the snapshot by hand — see
  DEPLOYMENT.md.
#>
[CmdletBinding()]
param(
	[string]$Root = 'C:\table',
	[string]$ServiceName = 'Table',
	[string]$HealthUrl = 'http://127.0.0.1:3000/api/health',
	[int]$HealthTimeoutSec = 90,
	[int]$KeepReleases = 5,
	[int]$KeepSnapshots = 10
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Source    = (Get-Location).Path
$App       = Join-Path $Root 'app'
$DataDir   = Join-Path $Root 'data'
$Database  = Join-Path $DataDir 'table.sqlite'
$EnvFile   = Join-Path $Root 'env\.env'
$Personal  = Join-Path $Root 'personal'
$Snapshots = Join-Path $Root 'snapshots'
$Releases  = Join-Path $Root 'releases'
$Stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'

function Step($message) { Write-Host "`n=== $message" -ForegroundColor Cyan }

# Robocopy signals success with 0-7; anything higher is a real failure. Left
# unchecked it also poisons $LASTEXITCODE for whatever runs next, which is how a
# green deploy step can hide a copy that did nothing.
function Invoke-Robocopy {
	param([string]$From, [string]$To, [string[]]$Extra = @())
	& robocopy $From $To /E /NFL /NDL /NJH /NJS /NP @Extra | Out-Null
	if ($LASTEXITCODE -ge 8) { throw "robocopy $From -> $To failed with $LASTEXITCODE" }
	$global:LASTEXITCODE = 0
}

Step "Preflight"
foreach ($required in @($EnvFile, $Root)) {
	if (-not (Test-Path $required)) { throw "Missing $required. Run the one-time setup in DEPLOYMENT.md first." }
}
if (-not (Test-Path (Join-Path $Source 'build\index.js'))) {
	throw "No build found in $Source. Run `npm ci` and `npm run build` first."
}
foreach ($dir in @($App, $DataDir, $Snapshots, $Releases)) {
	New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Write-Host "Source:   $Source"
Write-Host "Target:   $App"

Step "Snapshot the database"
# Taken while the service is still up: VACUUM INTO is safe on a live database,
# and doing it first means a failure here costs nothing but a retry.
& npx tsx (Join-Path $Source 'scripts\snapshot-db.ts') $Database (Join-Path $Snapshots "table-$Stamp.sqlite")
if ($LASTEXITCODE -ne 0) { throw "Snapshot failed; refusing to deploy." }

Step "Apply migrations"
# Against the live database, before the swap. A migration that fails leaves the
# old build running against the old schema, which is a working system.
$env:DATABASE_PATH = $Database
& npx tsx (Join-Path $Source 'src\lib\server\db\migrate.ts')
if ($LASTEXITCODE -ne 0) { throw "Migration failed. The running service is untouched; restore from $Snapshots if the schema is damaged." }

Step "Seed the city dataset"
# Idempotent: it hashes the bundled dataset and returns immediately when that
# version is already loaded, so this is free on every deploy that did not change it.
& npx tsx (Join-Path $Source 'scripts\seed-cities.ts')
if ($LASTEXITCODE -ne 0) { throw "City seed failed." }

Step "Keep the current build for rollback"
$Previous = Join-Path $Releases $Stamp
if (Test-Path (Join-Path $App 'build')) {
	Invoke-Robocopy (Join-Path $App 'build') (Join-Path $Previous 'build')
	Write-Host "Saved rollback copy: $Previous"
} else {
	Write-Host "No existing build to save — this is the first deploy."
}

Step "Stop $ServiceName"
# Windows will not let a file be replaced while a process holds it open, so the
# service has to be down for the swap. This is the only downtime in the deploy.
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq 'Running') {
	Stop-Service -Name $ServiceName
	(Get-Service -Name $ServiceName).WaitForStatus('Stopped', '00:00:30')
}

try {
	Step "Copy the new release"
	# /PURGE on build/ so files deleted upstream do not linger and get served.
	Invoke-Robocopy (Join-Path $Source 'build')        (Join-Path $App 'build') @('/PURGE')
	Invoke-Robocopy (Join-Path $Source 'drizzle')      (Join-Path $App 'drizzle')
	Invoke-Robocopy (Join-Path $Source 'scripts')      (Join-Path $App 'scripts')
	Invoke-Robocopy (Join-Path $Source 'node_modules') (Join-Path $App 'node_modules')
	Copy-Item (Join-Path $Source 'package.json')      $App -Force
	Copy-Item (Join-Path $Source 'package-lock.json') $App -Force

	Step "Start $ServiceName"
	Start-Service -Name $ServiceName
	(Get-Service -Name $ServiceName).WaitForStatus('Running', '00:00:30')

	Step "Health check"
	$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
	$healthy = $false
	while ((Get-Date) -lt $deadline) {
		try {
			$response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
			if ($response.StatusCode -eq 200) { $healthy = $true; break }
		} catch {
			# Expected while the process is still coming up.
		}
		Start-Sleep -Seconds 2
	}
	if (-not $healthy) { throw "No 200 from $HealthUrl within ${HealthTimeoutSec}s." }
	Write-Host "Healthy." -ForegroundColor Green
} catch {
	Write-Host "`nDEPLOY FAILED: $_" -ForegroundColor Red

	if (Test-Path (Join-Path $Previous 'build')) {
		Write-Host "Rolling back to $Previous" -ForegroundColor Yellow
		Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
		(Get-Service -Name $ServiceName).WaitForStatus('Stopped', '00:00:30')
		Invoke-Robocopy (Join-Path $Previous 'build') (Join-Path $App 'build') @('/PURGE')
		Start-Service -Name $ServiceName
		Write-Host "Rolled back. NOTE: the schema was NOT rolled back — migrations are forward-only." -ForegroundColor Yellow
	} else {
		Write-Host "No previous build to roll back to. The service is down." -ForegroundColor Red
	}
	exit 1
}

Step "Prune old releases and snapshots"
Get-ChildItem $Releases  -Directory | Sort-Object Name -Descending | Select-Object -Skip $KeepReleases  | Remove-Item -Recurse -Force
Get-ChildItem $Snapshots -File      | Sort-Object Name -Descending | Select-Object -Skip $KeepSnapshots | Remove-Item -Force

Write-Host "`nDeployed $Stamp" -ForegroundColor Green
