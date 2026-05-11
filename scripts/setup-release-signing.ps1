$ErrorActionPreference = "Stop"

Write-Host "== Setup Android Release Signing ==" -ForegroundColor Cyan

$setupScript = Join-Path $PSScriptRoot "setup-android.ps1"
& $setupScript

$androidDir = Join-Path $PSScriptRoot "..\android"
$androidDir = [System.IO.Path]::GetFullPath($androidDir)
$keystoreDir = Join-Path $androidDir "keystores"
$keystorePath = Join-Path $keystoreDir "health-ai-upload.jks"
$keystorePropsPath = Join-Path $androidDir "keystore.properties"
$credentialsPath = Join-Path $androidDir "keystore.credentials.txt"

New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null

function New-RandomSecret {
  param([int]$Length = 24)
  $chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  $buffer = New-Object char[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] $Length
  $rng.GetBytes($bytes)
  for ($i = 0; $i -lt $Length; $i++) {
    $buffer[$i] = $chars[$bytes[$i] % $chars.Length]
  }
  -join $buffer
}

if (-not (Test-Path $keystorePath)) {
  $storePassword = New-RandomSecret
  $keyPassword = $storePassword
  $keyAlias = "healthai-upload"

  $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
  if (-not (Test-Path $keytool)) {
    throw "keytool.exe tidak ditemukan di $keytool"
  }

  & $keytool -genkeypair `
    -v `
    -keystore $keystorePath `
    -alias $keyAlias `
    -keyalg RSA `
    -keysize 4096 `
    -validity 36500 `
    -storepass $storePassword `
    -keypass $keyPassword `
    -dname "CN=Health AI, OU=Mobile, O=HealthAI, L=Jakarta, ST=DKI Jakarta, C=ID"

  @(
    "storeFile=keystores/health-ai-upload.jks"
    "storePassword=$storePassword"
    "keyAlias=$keyAlias"
    "keyPassword=$keyPassword"
  ) | Set-Content -Path $keystorePropsPath -Encoding ASCII

  @(
    "IMPORTANT: Simpan file ini di tempat aman (jangan di-share)."
    "Jika hilang, update aplikasi ke Play Store akan bermasalah."
    ""
    "Keystore: $keystorePath"
    "Alias: $keyAlias"
    "Store Password: $storePassword"
    "Key Password: $keyPassword"
  ) | Set-Content -Path $credentialsPath -Encoding ASCII

  Write-Host "Keystore release berhasil dibuat." -ForegroundColor Green
} else {
  Write-Host "Keystore sudah ada, skip generate." -ForegroundColor Yellow

  if (Test-Path $keystorePropsPath) {
    $props = Get-Content $keystorePropsPath
    $storePassLine = $props | Where-Object { $_ -like "storePassword=*" } | Select-Object -First 1
    if ($storePassLine) {
      $storePass = $storePassLine.Split("=", 2)[1]
      $normalized = $props | ForEach-Object {
        if ($_ -like "keyPassword=*") { "keyPassword=$storePass" } else { $_ }
      }
      Set-Content -Path $keystorePropsPath -Value $normalized -Encoding ASCII
      Write-Host "Normalized keyPassword agar sama dengan storePassword (PKCS12)." -ForegroundColor Green
    }
  }
}

Write-Host ""
Write-Host "Signing siap dipakai. Lanjut build release:" -ForegroundColor Cyan
Write-Host "npm run android:release" -ForegroundColor Cyan
