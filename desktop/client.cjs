// UT Stems Client: the same window as the desktop app, but the songs are separated on another
// PC that runs the UT Stems Server (python -m ut_stems.remote, or ut_stems_server.bat).
//
// The first time, the client looks for a server on this network (a UDP broadcast), or takes
// its address, and asks to register; the server PC answers in a window. The server's
// certificate is pinned at that moment and the key the server hands out is kept encrypted
// with Windows' data protection. After that the client connects straight away.
const {app, BrowserWindow, ipcMain, dialog, shell, safeStorage} = require('electron');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');

const PORT = 47900;
const DISCOVER = Buffer.from('UT-STEMS-DISCOVER 1');

const profile = app.commandLine.getSwitchValue('user-data-dir');
app.setName('UT Stems Client');
app.setPath('userData', profile ? path.resolve(profile) : path.join(app.getPath('appData'), 'UT Stems Client'));
fs.mkdirSync(app.getPath('userData'), {recursive: true});
const configPath = path.join(app.getPath('userData'), 'client.json');
const preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
const savedPath = path.join(app.getPath('userData'), 'saved.json');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, value) {
  const temporary = file + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(value), 'utf8'); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, {force: true}); }
}
let config = readJson(configPath, {});
let preferences = readJson(preferencesPath, {});
let saved = readJson(savedPath, {});  // "<server boot>:<song id>" -> local folder of the saved files
let window = null;
let mode = null;  // 'setup' or 'main'
let origin = null;

// ---------------------------------------------------------------- the server connection
const fingerprintOf = der => crypto.createHash('sha256').update(der).digest('hex');
const pemOf = der => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
const confirmationCode = (request, fingerprint) =>
  String(crypto.createHash('sha256').update(`${request}:${fingerprint}`).digest().readUInt32BE(0) % 10000).padStart(4, '0');

function parseAddress(text) {
  const cleaned = String(text || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const match = cleaned.match(/^\[?([^\]]+?)\]?(?::(\d{1,5}))?$/);
  if (!cleaned || !match) throw new Error('Type the server address, for example 210.96.103.95');
  return {host: match[1], port: match[2] ? Number(match[2]) : PORT};
}

/** The server's certificate, read without trusting it yet (the first contact, which pins it). */
function peekCertificate(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({host, port, rejectUnauthorized: false, servername: undefined, timeout: 6000}, () => {
      const der = socket.getPeerCertificate(true).raw;
      socket.end();
      if (!der) reject(new Error('The server sent no certificate.'));
      else resolve({pem: pemOf(der), fingerprint: fingerprintOf(der)});
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error(`No answer from ${host}:${port}.`)); });
    socket.on('error', error => reject(new Error(`Cannot reach ${host}:${port} (${error.code || error.message}).`)));
  });
}

/** One HTTPS request to the pinned server. ``body`` is a Buffer, a file path ({file}) or an object (JSON). */
function request(server, method, route, {token, body, onProgress, toFile, timeout = 30000} = {}) {
  return new Promise((resolve, reject) => {
    let payload = null, length = 0;
    if (body && body.file) length = fs.statSync(body.file).size;
    else if (body !== undefined) { payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)); length = payload.length; }
    const headers = {'Content-Length': String(length)};
    if (token) headers['X-Session-Token'] = token;
    if (payload && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json';
    const req = https.request({
      host: server.host, port: server.port, method, path: route, headers, timeout,
      ca: server.pem, servername: '',
      // Pinned: only the certificate seen when this PC registered is accepted, whatever the address.
      checkServerIdentity: (_host, certificate) => fingerprintOf(certificate.raw) === server.fingerprint ? undefined
        : new Error('The server presented a different certificate. Register again if the server was reinstalled.'),
    }, response => {
      if (toFile && response.statusCode === 200) {
        const temporary = toFile + '.part';
        const out = fs.createWriteStream(temporary);
        response.pipe(out);
        out.on('finish', () => { try { fs.renameSync(temporary, toFile); resolve({status: 200}); } catch (error) { reject(error); } });
        out.on('error', error => { fs.rmSync(temporary, {force: true}); reject(error); });
        response.on('error', error => { out.destroy(); fs.rmSync(temporary, {force: true}); reject(error); });
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        let data = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch {}
        resolve({status: response.statusCode, data});
      });
    });
    req.on('timeout', () => req.destroy(new Error('The server stopped answering.')));
    req.on('error', reject);
    if (body && body.file) {
      let sent = 0;
      const input = fs.createReadStream(body.file);
      input.on('data', chunk => { sent += chunk.length; onProgress?.(sent / length); });
      input.on('error', error => req.destroy(error));
      input.pipe(req);
    } else req.end(payload ?? undefined);
  });
}

function savedServer() {
  const server = config.server;
  if (!server?.token || !server.pem) return null;
  try {
    const token = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(server.token, 'base64')) : server.token;
    return {...server, token};
  } catch { return null; }
}

function saveServer(server) {
  const token = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(server.token).toString('base64') : server.token;
  config = {server: {host: server.host, port: server.port, name: server.name, fingerprint: server.fingerprint, pem: server.pem, token}};
  writeJson(configPath, config);
}

/** Servers that answer a broadcast on this network within ``wait`` ms. */
function discover(wait = 1500) {
  return new Promise(resolve => {
    const found = new Map();
    const socket = dgram.createSocket({type: 'udp4', reuseAddr: true});
    const finish = () => { try { socket.close(); } catch {} resolve([...found.values()]); };
    socket.on('error', finish);
    socket.on('message', (message, sender) => {
      try {
        const reply = JSON.parse(message.toString('utf8'));
        if (reply.service === 'ut-stems' && /^[0-9a-f]{64}$/.test(reply.fingerprint) && !found.has(reply.fingerprint)) {
          found.set(reply.fingerprint, {host: sender.address, port: Number(reply.port) || PORT, name: String(reply.name || sender.address).slice(0, 60), fingerprint: reply.fingerprint});
        }
      } catch {}
    });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      const targets = new Set(['255.255.255.255']);
      for (const list of Object.values(os.networkInterfaces())) {
        for (const entry of list || []) {
          if (entry.family !== 'IPv4' || entry.internal) continue;
          const ip = entry.address.split('.').map(Number), mask = entry.netmask.split('.').map(Number);
          targets.add(ip.map((part, i) => (part | (~mask[i] & 255))).join('.'));
        }
      }
      for (const target of targets) socket.send(DISCOVER, PORT, target, () => {});
      setTimeout(finish, wait);
    });
  });
}

// ---------------------------------------------------------------- windows
function createWindow() {
  window = new BrowserWindow({width: 1320, height: 860, minWidth: 390, minHeight: 620,
    title: 'UT Stems Client', backgroundColor: '#0e1817', autoHideMenuBar: true, show: false,
    webPreferences: {preload: path.join(__dirname, 'client-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  window.setMenu(null);
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', (event, url) => {
    if (mode !== 'main' || new URL(url).origin !== origin) event.preventDefault();
  });
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  // The page, its API calls and the audio players accept only the pinned certificate.
  session.setCertificateVerifyProc((req, callback) => {
    const server = config.server;
    if (!server) return callback(-2);
    const der = Buffer.from(req.certificate.data.replace(/-----[^-]+-----|\s/g, ''), 'base64');
    callback(fingerprintOf(der) === server.fingerprint ? 0 : -2);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (mode === 'main' && url.startsWith(origin)) showSetup(`Lost the connection to the server (${description}).`);
  });
}

function showSetup(message = '') {
  mode = 'setup';
  origin = null;
  window.loadFile(path.join(__dirname, 'setup.html'), {hash: encodeURIComponent(message)});
}

async function showMain(server) {
  mode = 'main';
  origin = `https://${server.host.includes(':') ? `[${server.host}]` : server.host}:${server.port}`;
  await window.loadURL(`${origin}/#${server.token}`);
}

/** Connect with the saved key; follow the server to a new address on this network if it moved. */
async function connectSaved() {
  const server = savedServer();
  if (!server) return showSetup();
  let answer;
  try {
    answer = await request(server, 'GET', '/api/state', {token: server.token, timeout: 8000});
  } catch (error) {
    const moved = (await discover()).find(found => found.fingerprint === server.fingerprint);
    if (moved && (moved.host !== server.host || moved.port !== server.port)) {
      const next = {...server, host: moved.host, port: moved.port};
      saveServer(next);
      return connectSaved();
    }
    return showSetup(`${error.message} The server PC may be off, or UT Stems Server is not running there.`);
  }
  if (answer.status === 403) {
    config = {};
    writeJson(configPath, config);
    return showSetup(`${server.name} no longer knows this PC. Register again.`);
  }
  if (answer.status !== 200) return showSetup(`The server answered ${answer.status}.`);
  return showMain(server);
}

// ---------------------------------------------------------------- setup page
let registering = null;  // {cancelled}

function setupCaller(event) {
  if (mode !== 'setup' || event.sender !== window?.webContents || !event.senderFrame.url.startsWith('file:')) throw new Error('Invalid caller.');
}

ipcMain.handle('setup-info', event => {
  setupCaller(event);
  const server = config.server;
  return {computer: os.hostname(), prefill: process.env.UT_STEMS_CLIENT_SERVER || '', saved: server ? {name: server.name, address: `${server.host}${server.port === PORT ? '' : `:${server.port}`}`} : null};
});
ipcMain.handle('setup-search', async event => { setupCaller(event); return discover(); });
ipcMain.handle('setup-retry', event => { setupCaller(event); connectSaved(); });
ipcMain.handle('setup-cancel', event => { setupCaller(event); if (registering) registering.cancelled = true; });
ipcMain.handle('setup-register', async (event, {address, fingerprint} = {}) => {
  setupCaller(event);
  const status = message => { if (!event.sender.isDestroyed()) event.sender.send('setup-status', message); };
  const job = registering = {cancelled: false};
  const {host, port} = parseAddress(address);
  status({state: 'working', text: `Connecting to ${host}…`});
  const certificate = await peekCertificate(host, port);
  if (fingerprint && certificate.fingerprint !== fingerprint) throw new Error('The server that answered is not the one that was found. Try again.');
  const server = {host, port, ...certificate};
  const hello = await request(server, 'GET', '/api/hello');
  if (hello.status !== 200 || hello.data?.service !== 'ut-stems') throw new Error(`${host} is not a UT Stems server.`);
  server.name = String(hello.data.name || host).slice(0, 60);
  const ask = await request(server, 'POST', '/api/register', {body: {name: os.hostname()}});
  if (ask.status !== 200) throw new Error(ask.data?.error || `The server answered ${ask.status}.`);
  const code = confirmationCode(ask.data.request, server.fingerprint);
  status({state: 'waiting', text: `Waiting for an answer on ${server.name}.`, code});
  const until = Date.now() + 5 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (job.cancelled) throw new Error('Cancelled.');
    const poll = await request(server, 'GET', `/api/register?request=${encodeURIComponent(ask.data.request)}`);
    const answer = poll.data?.status;
    if (answer === 'approved' && poll.data.token) {
      saveServer({...server, token: poll.data.token});
      status({state: 'done', text: `Registered with ${server.name}.`});
      await showMain({...server, token: poll.data.token});
      return true;
    }
    if (answer === 'denied') throw new Error(`${server.name} turned the request down.`);
    if (answer !== 'pending') throw new Error('The request ran out. Try again.');
  }
  throw new Error('Nobody answered on the server PC. Try again.');
});

// ---------------------------------------------------------------- main window (the server's page)
function mainCaller(event) {
  if (mode !== 'main' || event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Invalid caller.');
  const server = savedServer();
  if (!server) throw new Error('Not connected.');
  return server;
}
const plainName = name => typeof name === 'string' && name === path.basename(name) && /\.mp3$/i.test(name) && !/[\\/:*?"<>|]/.test(name);

ipcMain.handle('get-preferences', event => { mainCaller(event); return preferences; });
ipcMain.handle('set-preferences', (event, values) => {
  mainCaller(event);
  preferences = {
    stems: Array.isArray(values?.stems) ? values.stems.filter(stem => typeof stem === 'string').slice(0, 12) : [],
    output: typeof values?.output === 'string' ? values.output.slice(0, 1000) : '',
    model: typeof values?.model === 'string' ? values.model.slice(0, 60) : '',
    overlap: typeof values?.overlap === 'string' ? values.overlap.slice(0, 4) : '',
    autoTitle: values?.autoTitle !== false,
    keepOriginal: values?.keepOriginal !== false,
  };
  writeJson(preferencesPath, preferences);
});
ipcMain.handle('choose-files', async event => {
  mainCaller(event);
  const result = await dialog.showOpenDialog(window, {properties: ['openFile', 'multiSelections'],
    filters: [{name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma']}, {name: 'All files', extensions: ['*']}]});
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('choose-folder', async (event, current) => {
  mainCaller(event);
  const defaultPath = typeof current === 'string' && fs.existsSync(current) ? current : undefined;
  const result = await dialog.showOpenDialog(window, {properties: ['openDirectory', 'createDirectory'], defaultPath});
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('server-info', event => {
  const server = mainCaller(event);
  return {name: server.name, address: server.host, defaultOutput: path.join(app.getPath('music'), 'UT Stems')};
});
ipcMain.handle('forget-server', async event => {
  mainCaller(event);
  const choice = await dialog.showMessageBox(window, {type: 'question', buttons: ['Disconnect', 'Cancel'], defaultId: 1, cancelId: 1,
    title: 'UT Stems Client', message: `Disconnect from ${config.server?.name}?`, detail: 'This PC will have to be registered again to use that server.'});
  if (choice.response !== 0) return false;
  config = {};
  writeJson(configPath, config);
  showSetup();
  return true;
});

ipcMain.handle('upload-files', async (event, paths) => {
  const server = mainCaller(event);
  if (!Array.isArray(paths)) throw new Error('Expected a list of files.');
  const added = [], errors = [];
  for (const [index, file] of paths.entries()) {
    const name = path.basename(String(file));
    try {
      if (!fs.statSync(file).isFile()) throw new Error('not a file');
      const answer = await request(server, 'POST', `/api/upload?name=${encodeURIComponent(name)}`, {
        token: server.token, body: {file}, timeout: 120000,
        onProgress: fraction => event.sender.send('upload-progress', {name, index, count: paths.length, fraction}),
      });
      if (answer.status !== 200) throw new Error(answer.data?.error || `the server answered ${answer.status}`);
      added.push(answer.data.id);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  event.sender.send('upload-progress', null);
  return {added, errors};
});

/** Download the files of a finished song into a folder on this PC. */
ipcMain.handle('save-result', async (event, {key, id, folder}) => {
  const server = mainCaller(event);
  if (typeof key !== 'string' || !path.isAbsolute(String(folder || ''))) throw new Error('Choose an output folder.');
  const result = await request(server, 'GET', `/api/result?id=${encodeURIComponent(id)}`, {token: server.token});
  if (result.status !== 200) throw new Error(result.data?.error || 'The song has no result.');
  const files = result.data.stems.map(stem => stem.file).concat(result.data.original ? [result.data.original] : []);
  fs.mkdirSync(folder, {recursive: true});
  for (const file of files) {
    if (!plainName(file)) continue;
    const answer = await request(server, 'GET', `/api/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(file)}`,
      {token: server.token, toFile: path.join(folder, file), timeout: 120000});
    if (answer.status !== 200) throw new Error(`Could not download ${file}.`);
  }
  saved[key] = folder;
  writeJson(savedPath, saved);
  return {folder, files};
});
ipcMain.handle('saved-folder', (event, key) => { mainCaller(event); return saved[key] ?? null; });

/** Rename the saved copies after the song was renamed on the server. */
ipcMain.handle('rename-local', (event, {key, pairs}) => {
  mainCaller(event);
  const folder = saved[key];
  if (!folder || !Array.isArray(pairs)) return 0;
  let renamed = 0;
  for (const [from, to] of pairs) {
    if (!plainName(from) || !plainName(to) || from === to) continue;
    const source = path.join(folder, from), target = path.join(folder, to);
    const sameFile = from.toLowerCase() === to.toLowerCase();
    if (!fs.existsSync(source) || (fs.existsSync(target) && !sameFile)) continue;
    fs.renameSync(source, target);
    renamed += 1;
  }
  return renamed;
});
ipcMain.handle('open-local-folder', async (event, key) => {
  mainCaller(event);
  const folder = saved[key];
  if (!folder || !fs.existsSync(folder)) throw new Error('The files have not been saved on this PC yet.');
  const problem = await shell.openPath(folder);
  if (problem) throw new Error(problem);
});

// ---------------------------------------------------------------- start
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(() => {
    createWindow();
    if (process.env.UT_STEMS_CLIENT_SERVER && !config.server) return showSetup();
    return connectSaved();
  }).catch(async error => {
    await dialog.showMessageBox({type: 'error', title: 'UT Stems Client', message: 'Could not start UT Stems Client.', detail: error.message});
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
