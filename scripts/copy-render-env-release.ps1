# Puts the release settings for Render on the clipboard as ONE block, for Render ->
# Environment -> Add from .env (one paste). Only the settings that are filled in locally are
# included, so it can be run now (backup token) and again once the Google keys exist.
#
#   powershell -ExecutionPolicy Bypass -File scripts\copy-render-env-release.ps1
#
# Nothing secret is printed: key names, lengths and the last four characters only.
# Adding variables in Render restarts the service (about 1 minute of downtime), so do it
# together with the release, outside busy hours.

$ErrorActionPreference = 'Stop'
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
$store = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*#') { continue }
  $i = $line.IndexOf('=')
  if ($i -lt 1) { continue }
  $store[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
}

$wanted = @('BACKUP_TOKEN', 'GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_BROWSER_KEY')
$lines = @()
foreach ($k in $wanted) {
  $v = $store[$k]
  if ([string]::IsNullOrWhiteSpace($v)) { Write-Host "  $k = (not set yet, left out)" -ForegroundColor DarkGray; continue }
  $lines += "$k=$v"
  Write-Host ("  {0} = {1} characters, ending ...{2}" -f $k, $v.Length, $v.Substring([Math]::Max(0, $v.Length - 4)))
}
if ($lines.Count -eq 0) { Write-Host 'Nothing to copy.' -ForegroundColor Red; exit 1 }
Set-Clipboard -Value ($lines -join "`n")
Write-Host "`nOn the clipboard ($($lines.Count) setting(s)). Render -> freshaf -> Environment -> Add from .env -> paste -> Save." -ForegroundColor Green
