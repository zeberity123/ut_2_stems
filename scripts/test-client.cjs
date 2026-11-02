// Client/server test: starts UT Stems Server on this PC (approving every PC, bound to 127.0.0.1
// only), then drives UT Stems Client through registering, sending a file, separating it,
// saving the stems on "this" PC, renaming them, reconnecting and being removed.
//
//   node scripts/test-client.cjs          screenshots go to diagnostics/client-*.png
const {_electron: electron} = require('playwright');
const {spawn, spawnSync} = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const diagnostics = path.join(root, 'diagnostics');
const serverData = path.join(diagnostics, 'server-data');
const profile = path.join(diagnostics, 'client-profile');
const output = path.join(diagnostics, 'client-output');

function startServer() {
  const server = spawn(process.env.UT_STEMS_PYTHON || 'python',
    ['-m', 'ut_stems.remote', '--port', '0', '--data', serverData, '--test-approve-all'],
    {cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, PYTHONIOENCODING: 'utf-8'}});
  let errors = '';
  server.stderr.on('data', chunk => { errors += chunk; });
  const ready = new Promise((resolve, reject) => {
    const lines = readline.createInterface({input: server.stdout});
    lines.on('line', line => { try { const info = JSON.parse(line); if (info.port) resolve(info); } catch {} });
    server.once('exit', code => reject(new Error(`server exited (${code}): ${errors}`)));
    setTimeout(() => reject(new Error('the server did not start')), 30000);
  });
  return {server, ready};
}

async function launch(port) {
  const app = await electron.launch({args: [path.join(root, 'desktop', 'client.cjs'), `--user-data-dir=${profile}`], cwd: root,
    env: {...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', UT_STEMS_CLIENT_SERVER: `127.0.0.1:${port}`}});
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return {app, page, errors};
}

(async () => {
  for (const folder of [serverData, profile, output]) fs.rmSync(folder, {recursive: true, force: true});
  const clip = path.join(diagnostics, 'client_clip.mp3');
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=15', '-f', 'lavfi',
    '-i', 'anoisesrc=d=15:c=pink:a=0.2', '-filter_complex', 'amix=inputs=2', '-ac', '2', '-ar', '44100', '-b:a', '192k', clip]);
  assert.equal(made.status, 0, String(made.stderr));

  const {server, ready} = startServer();
  const {port} = await ready;
  let session = await launch(port);
  let {app, page} = session;
  const shot = name => page.screenshot({path: path.join(diagnostics, `client-${name}.png`)});
  try {
    // First start: the setup page, with the address filled in.
    await page.waitForSelector('#address');
    await page.waitForFunction(() => document.querySelector('#address').value.includes('127.0.0.1'));
    await page.waitForFunction(() => !/Searching/.test(document.querySelector('#servers').textContent));
    await shot('setup');
    await page.locator('#connect').click();

    // The server approves; the server's interface opens in the same window.
    await page.waitForURL(url => url.href.startsWith(`https://127.0.0.1:${port}/`), {timeout: 30000});
    await page.waitForFunction(() => document.querySelector('#server-chip') && !document.querySelector('#server-chip').hidden);
    assert.match(await page.locator('#server-chip').textContent(), /^on /);
    const config = JSON.parse(fs.readFileSync(path.join(profile, 'client.json'), 'utf8'));
    assert.match(config.server.fingerprint, /^[0-9a-f]{64}$/, 'The certificate is pinned');
    assert.ok(config.server.token, 'The key is stored (encrypted)');

    // A file path typed into the box is sent to the server.
    await page.locator('#output').fill(output);
    await page.locator('#output').dispatchEvent('change');
    await page.locator('#source').fill(clip);
    await page.locator('#add-source').click();
    await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 1, null, {timeout: 30000});
    assert.equal(await page.locator('.song-title').first().textContent(), 'client_clip');
    for (const chip of await page.locator('#stem-chips .chip').all()) {
      const wanted = ['vocals', 'others'].includes(await chip.getAttribute('data-stem'));
      if ((await chip.getAttribute('aria-pressed') === 'true') !== wanted) await chip.click();
    }
    await page.locator('#separate').click();
    await page.waitForFunction(() => document.querySelector('.song-item')?.dataset.status === 'done', null, {timeout: 600000});
    await page.waitForFunction(() => !/saving/.test(document.querySelector('.song-item small').textContent), null, {timeout: 60000});
    await page.waitForFunction(() => !document.querySelector('#mixer').hidden);
    await page.waitForFunction(() => /saved in/.test(document.querySelector('#meta').textContent));
    await shot('done');
    for (const stem of ['vocals', 'others']) {
      assert.ok(fs.statSync(path.join(output, `client_clip_${stem}.mp3`)).size > 10000, `${stem} saved on this PC`);
    }
    assert.ok(fs.existsSync(clip), 'The file that was sent stays where it was');

    // Playing streams from the server.
    await page.locator('#play').click();
    await page.waitForFunction(() => Number(document.querySelector('#seek').value) > 1, null, {timeout: 20000});
    await page.locator('#play').click();

    // Renaming renames the files on both PCs.
    await page.locator('.song-main').first().dblclick();
    await page.locator('.song-rename-input').fill('client renamed');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#song').textContent === 'client renamed');
    for (const stem of ['vocals', 'others']) {
      assert.ok(fs.existsSync(path.join(output, `client renamed_${stem}.mp3`)), `${stem} renamed on this PC`);
      assert.ok(!fs.existsSync(path.join(output, `client_clip_${stem}.mp3`)));
    }
    assert.deepEqual(session.errors, [], 'No page errors');
    await app.close();

    // Second start: straight into the server's interface, no setup.
    session = await launch(port);
    ({app, page} = session);
    await page.waitForURL(url => url.href.startsWith(`https://127.0.0.1:${port}/`), {timeout: 30000});
    await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 1);
    assert.equal(await page.locator('.song-title').first().textContent(), 'client renamed');
    await page.waitForTimeout(1500);
    assert.ok(!fs.existsSync(path.join(output, 'client_clip_vocals.mp3')), 'A saved song is not downloaded again');
    await app.close();

    // Removed on the server: the client asks to register again.
    const revoke = spawnSync(process.env.UT_STEMS_PYTHON || 'python', ['-m', 'ut_stems.remote', '--data', serverData, '--list'], {cwd: root, encoding: 'utf8'});
    const name = revoke.stdout.trim().split(/\s+/)[0];
    assert.equal(spawnSync(process.env.UT_STEMS_PYTHON || 'python', ['-m', 'ut_stems.remote', '--data', serverData, '--revoke', name], {cwd: root}).status, 0);
    session = await launch(port);
    ({app, page} = session);
    await page.waitForSelector('#notice:not([hidden])', {timeout: 30000});
    assert.match(await page.locator('#notice').textContent(), /no longer knows this PC/);
    await shot('revoked');
    console.log('client test passed');
  } catch (error) {
    await shot('failure').catch(() => {});
    throw error;
  } finally {
    await app.close().catch(() => {});
    server.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
