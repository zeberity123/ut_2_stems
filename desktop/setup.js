// The setup page of UT Stems Client: find or type the server, then register with it.
const $ = id => document.getElementById(id);
const clean = error => String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function notice(text) {
  $('notice').hidden = !text;
  $('notice').textContent = text || '';
}

function waiting(on) {
  $('choose').hidden = on;
  $('waiting').hidden = !on;
  if (!on) $('code-box').hidden = true;
}

async function register(address, fingerprint) {
  notice('');
  waiting(true);
  $('waiting-title').textContent = `Connecting to ${address}…`;
  try {
    await window.setup.register({address, fingerprint});
  } catch (error) {
    waiting(false);
    notice(clean(error));
  }
}

async function search() {
  $('search').disabled = true;
  $('servers').replaceChildren(Object.assign(document.createElement('p'), {textContent: 'Searching…'}));
  const found = await window.setup.search().catch(() => []);
  $('search').disabled = false;
  if (!found.length) {
    $('servers').replaceChildren(Object.assign(document.createElement('p'), {
      textContent: 'No server answered on this network. If it is elsewhere, type its address below.'}));
    return;
  }
  $('servers').replaceChildren(...found.map(server => {
    const row = document.createElement('div');
    row.className = 'server';
    const text = document.createElement('div');
    const small = document.createElement('small');
    small.textContent = `${server.host}${server.port === 47900 ? '' : `:${server.port}`}`;
    text.append(server.name, small);
    const button = document.createElement('button');
    button.className = 'primary';
    button.textContent = 'Connect';
    button.addEventListener('click', () => register(`${server.host}:${server.port}`, server.fingerprint));
    row.append(text, button);
    return row;
  }));
}

window.setup.onStatus(status => {
  if (!status) return;
  $('waiting-title').textContent = status.text;
  if (status.code) { $('code').textContent = status.code; $('code-box').hidden = false; }
});

(async () => {
  const info = await window.setup.info();
  notice(decodeURIComponent(location.hash.slice(1)));
  $('computer').textContent = `This PC registers as “${info.computer}”. The server PC is asked once to allow it.`;
  if (info.saved) {
    $('saved').hidden = false;
    $('saved-name').textContent = `${info.saved.name} (${info.saved.address})`;
    $('address').value = info.saved.address;
  }
  if (info.prefill) $('address').value = info.prefill;
  $('retry').addEventListener('click', () => { notice(''); window.setup.retry(); });
  $('search').addEventListener('click', search);
  $('cancel').addEventListener('click', () => window.setup.cancel());
  $('manual').addEventListener('submit', event => {
    event.preventDefault();
    const address = $('address').value.trim();
    if (!address) { notice('Type the server address, for example 210.96.103.95'); return; }
    register(address);
  });
  search();
})();
