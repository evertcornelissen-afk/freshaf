# Put the whole Render environment block on the clipboard in one go, so the five Stitch
# settings can be pasted into Render's "Add from .env" box with a single Ctrl+V.
#
#   powershell -ExecutionPolicy Bypass -File scripts\copy-render-env.ps1
#
# Why this exists: pasting secrets one at a time means copying a value, then copying the
# next, and in between the operator usually copies a KEY NAME out of a chat window --
# which replaces the secret on the clipboard and silently pastes the wrong thing. One
# block, one paste, no window where the clipboard holds the wrong value.
#
# Nothing is printed except key names, lengths and the last four characters.

$ErrorActionPreference = 'Stop'
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'

if (-not (Test-Path $envPath)) {
  Write-Host "No .env found at $envPath" -ForegroundColor Red
  exit 1
}

# Read .env into a lookup. Values are taken verbatim after the first '='.
$store = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*#') { continue }
  $i = $line.IndexOf('=')
  if ($i -lt 1) { continue }
  $store[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
}

# Literals that are not secrets, so they are written here rather than read from .env --
# the local .env deliberately leaves PAYMENTS_LIVE empty so a stray local run cannot
# touch the real payment path.
$literals = [ordered]@{
  PAYMENT_PROVIDER = 'stitch'
  PAYMENTS_LIVE    = 'true'
}
# Secrets, pulled from .env. STITCH_SCOPE is left out on purpose: the server already
# defaults to client_paymentrequest, and an unnecessary variable is one more thing to
# get wrong later.
$secrets = @('STITCH_CLIENT_ID', 'STITCH_CLIENT_SECRET', 'STITCH_WEBHOOK_SECRET')

$lines = @()
$report = @()

foreach ($k in $literals.Keys) {
  $lines += "$k=$($literals[$k])"
  $report += "  $k = $($literals[$k])"
}

$missing = @()
foreach ($k in $secrets) {
  $v = $store[$k]
  if ([string]::IsNullOrWhiteSpace($v)) { $missing += $k; continue }
  $lines += "$k=$v"
  $tail = $v.Substring([Math]::Max(0, $v.Length - 4))
  $report += "  $k = $($v.Length) characters, ending ...$tail"
}

if ($missing.Count -gt 0) {
  Write-Host "Missing from .env: $($missing -join ', ')" -ForegroundColor Red
  Write-Host 'Nothing was copied. Fill those in first with scripts\set-secret.ps1.'
  exit 1
}

# Join with LF. Render's .env box splits on either, and a trailing newline is harmless.
Set-Clipboard -Value (($lines -join "`n") + "`n")

Write-Host "$($lines.Count) variables are on your clipboard:" -ForegroundColor Green
$report | ForEach-Object { Write-Host $_ }
Write-Host ''
Write-Host 'In Render: Environment -> Add from .env -> click in the box -> Ctrl+V -> Add.' -ForegroundColor Cyan
Write-Host 'Do not copy anything else before you paste, or the clipboard is replaced.' -ForegroundColor Yellow
