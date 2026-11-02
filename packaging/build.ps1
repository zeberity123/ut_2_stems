<#
.SYNOPSIS
  Builds the standalone Windows app: dist\UT-Stems-<version>-win64-<edition>\UT Stems\ and its archive.

.DESCRIPTION
  Stages (default: all):
    engine    PyInstaller folder with ut-stems-engine.exe, ut-stems.exe, the libraries and ffmpeg
    electron  the desktop window (needs Node.js; downloads @electron/packager with npx)
    assemble  puts the engine into the window's resources folder and adds ut-stems.cmd
    archive   7-Zip: one .zip for the cpu edition, 1.9 GB .7z volumes for the cuda and xpu editions
    client    UT Stems Client only (no engine, any PC): dist\UT-Stems-Client-<version>-win64.zip.
              Not part of 'all':  packaging\build.ps1 -Stage client

  The edition comes from the PyTorch build installed in the Python that is used:
    packaging\build.ps1 -Edition cuda                                        (default Python, CUDA torch)
    packaging\build.ps1 -Edition xpu -Python C:\envs\xpu\Scripts\python.exe  (Intel GPU torch, from the whl/xpu index)
    packaging\build.ps1 -Edition cpu -Python C:\envs\cpu\Scripts\python.exe  (CPU torch)
  The engine is moved into the assembled folder, so run the engine stage again before assembling twice.
#>
param(
  [ValidateSet('cuda', 'xpu', 'cpu')] [string]$Edition = 'cuda',
  [string]$Python = 'python',
  [string[]]$Stage = @('all'),   # any of: all, engine, electron, assemble, archive, client (comma separated)
  [string]$SevenZip = "$env:ProgramFiles\7-Zip\7z.exe"
)
$ErrorActionPreference = 'Stop'
$Stage = @($Stage | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($s in $Stage) { if ($s -notin 'all', 'engine', 'electron', 'assemble', 'archive', 'client') { throw "Unknown stage: $s" } }
$root = (Resolve-Path "$PSScriptRoot\..").Path
$dist = Join-Path $root 'dist'
Set-Location $root
New-Item -ItemType Directory -Force $dist | Out-Null
$version = & $Python -c "import ut_stems; print(ut_stems.__version__)"
if (-not $version) { throw 'Could not read the version from ut_stems' }
$name = "UT-Stems-$version-win64-$Edition"
$engineOut = Join-Path $dist "engine-$Edition"
$electronOut = Join-Path $dist 'electron'
$releaseDir = Join-Path $dist $name
$appDir = Join-Path $releaseDir 'UT Stems'
function Want($s) { return ($Stage -contains 'all') -or ($Stage -contains $s) }
function Run { param([string]$exe, [string[]]$arguments) & $exe @arguments; if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" } }

if (Want 'engine') {
  Write-Host "== Engine ($Edition) with $Python"
  $torch = & $Python -c "import torch; print(torch.__version__, 'cuda' if torch.version.cuda else ('xpu' if getattr(torch.version, 'xpu', None) else 'cpu'))"
  Write-Host "   torch $torch"
  if ($torch -notmatch "\b$Edition$") { throw "The $Edition edition needs the $Edition build of PyTorch, but this Python has: $torch" }
  foreach ($d in $engineOut, (Join-Path $dist "pyi-$Edition"), (Join-Path $dist "work-$Edition")) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } }
  Run $Python @('-m', 'PyInstaller', '--noconfirm', '--clean', '--distpath', (Join-Path $dist "pyi-$Edition"),
    '--workpath', (Join-Path $dist "work-$Edition"), (Join-Path $root 'packaging\ut_stems.spec'))
  Move-Item (Join-Path $dist "pyi-$Edition\engine") $engineOut
  Remove-Item (Join-Path $dist "work-$Edition") -Recurse -Force
  Remove-Item (Join-Path $dist "pyi-$Edition") -Recurse -Force
  # ffmpeg ships next to the engine: UT_STEMS_FFMPEG, or the one on PATH.
  $ffmpeg = if ($env:UT_STEMS_FFMPEG) { $env:UT_STEMS_FFMPEG } else { (Get-Command ffmpeg).Source }
  Copy-Item $ffmpeg (Join-Path $engineOut 'ffmpeg.exe')
  $license = Get-ChildItem (Split-Path (Split-Path $ffmpeg)) -Filter 'LICENSE*' -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($license) { Copy-Item $license.FullName (Join-Path $engineOut 'ffmpeg-LICENSE.txt') }
  Run (Join-Path $engineOut 'ut-stems.exe') @('--version')
  $size = (Get-ChildItem $engineOut -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
  Write-Host ("   engine: {0:N0} MB" -f $size)
}

if (Want 'electron') {
  Write-Host '== Desktop window'
  $staging = Join-Path $dist 'stage'
  if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
  New-Item -ItemType Directory $staging | Out-Null
  Copy-Item (Join-Path $root 'package.json') $staging
  Copy-Item (Join-Path $root 'desktop') (Join-Path $staging 'desktop') -Recurse
  if (Test-Path $electronOut) { Remove-Item $electronOut -Recurse -Force }
  if (-not (Test-Path (Join-Path $root 'packaging\icon.ico'))) {
    Run (Join-Path $root 'node_modules\electron\dist\electron.exe') @((Join-Path $root 'packaging\make-icon.cjs'))
  }
  $electron = (Get-Content (Join-Path $root 'node_modules\electron\package.json') | ConvertFrom-Json).version
  Run 'npx.cmd' @('--yes', '@electron/packager@18', $staging, 'UT Stems', '--platform=win32', '--arch=x64',
    "--out=$electronOut", '--overwrite', '--asar', '--no-prune', "--electron-version=$electron",
    "--icon=$(Join-Path $root 'packaging\icon.ico')", "--app-version=$version",
    '--win32metadata.CompanyName=zeberity123', '--win32metadata.ProductName=UT Stems',
    '--win32metadata.FileDescription=UT Stems')
}

if ($Stage -contains 'client') {
  # The client needs no Python: the server PC does the separating and serves the interface.
  $clientName = "UT-Stems-Client-$version-win64"
  Write-Host "== $clientName"
  $staging = Join-Path $dist 'stage-client'
  $clientOut = Join-Path $dist 'electron-client'
  foreach ($d in $staging, $clientOut, (Join-Path $dist $clientName)) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } }
  New-Item -ItemType Directory (Join-Path $staging 'desktop') -Force | Out-Null
  foreach ($f in 'client.cjs', 'client-preload.cjs', 'setup.html', 'setup.js') { Copy-Item (Join-Path $root "desktop\$f") (Join-Path $staging 'desktop') }
  $package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $package.name = 'ut-stems-client'; $package.productName = 'UT Stems Client'; $package.main = 'desktop/client.cjs'
  $package.PSObject.Properties.Remove('devDependencies'); $package.PSObject.Properties.Remove('scripts')
  [IO.File]::WriteAllText((Join-Path $staging 'package.json'), ($package | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  if (-not (Test-Path (Join-Path $root 'packaging\icon.ico'))) {
    Run (Join-Path $root 'node_modules\electron\dist\electron.exe') @((Join-Path $root 'packaging\make-icon.cjs'))
  }
  $electron = (Get-Content (Join-Path $root 'node_modules\electron\package.json') | ConvertFrom-Json).version
  Run 'npx.cmd' @('--yes', '@electron/packager@18', $staging, 'UT Stems Client', '--platform=win32', '--arch=x64',
    "--out=$clientOut", '--overwrite', '--asar', '--no-prune', "--electron-version=$electron",
    "--icon=$(Join-Path $root 'packaging\icon.ico')", "--app-version=$version",
    '--win32metadata.CompanyName=zeberity123', '--win32metadata.ProductName=UT Stems Client',
    '--win32metadata.FileDescription=UT Stems Client')
  $clientRelease = Join-Path $dist $clientName
  New-Item -ItemType Directory $clientRelease | Out-Null
  Copy-Item (Join-Path $clientOut 'UT Stems Client-win32-x64') (Join-Path $clientRelease 'UT Stems Client') -Recurse
  Copy-Item (Join-Path $root 'packaging\README-client.txt') (Join-Path $clientRelease 'UT Stems Client\README.txt')
  Remove-Item $staging, $clientOut -Recurse -Force
  if (Test-Path $SevenZip) {
    $zip = Join-Path $dist "$clientName.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Push-Location $clientRelease
    try { Run $SevenZip @('a', '-tzip', '-mx=5', '-mmt=on', $zip, 'UT Stems Client') } finally { Pop-Location }
    '{0}  {1}' -f (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower(), (Split-Path $zip -Leaf) |
      Set-Content (Join-Path $dist "$clientName.sha256") -Encoding ascii
    Write-Host ('   {0}: {1:N0} MB' -f (Split-Path $zip -Leaf), ((Get-Item $zip).Length / 1MB))
  }
  if ($Stage.Count -eq 1) { Write-Host 'Done.'; exit 0 }
}

if (Want 'assemble') {
  Write-Host "== Assemble $name"
  if (-not (Test-Path $engineOut)) { throw "No engine at $engineOut; run the engine stage first" }
  if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
  New-Item -ItemType Directory $releaseDir | Out-Null
  Copy-Item (Join-Path $electronOut 'UT Stems-win32-x64') $appDir -Recurse
  Move-Item $engineOut (Join-Path $appDir 'resources\engine')
  Copy-Item (Join-Path $root 'packaging\ut-stems.cmd') $appDir
  Copy-Item (Join-Path $root 'packaging\README-first.txt') (Join-Path $appDir 'README.txt')
  $size = (Get-ChildItem $appDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
  Write-Host ("   {0}: {1:N0} MB" -f $appDir, $size)
}

if (Want 'archive') {
  Write-Host "== Archive $name"
  if (-not (Test-Path $SevenZip)) { throw "7-Zip not found at $SevenZip (winget install 7zip.7zip)" }
  Get-ChildItem $dist -Filter "$name.*" -File | Remove-Item -Force
  Push-Location $releaseDir
  try {
    if ($Edition -ne 'cpu') {
      # GitHub accepts release files up to 2 GB, so the GPU editions come as 7z volumes.
      Run $SevenZip @('a', '-t7z', '-mx=5', '-mmt=on', '-v1900m', (Join-Path $dist "$name.7z"), 'UT Stems')
    } else {
      Run $SevenZip @('a', '-tzip', '-mx=5', '-mmt=on', (Join-Path $dist "$name.zip"), 'UT Stems')
    }
  } finally { Pop-Location }
  $files = Get-ChildItem $dist -Filter "$name.*" -File | Where-Object { $_.Extension -ne '.sha256' }
  $files | ForEach-Object { '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name } |
    Set-Content (Join-Path $dist "$name.sha256") -Encoding ascii
  $files | ForEach-Object { '   {0,-45} {1,8:N0} MB' -f $_.Name, ($_.Length / 1MB) } | Write-Host
}
Write-Host 'Done.'
