$ErrorActionPreference = "Stop"

Write-Host "== Build Android Release ==" -ForegroundColor Cyan

$setupScript = Join-Path $PSScriptRoot "setup-android.ps1"
& $setupScript

Write-Host ""
Write-Host "Syncing web assets to Android..." -ForegroundColor Cyan
npm run cap:sync

Write-Host ""
Write-Host "Running Gradle bundleRelease + assembleRelease..." -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot "..\android")
try {
  .\gradlew.bat bundleRelease assembleRelease
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle release build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$aabPath = Join-Path $PSScriptRoot "..\android\app\build\outputs\bundle\release\app-release.aab"
$apkPath = Join-Path $PSScriptRoot "..\android\app\build\outputs\apk\release\app-release.apk"
$aabPath = [System.IO.Path]::GetFullPath($aabPath)
$apkPath = [System.IO.Path]::GetFullPath($apkPath)

Write-Host ""
Write-Host "Sukses. Release artifacts:" -ForegroundColor Green
Write-Host "AAB: $aabPath" -ForegroundColor Green
Write-Host "APK (signed jika keystore.properties terdeteksi): $apkPath" -ForegroundColor Green
