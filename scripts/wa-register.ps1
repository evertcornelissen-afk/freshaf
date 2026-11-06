# One-time: register FreshAF's WhatsApp sending number with Meta's Cloud API.
#
# Without this, every send fails with "(#133010) Account not registered" and the number shows
# "Pending" in WhatsApp Manager > Phone numbers. Run it once per number (again only when the
# number changes, e.g. moving from Meta's test number to FreshAF's own SIM in stage B).
#
# How to run (in PowerShell, from the freshaf folder):
#   1. Copy the permanent access key (the same one in Render's WHATSAPP_TOKEN) to the clipboard.
#   2. powershell -ExecutionPolicy Bypass -File scripts\wa-register.ps1
#   3. When asked, type a 6-digit PIN you choose. It becomes this number's two-step
#      verification PIN: keep it in the password manager; Meta asks for it if the number is
#      ever re-registered.
# The key is read from the clipboard and never printed or saved.

param(
  [string]$PhoneNumberId = '1418857251313769',
  [string]$ApiVersion = 'v25.0'
)

$token = (Get-Clipboard -Raw)
if ($null -eq $token) { $token = '' }
$token = $token.Trim()
if ($token.Length -lt 50 -or $token -match '\s') {
  Write-Host 'The clipboard does not hold an access key. Copy WHATSAPP_TOKEN first, then run this again.' -ForegroundColor Red
  exit 1
}

$secure = Read-Host 'Choose a 6-digit PIN for this WhatsApp number' -AsSecureString
$pin = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($pin -notmatch '^\d{6}$') {
  Write-Host 'The PIN must be exactly 6 digits.' -ForegroundColor Red
  exit 1
}

$body = @{ messaging_product = 'whatsapp'; pin = $pin } | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Method Post `
    -Uri "https://graph.facebook.com/$ApiVersion/$PhoneNumberId/register" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType 'application/json' -Body $body
  if ($r.success) {
    Write-Host 'Registered. The number can now send WhatsApp messages.' -ForegroundColor Green
    Write-Host 'Check WhatsApp Manager > Phone numbers: the status should change from Pending to Connected.'
  } else {
    Write-Host "Meta answered: $($r | ConvertTo-Json -Compress)" -ForegroundColor Yellow
  }
} catch {
  $msg = $_.ErrorDetails.Message
  if (-not $msg) { $msg = $_.Exception.Message }
  Write-Host "Meta refused the request: $msg" -ForegroundColor Red
  exit 1
} finally {
  $pin = $null; $token = $null
}
