$ErrorActionPreference = "Stop"

function Write-Title([string]$Message) {
  Write-Host ""
  Write-Host $Message -ForegroundColor Cyan
}

function Get-EnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path $Path)) { return "" }
  foreach ($line in Get-Content $Path) {
    $t = $line.Trim()
    if ($t.StartsWith("#") -or $t.Length -eq 0) { continue }
    $idx = $t.IndexOf("=")
    if ($idx -lt 1) { continue }
    $k = $t.Substring(0, $idx).Trim()
    if ($k -ne $Key) { continue }
    $v = $t.Substring($idx + 1).Trim()
    if ($v.Length -ge 2 -and $v.StartsWith('"') -and $v.EndsWith('"')) {
      return $v.Substring(1, $v.Length - 2)
    }
    return $v
  }
  return ""
}

function Set-EnvValue {
  param([string]$Path, [string]$Key, [string]$Value)
  $lines = @()
  if (Test-Path $Path) { $lines = @(Get-Content $Path) }
  $found = $false
  $out = New-Object System.Collections.ArrayList
  foreach ($line in $lines) {
    $t = $line.Trim()
    if ($t.Length -gt 0 -and -not $t.StartsWith("#") -and $t.IndexOf("=") -gt 0) {
      $idx = $t.IndexOf("=")
      $k = $t.Substring(0, $idx).Trim()
      if ($k -eq $Key) {
        [void]$out.Add("$Key=`"$Value`"")
        $found = $true
        continue
      }
    }
    [void]$out.Add($line)
  }
  if (-not $found) {
    [void]$out.Add("$Key=`"$Value`"")
  }
  $out | Set-Content $Path -Encoding utf8
}

function Test-NeedsDatabaseUrl([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return $true }
  if ($url -match "\[.+\]") { return $true }
  if ($url -match "USER:PASSWORD") { return $true }
  if ($url -match "PROJECT-REF|REGION|YOUR-PASSWORD") { return $true }
  if ($url -match "@HOST:5432") { return $true }
  if ($url -notmatch "^(postgresql|postgres)://") { return $true }
  return $false
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = $repoRoot
$envExample = Join-Path $backend ".env.example"
$envFile = Join-Path $backend ".env"

Write-Title "Rentel setup (database + migrations)"

if (-not (Test-Path $envExample)) {
  Write-Host "Missing file: $envExample" -ForegroundColor Red
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  Write-Host "Install Node.js LTS from https://nodejs.org/ and run this script again." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $envFile)) {
  Copy-Item $envExample $envFile
  Write-Host "Created .env from .env.example"
}

$dbUrl = Get-EnvValue $envFile "DATABASE_URL"
if (Test-NeedsDatabaseUrl $dbUrl) {
  Write-Title "Step 1 - Create a Supabase project (free tier is fine)"
  Write-Host "  I cannot log in for you. Do this once in your browser:"
  Write-Host ""
  Write-Host "  a) Go to https://supabase.com/dashboard"
  Write-Host "  b) Sign in -> New project -> pick org, name, database password, region -> Create."
  Write-Host "  c) Wait until status shows Ready (green)."
  Write-Host ""
  $open = Read-Host "Open the Supabase dashboard in your browser now? (Y/n)"
  if ($open -ne "n" -and $open -ne "N") {
    Start-Process "https://supabase.com/dashboard"
  }

  Write-Title "Step 2 - Session pooler connection string (IPv4-safe for Render)"
  Write-Host "  In Supabase: open your project -> **Connect** -> **Connection string** -> **Session pooler**."
  Write-Host "  Host should look like aws-0-<region>.pooler.supabase.com and port **5432** (not db.*.supabase.co only)."
  Write-Host ""
  $paste = Read-Host "Paste the full Session pooler URI here"
  $paste = $paste.Trim().Trim('"')
  if ([string]::IsNullOrWhiteSpace($paste)) {
    Write-Host "No URL entered. Set DATABASE_URL in .env and run this script again." -ForegroundColor Red
    exit 1
  }
  Set-EnvValue $envFile "DATABASE_URL" $paste
  Write-Host "Saved DATABASE_URL."
} else {
  Write-Host "DATABASE_URL in .env looks configured; skipping paste step."
}

$adminPw = Get-EnvValue $envFile "ADMIN_PASSWORD"
if ($adminPw -eq "change-me" -or [string]::IsNullOrWhiteSpace($adminPw)) {
  Write-Title "Step 3 - Admin password (optional)"
  $newPw = Read-Host "Type a password for the Rentel admin login (Enter to keep 'change-me' for local dev only)"
  if (-not [string]::IsNullOrWhiteSpace($newPw)) {
    Set-EnvValue $envFile "ADMIN_PASSWORD" $newPw
    Write-Host "Saved ADMIN_PASSWORD."
  }
}

Write-Title "Step 4 - Install packages and apply database schema"
Push-Location $backend
try {
  Write-Host "Running npm install..."
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

  Write-Host ""
  Write-Host "Running Prisma migrations against your database (creates all tables)..."
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "If this failed:" -ForegroundColor Yellow
    Write-Host "  - Confirm the password in DATABASE_URL matches Supabase (reset in Project Settings -> Database)."
    Write-Host "  - Use Session pooler from Connect (see .env.example); bare db.*.supabase.co can fail on IPv4-only networks."
    Write-Host "  - See: https://supabase.com/docs/guides/database/connecting-to-postgres"
    exit 1
  }

  Write-Host ""
  Write-Host "Setup finished successfully." -ForegroundColor Green
  Write-Host ""
  Write-Host "  Start the app: double-click Launch-Rentel-Dev.cmd"
  Write-Host "  Or:  npm run dev"
  Write-Host "  Then open http://localhost:4000"
  Write-Host ""
  Write-Host "  Give every teammate the same DATABASE_URL in their .env so data stays in sync."
  Write-Host ""
} finally {
  Pop-Location
}
