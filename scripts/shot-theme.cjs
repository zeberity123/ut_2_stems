// Screenshots of one theme in the Tauri debug build: empty, working and mixer states.
//   node scripts/shot-theme.cjs miku      -> diagnostics/theme-miku-{empty,working,mixer}.png
const {chromium} = require('playwright');
const {spawn, spawnSync, execFileSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const diagnostics = path.join(root, 'diagnostics');
const theme = process.argv[2] || 'miku';
const PORT = 9333;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const clip = path.join(diagnostics, 'theme_clip.mp3');
  if (!fs.existsSync(clip)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=12', '-f', 'lavfi',
    '-i', 'anoisesrc=d=12:c=pink:a=0.2', '-filter_complex', 'amix=inputs=2', '-ac', '2', '-ar', '44100', '-b:a', '192k', clip]);
  const exe = process.env.UT_STEMS_TEST_APP || path.join(root, 'src-tauri', 'target', 'debug', 'ut-stems.exe');
  const app = spawn(exe, [], {cwd: root, stdio: 'ignore', env: {...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`}});
  let browser;
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(300); }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    await sleep(1500);
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://127.0.0.1'));
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('Paste a YouTube link'), null, {timeout: 60000});
    await page.evaluate(t => { document.documentElement.dataset.theme = t; document.querySelector('#theme').dataset.theme = t; }, theme);
    await page.locator('#output').fill(path.join(diagnostics, 'theme-output'));
    await page.locator('#output').dispatchEvent('change');
    await sleep(600);
    const shot = name => page.screenshot({path: path.join(diagnostics, `theme-${theme}-${name}.png`)});
    await shot('empty');
    await page.locator('#source').fill(clip);
    await page.locator('#add-source').click();
    await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 1);
    await page.locator('#model [data-value="htdemucs_6s"]').click();
    await page.locator('#separate').click();
    await page.waitForFunction(() => ['running', 'done', 'failed'].includes(document.querySelector('.song-item')?.dataset.status), null, {timeout: 120000});
    if (await page.evaluate(() => document.querySelector('.song-item')?.dataset.status) === 'running') { await sleep(600); await shot('working'); }
    await page.waitForFunction(() => ['done', 'failed'].includes(document.querySelector('.song-item')?.dataset.status), null, {timeout: 300000});
    const failure = await page.evaluate(() => document.querySelector('#pending-note')?.textContent);
    if (await page.evaluate(() => document.querySelector('.song-item')?.dataset.status) === 'failed') throw new Error(`separation failed: ${failure}`);
    await page.waitForFunction(() => !document.querySelector('#mixer').hidden);
    await page.locator('#play').click();
    await sleep(2500);
    await page.locator('.track .solo').first().click();
    await sleep(400);
    await shot('mixer');
    await page.locator('#play').click();
    console.log(`theme ${theme}: screenshots written`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`]); } catch {}
    await sleep(2000);
    if (app.exitCode === null && app.signalCode === null) app.kill();
  }
})();
