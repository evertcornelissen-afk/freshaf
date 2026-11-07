# Build the signed Google Play App Bundle (.aab) on this PC.
#   powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1 -VersionCode 10
# Needs android\keystore.properties (scripts\make-upload-key.ps1 creates it). Every upload to
# Play needs a HIGHER -VersionCode than the last one. Output:
#   android\app\build\outputs\bundle\release\app-release.aab
param([Parameter(Mandatory = $true)][int]$VersionCode)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'android\keystore.properties'))) {
  Write-Host 'No android\keystore.properties - run scripts\make-upload-key.ps1 first.' -ForegroundColor Red; exit 1
}
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:BUILD_NUMBER = "$VersionCode"
Push-Location $root
try {
  npx cap sync android
  Push-Location android
  try { .\gradlew.bat bundleRelease --no-daemon } finally { Pop-Location }
} finally { Pop-Location }
$aab = Join-Path $root 'android\app\build\outputs\bundle\release\app-release.aab'
if (Test-Path $aab) { Write-Host "Signed bundle ready: $aab (versionCode $VersionCode)" -ForegroundColor Green } else { exit 1 }
