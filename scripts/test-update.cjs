// Auto-update test against the real release page: installs an older setup.exe, gives it an engine so
// it opens the app, waits for the update toast, presses Install, and checks that the installed copy
// is the newer version afterwards. Then uninstalls.
//
//   node scripts/test-update.cjs dist\UT-Stems-0.6.0-win64-setup.exe 0.6.1
const {chromium} = require('playwright');
const {spawn, spawnSync, execFileSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const [, , setupArg, expected] = process.argv;
const setup = path.resolve(root, setupArg || 'dist/UT-Stems-0.6.0-win64-setup.exe');
const install = path.join(process.env.LOCALAPPDATA, 'UT Stems');
const exe = path.join(install, 'ut-stems.exe');
const PORT = 9333;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fileVersion = file => execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${file}').VersionInfo.ProductVersion`], {encoding: 'utf8'}).trim();
const running = () => execFileSync('powershell', ['-NoProfile', '-Command', "@(Get-Process ut-stems -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*AppData\\Local\\UT Stems*' }).Count"], {encoding: 'utf8'}).trim();

(async () => {
  assert.ok(fs.existsSync(setup), `${setup} exists`);
  assert.ok(expected, 'expected version argument');
  if (fs.existsSync(install)) { spawnSync(path.join(install, 'uninstall.exe'), ['/S']); await sleep(5000); }
  console.log(`installing ${path.basename(setup)}`);
  assert.equal(spawnSync(setup, ['/S']).status, 0, 'silent install');
  await sleep(3000);
  console.log(`installed version: ${fileVersion(exe)}`);
  // an engine so the app opens its main page instead of the first-start page
  const engine = path.join(install, 'engine');
  const copied = spawnSync('robocopy', [path.join(root, 'dist', 'engine-cuda'), engine, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'], {stdio: 'ignore'});
  assert.ok(copied.status < 8, `robocopy status ${copied.status}`);  // below 8 means copied
  fs.writeFileSync(path.join(engine, 'engine.json'), JSON.stringify({version: '0.6.0', edition: 'cuda'}));

  const app = spawn(exe, [], {cwd: install, stdio: 'ignore', detached: true,
    env: {...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`}});
  app.unref();
  let browser;
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(300); }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    await sleep(1500);
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://127.0.0.1'));
    assert.ok(page, 'the app page (an engine is in place)');
    await page.waitForFunction(() => !document.querySelector('#update').hidden, null, {timeout: 60000});
    const text = await page.locator('#update-text').textContent();
    console.log(`toast: ${text}`);
    assert.ok(text.includes(expected), `the toast offers ${expected}`);
    assert.equal(await page.locator('#update-go').textContent(), 'Install', 'an installed copy offers Install');
    await page.screenshot({path: path.join(root, 'diagnostics', 'update-toast.png')});
    await page.locator('#update-go').click();
    await browser.close().catch(() => {});
    browser = null;
    // the installer runs, the old app exits, the new one starts
    const until = Date.now() + 180000;
    let version = fileVersion(exe);
    while (Date.now() < until && version !== expected) { await sleep(3000); try { version = fileVersion(exe); } catch {} }
    assert.equal(version, expected, `the installed exe is ${expected}`);
    await sleep(8000);
    console.log(`after update: version ${version}, running copies: ${running()}`);
    assert.ok(fs.existsSync(path.join(engine, 'ut-stems-engine.exe')), 'the engine survived the update');
    console.log('update test passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    spawnSync('taskkill', ['/f', '/im', 'ut-stems.exe', '/t'], {stdio: 'ignore'});
    await sleep(2000);
    spawnSync(path.join(install, 'uninstall.exe'), ['/S']);
    await sleep(5000);
    console.log(`uninstalled: ${!fs.existsSync(install)}`);
  }
})();
