const {app, BrowserWindow, ipcMain, dialog} = require('electron');
const {spawn, spawnSync} = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
const profile = app.commandLine.getSwitchValue('user-data-dir');
if (profile) {
  fs.mkdirSync(path.resolve(profile), {recursive: true});
  app.setPath('userData', path.resolve(profile));
}
let backend, window, origin;
const preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
let preferences = {};
try { preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8')); } catch {}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start).catch(async error => {
    await dialog.showMessageBox({type: 'error', title: 'UT Stems', message: 'Could not start UT Stems.', detail: error.message});
    app.quit();
  });
}

async function start() {
  // The processing engine runs in the default Python, where ut_stems and PyTorch are installed.
  const python = process.env.UT_STEMS_PYTHON || 'python';
  const token = crypto.randomBytes(32).toString('hex');
  backend = spawn(python, ['-m', 'ut_stems.server'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, UT_STEMS_TOKEN: token, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1'}});
  let errors = '';
  backend.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4000); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The processing engine did not start in time.')), 30000);
    const lines = readline.createInterface({input: backend.stdout});
    lines.on('line', line => {
      try { const message = JSON.parse(line); if (message.port) { clearTimeout(timer); resolve(message.port); } } catch {}
    });
    backend.once('error', error => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT' ? new Error('Python was not found. Install Python 3.10 or newer and follow the setup steps in README.md.') : error);
    });
    backend.once('exit', code => { clearTimeout(timer); reject(new Error(errors || `Processing engine exited (${code}).`)); });
  });
  origin = `http://127.0.0.1:${port}`;
  window = new BrowserWindow({width: 1320, height: 860, minWidth: 390, minHeight: 620,
    title: 'UT Stems', backgroundColor: '#0e1817', autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  function checkCaller(event) {
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Invalid caller.');
  }
  ipcMain.handle('get-preferences', event => { checkCaller(event); return preferences; });
  ipcMain.handle('set-preferences', (event, values) => {
    checkCaller(event);
    const next = {
      stems: Array.isArray(values?.stems) ? values.stems.filter(stem => typeof stem === 'string').slice(0, 12) : [],
      output: typeof values?.output === 'string' ? values.output.slice(0, 1000) : '',
      model: typeof values?.model === 'string' ? values.model.slice(0, 60) : '',
      overlap: typeof values?.overlap === 'string' ? values.overlap.slice(0, 4) : '',
    };
    const temporary = preferencesPath + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(next), 'utf8'); fs.renameSync(temporary, preferencesPath); preferences = next; }
    finally { fs.rmSync(temporary, {force: true}); }
  });
  ipcMain.handle('choose-file', async event => {
    checkCaller(event);
    const result = await dialog.showOpenDialog(window, {properties: ['openFile'],
      filters: [{name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma']}, {name: 'All files', extensions: ['*']}]});
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('choose-folder', async (event, current) => {
    checkCaller(event);
    const defaultPath = typeof current === 'string' && fs.existsSync(current) ? current : undefined;
    const result = await dialog.showOpenDialog(window, {properties: ['openDirectory', 'createDirectory'], defaultPath});
    return result.canceled ? null : result.filePaths[0];
  });
  await window.loadURL(`${origin}/#${token}`);
}

app.on('before-quit', () => {
  if (backend && !backend.killed && backend.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(backend.pid), '/t', '/f'], {windowsHide: true, stdio: 'ignore'});
    else backend.kill();
  }
});
app.on('window-all-closed', () => app.quit());
