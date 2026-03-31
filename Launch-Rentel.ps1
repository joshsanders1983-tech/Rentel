$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[Rentel] $Message"
}

function Test-RentelRunning {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/health" -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Invoke-Npm {
  param(
    [string[]]$Args,
    [string]$FailureMessage
  )

  & $script:npmExe @Args | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "rental-backend"
$packageJsonPath = Join-Path $backendDir "package.json"

if (-not (Test-Path $packageJsonPath)) {
  Write-Host "Could not find rental-backend/package.json. Expected repo root at: $repoRoot" -ForegroundColor Red
  exit 1
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue

if (-not $nodeCmd -or -not $npmCmd) {
  Write-Host "Node.js and npm are required. Install Node.js LTS, then run again." -ForegroundColor Red
  exit 1
}

$script:npmExe = $npmCmd.Source

Push-Location $backendDir
try {
  if (-not (Test-Path (Join-Path $backendDir "node_modules"))) {
    Write-Step "Installing dependencies (first run)..."
    Invoke-Npm -Args @("install") -FailureMessage "npm install failed."
  }

  if (-not (Test-Path (Join-Path $backendDir "dist\server.js"))) {
    Write-Step "Building app (first run)..."
    Invoke-Npm -Args @("run", "build") -FailureMessage "npm run build failed."
  }

  Write-Step "Applying database migrations..."
  Invoke-Npm -Args @("run", "db:deploy") -FailureMessage "npm run db:deploy failed."
} finally {
  Pop-Location
}

if (-not (Test-RentelRunning)) {
  Write-Step "Starting app server..."
  Start-Process -FilePath $nodeCmd.Source -ArgumentList "dist/server.js" -WorkingDirectory $backendDir -WindowStyle Hidden | Out-Null

  $started = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-RentelRunning) {
      $started = $true
      break
    }
  }

  if (-not $started) {
    Write-Host "Rentel server did not start correctly. Run 'npm run build' then 'npm start' in $backendDir." -ForegroundColor Red
    exit 1
  }
}

Write-Step "Opening app in your browser..."
try {
  Start-Process "http://localhost:4000" | Out-Null
} catch {
  Write-Host "App is running at http://localhost:4000" -ForegroundColor Yellow
}
