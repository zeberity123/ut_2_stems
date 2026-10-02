import {StemsAPI} from './api.js';

const api = new StemsAPI();
const $ = id => document.getElementById(id);
const MODEL_LABELS = {bs_roformer_sw: 'BS-RoFormer SW', htdemucs_6s: 'HT-Demucs 6s'};
const label = stem => stem[0].toUpperCase() + stem.slice(1);
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

let state = null;          // last state from the server
let requesting = false;    // a command is in flight
let failures = 0;          // consecutive failed polls
let shownJob = null;       // job id the mixer was built for
let playing = false;
let seeking = false;       // the user is dragging the seek bar
let lastSync = 0;
const selected = new Set();  // stems to write
const tracks = new Map();    // stem -> {audio, row, canvas, peaks, solo, mute, volume}

// ---------------------------------------------------------------- settings
function stemList() { return (state?.stems ?? []).filter(stem => selected.has(stem)); }

function savePreferences() {
  api.savePreferences({stems: stemList(), output: $('output').value.trim(),
    model: $('model').value, overlap: $('overlap').value});
}

function buildChips(stems) {
  $('stem-chips').replaceChildren(...stems.map(stem => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.stem = stem;
    chip.style.setProperty('--stem', `var(--${stem})`);
    chip.append(document.createElement('i'), label(stem));
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
    const bar = Math.max(1, Math.pow(peak, 0.7) * height * 0.94);
    context.fillRect(x, (height - bar) / 2, 1.3, bar);
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
  shownJob = result.job;
  $('song').textContent = result.song;
  $('meta').textContent = `${clock(result.duration)} · ${result.stems.length} stems · ` +
    `${MODEL_LABELS[result.model] ?? result.model} · separated in ${Math.round(result.seconds)} s · ${result.folder}`;
  $('seek').max = result.duration;
  $('duration').textContent = clock(result.duration);

  $('tracks').replaceChildren(...result.stems.map(stem => {
    const row = document.createElement('div');
    row.className = 'track';
    row.dataset.stem = stem.name;
    row.style.setProperty('--stem', `var(--${stem.name})`);
    const audio = new Audio(api.audioUrl(result.job, stem.name));
    audio.preload = 'auto';
    const track = {stem: stem.name, audio, row, peaks: stem.peaks, solo: false, mute: false, volume: 1};

    const name = document.createElement('div');
    name.className = 'track-name';
    const text = document.createElement('div');
    const level = document.createElement('small');
    level.textContent = stem.silent ? 'no sound found' : `${stem.level.toFixed(1)} dB`;
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

function setPlayIcon() {
  $('play-icon').className = `playback-icon ${playing ? 'pause-icon' : 'play-icon'}`;
  $('play-label').textContent = playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

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

// ---------------------------------------------------------------- rendering
let localError = '';
function showError(message) { localError = message; render(); }

function render() {
  if (!state) return;
  const busy = state.busy;
  const locked = busy || requesting;

  $('device').hidden = !state.device;
  $('device').textContent = state.device ?? '';

  for (const chip of $('stem-chips').children) {
    chip.setAttribute('aria-pressed', String(selected.has(chip.dataset.stem)));
    chip.disabled = locked;
  }
  for (const id of ['source', 'choose-file', 'output', 'choose-folder', 'model', 'overlap', 'stems-all', 'stems-none']) {
    $(id).disabled = locked;
  }
  $('separate').disabled = locked || !selected.size || !$('source').value.trim();

  $('status').textContent = failures >= 3 ? 'The processing engine stopped. Restart the app.' : state.message;
  $('status-dot').classList.toggle('busy', busy);
  $('progress').hidden = !busy;
  $('progress').value = state.progress;
  $('cancel').hidden = !busy;
  $('elapsed-time').hidden = !busy;
  if (busy) $('elapsed-time').textContent = clock(state.elapsed ?? 0);

  const result = state.result;
  if (result && result.job !== shownJob) buildMixer(result);
  if (busy && playing) pause();
  $('working').hidden = !busy;
  $('mixer').hidden = busy || !result;
  $('empty').hidden = busy || Boolean(result);
  if (busy) $('working-title').textContent = state.message;

  const error = state.error || localError;
  $('error').hidden = !error;
  $('error-text').textContent = error ?? '';
}

async function command(action, values = {}) {
  requesting = true;
  render();
  try {
    state = await api.command(action, values);
  } catch (error) {
    localError = error.message;
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
  render();
  setTimeout(poll, state?.busy ? 350 : 900);
}

function separate() {
  if ($('separate').disabled) return;
  localError = '';
  command('separate', {source: $('source').value.trim(), stems: stemList(),
    output: $('output').value.trim(), model: $('model').value, overlap: Number($('overlap').value)});
}

// ---------------------------------------------------------------- start
async function start() {
  const preferences = await api.preferences();
  state = await api.state();
  buildChips(state.stems);
  const saved = Array.isArray(preferences.stems) ? preferences.stems.filter(stem => state.stems.includes(stem)) : [];
  for (const stem of saved.length ? saved : state.stems) selected.add(stem);
  $('output').value = preferences.output || state.defaultOutput;
  if (state.models.includes(preferences.model)) $('model').value = preferences.model;
  if (['2', '4'].includes(preferences.overlap)) $('overlap').value = preferences.overlap;
  if (!api.desktop) {
    // In a plain browser there are no file dialogs; paths are typed instead.
    $('choose-file').hidden = true;
    $('choose-folder').hidden = true;
    $('source').placeholder = 'Paste a YouTube link or a file path…';
  }

  $('source').addEventListener('input', render);
  $('source').addEventListener('keydown', event => { if (event.key === 'Enter') separate(); });
  $('choose-file').addEventListener('click', async () => {
    const path = await api.chooseFile();
    if (path) { $('source').value = path; render(); }
  });
  $('choose-folder').addEventListener('click', async () => {
    const path = await api.chooseFolder($('output').value.trim());
    if (path) { $('output').value = path; savePreferences(); }
  });
  for (const id of ['output', 'model', 'overlap']) $(id).addEventListener('change', savePreferences);
  $('stems-all').addEventListener('click', () => { state.stems.forEach(stem => selected.add(stem)); savePreferences(); render(); });
  $('stems-none').addEventListener('click', () => { selected.clear(); savePreferences(); render(); });
  $('separate').addEventListener('click', separate);
  $('cancel').addEventListener('click', () => command('cancel'));
  $('open-folder').addEventListener('click', () => command('open-folder'));
  $('dismiss-error').addEventListener('click', () => {
    localError = '';
    if (state.error) command('dismiss-error'); else render();
  });

  $('play').addEventListener('click', () => { if (playing) pause(); else play(); });
  $('seek').addEventListener('pointerdown', () => { seeking = true; });
  $('seek').addEventListener('input', () => { seeking = true; showTime(Number($('seek').value)); });
  $('seek').addEventListener('change', () => { seeking = false; seekTo(Number($('seek').value)); });
  new ResizeObserver(() => tracks.forEach(drawWave)).observe($('tracks'));

  let dragDepth = 0;
  window.addEventListener('dragenter', event => { event.preventDefault(); dragDepth += 1; $('drop-hint').hidden = false; });
  window.addEventListener('dragover', event => event.preventDefault());
  window.addEventListener('dragleave', () => { dragDepth -= 1; if (dragDepth <= 0) $('drop-hint').hidden = true; });
  window.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    $('drop-hint').hidden = true;
    const file = event.dataTransfer?.files?.[0];
    const path = file ? api.pathForFile(file) : '';
    if (path && !state.busy) { $('source').value = path; render(); }
  });

  render();
  setTimeout(poll, 350);
}

start().catch(error => {
  $('status').textContent = `Could not connect to the processing engine: ${error.message}`;
});
