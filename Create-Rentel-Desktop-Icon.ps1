$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launchDev = Join-Path $repoRoot "Launch-Rentel-Dev.cmd"

if (-not (Test-Path $launchDev)) {
  Write-Host "Launcher not found: $launchDev" -ForegroundColor Red
  exit 1
}

$desktopPath = [Environment]::GetFolderPath("Desktop")
$wshShell = New-Object -ComObject WScript.Shell

function New-RentelShortcut {
  param(
    [string]$Path,
    [string]$Target,
    [string]$Description,
    [int]$IconIndex = 220
  )
  $shortcut = $wshShell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.Description = $Description
  $shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,$IconIndex"
  $shortcut.Save()
}

New-RentelShortcut -Path (Join-Path $desktopPath "Rentel Dev.lnk") -Target $launchDev `
  -Description "Start Rentel with npm run dev (hot reload)"
Write-Host "Desktop shortcut created: $(Join-Path $desktopPath 'Rentel Dev.lnk')"
