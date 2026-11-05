# Installs the "FreshAF daily backup" task in Windows Task Scheduler. Run it once:
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1
#
# Every day at 13:00 it downloads a verified copy of the live database into
# Desktop\FreshAF\backups (BACKUP_DIR in .env) and keeps the newest 30. If the PC is off or
# asleep at 13:00, it runs as soon as it is back. Results go to backup-log.txt in the same
# folder. Runs as you, only while you are signed in, with no administrator rights.
#
# Remove it again with:  Unregister-ScheduledTask -TaskName 'FreshAF daily backup'

$ErrorActionPreference = 'Stop'
$cmd = Join-Path $PSScriptRoot 'backup-scheduled.cmd'
if (-not (Test-Path $cmd)) { throw "Missing $cmd" }

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + $cmd + '"')
$trigger = New-ScheduledTaskTrigger -Daily -At '13:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'FreshAF daily backup' `
  -Description 'Downloads a verified copy of the live FreshAF database to Desktop\FreshAF\backups. Keeps the newest 30.' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$next = (Get-ScheduledTaskInfo -TaskName 'FreshAF daily backup').NextRunTime
Write-Host "Installed. Next backup: $next" -ForegroundColor Green
Write-Host 'Running one now to prove it works...'
Start-ScheduledTask -TaskName 'FreshAF daily backup'
Start-Sleep -Seconds 20
$log = 'C:\Users\Evert\Desktop\FreshAF\backups\backup-log.txt'
if (Test-Path $log) { Get-Content $log -Tail 6 }
