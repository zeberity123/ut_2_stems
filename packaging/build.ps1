<#
.SYNOPSIS
  Builds the standalone Windows app: dist\UT-Stems-<version>-win64-<edition>\UT Stems\ and its archive.

.DESCRIPTION
  Stages (default: all = engine, tauri):
    engine    PyInstaller folder with ut-stems-engine.exe, ut-stems.exe, the libraries and ffmpeg
              also packs it: dist\UT-Stems-<version>-engine-<edition>.7z and its .sha256, which the app downloads
    tauri     the installer, the same for every edition: dist\UT-Stems-<version>-win64-setup.exe (Rust and Node.js;
              `npm install` first). The app downloads the engine archive from the GitHub release on first start.

  The edition comes from the PyTorch build installed in the Python that is used:
    packaging\build.ps1 -Edition cuda                                        (default Python, CUDA torch)
    packaging\build.ps1 -Edition xpu -Python C:\envs\xpu\Scripts\python.exe  (Intel GPU torch, from the whl/xpu index)
    packaging\build.ps1 -Edition cpu -Python C:\envs\cpu\Scripts\python.exe  (CPU torch)
  The engine is moved into the assembled folder, so run the engine stage again before assembling twice.
#>
param(
  [ValidateSet('cuda', 'xpu', 'cpu')] [string]$Edition = 'cuda',
  [string]$Python = 'python',
  [string[]]$Stage = @('all'),   # any of: all, engine, tauri (comma separated)
  [string]$SevenZip = "$env:ProgramFiles\7-Zip\7z.exe"
)
$ErrorActionPreference = 'Stop'
$Stage = @($Stage | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($s in $Stage) { if ($s -notin 'all', 'engine', 'tauri') { throw "Unknown stage: $s" } }
$root = (Resolve-Path "$PSScriptRoot\..").Path
$dist = Join-Path $root 'dist'
Set-Location $root
New-Item -ItemType Directory -Force $dist | Out-Null
$version = & $Python -c "import ut_stems; print(ut_stems.__version__)"
if (-not $version) { throw 'Could not read the version from ut_stems' }
$engineOut = Join-Path $dist "engine-$Edition"
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
  # yt-dlp needs a JavaScript runtime for YouTube: QuickJS-ng (MIT), a single 1.9 MB program, pinned by hash.
  $qjs = Join-Path $engineOut 'qjs.exe'
  $qjsUrl = 'https://github.com/quickjs-ng/quickjs/releases/download/v0.18.0/qjs-windows-x86_64.exe'
  $qjsHash = 'ff03398d74ea6e6bd3a8e58058f7003225abcac229d7d57775b7aaae812a49c7'
  Invoke-WebRequest -Uri $qjsUrl -OutFile $qjs -UseBasicParsing
  if ((Get-FileHash $qjs -Algorithm SHA256).Hash.ToLower() -ne $qjsHash) { throw "qjs.exe does not match the expected hash" }
  Run (Join-Path $engineOut 'ut-stems.exe') @('--version')
  $size = (Get-ChildItem $engineOut -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
  Write-Host ("   engine: {0:N0} MB" -f $size)
  # One archive per edition, under GitHub's 2 GB limit, which the app downloads on first start.
  # No filters (-mf=off) so that the app's own 7z reader can unpack it.
  if (-not (Test-Path $SevenZip)) { throw "7-Zip not found at $SevenZip (winget install 7zip.7zip)" }
  $archive = Join-Path $dist "UT-Stems-$version-engine-$Edition.7z"
  if (Test-Path $archive) { Remove-Item $archive -Force }
  Push-Location $engineOut
  try { Run $SevenZip @('a', '-t7z', '-mx=5', '-mmt=on', '-mf=off', '-ms=on', $archive, '*') } finally { Pop-Location }
  '{0}  {1}' -f (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower(), (Split-Path $archive -Leaf) |
    Set-Content "$archive.sha256" -Encoding ascii
  Write-Host ('   {0}: {1:N0} MB' -f (Split-Path $archive -Leaf), ((Get-Item $archive).Length / 1MB))
}

if (Want 'tauri') {
  Write-Host '== Installer with Tauri (the engine is downloaded by the app on first start)'
  $cargo = Join-Path $env:USERPROFILE '.cargo\bin'
  if (Test-Path $cargo) { $env:PATH = "$cargo;$env:PATH" }
  # The installer is signed with the updater key so installed copies can update themselves.
  $key = Join-Path $env:USERPROFILE '.tauri\ut-stems.key'
  if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    if (Test-Path $key) { $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $key -Raw).Trim(); $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '' }
    else { throw "The updater signing key is missing at $key; without it installed copies cannot update" }
  }
  Run 'npx.cmd' @('tauri', 'build', '--bundles', 'nsis')
  $nsis = Join-Path $root 'src-tauri\target\release\bundle\nsis'
  $signature = Get-ChildItem $nsis -Filter '*-setup.exe.sig' | Sort-Object LastWriteTime | Select-Object -Last 1
  if (-not $signature) { throw 'Tauri produced no signature; is createUpdaterArtifacts on?' }
  Copy-Item $signature.FullName (Join-Path $dist "UT-Stems-$version-win64-setup.exe.sig") -Force
  # latest.json is what installed copies poll: version, where the installer is, and its signature.
  @{ version = $version; notes = "UT Stems $version"; pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
     platforms = @{ 'windows-x86_64' = @{ signature = (Get-Content $signature.FullName -Raw).Trim()
       url = "https://github.com/zeberity123/ut_2_stems/releases/download/v$version/UT-Stems-$version-win64-setup.exe" } } } |
    ConvertTo-Json -Depth 5 | ForEach-Object { [IO.File]::WriteAllText((Join-Path $dist 'latest.json'), $_, [Text.UTF8Encoding]::new($false)) }  # no BOM
  $setup = Get-ChildItem (Join-Path $root 'src-tauri\target\release\bundle\nsis') -Filter '*-setup.exe' | Sort-Object LastWriteTime | Select-Object -Last 1
  if (-not $setup) { throw 'Tauri produced no installer' }
  $target = Join-Path $dist "UT-Stems-$version-win64-setup.exe"
  Move-Item $setup.FullName $target -Force
  '{0}  {1}' -f (Get-FileHash $target -Algorithm SHA256).Hash.ToLower(), (Split-Path $target -Leaf) |
    Set-Content (Join-Path $dist "UT-Stems-$version-win64-setup.sha256") -Encoding ascii
  Write-Host ('   {0}: {1:N1} MB' -f (Split-Path $target -Leaf), ((Get-Item $target).Length / 1MB))
  # The same program without the installer: run it from any folder you can write to.
  $portable = Join-Path $dist "UT-Stems-$version-win64-portable.exe"
  Copy-Item (Join-Path $root 'src-tauri\target\release\ut-stems.exe') $portable -Force
  '{0}  {1}' -f (Get-FileHash $portable -Algorithm SHA256).Hash.ToLower(), (Split-Path $portable -Leaf) |
    Set-Content (Join-Path $dist "UT-Stems-$version-win64-portable.sha256") -Encoding ascii
  Write-Host ('   {0}: {1:N1} MB' -f (Split-Path $portable -Leaf), ((Get-Item $portable).Length / 1MB))
}

Write-Host 'Done.'
