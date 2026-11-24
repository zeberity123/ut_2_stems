// First start of the installed app: pick the engine edition, download and install it.
// The Rust side (src-tauri/src/engine.rs) does the work and reports progress; this page shows it.
import {segmented, toaster} from './ui.js';
import {setLanguage, storedChoice, t, tm} from './i18n.js';

setLanguage(storedChoice());

const $ = id => document.getElementById(id);
const T = window.__TAURI__;
const invoke = (command, args) => T.core.invoke(command, args);
const SIZES = {cuda: '1.7 GB', xpu: '1.2 GB', cpu: '200 MB'};
const NOTES = {
  cuda: 'For NVIDIA GPUs (GTX 10 series or newer, current driver). Also runs on the CPU when no GPU is found, so it is a safe choice for any PC.',
  xpu: 'For Intel Arc A/B series and the Arc graphics in Core Ultra laptops, with a recent Intel graphics driver.',
  cpu: 'For PCs without a supported GPU (or with an AMD GPU). Separation is slower: about 25 minutes for a 4-minute song with the best model.',
};
const gb = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;

let edition, errorToast, status, busy = false, file = null;

function setState(state) { $('dl').dataset.state = state; }
function setProgress(fraction, text) {
  $('dl-button').style.setProperty('--p', Math.max(0, Math.min(1, fraction)).toFixed(4));
  $('dl-pct').textContent = `${Math.round(fraction * 100)}%`;
  $('dl-eta').textContent = text;
}

function describe() {
  const value = edition.value;
  $('dl-size').textContent = SIZES[value];
  const needed = status?.neededBytes?.[value] ?? 0, free = status?.freeBytes ?? Infinity;
  const short = free < needed;
  $('edition-note').textContent = `${t(NOTES[value])} ${t('Needs about {need} free while installing.', {need: gb(needed)})}` +
    (free === Infinity ? '' : ` ${t('{free} is free.', {free: gb(free)})}`);
  $('edition-note').classList.toggle('cpu-note', short);
  $('dl-button').disabled = short;
  if (short) $('status').textContent = t('Not enough space on this drive. Make room, then start UT Stems again.');
  const nearby = file ?? (status?.nearby && status.suggested === value ? status.nearby : null);
  $('nearby-note').textContent = nearby ? ` ${t('Using {file}.', {file: nearby.split(/[\\/]/).pop()})}` : '';
  $('dl-label').textContent = nearby ? t('Install from the file') : (status?.installed ? t('Download and update') : t('Download and install'));
}

async function install() {
  if (busy) { await invoke('cancel_engine_install'); return; }
  busy = true;
  setState('run');
  setProgress(0, t('Starting…'));
  $('dl-live').textContent = t('Download started');
  const chosen = file ?? (status?.nearby && status.suggested === edition.value ? status.nearby : null);
  try {
    await invoke('install_engine', {edition: edition.value, file: chosen});
    setState('fold');
    $('dl-live').textContent = t('The engine is installed');
    $('status').textContent = t('Starting UT Stems…');
    setTimeout(() => setState('done'), 650);
    // The shell now starts the engine and brings this window to it.
  } catch (error) {
    busy = false;
    setState('idle');
    setProgress(0, '');
    const message = String(error?.message ?? error);
    if (!/^Cancelled/.test(message)) errorToast.show(tm(message));
    $('status').textContent = t('Nothing is installed yet.');
  }
}

(async () => {
  errorToast = toaster($('error'), $('error-text'), $('dismiss-error'), {life: 0});
  edition = segmented($('edition'), describe);
  status = await invoke('engine_status');
  edition.value = status.suggested;
  $('graphics').textContent = status.graphics.length ? status.graphics.join(', ') : t('No graphics adapter reported');
  $('folder').textContent = status.folder;
  if (status.installed) {
    $('setup-title').textContent = t('Update the processing engine');
    $('setup-lead').textContent = t('This version of UT Stems needs engine {app}; the installed engine is {installed}.',
      {app: status.appVersion, installed: status.installed.version || t('older')});
    $('status').textContent = t('Engine {version} · {edition} installed', {version: status.installed.version || '?', edition: status.installed.edition || ''});
  }
  describe();
  $('dl-button').addEventListener('click', install);
  $('pick-file').addEventListener('click', async () => {
    const picked = await invoke('choose_engine_file');
    if (picked) { file = picked; describe(); }
  });
  await T.event.listen('engine-progress', ({payload}) => {
    const {phase, done, total, rate} = payload;
    const fraction = total ? done / total : 0;
    if (phase === 'download') {
      const left = rate && total ? Math.max(0, Math.round((total - done) / rate)) : 0;
      setProgress(fraction * 0.8, t('Downloading · {done} of {total}', {done: gb(done), total: gb(total)}) +
        (rate ? ` · ${gb(rate)}/s` : '') + (left ? t(' · {min} min left', {min: Math.ceil(left / 60)}) : ''));
      $('status').textContent = t('Downloading the engine…');
    } else if (phase === 'verify') {
      setProgress(0.8 + fraction * 0.02, t('Checking the file…'));
    } else {
      setProgress(0.82 + fraction * 0.18, t('Unpacking · {done} of {total}', {done: gb(done), total: gb(total)}));
      $('status').textContent = t('Unpacking the engine…');
    }
  });
})().catch(error => { $('status').textContent = t('Could not start: {error}', {error: error?.message ?? error}); });
