param([string]$SdkPath = $env:ANDROID_HOME)
$ErrorActionPreference = 'Stop'
$androidRoot = Split-Path $PSScriptRoot -Parent
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to JDK 17 or 21.' }
if (-not $SdkPath) { throw 'Set ANDROID_HOME or pass -SdkPath.' }
Push-Location $androidRoot
try {
    & node --test tests/downloads.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Download tests failed.' }
    & .\gradlew.bat testDebugUnitTest lintRelease assembleRelease --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android checks or build failed.' }
    $signer = Join-Path $SdkPath 'build-tools\36.0.0\apksigner.bat'
    $apk = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
    & $signer verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $outputFolder = Join-Path $androidRoot 'artifacts'
    New-Item -ItemType Directory -Force $outputFolder | Out-Null
    $output = Join-Path $outputFolder 'resumeflow-1.0.2-release.apk'
    Copy-Item -LiteralPath $apk -Destination $output -Force
    $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  resumeflow-1.0.2-release.apk" | Set-Content -Encoding ascii (Join-Path $outputFolder 'SHA256SUMS.txt')
    Write-Output "Release APK: $output"
    Write-Output "SHA-256: $hash"
} finally { Pop-Location }
