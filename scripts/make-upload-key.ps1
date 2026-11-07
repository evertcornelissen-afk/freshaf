# One-time: create FreshAF's Google Play UPLOAD key (the key that signs every app bundle you
# upload). Google then re-signs the app with its own app-signing key (Play App Signing), so if
# this upload key is ever lost, Google can reset it - but keep it safe anyway.
#
# Run it yourself (it asks for a password; nobody else should know it):
#   powershell -ExecutionPolicy Bypass -File scripts\make-upload-key.ps1
#
# What it does:
#   1. Creates C:\Users\<you>\FreshAF-keys\freshaf-upload.jks  (outside the code folder)
#   2. Writes android\keystore.properties pointing at it (git ignores this file)
#   3. Prints the key's SHA-1 / SHA-256 fingerprints (not secret)
# Then back up BOTH the .jks file and the password in your password manager.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$keytool = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
if (-not (Test-Path $keytool)) { Write-Host "keytool not found at $keytool (Android Studio's JBR)." -ForegroundColor Red; exit 1 }

$dir = Join-Path $env:USERPROFILE 'FreshAF-keys'
$jks = Join-Path $dir 'freshaf-upload.jks'
if (Test-Path $jks) { Write-Host "An upload key already exists at $jks. Not overwriting it." -ForegroundColor Yellow; exit 1 }
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$p1 = Read-Host 'Choose a password for the upload key (at least 8 characters)' -AsSecureString
$p2 = Read-Host 'Type it again' -AsSecureString
$b = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
$pw = & $b $p1
if ($pw -ne (& $b $p2)) { Write-Host 'The two passwords do not match.' -ForegroundColor Red; exit 1 }
if ($pw.Length -lt 8) { Write-Host 'Use at least 8 characters.' -ForegroundColor Red; exit 1 }

& $keytool -genkeypair -v -storetype PKCS12 -keystore $jks -alias freshaf-upload -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass $pw -keypass $pw -dname 'CN=FreshAF (Pty) Ltd, O=FreshAF (Pty) Ltd, L=Cape Town, C=ZA' | Out-Null

$props = Join-Path $root 'android\keystore.properties'
@(
  "storeFile=$($jks -replace '\\','/')",
  "storePassword=$pw",
  'keyAlias=freshaf-upload',
  "keyPassword=$pw"
) | Set-Content -Path $props -Encoding ascii
$pw = $null

Write-Host "Upload key created: $jks" -ForegroundColor Green
Write-Host 'android\keystore.properties written (git ignores it).' -ForegroundColor Green
& $keytool -list -v -keystore $jks -alias freshaf-upload -storepass (Get-Content $props | Where-Object { $_ -like 'storePassword=*' }).Split('=',2)[1] |
  Select-String 'SHA1:|SHA256:'
Write-Host ''
Write-Host 'NOW: copy the .jks file and the password into your password manager (two places).' -ForegroundColor Yellow
