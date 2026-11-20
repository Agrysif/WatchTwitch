// Перенос входа в Twitch со старой базы cookie (Electron 28, формат 19) на
// новый Electron. Без него новый Chromium при переводе базы на свой формат
// удалял все cookie, и после обновления у каждого пропадал вход.
//
//   node tests/run-electron.cjs tests/cookie-migration.cjs
//
// Эталон базы — tests/fixtures/twitch-cookies-electron28.db: создан
// Electron 28, вход выдуманный. Одна cookie в нём с истёкшим сроком.
const { app, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const migration = require('../cookie-migration');

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cookie-migration-'));
app.setPath('userData', ud);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
const dbDir = path.join(ud, 'Partitions', 'twitch', 'Network');
fs.mkdirSync(dbDir, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'fixtures', 'twitch-cookies-electron28.db'), path.join(dbDir, 'Cookies'));

// Как в main.js: до готовности приложения
const stashed = migration.stash(ud);

const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

app.whenReady().then(async () => {
  try {
    expect(stashed && stashed.version === 19, 'база формата 19 не прочитана');
    expect(stashed && stashed.cookies.length === 4, 'к переносу не 4 cookie (истёкшая должна пропасть): ' + (stashed && stashed.cookies.length));
    const twitch = session.fromPartition('persist:twitch');
    const restored = await migration.restore(ud, twitch, stashed);
    expect(restored === 4, 'перенесено ' + restored + ' из 4');

    const get = async (url, name) => (await twitch.cookies.get({ url, name }))[0];
    const auth = await get('https://www.twitch.tv', 'auth-token');
    expect(auth && auth.value === 'testtoken0123456789abcdefghijkl', 'auth-token не тот');
    expect(auth && auth.domain === '.twitch.tv' && auth.secure, 'auth-token: домен или secure не те');
    expect(!!(await get('https://player.twitch.tv', 'auth-token')), 'auth-token не виден плееру');
    const hostOnly = await get('https://www.twitch.tv', 'host_only');
    expect(hostOnly && hostOnly.hostOnly && hostOnly.httpOnly && hostOnly.sameSite === 'strict', 'host_only: флаги не сохранились');
    expect(!(await get('https://www.twitch.tv', 'expired')), 'истёкшая cookie перенесена');
    expect(!!(await get('https://www.twitch.tv', 'login')), 'login не перенесён');

    const marker = JSON.parse(fs.readFileSync(path.join(ud, migration.MARKER), 'utf8'));
    expect(marker.reason === 'restored' && marker.restored === 4, 'отметка переноса не та');
    // Повторный запуск: отметка есть — ничего не читаем
    expect(migration.stash(ud) === null, 'перенос повторился');

    if (problems.length) console.log('TEST cookie migration FAIL', JSON.stringify(problems));
    else console.log('TEST cookie migration PASS', JSON.stringify({ electron: process.versions.electron, restored }));
    app.exit(problems.length ? 1 : 0);
  } catch (error) {
    console.log('TEST cookie migration FAIL', error && error.stack || error);
    app.exit(1);
  }
});
setTimeout(() => { console.log('TEST cookie migration FAIL timeout'); app.exit(2); }, 30000);
