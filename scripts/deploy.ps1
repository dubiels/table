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
# Robocopy exits 1 on a SUCCESSFUL copy. Under PowerShell 7.3+ a native command's
# nonzero exit can be raised as an error subject to $ErrorActionPreference, which
# would abort this script on every working copy — and GitHub Actions' pwsh shell
# sets that preference to Stop for us. Turning this off makes the script behave
# identically under CI, under pwsh by hand, and under Windows PowerShell 5.1.
$PSNativeCommandUseErrorActionPreference = $false

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

function Test-Health {
	param([string]$Url, [int]$TimeoutSec)
	$deadline = (Get-Date).AddSeconds($TimeoutSec)
	while ((Get-Date) -lt $deadline) {
		try {
			if ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { return $true }
		} catch {
			# Expected while the process is still coming up.
		}
		Start-Sleep -Seconds 2
	}
	return $false
}

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
	throw "No build found in $Source. Run 'npm ci' and 'npm run build' first."
}
foreach ($dir in @($App, $DataDir, $Snapshots, $Releases)) {
	New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
$overrides = Join-Path $Personal 'logo-overrides.local.ts'
if ((Test-Path $overrides) -and -not (Test-Path (Join-Path $Source 'src\lib\server\people\logo-overrides.local.ts'))) {
	# These are pulled in at BUILD time, so a build made without them has already
	# lost every custom company mark. Better to say so than to ship it silently.
	Write-Warning "This build was made without logo-overrides.local.ts. Custom company marks will be missing. Copy it from $Personal, rebuild, and run again."
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
$movedModules = $false
if (Test-Path (Join-Path $App 'build')) {
	Invoke-Robocopy (Join-Path $App 'build') (Join-Path $Previous 'build')
	Copy-Item (Join-Path $App 'package-lock.json') $Previous -Force -ErrorAction SilentlyContinue
	Write-Host "Saved rollback copy: $Previous"
} else {
	Write-Host "No existing build to save - this is the first deploy."
}

# Dependencies are only replaced when the lockfile actually changed. That keeps
# the usual deploy fast (no multi-minute node_modules copy) and, when they DO
# change, the old tree is MOVED aside rather than overwritten - so a rollback can
# put back the dependencies the old build was compiled against. adapter-node
# leaves dependencies external, so restoring build/ alone onto a newer
# node_modules can fail exactly when rollback matters most.
$lockChanged = $true
$appLock = Join-Path $App 'package-lock.json'
if (Test-Path $appLock) {
	$lockChanged = (Get-FileHash $appLock).Hash -ne (Get-FileHash (Join-Path $Source 'package-lock.json')).Hash
}
if ($lockChanged) { Write-Host "package-lock.json changed - dependencies will be replaced." }
else { Write-Host "package-lock.json unchanged - keeping the installed dependencies." }

try {
	Step "Stop $ServiceName"
	# Inside the try: if stopping fails or times out, the catch below still runs
	# and reports it, rather than the script dying with the service half-stopped.
	$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
	if ($service -and $service.Status -eq 'Running') {
		Stop-Service -Name $ServiceName
		(Get-Service -Name $ServiceName).WaitForStatus('Stopped', '00:00:30')
	}

	Step "Copy the new release"
	# /PURGE on build/ so files deleted upstream do not linger and get served.
	Invoke-Robocopy (Join-Path $Source 'build')   (Join-Path $App 'build') @('/PURGE')
	Invoke-Robocopy (Join-Path $Source 'drizzle') (Join-Path $App 'drizzle')
	Invoke-Robocopy (Join-Path $Source 'scripts') (Join-Path $App 'scripts')
	if ($lockChanged) {
		if (Test-Path (Join-Path $App 'node_modules')) {
			Move-Item (Join-Path $App 'node_modules') (Join-Path $Previous 'node_modules')
			$movedModules = $true
		}
		Invoke-Robocopy (Join-Path $Source 'node_modules') (Join-Path $App 'node_modules')
	}
	Copy-Item (Join-Path $Source 'package.json')      $App -Force
	Copy-Item (Join-Path $Source 'package-lock.json') $App -Force

	Step "Start $ServiceName"
	Start-Service -Name $ServiceName
	(Get-Service -Name $ServiceName).WaitForStatus('Running', '00:00:30')

	Step "Health check"
	if (-not (Test-Health $HealthUrl $HealthTimeoutSec)) {
		throw "No 200 from $HealthUrl within ${HealthTimeoutSec}s."
	}

	Step "Verify the service opened the intended database"
	# A wrong DATABASE_PATH does not crash: db/index.ts creates the file, so the
	# service comes up healthy on a brand-new EMPTY database while the real one
	# sits untouched beside it. The health endpoint cannot see this - it reads no
	# data on purpose - so it is checked here instead.
	$rows = & node -e "const D=require('better-sqlite3');const d=new D(process.argv[1],{readonly:true});console.log(d.prepare('select (select count(*) from tasks)+(select count(*) from people) n').get().n)" $Database
	if ($LASTEXITCODE -ne 0) { throw "Could not read $Database after deploy." }
	Write-Host "$Database holds $rows task+person rows."
	if ([int]$rows -eq 0) {
		Write-Warning "That database is EMPTY. If it should not be, the service may be pointed somewhere else - check DATABASE_PATH in $EnvFile."
	}

	Write-Host "Healthy." -ForegroundColor Green
} catch {
	Write-Host "`nDEPLOY FAILED: $_" -ForegroundColor Red

	if (Test-Path (Join-Path $Previous 'build')) {
		Write-Host "Rolling back to $Previous" -ForegroundColor Yellow
		# Every step tolerant of failure: this is the recovery path, and dying
		# inside it would leave the service down with nothing restored.
		try {
			Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
			(Get-Service -Name $ServiceName -ErrorAction SilentlyContinue).WaitForStatus('Stopped', '00:00:30')
		} catch {
			Write-Host "Service did not stop cleanly; continuing with the rollback." -ForegroundColor Yellow
		}
		Invoke-Robocopy (Join-Path $Previous 'build') (Join-Path $App 'build') @('/PURGE')
		if ($movedModules -and (Test-Path (Join-Path $Previous 'node_modules'))) {
			Remove-Item (Join-Path $App 'node_modules') -Recurse -Force -ErrorAction SilentlyContinue
			Move-Item (Join-Path $Previous 'node_modules') (Join-Path $App 'node_modules')
			Copy-Item (Join-Path $Previous 'package-lock.json') $App -Force -ErrorAction SilentlyContinue
			Write-Host "Restored the previous dependencies as well." -ForegroundColor Yellow
		}
		Start-Service -Name $ServiceName -ErrorAction SilentlyContinue

		# Rolling back is not the same as being back up. Say which one happened.
		if (Test-Health $HealthUrl 60) {
			Write-Host "Rolled back and healthy." -ForegroundColor Yellow
		} else {
			Write-Host "ROLLED BACK BUT STILL UNHEALTHY - the site is down. See $Root\logs\table.err.log" -ForegroundColor Red
		}
		Write-Host "NOTE: the schema was NOT rolled back - migrations are forward-only. Snapshot: $Snapshots\table-$Stamp.sqlite" -ForegroundColor Yellow
	} else {
		Write-Host "No previous build to roll back to. The service is down." -ForegroundColor Red
		Write-Host "Recover with: fix the cause, then re-run this script from a good checkout." -ForegroundColor Red
	}
	exit 1
}

Step "Prune old releases and snapshots"
Get-ChildItem $Releases  -Directory | Sort-Object Name -Descending | Select-Object -Skip $KeepReleases  | Remove-Item -Recurse -Force
Get-ChildItem $Snapshots -File      | Sort-Object Name -Descending | Select-Object -Skip $KeepSnapshots | Remove-Item -Force

Write-Host "`nDeployed $Stamp" -ForegroundColor Green
