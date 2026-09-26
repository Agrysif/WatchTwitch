// Uses the actual packaged updater from the previous release, isolated from user data.
// Default: local release server. WT_TEST_GITHUB=1: public production GitHub feed.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'watchtwitch-update-test-'));
app.setPath('userData', profile);
const archive = path.join(root, 'dist/audit-old-1.0.22.asar');
const previous = require(path.join(archive, 'package.json'));
const { NsisUpdater } = require(path.join(archive, 'node_modules/electron-updater/out/NsisUpdater'));
const { ElectronHttpExecutor } = require(path.join(archive, 'node_modules/electron-updater/out/electronHttpExecutor'));
const expected = require('../package.json').version;
const github = process.env.WT_TEST_GITHUB === '1';
const full = process.env.WT_TEST_FULL_DOWNLOAD === '1';
const yaml = require('js-yaml');
const configPath = path.join(root, 'dist/audit-old-app-update.yml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
const adapter = {
  version: previous.version, name: 'watchtwitch', isPackaged: true,
  userDataPath: profile, baseCachePath: profile, appUpdateConfigPath: configPath,
  whenReady: () => app.whenReady(), onQuit() {}, quit() {}, relaunch() {}
};
const sha512 = file => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
app.whenReady().then(async () => {
  let server;
  let feed = config;
  if (!github) {
    server = http.createServer((request, response) => {
      const name = path.basename(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
      const file = path.join(root, 'dist', name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
      const size = fs.statSync(file).size;
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : size - 1;
        response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(file, { start, end }).pipe(response);
      } else {
        response.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(file).pipe(response);
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    feed = { provider: 'generic', url: `http://127.0.0.1:${server.address().port}/`, useMultipleRangeRequest: false };
  }
  const updater = new NsisUpdater(null, adapter);
  updater.httpExecutor = new ElectronHttpExecutor();
  updater.setFeedURL(feed);
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = full;
  updater.logger = console;
  const cache = path.join(profile, config.updaterCacheDirName);
  fs.mkdirSync(cache, { recursive: true });
  if (!full) fs.copyFileSync(path.join(root, `dist/WatchTwitch-Setup-${previous.version}.exe`), path.join(cache, 'installer.exe'));
  let downloaded = false;
  updater.on('update-downloaded', () => { downloaded = true; });
  const result = await updater.checkForUpdates();
  if (result?.updateInfo?.version !== expected) throw Error(`Expected ${expected}, got ${result?.updateInfo?.version}`);
  const files = await updater.downloadUpdate();
  const local = path.join(root, `dist/WatchTwitch-Setup-${expected}.exe`);
  if (!downloaded || !files?.length || sha512(files[0]) !== sha512(local)) throw Error('Downloaded installer mismatch');
  console.log('TEST old updater compatibility PASS', JSON.stringify({
    from: previous.version, to: expected, provider: github ? 'public GitHub' : 'local staging',
    mode: full ? 'full' : 'differential with fallback', downloadedEvent: downloaded,
    sha512: sha512(files[0]), bytes: fs.statSync(files[0]).size,
    installed: false
  }));
  server?.close();
  app.exit(0);
}).catch(error => { console.error('TEST updater compatibility FAIL', error); app.exit(1); });
setTimeout(() => { console.error('TEST updater timed out'); app.exit(2); }, 85000);
