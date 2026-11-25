const { app, BrowserWindow, session, webContents } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cold-tray-')));
app.setAppPath(root);
process.argv.push('--autostart');
new (require('electron-store'))().set('settings.minimizeToTray', true);
require('electron-updater').autoUpdater.checkForUpdates = async () => null;
const shown = new WeakSet();
app.on('browser-window-created', (_event, win) => win.on('show', () => shown.add(win)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const movie = fs.readFileSync(path.join(__dirname, 'fixtures', 'tray.webm'));
  const server = http.createServer((req, res) => {
    if (req.url === '/movie') {
      res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': movie.length });
      res.end(movie);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<video muted loop preload="auto" src="/movie"></video>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html'));
  assert.ok(win, 'autostart main window exists');
  session.fromPartition('persist:twitch').webRequest.onBeforeRequest(
    { urls: ['https://player.twitch.tv/*'] }, (_details, done) => done({ redirectURL: url })
  );
  // Supply the channel discovery result, without a Twitch login or any UI input.
  await win.webContents.executeJavaScript('window.playerManager.load("fixture"); true');
  let samples = 0;
  let last = null;
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    assert.ok(!shown.has(win) && !win.isVisible(), 'window must never be shown');
    const guest = webContents.getAllWebContents().find(w => w.getURL() === url);
    if (!guest) continue;
    const state = await guest.executeJavaScript('(() => { const v=document.querySelector("video"); return v && {paused:v.paused,t:v.currentTime}; })()');
    if (state && !state.paused && last !== null && state.t !== last) samples++;
    if (samples >= 4) {
      console.log('PASS cold tray launch: decoded video advances without showing the window');
      return;
    }
    last = state?.t ?? null;
  }
  throw Error('No advancing video in never-shown window');
}
require(path.join(root, 'main.js'));
app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    run().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
  });
});
setTimeout(() => { console.error('Cold tray launch timed out'); app.exit(1); }, 65000);
