# Installs (or re-installs) the nightly FreshAF backup on this PC.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-nightly-backup.ps1
#
# Every night at 02:30 it pulls a verified copy of the live database (freshaf.io) into
# BACKUP_DIR (see .env). If the PC is off at 02:30 it runs as soon as the PC is back on.
# Result: LAST-BACKUP.txt in that folder, plus BACKUP-FAILED.txt whenever it did not work.
# Needs BACKUP_EMAIL, BACKUP_PASSWORD and ADMIN_API_KEY in .env to match the live site.
#
# Remove it again:  Unregister-ScheduledTask -TaskName "FreshAF nightly backup" -Confirm:$false

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source

$action = New-ScheduledTaskAction -Execute $node -Argument 'scripts\backup.js' -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At 2:30am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'FreshAF nightly backup' -Force `
  -Description 'Pulls a verified copy of the live FreshAF database into BACKUP_DIR. Status: LAST-BACKUP.txt / BACKUP-FAILED.txt there.' `
  -Action $action -Trigger $trigger -Settings $settings | Out-Null

$info = Get-ScheduledTask -TaskName 'FreshAF nightly backup' | Get-ScheduledTaskInfo
Write-Host "Installed. Next run: $($info.NextRunTime)" -ForegroundColor Green
Write-Host 'Running one backup now to prove it works...'
Push-Location $dir
try { & $node 'scripts\backup.js' } finally { Pop-Location }
