@echo off
rem Run by Windows Task Scheduler ("FreshAF daily backup"). Pulls a verified copy of the
rem live database into BACKUP_DIR (see .env) and appends the result to backup-log.txt there.
cd /d "%~dp0.."
set NO_COLOR=1
set LOG=C:\Users\Evert\Desktop\FreshAF\backups\backup-log.txt
echo ==== %date% %time% >> "%LOG%"
"C:\Program Files\nodejs\node.exe" scripts\backup.js >> "%LOG%" 2>&1
