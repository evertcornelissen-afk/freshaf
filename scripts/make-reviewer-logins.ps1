# Create (or reset) the two store reviewer accounts on the LIVE site and save their sign-in
# details to REVIEWER-LOGINS.md in the freshaf folder. Same server logic as the admin app's
# "Create reviewer accounts" button.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-reviewer-logins.ps1
#
# It asks for the admin password itself (typed hidden, never stored). The admin key is read
# from admin-app\.env. REVIEWER-LOGINS.md is git-ignored, readable only by this Windows user,
# and the passwords are never printed on screen. Running it again resets both passwords.
param(
  [string]$AdminEmail = 'admin@freshaf.io',
  [string]$CustomerEmail = 'review@freshaf.io',
  [string]$ProEmail = 'review-pro@freshaf.io',
  [string]$Site = 'https://freshaf.io',
  [string]$OutFile = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = if ($OutFile) { $OutFile } else { Join-Path $root 'REVIEWER-LOGINS.md' }

$envFile = Join-Path $root 'admin-app\.env'
$key = ''
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*ADMIN_API_KEY\s*=' } | Select-Object -First 1
  if ($line) { $key = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'") }
}
if (-not $key) { Write-Host 'No ADMIN_API_KEY in admin-app\.env - the live admin API will not answer.' -ForegroundColor Red; exit 1 }

if ($env:FRESHAF_TEST_ADMIN_PW -and $Site -match '^http://(localhost|127\.0\.0\.1)(:|/|$)') {
  $plain = $env:FRESHAF_TEST_ADMIN_PW   # local testing only; never used against the live site
} else {
  $sec = Read-Host "Admin password for $AdminEmail" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$json = 'application/json'
try {
  $login = Invoke-RestMethod -Method Post -Uri "$Site/api/auth/login" -ContentType $json `
    -Headers @{ 'X-FreshAF-Client' = 'native' } `
    -Body (@{ email = $AdminEmail; password = $plain } | ConvertTo-Json)
} catch { Write-Host "Admin sign-in failed: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
finally { $plain = $null }
if (-not $login.token) { Write-Host 'Admin sign-in gave no token.' -ForegroundColor Red; exit 1 }
$h = @{ Authorization = "Bearer $($login.token)"; 'x-admin-key' = $key }

try {
  $r = Invoke-RestMethod -Method Post -Uri "$Site/api/admin/reviewer-accounts" -ContentType $json -Headers $h `
    -Body (@{ customer_email = $CustomerEmail; pro_email = $ProEmail } | ConvertTo-Json)
} catch {
  $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
  Write-Host "Could not create the reviewer accounts: $msg" -ForegroundColor Red; exit 1
}

$stamp = Get-Date -Format 'd MMM yyyy HH:mm'
$text = @"
# FreshAF store reviewer accounts (DEMO) - PRIVATE, never commit or paste in chat

Created/reset $stamp by scripts\make-reviewer-logins.ps1. Running the script again resets both
passwords (the ones below then stop working). Use these ONLY in Google Play Console > App
content > App access, and App Store Connect > App Review Information > Sign-in Information.

| Account | Email | Password |
|---|---|---|
| Customer (demo) | $($r.customer.email) | $($r.customer.password) |
| Pro (demo, online in Durbanville) | $($r.pro.email) | $($r.pro.password) |
"@
Set-Content -Path $out -Value $text -Encoding UTF8
# Readable by this Windows user only.
icacls $out /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
$r = $null

$s = Invoke-RestMethod -Method Get -Uri "$Site/api/admin/reviewer-accounts" -Headers $h
Write-Host ''
Write-Host "Saved to $out (passwords not shown here)." -ForegroundColor Green
Write-Host ("Customer: {0}  demo={1}" -f $s.customer.email, $s.customer.is_demo)
Write-Host ("Pro:      {0}  demo={1}  status={2}  online={3}  radius={4} km  services={5}" -f `
  $s.pro.email, $s.pro.is_demo, $s.pro.status, $s.pro.online, $s.pro.radius_km, $s.pro.services)
if ($s.pro.status -eq 'approved' -and $s.pro.online) { Write-Host 'Reviewer Pro: APPROVED and ONLINE.' -ForegroundColor Green }
else { Write-Host 'Reviewer Pro is NOT approved+online - run the script again.' -ForegroundColor Red }
