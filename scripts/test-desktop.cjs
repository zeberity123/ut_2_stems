// Desktop smoke test: launches the Electron app with an isolated profile, queues songs,
// separates them and checks the mixer. Screenshots go to diagnostics/.
//
//   npm run test:desktop                              (two synthetic 20 s clips, queued)
//   set UT_STEMS_TEST_SOURCE=<file or YouTube link>   (one real song instead)
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

  function makeClip(name, frequency) {
    const target = path.join(diagnostics, name);
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
      `sine=frequency=${frequency}:duration=20`, '-f', 'lavfi', '-i', 'anoisesrc=d=20:c=pink:a=0.2',
      '-filter_complex', 'amix=inputs=2', '-ac', '2', '-ar', '44100', '-b:a', '192k', target]);
    assert.equal(made.status, 0, `ffmpeg could not create the test clip: ${made.stderr}`);
    return target;
  }
  const sources = process.env.UT_STEMS_TEST_SOURCE ? [process.env.UT_STEMS_TEST_SOURCE]
    : [makeClip('test_clip.mp3', 220), makeClip('second_clip.mp3', 110)];
  const wanted = (process.env.UT_STEMS_TEST_STEMS || 'vocals,bass,drums,guitars,piano,others').split(',');

  const profile = path.join(diagnostics, 'profile');
  fs.rmSync(profile, {recursive: true, force: true});
  const app = await electron.launch({args: [root, `--user-data-dir=${profile}`], cwd: root,
    env: {...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'}});
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const screenshot = name => page.screenshot({path: path.join(diagnostics, `${tag}-${name}.png`)});
  const statuses = () => page.locator('.song-item').evaluateAll(nodes => nodes.map(node => node.dataset.status));
  try {
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('Paste a YouTube link'));
    await page.waitForFunction(() => document.querySelectorAll('#stem-chips .chip').length === 6);
    assert.equal(await page.locator('#separate').isDisabled(), true, 'Separate is disabled without a song');
    assert.equal(await page.locator('#song-sidebar').isHidden(), true, 'The song list is hidden while empty');
    await screenshot('empty');

    // A missing file is refused and nothing is added.
    await page.locator('#source').fill(path.join(diagnostics, 'no_such_file.mp3'));
    await page.locator('#add-source').click();
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    assert.match(await page.locator('#error-text').textContent(), /File not found/);
    await page.locator('#dismiss-error').click();
    assert.equal(await page.locator('.song-item').count(), 0);

    // Every source but the last goes in with Add; the last one stays typed in the box.
    for (const source of sources.slice(0, -1)) {
      await page.locator('#source').fill(source);
      await page.locator('#add-source').click();
      await page.waitForFunction(() => document.querySelector('#source').value === '');
    }
    await page.locator('#source').fill(sources.at(-1));
    assert.deepEqual(await statuses(), sources.slice(0, -1).map(() => 'waiting'));
    assert.equal(await page.locator('#separate-label').textContent(),
      sources.length > 1 ? `Separate ${sources.length} songs` : 'Separate stems');

    // A song can be renamed before it is separated: Esc leaves the name alone, Enter saves it.
    if (sources.length > 1) {
      const first = page.locator('.song-item').first();
      const original = await first.locator('.song-title').textContent();
      await first.locator('.song-main').dblclick();
      await page.locator('.song-rename-input').fill('not this');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.song-rename-input').count(), 0);
      assert.equal(await first.locator('.song-title').textContent(), original);
      await first.locator('.song-rename').click();
      assert.equal(await page.locator('.song-rename-input').inputValue(), original);
      await page.locator('.song-rename-input').fill('renamed clip');
      await screenshot('rename');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.song-title').textContent === 'renamed clip');
    }

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
    if (sources.length > 1) {
      assert.ok((await statuses()).includes('queued'), 'The other songs wait in the queue');
      assert.match(await page.locator('#status').textContent(), /more in the queue/);
    }
    await page.waitForFunction(count => {
      const items = [...document.querySelectorAll('.song-item')];
      return items.length === count && items.every(item => ['done', 'failed'].includes(item.dataset.status));
    }, sources.length, {timeout: 900000});
    assert.deepEqual(await statuses(), sources.map(() => 'done'),
      `A song failed: ${await page.locator('#pending-note').textContent()}`);

    // The stage followed the queue and now shows the last song.
    await page.waitForFunction(() => !document.querySelector('#mixer').hidden);
    const titles = await page.locator('.song-title').allTextContents();
    if (sources.length > 1) assert.equal(titles[0], 'renamed clip', 'The new name is kept');
    assert.equal(await page.locator('.song-rename:visible').count(), 0, 'Finished songs cannot be renamed');
    assert.equal(await page.locator('#song').textContent(), titles.at(-1));
    for (const title of titles) {
      for (const stem of wanted) {
        const file = path.join(output, `${title}_${stem}.mp3`);
        assert.ok(fs.statSync(file).size > 10000, `${file} was written`);
      }
    }
    // Picking another song in the list opens its stems.
    await page.locator('.song-main').first().click();
    await page.waitForFunction(title => document.querySelector('#song').textContent === title, titles[0]);
    const rows = await page.locator('#tracks .track').evaluateAll(nodes => nodes.map(node => node.dataset.stem));
    assert.deepEqual(rows, wanted, 'The mixer shows the selected stems in order');
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
    console.log(`songs: ${titles.join(' | ')}`);
    console.log(`meta: ${await page.locator('#meta').textContent()}`);
    console.log(levels.join('\n'));

    // Removing and clearing songs.
    if (sources.length > 1) {
      await page.locator('.song-remove').last().click();
      await page.waitForFunction(count => document.querySelectorAll('.song-item').length === count, sources.length - 1);
    }
    await page.locator('#clear-finished').click();
    await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 0);
    assert.equal(await page.locator('#empty').isHidden(), false, 'The empty state returns when the list is cleared');
    assert.equal(await page.locator('#mixer').isHidden(), true);

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
