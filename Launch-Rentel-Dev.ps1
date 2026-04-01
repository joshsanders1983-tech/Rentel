$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[Rentel Dev] $Message"
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

  Write-Step "Applying database migrations..."
  Invoke-Npm -Args @("run", "db:deploy") -FailureMessage "npm run db:deploy failed."
} finally {
  Pop-Location
}

# Open the dashboard once the dev server responds (runs in parallel with tsx watch).
$browserJob = Start-Job -ScriptBlock {
  $ErrorActionPreference = "SilentlyContinue"
  for ($i = 0; $i -lt 120; $i++) {
    try {
      $response = Invoke-WebRequest -Uri "http://localhost:4000/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        Start-Process "http://localhost:4000"
        return
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
}

Write-Step "Starting dev server (npm run dev). Close this window to stop."
Write-Host ""

Push-Location $backendDir
try {
  & $script:npmExe @("run", "dev")
} finally {
  Pop-Location
  if ($browserJob -and $browserJob.State -eq "Running") {
    Stop-Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job $browserJob -ErrorAction SilentlyContinue
  }
}
