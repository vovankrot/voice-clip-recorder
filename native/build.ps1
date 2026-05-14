$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> [1/3] Publishing native host (vcr-host.exe)..." -ForegroundColor Cyan
dotnet publish "src/Host/VoiceClipRecorder.Host.csproj" -c Release -o "src/Host/bin/publish" --nologo

$hostExe = Join-Path $PSScriptRoot "src/Host/bin/publish/vcr-host.exe"
if (-not (Test-Path $hostExe)) { throw "vcr-host.exe not produced at $hostExe" }
$hostSize = [Math]::Round((Get-Item $hostExe).Length / 1MB, 1)
Write-Host "    vcr-host.exe -> $hostSize MB" -ForegroundColor Green

Write-Host "==> [2/3] Publishing installer (VoiceClipRecorderSetup.exe)..." -ForegroundColor Cyan
$dist = Join-Path $PSScriptRoot "dist"
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Path $dist | Out-Null

dotnet publish "src/Installer/VoiceClipRecorder.Installer.csproj" -c Release -o $dist --nologo

$setup = Join-Path $dist "VoiceClipRecorderSetup.exe"
if (-not (Test-Path $setup)) { throw "VoiceClipRecorderSetup.exe not produced at $setup" }

Write-Host "==> [3/3] Renaming with version tag..." -ForegroundColor Cyan
$versioned = Join-Path $dist "VoiceClipRecorderSetup-v1.0.0.exe"
Copy-Item $setup $versioned -Force
$size = [Math]::Round((Get-Item $versioned).Length / 1MB, 1)
Write-Host ""
Write-Host "    Output: $versioned  ($size MB)" -ForegroundColor Green
Write-Host ""

# Cleanup pdb/etc — keep only the two exes in dist.
Get-ChildItem $dist -File | Where-Object {
    $_.Name -notlike "VoiceClipRecorderSetup*.exe"
} | Remove-Item -Force -ErrorAction SilentlyContinue
