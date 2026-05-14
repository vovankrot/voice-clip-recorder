$ErrorActionPreference = "Stop"
$out = "voice-clip-recorder-v1.3.0-firefox.xpi"
if (Test-Path $out) { Remove-Item $out -Force }
Get-ChildItem -Filter "voice-clip-recorder-v*.xpi" | Where-Object { $_.Name -ne $out } | Remove-Item -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$files = @(
  "manifest.json",
  "background.js",
  "recorder/recorder.html",
  "recorder/recorder.css",
  "recorder/recorder.js"
)
if (Test-Path "icons") {
  Get-ChildItem -Path "icons" -File -Recurse | ForEach-Object {
    $rel = ($_.FullName.Substring((Resolve-Path ".").Path.Length + 1)) -replace '\\','/'
    $files += $rel
  }
}

$abs = Join-Path (Resolve-Path ".").Path $out
$stream = [System.IO.File]::Open($abs, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($rel in $files) {
    $disk = $rel -replace '/','\'
    if (-not (Test-Path $disk)) { Write-Warning "Missing: $disk"; continue }
    $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open()
    $fs = [System.IO.File]::OpenRead((Resolve-Path $disk).Path)
    $fs.CopyTo($es); $fs.Dispose(); $es.Dispose()
  }
} finally { $zip.Dispose(); $stream.Dispose() }

Write-Host ("Built: " + $out + " (" + (Get-Item $out).Length + " bytes)")
$z2 = [System.IO.Compression.ZipFile]::OpenRead($abs)
$z2.Entries | ForEach-Object { Write-Host ("  " + $_.FullName + " - " + $_.Length + " bytes") }
$z2.Dispose()
