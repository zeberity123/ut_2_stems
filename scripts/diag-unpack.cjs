// Watches the engine install from a local archive: memory of the shell, pagefile and free disk, every 5 s.
const {chromium} = require('playwright');
const {spawn, spawnSync, execFileSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const PORT = 9333;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exe = process.env.UT_STEMS_TEST_APP || path.join(root, 'src-tauri', 'target', 'release', 'ut-stems.exe');
const archive = path.join(root, 'dist', `UT-Stems-${require('../package.json').version}-engine-cuda.7z`);
const engineDir = path.join(path.dirname(exe), 'engine');

function sample(pid) {
  return execFileSync('powershell', ['-NoProfile', '-Command',
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; $pf = Get-CimInstance Win32_PageFileUsage; $d = Get-PSDrive C; ` +
    `'{0} MB ws | pagefile {1}/{2} MB | free {3} MB' -f [int]($p.WorkingSet64/1MB), ($pf | Measure-Object CurrentUsage -Sum).Sum, ($pf | Measure-Object AllocatedBaseSize -Sum).Sum, [int]($d.Free/1MB)`],
    {encoding: 'utf8'}).trim();
}

(async () => {
  fs.rmSync(engineDir, {recursive: true, force: true});
  fs.rmSync(engineDir + '.new', {recursive: true, force: true});
  console.log('start:', sample(process.pid));
  const app = spawn(exe, [], {cwd: root, stdio: 'ignore', env: {...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`}});
  let browser;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(300); }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    await sleep(1500);
    const page = browser.contexts().flatMap(c => c.pages())[0];
    await page.waitForSelector('#dl-button', {timeout: 60000});
    const started = Date.now();
    const install = page.evaluate(file => window.__TAURI__.core.invoke('install_engine', {edition: 'cuda', file}).then(() => 'ok', e => 'ERR ' + (e.message || e)), archive);
    let done = false;
    install.then(result => { done = true; console.log(`install -> ${result} after ${Math.round((Date.now() - started) / 1000)} s`); });
    while (!done) {
      await sleep(5000);
      let staged = 0;
      try { staged = Number(execFileSync('powershell', ['-NoProfile', '-Command', `[int]((Get-ChildItem -Recurse -File '${engineDir}.new' -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1MB)`], {encoding: 'utf8'})); } catch {}
      console.log(`${Math.round((Date.now() - started) / 1000)}s: shell ${sample(app.pid)} | staged ${staged} MB`);
    }
    await sleep(3000);
    console.log('end:', sample(app.pid), '| engine.json:', fs.existsSync(path.join(engineDir, 'engine.json')));
    console.log(fs.readFileSync(path.join(process.env.APPDATA, 'dev.zeberity123.ut-stems', 'setup.log'), 'utf8').trim().split('\n').slice(-2).join('\n'));
  } finally {
    if (browser) await browser.close().catch(() => {});
    app.kill();
    spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'ut-stems-engine' } | % { Stop-Process -Id $_.ProcessId -Force }"]);
  }
})().catch(error => { console.error(error); process.exit(1); });
