// Renders web/icon.svg to packaging/icon.ico with Electron:  electron packaging/make-icon.cjs
const {app, BrowserWindow, nativeImage} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const {size, png} of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); entry.writeUInt8(0, 3); entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(offset, 12);
    entries.push(entry); offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.png)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'web', 'icon.svg'), 'utf8');
  const html = `<!doctype html><html><body style="margin:0;background:transparent">` +
    `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="256" height="256" style="display:block"></body></html>`;
  const win = new BrowserWindow({show: false, width: 256, height: 256, transparent: true, frame: false,
    useContentSize: true, webPreferences: {offscreen: true}});
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise(resolve => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({x: 0, y: 0, width: 256, height: 256});
  const pngs = SIZES.map(size => ({size, png: image.resize({width: size, height: size, quality: 'best'}).toPNG()}));
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico(pngs));
  console.log('wrote packaging/icon.ico', image.getSize());
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
