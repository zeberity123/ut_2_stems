// All access to the local server and the desktop shell lives here.
export class StemsAPI {
  constructor() {
    this.token = location.hash.slice(1) || sessionStorage.getItem('ut-stems-session') || '';
    if (this.token) sessionStorage.setItem('ut-stems-session', this.token);
    history.replaceState(null, '', location.pathname);
    this.desktop = window.desktop ?? null;
    // In UT Stems Client the songs are separated on another PC and saved on this one.
    this.remote = Boolean(this.desktop?.remote);
  }
  url(path, values = {}) {
    return `/api/${path}?${new URLSearchParams({token: this.token, ...values})}`;
  }
  async request(path, options = {}) {
    const response = await fetch(`/api/${path}`, {
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
  async preferences() { return (await this.desktop?.getPreferences()) ?? {}; }
  savePreferences(values) { return this.desktop?.setPreferences(values); }
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
