$ErrorActionPreference = "Stop"

Write-Host "== Build Android Debug APK ==" -ForegroundColor Cyan

$setupScript = Join-Path $PSScriptRoot "setup-android.ps1"
& $setupScript

Write-Host ""
Write-Host "Syncing web assets to Android..." -ForegroundColor Cyan
npm run cap:sync

Write-Host ""
Write-Host "Running Gradle assembleDebug..." -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot "..\android")
try {
  .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle build failed with exit code $LASTEXITCODE"
  }
} catch {
  $message = $_.Exception.Message
  if ($message -like "*services.gradle.org*") {
    Write-Host ""
    Write-Warning "Gradle tidak bisa akses services.gradle.org (DNS/network issue)."
    Write-Host "Coba ganti DNS ke 1.1.1.1 atau 8.8.8.8, lalu ulangi build." -ForegroundColor Yellow
  }
  throw
} finally {
  Pop-Location
}

$apkPath = Join-Path $PSScriptRoot "..\android\app\build\outputs\apk\debug\app-debug.apk"
$apkPath = [System.IO.Path]::GetFullPath($apkPath)
Write-Host ""
Write-Host "Sukses. APK debug:" -ForegroundColor Green
Write-Host $apkPath -ForegroundColor Green
