$ErrorActionPreference = "Stop"

Write-Host "== Android Setup Check ==" -ForegroundColor Cyan

function Get-JavaMajorVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$JavaExe
  )

  try {
    $raw = cmd /c "`"$JavaExe`" -version 2>&1"
    $first = ($raw | Select-Object -First 1)
    if ($first -match '"(\d+)\.') {
      return [int]$matches[1]
    }
  } catch {
    return 0
  }

  return 0
}

# Resolve Java home and require Java 21+ for current Android toolchain.
$javaHome = $env:JAVA_HOME
$currentMajor = 0
if (-not [string]::IsNullOrWhiteSpace($javaHome) -and (Test-Path "$javaHome\bin\java.exe")) {
  $currentMajor = Get-JavaMajorVersion -JavaExe "$javaHome\bin\java.exe"
}

if ([string]::IsNullOrWhiteSpace($javaHome) -or $currentMajor -lt 21) {
  $jdkCandidates = @(
    "C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot",
    "C:\Program Files\Eclipse Adoptium\jdk-21",
    "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot",
    "C:\Program Files\Eclipse Adoptium\jdk-17.0.12.8-hotspot",
    "C:\Program Files\Java\jdk-21",
    "C:\Program Files\Java\jdk-17",
    "C:\Program Files\Android\Android Studio\jbr"
  )
  foreach ($candidate in $jdkCandidates) {
    if (Test-Path "$candidate\bin\java.exe") {
      $major = Get-JavaMajorVersion -JavaExe "$candidate\bin\java.exe"
      if ($major -ge 21) {
        $javaHome = $candidate
        $currentMajor = $major
        break
      }
    }
  }
}

if ([string]::IsNullOrWhiteSpace($javaHome) -or -not (Test-Path "$javaHome\bin\java.exe") -or $currentMajor -lt 21) {
  Write-Error "JDK 21 belum ditemukan. Install dulu JDK 21, lalu set JAVA_HOME."
}

$env:JAVA_HOME = $javaHome
$env:Path = "$javaHome\bin;$env:Path"
Write-Host "JAVA_HOME = $javaHome" -ForegroundColor Green
& "$javaHome\bin\java.exe" -version

# Resolve Android SDK path from env or common locations.
$sdkPath = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($sdkPath)) { $sdkPath = $env:ANDROID_SDK_ROOT }
if ([string]::IsNullOrWhiteSpace($sdkPath)) {
  $sdkCandidates = @(
    "$env:LOCALAPPDATA\Android\Sdk",
    "$env:USERPROFILE\AppData\Local\Android\Sdk",
    "C:\Android\Sdk"
  )
  foreach ($candidate in $sdkCandidates) {
    if (Test-Path $candidate) {
      $sdkPath = $candidate
      break
    }
  }
}

if ([string]::IsNullOrWhiteSpace($sdkPath) -or -not (Test-Path $sdkPath)) {
  Write-Warning "Android SDK belum ditemukan."
  Write-Host "Install Android Studio -> More Actions -> SDK Manager, lalu install:" -ForegroundColor Yellow
  Write-Host "- Android SDK Platform (API terbaru, minimal API 34)" -ForegroundColor Yellow
  Write-Host "- Android SDK Build-Tools" -ForegroundColor Yellow
  Write-Host "- Android SDK Command-line Tools" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Setelah SDK terpasang, jalankan script ini lagi." -ForegroundColor Yellow
  exit 1
}

$env:ANDROID_HOME = $sdkPath
$env:ANDROID_SDK_ROOT = $sdkPath
Write-Host "ANDROID_SDK_ROOT = $sdkPath" -ForegroundColor Green

$localPropsPath = Join-Path $PSScriptRoot "..\android\local.properties"
$localPropsPath = [System.IO.Path]::GetFullPath($localPropsPath)

$escapedSdk = $sdkPath.Replace("\", "\\")
$content = "sdk.dir=$escapedSdk`n"
Set-Content -Path $localPropsPath -Value $content -Encoding ASCII
Write-Host "Generated android/local.properties" -ForegroundColor Green

Write-Host ""
Write-Host "Setup selesai. Lanjut build debug APK dengan:" -ForegroundColor Cyan
Write-Host "npm run android:debug" -ForegroundColor Cyan
