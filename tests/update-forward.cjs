// Обновление ИЗ текущей сборки: модуль обновлений собранного приложения
// (dist/win-unpacked) на его версии Electron находит следующий выпуск,
// скачивает его и сверяет SHA-512. update-compatibility.cjs проверяет путь
// со старой версии на эту; здесь — что и следующие обновления дойдут.
//
//   node tests/run-electron.cjs tests/update-forward.cjs
//
// «Следующий выпуск» — тот же установщик под номером на патч выше, на
// локальном сервере. Установка не запускается.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'watchtwitch-update-forward-'));
app.setPath('userData', profile);
const asar = path.join(root, 'dist/win-unpacked/resources/app.asar');
const current = require(path.join(asar, 'package.json')).version;
const { NsisUpdater } = require(path.join(asar, 'node_modules/electron-updater/out/NsisUpdater'));
const { ElectronHttpExecutor } = require(path.join(asar, 'node_modules/electron-updater/out/electronHttpExecutor'));
const yaml = require('js-yaml');

const [major, minor, patch] = current.split('.').map(Number);
const next = `${major}.${minor}.${patch + 1}`;
const installer = path.join(root, `dist/WatchTwitch-Setup-${current}.exe`);
const sha512 = file => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');

// Каталог «сервера обновлений» со следующим выпуском
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'watchtwitch-update-staging-'));
const nextName = `WatchTwitch-Setup-${next}.exe`;
fs.copyFileSync(installer, path.join(staging, nextName));
fs.copyFileSync(installer + '.blockmap', path.join(staging, nextName + '.blockmap'));
fs.copyFileSync(installer + '.blockmap', path.join(staging, `WatchTwitch-Setup-${current}.exe.blockmap`));
const hash = sha512(installer);
const size = fs.statSync(installer).size;
fs.writeFileSync(path.join(staging, 'latest.yml'), yaml.dump({
  version: next, files: [{ url: nextName, sha512: hash, size }], path: nextName, sha512: hash,
  releaseDate: new Date().toISOString()
}));

const configPath = path.join(profile, 'app-update.yml');
fs.writeFileSync(configPath, yaml.dump({ provider: 'generic', url: 'http://127.0.0.1/', updaterCacheDirName: 'watchtwitch-updater' }));

app.whenReady().then(async () => {
  const server = http.createServer((request, response) => {
    const file = path.join(staging, path.basename(decodeURIComponent(new URL(request.url, 'http://localhost').pathname)));
    if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    const total = fs.statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : total - 1;
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file, { start, end }).pipe(response);
    } else {
      response.writeHead(200, { 'Content-Length': total, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).pipe(response);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const results = [];
  for (const full of [false, true]) {
    const cacheProfile = fs.mkdtempSync(path.join(profile, full ? 'full-' : 'diff-'));
    const updater = new NsisUpdater(null, {
      version: current, name: 'watchtwitch', isPackaged: true,
      userDataPath: cacheProfile, baseCachePath: cacheProfile, appUpdateConfigPath: configPath,
      whenReady: () => app.whenReady(), onQuit() {}, quit() {}, relaunch() {}
    });
    updater.httpExecutor = new ElectronHttpExecutor();
    updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}/`, useMultipleRangeRequest: false });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.disableDifferentialDownload = full;
    updater.logger = { info() {}, warn() {}, error: console.error, debug() {} };
    // Для частичной загрузки нужен установщик текущей версии в кэше
    const cache = path.join(cacheProfile, 'watchtwitch-updater');
    fs.mkdirSync(cache, { recursive: true });
    if (!full) fs.copyFileSync(installer, path.join(cache, 'installer.exe'));
    let downloaded = false;
    updater.on('update-downloaded', () => { downloaded = true; });
    const check = await updater.checkForUpdates();
    if (check?.updateInfo?.version !== next) throw Error(`ожидалась ${next}, пришла ${check?.updateInfo?.version}`);
    const files = await updater.downloadUpdate();
    if (!downloaded || !files?.length || sha512(files[0]) !== hash) throw Error('скачанный установщик не совпал');
    results.push(full ? 'full' : 'differential');
  }
  console.log('TEST update forward PASS', JSON.stringify({ electron: process.versions.electron, from: current, to: next, modes: results, installed: false }));
  server.close();
  app.exit(0);
}).catch(error => { console.error('TEST update forward FAIL', error); app.exit(1); });
setTimeout(() => { console.error('TEST update forward timed out'); app.exit(2); }, 85000);
