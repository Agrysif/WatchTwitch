'use strict';
// Демо-режим: настоящее окно WatchTwitch на выдуманных данных, без Twitch.
//
// Нужен для снимков экрана в README (screenshots.cjs) и для проверки
// перевода на живом интерфейсе (tests/i18n-runtime.cjs). Код приложения не
// меняется: main.js загружается как есть, а снаружи подменяется только то,
// что смотрит в мир, — обработчики IPC, которые ходят в Twitch, отвечают
// данными из demo-data.cjs, сеть режется (кроме обложек игр), плеер Twitch
// заменён нарисованным «кадром стрима».
//
// Профиль — новая временная папка. Настоящие данные пользователя
// (%APPDATA%\watchtwitch) не читаются и не пишутся: путь задаётся до
// загрузки main.js, как в tests/electron-smoke.cjs.
//
// Запуск (окно остаётся открытым, пока его не закроют):
//   node tools/demo/demo-app.cjs
//   node tests/run-electron.cjs tools/demo/demo-app.cjs   (закроется через 90 с)
// Переменные: WT_DEMO_LANG=en|ru, WT_DEMO_THEME=dark|light,
//   WT_DEMO_STYLE=ios27|classic, WT_DEMO_VERBOSE=1 — лог приложения в консоль.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const { createDemoState, ASSET_HOST, DEMO_VERSION, USER } = require('./demo-data.cjs');
const { avatarSvg, rewardSvg, svgDataUri, playerHtml } = require('./demo-assets.cjs');

const PROFILE_PREFIX = 'watchtwitch-demo-';
const SEED_PAGE = path.join(__dirname, 'seed.html');
const SIZE = { width: 1440, height: 900 };

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const pick = (value, allowed, fallback) => (allowed.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : fallback);

function options(overrides = {}) {
  const env = process.env;
  return {
    lang: pick(overrides.lang ?? env.WT_DEMO_LANG, ['en', 'ru'], 'en'),
    theme: pick(overrides.theme ?? env.WT_DEMO_THEME, ['dark', 'light'], 'dark'),
    style: pick(overrides.style ?? env.WT_DEMO_STYLE, ['ios27', 'classic'], 'ios27'),
    headless: overrides.headless ?? env.WT_DEMO_HEADLESS === '1',
    verbose: overrides.verbose ?? env.WT_DEMO_VERBOSE === '1',
    // Профиль: 'demo' — данные демо; 'empty' — только настройки, как после
    // первого входа без аккаунта; 'keep' — ничего не сеять (профиль уже
    // есть или нарочно пуст — проверка первого запуска);
    // 'legacy' — данные демо без выбранного языка, как у установки до 1.2.0
    profile: ['demo', 'empty', 'keep', 'legacy'].includes(overrides.profile) ? overrides.profile : 'demo',
    // Язык Windows для окна и main (--lang): проверка первого запуска
    locale: typeof overrides.locale === 'string' ? overrides.locale : null,
    // Показ подсказок первого запуска (по умолчанию скрыты)
    onboarding: !!overrides.onboarding,
    // Настоящие обработчики main вместо заглушек: уведомления (окно о
    // награде — за краем экрана, всплывашки Windows только записываются)
    // и перезапуск (app.relaunch только записывается)
    realNotifications: !!overrides.realNotifications,
    realRelaunch: !!overrides.realRelaunch
  };
}

// ─── запуск из обычного node ────────────────────────────────────────

/** true — скрипт запущен обычным node и Electron нужно поднять отдельно. */
function needsElectron() {
  return typeof require('electron') === 'string';
}

/**
 * Перезапускает скрипт под Electron и ждёт его. Профиль создаёт и удаляет
 * этот (внешний) процесс: изнутри Electron папку не стереть, её файлы
 * заняты до самого выхода.
 */
function relaunch(script, args = process.argv.slice(2)) {
  spawnElectron(script, args).then(code => process.exit(code));
}

/** Новая временная папка профиля (её удаляет тот, кто создал). */
function makeProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
}

/** Удаление временного профиля — только своего, с префиксом демо. */
function removeProfile(dir) {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(os.tmpdir())) || !path.basename(resolved).startsWith(PROFILE_PREFIX)) return;
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { /* остаётся во временной папке */ }
}

/**
 * Скрипт под Electron; промис — код выхода. Профиль — свой временный
 * (удаляется после выхода) или переданный: его не трогаем, им пользуется
 * следующий запуск (проверка перезапуска).
 */
function spawnElectron(script, args = [], { profile = null, env: extraEnv = {}, timeoutMs = 0 } = {}) {
  const { spawn } = require('child_process');
  const env = { ...process.env, ...extraEnv };
  // С этой переменной Electron работает как node и окна не откроет
  delete env.ELECTRON_RUN_AS_NODE;
  env.WT_DEMO_PROFILE = profile || makeProfile();
  return new Promise((resolve) => {
    const child = spawn(require('electron'), [script, ...args], { cwd: ROOT, env, stdio: 'inherit', windowsHide: false });
    const timer = timeoutMs > 0 ? setTimeout(() => child.kill(), timeoutMs) : null;
    const onSigint = () => child.kill();
    process.on('SIGINT', onSigint);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      process.off('SIGINT', onSigint);
      if (!profile) removeProfile(env.WT_DEMO_PROFILE);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function profileDir() {
  const given = process.env.WT_DEMO_PROFILE;
  const dir = given || fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  // Страховка: демо пишет в профиль что угодно, и это никогда не должна
  // быть папка настоящего приложения
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(os.tmpdir())) || !path.basename(resolved).startsWith(PROFILE_PREFIX)) {
    throw new Error('Демо-профиль вне временной папки: ' + resolved);
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

let cleanupScheduled = false;

/**
 * Профиль, созданный самим Electron (запуск через tests/run-electron.cjs),
 * стирает отдельный процесс через пару секунд после выхода: пока Electron
 * жив, файлы профиля заняты.
 */
function scheduleProfileCleanup(dir) {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  if (process.env.WT_DEMO_PROFILE || !path.basename(dir).startsWith(PROFILE_PREFIX)) return;
  try {
    const { spawn } = require('child_process');
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"ping -n 4 127.0.0.1 >nul & rmdir /s /q "${dir}""`],
        { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
      : spawn('sh', ['-c', `sleep 3; rm -rf "${dir}"`], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) { /* останется во временной папке */ }
}

// ─── перевод для данных, которые приложение пишет само ──────────────

/**
 * Тот же перевод, что в окне (renderer/js/locales/en) и в main
 * (i18n-main.js): записи журнала и ответы «как у main» сеются на языке демо.
 */
function makeTranslator(lang) {
  const has = Object.prototype.hasOwnProperty;
  const dict = {};
  if (lang === 'en') {
    try {
      Object.assign(dict, require(path.join(ROOT, 'i18n-main.js')).EN);
    } catch (e) { /* словаря main нет — останется русский */ }
    const dir = path.join(ROOT, 'renderer/js/locales/en');
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
      const sandbox = { window: {} };
      try {
        vm.runInNewContext(fs.readFileSync(path.join(dir, file), 'utf8'), sandbox, { filename: file });
        Object.assign(dict, sandbox.window.I18N_EN || {});
      } catch (e) { /* словарь правят прямо сейчас — пропускаем */ }
    }
  }
  return (ru, params) => {
    const text = has.call(dict, ru) ? dict[ru] : ru;
    return params ? text.replace(/\{(\w+)\}/g, (m, k) => (has.call(params, k) ? String(params[k]) : m)) : text;
  };
}

// ─── то, что не должно выйти за пределы демо ────────────────────────

function quietConsole(verbose) {
  if (verbose) return;
  // Лог main.js всё равно пишется в профиль (logs/app.log), а в консоли
  // остаются только строки демо
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = () => {};
}

const say = (...parts) => process.stdout.write(parts.join(' ') + '\n');

/** Запрос в сеть из main, который демо не пропускает: ошибка, как при обрыве. */
function blockedRequest(host) {
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    process.nextTick(() => {
      if (req.listenerCount('error')) req.emit('error', Object.assign(new Error('demo: network is off (' + host + ')'), { code: 'EDEMO' }));
      req.emit('close');
    });
  };
  Object.assign(req, {
    write: () => true,
    end: () => { fail(); return req; },
    destroy: () => { fail(); return req; },
    abort: () => fail(),
    setTimeout: () => req,
    setHeader: () => {},
    getHeader: () => undefined,
    removeHeader: () => {},
    setNoDelay: () => {},
    setSocketKeepAlive: () => {},
    flushHeaders: () => {}
  });
  return req;
}

function guardNodeNetwork(blocked) {
  const isLocal = (host) => /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(String(host || ''));
  const hostOf = (args) => {
    const first = args[0];
    if (typeof first === 'string' || first instanceof URL) {
      try { return new URL(String(first)).hostname; } catch (e) { return ''; }
    }
    return String(first?.hostname || first?.host || '').replace(/:\d+$/, '');
  };
  for (const mod of [require('http'), require('https')]) {
    const request = mod.request;
    mod.request = function demoRequest(...args) {
      const host = hostOf(args);
      if (isLocal(host)) return request.apply(this, args);
      blocked.add(host);
      return blockedRequest(host);
    };
    mod.get = function demoGet(...args) {
      const req = mod.request(...args);
      req.end();
      return req;
    };
  }
}

/**
 * Что main показывает сам, вне окна: трей, заставка, уведомления Windows,
 * окна ошибок, окна о награде, просьба о перезапуске. Проверка перевода
 * читает это из probe.
 */
function createProbe() {
  return {
    tray: { tooltip: null, tooltips: [], menu: [] },
    splash: { stages: [], text: '' },
    notifications: [],
    dialogs: [],
    relaunch: [],
    dropWindows: []
  };
}

function installProbes(electron, probe) {
  const { Tray, dialog } = electron;
  const proto = Tray && Tray.prototype;
  if (proto && typeof proto.setToolTip === 'function') {
    const setToolTip = proto.setToolTip;
    proto.setToolTip = function demoSetToolTip(text) {
      probe.tray.tooltip = String(text);
      probe.tray.tooltips.push(String(text));
      return setToolTip.call(this, text);
    };
  }
  if (proto && typeof proto.setContextMenu === 'function') {
    const setContextMenu = proto.setContextMenu;
    proto.setContextMenu = function demoSetContextMenu(menu) {
      probe.tray.menu = menu && menu.items ? menu.items.map(item => item.label).filter(Boolean) : [];
      return setContextMenu.call(this, menu);
    };
  }
  // Окна ошибок: записать и не показывать — они модальные и ждут человека
  dialog.showErrorBox = (title, content) => { probe.dialogs.push({ title, content }); };
  dialog.showMessageBox = async (...args) => {
    const opts = args.find(a => a && typeof a === 'object' && !a.webContents) || {};
    probe.dialogs.push({ title: opts.title, message: opts.message, detail: opts.detail, buttons: opts.buttons });
    return { response: Number.isInteger(opts.cancelId) ? opts.cancelId : 0, checkboxChecked: false };
  };
  dialog.showMessageBoxSync = (...args) => {
    const opts = args.find(a => a && typeof a === 'object' && !a.webContents) || {};
    probe.dialogs.push({ title: opts.title, message: opts.message, detail: opts.detail, buttons: opts.buttons });
    return Number.isInteger(opts.cancelId) ? opts.cancelId : 0;
  };
}

function guardSideEffects(electron, version, probe) {
  const { app, shell, globalShortcut, powerSaveBlocker, Notification } = electron;
  // Обновления: «новых версий нет», без GitHub
  const { autoUpdater } = require(path.join(ROOT, 'node_modules/electron-updater'));
  autoUpdater.checkForUpdates = async () => {
    setTimeout(() => autoUpdater.emit('update-not-available', { version }), 300);
    return null;
  };
  autoUpdater.downloadUpdate = async () => [];
  autoUpdater.quitAndInstall = () => {};

  // Ничего не открываем в системе и не меняем в Windows
  shell.openExternal = async () => {};
  shell.openPath = async () => '';
  shell.showItemInFolder = () => {};
  app.setLoginItemSettings = () => {};
  // Перезапуск только записывается: новый экземпляр поднимает тот, кто
  // проверяет (tests/i18n-language.cjs), с тем же временным профилем
  app.relaunch = (options) => { probe.relaunch.push(options || {}); };
  globalShortcut.register = () => true;
  powerSaveBlocker.start = () => -1;
  powerSaveBlocker.isStarted = () => false;
  powerSaveBlocker.stop = () => {};
  // Системные уведомления Windows демо не показывает, только записывает
  Notification.prototype.show = function () {
    probe.notifications.push({ title: this.title, body: this.body });
  };

  const childProcess = require('child_process');
  const exec = childProcess.exec;
  childProcess.exec = function demoExec(command, ...rest) {
    if (/shutdown|powrprof|pmset/i.test(String(command))) {
      const cb = rest.find(a => typeof a === 'function');
      if (cb) process.nextTick(() => cb(null, '', ''));
      return null;
    }
    return exec.call(this, command, ...rest);
  };
  // Список процессов для игрового режима — пустой: настоящая игра на
  // компьютере не должна переключать демо в «игровой режим»
  const execFile = childProcess.execFile;
  childProcess.execFile = function demoExecFile(file, ...rest) {
    if (/tasklist/i.test(String(file))) {
      const cb = rest.find(a => typeof a === 'function');
      if (cb) process.nextTick(() => cb(null, '', ''));
      return null;
    }
    return execFile.call(this, file, ...rest);
  };
}

// ─── сеть окна и плеера ─────────────────────────────────────────────

const svgResponse = (svg) => new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' } });

function assetResponse(url, state) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'avatar') {
    const login = decodeURIComponent(parts[1] || '').replace(/\.svg$/, '');
    const name = state.channels.get(login)?.displayName || (login === USER.login ? USER.displayName : login);
    return svgResponse(avatarSvg(name));
  }
  if (parts[0] === 'reward') return svgResponse(rewardSvg(parts[1], decodeURIComponent(parts[2] || '')));
  return new Response('', { status: 404 });
}

function installNetwork(electron, state, blocked) {
  const { session } = electron;
  const isLocal = (host) => /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host);
  const passThrough = (ses, request) => ses.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    bypassCustomProtocolHandlers: true
  });

  const setup = (ses, withPlayer) => {
    ses.protocol.handle('https', (request) => {
      let url;
      try { url = new URL(request.url); } catch (e) { return new Response('', { status: 400 }); }
      if (url.hostname === ASSET_HOST) return assetResponse(url, state);
      // Обложки игр и картинки Twitch — настоящие
      if (url.hostname === 'static-cdn.jtvnw.net' && request.method === 'GET') return passThrough(ses, request);
      if (withPlayer && url.hostname === 'player.twitch.tv') {
        const login = String(url.searchParams.get('channel') || '').toLowerCase();
        state.watchChannel(login);
        return new Response(playerHtml(state.sceneForChannel(login), login), {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
      blocked.add(url.hostname);
      return new Response('', { status: 503 });
    });
    ses.protocol.handle('http', (request) => {
      let host = '';
      try { host = new URL(request.url).hostname; } catch (e) { /* пусто */ }
      if (isLocal(host)) return passThrough(ses, request);
      blocked.add(host);
      return new Response('', { status: 503 });
    });
  };

  setup(session.defaultSession, false);
  setup(session.fromPartition('persist:twitch'), true);
}

// ─── обработчики IPC ────────────────────────────────────────────────

function installHandlers(electron, state, opts = {}) {
  const { ipcMain } = electron;
  const handle = (channel, fn) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_event, ...args) => fn(...args));
  };
  const on = (channel, fn) => {
    ipcMain.removeAllListeners(channel);
    ipcMain.on(channel, (_event, ...args) => fn(...args));
  };

  for (const [channel, fn] of Object.entries(state.handlers)) handle(channel, fn);

  // Всё, что меняет систему или открывает окна поверх экрана
  handle('shutdown-computer', () => ({ success: true }));
  handle('open-external', () => true);
  handle('open-logs-folder', () => ({ success: true }));
  if (!opts.realRelaunch) handle('app-relaunch', () => false);
  handle('get-autostart', () => false);
  on('set-autostart', () => {});
  on('keep-awake', () => {});
  // Уведомления: окно о награде и всплывашка Windows. С realNotifications
  // работают обработчики main, а показ перехватывает probe
  if (!opts.realNotifications) on('show-notification', () => {});
  if (!opts.realNotifications) on('show-drop-notification', () => {});
  on('download-update', () => {});
  on('install-update', () => {});
}

// ─── localStorage окна до первого запуска интерфейса ────────────────

function localStorageSeed({ lang, theme, style, profile, onboarding }, version) {
  const legacy = profile === 'legacy';
  const seed = {
    // У установки до 1.2.0 выбранного языка нет: язык решает tr.js
    ...(legacy ? {} : { appLanguage: lang }),
    app_settings: JSON.stringify({
      ...(legacy ? {} : { language: lang }),
      theme,
      uiStyle: style,
      uiStyleChosen: true,
      // Окно «что нового» на снимках не нужно
      lastSeenVersion: version,
      soundEnabled: false,
      settingsVersion: 3
    })
  };
  if (!onboarding) seed['wt.onboarding.hidden'] = '1';
  return seed;
}

// ─── запуск ─────────────────────────────────────────────────────────

/**
 * Поднимает приложение в демо-режиме. Звать до готовности Electron.
 * Возвращает управление окном для снимков и проверок.
 */
function start(overrides = {}) {
  const opts = options(overrides);
  const electron = require('electron');
  const { app, BrowserWindow } = electron;

  const userData = profileDir();
  app.setPath('userData', userData);
  app.setAppPath(ROOT);
  // Язык «Windows» для окна (navigator.language) и main (app.getLocale)
  if (opts.locale) app.commandLine.appendSwitch('lang', opts.locale);
  // Снимки ровно 1440×900 при любом масштабе Windows
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  // Окно за краем экрана Windows считает закрытым и перестаёт рисовать
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

  quietConsole(opts.verbose);
  const blocked = new Set();
  const version = require(path.join(ROOT, 'package.json')).version;
  DEMO_VERSION.current = version;
  // Входной скрипт лежит в tools/demo без package.json, и Electron отдаёт
  // свою версию (28.x): окно сочло бы это обновлением и показало «Что нового»
  app.getVersion = () => version;
  guardNodeNetwork(blocked);
  const probe = createProbe();
  installProbes(electron, probe);
  guardSideEffects(electron, version, probe);

  let mainWindow = null;
  // Сундук, собранный «запросом из main», окно узнаёт тем же событием
  const notify = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  };
  const tr = makeTranslator(opts.lang);
  const state = createDemoState({ lang: opts.lang, tr, notify });
  if (opts.profile === 'empty') {
    // Первый запуск: входа нет, Twitch отдаёт пустое — страницы показывают
    // свои пустые состояния. Список категорий для выбора остаётся
    Object.assign(state.handlers, {
      'fetch-twitch-drops': () => [],
      'fetch-drops-inventory': () => ({ campaigns: [], claimedDrops: [], dashboardComplete: true }),
      'check-category-drops': () => false,
      'get-streams-with-drops': () => [],
      'get-user-subscriptions': () => ({ items: [], complete: true }),
      'has-twitch-session': () => ({ loggedIn: false }),
      'get-oauth-user': () => null
    });
  }

  // Хранилище main: аккаунт, категории, статистика, журнал, подписки
  const Store = require(path.join(ROOT, 'node_modules/electron-store'));
  const store = new Store();
  if (!samePath(path.dirname(path.resolve(store.path)), userData)) {
    throw new Error('Хранилище демо не во временном профиле: ' + store.path);
  }
  const seedStore = opts.profile !== 'keep';
  if (seedStore) {
    const data = opts.profile === 'empty' ? {} : state.storeSeed(svgDataUri(avatarSvg(USER.displayName)));
    store.set({
      ...data,
      settings: {
        ...(opts.profile === 'legacy' ? {} : { language: opts.lang }),
        theme: opts.theme,
        uiStyle: opts.style,
        uiStyleChosen: true,
        lowGraphics: true,
        lastSeenVersion: version,
        autostart: false
      },
      windowState: { width: SIZE.width, height: SIZE.height, maximized: false },
      trayNotificationShown: true
    });
  }

  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const rendererErrors = [];

  const placeWindow = (win) => {
    win.setContentSize(SIZE.width, SIZE.height);
    if (!opts.headless) return;
    // Снимкам окно на экране не нужно: ставим его за край и не даём ему
    // перехватывать фокус у того, кто сейчас работает за компьютером
    win.setPosition(-SIZE.width - 400, 40);
    win.show = () => win.showInactive();
    win.focus = () => {};
  };

  // Первая загрузка окна — служебная страница с тем же file://, что и
  // интерфейс: в её localStorage кладутся язык и оформление, и только потом
  // грузится index.html. Так интерфейс с первого кадра на языке демо и не
  // запускается дважды
  const loadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function demoLoadFile(file, loadOptions) {
    const name = String(file).replace(/\\/g, '/');
    if (name.endsWith('splash.html')) {
      // Заставка живёт как обычно, но невидимой
      try {
        this.setOpacity(0);
        this.setIgnoreMouseEvents(true);
        if (opts.headless) this.setPosition(-2000, 40);
      } catch (e) { /* окно уже закрывается */ }
      watchSplash(this, loadOptions);
      return loadFile.call(this, file, loadOptions);
    }
    if (name.endsWith('notification.html')) {
      // Окно о награде — за краем экрана и прозрачное: проверке нужен его
      // текст, а не всплывашка поверх чужой работы
      try {
        this.setOpacity(0);
        this.setIgnoreMouseEvents(true);
        this.setPosition(-2000, 40);
        const setBounds = this.setBounds.bind(this);
        this.setBounds = (bounds, animate) => setBounds({ ...bounds, x: -2000, y: 40 }, animate);
      } catch (e) { /* окно уже закрывается */ }
      probe.dropWindows.push({ window: this, query: (loadOptions && loadOptions.query) || {} });
      return loadFile.call(this, file, loadOptions);
    }
    if (name === 'renderer/index.html' && !mainWindow) {
      mainWindow = this;
      placeWindow(this);
      this.webContents.on('console-message', (_e, level, message, line, source) => {
        if (level >= 3) rendererErrors.push(String(message).slice(0, 300) + ' (' + String(source).split('/').pop() + ':' + line + ')');
      });
      if (!seedStore) {
        // Профиль как есть: localStorage не трогаем
        this.webContents.once('did-finish-load', () => resolveReady(this));
        return loadFile.call(this, file, loadOptions).catch(error => { rejectReady(error); throw error; });
      }
      const seed = localStorageSeed(opts, version);
      const script = `(() => { localStorage.clear(); const seed = ${JSON.stringify(seed)};
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); return localStorage.length; })()`;
      return loadFile.call(this, SEED_PAGE)
        .then(() => this.webContents.executeJavaScript(script))
        .then(() => {
          this.webContents.once('did-finish-load', () => resolveReady(this));
          return loadFile.call(this, file, loadOptions);
        })
        .catch(error => { rejectReady(error); throw error; });
    }
    return loadFile.call(this, file, loadOptions);
  };

  app.whenReady().then(() => installNetwork(electron, state, blocked));
  // Окно закрыли руками — профиль тоже не нужен
  app.once('quit', () => scheduleProfileCleanup(userData));

  require(path.join(ROOT, 'main.js'));
  // main.js зарегистрировал свои обработчики при загрузке — заменяем
  installHandlers(electron, state, opts);

  return createControl({ app, state, opts, ready, blocked, rendererErrors, userData, probe, getWindow: () => mainWindow });

  /** Текст заставки: этапы, которые присылает main, и её собственные строки. */
  function watchSplash(win, loadOptions) {
    probe.splash.query = (loadOptions && loadOptions.query) || {};
    const contents = win.webContents;
    const exec = contents.executeJavaScript.bind(contents);
    contents.executeJavaScript = (code, ...rest) => {
      const m = /window\.splash\.stage\(\d+, ("(?:[^"\\]|\\.)*")/.exec(String(code));
      if (m) {
        try { probe.splash.stages.push(JSON.parse(m[1])); } catch (e) { /* не строка */ }
      }
      return exec(code, ...rest);
    };
    contents.once('did-finish-load', () => {
      exec('document.body.innerText').then(text => { probe.splash.text = String(text || ''); }).catch(() => {});
    });
  }
}

// ─── управление окном для снимков и проверок ────────────────────────

function createControl({ app, state, opts, ready, blocked, rendererErrors, userData, probe, getWindow }) {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const exec = (code) => getWindow().webContents.executeJavaScript(code, true);

  async function waitFor(expression, { timeout = 15000, interval = 250 } = {}) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      try {
        if (await exec(`!!(${expression})`)) return true;
      } catch (e) { /* страница ещё грузится */ }
      await sleep(interval);
    }
    return false;
  }

  /**
   * Фарминг идёт: восстановленная сессия (activeSession в хранилище) уже
   * должна была его запустить; если нет — та же кнопка, что у человека.
   */
  async function waitForFarming() {
    await waitFor('window.farmingPage && window.router && window.router.currentPage === "farming"', { timeout: 20000 });
    const active = 'window.farmingPage.currentStream && window.sessionState && window.sessionState.isActive()';
    if (!(await waitFor(active, { timeout: 12000 }))) {
      await exec('window.farmingPage && window.farmingPage.startFarming()').catch(() => {});
      await waitFor(active, { timeout: 20000 });
    }
    // Плеер загрузил кадр, а карточка стрима и прогресс наград заполнены
    await waitFor('document.getElementById("twitch-player") && /player\\.twitch\\.tv/.test(document.getElementById("twitch-player").src)', { timeout: 10000 });
    await waitFor('document.querySelector("#drops-progress-horizontal") && getComputedStyle(document.querySelector("#drops-progress-horizontal")).display !== "none"', { timeout: 15000 });
    await warmUp();
    return exec(`({
      category: window.farmingPage.currentCategory && window.farmingPage.currentCategory.name,
      stream: window.farmingPage.currentStream && window.farmingPage.currentStream.login,
      credit: document.getElementById('sidebar-drops-credit') && document.getElementById('sidebar-drops-credit').dataset.state
    })`);
  }

  /**
   * Первые минуты фарминга выглядят пусто: зачёт Twitch проверяется через
   * полторы минуты, баллы — через 8 и 20 секунд. Ждать этого на каждом
   * запуске незачем: зовём те же методы страницы сразу. Решения принимает
   * сам код приложения, по ответам демо-данных.
   */
  async function warmUp() {
    await exec(`(() => {
      const page = window.farmingPage;
      if (!page || !page.currentStream || typeof page.startDropCreditCheck !== 'function') return false;
      const realSetTimeout = window.setTimeout;
      window.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 60000 ? 1500 : ms, ...rest);
      try { page.startDropCreditCheck(page.currentStream.login); } finally { window.setTimeout = realSetTimeout; }
      return true;
    })()`).catch(() => false);
    for (let i = 0; i < 3; i++) {
      await exec('window.sessionState && window.sessionState.pollPoints && window.sessionState.pollPoints()').catch(() => {});
      await sleep(400);
    }
    await waitFor('document.getElementById("sidebar-drops-credit") && document.getElementById("sidebar-drops-credit").dataset.state === "ok"', { timeout: 10000 });
  }

  async function navigate(page) {
    await exec(`window.router.navigate(${JSON.stringify(page)})`);
    await waitFor(`window.router.currentPage === ${JSON.stringify(page)}`, { timeout: 8000 });
  }

  /** Ждёт загрузки видимых картинок и пары кадров отрисовки. */
  async function settle(ms = 600) {
    await sleep(ms);
    await exec(`(async () => {
      const shown = [...document.images].filter(img => img.getClientRects().length && img.src);
      const pending = shown.filter(img => !img.complete).map(img => new Promise(done => {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }));
      await Promise.race([Promise.all(pending), new Promise(done => setTimeout(done, 6000))]);
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      return shown.length;
    })()`).catch(() => 0);
  }

  async function capture(file) {
    const win = getWindow();
    const image = await win.webContents.capturePage();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return image.getSize();
  }

  function quit(code = 0) {
    // Без сохранения сессии и ожидания окна: профиль всё равно временный
    scheduleProfileCleanup(userData);
    setTimeout(() => app.exit(code), 50);
  }

  return {
    app, state, options: opts, ready, blocked, rendererErrors, userData, probe,
    window: getWindow, exec, waitFor, waitForFarming, navigate, settle, capture, sleep, quit
  };
}

module.exports = { start, needsElectron, relaunch, spawnElectron, makeProfile, removeProfile, say, ROOT, SIZE };

// Под Electron (electron скрипт.cjs) require.main не задан — узнаём себя по argv
const isEntry = require.main === module ||
  process.argv.slice(1, 3).some(item => typeof item === 'string' && samePath(path.resolve(item), __filename));

if (isEntry) {
  if (needsElectron()) {
    relaunch(__filename);
  } else {
    // WT_DEMO_SECONDS=N — закрыться самому через N секунд (для проверок)
    const seconds = Number(process.env.WT_DEMO_SECONDS) || 0;
    const demo = start();
    demo.ready
      .then(() => demo.waitForFarming())
      .then(info => {
        say('TEST demo ready:', JSON.stringify({ ...info, lang: demo.options.lang, theme: demo.options.theme, style: demo.options.style, profile: demo.userData }));
        if (demo.blocked.size) say('TEST demo blocked hosts:', [...demo.blocked].join(', '));
        if (seconds > 0) setTimeout(() => demo.quit(0), seconds * 1000);
      })
      .catch(error => {
        say('TEST demo FAIL', error && error.stack || error);
        if (seconds > 0) demo.quit(1);
      });
  }
}
