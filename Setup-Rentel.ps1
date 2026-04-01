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
  if ($url -match "USER:PASSWORD") { return $true }
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
$directUrl = Get-EnvValue $envFile "DIRECT_URL"
if ((Test-NeedsDatabaseUrl $dbUrl) -or (Test-NeedsDatabaseUrl $directUrl)) {
  Write-Title "Step 1 — Create a Supabase project (free tier is fine)"
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

  Write-Title "Step 2 — Copy two pooler URLs (Supavisor — works on IPv4 and Render)"
  Write-Host "  In Supabase open your project -> top bar **Connect** -> **Connection String**."
  Write-Host "  You need both pooler strings (host: aws-0-<region>.pooler.supabase.com), NOT the direct db.* host only."
  Write-Host ""
  Write-Host "  A) Session pooler — port **5432** -> paste below (saved as DIRECT_URL for migrations)."
  $session = Read-Host "Paste Session pooler URI"
  $session = $session.Trim().Trim('"')
  if ([string]::IsNullOrWhiteSpace($session)) {
    Write-Host "No URL entered. Set DIRECT_URL in .env and run this script again." -ForegroundColor Red
    exit 1
  }
  Set-EnvValue $envFile "DIRECT_URL" $session
  Write-Host "Saved DIRECT_URL."
  Write-Host ""
  Write-Host "  B) Transaction pooler — port **6543** -> paste below (saved as DATABASE_URL for the app)."
  $tx = Read-Host "Paste Transaction pooler URI"
  $tx = $tx.Trim().Trim('"')
  if ([string]::IsNullOrWhiteSpace($tx)) {
    Write-Host "No URL entered. Set DATABASE_URL in .env and run this script again." -ForegroundColor Red
    exit 1
  }
  if ($tx -match ":6543" -and $tx -notmatch "pgbouncer=true") {
    $sep = "?"; if ($tx -match "\?") { $sep = "&" }
    $tx = "$tx${sep}pgbouncer=true"
    Write-Host "Appended pgbouncer=true for Prisma + transaction pool."
  }
  Set-EnvValue $envFile "DATABASE_URL" $tx
  Write-Host "Saved DATABASE_URL."
} else {
  Write-Host "DATABASE_URL and DIRECT_URL in .env look configured; skipping paste step."
}

$adminPw = Get-EnvValue $envFile "ADMIN_PASSWORD"
if ($adminPw -eq "change-me" -or [string]::IsNullOrWhiteSpace($adminPw)) {
  Write-Title "Step 3 — Admin password (optional)"
  $newPw = Read-Host "Type a password for the Rentel admin login (Enter to keep 'change-me' for local dev only)"
  if (-not [string]::IsNullOrWhiteSpace($newPw)) {
    Set-EnvValue $envFile "ADMIN_PASSWORD" $newPw
    Write-Host "Saved ADMIN_PASSWORD."
  }
}

Write-Title "Step 4 — Install packages and apply database schema"
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
    Write-Host "  - Confirm passwords in DATABASE_URL and DIRECT_URL match Supabase (reset in Project Settings -> Database)."
    Write-Host "  - Use Supavisor pooler URLs from Connect (see .env.example); direct db.*:5432 alone can fail on IPv4-only networks."
    Write-Host "  - See: https://supabase.com/docs/guides/database/prisma"
    exit 1
  }

  Write-Host ""
  Write-Host "Setup finished successfully." -ForegroundColor Green
  Write-Host ""
  Write-Host "  Start the app: double-click Launch-Rentel-Dev.cmd"
  Write-Host "  Or:  npm run dev"
  Write-Host "  Then open http://localhost:4000"
  Write-Host ""
  Write-Host "  Give every teammate the same DATABASE_URL and DIRECT_URL in their .env so data stays in sync."
  Write-Host ""
} finally {
  Pop-Location
}
