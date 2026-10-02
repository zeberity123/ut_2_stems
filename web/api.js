// All access to the local server and the desktop shell lives here.
export class StemsAPI {
  constructor() {
    this.token = location.hash.slice(1) || sessionStorage.getItem('ut-stems-session') || '';
    if (this.token) sessionStorage.setItem('ut-stems-session', this.token);
    history.replaceState(null, '', location.pathname);
    this.desktop = window.desktop ?? null;
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
}
