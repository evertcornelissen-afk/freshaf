# Put a secret into .env straight from the clipboard, without it ever being typed,
# echoed, or pasted into a chat window.
#
#   1. Copy the value (the dashboard's copy button, or select it and press Ctrl+C)
#   2. powershell -ExecutionPolicy Bypass -File scripts\set-secret.ps1 STITCH_CLIENT_SECRET
#
# The value is read from the clipboard, written to .env, and the clipboard is cleared.
# Nothing is ever printed except the length and the last four characters, which is
# enough to confirm you copied the right thing and useless to anyone reading over your
# shoulder or scrolling back through a terminal.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('STITCH_CLIENT_SECRET', 'STITCH_WEBHOOK_SECRET', 'STITCH_CLIENT_ID',
               'GOOGLE_MAPS_API_KEY', 'JWT_SECRET', 'BACKUP_PASSWORD', 'ADMIN_PASSWORD',
               'SMTP_PASS')]
  [string]$Name,
  [switch]$KeepClipboard
)

$ErrorActionPreference = 'Stop'
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'

if (-not (Test-Path $envPath)) {
  Write-Host "No .env found at $envPath" -ForegroundColor Red
  exit 1
}

$value = Get-Clipboard -Raw
if ($null -eq $value) { $value = '' }
$value = $value.Trim()

if ([string]::IsNullOrWhiteSpace($value)) {
  Write-Host 'The clipboard is empty. Copy the value first, then run this again.' -ForegroundColor Red
  exit 1
}
if ($value -match '\r|\n') {
  Write-Host 'The clipboard holds more than one line, which is not a secret.' -ForegroundColor Red
  Write-Host 'Copy just the value and try again.'
  exit 1
}
# A stray UI label or a whole sentence means the wrong thing got copied.
if ($value.Length -lt 8 -or $value -match '\s') {
  Write-Host "That does not look like a secret (length $($value.Length), contains spaces)." -ForegroundColor Red
  exit 1
}

$lines = Get-Content $envPath
$found = $false
$out = foreach ($line in $lines) {
  if ($line -match "^\s*$([regex]::Escape($Name))=") {
    $found = $true
    "$Name=$value"
  } else {
    $line
  }
}
if (-not $found) { $out = $out + "$Name=$value" }

# Write UTF-8 without a BOM: dotenv treats a BOM as part of the first key name.
[IO.File]::WriteAllLines($envPath, $out, (New-Object Text.UTF8Encoding $false))

$tail = $value.Substring([Math]::Max(0, $value.Length - 4))
Write-Host "$Name set in .env - $($value.Length) characters, ending ...$tail" -ForegroundColor Green

if (-not $KeepClipboard) {
  Set-Clipboard -Value ' '
  Write-Host 'Clipboard cleared.'
}

Write-Host ''
Write-Host 'Next: npm run stitch:check' -ForegroundColor Cyan
