// Desktop smoke test: launches the Electron app with an isolated profile, separates one
// clip and checks the mixer. Screenshots go to diagnostics/.
//
//   npm run test:desktop                              (synthetic 20 s clip)
//   set UT_STEMS_TEST_SOURCE=<file or YouTube link>   (a real song instead)
//   set UT_STEMS_TEST_STEMS=vocals,bass,drums,guitars (stems to select, default all)
const {_electron: electron} = require('playwright');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const diagnostics = path.join(root, 'diagnostics');
  const output = path.join(diagnostics, 'output');
  const tag = process.env.UT_STEMS_TEST_TAG || 'desktop';
  fs.mkdirSync(output, {recursive: true});

  let source = process.env.UT_STEMS_TEST_SOURCE;
  if (!source) {
    source = path.join(diagnostics, 'test_clip.mp3');
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
      'sine=frequency=220:duration=20', '-f', 'lavfi', '-i', 'anoisesrc=d=20:c=pink:a=0.2',
      '-filter_complex', 'amix=inputs=2', '-ac', '2', '-ar', '44100', '-b:a', '192k', source]);
    assert.equal(made.status, 0, `ffmpeg could not create the test clip: ${made.stderr}`);
  }
  const wanted = (process.env.UT_STEMS_TEST_STEMS || 'vocals,bass,drums,guitars,piano,others').split(',');

  const profile = path.join(diagnostics, 'profile');
  fs.rmSync(profile, {recursive: true, force: true});
  const app = await electron.launch({args: [root, `--user-data-dir=${profile}`], cwd: root,
    env: {...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'}});
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const screenshot = name => page.screenshot({path: path.join(diagnostics, `${tag}-${name}.png`)});
  try {
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('Paste a YouTube link'));
    await page.waitForFunction(() => document.querySelectorAll('#stem-chips .chip').length === 6);
    assert.equal(await page.locator('#separate').isDisabled(), true, 'Separate is disabled without a source');
    await screenshot('empty');

    await page.locator('#source').fill(source);
    await page.locator('#output').fill(output);
    await page.locator('#output').dispatchEvent('change');
    for (const chip of await page.locator('#stem-chips .chip').all()) {
      const stem = await chip.getAttribute('data-stem');
      const pressed = (await chip.getAttribute('aria-pressed')) === 'true';
      if (pressed !== wanted.includes(stem)) await chip.click();
    }
    await screenshot('ready');
    // The preload bridge works: dropped files resolve to paths, and choices are remembered.
    assert.equal(await page.evaluate(() => window.desktop.pathForFile(new File([''], 'x.mp3'))), '');
    await page.waitForFunction(() => window.desktop.getPreferences().then(saved => Boolean(saved.output)));
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
    assert.deepEqual(saved.stems, wanted, 'The stem selection is saved');
    assert.equal(saved.output, output, 'The output folder is saved');
    await page.locator('#separate').click();
    await page.waitForFunction(() => !document.querySelector('#working').hidden, null, {timeout: 15000});
    await page.waitForFunction(() => /Separating|Downloading/.test(document.querySelector('#status').textContent), null, {timeout: 300000});
    await screenshot('working');
    await page.waitForFunction(() => !document.querySelector('#mixer').hidden || !document.querySelector('#error').hidden, null, {timeout: 900000});
    assert.equal(await page.locator('#error').isHidden(), true, `Error shown: ${await page.locator('#error-text').textContent()}`);

    const rows = await page.locator('#tracks .track').evaluateAll(nodes => nodes.map(node => node.dataset.stem));
    assert.deepEqual(rows, wanted, 'The mixer shows the selected stems in order');
    const song = await page.locator('#song').textContent();
    for (const stem of wanted) {
      const file = path.join(output, `${song}_${stem}.mp3`);
      assert.ok(fs.statSync(file).size > 10000, `${file} was written`);
    }
    await page.waitForTimeout(600);
    await screenshot('mixer');

    await page.locator('#play').click();
    await page.waitForFunction(() => Number(document.querySelector('#seek').value) > 1.5, null, {timeout: 20000});
    const players = await page.locator('#tracks audio').evaluateAll(nodes => nodes.map(node => ({paused: node.paused, time: node.currentTime})));
    assert.equal(players.length, wanted.length, 'One player per stem');
    assert.ok(players.every(player => !player.paused), 'Every stem is playing');
    const spread = Math.max(...players.map(player => player.time)) - Math.min(...players.map(player => player.time));
    assert.ok(spread < 0.15, `Stems play in sync (spread ${spread.toFixed(3)} s)`);
    await page.locator('.track .solo').first().click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.track.dimmed').count(), wanted.length - 1, 'Solo dims the other stems');
    await screenshot('playing');
    await page.locator('#play').click();

    const levels = await page.locator('#tracks .track').evaluateAll(nodes => nodes.map(node => `${node.dataset.stem}: ${node.querySelector('small').textContent}`));
    console.log(`song: ${song}`);
    console.log(`meta: ${await page.locator('#meta').textContent()}`);
    console.log(levels.join('\n'));
    assert.deepEqual(errors, [], 'No page errors');
    console.log('desktop test passed');
  } catch (error) {
    await screenshot('failure').catch(() => {});
    console.error(await page.locator('#status').textContent().catch(() => ''));
    throw error;
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
