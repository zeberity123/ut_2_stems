// Opens the Tauri build, prints what the page says, and takes a screenshot. For debugging the shell.
const {chromium} = require('playwright');
const {spawn, spawnSync} = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PORT = 9333;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const exe = process.env.UT_STEMS_TEST_APP || path.join(root, 'src-tauri', 'target', 'debug', 'ut-stems.exe');
  const app = spawn(exe, [], {cwd: root, stdio: 'ignore', env: {...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`}});
  let browser;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(300); }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    await sleep(1500);
    const pages = browser.contexts().flatMap(c => c.pages());
    console.log('pages:', pages.map(p => p.url()));
    const page = pages.find(p => p.url().startsWith('http://127.0.0.1')) || pages[0];
    const logs = [];
    page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
    await page.reload();
    await sleep(4000);
    console.log('status:', await page.locator('#status').textContent().catch(() => '(none)'));
    console.log('tauri global:', await page.evaluate(() => ({tauri: typeof window.__TAURI__, desktop: window.desktop ? Object.keys(window.desktop) : null, csp: document.querySelector('meta[http-equiv]')?.content})));
    console.log('invoke:', await page.evaluate(() => window.__TAURI__?.core.invoke('get_preferences').then(v => JSON.stringify(v)).catch(e => 'ERR ' + (e.message || e))));
    console.log(logs.join('\n'));
    await page.screenshot({path: path.join(root, 'diagnostics', 'tauri-diag.png')});
  } finally {
    if (browser) await browser.close().catch(() => {});
    app.kill();
    spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'ut_stems\\.server' } | % { Stop-Process -Id $_.ProcessId -Force }"]);
  }
})().catch(error => { console.error(error); process.exit(1); });
