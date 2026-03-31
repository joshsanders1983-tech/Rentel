$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = Join-Path $repoRoot "Launch-Rentel.cmd"

if (-not (Test-Path $launcherPath)) {
  Write-Host "Launcher not found: $launcherPath" -ForegroundColor Red
  exit 1
}

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Rentel.lnk"

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = "Launch Rentel app"
$shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,220"
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath"
