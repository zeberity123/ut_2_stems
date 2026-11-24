// All access to the local server and the desktop shell lives here.
// In the desktop app the page comes from the shell and the engine runs elsewhere on this PC
// (``connect`` asks the shell where); in a browser the engine serves the page itself.
export class StemsAPI {
  constructor() {
    this.base = '';
    this.token = location.hash.slice(1) || sessionStorage.getItem('ut-stems-session') || '';
    if (this.token) sessionStorage.setItem('ut-stems-session', this.token);
    history.replaceState(null, '', location.pathname);
    this.desktop = window.desktop ?? null;
    // In UT Stems Client the songs are separated on another PC and saved on this one.
    this.remote = Boolean(this.desktop?.remote);
  }
  async connect() {
    const engine = this.desktop?.engineInfo ? await this.desktop.engineInfo() : null;
    if (engine?.url) { this.base = engine.url.replace(/\/$/, ''); this.token = engine.token; }
  }
  url(path, values = {}) {
    return `${this.base}/api/${path}?${new URLSearchParams({token: this.token, ...values})}`;
  }
  async request(path, options = {}) {
    if (this.desktop?.engineFetch) {
      // The desktop shell carries the call to the engine (see engine_fetch in the shell).
      const relayed = await this.desktop.engineFetch(path, options.method || 'GET', options.body ?? null);
      let result = null;
      try { result = JSON.parse(relayed.body || 'null'); } catch {}
      if (relayed.status < 200 || relayed.status >= 300) throw new Error(result?.error || 'The operation could not be completed.');
      return result;
    }
    const response = await fetch(`${this.base}/api/${path}`, {
      ...options, headers: {'X-Session-Token': this.token, ...options.headers},
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The operation could not be completed.');
    return result;
  }
  state() { return this.request('state'); }
  result(id) { return this.request(`result?${new URLSearchParams({id})}`); }
  command(action, values = {}) {
    return this.request('command', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action, ...values})});
  }
  audioUrl(id, stem) { return this.url('audio', {id, stem}); }
  async chooseFiles() { return (await this.desktop?.chooseFiles()) ?? []; }
  async chooseFolder(current) { return this.desktop?.chooseFolder(current) ?? null; }
  pathForFile(file) { return this.desktop?.pathForFile(file) ?? ''; }
  // Tauri reports dragged files with their paths; Electron goes through the HTML drop event.
  onDrop(listener) { if (this.desktop?.onDrop) { this.desktop.onDrop(listener); return true; } return false; }
  async preferences() { return (await this.desktop?.getPreferences()) ?? {}; }
  savePreferences(values) { return this.desktop?.setPreferences(values); }
  // Updates (Tauri shell only)
  pendingUpdate() { return this.desktop?.pendingUpdate ? this.desktop.pendingUpdate() : Promise.resolve(null); }
  onUpdate(listener) { this.desktop?.onUpdate?.(listener); }
  installUpdate() { return this.desktop.installUpdate(); }
  openReleasePage() { return this.desktop.openReleasePage(); }
  // UT Stems Client only
  serverInfo() { return this.desktop.serverInfo(); }
  forgetServer() { return this.desktop.forgetServer(); }
  uploadFiles(paths) { return this.desktop.uploadFiles(paths); }
  onUploadProgress(callback) { this.desktop?.onUploadProgress?.(callback); }
  saveResult(values) { return this.desktop.saveResult(values); }
  savedFolder(key) { return this.desktop.savedFolder(key); }
  renameLocal(values) { return this.desktop.renameLocal(values); }
  openLocalFolder(key) { return this.desktop.openLocalFolder(key); }
}
