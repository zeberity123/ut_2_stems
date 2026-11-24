// Tauri shell test: starts the Tauri build of UT Stems, drives its WebView2 window through
// Playwright over the Chrome DevTools Protocol, separates a clip, renames it, and checks that
// the engine stops with the window. Screenshots go to diagnostics/tauri-*.png.
//
//   node scripts/test-tauri.cjs                       (src-tauri/target/debug/ut-stems.exe)
//   set UT_STEMS_TEST_APP=<path to UT Stems.exe>      (an installed or release build instead)
const {chromium} = require('playwright');
const {spawn, spawnSync, execFileSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const diagnostics = path.join(root, 'diagnostics');
const output = path.join(diagnostics, 'tauri-output');
const PORT = 9333;
const FILES_PORT = 9334;
const VERSION = require('../package.json').version;

function engines() {
  const list = execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ut_stems\\.server|ut-stems-engine' } | Select-Object -ExpandProperty ProcessId"],
    {encoding: 'utf8'});
  return list.split(/\s+/).filter(Boolean).map(Number);
}

async function waitFor(check, {timeout = 30000, every = 300, what = 'condition'} = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { const value = await check(); if (value) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, every));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

(async () => {
  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true});
  const clip = path.join(diagnostics, 'tauri_clip.mp3');
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=262:duration=15', '-f', 'lavfi',
    '-i', 'anoisesrc=d=15:c=pink:a=0.2', '-filter_complex', 'amix=inputs=2', '-ac', '2', '-ar', '44100', '-b:a', '192k', clip]);
  assert.equal(made.status, 0, String(made.stderr));
  const before = engines();

  const exe = process.env.UT_STEMS_TEST_APP || path.join(root, 'src-tauri', 'target', 'debug', 'ut-stems.exe');
  assert.ok(fs.existsSync(exe), `${exe} exists (cargo build in src-tauri first)`);
  // A release build with no engine folder next to it shows the setup page first. The engine
  // archive (dist/UT-Stems-<version>-engine-<edition>.7z from the engine stage) is served from
  // a local web server standing in for the GitHub release.
  const engineDir = path.join(path.dirname(exe), 'engine');
  const setup = !fs.existsSync(engineDir) && !/target[\\/]debug/.test(exe);
  const edition = process.env.UT_STEMS_TEST_EDITION || 'cuda';
  let files = null;
  if (setup) {
    const archive = path.join(root, 'dist', `UT-Stems-${VERSION}-engine-${edition}.7z`);
    assert.ok(fs.existsSync(archive) && fs.existsSync(archive + '.sha256'), `${archive} and its .sha256 exist (build.ps1 -Stage engine)`);
    files = spawn('python', ['-m', 'http.server', String(FILES_PORT), '--bind', '127.0.0.1'], {cwd: path.join(root, 'dist'), stdio: 'ignore'});
  }
  const app = spawn(exe, [], {cwd: root, stdio: 'ignore',
    env: {...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
      UT_STEMS_ENGINE_BASE: `http://127.0.0.1:${FILES_PORT}/`}});
  let browser;
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.ok), {timeout: 60000, what: 'the window'});
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const page = await waitFor(() => browser.contexts().flatMap(c => c.pages()).find(p => /^(http:\/\/127\.0\.0\.1|tauri:\/\/|http:\/\/tauri\.localhost)/.test(p.url())), {what: 'the page'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const screenshot = name => page.screenshot({path: path.join(diagnostics, `tauri-${name}.png`)});

    if (setup) {
      await page.waitForSelector('#dl-button', {timeout: 60000});
      await page.waitForFunction(() => document.querySelector('#graphics').textContent !== '…');
      const status = await page.evaluate(() => window.__TAURI__.core.invoke('engine_status'));
      console.log(`setup: graphics ${status.graphics.join(', ')} -> ${status.suggested}; installing ${edition}`);
      await page.locator(`#edition [data-value="${edition}"]`).click();
      await screenshot('setup');
      await page.locator('#dl-button').click();
      await page.waitForFunction(() => document.querySelector('#dl').dataset.state === 'run');
      await page.waitForFunction(() => /Unpacking/.test(document.querySelector('#dl-eta').textContent), null, {timeout: 900000});
      await screenshot('setup-unpacking');
      // The shell starts the engine and brings the window to it.
      await page.waitForURL(url => url.href.startsWith('http://127.0.0.1'), {timeout: 900000});
      assert.ok(fs.existsSync(path.join(engineDir, 'ut-stems-engine.exe')), 'The engine was installed next to the exe');
      assert.equal(JSON.parse(fs.readFileSync(path.join(engineDir, 'engine.json'), 'utf8')).edition, edition);
    }

    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('Paste a YouTube link'), null, {timeout: 60000});
    assert.ok(await page.evaluate(() => Boolean(window.desktop?.tauri)), 'The Tauri bridge is in place');
    assert.equal(await page.evaluate(() => window.desktop.pathForFile(new File([''], 'x.mp3'))), '');
    await screenshot('empty');

    // Preferences go through the shell and are checked there.
    await page.locator('#output').fill(output);
    await page.locator('#output').dispatchEvent('change');
    await page.waitForFunction(value => window.desktop.getPreferences().then(saved => saved.output === value), output);
    await page.evaluate(() => window.desktop.setPreferences({stems: 'nonsense', output: 'x'.repeat(2000), theme: 'purple'}));
    const saved = await page.evaluate(() => window.desktop.getPreferences());
    assert.deepEqual(saved.stems, [], 'A bad stem list is dropped');
    assert.equal(saved.output.length, 1000, 'A long path is cut');
    assert.equal(saved.theme, '', 'An unknown theme is dropped');
    await page.locator('#output').fill(output);
    await page.locator('#output').dispatchEvent('change');
    await page.locator('#stems-all').click();

    // A file by path, separated, then shown in the mixer.
    await page.locator('#source').fill(clip);
    await page.locator('#add-source').click();
    await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 1);
    await page.locator('#separate').click();
    await page.waitForFunction(() => !document.querySelector('#working').hidden, null, {timeout: 15000});
    await screenshot('working');
    await page.waitForFunction(() => document.querySelector('.song-item')?.dataset.status === 'done', null, {timeout: 600000});
    await page.waitForFunction(() => !document.querySelector('#mixer').hidden);
    for (const stem of ['vocals', 'bass', 'drums', 'guitars', 'piano', 'others']) {
      assert.ok(fs.statSync(path.join(output, `tauri_clip_${stem}.mp3`)).size > 10000, `${stem} was written`);
    }
    await page.locator('#play').click();
    await page.waitForFunction(() => Number(document.querySelector('#seek').value) > 1, null, {timeout: 20000});
    await page.locator('#play').click();
    await page.waitForTimeout(400);
    await screenshot('mixer');

    await page.locator('#song').click();
    await page.locator('#title-input').fill('tauri renamed');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#song').textContent === 'tauri renamed');
    assert.ok(fs.existsSync(path.join(output, 'tauri renamed_vocals.mp3')), 'The files were renamed');

    // Only our own origin may be navigated to.
    await page.evaluate(() => { location.href = 'https://example.com/'; }).catch(() => {});
    await page.waitForTimeout(800);
    assert.ok(page.url().startsWith('http://127.0.0.1'), 'Navigation away is blocked');

    assert.deepEqual(errors, [], 'No page errors');
    const during = engines().filter(pid => !before.includes(pid));
    assert.ok(during.length >= 1, 'The engine runs');
    await browser.close();
    browser = null;
    // Closing the window (as the user does with the X) ends the shell and, with it, the engine.
    execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`]);
    await waitFor(() => app.exitCode !== null || app.signalCode !== null, {what: 'the app to exit'});
    await waitFor(() => engines().filter(pid => during.includes(pid)).length === 0, {timeout: 15000, what: 'the engine to stop'});
    console.log('tauri test passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app.exitCode === null && app.signalCode === null) app.kill();
    if (files) files.kill();
    for (const pid of engines()) { if (!before.includes(pid)) spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {stdio: 'ignore'}); }
  }
})();
