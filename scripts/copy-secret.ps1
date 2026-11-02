# Put a value from .env onto the clipboard so it can be pasted straight into a password
# manager, without it being read aloud, typed by hand, or shown on screen.
#
#   powershell -ExecutionPolicy Bypass -File scripts\copy-secret.ps1 STITCH_WEBHOOK_SECRET
#
# Prints only the length and last four characters — enough to confirm the right thing is
# on the clipboard, useless to anyone reading the terminal afterwards.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('STITCH_CLIENT_SECRET', 'STITCH_WEBHOOK_SECRET', 'STITCH_CLIENT_ID',
               'GOOGLE_MAPS_API_KEY', 'JWT_SECRET', 'BACKUP_PASSWORD', 'ADMIN_PASSWORD',
               'SMTP_PASS')]
  [string]$Name
)

$ErrorActionPreference = 'Stop'
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'

if (-not (Test-Path $envPath)) {
  Write-Host "No .env found at $envPath" -ForegroundColor Red
  exit 1
}

$line = Get-Content $envPath | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))=" } | Select-Object -First 1
if (-not $line) {
  Write-Host "$Name is not in .env." -ForegroundColor Red
  exit 1
}

$value = $line.Substring($line.IndexOf('=') + 1).Trim()
if ([string]::IsNullOrWhiteSpace($value)) {
  Write-Host "$Name is in .env but has no value yet." -ForegroundColor Yellow
  exit 1
}

Set-Clipboard -Value $value
$tail = $value.Substring([Math]::Max(0, $value.Length - 4))
Write-Host "$Name is on your clipboard - $($value.Length) characters, ending ...$tail" -ForegroundColor Green
Write-Host 'Press Ctrl+V in the password field. Nothing was displayed.'
