import {StemsAPI} from './api.js';
import {inlineTitle, playMorph, pressable, progressTrack, segmented, themeToggle, toaster} from './ui.js';

const api = new StemsAPI();
const $ = id => document.getElementById(id);
const MODEL_LABELS = {bs_roformer_sw: 'BS-RoFormer SW', htdemucs_6s: 'HT-Demucs 6s'};
// Shown under the model choice when no GPU can be used (times for a 4-minute song on an 8-core CPU).
const CPU_NOTE = {
  bs_roformer_sw: 'No supported GPU: on the CPU this model takes about 25 minutes for a 4-minute song. HT-Demucs 6s is much faster.',
  htdemucs_6s: 'No supported GPU: on the CPU this model takes about 2 minutes for a 4-minute song.',
};
const label = stem => stem[0].toUpperCase() + stem.slice(1);
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

let state = null;          // last state from the server
let requesting = false;    // a command is in flight
let failures = 0;          // consecutive failed polls
let shownId = null;        // song id the mixer was built for
let selectedId = null;     // song selected in the list
let follow = true;         // the selection follows the song being separated
let loadingId = null;      // song whose result is being fetched
let playing = false;
let seeking = false;       // the user is dragging the seek bar
let lastSync = 0;
const selected = new Set();  // stems to write
const tracks = new Map();    // stem -> {audio, row, canvas, peaks, solo, mute, volume}
const results = new Map();   // song id -> finished result with waveforms
const songRows = new Map();  // song id -> list row elements
const options = {autoTitle: true, keepOriginal: true};  // the toggles under Advanced
// UT Stems Client: separated on the server PC, saved on this one.
const remote = api.remote;
let server = null;               // {name, address, defaultOutput}
let uploading = null;            // {name, index, count, fraction} while files go to the server
const folderFor = new Map();     // song id -> folder on this PC chosen when it was started
const saving = new Map();        // song id -> 'saving' | 'saved' | error message
const savedKey = id => `${state.boot}:${id}`;
const cleanError = error => String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const OPTION_BUTTONS = {autoTitle: 'auto-title', keepOriginal: 'keep-original'};
const controls = {};             // model and overlap segmented controls, theme
let setPlaying = () => {};       // the play button's morph
let errorToast, noticeToast, statusProgress, workingProgress, titleEditor;
const workLog = {id: null, steps: []};  // the steps shown while a song is separated
const CHECK = '<svg viewBox="0 0 24 24"><path d="m5.5 12.5 4 4 9-9.5"/></svg>';

// ---------------------------------------------------------------- theme
function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  try { if (theme) localStorage.setItem('ut-stems-theme', theme); else localStorage.removeItem('ut-stems-theme'); } catch {}
  tracks.forEach(drawWave);
}

// ---------------------------------------------------------------- settings
function stemList() { return (state?.stems ?? []).filter(stem => selected.has(stem)); }

function savePreferences() {
  api.savePreferences({stems: stemList(), output: $('output').value.trim(),
    model: controls.model.value, overlap: controls.overlap.value, theme: document.documentElement.dataset.theme || '', ...options});
}

function buildChips(stems) {
  $('stem-chips').replaceChildren(...stems.map(stem => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.dataset.stem = stem;
    chip.style.setProperty('--stem', `var(--${stem})`);
    const box = document.createElement('span');
    box.className = 'box';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = CHECK;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.setAttribute('aria-hidden', 'true');
    chip.append(box, label(stem), swatch);
    chip.addEventListener('click', () => {
      if (selected.has(stem)) selected.delete(stem); else selected.add(stem);
      savePreferences();
      render();
    });
    return chip;
  }));
}

// ---------------------------------------------------------------- mixer
function drawWave(track) {
  const {canvas, peaks, stem} = track;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--${stem}`).trim();
  for (let x = 0; x < width; x += 2) {
    const from = Math.floor(x / width * peaks.length);
    const to = Math.max(from + 1, Math.floor((x + 2) / width * peaks.length));
    let peak = 0;
    for (let i = from; i < to && i < peaks.length; i++) peak = Math.max(peak, peaks[i]);
    const bar = Math.max(1, Math.pow(peak, 0.7) * height * 0.9);
    context.fillRect(x, (height - bar) / 2, 1.2, bar);
  }
}

function applyMix() {
  const anySolo = [...tracks.values()].some(track => track.solo);
  for (const track of tracks.values()) {
    const audible = anySolo ? track.solo : !track.mute;
    track.audio.volume = audible ? track.volume : 0;
    track.row.classList.toggle('dimmed', !audible);
  }
}

function toggleButton(text, className, title, onChange) {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = text;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    const pressed = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(pressed));
    onChange(pressed);
    applyMix();
  });
  return button;
}

function buildMixer(result) {
  pause();
  for (const track of tracks.values()) { track.audio.pause(); track.audio.removeAttribute('src'); track.audio.load(); }
  tracks.clear();
  shownId = result.id;
  $('song').textContent = result.song;
  showMeta(result);
  $('seek').max = result.duration;
  $('duration').textContent = clock(result.duration);

  $('tracks').replaceChildren(...result.stems.map(stem => {
    const row = document.createElement('div');
    row.className = 'track';
    row.dataset.stem = stem.name;
    row.style.setProperty('--stem', `var(--${stem.name})`);
    const audio = new Audio(api.audioUrl(result.id, stem.name));
    audio.preload = 'auto';
    const track = {stem: stem.name, audio, row, peaks: stem.peaks, solo: false, mute: false, volume: 1};

    const name = document.createElement('div');
    name.className = 'track-name';
    const text = document.createElement('div');
    const level = document.createElement('small');
    level.textContent = stem.silent ? 'silent' : `${stem.level > 0 ? '+' : ''}${stem.level.toFixed(1)} dB`;
    level.title = 'Loudness compared with the whole song';
    text.append(label(stem.name), level);
    name.append(document.createElement('i'), text);

    const buttons = document.createElement('div');
    buttons.className = 'track-buttons';
    buttons.append(
      toggleButton('S', 'solo', `Solo ${stem.name}`, pressed => { track.solo = pressed; }),
      toggleButton('M', 'mute', `Mute ${stem.name}`, pressed => { track.mute = pressed; }));

    const wave = document.createElement('div');
    wave.className = 'wave';
    wave.title = stem.file;
    track.canvas = document.createElement('canvas');
    wave.append(track.canvas);
    if (stem.silent) {
      const badge = document.createElement('span');
      badge.className = 'silent-badge';
      badge.textContent = 'SILENT';
      wave.append(badge);
    }
    wave.addEventListener('click', event => {
      const box = wave.getBoundingClientRect();
      seekTo((event.clientX - box.left) / box.width * result.duration);
    });

    const volume = document.createElement('input');
    volume.type = 'range'; volume.min = 0; volume.max = 1; volume.step = 0.01; volume.value = 1;
    volume.setAttribute('aria-label', `${label(stem.name)} volume`);
    volume.addEventListener('input', () => { track.volume = Number(volume.value); applyMix(); });

    row.append(name, buttons, wave, volume, audio);
    tracks.set(stem.name, track);
    return row;
  }));
  showTime(0);
  requestAnimationFrame(() => tracks.forEach(drawWave));
}

function showMeta(result) {
  let folder = result.folder;
  if (remote) {
    const saved = saving.get(result.id);
    folder = saved === 'saved' ? `saved in ${folderFor.get(result.id) ?? ''}`
      : saved === 'saving' || saved === undefined ? 'saving to this PC…' : 'not saved on this PC';
  }
  $('meta').textContent = `${clock(result.duration)} · ${result.stems.length} stems · ` +
    `${MODEL_LABELS[result.model] ?? result.model} · separated in ${Math.round(result.seconds)} s · ${folder}`;
}

function masterAudio() { return tracks.values().next().value?.audio ?? null; }

function showTime(time) {
  const duration = Number($('seek').max) || 1;
  if (!seeking) $('seek').value = time;
  $('current-time').textContent = clock(time);
  $('tracks').style.setProperty('--pos', Math.min(1, time / duration));
}

function seekTo(time) {
  const duration = Number($('seek').max) || 0;
  const target = Math.max(0, Math.min(time, duration));
  for (const {audio} of tracks.values()) audio.currentTime = target;
  showTime(target);
}

function setPlayIcon() { setPlaying(playing); }

async function play() {
  const master = masterAudio();
  if (!master) return;
  const duration = Number($('seek').max) || 0;
  const start = master.currentTime >= duration - 0.05 ? 0 : master.currentTime;
  for (const {audio} of tracks.values()) audio.currentTime = start;
  try {
    await Promise.all([...tracks.values()].map(({audio}) => audio.play()));
  } catch (error) {
    showError(`Could not play the stems: ${error.message}`);
    return;
  }
  playing = true;
  setPlayIcon();
  requestAnimationFrame(playbackLoop);
}

function pause() {
  for (const {audio} of tracks.values()) audio.pause();
  playing = false;
  setPlayIcon();
}

function playbackLoop() {
  if (!playing) return;
  const master = masterAudio();
  if (!master) return;
  const time = master.currentTime;
  // The stems are separate audio elements; pull any that drift back to the first one.
  if (performance.now() - lastSync > 700) {
    lastSync = performance.now();
    for (const {audio} of tracks.values()) {
      if (audio !== master && Math.abs(audio.currentTime - time) > 0.07) audio.currentTime = time;
    }
  }
  showTime(time);
  if (master.ended) { pause(); seekTo(0); return; }
  requestAnimationFrame(playbackLoop);
}

// ---------------------------------------------------------------- song list
const STATUS_TEXT = {waiting: 'Ready', queued: 'In the queue', failed: 'Failed'};
// A song can be renamed before it is separated, and afterwards, which renames its files.
const RENAMABLE = ['waiting', 'queued', 'done'];

function songStatus(song) {
  if (song.status === 'running') return song.message;
  if (song.status === 'done') {
    const text = `${song.stems} stems · ${song.seconds} s`;
    const saved = saving.get(song.id);
    if (!remote || saved === 'saved') return text;
    return saved === 'saving' || saved === undefined ? `${text} · saving…` : `${text} · not saved`;
  }
  if (song.status === 'waiting' && song.message === 'Cancelled') return 'Cancelled';
  return STATUS_TEXT[song.status] ?? song.status;
}

// Type a new name over the title. Enter or leaving the field saves, Esc cancels,
// and an empty name keeps the old one.
function startRename(id) {
  const row = songRows.get(id);
  if (!row || row.endRename || !RENAMABLE.includes(row.item.dataset.status)) return;
  const editor = document.createElement('input');
  editor.type = 'text';
  editor.className = 'song-rename-input';
  editor.spellcheck = false;
  editor.autocomplete = 'off';
  editor.value = row.title.textContent;
  editor.setAttribute('aria-label', 'Song name');
  row.endRename = save => {
    row.endRename = null;
    const name = editor.value.trim();
    editor.remove();
    if (save && name && name !== row.title.textContent) rename(id, name);
  };
  editor.addEventListener('keydown', event => {
    if (event.key === 'Enter') row.endRename?.(true);
    else if (event.key === 'Escape') row.endRename?.(false);
  });
  editor.addEventListener('blur', () => row.endRename?.(true));
  row.item.append(editor);
  editor.focus();
  editor.select();
}

async function rename(id, name) {
  const done = state.songs.find(song => song.id === id)?.status === 'done';
  const before = done && remote ? (results.get(id) ?? await api.result(id).catch(() => null)) : null;
  if (!await command('rename', {id, name})) return false;
  if (!done) return true;
  // The files have new names. The players keep going: they ask for a stem by song and instrument.
  try {
    const result = await api.result(id);
    if (remote && before) {
      // The copies saved on this PC follow.
      const pairs = before.stems.map(stem => [stem.file, result.stems.find(other => other.name === stem.name)?.file]);
      if (before.original && result.original) pairs.push([before.original, result.original]);
      await api.renameLocal({key: savedKey(id), pairs: pairs.filter(([, to]) => to)});
    }
    results.set(id, result);
    if (shownId === id) {
      $('song').textContent = result.song;
      for (const stem of result.stems) {
        const wave = tracks.get(stem.name)?.row.querySelector('.wave');
        if (wave) wave.title = stem.file;
      }
    }
    noticeToast.show(`Renamed to ${result.song}. The files have the new name.`);
  } catch {
    results.delete(id);
    if (shownId === id) shownId = null;
  }
  render();
  return true;
}

// The steps of the song being separated, from the messages the engine reports.
function renderWorking(song) {
  if (!song) return;
  if (workLog.id !== song.id) { workLog.id = song.id; workLog.steps = []; $('working-log').replaceChildren(); }
  const STAGES = {'Starting': 'Preparing', 'Downloading audio from YouTube': 'Downloading from YouTube', 'Reading audio': 'Reading audio',
    'Loading the separation model': 'Loading model', 'Separating stems': 'Separating', 'Cancelling': 'Cancelling'};
  const raw = song.message.split('…')[0];
  const stage = STAGES[raw] ?? raw;
  const last = workLog.steps.at(-1);
  if (!last || last.text !== stage) {
    if (last) { last.li.classList.add('ok'); last.li.querySelector('span:last-child').textContent = `${last.text} done`; }
    const li = document.createElement('li');
    const at = Math.round(state.elapsed ?? 0);
    li.innerHTML = `<span class="st" aria-hidden="true"></span><time>${clock(at)}</time><span></span>`;
    li.lastChild.textContent = stage;
    $('working-log').append(li);
    while ($('working-log').children.length > 6) $('working-log').firstChild.remove();
    workLog.steps.push({text: stage, li});
  }
  const determinate = /^(Separating|Writing)|\d+%$/.test(song.message);
  $('working-song').textContent = song.title;
  $('working-title').textContent = song.message;
  $('working-percent').textContent = determinate ? `${Math.round(song.progress * 100)}%` : '';
  const pill = $('working-pill');
  pill.textContent = /^Downloading/.test(stage) ? 'Downloading' : /^Loading/.test(stage) ? 'Loading model' : /^Writing/.test(stage) ? 'Writing' : /^Separating/.test(stage) ? 'Separating' : 'Working';
  pill.style.setProperty('--c', /^Downloading|^Loading/.test(stage) ? 'var(--warn)' : 'var(--ink)');
  workingProgress({fraction: song.progress, determinate});
}

function renderSongs(songs) {
  const list = $('song-list');
  for (const [id, row] of songRows) {
    if (!songs.some(song => song.id === id)) { row.item.remove(); songRows.delete(id); results.delete(id); }
  }
  for (const song of songs) {
    let row = songRows.get(song.id);
    if (!row) {
      const item = document.createElement('div');
      item.className = 'song-item';
      const main = document.createElement('button');
      main.className = 'song-main';
      const title = document.createElement('span');
      title.className = 'song-title';
      const status = document.createElement('small');
      main.append(title, status);
      main.addEventListener('click', () => { selectedId = song.id; follow = false; render(); });
      main.addEventListener('dblclick', () => startRename(song.id));
      const rename = document.createElement('button');
      rename.className = 'song-rename';
      rename.textContent = '✎';
      rename.addEventListener('click', () => startRename(song.id));
      const remove = document.createElement('button');
      remove.className = 'song-remove';
      remove.textContent = '×';
      remove.addEventListener('click', () => command('remove', {id: song.id}));
      const bar = document.createElement('i');
      item.append(main, rename, remove, bar);
      list.append(item);
      row = {item, main, title, status, rename, remove, bar, endRename: null};
      songRows.set(song.id, row);
    }
    row.item.dataset.id = song.id;
    row.item.dataset.status = song.status;
    row.item.classList.toggle('selected', song.id === selectedId);
    row.main.setAttribute('aria-pressed', String(song.id === selectedId));
    row.title.textContent = song.title;
    row.main.title = song.title;
    row.status.textContent = songStatus(song);
    const renamable = RENAMABLE.includes(song.status);
    if (!renamable) row.endRename?.(false);
    row.rename.hidden = !renamable;
    row.rename.title = song.status === 'done' ? 'Rename the song and its files (or double-click the song)'
      : 'Rename (or double-click the song)';
    row.rename.setAttribute('aria-label', `Rename ${song.title}`);
    row.remove.hidden = song.status === 'running';
    row.remove.setAttribute('aria-label', `Remove ${song.title}`);
    row.bar.style.width = `${song.status === 'running' ? Math.round(song.progress * 100) : 0}%`;
  }
  $('song-sidebar').hidden = !songs.length;
  $('song-count').textContent = songs.length;
  $('clear-finished').hidden = !songs.some(song => song.status === 'done' || song.status === 'failed');
}

async function loadResult(id) {
  if (loadingId === id) return;
  loadingId = id;
  try {
    results.set(id, await api.result(id));
  } catch (error) {
    localError = error.message;
  } finally {
    loadingId = null;
    render();
  }
}

// ---------------------------------------------------------------- rendering
let localError = '';
function showError(message) { localError = message; render(); }

function waitingCount() { return state.songs.filter(song => song.status === 'waiting').length; }

function render() {
  if (!state) return;
  const songs = state.songs;
  const busy = state.busy;

  // Which song the stage shows.
  if (follow && state.running != null) selectedId = state.running;
  if (!songs.some(song => song.id === selectedId)) selectedId = songs.length ? songs[0].id : null;
  const song = songs.find(entry => entry.id === selectedId) ?? null;

  $('device').hidden = !state.device;
  $('device').textContent = state.device ?? '';
  const onCpu = typeof state.device === 'string' && state.device.startsWith('CPU');
  $('cpu-note').hidden = !onCpu;
  if (onCpu) $('cpu-note').textContent = CPU_NOTE[controls.model.value] ?? '';
  $('working-note').hidden = onCpu;
  $('working-note-cpu').hidden = !onCpu;
  renderSongs(songs);

  for (const chip of $('stem-chips').children) {
    chip.setAttribute('aria-pressed', String(selected.has(chip.dataset.stem)));
    chip.disabled = requesting;
  }
  for (const [option, id] of Object.entries(OPTION_BUTTONS)) {
    $(id).setAttribute('aria-pressed', String(options[option]));
    $(id).setAttribute('aria-checked', String(options[option]));
  }
  const typed = Boolean($('source').value.trim());
  const ready = waitingCount() + (typed ? 1 : 0);
  $('add-source').disabled = requesting || !typed || Boolean(uploading);
  $('choose-file').disabled = requesting || Boolean(uploading);
  $('separate').disabled = requesting || !selected.size || !ready;
  $('separate-label').textContent = ready > 1 ? `Separate ${ready} songs` : 'Separate stems';

  let status = state.message;
  if (uploading) status = `Sending ${uploading.name} to ${server?.name ?? 'the server'}` +
    `${uploading.count > 1 ? ` (${uploading.index + 1} of ${uploading.count})` : ''}… ${Math.round(uploading.fraction * 100)}%`;
  else if (failures >= 3) status = remote ? `Lost the connection to ${server?.name ?? 'the server'}.` : 'The processing engine stopped. Restart the app.';
  else if (!busy && ready && !uploading) status = ready === 1 ? '1 song ready. Press Separate stems.' : `${ready} songs ready. Press Separate ${ready} songs.`;
  $('status').textContent = status;
  $('status-dot').classList.toggle('busy', busy);
  $('progress').hidden = !busy;
  $('progress').value = state.progress;
  const runningSong = songs.find(entry => entry.id === state.running);
  statusProgress({visible: busy, fraction: state.progress,
    determinate: Boolean(runningSong) && /^(Separating|Writing)|\d+%$/.test(runningSong.message)});
  $('cancel').hidden = !busy;
  $('elapsed-time').hidden = !busy;
  if (busy) $('elapsed-time').textContent = clock(state.elapsed ?? 0);

  // Stage: empty, working, mixer, or a note about a song that has no result.
  const done = song?.status === 'done';
  const result = done ? results.get(song.id) : null;
  if (done && !result) loadResult(song.id);
  if (result && shownId !== result.id) buildMixer(result);
  if (!result && playing) pause();
  $('empty').hidden = Boolean(song);
  $('working').hidden = song?.status !== 'running';
  $('mixer').hidden = !result;
  $('pending').hidden = !song || song.status === 'running' || done;
  if (song?.status === 'running') renderWorking(song);
  if (song?.status === 'waiting') {
    $('pending-title').textContent = song.message === 'Cancelled' ? 'Cancelled' : 'Ready to separate';
    $('pending-note').textContent = 'Pick the stems you want, then press Separate.';
  } else if (song?.status === 'queued') {
    $('pending-title').textContent = 'In the queue';
    $('pending-note').textContent = 'It starts when the songs before it are finished.';
  } else if (song?.status === 'failed') {
    $('pending-title').textContent = 'This song could not be separated';
    $('pending-note').textContent = song.error ?? '';
  }

  errorToast.show(localError);
}

async function command(action, values = {}) {
  requesting = true;
  render();
  try {
    state = await api.command(action, values);
    return true;
  } catch (error) {
    localError = error.message;
    return false;
  } finally {
    requesting = false;
    render();
  }
}

async function poll() {
  try {
    state = await api.state();
    failures = 0;
  } catch {
    failures += 1;
  }
  if (remote && state) saveFinished();
  render();
  setTimeout(poll, state?.busy ? 350 : 900);
}

const isLink = text => /^https?:\/\//i.test(text.trim());

async function addSources(sources) {
  localError = '';
  const before = new Set(state.songs.map(song => song.id));
  if (remote && sources.some(source => !isLink(source))) {
    // Files go to the server PC; only links are added by name.
    if (!await upload(sources.filter(source => !isLink(source)))) return false;
    sources = sources.filter(isLink);
    if (!sources.length) { selectAdded(before); return true; }
  }
  if (!await command('add', {sources})) return false;
  selectAdded(before);
  return true;
}

function selectAdded(before) {
  // Show the first newly added song unless one is being separated.
  const added = state.songs.find(song => !before.has(song.id));
  if (added && state.running == null) { selectedId = added.id; follow = false; render(); }
}

// UT Stems Client: send files to the server PC, which separates them.
async function upload(paths) {
  uploading = {name: paths[0].split(/[\\/]/).pop(), index: 0, count: paths.length, fraction: 0};
  render();
  try {
    const {added, errors} = await api.uploadFiles(paths);
    if (errors.length) localError = `Could not send ${errors.join('; ')}`;
    state = await api.state();
    return added.length > 0;
  } catch (error) {
    localError = cleanError(error);
    return false;
  } finally {
    uploading = null;
    render();
  }
}

// UT Stems Client: download each finished song into the folder chosen when it was started.
function saveFinished() {
  for (const song of state.songs) {
    if (song.status !== 'done' || saving.has(song.id)) continue;
    saving.set(song.id, 'saving');
    const key = savedKey(song.id);
    const folder = folderFor.get(song.id) || $('output').value.trim() || server?.defaultOutput;
    (async () => {
      try {
        const already = await api.savedFolder(key);
        const where = already ?? (await api.saveResult({key, id: song.id, folder})).folder;
        folderFor.set(song.id, where);
        saving.set(song.id, 'saved');
      } catch (error) {
        saving.set(song.id, cleanError(error));
        localError = `${song.title} could not be saved on this PC: ${cleanError(error)}`;
      }
      const result = results.get(song.id);
      if (result && shownId === song.id) showMeta(result);
      render();
    })();
  }
}

async function addTyped() {
  const text = $('source').value.trim();
  if (!text) return true;
  if (!await addSources([text])) return false;
  $('source').value = '';
  render();
  return true;
}

async function separate() {
  if ($('separate').disabled) return;
  localError = '';
  if (!await addTyped()) return;
  follow = true;
  for (const song of state.songs) if (song.status === 'waiting') folderFor.set(song.id, $('output').value.trim());
  await command('start', {stems: stemList(), output: $('output').value.trim(),
    model: controls.model.value, overlap: Number(controls.overlap.value), ...options});
}

// ---------------------------------------------------------------- start
async function start() {
  const preferences = await api.preferences();
  state = await api.state();
  buildChips(state.stems);
  const saved = Array.isArray(preferences.stems) ? preferences.stems.filter(stem => state.stems.includes(stem)) : [];
  for (const stem of saved.length ? saved : state.stems) selected.add(stem);
  if (remote) {
    server = await api.serverInfo();
    $('server-chip').hidden = false;
    $('server-chip').textContent = `on ${server.name} ✕`;
    document.querySelector('.local-label').textContent = `RUNS ON ${server.name.toUpperCase()}`;
    $('server-chip').addEventListener('click', () => api.forgetServer());
    api.onUploadProgress(progress => { if (progress) { uploading = progress; render(); } });
  }
  $('output').value = preferences.output || (remote ? server.defaultOutput : state.defaultOutput);
  controls.model = segmented($('model'), () => { savePreferences(); render(); });
  controls.overlap = segmented($('overlap'), savePreferences);
  if (state.models.includes(preferences.model)) controls.model.value = preferences.model;
  if (['2', '4'].includes(preferences.overlap)) controls.overlap.value = preferences.overlap;
  for (const option of Object.keys(options)) {
    if (typeof preferences[option] === 'boolean') options[option] = preferences[option];
    pressable($(OPTION_BUTTONS[option]));
    $(OPTION_BUTTONS[option]).addEventListener('click', () => {
      options[option] = !options[option];
      savePreferences();
      render();
    });
  }
  if (preferences.theme === 'dark' || preferences.theme === 'light') applyTheme(preferences.theme);
  themeToggle($('theme'), {get: () => currentTheme() === 'dark', set: dark => { applyTheme(dark ? 'dark' : 'light'); savePreferences(); }});
  errorToast = toaster($('error'), $('error-text'), $('dismiss-error'), {life: 0});
  noticeToast = toaster($('notice'), $('notice-text'), $('dismiss-notice'));
  statusProgress = progressTrack($('progress-track'));
  workingProgress = progressTrack($('working-track'));
  setPlaying = playMorph($('play'));
  titleEditor = inlineTitle($('title-row'), {
    view: $('song'), pen: $('title-pen'), input: $('title-input'),
    ok: document.querySelector('#title-row .ok'), no: document.querySelector('#title-row .no'),
    canEdit: () => shownId != null && state?.songs.find(song => song.id === shownId)?.status === 'done',
    save: name => rename(shownId, name),
  });
  $('dropzone').addEventListener('click', async event => {
    if (event.target.closest('.dz-browse') || api.desktop) {
      const paths = await api.chooseFiles();
      if (paths.length) addSources(paths);
    } else $('source').focus();
  });
  $('dropzone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('dropzone').click(); } });
  if (!api.desktop) {
    // In a plain browser there are no file dialogs; paths are typed instead.
    $('choose-file').hidden = true;
    $('choose-folder').hidden = true;
    $('source').placeholder = 'Paste a YouTube link or a file path…';
  }

  $('source').addEventListener('input', render);
  $('source').addEventListener('keydown', event => { if (event.key === 'Enter') addTyped(); });
  $('add-source').addEventListener('click', addTyped);
  $('choose-file').addEventListener('click', async () => {
    const paths = await api.chooseFiles();
    if (paths.length) addSources(paths);
  });
  $('choose-folder').addEventListener('click', async () => {
    const path = await api.chooseFolder($('output').value.trim());
    if (path) { $('output').value = path; savePreferences(); }
  });
  $('output').addEventListener('change', savePreferences);
  $('stems-all').addEventListener('click', () => { state.stems.forEach(stem => selected.add(stem)); savePreferences(); render(); });
  $('stems-none').addEventListener('click', () => { selected.clear(); savePreferences(); render(); });
  $('separate').addEventListener('click', separate);
  $('cancel').addEventListener('click', () => command('cancel'));
  $('clear-finished').addEventListener('click', () => command('clear-finished'));
  $('open-folder').addEventListener('click', () => {
    if (remote) api.openLocalFolder(savedKey(shownId)).catch(error => showError(cleanError(error)));
    else command('open-folder', {id: shownId});
  });
  $('dismiss-error').addEventListener('click', () => { localError = ''; });

  $('play').addEventListener('click', () => { if (playing) pause(); else play(); });
  $('seek').addEventListener('pointerdown', () => { seeking = true; });
  $('seek').addEventListener('input', () => { seeking = true; showTime(Number($('seek').value)); });
  $('seek').addEventListener('change', () => { seeking = false; seekTo(Number($('seek').value)); });
  new ResizeObserver(() => tracks.forEach(drawWave)).observe($('tracks'));

  // Dragging files over the window lights up the drop zone, or an overlay when the stage shows something else.
  let dragDepth = 0;
  const dragging = on => {
    $('stage').classList.toggle('is-drag', on);
    $('drop-hint').hidden = !on || !$('empty').hidden;
  };
  window.addEventListener('dragenter', event => { event.preventDefault(); dragDepth += 1; dragging(true); });
  window.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', () => { dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; dragging(false); } });
  window.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    dragging(false);
    const paths = [...(event.dataTransfer?.files ?? [])].map(file => api.pathForFile(file)).filter(Boolean);
    if (paths.length) addSources(paths);
  });

  render();
  setTimeout(poll, 350);
}

start().catch(error => {
  $('status').textContent = `Could not connect to the processing engine: ${error.message}`;
});
