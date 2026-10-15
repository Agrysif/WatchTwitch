const { app, BrowserWindow, ipcMain, Notification, powerSaveBlocker, shell, Tray, Menu, webContents, globalShortcut, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const url = require('url');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

/**
 * https.request с обязательным таймаутом.
 *
 * Из 33 сетевых запросов в этом файле срок ожидания был только у двух.
 * Остальные при обрыве связи без ответа сервера висели бесконечно: сокет
 * открыт, данных нет, обещание не разрешается — и опрос дропсов, который
 * его ждал, застывал до перезапуска. Здесь один общий предел на простой
 * соединения: нет данных 20 секунд — запрос обрывается с ошибкой, и у
 * вызывающего срабатывает его же обработчик 'error'.
 */
const REQUEST_IDLE_TIMEOUT_MS = 20000;
const rawHttpsRequest = https.request.bind(https);

function httpsRequestWithTimeout(...args) {
  const req = rawHttpsRequest(...args);
  req.setTimeout(REQUEST_IDLE_TIMEOUT_MS, () => {
    req.destroy(new Error('таймаут: сервер молчит ' + (REQUEST_IDLE_TIMEOUT_MS / 1000) + ' с'));
  });

  // Ответ, оборванный чистым закрытием соединения. Прокси или антивирус
  // присылает заголовки и часть тела, затем закрывает сокет без ошибки:
  // 'end' у ответа не наступает, у запроса нет 'error' (ответ ведь
  // получен), а таймаут простоя молчит, потому что сокета уже нет. Цепочка
  // фарминга, ждавшая такой запрос, застывала до перезапуска. Превращаем
  // это в обычную ошибку запроса: её слушают все вызывающие.
  let failed = false;
  req.on('error', () => { failed = true; });
  req.on('response', (res) => {
    res.on('close', () => {
      if (res.complete || failed) return;
      failed = true;
      req.emit('error', new Error('обрыв ответа: соединение закрыто посреди передачи'));
    });
  });
  return req;
}

/**
 * Кэш ответов Twitch с общим обещанием.
 *
 * Замер показал около тысячи запросов в минуту: список кампаний и
 * инвентарь запрашивали пять разных мест независимо, каждое по своему
 * таймеру, а инвентарь вдобавок слал по запросу на каждую из 130 кампаний
 * ради числа, которое никто не читал. Twitch обновляет прогресс просмотра
 * раз в минуту, список кампаний меняется раз в часы — чаще спрашивать
 * бессмысленно. Пока запрос в полёте, все желающие получают одно и то же
 * обещание, а не по соединению каждый.
 */
const TWITCH_CACHE_TTL = {
  inventory: 60 * 1000,
  inventoryEmpty: 15 * 1000,
  dashboard: 10 * 60 * 1000,
  dashboardEmpty: 20 * 1000,
  // Инвентарь — это два запроса подряд (Inventory и список кампаний), и
  // каждый может молчать до 20 секунд, прежде чем оборвётся. При сроке в
  // 30 секунд медленный ответ ещё шёл, а следующий вызов уже слал второй
  // такой же — ровно тогда, когда Twitch и так тормозит. Срок конечный:
  // зависшее обещание не должно держать ключ вечно
  inFlight: 60 * 1000
};

const twitchCache = new Map();

function cachedTwitchCall(key, producer, ttlFor) {
  const hit = twitchCache.get(key);
  const now = Date.now();
  if (hit && now < hit.expiresAt) return hit.promise;

  const entry = { promise: null, expiresAt: now + TWITCH_CACHE_TTL.inFlight };
  entry.promise = Promise.resolve()
    .then(producer)
    .then(result => {
      const ttl = typeof ttlFor === 'function' ? ttlFor(result) : ttlFor;
      entry.expiresAt = Date.now() + Math.max(0, Number(ttl) || 0);
      // Готовый ответ виден снаружи: по нему решают, можно ли выбросить
      // запись раньше срока (см. dropIncompleteDropsCache)
      entry.settled = true;
      entry.settledAt = Date.now();
      entry.result = result;
      return result;
    })
    .catch(error => {
      // Удаляем только свою запись: за время ожидания её могла сменить
      // более свежая, и сбой старого запроса стёр бы чужой ответ
      if (twitchCache.get(key) === entry) twitchCache.delete(key);
      throw error;
    });
  twitchCache.set(key, entry);
  return entry.promise;
}

function invalidateTwitchCache(...keys) {
  if (keys.length === 0) twitchCache.clear();
  else keys.forEach(key => twitchCache.delete(key));
}

/**
 * Выбрасывает из кэша неполные ответы о дропсах, как только появилась
 * возможность получить полные: перехвачен Client-Integrity или пришёл
 * список кампаний. Иначе инвентарь без ещё не начатых кампаний висел бы в
 * кэше до своего срока, и окно успевало бы решить, что дропсов у игры нет.
 * Запрос в полёте не трогаем: он сам дождётся свежего списка.
 */
function dropIncompleteDropsCache({ dashboard = false } = {}) {
  const inventory = twitchCache.get('inventory');
  if (inventory?.settled && inventory.result?.dashboardComplete !== true) {
    twitchCache.delete('inventory');
  }
  if (dashboard) {
    const list = twitchCache.get('dashboard');
    if (list?.settled && !(Array.isArray(list.result) && list.result.length)) {
      twitchCache.delete('dashboard');
    }
  }
}

/**
 * Один экземпляр приложения.
 *
 * Второй запуск раньше открывал второе окно с тем же файлом настроек: оба
 * писали в него по очереди, сессия одного затирала сессию другого, а
 * Twitch видел двух зрителей с одного аккаунта. Теперь второй запуск
 * лишь поднимает окно первого.
 */
if (!app.requestSingleInstanceLock()) {
  console.log('[Запуск] Приложение уже открыто — передаю ему фокус и выхожу');
  app.exit(0);
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

/**
 * Идентификатор приложения для Windows (AppUserModelID).
 *
 * Обязан совпадать с тем, что установщик пишет в ярлыки (build.appId в
 * package.json). Раньше стоял 'WatchTwitch.App': закреплённый на панели
 * задач значок и запущенное окно считались разными программами — два
 * значка, — а системные уведомления шли от неизвестного отправителя, без
 * имени и иконки. Значение задано строкой, а не прочитано из package.json:
 * сборщик вырезает раздел build из упакованной копии. Ставим до любых окон,
 * трея и уведомлений.
 */
const APP_USER_MODEL_ID = 'com.watchtwitch.app';
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

/**
 * Лог в файл.
 *
 * До сих пор всё уходило в консоль, которую в собранном приложении никто
 * не видит: ночное падение или тихая остановка фарминга не оставляли
 * следов, и разбираться приходилось по памяти пользователя. Теперь
 * каждая строка консоли main-процесса (а через console-message — и
 * предупреждения с ошибками renderer) дублируется в
 * userData/logs/app.log. Файл ограничен двумя мегабайтами: при
 * переполнении уходит в app.log.1, старее не храним.
 */
const LOG_LIMIT_BYTES = 2 * 1024 * 1024;
let logFilePath = null;

function setupFileLog() {
  const util = require('util');
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'app.log');
  } catch (e) {
    console.warn('[Лог] Папка логов недоступна:', e.message);
    return;
  }

  let size = 0;
  try { size = fs.statSync(logFilePath).size; } catch (e) { /* файла ещё нет */ }

  const format = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try { return util.inspect(value, { depth: 2, breakLength: 200 }).slice(0, 600); } catch (e) { return String(value); }
  };

  const write = (level, args) => {
    const line = new Date().toISOString() + ' ' + level.padEnd(5) + ' ' + args.map(format).join(' ') + '\n';
    try {
      if (size > LOG_LIMIT_BYTES) {
        try { fs.renameSync(logFilePath, logFilePath + '.1'); } catch (e) { /* ignore */ }
        size = 0;
      }
      fs.appendFileSync(logFilePath, line);
      size += Buffer.byteLength(line);
    } catch (e) {
      // диск полон или файл занят — лог не должен ронять приложение
    }
  };

  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      write(level.toUpperCase(), args);
    };
  }

  console.log('[Запуск] WatchTwitch', app.getVersion(), '· Electron', process.versions.electron, '· лог:', logFilePath);
}

setupFileLog();

/**
 * Сеть безопасности главного процесса.
 *
 * Электрон по умолчанию показывает окно «A JavaScript error occurred» и
 * дальше процесс уже ничего не делает: фарминг встаёт до утра из-за одной
 * необработанной ошибки где-нибудь в уведомлении о награде. Именно так и
 * случилось — ночь ушла впустую.
 *
 * Ошибку не прячем: пишем её целиком и сообщаем в окно, если оно живо.
 * Молчаливое проглатывание было бы хуже падения — просто цена падения
 * здесь слишком велика.
 */
process.on('uncaughtException', (error) => {
  console.error('[Главный процесс] Необработанная ошибка:', error);
  try {
    sendToMain('main-process-error', String(error?.message || error));
  } catch (e) {
    // окна может не быть — это не повод падать ещё раз
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[Главный процесс] Необработанный отказ промиса:', reason);
});

/**
 * Файл настроек, переживающий порчу.
 *
 * config.json бывает обрезан или забит нулями: сбой питания посреди
 * записи, антивирус, синхронизация папки, ручная правка. electron-store
 * на таком файле бросает SyntaxError прямо в конструкторе, и приложение
 * падало на каждом запуске, в том числе из автозапуска, причём раньше,
 * чем начинал вестись лог: ни подсказки, ни следа. Сбрасывать молча
 * (clearInvalidConfig) нельзя — вместе с мусором ушли бы аккаунты и
 * статистика. Поэтому битый файл откладываем в сторону, поднимаем копию
 * с прошлого удачного запуска, а если её нет — начинаем с чистого листа
 * и говорим об этом пользователю. Лог и обработчики ошибок потому и
 * стоят выше: всё, что случится здесь, должно попасть в app.log.
 */
let settingsRecovery = null;

function openSettingsStore() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  const backupPath = configPath + '.bak';

  try {
    const opened = new Store();
    // Файл прочитан — свежая копия на случай следующей порчи
    try {
      if (fs.existsSync(configPath)) fs.copyFileSync(configPath, backupPath);
    } catch (e) {
      console.warn('[Настройки] Не удалось обновить резервную копию:', e.message);
    }
    return opened;
  } catch (error) {
    if (error?.name !== 'SyntaxError') return failSettingsStore(configPath, error);
    console.error('[Настройки] config.json повреждён:', error.message);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let corruptPath = path.join(path.dirname(configPath), 'config.corrupt-' + stamp + '.json');
  try {
    fs.renameSync(configPath, corruptPath);
  } catch (e) {
    // Файл занят — хотя бы копию, чтобы было что разбирать
    try { fs.copyFileSync(configPath, corruptPath); } catch (e2) { corruptPath = null; }
  }
  if (corruptPath) console.warn('[Настройки] Повреждённый файл сохранён как', path.basename(corruptPath));

  let restored = false;
  try {
    JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    fs.copyFileSync(backupPath, configPath);
    restored = true;
    console.log('[Настройки] Восстановлены из копии прошлого запуска');
  } catch (e) {
    // копии нет или она тоже битая — начинаем с пустых настроек
  }

  settingsRecovery = { restored, corruptPath };

  try {
    return new Store();
  } catch (error) {
    // Битый файл не удалось ни убрать, ни заменить: читаем его как пустой,
    // первая же запись перезапишет его (копия уже отложена выше)
    try {
      return new Store({ clearInvalidConfig: true });
    } catch (e) {
      return failSettingsStore(configPath, error);
    }
  }
}

/**
 * Настройки не открываются вовсе (нет доступа к папке и т. п.). Без них
 * приложение работать не может, а молча повиснуть без окна — хуже всего:
 * говорим, какой файл виноват, и выходим.
 */
function failSettingsStore(configPath, error) {
  console.error('[Настройки] Файл настроек недоступен:', error);
  try {
    dialog.showErrorBox('WatchTwitch', 'Не удалось открыть файл настроек:\n' + configPath + '\n\n' + (error?.message || error));
  } catch (e) { /* показать некому — остаётся лог */ }
  app.exit(1);
  throw error;
}

/** Сообщает, что настройки пришлось восстановить. Вызывается, когда окно уже есть. */
function announceSettingsRecovery() {
  if (!settingsRecovery) return;
  const body = settingsRecovery.restored
    ? 'Файл настроек был повреждён. Восстановлена копия с прошлого запуска.'
    : 'Файл настроек был повреждён, настройки сброшены.' +
      (settingsRecovery.corruptPath ? ' Испорченный файл сохранён в папке приложения.' : '');
  settingsRecovery = null;
  try {
    new Notification({ title: 'WatchTwitch', body }).show();
  } catch (e) {
    console.warn('[Настройки] Не удалось показать уведомление:', e.message);
  }
}

const store = openSettingsStore();

/**
 * Токены и cookie Twitch на диске — только зашифрованными.
 *
 * electron-store пишет config.json открытым текстом, и любая программа с
 * доступом к профилю читала из него вход в Twitch: токены OAuth и cookie
 * сессии с auth-token. Шифруем их средствами Windows (safeStorage, DPAPI):
 * расшифровать может только этот пользователь на этом компьютере. Окно
 * по-прежнему получает обычные значения — шифрование стоит на границе с
 * файлом. Значение без метки — старая открытая запись: читается как есть,
 * при запуске и при следующей записи шифруется.
 */
const SECRET_PREFIX = 'wt-enc:1:';
const SECRET_JSON_PREFIX = 'wt-encj:1:';
const ACCOUNT_SECRET_FIELDS = ['accessToken', 'refreshToken', 'webviewCookies', 'cookies'];
let secretOpenWarned = false;

function canSealSecrets() {
  try {
    return app.isReady() && safeStorage.isEncryptionAvailable();
  } catch (e) {
    return false;
  }
}

function sealSecret(value) {
  if (value === null || value === undefined || value === '') return value;
  if (typeof value === 'string' && (value.startsWith(SECRET_PREFIX) || value.startsWith(SECRET_JSON_PREFIX))) return value;
  // Шифрование недоступно — пишем как раньше, вход важнее
  if (!canSealSecrets()) return value;
  try {
    const isString = typeof value === 'string';
    const sealed = safeStorage.encryptString(isString ? value : JSON.stringify(value)).toString('base64');
    return (isString ? SECRET_PREFIX : SECRET_JSON_PREFIX) + sealed;
  } catch (e) {
    console.warn('[Хранилище] Не удалось зашифровать вход:', e.message);
    return value;
  }
}

function openSecret(value) {
  if (typeof value !== 'string') return value;
  const isJson = value.startsWith(SECRET_JSON_PREFIX);
  if (!isJson && !value.startsWith(SECRET_PREFIX)) return value;
  try {
    const body = Buffer.from(value.slice((isJson ? SECRET_JSON_PREFIX : SECRET_PREFIX).length), 'base64');
    const plain = safeStorage.decryptString(body);
    return isJson ? JSON.parse(plain) : plain;
  } catch (e) {
    // Файл с другого компьютера или другой учётной записи Windows: такой
    // вход не расшифровать, нужен повторный вход. Пишем об этом один раз
    if (!secretOpenWarned) {
      secretOpenWarned = true;
      console.warn('[Хранилище] Сохранённый вход не расшифровать — нужен повторный вход:', e.message);
    }
    return null;
  }
}

function mapAccountSecrets(accounts, transform) {
  if (!Array.isArray(accounts)) return accounts;
  return accounts.map(account => {
    if (!account || typeof account !== 'object') return account;
    const copy = { ...account };
    for (const field of ACCOUNT_SECRET_FIELDS) {
      if (field in copy) copy[field] = transform(copy[field]);
    }
    return copy;
  });
}

/** Вход OAuth из хранилища с расшифрованными токенами. */
function getOAuth() {
  const oauth = store.get('oauth');
  if (!oauth || typeof oauth !== 'object') return oauth;
  return { ...oauth, accessToken: openSecret(oauth.accessToken), refreshToken: openSecret(oauth.refreshToken) };
}

/** Один раз при запуске: старые открытые записи — в зашифрованные. */
function sealStoredSecrets() {
  if (!canSealSecrets()) return;
  let changed = false;
  try {
    const oauth = store.get('oauth');
    if (oauth && typeof oauth === 'object') {
      const accessToken = sealSecret(oauth.accessToken);
      const refreshToken = sealSecret(oauth.refreshToken);
      if (accessToken !== oauth.accessToken || refreshToken !== oauth.refreshToken) {
        store.set('oauth', { ...oauth, accessToken, refreshToken });
        changed = true;
      }
    }
    const accounts = store.get('accounts');
    const sealed = mapAccountSecrets(accounts, sealSecret);
    if (Array.isArray(accounts) && JSON.stringify(sealed) !== JSON.stringify(accounts)) {
      store.set('accounts', sealed);
      changed = true;
    }
  } catch (e) {
    console.warn('[Хранилище] Не удалось зашифровать сохранённый вход:', e.message);
    return;
  }
  if (!changed) return;
  // В копии прошлого запуска токены ещё открытым текстом — заменяем и её
  try {
    fs.copyFileSync(store.path, store.path + '.bak');
  } catch (e) { /* копия обновится при следующем запуске */ }
  console.log('[Хранилище] Сохранённый вход Twitch зашифрован');
}

/**
 * Экономный режим графики.
 *
 * Приложение показывает видео в 160p фоном, и полноценное аппаратное
 * ускорение ему не нужно. Замер: с ускорением 1105 МБ и процесс графики
 * на 180 МБ, без него — 1006 МБ и 78 МБ, видео при этом играет так же.
 * Вдобавок приложение перестаёт бороться за видеокарту с играми.
 *
 * Отключать можно только до готовности приложения, поэтому значение
 * читается напрямую из хранилища, а смена настройки требует перезапуска.
 */
try {
  if (store.get('settings.lowGraphics') !== false) {
    app.disableHardwareAcceleration();
    console.log('[Графика] Экономный режим: аппаратное ускорение отключено');
  }
} catch (e) {
  console.warn('[Графика] Не удалось прочитать настройку:', e.message);
}

app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('log-level', '3');

const processLabels = new Map();

ipcMain.handle('open-logs-folder', async () => {
  if (!logFilePath) return { success: false, error: 'лог не ведётся' };
  const error = await shell.openPath(path.dirname(logFilePath));
  return error ? { success: false, error } : { success: true };
});

function setProcessLabel(targetWebContents, label) {
  if (!targetWebContents || !label) return false;
  const pid = targetWebContents.getOSProcessId();
  if (!pid) return false;
  processLabels.set(pid, label);
  return true;
}

// Конфигурация автообновления
autoUpdater.logger = console;
autoUpdater.allowDowngrade = false;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// Настройка URL для обновлений (GitHub Releases)
// Force enable updater even in dev mode for testing
const isDev = !app.isPackaged;
const enableUpdater = true; // Set to false to disable updater in dev

if ((app.isPackaged || isDev) && enableUpdater) {
  // Use explicit GitHub releases URL
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Agrysif',
    repo: 'WatchTwitch',
    releaseType: 'release'
  });
  console.log('[Updater] Feed URL configured for GitHub releases');
  console.log('[Updater] App version:', app.getVersion());
  console.log('[Updater] Will check: https://api.github.com/repos/Agrysif/WatchTwitch/releases/latest');
} else {
  console.log('[Updater] Updater disabled (isPackaged:', app.isPackaged, ')');
}

// OAuth конфигурация
const TWITCH_CLIENT_ID = 'bi12b5gk5g141jl2yqkng1wj2k9a8s';
const TWITCH_CLIENT_SECRET = 'nd1s075j85k1mykza17l6xvp5xc1mc';
const REDIRECT_URI = 'http://localhost:3000/auth/callback';
// Права входа — только чтение профиля. Приложение смотрит стримы и
// забирает награды через сессию webview, а прежний список из сорока прав
// (управление каналом, отправка сообщений чата и шёпотов, правка
// трансляции) пугал на экране согласия и давал лишнее при утечке токена
const SCOPES = [
  'user:read:email',
  'user:read:follows'
];

let mainWindow;

/**
 * Отправка сообщения в главное окно.
 *
 * Проверки `if (mainWindow)` мало: закрытое окно ссылку не обнуляет, а
 * обращение к webContents уничтоженного окна выбрасывает исключение и
 * роняет главный процесс. События автообновления и закрытия приходят в
 * том числе тогда, когда окна уже нет.
 */
function sendToMain(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}
let splashWindow;
let powerSaveBlockerId;
let tray = null;

// ===== МОНИТОРИНГ СЕТЕВОГО ТРАФИКА =====
// Единственный источник цифр — CDP-событие Network.dataReceived (см. setupTrafficMonitoring).
// Оно приходит по мере получения чанков и покрывает все webContents, включая webview.
// Ничего больше трафик не считает: любые дополнительные счётчики (Performance API,
// перехват fetch/XHR в preload, событие loadingFinished) давали кратное задвоение.
const RATE_WINDOW_SECONDS = 10;

let trafficData = {
  totalBytes: 0,        // всего с момента запуска приложения
  sessionStartBytes: 0, // отметка на момент старта текущей сессии фарминга
  currentRate: 0,       // KB/s, усреднённые по скользящему окну
  _buckets: new Array(RATE_WINDOW_SECONDS).fill(0),
  _bucketIndex: 0,
  _pendingBytes: 0
};

const monitoredWebContents = new Set();

/**
 * POST-запрос к Twitch с повтором при сетевых сбоях.
 *
 * Фарминг идёт часами, и разрыв связи за это время неизбежен. Раньше
 * каждый запрос при ошибке просто отдавал пустой результат, а вызывающий
 * код принимал это за «стримов нет» или «канал офлайн» — и фарминг
 * останавливался из-за секундного обрыва.
 *
 * Повторяем только сетевые сбои и ответы 5xx. Ошибки 4xx не повторяем:
 * они означают, что запрос неверен, и повтор ничего не изменит.
 */
function twitchPost(postData, headers, options = {}) {
  const https = require('https');
  const attempts = options.attempts || 3;
  const baseDelay = options.delay || 1500;

  const once = () => new Promise((resolve) => {
    const req = httpsRequestWithTimeout({
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers
    }, (res) => {
      // Склеивать куски тела строками нельзя: русская буква — два байта, и
      // если граница пакета режет её пополам, обе половины становятся «�».
      // Декодер потока держит хвост до следующего куска. То же — во всех
      // остальных текстовых ответах ниже.
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const pause = twitchRateLimit.noteResponse(res.statusCode, res.headers);
        if (pause) console.warn('[Twitch] Ответ 429 — пауза', Math.round(pause / 1000), 'с для всех запросов');
        resolve({ ok: res.statusCode < 400, statusCode: res.statusCode, data });
      });
    });

    req.on('error', (e) => resolve({ ok: false, statusCode: 0, error: e.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, error: 'таймаут' });
    });

    req.write(postData);
    req.end();
  });

  return (async () => {
    let last = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Пауза после 429 общая: пока она идёт, в сеть не выходим вовсе.
      // Дождаться можно только короткую — длинную честно возвращаем как отказ.
      const remaining = twitchRateLimit.remainingMs();
      if (remaining > 0) {
        if (remaining > 30000 || attempt === attempts) {
          return { ok: false, statusCode: 429, error: twitchRateLimit.describe() };
        }
        await new Promise(r => setTimeout(r, remaining));
      }

      last = await once();

      // 401 с токеном — возможно, Twitch отозвал вход (см. noteTwitchUnauthorized)
      if (last.statusCode === 401) noteTwitchUnauthorized(tokenFromAuthHeader(headers));

      if (last.ok) return last;

      const worthRetry = last.statusCode === 0 || last.statusCode >= 500 || last.statusCode === 429;
      if (!worthRetry || attempt === attempts) return last;

      // Пауза растёт: при длительном обрыве нет смысла долбить сеть
      const wait = last.statusCode === 429 ? 0 : baseDelay * attempt;
      console.warn('[Twitch] Запрос не удался (' + (last.error || last.statusCode) +
        '), повтор через ' + wait + ' мс');
      await new Promise(r => setTimeout(r, wait));
    }

    return last;
  })();
}

/**
 * Очередь для залпов запросов к Twitch.
 *
 * Окно порой спрашивает разом о сотне вещей: страница подписок — о каждом
 * канале, фарминг на старте — о каждой категории (пока полного списка
 * кампаний нет, проверка идёт запросом стримов). Залп в сотню запросов
 * Twitch встречает ответом 429, а пауза после него общая — встал бы и сам
 * фарминг. Такие запросы идут не больше шести за раз, одной очередью на
 * всех.
 */
const TWITCH_BURST_PARALLEL = 6;
const twitchBurstSlots = { active: 0, waiting: [] };

function takeTwitchBurstSlot() {
  if (twitchBurstSlots.active < TWITCH_BURST_PARALLEL) {
    twitchBurstSlots.active++;
    return Promise.resolve();
  }
  return new Promise(resolve => twitchBurstSlots.waiting.push(resolve));
}

function releaseTwitchBurstSlot() {
  const next = twitchBurstSlots.waiting.shift();
  if (next) next();
  else twitchBurstSlots.active--;
}

async function withTwitchBurstSlot(task) {
  await takeTwitchBurstSlot();
  try {
    return await task();
  } finally {
    releaseTwitchBurstSlot();
  }
}

/**
 * Ошибка «Twitch не ответил» для обработчика invoke: окно получает
 * исключение, а не пустой ответ, который легко принять за «стримов нет»
 * или «канал офлайн». Electron печатает каждую такую ошибку в лог целиком;
 * стек тут ничего не объясняет, причина уже записана строкой выше —
 * поэтому одна строка.
 */
function twitchUnavailable(reason) {
  const error = new Error('Twitch не ответил: ' + reason);
  error.stack = error.message;
  return error;
}

/**
 * Заголовки, подсмотренные у собственных GraphQL-запросов Twitch внутри webview.
 * Client-Integrity выдаётся клиенту Twitch после прохождения его проверки и
 * живёт несколько часов; без него запрос списка кампаний дропсов возвращает
 * IntegrityCheckFailed, из-за чего доступные (но ещё не начатые) дропсы
 * невозможно было увидеть.
 */
let twitchGqlHeaders = {
  integrity: null,
  deviceId: null,
  clientVersion: null,
  sessionId: null,
  capturedAt: 0
};

function captureTwitchGqlHeaders(params, sourceUrl) {
  try {
    const url = params?.request?.url || '';
    if (!url.includes('gql.twitch.tv')) return;

    const headers = params.request.headers || {};
    const pick = (name) => {
      const key = Object.keys(headers).find(h => h.toLowerCase() === name);
      return key ? headers[key] : null;
    };

    const integrity = pick('client-integrity');
    if (!integrity) return;

    const hadIntegrity = !!twitchGqlHeaders.integrity;
    twitchGqlHeaders = {
      integrity,
      deviceId: pick('x-device-id') || pick('device-id') || twitchGqlHeaders.deviceId,
      clientVersion: pick('client-version') || twitchGqlHeaders.clientVersion,
      sessionId: pick('client-session-id') || twitchGqlHeaders.sessionId,
      capturedAt: Date.now()
    };

    // Twitch подписывает каждый запрос заново, поэтому сообщаем только о первом
    // перехвате — иначе лог заполняется одинаковыми строками.
    if (!hadIntegrity) {
      let source = '';
      try { source = new URL(sourceUrl || '').host; } catch (e) { /* без источника */ }
      console.log('[Twitch] Перехвачен Client-Integrity — гейтед-запросы дропсов теперь доступны. Источник:', source || 'неизвестен');
      // Ответы, собранные без него, неполные — следующий запрос пусть идёт заново
      dropIncompleteDropsCache({ dashboard: true });
    }
  } catch (e) {
    // перехват заголовков не критичен
  }
}

function hasFreshIntegrity() {
  // Токен живёт порядка нескольких часов, берём с запасом
  return !!twitchGqlHeaders.integrity && (Date.now() - twitchGqlHeaders.capturedAt) < 2 * 60 * 60 * 1000;
}

function updateTrafficCounters(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  trafficData.totalBytes += bytes;
  trafficData._pendingBytes += bytes;
}

// Скорость считаем как среднее по скользящему окну в RATE_WINDOW_SECONDS секунд.
//
// Окно в одну секунду здесь не годится: видео приходит пачками раз в несколько
// секунд, поэтому в большинстве односекундных окон байтов ровно ноль — и
// счётчик почти всё время показывал 0 КБ/с при реально идущем стриме.
setInterval(() => {
  trafficData._buckets[trafficData._bucketIndex] = trafficData._pendingBytes;
  trafficData._bucketIndex = (trafficData._bucketIndex + 1) % RATE_WINDOW_SECONDS;
  trafficData._pendingBytes = 0;

  const sum = trafficData._buckets.reduce((a, b) => a + b, 0);
  trafficData.currentRate = sum / RATE_WINDOW_SECONDS / 1024;
}, 1000);

function getTrafficSnapshot() {
  return {
    totalBytes: trafficData.totalBytes,
    sessionBytes: Math.max(0, trafficData.totalBytes - trafficData.sessionStartBytes),
    currentRateKBs: trafficData.currentRate
  };
}

function resetTrafficSession() {
  trafficData.sessionStartBytes = trafficData.totalBytes;
  return getTrafficSnapshot();
}

/**
 * Стоит ли считать трафик у этого окна.
 *
 * Отладчик Chromium шлёт событие на каждый полученный кусок данных, а у
 * видеопотока их тысячи в минуту, и каждое пересекает границу процессов.
 * Раньше он вешался на всё подряд — главное окно, чат, скрытые webview, —
 * хотя интересен только расход на просмотр. Считаем у плеера и у окна
 * стрима, остальное пропускаем.
 */
const NetworkLimit = require('./renderer/js/core/network-limit');
const GameMode = require('./renderer/js/core/game-mode');
const TwitchRateLimit = require('./renderer/js/core/rate-limit');

// Общая пауза после 429: одна на все запросы к Twitch
const twitchRateLimit = new TwitchRateLimit();

/**
 * Игровой режим: пока запущена игра, плеер сидит на минимальном качестве с
 * жёстким потолком скорости, чтобы куски видео не подбрасывали пинг.
 * Список процессов берём у Windows раз в двадцать секунд и только пока
 * играет стрим.
 */
let gameModeState = { active: false, game: null, since: null };
let gameCheckBusy = false;
let gameCheckAt = 0;

/**
 * Играет ли сейчас плеер. Результат опроса нужен только потолку скорости
 * плеера, а сам опрос не бесплатный: tasklist при паре сотен процессов —
 * больше секунды и около 3% ядра каждые 20 секунд. Раньше он шёл всю жизнь
 * приложения, в том числе когда оно просто висело в трее, — ровно тогда,
 * когда процессор нужен игре. webview плеера после остановки фарминга не
 * уничтожается, а уходит с адреса Twitch, поэтому смотрим на адрес.
 */
function hasPlayingStream() {
  for (const wc of playerWebContents.values()) {
    try {
      if (!wc.isDestroyed() && /twitch\.tv/i.test(wc.getURL() || '')) return true;
    } catch (e) { /* окно закрывается */ }
  }
  return false;
}

function checkRunningGame() {
  if (gameCheckBusy) return;
  if (store.get('settings.gameMode') === false) {
    if (gameModeState.active) setGameModeState(null);
    return;
  }
  if (process.platform !== 'win32') return;
  if (!hasPlayingStream()) {
    // Без стрима значок «игровой режим» не должен висеть до следующего
    // запуска: игру могли давно закрыть. При старте стрима опрос
    // повторится сразу (см. setupTrafficMonitoring)
    if (gameModeState.active) setGameModeState(null, 'стрим остановлен');
    return;
  }

  gameCheckBusy = true;
  gameCheckAt = Date.now();
  const { execFile } = require('child_process');
  execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
    gameCheckBusy = false;
    if (error) {
      console.warn('[Игра] Не удалось получить список процессов:', error.message);
      return;
    }
    const names = GameMode.parseTasklist(stdout);
    const game = GameMode.match(names, store.get('settings.gameModeProcesses') || '');
    setGameModeState(game);
  });
}

function setGameModeState(game, offReason = null) {
  const active = !!game;
  const sameGame = active && gameModeState.active && gameModeState.game?.exe === game.exe;
  if (active === gameModeState.active && (sameGame || !active)) return;

  gameModeState = { active, game: game || null, since: active ? Date.now() : null };
  console.log(active
    ? '[Игра] Запущена ' + game.title + ' (' + game.exe + ') — качество ' + GameMode.QUALITY + ', потолок ×' + GameMode.HEADROOM
    : (offReason
      ? '[Игра] Игровой режим снят: ' + offReason + ', до старта стрима игры не проверяю'
      : '[Игра] Игра закрыта — возвращаю обычные настройки'));

  refreshStreamLimits();
  sendToMain('game-mode', gameModeState);
  // Награды, пришедшие во время игры, — одним окном, когда игра закрыта
  if (!active) flushDropsAfterGame();
}

ipcMain.handle('get-game-mode', () => gameModeState);

/**
 * Отозванный вход в Twitch.
 *
 * Twitch разлогинивает сессию (смена пароля, «выйти на всех устройствах»,
 * истечение), а cookie auth-token в webview остаётся. Проверка по одному
 * наличию cookie отвечала «вход есть», запросы получали 401, и это
 * читалось как «инвентарь пуст» или «канал офлайн»: стрим шёл, минуты не
 * засчитывались, предупреждения не было.
 *
 * Сам по себе 401 ещё не приговор: мутации Twitch отклоняет и с живым
 * cookie-токеном (проверка целостности), а OAuth-токен приложения у gql
 * не принимается вовсе. Поэтому 401 лишь повод спросить id.twitch.tv,
 * жив ли именно cookie-токен. Отметка привязана к значению токена: новый
 * вход даёт новый токен, и она перестаёт действовать сама.
 */
const twitchAuthCheck = { revokedToken: null, checkedToken: null, checkedAt: 0, inFlight: null };

function validateTwitchToken(token) {
  return new Promise((resolve) => {
    const req = httpsRequestWithTimeout({
      hostname: 'id.twitch.tv',
      path: '/oauth2/validate',
      method: 'GET',
      headers: { 'Authorization': 'OAuth ' + token }
    }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === 200) resolve('valid');
        else if (res.statusCode === 401) resolve('revoked');
        else resolve('unknown');
      });
    });
    req.on('error', () => resolve('unknown'));
    req.end();
  });
}

/** Запрос с этим токеном получил 401 — проверить, не отозван ли вход. */
function noteTwitchUnauthorized(token) {
  if (!token || twitchAuthCheck.revokedToken === token || twitchAuthCheck.inFlight) return;
  // Один и тот же живой токен проверяем не чаще раза в 5 минут: мутации
  // с 401 бывают регулярно, и каждая не должна стоить запроса
  if (twitchAuthCheck.checkedToken === token && Date.now() - twitchAuthCheck.checkedAt < 5 * 60 * 1000) return;

  twitchAuthCheck.inFlight = (async () => {
    // 401 на чужой токен (OAuth приложения) о сессии webview ничего не говорит
    if ((await getCookieAuthToken()) !== token) return;
    const verdict = await validateTwitchToken(token);
    if (verdict === 'unknown') return;
    twitchAuthCheck.checkedToken = token;
    twitchAuthCheck.checkedAt = Date.now();
    if (verdict === 'revoked') {
      twitchAuthCheck.revokedToken = token;
      console.warn('[Вход] Twitch отозвал вход: cookie auth-token больше не действует — нужен повторный вход');
      // Ответы, полученные с отозванным токеном, ничего не значат
      invalidateTwitchCache('inventory', 'dashboard');
    }
  })()
    .catch(e => console.warn('[Вход] Проверка токена не удалась:', e?.message || e))
    .finally(() => { twitchAuthCheck.inFlight = null; });
}

/** Токен из заголовка Authorization ('OAuth …') или null. */
function tokenFromAuthHeader(headers) {
  const value = headers?.Authorization || headers?.authorization;
  const match = /^OAuth\s+(\S+)/i.exec(String(value || ''));
  return match ? match[1] : null;
}

// Есть ли вход в Twitch: cookie auth-token в webview, и Twitch его не
// отозвал. Без сети: отметку об отзыве ставят сами запросы (см. выше)
ipcMain.handle('has-twitch-session', async () => {
  const token = await getCookieAuthToken();
  if (!token) return { loggedIn: false };
  if (twitchAuthCheck.revokedToken === token) return { loggedIn: false, revoked: true };
  return { loggedIn: true };
});

// Плееры, за которыми следит отладчик: к ним же применяется потолок скорости
const playerWebContents = new Map();

/**
 * Ограничивает скорость загрузки стрима.
 *
 * Видео качается кусками: каждый отрезок на мгновение забивает канал,
 * очередь в роутере распухает, и в игре подскакивает пинг — «резко
 * подрастает, потом отпускает». Потолок растягивает ту же закачку во
 * времени, и чужие пакеты перестают ждать.
 *
 * Условия ставятся на тот же сеанс отладчика, который уже открыт ради
 * подсчёта трафика, поэтому ничего дополнительно подключать не нужно.
 */
function applyStreamLimit(webContents, conditions) {
  if (!webContents || webContents.isDestroyed()) return false;

  try {
    if (!webContents.debugger.isAttached()) return false;
    webContents.debugger.sendCommand('Network.emulateNetworkConditions', conditions);
    return true;
  } catch (error) {
    console.warn('[Скорость] Не удалось применить потолок:', error.message);
    return false;
  }
}

// Качество, которое плеер использует прямо сейчас. Может отличаться от
// настройки: пользователь мог выбрать другое на панели, а подбор — сам
// подняться на ступень выше. Потолок обязан следовать за действующим,
// иначе слишком тесный предел не даст плееру набрать буфер, тот встанет,
// и подбор полезет ещё выше — получилась бы петля.
let activeStreamQuality = null;

/** Текущие условия по настройкам приложения. */
function currentStreamConditions() {
  const enabled = store.get('settings.limitStreamSpeed');
  if (enabled === false) return NetworkLimit.UNLIMITED;

  // Игра запущена: минимальное качество и потолок впритык к битрейту
  if (gameModeState.active) {
    return NetworkLimit.conditions(GameMode.QUALITY, GameMode.HEADROOM);
  }

  const quality = activeStreamQuality || store.get('settings.preferredStreamQuality') || '160p30';
  return NetworkLimit.conditions(quality, store.get('settings.streamSpeedHeadroom'));
}

/** Переприменяет потолок ко всем наблюдаемым плеерам. */
function refreshStreamLimits() {
  const conditions = currentStreamConditions();
  let applied = 0;

  for (const wc of playerWebContents.values()) {
    if (applyStreamLimit(wc, conditions)) applied++;
  }

  if (applied > 0) {
    const kbps = conditions.downloadThroughput > 0
      ? Math.round(conditions.downloadThroughput * 8 / 1000) + ' кбит/с'
      : 'без ограничения';
    console.log('[Скорость] Потолок загрузки:', kbps, '| плееров:', applied);
  }

  return applied;
}

ipcMain.on('refresh-stream-limit', (event, quality) => {
  if (quality) activeStreamQuality = quality;
  refreshStreamLimits();
});

function shouldCountTraffic(webContents) {
  try {
    if (webContents.getType() === 'browserView') return true;

    const url = webContents.getURL() || '';
    if (url.includes('player.twitch.tv')) return true;

    // Адрес webview может ещё не быть выставлен на момент создания —
    // проверим повторно после первой загрузки
    return url === '' || url === 'about:blank';
  } catch (e) {
    return false;
  }
}

function setupTrafficMonitoring(webContents) {
  if (!webContents || webContents.isDestroyed() || monitoredWebContents.has(webContents.id)) return;

  if (!shouldCountTraffic(webContents)) return;

  // Пустой адрес — окно ещё не начало грузиться. Дождёмся и решим снова.
  try {
    const url = webContents.getURL() || '';
    if (url === '' || url === 'about:blank') {
      webContents.once('did-start-navigation', () => {
        if (!webContents.isDestroyed() && !monitoredWebContents.has(webContents.id)) {
          setupTrafficMonitoring(webContents);
        }
      });
      return;
    }
  } catch (e) {
    return;
  }

  monitoredWebContents.add(webContents.id);
  console.log('[Трафик] Считаю расход у:', (webContents.getURL() || '').slice(0, 60));

  try {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3');
    }
    webContents.debugger.sendCommand('Network.enable');

    // Потолок ставим сразу: иначе первые же куски видео уйдут рывком
    playerWebContents.set(webContents.id, webContents);
    applyStreamLimit(webContents, currentStreamConditions());

    // Без стрима игры не проверяются (см. hasPlayingStream), поэтому на
    // старте стрима проверяем сразу, а не через 20 секунд: иначе стрим
    // успел бы пойти в полном качестве при запущенной игре или на минимуме
    // после её закрытия. Смена канала — тоже переход, но чаще раза в
    // 10 секунд опрашивать незачем.
    const checkGameOnStart = () => {
      if (Date.now() - gameCheckAt > 10 * 1000) checkRunningGame();
    };
    webContents.on('did-navigate', checkGameOnStart);
    checkGameOnStart();

    webContents.debugger.on('message', (_event, method, params) => {
      // Считаем ТОЛЬКО dataReceived: encodedDataLength здесь — размер конкретного
      // чанка. Событие loadingFinished отдаёт encodedDataLength всего запроса
      // целиком, поэтому учитывать оба — значит посчитать каждый байт дважды.
      if (method === 'Network.dataReceived') {
        updateTrafficCounters(params.encodedDataLength || params.dataLength || 0);
      }

      // Попутно перехватываем заголовки, которые Twitch подставляет своим
      // собственным GraphQL-запросам. Без Client-Integrity часть операций
      // (в частности список кампаний дропсов) отвечает IntegrityCheckFailed.
      if (method === 'Network.requestWillBeSent') {
        let sourceUrl = '';
        try { sourceUrl = webContents.isDestroyed() ? '' : webContents.getURL(); } catch (e) { /* ignore */ }
        captureTwitchGqlHeaders(params, sourceUrl);
      }
    });

    webContents.on('destroyed', () => {
      monitoredWebContents.delete(webContents.id);
      playerWebContents.delete(webContents.id);
      try {
        if (!webContents.isDestroyed() && webContents.debugger.isAttached()) {
          webContents.debugger.detach();
        }
      } catch (e) {
        console.warn('[Traffic] Debugger detach failed:', e.message);
      }
    });
  } catch (error) {
    console.warn('[Traffic] Debugger attach failed:', error.message);
    // Retry once after load if attach failed (e.g., too early)
    try {
      webContents.once('did-finish-load', () => {
        setupTrafficMonitoring(webContents);
      });
    } catch (_) {
      // ignore
    }
  }
}

// ===== АВТООБНОВЛЕНИЕ =====
let updateInfo = null;

autoUpdater.on('checking-for-update', () => {
  console.log('[Updater] ===== CHECKING FOR UPDATE =====');
  console.log('[Updater] Current version:', app.getVersion());
  console.log('[Updater] Platform:', process.platform);
  console.log('[Updater] Arch:', process.arch);
  console.log('[Updater] Checking GitHub releases...');
});

autoUpdater.on('update-available', (info) => {
  console.log('[Updater] Доступно обновление:', info.version);
  console.log('[Updater] Current app version:', app.getVersion());
  console.log('[Updater] Files:', info.files);
  updateInfo = info;
  if (mainWindow) {
    sendToMain('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('[Updater] Обновлений нет, установлена', app.getVersion());

  // Раньше это событие только писалось в журнал. Нажав «Проверить
  // обновления» на свежей версии, пользователь не видел ровно ничего —
  // и кнопка выглядела сломанной, хотя отрабатывала верно.
  sendToMain('update-not-available', { version: app.getVersion() });
});

autoUpdater.on('error', (error) => {
  console.error('[Updater] ===== UPDATE CHECK ERROR =====');
  console.error('[Updater] Error type:', error.name);
  console.error('[Updater] Error message:', error.message);
  console.error('[Updater] Error stack:', error.stack);
  if (mainWindow) {
    sendToMain('update-error', error.message);
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow) {
    sendToMain('update-download-progress', {
      percent: Math.round(progressObj.percent),
      bytesPerSecond: progressObj.bytesPerSecond,
      total: progressObj.total,
      transferred: progressObj.transferred
    });
  }
});

autoUpdater.on('update-downloaded', () => {
  console.log('[Updater] Обновление загружено');
  if (mainWindow) {
    sendToMain('update-downloaded', {
      version: updateInfo?.version || 'unknown'
    });
  }
});

// IPC обработчики для обновления
ipcMain.on('check-for-updates', async () => {
  console.log('[IPC] Проверка обновлений... (app version:', app.getVersion(), ')');
  try {
    const result = await autoUpdater.checkForUpdates();
    console.log('[Updater] Проверка завершена:', result && result.updateInfo
      ? result.updateInfo.version : 'без результата');
  } catch (err) {
    // Окну ошибку уже отправил autoUpdater.on('error'): electron-updater и
    // генерирует событие, и отклоняет обещание. Вторая отправка отсюда
    // доходила до окна дублем — здесь только строка в журнал
    console.warn('[Updater] Проверка не удалась:', err?.message || err);
  }
});

/**
 * Установка обновления.
 *
 * Перед запуском установщика приложение нужно разобрать до конца. Иначе
 * NSIS натыкается на занятые файлы и говорит «Не удалось удалить старые
 * файлы приложения»: закрытие обычным путём оставляет и трей, и скрытые
 * окна (уведомление о награде, окно отписки), и перехваченные глобальные
 * клавиши, а окно приложения вдобавок умеет прятаться в трей вместо
 * закрытия — процесс продолжает жить и держать файлы.
 *
 * Выйти обязан именно quitAndInstall(true, true): только он передаёт
 * установщику --force-run, и приложение запускается снова. Раньше разбор
 * окон будил window-all-closed, тот звал app.quit() раньше таймера, и
 * обновление ставил собственный хук electron-updater «при выходе» — без
 * перезапуска. Пользователь нажимал «Установить и перезагрузить», уходил,
 * а фарминг стоял, пока приложение не откроют руками.
 */
let installingUpdate = false;

/**
 * Просит окно сохранить сессию (app-closing) и ждёт ответа farming-saved,
 * но не дольше timeoutMs: зависшее окно не должно держать выход.
 */
function waitForRendererSave(timeoutMs) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) { resolve(false); return; }
    let timer = null;
    const finish = (saved) => {
      clearTimeout(timer);
      ipcMain.removeListener('farming-saved', onSaved);
      resolve(saved);
    };
    const onSaved = () => finish(true);
    ipcMain.on('farming-saved', onSaved);
    timer = setTimeout(() => finish(false), timeoutMs);
    sendToMain('app-closing');
  });
}

/**
 * Сохранение сессии перед выходом — одно на весь выход.
 *
 * Закрытие крестиком, «Выход» в трее и установка обновления ведут сюда
 * же: раньше окно получало app-closing дважды (из 'close' и из
 * before-quit), а закрывалось, не дожидаясь записи, — время по играм и итог
 * сессии терялись, запись сессии оставалась «активной» до следующего
 * запуска. После ответа (или 3 секунд) exitSaveDone пропускает закрытие
 * дальше без задержки.
 */
let exitSave = null;
let exitSaveDone = false;

function saveBeforeExit() {
  if (!exitSave) {
    exitSave = waitForRendererSave(3000).then((saved) => {
      exitSaveDone = true;
      if (!saved && mainWindow && !mainWindow.isDestroyed()) {
        console.log('[Выход] Окно не подтвердило сохранение за 3 с — закрываю');
      }
      return saved;
    });
  }
  return exitSave;
}

ipcMain.on('install-update', async () => {
  if (installingUpdate) return;
  installingUpdate = true;
  console.log('[IPC] Готовлюсь к установке обновления…');

  app.isQuitting = true;

  // Сначала сессия: после перезапуска фарминг продолжится с того же места.
  // before-quit этого уже не сделает — к тому моменту окна разобраны.
  // Общее с обычным выходом: если закрытие уже начато, второй app-closing
  // окну не шлём, а ждём тот же ответ
  await saveBeforeExit();

  try { unregisterShortcuts(); } catch (e) { /* не повод останавливаться */ }

  try {
    // Переменная объявлена без значения, поэтому проверяем именно число
    if (typeof powerSaveBlockerId === 'number' && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
  } catch (e) { /* не повод останавливаться */ }

  try {
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = null;
  } catch (e) { /* не повод останавливаться */ }

  // Снимаем обработчики закрытия: у главного окна на 'close' висит
  // сворачивание в трей, и без этого оно просто спрячется
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.removeAllListeners('close');
      win.destroy();
    } catch (e) { /* окно могло уже закрыться */ }
  }

  // Небольшая пауза: дать процессам отрисовки закрыться и отпустить файлы
  setTimeout(() => {
    console.log('[IPC] Запускаю установщик');
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (e) {
      console.error('[IPC] Установщик не запустился:', e?.message || e);
    }
    // Если установщик не стартовал (файл обновления пропал), quitAndInstall
    // молча ничего не делает, а окон уже нет — процесс висел бы невидимым.
    // При удачном запуске приложение закроется раньше этого таймера.
    setTimeout(() => {
      console.warn('[IPC] Установка не началась — закрываю приложение');
      installingUpdate = false;
      app.quit();
    }, 5000);
  }, 800);
});

ipcMain.on('download-update', async () => {
  console.log('[IPC] Загрузка обновления...');
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    // Окну ошибку отправил autoUpdater.on('error') — см. check-for-updates
    console.warn('[Updater] Загрузка обновления не удалась:', error?.message || error);
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

/**
 * Заметки о выпусках берутся с GitHub, а не хранятся внутри приложения.
 *
 * Иначе установленная версия знала бы только о себе: посмотреть, что
 * изменилось в предыдущих патчах, было бы неоткуда, а текст пришлось бы
 * дублировать в коде при каждом релизе.
 *
 * @param {string|null} version - конкретная версия ('1.0.15') или null
 *                                для списка последних выпусков
 */
ipcMain.handle('fetch-release-notes', async (event, version = null) => {
  const https = require('https');

  const path = version
    ? `/repos/Agrysif/WatchTwitch/releases/tags/v${encodeURIComponent(version)}`
    : '/repos/Agrysif/WatchTwitch/releases?per_page=10';

  return new Promise((resolve) => {
    const req = httpsRequestWithTimeout({
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'WatchTwitch',
        'Accept': 'application/vnd.github+json'
      }
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.warn('[Заметки] GitHub ответил', res.statusCode);
          resolve({ success: false, error: 'Код ответа ' + res.statusCode });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const list = Array.isArray(parsed) ? parsed : [parsed];

          resolve({
            success: true,
            releases: list
              // Pre-release не показываем: по RELEASE.md так помечают
              // отозванный релиз, и «Что нового» не должно выдавать его за
              // вышедшую версию
              .filter(r => r && !r.draft && !r.prerelease)
              .map(r => ({
                version: String(r.tag_name || '').replace(/^v/, ''),
                name: r.name || r.tag_name,
                body: r.body || '',
                publishedAt: r.published_at || null
              }))
          });
        } catch (e) {
          resolve({ success: false, error: 'Не удалось разобрать ответ' });
        }
      });
    });

    req.on('error', (e) => {
      console.warn('[Заметки] Ошибка запроса:', e.message);
      resolve({ success: false, error: e.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Превышено время ожидания' });
    });

    req.end();
  });
});

ipcMain.handle('get-webview-preload-path', () => {
  const preloadPath = path.join(__dirname, 'renderer', 'js', 'webview-traffic-preload.js');
  return pathToFileURL(preloadPath).toString();
});

// Текущие показатели трафика для интерфейса.
// Раньше trafficData жил только в main-процессе и в renderer не отдавался вообще —
// поэтому в статистике всегда было пусто.
ipcMain.handle('get-traffic-stats', () => getTrafficSnapshot());

// Вызывается при старте сессии фарминга, чтобы считать расход от этой точки.
ipcMain.handle('reset-traffic-session', () => resetTrafficSession());

// Обработка автоматического сбора сундуков
ipcMain.on('chest-claimed', (_event, data) => {
  console.log('[Chest] Автоматический сбор сундука:', data.timestamp);
});

/**
 * Чтение страниц приложения для роутера.
 *
 * Путь приходит из окна и раньше склеивался с папкой приложения как есть:
 * «../» выводил за её пределы, и код окна (или скрипт, внедрённый в него
 * через чужие данные) читал любой файл пользователя — в том числе
 * config.json с токенами Twitch. Законный вызов один: роутер просит
 * renderer/pages/*.html, всё остальное отклоняем. Полный путь в ответ не
 * отдаём — окну он ни к чему.
 */
const READABLE_PAGES_DIR = path.join(__dirname, 'renderer', 'pages');

ipcMain.handle('read-file', async (event, relativePath) => {
  const requested = String(relativePath || '');
  const fullPath = path.resolve(__dirname, requested);
  if (!fullPath.startsWith(READABLE_PAGES_DIR + path.sep) || path.extname(fullPath).toLowerCase() !== '.html') {
    console.warn('[IPC] read-file: чтение вне страниц приложения отклонено:', requested.slice(0, 200));
    return { success: false, error: 'denied' };
  }

  try {
    return { success: true, content: fs.readFileSync(fullPath, 'utf-8') };
  } catch (e) {
    console.error('[IPC] Не удалось прочитать страницу:', requested, e.code || e.message);
    return { success: false, error: e.code === 'ENOENT' ? 'not found' : 'read error' };
  }
});

/**
 * Автозапуск с Windows.
 *
 * Раньше при каждом старте приложение само выставляло автозапуск по
 * значению settings.autostart — и выключало его, если там лежал false.
 * А false туда регулярно записывала синхронизация настроек из окна, где
 * у автозапуска было значение по умолчанию. Итог: запись в реестре
 * пропадала сама, и после очередного обновления приложение переставало
 * запускаться с системой.
 *
 * Теперь правда одна — сама Windows. Флаг меняет только переключатель
 * (set-autostart), синхронизация его не трогает, а при старте автозапуск
 * лишь подтверждается, если включён, — чтобы путь к exe после
 * обновления оставался верным. Выключать его при старте нельзя.
 */
const AUTOSTART_ARGS = ['--autostart'];
// Имя записи в реестре задаём явно: без него Electron берёт идентификатор
// приложения, а тот до и после готовности приложения разный — так
// появлялись две записи, и выключение убирало только одну
const AUTOSTART_NAME = 'WatchTwitch';
const AUTOSTART_LEGACY_NAMES = ['electron.app.WatchTwitch', 'WatchTwitch.App', 'com.watchtwitch.app'];

// Путь к exe — в кавычках. Без них и Electron, и сама Windows режут
// строку по первому пробелу: при установке в «C:\Program Files\…» поиск
// записи превращался в поиск «C:\Program» и находил чужие программы с
// таким же обрезком. Так пишет и сам Electron, когда путь не задан.
const AUTOSTART_EXE = '"' + process.execPath + '"';

function loginItemOptions(extra = {}) {
  return { path: AUTOSTART_EXE, args: AUTOSTART_ARGS, name: AUTOSTART_NAME, ...extra };
}

/**
 * Запись автозапуска с данным именем, или null.
 *
 * Electron находит записи по пути к exe, а различает их только по имени,
 * поэтому смотрим лишь свою. Ищем и с кавычками (так пишем теперь), и без
 * них (так писали прежние версии): чужие записи отсекает имя.
 */
function findLoginItem(name) {
  for (const lookupPath of [AUTOSTART_EXE, process.execPath]) {
    try {
      const state = app.getLoginItemSettings({ path: lookupPath, args: AUTOSTART_ARGS, name });
      const item = (state.launchItems || []).find(entry => entry.name === name);
      if (item) return item;
    } catch (e) {
      // реестр недоступен — записи для нас нет
    }
  }
  return null;
}

/** Есть ли включённая запись под одним из старых имён. */
function hasLegacyAutostart() {
  return AUTOSTART_LEGACY_NAMES.some(name => loginItemEnabled(name));
}

/** Убирает записи автозапуска под старыми именами. */
function removeLegacyAutostart() {
  for (const name of AUTOSTART_LEGACY_NAMES) {
    try {
      app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: AUTOSTART_ARGS, name });
      app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, name });
    } catch (e) { /* записи нет */ }
  }
}

/**
 * Включена ли запись — только по своей записи. openAtLogin на Windows при
 * заданном имени всегда false (проверено замером), а
 * executableWillLaunchAtLogin отвечает «да» за любую запись с тем же
 * путём, в том числе за чужую: при пробеле в пути выключенный автозапуск
 * читался как включённый и при следующем старте записывался снова.
 * enabled === false — запись выключена в Диспетчере задач или Параметрах.
 */
function loginItemEnabled(name) {
  return findLoginItem(name)?.enabled === true;
}

function isAutostartEnabled() {
  return loginItemEnabled(AUTOSTART_NAME);
}

function setAutostart(enabled) {
  if (!app.isPackaged) {
    // Из исходников exe — это electron.exe без приложения: регистрировать нечего
    console.log('[Автозапуск] В режиме разработки не меняется, хотели:', enabled);
    store.set('settings.autostart', !!enabled);
    return !!enabled;
  }
  removeLegacyAutostart();
  app.setLoginItemSettings(loginItemOptions({ openAtLogin: !!enabled }));
  const actual = isAutostartEnabled();
  store.set('settings.autostart', actual);
  console.log('[Автозапуск]', actual ? 'включён' : 'выключен');
  return actual;
}

if (app.isPackaged) {
  // Автозапуск под старым именем — значит, пользователь его включал, даже
  // если флаг в настройках затёрла прежняя синхронизация. Переносим.
  if (hasLegacyAutostart()) {
    console.log('[Автозапуск] Найдена запись под старым именем — переношу');
    store.set('settings.autostart', true);
  }
  removeLegacyAutostart();
  const ownItem = findLoginItem(AUTOSTART_NAME);
  if (ownItem && ownItem.enabled === false) {
    // Запись есть, но выключена в Диспетчере задач или Параметрах Windows.
    // Подтверждение ниже включило бы её обратно: Electron по умолчанию
    // снимает этот запрет — то есть молча отменяло решение пользователя.
    if (store.get('settings.autostart') !== false) {
      console.log('[Автозапуск] Выключен в Windows — оставляю выключенным');
    }
    store.set('settings.autostart', false);
  } else if (store.get('settings.autostart') === true) {
    app.setLoginItemSettings(loginItemOptions({ openAtLogin: true }));
  }
}

/**
 * Запуск автозапуском Windows: приложение работает фоном, а не выскакивает
 * посреди рабочего стола и не забирает ввод у того, что человек уже открыл.
 * Заставки нет; окно остаётся в трее, если сворачивание в трей включено,
 * иначе — свёрнутым на панели задач без перехвата фокуса.
 */
const launchedByAutostart = process.argv.includes('--autostart');
if (launchedByAutostart) {
  console.log('[Запуск] Запущено автозапуском Windows');
}

// Когда показана заставка: от этого момента считается её минимальное время
let splashShownAt = 0;
const SPLASH_MIN_MS = 1500;

/**
 * Этапы загрузки на заставке. Раньше под полосой всё время висело
 * «Загрузка приложения…» с бесконечной анимацией: по ней не понять, идёт
 * ли запуск или завис. Теперь полоса доходит до доли текущего этапа:
 *   0 — заставка показана (ставит сама заставка), 1 — грузится интерфейс,
 *   2 — интерфейс загружен, окно восстанавливает сессию, 3 — готово.
 * Этап мог прийти раньше, чем заставка загрузилась, — тогда он
 * применяется по её did-finish-load. Этапы только растут.
 */
let splashStage = null;

function setSplashStage(index, text, percent) {
  if (splashStage && splashStage.index >= index) return;
  splashStage = { index, text, percent };
  applySplashStage();
}

function applySplashStage() {
  if (!splashWindow || splashWindow.isDestroyed() || !splashStage) return;
  const contents = splashWindow.webContents;
  if (contents.isLoading()) return;
  const { index, text, percent } = splashStage;
  contents.executeJavaScript(
    'window.splash && window.splash.stage(' + index + ', ' + JSON.stringify(text) + ', ' + percent + ')'
  ).catch(() => { /* заставка уже закрылась */ });
}

/** Заставка гаснет (180 мс на её стороне) и закрывается следом. */
function closeSplash() {
  const win = splashWindow;
  splashWindow = null;
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript('window.splash && window.splash.done()').catch(() => {});
  setTimeout(() => {
    if (!win.isDestroyed()) win.close();
  }, 200);
}

function createSplashWindow() {
  splashShownAt = Date.now();
  splashStage = null;
  // Окно больше карточки (380×260): вокруг место под мягкую тень, иначе
  // её обрезал бы край окна. Раньше градиент заливал весь прямоугольник
  // окна, и углы у заставки были острыми
  splashWindow = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Версия — в углу заставки: по снимку экрана сразу видно, что запущено
  splashWindow.loadFile('splash.html', { query: { v: app.getVersion() } });
  splashWindow.webContents.on('did-finish-load', () => applySplashStage());
  splashWindow.center();
}

/**
 * Размер и положение окна между запусками.
 *
 * Раньше окно каждый раз открывалось по центру основного монитора в
 * размере 1200×800: изменённый размер, развёрнутость и второй монитор
 * забывались. Теперь обычные (не развёрнутые) границы и флаг
 * «развёрнуто» лежат в windowState. Если монитор с сохранённым окном
 * отключили, окно открывается по центру основного экрана — за краем его
 * было бы не достать.
 */
const WINDOW_STATE_KEY = 'windowState';
const WINDOW_MIN_WIDTH = 1000;
const WINDOW_MIN_HEIGHT = 600;

function isWindowRectOnScreen(rect) {
  const { screen } = require('electron');
  return screen.getAllDisplays().some(({ workArea: area }) => {
    const overlap = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
    // Верх окна — там заголовок, за который его перетаскивают, — должен
    // быть на экране, иначе окно не сдвинуть мышью
    const topInside = rect.y >= area.y - 20 && rect.y <= area.y + area.height - 60;
    return overlap >= 200 && topInside;
  });
}

function loadWindowState() {
  try {
    const saved = store.get(WINDOW_STATE_KEY);
    if (!saved || typeof saved !== 'object') return null;

    const width = Math.round(Number(saved.width));
    const height = Math.round(Number(saved.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

    const state = {
      width: Math.max(WINDOW_MIN_WIDTH, width),
      height: Math.max(WINDOW_MIN_HEIGHT, height),
      maximized: saved.maximized === true
    };

    const x = Math.round(Number(saved.x));
    const y = Math.round(Number(saved.y));
    if (Number.isFinite(x) && Number.isFinite(y) &&
        isWindowRectOnScreen({ x, y, width: state.width, height: state.height })) {
      state.x = x;
      state.y = y;
    } else {
      // Позиции нет на экранах: по центру основного, не больше его самого
      const { screen } = require('electron');
      const area = screen.getPrimaryDisplay().workArea;
      state.width = Math.min(state.width, Math.max(WINDOW_MIN_WIDTH, area.width));
      state.height = Math.min(state.height, Math.max(WINDOW_MIN_HEIGHT, area.height));
    }
    return state;
  } catch (e) {
    console.warn('[Окно] Сохранённое положение не прочитано:', e.message);
    return null;
  }
}

function trackWindowState(win) {
  let timer = null;

  const save = () => {
    clearTimeout(timer);
    timer = null;
    // Свёрнутое и спрятанное в трей окно не пишем: Windows уносит
    // свёрнутое за край экрана, а флаг «развёрнуто» у невидимого окна
    // ненадёжен. Остаётся запись, сделанная, пока окно было на виду
    if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible()) return;
    try {
      const bounds = win.getNormalBounds();
      store.set(WINDOW_STATE_KEY, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: win.isMaximized()
      });
    } catch (e) {
      console.warn('[Окно] Положение не сохранено:', e.message);
    }
  };

  // Перетаскивание шлёт move десятки раз в секунду — пишем по окончании
  const saveLater = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 1000);
  };

  win.on('resize', saveLater);
  win.on('move', saveLater);
  win.on('maximize', saveLater);
  win.on('unmaximize', saveLater);
  win.on('close', save);
}

function createMainWindow() {
  const savedState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: savedState?.width || 1200,
    height: savedState?.height || 800,
    ...(savedState && Number.isFinite(savedState.x) ? { x: savedState.x, y: savedState.y } : {}),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    backgroundColor: '#0e0e10',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      enableRemoteModule: false,
      sandbox: false,
      backgroundThrottling: false // Отключаем throttling в фоне
    },
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false // Не показываем окно сразу
  });

  mainWindow.loadFile('renderer/index.html');
  setSplashStage(1, 'Загружаю интерфейс…', 40);
  mainWindow.webContents.once('did-finish-load', () => setSplashStage(2, 'Восстанавливаю сессию…', 75));
  trackWindowState(mainWindow);
  trackMainWindowFocus(mainWindow);

  // Предупреждения и ошибки окна — в общий лог, и в собранной версии тоже.
  // Вся логика фарминга живёт в окне: раньше это делалось только при
  // запуске из исходников, и у пользователя тихая остановка фарминга из-за
  // ошибки в окне не оставляла в app.log ни строчки. Обычные сообщения не
  // пишем, а одинаковые строки — не чаще раза в минуту, с числом повторов:
  // ошибка в таймере иначе забила бы лог за час.
  // Electron 36 передаёт параметры в объекте события; старую форму с
  // отдельными аргументами оставляем для совместимости
  const rendererLogSeen = new Map();
  mainWindow.webContents.on('console-message', (event, legacyLevel, legacyMessage, legacyLine, legacySource) => {
    const modern = event && typeof event.message === 'string';
    const message = modern ? event.message : legacyMessage;
    const line = modern ? event.lineNumber : legacyLine;
    const sourceId = modern ? event.sourceId : legacySource;
    const level = modern ? event.level : (legacyLevel === 3 ? 'error' : (legacyLevel === 2 ? 'warning' : 'info'));
    if (level !== 'warning' && level !== 'error') return;

    const source = String(sourceId || '').split('/').pop();
    const text = '[Renderer:' + (level === 'error' ? 'error' : 'warn') + '] ' +
      String(message).slice(0, 1000) + ' (' + source + ':' + line + ')';

    const now = Date.now();
    const seen = rendererLogSeen.get(text);
    if (seen && now - seen.at < 60 * 1000) {
      seen.repeats++;
      return;
    }
    if (rendererLogSeen.size > 300) rendererLogSeen.clear();
    rendererLogSeen.set(text, { at: now, repeats: 0 });

    const repeats = seen?.repeats ? ' (за минуту повторов: ' + seen.repeats + ')' : '';
    if (level === 'error') console.error(text + repeats);
    else console.warn(text + repeats);
  });

  // Трафик считаем только у webview с видео: само окно приложения
  // почти ничего не качает, а отладчик на нём — лишняя нагрузка
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    setupTrafficMonitoring(webContents);
  });

  // Показываем главное окно после загрузки и закрываем splash
  mainWindow.once('ready-to-show', () => {
    // Заставка видна не меньше SPLASH_MIN_MS с момента её показа, а не ещё
    // полторы секунды после готовности окна: окно грузится, пока заставка
    // уже на экране, и это время засчитывается
    const splashWait = (launchedByAutostart || !splashShownAt)
      ? 0
      : Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
    setSplashStage(3, 'Готово', 100);

    setTimeout(() => {
      // Главное окно показывается, пока заставка гаснет поверх него:
      // переход без пустого кадра между ними
      closeSplash();
      if (!mainWindow || mainWindow.isDestroyed()) return;

      if (launchedByAutostart) {
        // Развёрнутость при автозапуске применяем, когда окно откроют:
        // maximize() сам показывает и активирует окно, а здесь оно не должно
        // выскакивать. Без этого развёрнутое окно после каждого автозапуска
        // открывалось обычным, и первая же его подвижка записывала это в
        // windowState
        const win = mainWindow;
        const maximizeWhenOpened = () => setImmediate(() => {
          if (!win.isDestroyed() && win.isVisible() && !win.isMinimized() && !win.isMaximized()) {
            win.maximize();
          }
        });

        // Фоновый фарминг в скрытом окне уже работает — так же, как при
        // сворачивании в трей
        if (tray && store.get('settings.minimizeToTray', false)) {
          if (savedState?.maximized) win.once('show', maximizeWhenOpened);
          console.log('[Запуск] Автозапуск: окно остаётся в трее');
          return;
        }
        win.showInactive();
        win.minimize();
        if (savedState?.maximized) win.once('restore', maximizeWhenOpened);
        return;
      }

      // maximize() показывает скрытое окно сам, поэтому зовём его здесь, а
      // не при создании: иначе развёрнутое окно выскочило бы раньше времени
      if (savedState?.maximized) mainWindow.maximize();
      mainWindow.show();
      mainWindow.focus();
    }, splashWait);
  });

  // Открыть DevTools в режиме разработки
  // mainWindow.webContents.openDevTools(); // Временно для отладки
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (event) => {
    // Сворачиваем в трей при закрытии (если включено)
    const minimizeToTray = store.get('settings.minimizeToTray', false); // По умолчанию выключено

    if (!app.isQuitting && minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      // Показываем уведомление при первом сворачивании
      if (!store.get('trayNotificationShown', false)) {
        new Notification({
          title: 'WatchTwitch свёрнут в трей',
          body: 'Приложение работает в фоне. Нажмите на значок в трее, чтобы открыть окно.'
        }).show();
        store.set('trayNotificationShown', true);
      }
      return;
    }

    // Окно закрывается насовсем. Сначала окно сохраняет сессию (см.
    // saveBeforeExit), потом закрываем его уже без задержки.
    if (exitSaveDone || installingUpdate) return;
    event.preventDefault();
    const win = mainWindow;
    // Ожидание до 3 секунд не должно выглядеть как зависшая кнопка
    try { win.hide(); } catch (e) { /* окно уже разбирается */ }
    saveBeforeExit().then(() => {
      if (!win.isDestroyed()) win.close();
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Окно закрыто насовсем (в трей оно прячется, а не закрывается).
    // Раньше процесс жил дальше, пока не закроются служебные окна —
    // уведомление о награде (до 6,5 с) или окно отписки (до 40 с), — и
    // значок в трее всё это время висел, не реагируя на клики. Установка
    // обновления выходит сама, через quitAndInstall
    if (installingUpdate || process.platform === 'darwin') return;
    try {
      if (tray && !tray.isDestroyed()) tray.destroy();
      tray = null;
    } catch (e) { /* значок уже убран */ }
    app.quit();
  });
}

/**
 * Вывести главное окно вперёд: развернуть из свёрнутого, показать из
 * трея и отдать фокус. false — окна уже нет.
 */
function bringMainWindowToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

// Когда окно потеряло фокус: по этому времени клик по трею отличает окно,
// которое было впереди, от окна под другими программами
let mainWindowBlurAt = 0;
const TRAY_FOCUS_GRACE_MS = 400;

function trackMainWindowFocus(win) {
  win.on('blur', () => { mainWindowBlurAt = Date.now(); });
}

function createTray() {
  try {
    const candidates = [
      path.join(__dirname, 'assets', 'icon.png'),
      path.join(__dirname, 'assets', 'logo.png')
    ];
    const iconPath = candidates.find(p => fs.existsSync(p));

    if (!iconPath) {
      console.warn('Tray icon not found. Skipping tray creation.');
      return; // Do not create tray without a valid icon
    }

    tray = new Tray(iconPath);

    // Окна может уже не быть: его закрыли насовсем, а процесс ещё жив, пока
    // работают служебные окна. Раньше клик по трею тогда падал с TypeError
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Показать/Скрыть',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
            mainWindow.hide();
          } else {
            bringMainWindowToFront();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Открыть настройки',
        click: () => {
          if (!bringMainWindowToFront()) return;
          sendToMain('navigate-to-page', 'settings');
        }
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('WatchTwitch — фарминг остановлен');
    tray.setContextMenu(contextMenu);

    // Клик прячет окно, только если оно было впереди. Нажатие на трей само
    // снимает с окна фокус, поэтому «впереди» — это фокус, потерянный
    // мгновение назад. Окно под игрой или браузером раньше пряталось
    // первым кликом и показывалось только вторым
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const wasInFront = mainWindow.isVisible() && !mainWindow.isMinimized() &&
        (mainWindow.isFocused() || Date.now() - mainWindowBlurAt < TRAY_FOCUS_GRACE_MS);
      if (wasInFront) mainWindow.hide();
      else bringMainWindowToFront();
    });
  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

/**
 * Состояние фарминга в трее и на панели задач.
 *
 * Раньше значок в трее нёс неподвижную подпись, и чтобы узнать, идёт ли
 * фарминг и далеко ли до награды, приходилось разворачивать окно. Теперь
 * то же самое видно по наведению на значок, а прогресс — прямо на кнопке
 * панели задач.
 */
ipcMain.on('tray-status', (event, status) => {
  try {
    const active = !!status?.active;

    if (mainWindow && !mainWindow.isDestroyed()) {
      // Значение вне [0..1] убирает полосу; именно так её и гасим
      mainWindow.setProgressBar(active && status.percent >= 0 ? status.percent / 100 : -1);
    }

    if (!tray || tray.isDestroyed?.()) return;

    if (!active) {
      tray.setToolTip('WatchTwitch — фарминг остановлен');
      return;
    }

    const lines = ['WatchTwitch'];
    if (status.category) lines[0] += ' — ' + status.category;

    const details = [];
    if (Number.isFinite(status.percent)) details.push('дропсы ' + Math.round(status.percent) + '%');
    if (status.nextIn) details.push('следующая через ' + status.nextIn);
    if (details.length) lines.push(details.join(' · '));

    tray.setToolTip(lines.join('\n'));
  } catch (error) {
    console.warn('[Трей] Не удалось обновить состояние:', error.message);
  }
});

/**
 * Горячие клавиши, работающие поверх других окон.
 *
 * Фарминг идёт фоном, пока пользователь занят игрой или браузером, и
 * ради «остановить» приходилось искать окно приложения. Сочетания редкие
 * намеренно: глобальная клавиша перехватывается у всей системы, и занять
 * что-то ходовое было бы свинством.
 *
 * Если сочетание уже занято другой программой, Electron молча вернёт
 * false — поэтому о каждой неудаче сообщаем в журнал.
 */
const SHORTCUTS = [
  { accelerator: 'Control+Alt+F', action: 'toggle-farming', title: 'запуск и остановка' },
  { accelerator: 'Control+Alt+N', action: 'next-stream', title: 'другой стрим' },
  { accelerator: 'Control+Alt+W', action: 'toggle-window', title: 'показать или скрыть окно' }
];

// Сочетания, которые не удалось занять при последней регистрации. Раньше
// о них знал только журнал: пользователь жал клавиши, ничего не
// происходило, и причины было не понять. Настройки показывают их по
// get-shortcut-status
let failedShortcuts = [];

function registerShortcuts() {
  failedShortcuts = [];
  if (store.get('settings.globalShortcuts') === false) {
    console.log('[Клавиши] Отключены в настройках');
    return;
  }

  for (const item of SHORTCUTS) {
    const ok = globalShortcut.register(item.accelerator, () => {
      if (item.action === 'toggle-window') {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        // Прячем только окно, которое впереди. Окно под игрой раньше
        // пряталось первым нажатием и показывалось лишь вторым
        if (mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) mainWindow.hide();
        else bringMainWindowToFront();
        return;
      }
      sendToMain('shortcut', item.action);
    });

    if (!ok) {
      failedShortcuts.push(item.accelerator);
      console.warn('[Клавиши] Сочетание занято другой программой:', item.accelerator, '—', item.title);
    }
  }
}

function unregisterShortcuts() {
  failedShortcuts = [];
  globalShortcut.unregisterAll();
}

ipcMain.handle('get-shortcut-status', () => ({
  enabled: store.get('settings.globalShortcuts') !== false,
  failed: [...failedShortcuts]
}));

ipcMain.on('set-global-shortcuts', (event, enabled) => {
  store.set('settings.globalShortcuts', !!enabled);
  unregisterShortcuts();
  if (enabled) registerShortcuts();
});

// Оставлять перехват клавиш после закрытия приложения нельзя
app.on('will-quit', unregisterShortcuts);

// OAuth авторизация Twitch
let authServer = null;

// Ответа браузера ждём не дольше трёх минут. Раньше ожидание было
// бессрочным: закрытая вкладка входа оставляла кнопку «в работе» навсегда
const AUTH_WAIT_MS = 3 * 60 * 1000;

// Отмена текущей попытки входа. Новая попытка закрывала сервер прежней, а
// её обещание не завершалось никогда: вызов из окна висел вечно
let cancelAuthAttempt = null;

/**
 * Метки state выданных попыток входа (значение — когда выдана).
 *
 * Без метки сервер принимал любой code, пришедший на localhost:3000, и мог
 * тихо привязать к приложению чужой аккаунт Twitch (подделка входа).
 * Принимаем только ответ на ссылку, которую открыло само приложение.
 * Метки прежних попыток годятся, пока не истекли: двойной клик открывает
 * две вкладки, и вход в первой из них не должен отклоняться.
 */
const authStates = new Map();

function issueAuthState() {
  const now = Date.now();
  for (const [state, issuedAt] of authStates) {
    if (now - issuedAt > AUTH_WAIT_MS) authStates.delete(state);
  }
  const state = crypto.randomBytes(16).toString('hex');
  authStates.set(state, now);
  return state;
}

function isKnownAuthState(state) {
  const issuedAt = typeof state === 'string' ? authStates.get(state) : undefined;
  return issuedAt !== undefined && Date.now() - issuedAt <= AUTH_WAIT_MS;
}

// Текст из ответа Twitch попадает в HTML страницы входа только экранированным
function escapeHtmlText(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/**
 * Сервер для ответа браузера — только на петлевых адресах.
 *
 * listen(3000) без адреса открывал порт всей локальной сети. Браузер идёт
 * на localhost, а это ::1 или 127.0.0.1 — смотря какой браузер, — поэтому
 * слушаем оба. Нет IPv6 — хватает 127.0.0.1. Любой из адресов занят
 * другой программой — это «порт занят»: браузер мог бы прийти к ней.
 */
function createLoopbackServer(handler) {
  const servers = [];
  return {
    listen(port, onListening, onError) {
      let listening = false;
      const done = () => {
        if (listening) return;
        listening = true;
        onListening();
      };
      const v4 = http.createServer(handler);
      servers.push(v4);
      v4.on('error', (err) => {
        if (!listening) onError(err);
        else console.warn('[Вход] Сервер входа:', err?.code || err?.message);
      });
      v4.listen(port, '127.0.0.1', () => {
        const v6 = http.createServer(handler);
        servers.push(v6);
        v6.on('error', (err) => {
          if (listening) console.warn('[Вход] Сервер входа (IPv6):', err?.code || err?.message);
          else if (err?.code === 'EADDRINUSE') onError(err);
          else done(); // IPv6 выключен: браузер придёт на 127.0.0.1
        });
        v6.listen(port, '::1', done);
      });
    },
    close() {
      for (const server of servers) {
        try { server.close(); } catch (e) { /* уже закрыт */ }
      }
    }
  };
}

function startAuthServer(onListening) {
  let cancel = null;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    // Прежняя попытка завершается явно: её сервер закрывается, а вызов из
    // окна получает ответ вместо вечного ожидания
    if (cancelAuthAttempt) {
      cancelAuthAttempt(new Error('Открыта новая вкладка входа — завершите вход в ней'));
    }
    // Сервер удачной попытки живёт ещё 2 секунды, пока браузер дочитывает
    // страницу, и держит порт: новая попытка в это время получила бы
    // «порт занят» от самой себя
    if (authServer) {
      authServer.close();
      authServer = null;
    }

    let timer = null;
    let settled = false;
    let server = null;
    // Закрываем только свой сервер: к этому времени authServer может
    // принадлежать уже следующей попытке
    const closeServer = () => {
      if (authServer === server) authServer = null;
      server.close();
    };
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      if (cancelAuthAttempt === cancel) cancelAuthAttempt = null;
    };
    const resolve = (value) => {
      if (settled) return;
      finish();
      resolvePromise(value);
    };
    const reject = (error) => {
      if (settled) return;
      finish();
      closeServer();
      rejectPromise(error);
    };
    cancel = reject;
    cancelAuthAttempt = cancel;

    server = authServer = createLoopbackServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);

      if (parsedUrl.pathname === '/auth/callback') {
        const { code, error, state } = parsedUrl.query;

        // Ответ не на нашу ссылку (или на очень старую) — не принимаем, но
        // и попытку не обрываем: настоящий ответ может прийти следом
        if (!isKnownAuthState(state) || (!code && !error)) {
          console.warn('[Вход] Ответ браузера без верной метки входа — пропускаю');
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Ссылка входа устарела. Вернитесь в WatchTwitch и нажмите «Войти через Twitch» ещё раз.');
          return;
        }

        if (error) {
          // На странице и в приложении — понятная фраза, а не код из адреса
          // возврата («access_denied»). Сам код в страницу не подставляем:
          // это текст из адресной строки, и разметку в нём браузер выполнил бы
          const message = error === 'access_denied' ? 'Вход отменён в браузере' : 'Twitch отклонил вход';
          console.warn('[Вход] Twitch вернул ошибку:', String(error).slice(0, 100));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ошибка авторизации</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #1e1e2e 0%, #0e0e10 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #efeff1;
    }
    .container { text-align: center; }
    .error-icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: rgba(255, 68, 68, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .error-icon svg { width: 48px; height: 48px; stroke: #ff4444; }
    h1 { font-size: 32px; margin-bottom: 12px; color: #ff4444; }
    p { color: #adadb8; font-size: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    </div>
    <h1>Ошибка авторизации</h1>
    <p>${message}</p>
  </div>
</body>
</html>`);
          reject(new Error(message));
          return;
        }

        if (code) {
          // Обмениваем code на token сразу, без промежуточной страницы загрузки
          try {
            // Обмен code на access token
            const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                client_id: TWITCH_CLIENT_ID,
                client_secret: TWITCH_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI
              })
            });

            const tokenData = await tokenResponse.json();

            if (tokenData.access_token) {
              // Получаем информацию о пользователе
              const userResponse = await fetch('https://api.twitch.tv/helix/users', {
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'Client-Id': TWITCH_CLIENT_ID
                }
              });

              const userData = await userResponse.json();
              const user = userData.data[0];

              // Сохраняем токен и данные пользователя
              // Токены — зашифрованными (см. sealSecret)
              store.set('oauth', {
                accessToken: sealSecret(tokenData.access_token),
                refreshToken: sealSecret(tokenData.refresh_token),
                expiresIn: tokenData.expires_in,
                expiresAt: Date.now() + (tokenData.expires_in * 1000),
                scopes: tokenData.scope,
                user: {
                  id: user.id,
                  login: user.login,
                  displayName: user.display_name,
                  email: user.email,
                  profileImageUrl: user.profile_image_url
                }
              });

              // Показываем страницу успеха
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Авторизация успешна</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #1e1e2e 0%, #0e0e10 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #efeff1;
    }
    .container {
      text-align: center;
      animation: slideUp 0.5s ease-out;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .checkmark {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: rgba(145, 71, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
    .checkmark svg {
      width: 48px;
      height: 48px;
      stroke: #9147ff;
    }
    h1 {
      font-size: 32px;
      margin-bottom: 12px;
      font-weight: 700;
    }
    p {
      color: #adadb8;
      font-size: 16px;
      margin-bottom: 8px;
    }
    .user-info {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.05);
      padding: 12px 20px;
      border-radius: 8px;
      margin: 20px auto;
    }
    .user-info img {
      width: 32px;
      height: 32px;
      border-radius: 50%;
    }
    .user-info span {
      font-weight: 600;
      color: #efeff1;
    }
    .countdown {
      color: #9147ff;
      font-size: 14px;
      margin-top: 20px;
    }
    /* Переливающийся светящийся фон */
    .glow-bg {
      position: fixed;
      inset: -60px;
      z-index: 0;
      pointer-events: none;
      filter: blur(42px) saturate(120%);
      opacity: 0.5;
      background:
        radial-gradient(600px 300px at 15% 20%, rgba(145,71,255,0.35), transparent 60%),
        radial-gradient(500px 260px at 85% 30%, rgba(0,229,122,0.25), transparent 60%),
        radial-gradient(700px 320px at 40% 90%, rgba(179,128,255,0.25), transparent 60%),
        linear-gradient(120deg, rgba(23,23,31,0.9), rgba(12,12,16,0.9));
      animation: gradientShift 16s ease-in-out infinite alternate;
    }
    @keyframes gradientShift {
      0%   { transform: translate3d(0,0,0) scale(1); }
      50%  { transform: translate3d(0,-10px,0) scale(1.03); }
      100% { transform: translate3d(0,10px,0) scale(1.01); }
    }
  </style>
</head>
<body>
  <div class="glow-bg" aria-hidden="true"></div>
  <div class="container">
    <div class="checkmark">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h1>Авторизация успешна!</h1>
    <p>Добро пожаловать в WatchTwitch</p>
    <div class="user-info">
      <img src="${escapeHtmlText(user.profile_image_url)}" alt="Avatar">
      <span>${escapeHtmlText(user.display_name)}</span>
    </div>
    <div class="countdown">Можете закрыть эту вкладку</div>
  </div>
</body>
</html>`);

              // Вход состоялся: прежние ссылки входа больше не принимаем
              authStates.clear();

              // Закрываем сервер через 2 секунды, чтобы браузер успел загрузить страницу
              setTimeout(closeServer, 2000);

              resolve(tokenData);
            } else {
              throw new Error('Не удалось получить access token');
            }
          } catch (error) {
            console.warn('[Вход] Обмен кода на токен не удался:', error?.message || error);
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Ошибка авторизации');
            reject(error);
          }
        }
      } else {
        // Браузер сам просит /favicon.ico: без ответа запрос висел
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end();
      }
    });

    timer = setTimeout(() => {
      console.warn('[Вход] Браузер не вернул ответ за 3 минуты — ожидание снято');
      reject(new Error('Вход не завершён — нажмите «Войти через Twitch» ещё раз'));
    }, AUTH_WAIT_MS);

    // Технический текст — в журнал, пользователю — что делать. Раньше в
    // окно уходило «listen EADDRINUSE: address already in use :::3000»
    server.listen(3000, () => {
      console.log('[Вход] Жду ответ браузера на localhost:3000');
      if (onListening) onListening();
    }, (err) => {
      console.warn('[Вход] Сервер входа не запустился:', err?.code || err?.message || err);
      reject(new Error(err?.code === 'EADDRINUSE'
        ? 'Порт 3000 занят другой программой — закройте её и повторите вход'
        : 'Не удалось начать вход — попробуйте ещё раз'));
    });
  });
  promise.cancel = cancel;
  return promise;
}

// Открытие окна авторизации Twitch
async function openTwitchAuthWindow() {
  let serverPromise = null;
  try {
    // Запускаем локальный сервер. Браузер открываем, только когда порт
    // 3000 наш: если его держит другая программа, Twitch вернул бы
    // пользователя к ней, а приложение ждало бы ответа впустую
    let markListening = null;
    const listening = new Promise(r => { markListening = r; });
    serverPromise = startAuthServer(() => markListening());
    await Promise.race([listening, serverPromise]);

    // Формируем URL авторизации. state — метка этой попытки: ответ без
    // неё сервер не примет (см. authStates)
    const authUrl = `https://id.twitch.tv/oauth2/authorize?` +
      `client_id=${TWITCH_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(SCOPES.join(' '))}&` +
      `state=${issueAuthState()}`;

    // Открываем в системном браузере (как просили)
    await shell.openExternal(authUrl);

    // Ждем результата от сервера
    await serverPromise;
    // Страница успеха сама закроется через 5 секунд (может потребоваться разрешение браузера)
    return { success: true, user: store.get('oauth.user') };
  } catch (error) {
    console.warn('[Вход] Вход не выполнен:', error?.message || error);
    // Отменяем свою попытку, а не текущую: попытка, которую сменила
    // новая, не должна закрыть сервер новой
    if (serverPromise) serverPromise.cancel(error);
    return { success: false, error: error.message };
  }
}

/**
 * Обновление OAuth-токена.
 *
 * Вход удаляется только тогда, когда id.twitch.tv прямо отказал (400/401 —
 * refresh-токен недействителен). Раньше его стирала любая ошибка, включая
 * обычный обрыв связи в момент обновления (токен живёт около 4 часов, за
 * ночь фарминга это почти наверняка): вход пропадал без сообщения и кнопки
 * входа. Сеть и 5xx — данные остаются, следующий вызов попробует снова.
 * Параллельные вызовы ждут один запрос: второй, отправленный со старым
 * refresh-токеном, мог бы получить отказ и стереть только что полученный.
 */
let refreshInFlight = null;

function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessTokenOnce().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function refreshAccessTokenOnce() {
  const oauth = getOAuth();
  if (!oauth || !oauth.refreshToken) {
    throw new Error('No refresh token available');
  }

  let response;
  try {
    response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken
      }),
      // Без срока fetch при обрыве ждал бы бесконечно
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(20000) : undefined
    });
  } catch (error) {
    console.warn('[OAuth] Токен не обновлён, нет связи — попробую позже:', error.message);
    throw error;
  }

  let tokenData = null;
  try { tokenData = await response.json(); } catch (e) { /* не JSON — разберёмся по коду ответа */ }

  if (response.ok && tokenData?.access_token) {
    store.set('oauth.accessToken', sealSecret(tokenData.access_token));
    store.set('oauth.refreshToken', sealSecret(tokenData.refresh_token || oauth.refreshToken));
    store.set('oauth.expiresAt', Date.now() + ((Number(tokenData.expires_in) || 0) * 1000));
    return tokenData.access_token;
  }

  if (response.status === 400 || response.status === 401) {
    console.warn('[OAuth] Twitch отклонил refresh-токен (' + response.status + '): ' +
      String(tokenData?.message || '').slice(0, 120) + ' — вход удалён');
    store.delete('oauth');
    throw new Error('Twitch отклонил refresh-токен');
  }

  console.warn('[OAuth] Токен не обновлён, Twitch ответил', response.status, '— попробую позже');
  throw new Error('Twitch не ответил: ' + response.status);
}

async function getValidAccessToken() {
  const oauth = getOAuth();

  if (!oauth || !oauth.accessToken) {
    return null;
  }

  // Проверяем, не истек ли токен
  if (oauth.expiresAt && Date.now() >= oauth.expiresAt - 60000) {
    // Токен истекает в течение минуты, обновляем
    try {
      return await refreshAccessToken();
    } catch (error) {
      return null;
    }
  }

  return oauth.accessToken;
}

// Получить статистику стрима
ipcMain.handle('get-stream-stats', async (event, channelLogin) => {
  const safeLogin = String(channelLogin || '').replace(/"/g, '');
  if (!safeLogin) return null;

  const postData = JSON.stringify({
    query: 'query { user(login: "' + safeLogin + '") { stream { title viewersCount createdAt game { id name } } channel { self { communityPoints { balance } } } } }'
  });

  const authToken = await getCookieAuthToken();
  const headers = {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'text/plain;charset=UTF-8',
    'Content-Length': Buffer.byteLength(postData)
  };
  if (authToken) headers['Authorization'] = 'OAuth ' + authToken;

  // С повтором: сетевой сбой не должен читаться как «канал офлайн» —
  // именно по этому признаку приложение решает, жив ли стрим.
  //
  // Ответ двух видов. null — Twitch ответил, и эфира нет. Исключение
  // (invoke отклоняется) — ответа нет: сеть, 5xx, HTML вместо JSON, ошибка
  // GraphQL. Раньше и то и другое было null, и минутный обрыв после
  // автозапуска выглядел как «канал офлайн»: ночная сессия бросалась.
  // Объект вида { offline: true } не годится — проверки «if (stats)» в
  // окне приняли бы его за эфир.
  let res = await twitchPost(postData, headers);

  // Вход отозван: Twitch отвечает 401 даже на публичные поля, и живой
  // эфир читался как «не знаю». Эфир и зрители видны и без входа — без
  // него пропадут только баллы (points: null)
  if (res.statusCode === 401 && headers['Authorization']) {
    const { Authorization, ...anonymous } = headers;
    res = await twitchPost(postData, anonymous);
  }

  if (!res.ok) {
    console.warn('[Стрим] Статистика недоступна:', res.error || res.statusCode);
    throw twitchUnavailable(res.error || res.statusCode);
  }

  let root;
  try {
    const parsed = JSON.parse(res.data);
    root = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (e) {
    console.warn('[Стрим] Ошибка разбора статистики:', e.message);
    throw twitchUnavailable('ответ не разобран');
  }

  const user = root?.data?.user;
  const stream = user?.stream;
  if (!stream) {
    // Пустой stream рядом с ошибкой — не «офлайн», а «не знаю»
    if (root?.errors?.length || !root?.data) {
      console.warn('[Стрим] Ошибка Twitch:', String(root?.errors?.[0]?.message || 'нет данных').slice(0, 120));
      throw twitchUnavailable('ошибка GraphQL');
    }
    return null;
  }

  return {
    // title нужен, когда канал выбран напрямую из подписок и не попал
    // в выдачу по игре: иначе карточка стрима осталась бы без названия
    title: stream.title || '',
    viewers: stream.viewersCount || 0,
    // Нет баланса (частичная ошибка, вход отозван) — null, а не 0: ноль
    // выглядел бы как настоящий баланс
    points: typeof user?.channel?.self?.communityPoints?.balance === 'number'
      ? user.channel.self.communityPoints.balance
      : null,
    uptime: calculateUptime(stream.createdAt),
    gameName: stream.game?.name || null,
    // id игры: по нему окно отличает «World of Tanks» от «World of Tanks
    // Console», которые по имени сходились как одна игра
    gameId: stream.game?.id ? String(stream.game.id) : null
  };
});

function calculateUptime(createdAt) {
  const start = new Date(createdAt);
  const now = new Date();
  const diff = Math.floor((now - start) / 1000);

  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  return hours + 'ч ' + minutes + 'м';
}
// Получить auth_token из cookies
async function getAuthToken() {
  // Сначала проверяем OAuth токен
  const accessToken = await getValidAccessToken();
  if (accessToken) {
    return accessToken;
  }

  // Если OAuth токена нет, пробуем получить из cookies (старый метод)
  if (!mainWindow) return null;

  try {
    // Получаем сессию из основного окна (webview использует partition 'persist:twitch')
    const { session } = require('electron');
    const twitchSession = session.fromPartition('persist:twitch');

    const cookies = await twitchSession.cookies.get({
      url: 'https://www.twitch.tv',
      name: 'auth-token'
    });

    if (cookies && cookies.length > 0) {
      return cookies[0].value;
    }
  } catch (e) {
    console.error('Error getting auth token:', e.message);
  }

  return null;
}

async function getCookieAuthToken() {
  try {
    const { session } = require('electron');
    const twitchSession = session.fromPartition('persist:twitch');
    const cookies = await twitchSession.cookies.get({
      url: 'https://www.twitch.tv',
      name: 'auth-token'
    });

    if (cookies && cookies.length > 0) {
      return cookies[0].value;
    }
  } catch (e) {
    console.error('Error getting cookie auth token:', e.message);
  }

  return null;
}

/**
 * Смена аккаунта Twitch.
 *
 * Кэш ответов Twitch (кампании, инвентарь, канал зачёта) и список уже
 * собранных сундуков к аккаунту не привязаны. После выхода из одного
 * аккаунта и входа в другой до 10 минут показывались чужие кампании и
 * прогресс, а автосбор пробовал награды прежнего аккаунта. Следим за
 * cookie auth-token в сессии webview: сменилось значение — сбрасываем.
 * Отметку об отозванном входе не трогаем: она привязана к значению токена
 * и для нового входа не действует сама.
 */
let knownTwitchAuthToken; // undefined — ещё не прочитан

function watchTwitchAccountChange() {
  const { session } = require('electron');
  let checkTimer = null;

  const check = async () => {
    const token = await getCookieAuthToken();
    if (knownTwitchAuthToken === undefined) {
      knownTwitchAuthToken = token;
      return;
    }
    if (token === knownTwitchAuthToken) return;
    const hadToken = !!knownTwitchAuthToken;
    knownTwitchAuthToken = token;
    invalidateTwitchCache();
    claimedChests.clear();
    console.log('[Вход] ' + (token ? (hadToken ? 'Сменился аккаунт Twitch' : 'Вход в Twitch выполнен') : 'Выход из Twitch') +
      ' — кэш ответов Twitch сброшен');
  };

  check().catch(() => {});
  try {
    session.fromPartition('persist:twitch').cookies.on('changed', (_event, cookie) => {
      if (cookie?.name !== 'auth-token') return;
      // Замена cookie приходит парой событий (удаление и запись), а Twitch
      // иногда переписывает её тем же значением — сверяем итог один раз
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => check().catch(() => {}), 500);
    });
  } catch (e) {
    console.warn('[Вход] Не удалось следить за сменой аккаунта Twitch:', e.message);
  }
}

/**
 * Реклама внутри webview Twitch.
 *
 * Чат подтягивает рекламные iframe amazon-adsystem: они грузят скрипты,
 * крутят анимации и едят процессор в фоне, где их никто не видит. Режем
 * только сторонние рекламные домены. Сервисы самого Twitch (spade,
 * video-edge, pubsub) не трогаем — через них засчитываются минуты
 * просмотра.
 */
function setupAdBlock() {
  const { session } = require('electron');
  const AD_URLS = [
    '*://*.amazon-adsystem.com/*',
    '*://*.doubleclick.net/*',
    '*://*.googlesyndication.com/*',
    '*://imasdk.googleapis.com/*',
    '*://*.scorecardresearch.com/*',
    '*://*.adnxs.com/*',
    '*://*.moatads.com/*',
    '*://*.adsrvr.org/*',
    '*://*.pubmatic.com/*',
    '*://*.rubiconproject.com/*',
    '*://*.casalemedia.com/*',
    '*://*.3lift.com/*',
    '*://*.openx.net/*'
  ];

  let blocked = 0;
  try {
    session.fromPartition('persist:twitch').webRequest.onBeforeRequest({ urls: AD_URLS }, (details, callback) => {
      blocked++;
      if (blocked === 1 || blocked % 200 === 0) {
        console.log('[Реклама] Заблокировано запросов:', blocked);
      }
      callback({ cancel: true });
    });
  } catch (e) {
    console.warn('[Реклама] Не удалось включить блокировку:', e.message);
  }
}

app.whenReady().then(() => {
  // Шифрование доступно только после готовности приложения
  sealStoredSecrets();
  setupAdBlock();
  watchTwitchAccountChange();

  // Игровой режим: первый опрос через 15 секунд, дальше каждые 20. Без
  // играющего стрима опрос пропускается (см. hasPlayingStream)
  setTimeout(checkRunningGame, 15000);
  setInterval(checkRunningGame, 20000);

  app.on('web-contents-created', (_event, contents) => {
    const type = contents.getType();
    if (type === 'window' || type === 'webview' || type === 'browserView') {
      setupTrafficMonitoring(contents);
    }
    
    // Для webview: устанавливаем preload ПЕРЕД загрузкой URL (через embedder window)
    if (type === 'window') {
      contents.on('will-attach-webview', (_event, webPreferences) => {
        const preloadPath = path.join(__dirname, 'renderer', 'js', 'webview-traffic-preload.js');
        webPreferences.preload = preloadPath;
        // В webview идёт чужой код: плеер Twitch с рекламой и расширениями,
        // и всё это в сессии с входом пользователя. Атрибуты из разметки
        // (disablewebsecurity, webpreferences="contextIsolation=false") такого
        // гостя ослабляли — проверка показала чтение чужих доменов и
        // локальных файлов. Защиту ставит main, разметка её не отменит.
        webPreferences.webSecurity = true;
        webPreferences.contextIsolation = true;
        webPreferences.nodeIntegration = false;
        console.log('[WebView] Preload set before attach:', preloadPath);
      });
    }

    // Всплывающие окна из webview (ссылки плеера, реклама, окно входа)
    // открывались окнами Electron с той же сессией Twitch. Окно приложению
    // не нужно ни одно: обычную ссылку отдаём системному браузеру, прочее
    // отклоняем.
    if (type === 'webview') {
      contents.setWindowOpenHandler(({ url: target }) => {
        if (/^https:\/\//i.test(String(target || ''))) {
          shell.openExternal(target).catch(e => console.warn('[WebView] Не открыть ссылку:', e.message));
        }
        return { action: 'deny' };
      });
    }
  });

  // При автозапуске заставка не нужна: она висела бы поверх всего
  if (!launchedByAutostart) createSplashWindow();

  // Главное окно грузится сразу, параллельно с заставкой. Раньше перед ним
  // стояли лишние полсекунды, а потом ещё полторы после готовности окна
  createMainWindow();
  createTray();
  registerShortcuts();
  announceSettingsRecovery();

  // Стартовую проверку обновлений делает окно (updater.js, через 3 с),
  // когда его слушатели уже на месте. Вторая проверка отсюда дублировала
  // запрос к GitHub и события, а без сети её отказ без catch попадал в
  // журнал как «необработанный отказ» главного процесса

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // Окна разобрала установка обновления: выходить будет quitAndInstall,
  // иначе установщик запустится без перезапуска приложения
  if (installingUpdate) return;
  if (powerSaveBlockerId) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }
  // На macOS приложения обычно остаются активными
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Выход через трей, систему или после закрытия окна.
 *
 * Раньше здесь стояла пауза в полсекунды внутри async-обработчика, но
 * Electron обработчик не ждёт: выход шёл сразу, а app-closing к тому же
 * уходил второй раз (первый — из 'close' окна). Теперь выход откладывается
 * до ответа окна (не дольше 3 с), app-closing уходит один раз на весь выход.
 * Из before-quit его не убрать: при выходе через трей 'close' окна приходит
 * уже после решения о выходе.
 */
let quitAfterSaveQueued = false;

app.on('before-quit', (event) => {
  app.isQuitting = true;

  // Установка обновления уже сохранила сессию и разобрала окна
  if (installingUpdate || exitSaveDone) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  event.preventDefault();
  if (quitAfterSaveQueued) return;
  quitAfterSaveQueued = true;
  try { mainWindow.hide(); } catch (e) { /* окно уже разбирается */ }
  saveBeforeExit().then(() => app.quit());
});

// IPC обработчики
ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('close-window', () => {
  mainWindow.close();
});

/**
 * Вывести окно на глаза: перед автовыключением ПК идёт отсчёт, который
 * можно прервать, но окно могло быть спрятано в трей или свёрнуто — тогда
 * компьютер выключался без видимого предупреждения. Windows не всегда
 * отдаёт фокус фоновому процессу, поэтому ещё и мигаем кнопкой на панели
 * задач, пока окно не получит фокус.
 */
ipcMain.handle('show-main-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (!mainWindow.isFocused()) {
    const win = mainWindow;
    win.flashFrame(true);
    win.once('focus', () => { if (!win.isDestroyed()) win.flashFrame(false); });
  }
  return true;
});

// OAuth IPC handlers
ipcMain.handle('start-twitch-auth', async () => {
  return await openTwitchAuthWindow();
});

ipcMain.handle('get-oauth-user', async () => {
  const oauth = getOAuth();
  if (!oauth) return null;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  const refreshed = getOAuth() || oauth;
  // Возвращаем весь oauth объект (включая tokens и user)
  return {
    accessToken,
    refreshToken: refreshed.refreshToken || oauth.refreshToken,
    expiresAt: refreshed.expiresAt || oauth.expiresAt,
    user: refreshed.user || oauth.user
  };
});

ipcMain.handle('logout-twitch', async () => {
  store.delete('oauth');
  return { success: true };
});

// Старый OAuth window (удалить позже, если не используется)
// Сохранение данных
/**
 * Слияние настроек интерфейса в electron-store.
 *
 * Именно слияние, а не запись целиком: в этом же ключе main-процесс держит
 * свои поля (settings.autostart для автозапуска, settings.notifications),
 * которых в настройках интерфейса нет. Перезапись объекта их стирала бы.
 */
ipcMain.handle('settings-merge', (event, partial) => {
  if (!partial || typeof partial !== 'object') return false;
  const current = store.get('settings', {});
  // Автозапуск принадлежит main: в окне у него значение по умолчанию false,
  // и слияние раньше молча затирало им включённый автозапуск
  const { autostart, ...rest } = partial;
  store.set('settings', { ...current, ...rest });
  return true;
});

/**
 * Что окну можно читать и писать в хранилище.
 *
 * store-get и store-set пропускали любой ключ, а пустой ключ отдавал файл
 * целиком, вместе со входом OAuth: любой код в окне (в том числе
 * внедрённый через непроверенный текст) мог прочитать или подменить всё.
 * Теперь только ключи, которыми пользуется интерфейс. oauth среди них нет:
 * он только для main. Настройки окно пишет через settings-merge, здесь их
 * можно только читать. Страницам Twitch в webview нужны лишь две настройки.
 */
const RENDERER_STORE_KEYS = new Set([
  'accounts', 'categories', 'statistics', 'blacklist', 'watchTimeStats', 'subscriptions',
  'campaignHistory', 'autoDropsModeEnabled', 'deletedCategories', 'activeSession',
  'subscriptions_priority_enabled', 'backupBeforeRestore',
  // Журнал событий (renderer/js/core/event-log.js): пишет и читает окно
  'eventLog'
]);
const WEBVIEW_STORE_KEYS = new Set(['settings.preferredStreamQuality', 'settings.autoClaimDrops']);
const deniedStoreKeys = new Set();

function storeKeyAllowed(event, key, write) {
  if (typeof key !== 'string' || !key) return false;
  let senderType = '';
  try { senderType = event?.sender?.getType?.() || ''; } catch (e) { /* окно закрывается */ }
  if (senderType === 'webview') return !write && WEBVIEW_STORE_KEYS.has(key);
  if (RENDERER_STORE_KEYS.has(key)) return true;
  return !write && (key === 'settings' || key.startsWith('settings.'));
}

function denyStoreKey(action, key) {
  const label = action + ' ' + String(key).slice(0, 60);
  // Каждый отказ пишем один раз, и не больше сотни разных: перебор ключей
  // не должен раздувать лог и память
  if (!deniedStoreKeys.has(label) && deniedStoreKeys.size < 100) {
    deniedStoreKeys.add(label);
    console.warn('[Хранилище] Окну недоступен ключ:', label);
  }
}

ipcMain.handle('store-get', (event, key) => {
  if (!storeKeyAllowed(event, key, false)) {
    denyStoreKey('чтение', key);
    return undefined;
  }
  if (key === 'accounts') return mapAccountSecrets(store.get('accounts'), openSecret);
  return store.get(key);
});

ipcMain.handle('store-set', (event, key, value) => {
  if (!storeKeyAllowed(event, key, true)) {
    denyStoreKey('запись', key);
    throw new Error('Ключ недоступен окну');
  }
  store.set(key, key === 'accounts' ? mapAccountSecrets(value, sealSecret) : value);
});

ipcMain.handle('store-delete', (event, key) => {
  if (!storeKeyAllowed(event, key, true)) {
    denyStoreKey('удаление', key);
    throw new Error('Ключ недоступен окну');
  }
  store.delete(key);
});

ipcMain.handle('set-process-label', (event, payload = {}) => {
  const { webContentsId, label } = payload || {};
  if (webContentsId) {
    const target = webContents.fromId(webContentsId);
    return setProcessLabel(target, label);
  }
  return setProcessLabel(event.sender, label);
});

ipcMain.handle('get-process-metrics', () => {
  const metrics = app.getAppMetrics();
  return metrics.map(metric => ({
    pid: metric.pid,
    type: metric.type,
    cpu: metric.cpu,
    memory: metric.memory,
    label: processLabels.get(metric.pid) || ''
  }));
});

// Открытие стрима
ipcMain.handle('open-stream', async (event, url, account = null) => {
  console.log('Stream requested:', url);

  // Не давать системе уснуть — но только пока стрим идёт. Раньше
  // блокировка ставилась при старте приложения и держалась всегда: экран
  // не гас, даже когда фарминг был остановлен. Гасить экран можно —
  // минуты просмотра идут по сети, а не по картинке.
  if (typeof powerSaveBlockerId !== 'number' || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    console.log('[Сон] Система не уснёт, пока идёт стрим');
  }

  // Просто возвращаем данные для отображения в webview
  // BrowserView не используется - webview в HTML обрабатывает отображение
  return { success: true, url, account };
});

/**
 * Блокировка сна следует за плеером, а не за кнопкой запуска: при
 * восстановлении сессии после перезапуска плеер загружается напрямую,
 * минуя open-stream, и без этого сигнала система могла уснуть посреди
 * ночного фарминга.
 */
ipcMain.on('keep-awake', (_event, on) => {
  const active = typeof powerSaveBlockerId === 'number' && powerSaveBlocker.isStarted(powerSaveBlockerId);
  if (on && !active) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    console.log('[Сон] Система не уснёт, пока идёт стрим');
  } else if (!on && active) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    console.log('[Сон] Плеер остановлен — системе снова можно спать');
  }
});

ipcMain.on('close-stream', () => {
  console.log('Stream closed');
  if (typeof powerSaveBlockerId === 'number' && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    console.log('[Сон] Стрим остановлен — системе снова можно спать');
  }
});

// Уведомления - кастомное окно
let dropNotificationWindow = null;

/**
 * Окно о полученной награде — карточка в правом нижнем углу экрана.
 *
 * Как живёт окно. Страница (renderer/notification.html) держит его 6 с и
 * закрывается сама; наведение курсора ставит часы на паузу (окно шлёт
 * hold-drop-notification, и main снимает свою страховку), после ухода
 * курсора — ещё хотя бы 2 с. Страховка main закрывает окно, если страница
 * не справилась: прежние 6,5 с от создания, 4 с после ухода курсора и
 * 30 с при любом раскладе.
 *
 * Несколько наград подряд. Раньше каждое новое окно молча закрывало
 * предыдущее, и из трёх наград, полученных разом, человек видел одну.
 * Теперь они ждут в очереди (enqueueDropNotification): пока в очереди
 * кто-то есть, текущее окно живёт 3,5 с; три и больше ждущих — одно
 * сводное окно «Получено 4 награды». createDropNotification сам по себе
 * ведёт себя по-прежнему (закрывает предыдущее окно): так его проверяет
 * tests/audit-notifications.cjs.
 *
 * Игра. Окно не забирает фокус (focusable: false, showInactive), но и
 * просто всплыть поверх полноэкранной игры — уже помеха. Пока включён
 * игровой режим, награды копятся и после игры приходят одним окном
 * «Пока вы играли».
 *
 * Песочница. Этот кусок файла — от «let dropNotificationWindow» до
 * «Старые системные уведомления» — тест исполняет отдельно, где есть
 * только require, BrowserWindow, ipcMain, console, Buffer, setTimeout и
 * clearTimeout. Поэтому store, mainWindow, gameModeState, sendToMain и
 * bringMainWindowToFront здесь — только через typeof, а electron и
 * path — через require. Маркеры-комментарии не переименовывать.
 */
const DROP_NOTIFICATION = {
  // Окно больше карточки (380×96): вокруг неё место под тень
  width: 412,
  height: 128,
  // От правого и нижнего края рабочей области (до карточки ещё 16 и 24)
  margin: 4,
  lifeMs: 6000,
  queuedLifeMs: 3500,
  safetyMs: 6500,
  releaseMs: 4000,
  hardLimitMs: 30000,
  queueMax: 10,
  summaryFrom: 3,
  whilePlayingMax: 50,
  gapMs: 250
};
const dropQueue = [];
let dropQueueOverflow = 0;
let dropQueueTimer = null;
// Награды, полученные во время игры (pendingWhilePlaying из спецификации)
let dropsWhilePlaying = [];
let dropsWhilePlayingExtra = 0;

function notificationText(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** «награда / награды / наград» по числу. */
function dropsWord(n) {
  const tens = Math.abs(n) % 100;
  const ones = tens % 10;
  if (tens > 10 && tens < 20) return 'наград';
  if (ones === 1) return 'награда';
  if (ones >= 2 && ones <= 4) return 'награды';
  return 'наград';
}

/** «Получена 21 награда», «Получено 4 награды»: глагол — по числу. */
function receivedDropsTitle(n) {
  const verb = n % 10 === 1 && n % 100 !== 11 ? 'Получена' : 'Получено';
  return verb + ' ' + n + ' ' + dropsWord(n);
}

function dropNotificationTheme() {
  try {
    if (typeof store !== 'undefined' && store.get('settings.theme') === 'light') return 'light';
  } catch (e) { /* хранилище недоступно — тёмная */ }
  return 'dark';
}

/**
 * Угол экрана, на котором главное окно. Раньше считалось от нуля
 * основного монитора, и при окне на втором мониторе уведомление
 * появлялось не там (а при панели задач слева или сверху — со сдвигом).
 */
function dropNotificationBounds() {
  const { screen } = require('electron');
  let display = null;
  try {
    if (typeof mainWindow !== 'undefined' && mainWindow && !mainWindow.isDestroyed()) {
      display = screen.getDisplayMatching(mainWindow.getBounds());
    }
  } catch (e) { /* окно закрывается — возьмём основной экран */ }
  const area = (display || screen.getPrimaryDisplay()).workArea;
  const { width, height, margin } = DROP_NOTIFICATION;
  return {
    x: Math.round(area.x + area.width - width - margin),
    y: Math.round(area.y + area.height - height - margin),
    width,
    height
  };
}

/** Картинку окно само не грузит (у него нет сети) — main скачивает и шлёт data:image/… */
function fetchNotificationImage(url, win, done) {
  if (!url || !/^https?:\/\//i.test(url)) {
    done(null);
    return;
  }
  const protocol = /^https:/i.test(url) ? require('https') : require('http');
  let finished = false;
  const finish = (value) => {
    if (finished) return;
    finished = true;
    done(value);
  };
  const request = protocol.get(url, (response) => {
    const type = String(response.headers['content-type'] || '');
    if (response.statusCode !== 200 || !type.startsWith('image/')) {
      console.warn('[Уведомления] Картинка награды не получена:', response.statusCode, type);
      response.resume();
      finish(null);
      return;
    }
    const chunks = [];
    let size = 0;
    response.on('data', (chunk) => {
      size += chunk.length;
      // Картинка награды — десятки килобайт; мегабайты значат что-то не то
      if (size > 4 * 1024 * 1024) {
        request.destroy();
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => {
      finish('data:' + type + ';base64,' + Buffer.concat(chunks).toString('base64'));
    });
    response.on('error', () => finish(null));
  }).on('error', (err) => {
    console.warn('[Уведомления] Картинка награды не скачалась:', err.message);
    finish(null);
  });
  request.setTimeout(4000, () => request.destroy());
  win.once('closed', () => request.destroy());
}

/**
 * Создаёт окно о награде. extra: { kind: 'drop'|'summary'|'test', meta,
 * eyebrow, count, queued } — всё необязательно; queued > 0 — за этим окном
 * ждут ещё, и оно живёт короче.
 */
function createDropNotification(dropName, gameName, dropIcon, extra = {}) {
  // Закрываем предыдущее уведомление если есть
  if (dropNotificationWindow && !dropNotificationWindow.isDestroyed()) {
    dropNotificationWindow.close();
  }

  const options = extra && typeof extra === 'object' ? extra : {};
  const kind = options.kind === 'summary' || options.kind === 'test' ? options.kind : 'drop';
  const queued = Math.max(0, Math.floor(Number(options.queued) || 0));

  const notificationWindow = new BrowserWindow({
    ...dropNotificationBounds(),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    // Уведомление не должно забирать фокус: награды приходят посреди игры,
    // и полноэкранная игра от этого сворачивалась, а нажатые клавиши уходили
    // в окно уведомления. Клик мышью по нему при этом работает
    focusable: false,
    // Node и отключённая защита окну не нужны: картинку main сам скачивает
    // и присылает как data:image/…, а страница получает только мост
    // window.notif. Путь к мосту — от корня приложения, как у loadFile
    // ниже, а не от __dirname: tests/audit-notifications.cjs запускает этот
    // кусок файла отдельно, и __dirname там нет
    webPreferences: {
      preload: require('path').join(require('electron').app.getAppPath(), 'preload-notification.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  dropNotificationWindow = notificationWindow;
  notificationWindow.loadFile('renderer/notification.html');

  // Часы окна. Ссылку держим свою, а не глобальную: окно живёт несколько
  // секунд и закрывается само, обработчик 'closed' обнуляет
  // dropNotificationWindow. Если это случится до 'ready-to-show' — а так
  // бывает при подряд идущих наградах, — обращение к глобальной ссылке
  // уронит весь главный процесс. Ровно это и произошло: приложение упало
  // ночью, и фарминг встал до утра.
  // Закрытие не зависит от таймеров/работоспособности renderer.
  const createdAt = Date.now();
  const lifeMs = queued > 0 ? DROP_NOTIFICATION.queuedLifeMs : DROP_NOTIFICATION.lifeMs;
  const destroy = () => {
    if (!notificationWindow.isDestroyed()) notificationWindow.destroy();
  };
  const life = {
    kind,
    createdAt,
    held: false,
    expiry: null,
    deadline: 0,
    hardStop: setTimeout(destroy, DROP_NOTIFICATION.hardLimitMs),
    arm(ms) {
      clearTimeout(life.expiry);
      life.deadline = Date.now() + ms;
      life.expiry = setTimeout(destroy, ms);
    }
  };
  life.arm(queued > 0 ? DROP_NOTIFICATION.queuedLifeMs + 500 : DROP_NOTIFICATION.safetyMs);
  notificationWindow.wtLife = life;

  notificationWindow.once('ready-to-show', () => {
    if (!notificationWindow || notificationWindow.isDestroyed()) {
      console.log('[Main] Окно уведомления закрылось до показа');
      return;
    }
    // Показ без активации — см. focusable выше
    notificationWindow.showInactive();

    const targetWindow = notificationWindow;
    const payload = {
      dropName: notificationText(dropName, 200),
      gameName: notificationText(gameName, 120),
      kind,
      meta: notificationText(options.meta, 160),
      eyebrow: notificationText(options.eyebrow, 60),
      count: Math.max(0, Math.floor(Number(options.count) || 0)),
      theme: dropNotificationTheme(),
      queued,
      // Сколько жить странице: часы идут с создания окна, а не с показа
      lifeMs: Math.max(1500, lifeMs - (Date.now() - createdAt))
    };
    const sendToNotification = (dropIconData) => {
      if (!targetWindow || targetWindow.isDestroyed()) return;
      targetWindow.webContents.send('notification-data', { ...payload, dropIcon: dropIconData });
    };

    // Название показываем сразу, даже если сервер картинки не отвечает.
    sendToNotification(null);
    if (typeof dropIcon === 'string' && /^https?:\/\//i.test(dropIcon)) {
      fetchNotificationImage(dropIcon, targetWindow, (dataUrl) => {
        if (dataUrl) sendToNotification(dataUrl);
      });
    }
  });

  notificationWindow.on('closed', () => {
    clearTimeout(life.expiry);
    clearTimeout(life.hardStop);
    if (dropNotificationWindow === notificationWindow) dropNotificationWindow = null;
    // Следующая награда из очереди — когда это окно ушло
    scheduleDropQueue();
  });

  return notificationWindow;
}

/** Окно, приславшее сообщение, — и именно текущее окно о награде. */
function senderDropNotificationWindow(event) {
  if (!event || !event.sender || event.sender.isDestroyed()) return null;
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow !== dropNotificationWindow || senderWindow.isDestroyed()) return null;
  return senderWindow;
}

/** Сводка нескольких наград: «Получено 4 награды · Сумерки, Рамка и ещё 2». */
function buildDropSummary(items, total, eyebrow) {
  const names = items.map(i => i.dropName).filter(Boolean);
  const games = [...new Set(items.map(i => i.gameName).filter(Boolean))];
  const prefix = games.length === 1 ? games[0] + ' · ' : '';
  // Строка одна, около 45 знаков: второе название — только если влезает,
  // иначе обрезанное многоточием оно ничего не говорит
  const shown = names.slice(0, 1);
  if (names[1] && (prefix + names[0] + ', ' + names[1] + ' и ещё 99').length <= 46) shown.push(names[1]);
  const rest = total - shown.length;
  const list = shown.join(', ') + (rest > 0 ? (shown.length ? ' и ещё ' : '') + rest : '');
  return {
    kind: 'summary',
    dropName: receivedDropsTitle(total),
    gameName: '',
    meta: prefix + list,
    eyebrow: eyebrow || '',
    count: total,
    dropIcon: (items.find(i => i.dropIcon) || {}).dropIcon || null
  };
}

function showDropItem(item, queuedAfter) {
  createDropNotification(item.dropName, item.gameName, item.dropIcon, {
    kind: item.kind,
    meta: item.meta,
    eyebrow: item.eyebrow,
    count: item.count,
    queued: queuedAfter
  });
}

/** Текущее окно — короче: за ним ждут. */
function shortenDropNotification() {
  const win = dropNotificationWindow;
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('notification-queue', { queued: dropQueue.length + dropQueueOverflow });
  } catch (e) { /* окно закрывается */ }
  const life = win.wtLife;
  if (!life || life.held) return;
  const deadline = Math.max(Date.now() + 800, life.createdAt + DROP_NOTIFICATION.queuedLifeMs + 500);
  if (deadline < life.deadline) life.arm(deadline - Date.now());
}

function scheduleDropQueue() {
  if (!dropQueue.length && !dropQueueOverflow) return;
  clearTimeout(dropQueueTimer);
  // Короткая пауза между окнами: следующее заметно появляется заново, а
  // не подменяет текст в том же месте
  dropQueueTimer = setTimeout(drainDropQueue, DROP_NOTIFICATION.gapMs);
}

function drainDropQueue() {
  dropQueueTimer = null;
  if (dropNotificationWindow && !dropNotificationWindow.isDestroyed()) return;
  // Приложение закрывается — новых окон не создаём
  if (require('electron').app.isQuitting || (typeof mainWindow !== 'undefined' && !mainWindow)) {
    dropQueue.length = 0;
    dropQueueOverflow = 0;
    return;
  }
  if (!dropQueue.length && !dropQueueOverflow) return;

  // Проверку и готовые сводки показываем как есть
  if (dropQueue[0] && dropQueue[0].kind !== 'drop') {
    const item = dropQueue.shift();
    showDropItem(item, dropQueue.length + dropQueueOverflow);
    return;
  }

  const drops = dropQueue.filter(i => i.kind === 'drop');
  if (drops.length + dropQueueOverflow >= DROP_NOTIFICATION.summaryFrom) {
    for (let i = dropQueue.length - 1; i >= 0; i--) {
      if (dropQueue[i].kind === 'drop') dropQueue.splice(i, 1);
    }
    const total = drops.length + dropQueueOverflow;
    dropQueueOverflow = 0;
    showDropItem(buildDropSummary(drops, total, ''), dropQueue.length);
    return;
  }

  const item = dropQueue.shift();
  showDropItem(item, dropQueue.length + dropQueueOverflow);
}

/** Награда пришла: показать сразу, поставить в очередь или отложить до конца игры. */
function enqueueDropNotification(item) {
  if (!item) return;
  const playing = item.kind !== 'test' && typeof gameModeState !== 'undefined' && gameModeState && gameModeState.active;
  if (playing) {
    if (dropsWhilePlaying.length < DROP_NOTIFICATION.whilePlayingMax) dropsWhilePlaying.push(item);
    else dropsWhilePlayingExtra += 1;
    console.log('[Уведомления] Идёт игра — о награде скажу после неё:', item.dropName);
    return;
  }

  const busy = dropNotificationWindow && !dropNotificationWindow.isDestroyed();
  if (!busy && !dropQueue.length && !dropQueueOverflow && !dropQueueTimer) {
    showDropItem(item, 0);
    return;
  }
  if (dropQueue.length >= DROP_NOTIFICATION.queueMax) dropQueueOverflow += 1;
  else dropQueue.push(item);
  if (busy) shortenDropNotification();
  else scheduleDropQueue();
}

/** Игровой режим выключился: одно окно обо всём, что пришло за игру. */
function flushDropsAfterGame() {
  if (!dropsWhilePlaying.length && !dropsWhilePlayingExtra) return;
  const items = dropsWhilePlaying;
  const total = items.length + dropsWhilePlayingExtra;
  dropsWhilePlaying = [];
  dropsWhilePlayingExtra = 0;
  const item = total === 1
    ? { ...items[0], eyebrow: 'Пока вы играли' }
    : buildDropSummary(items, total, 'Пока вы играли');
  enqueueDropNotification(item);
}

ipcMain.on('show-drop-notification', (event, payload) => {
  const { dropName, gameName, dropIcon, extra } = payload || {};
  const options = extra && typeof extra === 'object' ? extra : {};
  const kind = options.kind === 'summary' || options.kind === 'test' ? options.kind : 'drop';
  console.log('[Уведомления] Окно о награде:', kind, notificationText(dropName, 80));
  // Тот же выключатель «Уведомления Windows», что и у системных уведомлений
  // ниже: окно о награде всплывает поверх всего, в том числе поверх игры.
  // Проверка из настроек показывается всегда — это явное действие
  if (kind !== 'test' && typeof store !== 'undefined' && store.get('settings.notifications') === false) return;
  enqueueDropNotification({
    kind,
    dropName: notificationText(dropName, 200),
    gameName: notificationText(gameName, 120),
    dropIcon: typeof dropIcon === 'string' && /^https?:\/\//i.test(dropIcon) ? dropIcon.slice(0, 2000) : null,
    meta: notificationText(options.meta, 160),
    count: Math.max(0, Math.floor(Number(options.count) || 0))
  });
});

ipcMain.on('close-drop-notification', (event) => {
  if (event.sender.isDestroyed()) return;
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && senderWindow === dropNotificationWindow && !senderWindow.isDestroyed()) {
    senderWindow.close();
  }
});

// Щелчок по карточке: приложение — вперёд, на страницу наград
ipcMain.on('open-drop-notification', (event) => {
  const win = senderDropNotificationWindow(event);
  if (!win) return;
  const kind = win.wtLife ? win.wtLife.kind : 'drop';
  if (typeof bringMainWindowToFront === 'function') bringMainWindowToFront();
  if (kind !== 'test' && typeof sendToMain === 'function') sendToMain('navigate-to-page', 'drops');
  // Окно уже гаснет на своей стороне — закрываем, когда анимация дошла
  setTimeout(() => {
    if (!win.isDestroyed()) win.close();
  }, 170);
});

// Курсор на карточке: страховку снимаем, после ухода — 4 с
ipcMain.on('hold-drop-notification', (event, on) => {
  const win = senderDropNotificationWindow(event);
  if (!win || !win.wtLife) return;
  const life = win.wtLife;
  life.held = !!on;
  if (life.held) {
    clearTimeout(life.expiry);
    life.expiry = null;
    life.deadline = Infinity;
  } else {
    life.arm(DROP_NOTIFICATION.releaseMs);
  }
});

// Показанные системные уведомления, см. show-notification
const liveNotifications = [];
const MAX_LIVE_NOTIFICATIONS = 10;

// Старые системные уведомления (оставляем для совместимости)
ipcMain.on('show-notification', (event, { title, body, icon } = {}) => {
  console.log('[Main] show-notification received:', { title, body, icon });
  const notificationsEnabled = store.get('settings.notifications', true);
  console.log('[Main] Notifications enabled:', notificationsEnabled);

  if (notificationsEnabled) {
    // Окно на виду и в фокусе — человек смотрит в приложение. Всплывашка
    // Windows в углу экрана только дублировала бы то, что видно на
    // странице, и потом висела бы в Центре уведомлений. Отдаём окну:
    // оно покажет обычный тост
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() &&
          !mainWindow.isMinimized() && mainWindow.isFocused()) {
        console.log('[Main] Окно в фокусе — уведомление показываю в окне');
        sendToMain('in-app-notice', { title: String(title || ''), body: String(body || '') });
        return;
      }
    } catch (e) { /* окно закрывается — покажем системное */ }

    console.log('[Main] Showing notification');
    const notificationOptions = {
      title, 
      body,
      silent: false,
      timeoutType: 'default'
    };
    
    // Electron берёт картинку только как путь к файлу или NativeImage: URL
    // и относительный путь («../assets/icon.png» из окна) молча давали
    // уведомление без картинки. Принимаем лишь существующий локальный файл
    if (typeof icon === 'string' && path.isAbsolute(icon) && fs.existsSync(icon)) {
      notificationOptions.icon = icon;
    }
    
    const notification = new Notification(notificationOptions);
    // Клик открывает окно: уведомление об автовыключении просит «откройте
    // WatchTwitch, чтобы отменить», а окно к этому времени могли снова
    // спрятать в трей или свернуть
    notification.on('click', () => { bringMainWindowToFront(); });
    // Без ссылки объект может забрать сборщик мусора раньше клика, и 'click'
    // не придёт. Держим несколько последних: по ним щёлкают и в Центре
    // уведомлений, когда всплывашка уже исчезла
    liveNotifications.push(notification);
    if (liveNotifications.length > MAX_LIVE_NOTIFICATIONS) liveNotifications.shift();
    notification.show();
  } else {
    console.log('[Main] Notifications disabled in store');
  }
});

// Открытие внешней ссылки
// Только https: строка из окна уходила системе как есть, и file:, ms-settings:
// или путь к сетевой папке открывались проводником. Все ссылки приложения —
// https (Twitch, GitHub, Telegram, Boosty)
ipcMain.handle('open-external', async (event, target) => {
  let parsed;
  try {
    parsed = new URL(String(target || ''));
  } catch (e) {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    console.warn('[Ссылки] Не открываю ссылку со схемой', parsed.protocol);
    return false;
  }
  await shell.openExternal(parsed.toString());
  return true;
});

// Подписки на канал из приложения нет. Обработчики follow-channel и
// check-following удалены: getAuthToken в них звался без await, и в
// Twitch уходил заголовок «Bearer [object Promise]» — два заведомо
// отклонённых запроса на каждую смену стрима. К тому же Twitch давно
// закрыл подписку через Helix (POST /helix/users/follows), так что
// чинить было нечего. Проверка подписки для отписки — isFollowingChannel

/**
 * Топ-100 категорий Twitch.
 *
 * Страница фарминга спрашивает его каждые 30 секунд ради числа зрителей —
 * почти три тысячи одинаковых тяжёлых запросов в сутки. За пять минут
 * зрители меняются несильно, поэтому ответ общий на пять минут для всех,
 * кто спрашивает. Запрос идёт через twitchPost: тот повторяет обрыв и
 * соблюдает общую паузу после 429, а прямой запрос шёл мимо неё и только
 * затягивал ограничение. Сбой — по-прежнему пустой список (так его ждут
 * все вызывающие), но держим его в кэше недолго.
 */
const CATEGORIES_TTL = 5 * 60 * 1000;
const CATEGORIES_EMPTY_TTL = 30 * 1000;

async function fetchTwitchCategoriesUncached() {
  const postData = JSON.stringify({
    query: 'query { games(first: 100) { edges { node { id name displayName boxArtURL(width: 52, height: 72) viewersCount } } } }'
  });

  const res = await twitchPost(postData, {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }, { attempts: 2 });

  if (!res.ok) {
    console.warn('[Категории] Twitch не ответил:', res.error || res.statusCode);
    return [];
  }

  try {
    const parsed = JSON.parse(res.data);
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    const edges = root?.data?.games?.edges || root?.data?.directoriesWithTags?.edges || [];
    if (!edges.length && root?.errors?.length) {
      console.warn('[Категории] Ошибка Twitch:', String(root.errors[0]?.message || '').slice(0, 120));
    }

    return edges
      .filter(edge => edge?.node)
      .map(edge => ({
        id: edge.node.id,
        name: edge.node.displayName || edge.node.name,
        boxArtURL: edge.node.boxArtURL || edge.node.avatarURL || '',
        viewersCount: edge.node.viewersCount || 0,
        tags: []
      }));
  } catch (e) {
    console.warn('[Категории] Ответ не разобран:', e.message);
    return [];
  }
}

ipcMain.handle('fetch-twitch-categories', () => cachedTwitchCall(
  'categories',
  fetchTwitchCategoriesUncached,
  result => (Array.isArray(result) && result.length ? CATEGORIES_TTL : CATEGORIES_EMPTY_TTL)
));

function streamHasDropsSignal(node) {
  const tags = node?.freeformTags || [];
  const title = (node?.title || '').toLowerCase();

  const hasTagSignal = tags.some(tag => {
    const tagName = String(tag?.name || '').toLowerCase();
    return tagName.includes('drops') ||
      tagName.includes('dropsenabled') ||
      tagName.includes('dropenabled') ||
      tagName === 'dropson';
  });

  if (hasTagSignal) return true;

  return title.includes(' drops') ||
    title.startsWith('drops') ||
    title.includes('[drops') ||
    title.includes('дропс') ||
    title.includes('дропы');
}

/**
 * Разбирает ответ Twitch со стримами игры: { game, edges } или null.
 *
 * null — Twitch по сути не ответил: сеть, 503, HTML вместо JSON, ошибка
 * GraphQL вроде «Failed to fetch from Subgraph». Раньше это превращалось в
 * пустой список, а пустой список значит «стримов нет»: минутный сбой
 * Twitch выключал категорию за категорией, и фарминг вставал до утра.
 * Пустой edges — только когда ответ разобран и стримов действительно нет;
 * несуществующая игра (game: null без ошибок) — тоже пусто.
 */
function parseGameStreams(res, label) {
  if (!res.ok) {
    console.warn(label, 'Twitch не ответил:', res.error || res.statusCode);
    return null;
  }

  let root;
  try {
    const parsed = JSON.parse(res.data);
    root = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (e) {
    console.warn(label, 'Ответ не разобран:', e.message);
    return null;
  }

  const game = root?.data?.game;
  const edges = game?.streams?.edges;
  if (Array.isArray(edges)) return { game, edges };

  if (root?.errors?.length) {
    console.warn(label, 'Ошибка Twitch:', String(root.errors[0]?.message || '').slice(0, 120));
    return null;
  }
  if (root?.data && game === null) return { game: null, edges: [] };

  console.warn(label, 'Ответ без списка стримов');
  return null;
}

/**
 * Есть ли у игры действующая кампания с наградами.
 *
 * true / false — ответ по полному списку кампаний; null — списка нет
 * (нет cookie-токена или Client-Integrity), и судить не о чём.
 *
 * Раньше функция слала свой dashboard-запрос при каждом вызове, а звали
 * её по разу на каждую категорию и каждую подписку — сотня с лишним
 * одинаковых запросов при старте. Теперь список берётся из общего кэша.
 */
async function hasActiveInventoryDropsForCategory(categoryName) {
  const authToken = await getCookieAuthToken();
  if (!authToken) return null;

  const campaigns = await fetchViewerDropsDashboardCampaigns(authToken);
  if (!Array.isArray(campaigns) || campaigns.length === 0) return null;

  const lookup = String(categoryName || '').toLowerCase();
  if (!lookup) return false;

  const matching = campaigns.find(campaign => {
    const gameName = String(campaign?.game?.name || '').toLowerCase();
    const displayName = String(campaign?.game?.displayName || '').toLowerCase();
    return gameName === lookup || displayName === lookup;
  });

  if (!matching) return false;
  return (matching.timeBasedDrops || []).length > 0;
}

/**
 * Сводка по категории для окна подробностей: сколько зрителей у игры,
 * сколько стримов просмотрено и сколько из них с дропсами.
 *
 * Отдельный обработчик, потому что get-streams-with-drops отдаёт массив,
 * а дополнительные свойства массива не переживают сериализацию IPC.
 */
ipcMain.handle('get-category-overview', async (event, categoryName) => {
  const escapedName = String(categoryName || '').replace(/"/g, '\\"');
  const postData = JSON.stringify({
    query:
      'query { game(name: "' + escapedName + '") { viewersCount streams(first: 30) { edges { node { title viewersCount broadcaster { login displayName profileImageURL(width: 70) } freeformTags { name } } } } } }'
  });

  // null — Twitch не ответил: окну нечего показывать, кроме «попробуйте
  // позже». Нулевая сводка выглядела бы как «в категории никого нет».
  // Две попытки, а не три: окно открыто и ждёт, долгий повтор хуже ответа
  const parsed = parseGameStreams(await twitchPost(postData, {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }, { attempts: 2 }), '[Сводка категории]');
  if (!parsed) return null;

  const { game, edges } = parsed;
  const streams = edges.map(edge => {
    const node = edge?.node;
    const broadcaster = node?.broadcaster;
    if (!broadcaster) return null;
    return {
      login: broadcaster.login,
      displayName: broadcaster.displayName,
      title: node.title,
      viewersCount: node.viewersCount || 0,
      profileImageUrl: broadcaster.profileImageURL || null,
      hasDrops: streamHasDropsSignal(node)
    };
  }).filter(Boolean);

  return {
    gameViewers: game?.viewersCount || 0,
    streamsChecked: edges.length,
    streamsWithDrops: streams.filter(s => s.hasDrops).length,
    streams
  };
});

// Получить стримы с дропсами для категории
ipcMain.handle('get-streams-with-drops', async (event, categoryName) => {
  const escapedName = String(categoryName || '').replace(/"/g, '\\"');
  const postData = JSON.stringify({
    // Аватарка и зрители запрашиваются сразу здесь: окно категории раньше
    // добирало их отдельным запросом на каждый канал, с OAuth-токеном —
    // при его отсутствии аватарки не грузились вовсе.
    query:
      'query { game(name: "' + escapedName + '") { streams(first: 30) { edges { node { title viewersCount broadcaster { login displayName profileImageURL(width: 70) } freeformTags { name } } } } } }'
  });

  // С повтором: обрыв связи не должен выглядеть как «стримов нет».
  // Контракт для окна: null — Twitch не ответил (категорию не трогать),
  // [] — ответ разобран, и стримов действительно нет. Объект { error } не
  // годится: проверка «streams.length === 0» его пропустит.
  const parsed = parseGameStreams(await twitchPost(postData, {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }), '[Стримы]');
  if (!parsed) return null;

  const { edges } = parsed;

  // Тег «Drops» ставят не все стримеры, а открытая кампания засчитывается
  // на любом канале категории. Раньше без тега приложение отвечало «Нет
  // стримов». Помеченные — вперёд, без пометки — в запас.
  const tagged = edges.filter(edge => streamHasDropsSignal(edge?.node));
  const pool = tagged.length ? tagged : edges;
  if (!tagged.length && edges.length) {
    console.log('[Стримы] Тега Drops нет ни у кого, беру все стримы категории:', edges.length);
  }

  return pool
    .map(edge => {
      const broadcaster = edge?.node?.broadcaster;
      if (!broadcaster) return null;
      return {
        login: broadcaster.login,
        displayName: broadcaster.displayName,
        title: edge.node.title,
        viewersCount: edge.node.viewersCount || 0,
        profileImageUrl: broadcaster.profileImageURL || null
      };
    })
    .filter(Boolean);
});

// Получить активные кампании дропсов.
//
// Раньше здесь стоял persisted-запрос без Client-Integrity: Twitch молча
// отвечал на него пустым списком, страница фарминга считала список
// кампаний неполным и проверяла каждую категорию отдельным запросом.
// Теперь источник один — общий кэш инвентаря, куда уже подмешан полный
// dashboard-список. Пустой ответ означает ровно одно: полного списка
// пока нет (нет Client-Integrity), и делать по нему выводы нельзя.
ipcMain.handle('fetch-twitch-drops', async () => {
  const authToken = (await getCookieAuthToken()) || (await getAuthToken());
  if (!authToken) return [];

  const dashboard = await fetchViewerDropsDashboardCampaigns(authToken);
  if (!Array.isArray(dashboard) || dashboard.length === 0) return [];

  const inventory = await getDropsInventory();
  // Инвентарь, собранный до появления списка кампаний, неполон — тот же
  // случай «полного списка нет»
  if (inventory?.dashboardComplete !== true) return [];
  return Array.isArray(inventory?.campaigns) ? inventory.campaigns : [];
});

/**
 * Кампании из ViewerDropsDashboard — все активные кампании аккаунта.
 * Нужны потому, что inventory.dropCampaignsInProgress отдаёт ТОЛЬКО те кампании,
 * где уже накоплена хотя бы минута просмотра. Пока фарм не начался, доступные
 * дропсы там отсутствуют — и приложение делало вид, что дропсов нет вообще.
 * Возвращает сырые кампании в том же виде, что и inventory (game — объект).
 *
 * null — списка нет: нет токена или Client-Integrity, пауза после 429,
 * обрыв, ошибка разбора или GraphQL. Раньше всё это было пустым массивом,
 * а инвентарь подмешивал его молча — неполный список кампаний выглядел
 * полным, и ещё не начатые кампании пропадали вместе с категориями.
 */
function fetchViewerDropsDashboardCampaignsUncached(authToken) {
  return new Promise((resolve) => {
    if (!authToken) {
      resolve(null);
      return;
    }

    // Без Client-Integrity запрос гарантированно вернёт IntegrityCheckFailed,
    // поэтому не тратим на него сеть и время.
    if (!hasFreshIntegrity()) {
      console.log('[Drops] Client-Integrity ещё не перехвачен — пропускаю запрос списка кампаний');
      resolve(null);
      return;
    }

    // Полный запрос вместо persisted query: хэши persisted-запросов Twitch
    // периодически меняет, и старый хэш начинает молча возвращать пустоту.
    const postData = JSON.stringify({
      operationName: 'ViewerDropsDashboard',
      variables: {},
      query: `query ViewerDropsDashboard {
        currentUser {
          id
          dropCampaigns {
            id
            name
            status
            startAt
            endAt
            allow {
              isEnabled
              channels {
                id
                name
                displayName
              }
            }
            game {
              id
              name
              displayName
              boxArtURL
            }
            timeBasedDrops {
              id
              name
              requiredMinutesWatched
              benefitEdges {
                benefit {
                  id
                  name
                  imageAssetURL
                }
              }
              self {
                currentMinutesWatched
                isClaimed
                dropInstanceID
              }
            }
          }
        }
      }`
    });

    const headers = {
      'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Authorization': `OAuth ${authToken}`,
      'Content-Type': 'text/plain;charset=UTF-8',
      'Client-Integrity': twitchGqlHeaders.integrity
    };
    if (twitchGqlHeaders.deviceId) headers['X-Device-Id'] = twitchGqlHeaders.deviceId;
    if (twitchGqlHeaders.clientVersion) headers['Client-Version'] = twitchGqlHeaders.clientVersion;
    if (twitchGqlHeaders.sessionId) headers['Client-Session-Id'] = twitchGqlHeaders.sessionId;

    if (twitchRateLimit.isLimited()) {
      console.log('[Drops] Список кампаний не запрашиваю:', twitchRateLimit.describe());
      resolve(null);
      return;
    }

    const req = httpsRequestWithTimeout({
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers
    }, (res) => {
      // Названия кампаний и наград бывают по-русски: без декодера буква,
      // разрезанная границей пакета, превращается в «��»
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        twitchRateLimit.noteResponse(res.statusCode, res.headers);
        if (res.statusCode >= 400) {
          console.warn('[Drops] Dashboard: Twitch ответил', res.statusCode);
          if (res.statusCode === 401) noteTwitchUnauthorized(authToken);
          resolve(null);
          return;
        }
        try {
          const response = JSON.parse(data);
          const root = Array.isArray(response) ? response[0] : response;

          if (root?.errors) {
            console.warn('[Drops] Dashboard GraphQL errors:', JSON.stringify(root.errors).slice(0, 200));
          }

          // Нет списка (IntegrityCheckFailed, сбой подграфа) — это «не знаю»,
          // а не «кампаний нет»
          const campaigns = root?.data?.currentUser?.dropCampaigns;
          if (!Array.isArray(campaigns)) {
            resolve(null);
            return;
          }
          const now = new Date();

          const active = campaigns.filter(campaign => {
            if (campaign.status === 'EXPIRED') return false;
            if (campaign.endAt && new Date(campaign.endAt) < now) return false;
            if (campaign.startAt && new Date(campaign.startAt) > now) return false;
            return true;
          });

          console.log('[Drops] Dashboard campaigns:', active.length, 'of', campaigns.length);
          resolve(active);
        } catch (e) {
          console.warn('[Drops] Dashboard parse error:', e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.warn('[Drops] Dashboard request error:', e.message);
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Список кампаний из общего кэша: один запрос на десять минут для всех,
 * кто спрашивает. Пустой ответ или его отсутствие (null) держим недолго,
 * чтобы не пропустить момент, когда список станет доступен.
 */
function fetchViewerDropsDashboardCampaigns(authToken) {
  if (!authToken) return Promise.resolve(null);
  return cachedTwitchCall(
    'dashboard',
    () => fetchViewerDropsDashboardCampaignsUncached(authToken).then(result => {
      // Список пришёл — инвентарь, собранный без него, больше не годится
      if (Array.isArray(result) && result.length) dropIncompleteDropsCache();
      return result;
    }),
    result => (Array.isArray(result) && result.length ? TWITCH_CACHE_TTL.dashboard : TWITCH_CACHE_TTL.dashboardEmpty)
  );
}

// Fetch Drops Inventory (full inventory with progress tracking)
function fetchDropsInventoryUncached() {
  const https = require('https');

  return new Promise(async (resolve) => {

    // Используем cookie токен из webview (создается при просмотре стримов)
    const { session } = require('electron');
    const twitchSession = session.fromPartition('persist:twitch');

    let authToken = null;
    try {
      const cookies = await twitchSession.cookies.get({
        url: 'https://www.twitch.tv',
        name: 'auth-token'
      });

      if (cookies && cookies.length > 0) {
        authToken = cookies[0].value;
      }
    } catch (e) {
      console.error('Error getting cookie token:', e.message);
    }

    // dashboardComplete есть в каждом ответе: true — только когда список
    // всех кампаний получен и подмешан. Без него в инвентаре лишь начатые
    // кампании, и «игры нет в списке» не значит «дропсов нет».
    if (!authToken) {
      console.log('No cookie token - user needs to watch a stream first');
      resolve({ campaigns: [], needsStream: true, dashboardComplete: false });
      return;
    }


    // GraphQL operation for inventory (campaigns in progress only)
    const postData = JSON.stringify([
      {
        operationName: 'Inventory',
        variables: {},
        query: `query Inventory {
          currentUser {
            id
            inventory {
              dropCampaignsInProgress {
                id
                name
                startAt
                endAt
                allow {
                  isEnabled
                  channels {
                    id
                    name
                    displayName
                  }
                }
                game {
                  id
                  name
                  displayName
                  boxArtURL
                }
                timeBasedDrops {
                  id
                  name
                  requiredMinutesWatched
                  benefitEdges {
                    benefit {
                      id
                      name
                      imageAssetURL
                    }
                  }
                  self {
                    currentMinutesWatched
                    isClaimed
                    dropInstanceID
                  }
                }
              }
              gameEventDrops {
                id
                name
                imageURL
                game {
                  id
                  name
                  displayName
                }
                lastAwardedAt
              }
            }
          }
        }`
      }
    ]);

    const options = {
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Authorization': `OAuth ${authToken}`,
        'Content-Type': 'text/plain;charset=UTF-8'
      }
    };

    if (twitchRateLimit.isLimited()) {
      console.log('[Drops] Инвентарь не запрашиваю:', twitchRateLimit.describe());
      resolve({ campaigns: [], rateLimited: true, dashboardComplete: false });
      return;
    }

    const req = httpsRequestWithTimeout(options, (res) => {
      // Русские названия наград не должны ломаться на границе пакетов
      res.setEncoding('utf8');
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', async () => {
        twitchRateLimit.noteResponse(res.statusCode, res.headers);
        // Отказ Twitch — не «кампаний нет». Тело 401 разбиралось как пустой
        // инвентарь, и окно спокойно ждало минут, которые не засчитывались
        if (res.statusCode === 401) {
          console.warn('[Drops] Инвентарь: Twitch не принял вход (401)');
          noteTwitchUnauthorized(authToken);
          resolve({ campaigns: [], error: 'unauthorized', dashboardComplete: false });
          return;
        }
        if (res.statusCode >= 400) {
          console.warn('[Drops] Инвентарь: Twitch ответил', res.statusCode);
          resolve({ campaigns: [], error: true, dashboardComplete: false });
          return;
        }
        try {
          const responses = JSON.parse(data);

          // Parse inventory (only in-progress campaigns available due to integrity check)
          const root = Array.isArray(responses) ? responses[0] : responses;
          if (!root?.data?.currentUser) {
            // Нет currentUser — ответа об инвентаре нет вовсе (ошибка
            // GraphQL), а не пустой инвентарь
            console.warn('[Drops] Инвентарь не получен:', String(root?.errors?.[0]?.message || 'нет данных').slice(0, 120));
            resolve({ campaigns: [], error: true, dashboardComplete: false });
            return;
          }
          const currentUser = root.data.currentUser;
          const inventory = currentUser.inventory || {};
          const ongoingCampaigns = inventory.dropCampaignsInProgress || [];


          // Создаем мапу полученных дропсов из инвентаря ПЕРЕД использованием в map
          const claimedDrops = {};
          // Полученные награды целиком: название, картинка и игра. Раньше
          // запрашивались только id и дата, и вкладка «Инвентарь» у давнего
          // пользователя была стеной одинаковых безымянных заглушек
          const claimedRewards = [];
          (Array.isArray(inventory.gameEventDrops) ? inventory.gameEventDrops : []).forEach(drop => {
            if (!drop?.id || Object.prototype.hasOwnProperty.call(claimedDrops, drop.id)) return;
            claimedDrops[drop.id] = drop.lastAwardedAt;
            claimedRewards.push({
              id: drop.id,
              name: drop.name || null,
              imageURL: drop.imageURL || null,
              game: drop.game ? {
                id: drop.game.id ? String(drop.game.id) : null,
                name: drop.game.name || null,
                displayName: drop.game.displayName || drop.game.name || null
              } : null,
              lastAwardedAt: drop.lastAwardedAt || null
            });
          });

          // Используем кампании в прогрессе
          const campaignsMap = new Map();

          // Добавляем ongoing campaigns
          ongoingCampaigns.forEach(campaign => {
            campaignsMap.set(campaign.id, {
              ...campaign,
              inProgress: true
            });
          });

          // Добавляем кампании, по которым просмотр ещё не начинался.
          // Без этого дропсы появлялись в интерфейсе только после первой засчитанной
          // минуты, из-за чего казалось, что приложение их «не видит».
          const dashboardCampaigns = await fetchViewerDropsDashboardCampaigns(authToken);
          const dashboardComplete = Array.isArray(dashboardCampaigns) && dashboardCampaigns.length > 0;
          (dashboardComplete ? dashboardCampaigns : []).forEach(campaign => {
            if (!campaign?.id || campaignsMap.has(campaign.id)) return;
            campaignsMap.set(campaign.id, {
              ...campaign,
              inProgress: false
            });
          });

          // Пишем только когда число изменилось: раз в минуту одно и то же
          const summary = campaignsMap.size + '/' + ongoingCampaigns.length;
          if (summary !== fetchDropsInventoryUncached.lastSummary) {
            fetchDropsInventoryUncached.lastSummary = summary;
            console.log('[Drops] Кампаний всего:', campaignsMap.size,
              '(в прогрессе:', ongoingCampaigns.length,
              ', ещё не начатых:', campaignsMap.size - ongoingCampaigns.length, ')');
          }

          // Format campaigns with stream count - claimedDrops уже объявлен выше
          const campaigns = await Promise.all(Array.from(campaignsMap.values()).map(async campaign => {
            const now = new Date();
            const startsAt = campaign.startAt ? new Date(campaign.startAt) : null;
            const endsAt = campaign.endAt ? new Date(campaign.endAt) : null;

            let status = 'active';
            if (startsAt && startsAt > now) {
              status = 'upcoming';
            } else if (endsAt && endsAt < now) {
              status = 'expired';
            }

            const drops = (campaign.timeBasedDrops || []).map(drop => {
              // Используем self напрямую из drop
              const self = drop.self || {};

              const currentMinutes = self.currentMinutesWatched || 0;
              const requiredMinutes = drop.requiredMinutesWatched || 0;
              const progress = requiredMinutes > 0 ? currentMinutes / requiredMinutes : 0;
              const percentage = Math.min(100, Math.floor(progress * 100));
              const isClaimed = self.isClaimed || false;
              const canClaim = !isClaimed && progress >= 1;

              // Получаем картинку и название награды из benefitEdges
              let imageURL = null;
              let benefitName = null;
              let benefitId = null;
              if (drop.benefitEdges && Array.isArray(drop.benefitEdges) && drop.benefitEdges.length > 0) {
                if (drop.benefitEdges[0].benefit) {
                  imageURL = drop.benefitEdges[0].benefit.imageAssetURL;
                  benefitName = drop.benefitEdges[0].benefit.name;
                  benefitId = drop.benefitEdges[0].benefit.id;
                }
              }

              // Проверяем был ли получен предмет ранее
              const wasClaimed = benefitId && claimedDrops[benefitId];

              return {
                id: drop.id,
                name: drop.name,
                benefitName: benefitName,
                benefitId: benefitId,
                imageURL: imageURL,
                progress: currentMinutes,
                required: requiredMinutes,
                percentage: percentage,
                claimed: isClaimed || !!wasClaimed,
                dropInstanceID: self.dropInstanceID
              };
            });

            const totalDrops = drops.length;
            const claimedDropsCount = drops.filter(d => d.claimed || d.progress >= d.required).length;
            const campaignProgress = totalDrops > 0 ? claimedDropsCount / totalDrops : 0;

            const gameName = campaign.game?.displayName || campaign.game?.name;

            return {
              id: campaign.id,
              name: campaign.name,
              // id игры нужен окну, чтобы не путать похожие названия: по
              // имени «World of Tanks» и «World of Tanks Console» сходились
              // как одна игра, и категория без кампании фармилась впустую
              game: {
                id: campaign.game?.id ? String(campaign.game.id) : null,
                name: gameName || 'Unknown',
                boxArtURL: campaign.game?.boxArtURL || ''
              },
              status: status,
              startsAt: campaign.startAt,
              endsAt: campaign.endAt,
              drops: drops,
              totalDrops: totalDrops,
              completedDrops: claimedDropsCount,
              // Каналы, на которых кампания засчитывается. Пусто — на любом.
              // Часть кампаний Twitch привязывает к конкретным стримерам, и
              // просмотр остальных не даёт ничего.
              allowedChannels: (campaign.allow?.isEnabled && Array.isArray(campaign.allow.channels))
                ? campaign.allow.channels.map(c => String(c?.name || '').toLowerCase()).filter(Boolean)
                : []
            };
          }));

          // Фильтруем только активные кампании (убираем expired и upcoming)
          const activeCampaigns = campaigns.filter(campaign => {
            if (campaign.status === 'expired') {
              return false;
            }
            if (campaign.status === 'upcoming') {
              return false;
            }
            return true;
          });

          // Поля currentDrop больше нет: окно его не читало, а считалось
          // оно по полям, которых у наград нет, и всегда выходило пустым
          resolve({
            campaigns: activeCampaigns,
            claimedDrops: claimedRewards,
            dashboardComplete
          });
        } catch (e) {
          // Одна строка с кодом и типом ответа вместо стека SyntaxError:
          // по ней видно, что пришло (страница ошибки, обрезанный JSON)
          console.warn('[Drops] Инвентарь не разобран (' + res.statusCode + ', ' +
            String(res.headers['content-type'] || 'без типа').split(';')[0] + '):', e.message);
          resolve({ campaigns: [], error: true, dashboardComplete: false });
        }
      });
    });

    req.on('error', (e) => {
      console.warn('[Drops] Инвентарь: сеть —', e.message);
      resolve({ campaigns: [], error: true, dashboardComplete: false });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Инвентарь из общего кэша: не чаще раза в минуту, сколько бы мест его
 * ни спрашивало. Прогресс просмотра Twitch и сам считает по минутам.
 * force — ручное обновление кнопкой: тогда кэш сбрасывается. Неполный
 * инвентарь (без списка всех кампаний) держим недолго, как пустой.
 */
function getDropsInventory(options = {}) {
  if (options && options.force) {
    invalidateTwitchCache('inventory');
    // Список кампаний живёт 10 минут, и «Обновить» не находило только что
    // начавшуюся кампанию. Сбрасываем и его, но не чаще раза в минуту:
    // частые нажатия не должны долбить Twitch тяжёлым запросом
    const dashboard = twitchCache.get('dashboard');
    if (dashboard?.settled && Date.now() - dashboard.settledAt > 60 * 1000) {
      invalidateTwitchCache('dashboard');
    }
  }
  return cachedTwitchCall(
    'inventory',
    fetchDropsInventoryUncached,
    result => (Array.isArray(result?.campaigns) && result.campaigns.length && result.dashboardComplete
      ? TWITCH_CACHE_TTL.inventory
      : TWITCH_CACHE_TTL.inventoryEmpty)
  );
}

ipcMain.handle('fetch-drops-inventory', async (event, options) => getDropsInventory(options));

/**
 * Какой канал Twitch засчитывает прямо сейчас и сколько минут набрано.
 *
 * Единственный прямой ответ на вопрос «идёт ли фарминг». Инвентарь
 * показывает то же с опозданием и не говорит, на каком канале. Ответ
 * кэшируется на 50 секунд: Twitch обновляет минуты раз в минуту.
 */
ipcMain.handle('get-drop-session', async (event, channelLogin) => {
  const login = String(channelLogin || '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const authToken = await getCookieAuthToken();
  if (!authToken) return { ok: false, error: 'нет cookie-токена' };
  if (!login) return { ok: false, error: 'не указан канал' };

  const gqlHeaders = (postData) => {
    const headers = {
      'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Authorization': 'OAuth ' + authToken,
      'Content-Type': 'text/plain;charset=UTF-8',
      'Content-Length': Buffer.byteLength(postData)
    };
    if (hasFreshIntegrity()) {
      headers['Client-Integrity'] = twitchGqlHeaders.integrity;
      if (twitchGqlHeaders.deviceId) headers['X-Device-Id'] = twitchGqlHeaders.deviceId;
      if (twitchGqlHeaders.clientVersion) headers['Client-Version'] = twitchGqlHeaders.clientVersion;
    }
    return headers;
  };

  const parse = (res) => {
    if (!res.ok) return { error: res.error || res.statusCode };
    try {
      const parsed = JSON.parse(res.data);
      const root = Array.isArray(parsed) ? parsed[0] : parsed;
      if (root?.errors?.length) return { error: root.errors[0]?.message || 'ошибка GraphQL', data: root.data };
      return { data: root?.data };
    } catch (e) {
      return { error: e.message };
    }
  };

  // Идентификатор канала: без него Twitch отвечает пустой сессией. Канал
  // за время сессии не меняет id, поэтому запоминаем надолго.
  const channelId = await cachedTwitchCall('channelId:' + login, async () => {
    const postData = JSON.stringify({ query: 'query { user(login: "' + login + '") { id } }' });
    let res = await twitchPost(postData, gqlHeaders(postData));
    // id канала публичный. С отозванным входом Twitch отвечает 401 и на
    // него, и окно читало это как «канал не найден» — повторяем без входа
    if (res.statusCode === 401) {
      res = await twitchPost(postData, {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'text/plain;charset=UTF-8',
        'Content-Length': Buffer.byteLength(postData)
      });
    }
    const { data, error } = parse(res);
    if (error) console.warn('[Зачёт] Не удалось узнать id канала', login, error);
    return data?.user?.id || null;
  }, id => (id ? 6 * 60 * 60 * 1000 : 15 * 1000));

  if (!channelId) return { ok: false, error: 'канал не найден' };

  return cachedTwitchCall('dropSession:' + login, async () => {
    // Та же операция и те же переменные, что у сайта Twitch: без channelID
    // сервер возвращает null даже когда минуты идут — проверено замером
    const postData = JSON.stringify({
      operationName: 'DropCurrentSessionContext',
      variables: { channelLogin: login, channelID: channelId },
      query: 'query DropCurrentSessionContext($channelLogin: String!, $channelID: ID!) { channel(id: $channelID) { id name } user(login: $channelLogin) { id } currentUser { dropCurrentSession { dropID requiredMinutesWatched currentMinutesWatched channel { id name displayName } game { id name displayName } } } }'
    });
    const { data, error } = parse(await twitchPost(postData, gqlHeaders(postData)));
    if (error) return { ok: false, error };
    return { ok: true, session: data?.currentUser?.dropCurrentSession || null };
  }, result => (result && result.ok ? 50 * 1000 : 15 * 1000));
});

// Проверка наличия стримов с дропсами в категории
ipcMain.handle('check-category-drops', async (event, categoryName) => {
  // Надёжный путь: сначала проверяем активные кампании на странице Twitch Drops
  const hasInventoryDrops = await hasActiveInventoryDropsForCategory(categoryName);
  if (hasInventoryDrops === true) {
    return true;
  }

  // Список кампаний полный, а игры в нём нет — дропсов нет. Раньше здесь
  // шёл ещё запрос стримов по каждой категории ради тега «Drops» в
  // названиях: при старте их набегало больше сотни.
  if (hasInventoryDrops === false) {
    return false;
  }

  const escapedName = String(categoryName || '').replace(/"/g, '\\"');
  const postData = JSON.stringify({
    query: 'query { game(name: "' + escapedName + '") { streams(first: 10) { edges { node { title broadcaster { login } freeformTags { name } } } } } }'
  });

  // null — Twitch не ответил, и судить не о чем. Раньше сбой отвечал false,
  // то есть «дропсов нет», и категория могла быть удалена из-за обрыва.
  // Через очередь залпов: на старте так проверяется сотня категорий разом
  const parsed = parseGameStreams(await withTwitchBurstSlot(() => twitchPost(postData, {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }, { attempts: 2 })), '[Дропсы категории]');
  if (!parsed) return null;

  // Запасной путь: эвристика по тегам и названиям стримов
  return parsed.edges.some(edge => streamHasDropsSignal(edge?.node));
});

// Получить баллы канала через Twitch API
/**
 * Баллы канала и бонусный сундук.
 *
 * Тот же запрос ChannelPointsContext, что и раньше, но полным текстом и с
 * полем availableClaim: если сундук готов, Twitch отдаёт его id, и мы
 * забираем его мутацией — без чата. До сих пор сундуки собирал скрипт
 * внутри webview чата (около 190 МБ памяти и заметный процессор ради
 * одной кнопки раз в четверть часа). Чат теперь выключен по умолчанию.
 */
const claimedChests = new Set();

ipcMain.handle('get-channel-points', async (event, channelLogin) => {
  const login = String(channelLogin || '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const authToken = await getCookieAuthToken();
  if (!authToken) return { points: 0, error: 'No auth token' };
  if (!login) return { points: 0, error: 'no channel' };

  const gqlHeaders = (postData) => {
    const headers = {
      'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Authorization': 'OAuth ' + authToken,
      'Content-Type': 'text/plain;charset=UTF-8',
      'Content-Length': Buffer.byteLength(postData)
    };
    if (hasFreshIntegrity()) {
      headers['Client-Integrity'] = twitchGqlHeaders.integrity;
      if (twitchGqlHeaders.deviceId) headers['X-Device-Id'] = twitchGqlHeaders.deviceId;
      if (twitchGqlHeaders.clientVersion) headers['Client-Version'] = twitchGqlHeaders.clientVersion;
      if (twitchGqlHeaders.sessionId) headers['Client-Session-Id'] = twitchGqlHeaders.sessionId;
    }
    return headers;
  };

  const parse = (res) => {
    if (!res.ok) return { error: res.error || res.statusCode };
    try {
      const parsed = JSON.parse(res.data);
      const root = Array.isArray(parsed) ? parsed[0] : parsed;
      return { data: root?.data, error: root?.errors?.[0]?.message || null };
    } catch (e) {
      return { error: e.message };
    }
  };

  const postData = JSON.stringify({
    operationName: 'ChannelPointsContext',
    variables: { channelLogin: login },
    query: 'query ChannelPointsContext($channelLogin: String!) { community: user(login: $channelLogin) { id channel { id self { communityPoints { balance availableClaim { id } } } } } }'
  });

  const { data, error } = parse(await twitchPost(postData, gqlHeaders(postData)));
  if (error && !data?.community) {
    console.warn('[Баллы] Twitch не ответил:', error);
    return { points: 0, error: String(error) };
  }

  const community = data?.community || {};
  const balance = community.channel?.self?.communityPoints?.balance;
  // Баланса нет — это «не знаю», а не ноль. Twitch отвечает и частичной
  // ошибкой: community пришло, а self пустой (service timeout). Раньше это
  // давало points: 0, следующий опрос видел прирост на весь баланс канала,
  // и «заработано за стрим» раздувалось на тысячи.
  if (typeof balance !== 'number') {
    if (error) console.warn('[Баллы] Баланса нет в ответе:', String(error).slice(0, 120));
    return { points: null, error: error ? String(error) : 'нет баланса' };
  }
  const points = balance;
  const claimId = community.channel?.self?.communityPoints?.availableClaim?.id || null;
  const channelId = community.channel?.id || community.id || null;

  const result = { points, error: null, claimed: null };

  // Сундук готов — забираем. Настройка автосбора та же, что и у наград.
  const autoClaim = store.get('settings.autoClaimDrops');
  if (claimId && channelId && autoClaim !== false && !claimedChests.has(claimId)) {
    claimedChests.add(claimId);
    if (claimedChests.size > 200) claimedChests.delete(claimedChests.values().next().value);

    const claimData = JSON.stringify({
      operationName: 'ClaimCommunityPoints',
      variables: { input: { channelID: String(channelId), claimID: String(claimId) } },
      query: 'mutation ClaimCommunityPoints($input: ClaimCommunityPointsInput!) { claimCommunityPoints(input: $input) { claim { id pointsEarnedTotal pointsEarnedBaseline } error { code } } }'
    });
    const claimed = parse(await twitchPost(claimData, gqlHeaders(claimData)));
    const claim = claimed.data?.claimCommunityPoints?.claim;
    const claimError = claimed.error || claimed.data?.claimCommunityPoints?.error?.code;

    if (claim) {
      const earned = Number(claim.pointsEarnedTotal) || 0;
      result.claimed = { id: claim.id, points: earned };
      console.log('[Сундук] Собран запросом:', login, '+' + earned);
      sendToMain('chest-claimed', { channel: login, points: earned, timestamp: Date.now() });
    } else {
      // Не вышло — дадим следующему опросу попробовать снова
      claimedChests.delete(claimId);
      console.warn('[Сундук] Не удалось забрать:', login, claimError || 'неизвестно');
    }
  }

  return result;
});

// Выключение компьютера
ipcMain.handle('shutdown-computer', async (event, action) => {
  const { exec } = require('child_process');

  switch (action) {
    case 'shutdown':
      if (process.platform === 'win32') {
        exec('shutdown /s /t 0');
      } else if (process.platform === 'darwin') {
        exec('sudo shutdown -h now');
      }
      break;
    case 'sleep':
      if (process.platform === 'win32') {
        exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
      } else if (process.platform === 'darwin') {
        exec('pmset sleepnow');
      }
      break;
    case 'hibernate':
      if (process.platform === 'win32') {
        exec('shutdown /h');
      }
      break;
  }
});

// Получение одного дропа
/**
 * Получение награды за дроп.
 *
 * Здесь была та же ловушка, что и с отпиской: предпочитался токен
 * OAuth-приложения, а мутация выполняется под веб-клиентом Twitch, который
 * принимает только cookie-токен из webview. Токен приложения давал 401,
 * а наружу это выходило безликим «Не удалось получить награду».
 *
 * Мутации к тому же проходят проверку целостности клиента, поэтому
 * прикладываем Client-Integrity, перехваченный у запросов самого Twitch.
 */
ipcMain.handle('claim-drop', async (event, dropInstanceID) => {
  if (!dropInstanceID) {
    return { success: false, error: 'Не указана награда' };
  }

  const cookieToken = await getCookieAuthToken();
  const oauth = getOAuth();
  const token = cookieToken || oauth?.accessToken;

  if (!token) {
    return { success: false, error: 'Требуется вход в Twitch. Откройте стрим в приложении.' };
  }

  console.log('[Награда] Получаю', dropInstanceID, '| токен:', cookieToken ? 'cookie' : 'OAuth');
  return claimDropById(dropInstanceID, token);
});

/**
 * Забирает одну награду: persisted-мутация, а при устаревшем хеше — тот же
 * запрос обычным текстом. Общая для «Получить» и «Получить все»: у второй
 * запасного пути не было, и при протухшем хеше она не забирала ни одной
 * награды, сообщая при этом об успехе.
 */
async function claimDropById(dropInstanceID, token) {
  // Хеш проверен запросом к Twitch: даёт 200 и разбираемый ответ. В соседнем
  // обработчике «получить все» у той же операции стоял другой хеш, и он
  // отвечает PersistedQueryNotFound — там он и был исправлен.
  const persisted = JSON.stringify([{
    operationName: 'DropsPage_ClaimDropRewards',
    variables: { input: { dropInstanceID } },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930'
      }
    }
  }]);

  // Хеши со временем протухают, поэтому держим запасной путь обычным текстом
  const inline = JSON.stringify([{
    operationName: 'DropsPage_ClaimDropRewards',
    variables: { input: { dropInstanceID } },
    query: `mutation DropsPage_ClaimDropRewards($input: ClaimDropRewardsInput!) {
      claimDropRewards(input: $input) {
        status
      }
    }`
  }]);

  const buildHeaders = (body) => {
    const headers = {
      'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Authorization': `OAuth ${token}`,
      'Content-Type': 'text/plain;charset=UTF-8',
      'Content-Length': Buffer.byteLength(body)
    };

    // Мутации проходят проверку целостности клиента, в отличие от обычных запросов
    if (hasFreshIntegrity()) {
      headers['Client-Integrity'] = twitchGqlHeaders.integrity;
      if (twitchGqlHeaders.deviceId) headers['X-Device-Id'] = twitchGqlHeaders.deviceId;
      if (twitchGqlHeaders.clientVersion) headers['Client-Version'] = twitchGqlHeaders.clientVersion;
      if (twitchGqlHeaders.sessionId) headers['Client-Session-Id'] = twitchGqlHeaders.sessionId;
    }

    return headers;
  };

  // Пользователю — понятная фраза, служебный текст Twitch — только в лог.
  // Раньше в тост уходили «код ответа 503», английские сообщения GraphQL и
  // голые статусы вроде «Twitch ответил: UNKNOWN»
  const REJECTED = 'Twitch не принял запрос — попробуйте позже';

  const send = async (body) => {
    const res = await twitchPost(body, buildHeaders(body));

    if (!res.ok) {
      if (res.statusCode === 401 || res.statusCode === 403) {
        return { success: false, error: 'Twitch отклонил авторизацию. Откройте стрим в приложении и повторите.' };
      }
      console.warn('[Награда] Twitch не ответил:', res.error || ('код ответа ' + res.statusCode));
      return {
        success: false,
        error: res.statusCode === 0 ? 'Нет связи с Twitch — попробуйте позже' : REJECTED
      };
    }

    try {
      const parsed = JSON.parse(res.data);
      const result = Array.isArray(parsed) ? parsed[0] : parsed;
      const status = result?.data?.claimDropRewards?.status;
      const errors = Array.isArray(result?.errors) ? result.errors : [];

      console.log('[Награда] Ответ Twitch:', status || JSON.stringify(result).slice(0, 200));

      // Уже полученная награда — не ошибка: результат тот же, она у пользователя
      if (status === 'ELIGIBLE_FOR_ALL' || status === 'DROP_INSTANCE_ALREADY_CLAIMED') {
        invalidateTwitchCache('inventory');
        return { success: true, already: status === 'DROP_INSTANCE_ALREADY_CLAIMED' };
      }

      if (errors.length > 0) {
        const message = String(errors[0]?.message || 'ошибка Twitch');
        console.warn('[Награда] Ошибка Twitch:', message.slice(0, 200));
        return { success: false, error: REJECTED, staleHash: /PersistedQueryNotFound/i.test(message) };
      }

      // Неожиданный статус: сам код — в лог, по нему и разбираться
      if (status) {
        console.warn('[Награда] Twitch не выдал награду, статус:', status);
        return { success: false, error: 'Twitch не выдал награду — попробуйте позже' };
      }

      // Ответ пустой: Twitch не признал эту награду. Обычно её уже забрали
      // на сайте либо кампания закончилась, а список в приложении устарел.
      return {
        success: false,
        error: 'Twitch не подтвердил награду — возможно, её уже забрали или кампания закончилась. Обновите список.',
        stale: true
      };
    } catch (e) {
      console.warn('[Награда] Ответ Twitch не разобран:', e.message);
      return { success: false, error: REJECTED };
    }
  };

  let outcome = await send(persisted);

  if (outcome.staleHash) {
    console.warn('[Награда] Хеш запроса устарел, повторяю обычным текстом мутации');
    outcome = await send(inline);
  }

  return outcome;
}

// Получение всех доступных наград
//
// Ответ: { success, claimed, total, message?, error? }. Раньше сбой запроса
// инвентаря давал success с «Нет доступных наград», а награды, не взятые
// ни одна, — success с claimed: 0. Пользователь думал, что всё забрано, а
// награды сгорали с концом кампании.
ipcMain.handle('claim-all-drops', async () => {
  console.log('[Награды] Забираю все доступные');

  const authToken = await getCookieAuthToken();
  if (!authToken) {
    return { success: false, claimed: 0, total: 0, error: 'Требуется вход в Twitch. Откройте стрим в приложении.' };
  }

  const postData = JSON.stringify([{
    operationName: 'Inventory',
    variables: {},
    query: `query Inventory {
      currentUser {
        id
        inventory {
          dropCampaignsInProgress {
            id
            timeBasedDrops {
              id
              self {
                dropInstanceID
                isClaimed
                currentMinutesWatched
              }
              requiredMinutesWatched
            }
          }
        }
      }
    }`
  }]);

  // Через общий twitchPost: повтор при обрыве и общая пауза после 429
  const res = await twitchPost(postData, {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Authorization': `OAuth ${authToken}`,
    'Content-Type': 'text/plain;charset=UTF-8',
    'Content-Length': Buffer.byteLength(postData)
  });

  let campaigns = null;
  if (res.ok) {
    try {
      const parsed = JSON.parse(res.data);
      const root = Array.isArray(parsed) ? parsed[0] : parsed;
      const list = root?.data?.currentUser?.inventory?.dropCampaignsInProgress;
      // Нет инвентаря — «не знаю», а не «наград нет»
      if (root?.data?.currentUser) campaigns = Array.isArray(list) ? list : [];
      else console.warn('[Награды] Инвентарь не получен:', String(root?.errors?.[0]?.message || 'нет данных').slice(0, 120));
    } catch (e) {
      console.warn('[Награды] Ответ инвентаря не разобран:', e.message);
    }
  } else {
    console.warn('[Награды] Инвентарь недоступен:', res.error || res.statusCode);
  }

  if (!campaigns) {
    const error = res.statusCode === 401
      ? 'Twitch не принял вход — войдите в Twitch заново'
      : 'Twitch не ответил, попробуйте позже';
    return { success: false, claimed: 0, total: 0, error };
  }

  const drops = [];
  for (const campaign of campaigns) {
    for (const drop of (campaign?.timeBasedDrops || [])) {
      const self = drop?.self;
      if (!self || self.isClaimed || !self.dropInstanceID) continue;
      if ((self.currentMinutesWatched || 0) >= (drop.requiredMinutesWatched || 0)) {
        drops.push(self.dropInstanceID);
      }
    }
  }

  if (drops.length === 0) {
    return { success: true, claimed: 0, total: 0, message: 'Нет доступных наград для получения' };
  }

  let claimed = 0;
  for (const dropInstanceID of drops) {
    const outcome = await claimDropById(dropInstanceID, authToken);
    if (outcome.success) claimed++;
    else console.warn('[Награды] Не удалось забрать', dropInstanceID + ':', outcome.error);

    // Небольшая задержка между получениями
    await new Promise(r => setTimeout(r, 500));
  }

  if (claimed > 0) invalidateTwitchCache('inventory');

  if (claimed === 0) {
    return { success: false, claimed: 0, total: drops.length, error: 'Twitch не выдал ни одной награды — заберите их вручную' };
  }

  return {
    success: true,
    claimed,
    total: drops.length,
    message: `Получено наград: ${claimed}/${drops.length}`
  };
});

// Автозапуск: включение и выключение только по переключателю
ipcMain.on('set-autostart', (event, enabled) => {
  setAutostart(!!enabled);
});

// Настоящее состояние автозапуска — по Windows, а не по сохранённому флагу
ipcMain.handle('get-autostart', () => (app.isPackaged ? isAutostartEnabled() : store.get('settings.autostart') === true));
// Подписки текущего пользователя.
//
// Раньше шли через Helix с OAuth-токеном приложения, а тот давно протух:
// Twitch отвечал 401, список никогда не обновлялся, и страница молча
// показывала сохранённый. Теперь тот же GraphQL с cookie-токеном, что и
// у всего остального. Аргумент вызова оставлен ради совместимости.
//
// Ответ: { items, complete }. complete — список дочитан до конца. Раньше
// сбой на второй странице отдавал первые сто подписок как весь список, и
// страница сохраняла его поверх прежнего: остальные каналы пропадали
// вместе с избранным и приоритетами. В items только поля самого списка:
// заглушки «0 подписчиков, не в эфире» затирали сохранённые значения.
ipcMain.handle('get-user-subscriptions', async () => {
  const authToken = await getCookieAuthToken();
  if (!authToken) {
    console.log('[Подписки] Нет cookie-токена — нужен хотя бы один запуск стрима');
    return { items: [], complete: false };
  }

  const result = [];
  let cursor = null;
  let complete = false;

  // Страницами по сто, не больше десяти: тысяча подписок — разумный предел
  for (let page = 0; page < 10; page++) {
    const after = cursor ? ', after: "' + String(cursor).replace(/"/g, '') + '"' : '';
    // Та же форма, что у запроса ChannelFollows на сайте Twitch: user без
    // аргументов означает текущего пользователя, order обязателен —
    // без него сервер отвечает «service error»
    const postData = JSON.stringify({
      operationName: 'ChannelFollows',
      query: 'query ChannelFollows { user { follows(first: 100, order: DESC' + after + ') { edges { cursor node { id login displayName profileImageURL(width: 70) } } pageInfo { hasNextPage } } } }'
    });
    const headers = {
      'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Authorization': 'OAuth ' + authToken,
      'Content-Type': 'text/plain;charset=UTF-8',
      'Content-Length': Buffer.byteLength(postData)
    };
    if (hasFreshIntegrity()) {
      headers['Client-Integrity'] = twitchGqlHeaders.integrity;
      if (twitchGqlHeaders.deviceId) headers['X-Device-Id'] = twitchGqlHeaders.deviceId;
      if (twitchGqlHeaders.clientVersion) headers['Client-Version'] = twitchGqlHeaders.clientVersion;
    }

    const res = await twitchPost(postData, headers);
    if (!res.ok) {
      console.warn('[Подписки] Twitch не ответил:', res.error || res.statusCode);
      break;
    }

    let follows = null;
    let partial = false;
    try {
      const parsed = JSON.parse(res.data);
      const root = Array.isArray(parsed) ? parsed[0] : parsed;
      if (root?.errors) {
        console.warn('[Подписки] GraphQL:', JSON.stringify(root.errors).slice(0, 200));
        // Страница с ошибкой рядом с данными может быть неполной
        partial = true;
      }
      follows = root?.data?.user?.follows || root?.data?.currentUser?.follows;
    } catch (e) {
      console.warn('[Подписки] Ошибка разбора:', e.message);
      break;
    }
    if (!follows) break;

    const edges = follows.edges || [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node?.login) continue;
      result.push({
        id: node.id,
        login: node.login,
        displayName: node.displayName || node.login,
        profileImageUrl: node.profileImageURL || ''
      });
      cursor = edge.cursor || cursor;
    }

    if (partial) break;
    if (!follows.pageInfo?.hasNextPage) {
      complete = true;
      break;
    }
    // Страница пустая, а Twitch обещает следующую: курсор не сдвинуть
    if (edges.length === 0) break;
  }

  console.log('[Подписки] Загружено:', result.length + (complete ? '' : ' (список неполный)'));
  return { items: result, complete };
});

// Отписка от канала через GraphQL API
/**
 * Отписка от канала.
 *
 * Прямая GraphQL-мутация здесь не работает. Проверено измерением: тот же
 * cookie-токен успешно выполняет запрос инвентаря дропсов (код 200), то
 * есть сессия настоящая и авторизованная, — но мутацию отписки Twitch
 * отклоняет с 401 даже с приложенным Client-Integrity. Подпись целостности
 * привязана к живому клиенту и переиспользованию не поддаётся.
 *
 * Через Helix тоже нельзя: Twitch убрал возможность отписки из публичного
 * API в 2023 году.
 *
 * Поэтому отписываемся так же, как приложение собирает сундуки, — действием
 * внутри самой страницы Twitch, где весь нужный контекст уже есть.
 */
/**
 * Спрашивает у Twitch, подписан ли пользователь на канал.
 *
 * Запросы, в отличие от мутаций, проходят с cookie-токеном без проверки
 * целостности — это проверено измерением. Нужна, чтобы не выдавать успех
 * отписки, не убедившись в нём: без проверки приложение сообщало об успехе
 * даже для несуществующего канала.
 */
async function isFollowingChannel(login) {
  const token = await getCookieAuthToken();
  if (!token || !login) return null;

  const safeLogin = String(login).replace(/"/g, '');
  const body = JSON.stringify({
    query: 'query { user(login: "' + safeLogin + '") { id self { follower { followedAt } } } }'
  });

  // Через twitchPost: прямой запрос шёл мимо общей паузы после 429, а его
  // собственный 429 паузу не продлевал — отписка залпом затягивала
  // ограничение для всего фарминга
  const res = await twitchPost(body, {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Authorization': 'OAuth ' + token,
    'Content-Type': 'text/plain;charset=UTF-8',
    'Content-Length': Buffer.byteLength(body)
  }, { attempts: 2 });
  if (!res.ok) return null;

  try {
    const user = JSON.parse(res.data)?.data?.user;
    if (!user) return null;
    return !!user.self?.follower?.followedAt;
  } catch (e) {
    return null;
  }
}

ipcMain.handle('unsubscribe-channel', async (event, authToken, channelLogin) => {
  if (!channelLogin) {
    return { success: false, error: 'Не указан канал' };
  }

  const { BrowserWindow } = require('electron');

  const worker = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'persist:twitch',
      nodeIntegration: false,
      contextIsolation: true,
      offscreen: false
    }
  });

  const finish = (result) => {
    try {
      if (!worker.isDestroyed()) worker.destroy();
    } catch (e) { /* ignore */ }
    return result;
  };

  try {
    const followedBefore = await isFollowingChannel(channelLogin);

    if (followedBefore === null) {
      return finish({ success: false, error: 'Канал не найден или Twitch не ответил' });
    }

    if (followedBefore === false) {
      console.log('[Unsubscribe] Подписки на этот канал и не было');
      return finish({ success: true, already: true });
    }

    console.log('[Unsubscribe] Открываю страницу канала:', channelLogin);
    await worker.loadURL(`https://www.twitch.tv/${channelLogin}`);

    // Страница Twitch собирается скриптами, кнопка появляется не сразу
    const clicked = await worker.webContents.executeJavaScript(`
      (async function () {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        const findUnfollow = () => document.querySelector('[data-a-target="unfollow-button"]');
        const findFollow = () => document.querySelector('[data-a-target="follow-button"]');

        let button = null;
        for (let i = 0; i < 40; i++) {
          button = findUnfollow();
          if (button) break;
          if (findFollow()) return { ok: true, already: true };
          await sleep(500);
        }

        if (!button) return { ok: false, reason: 'not-found' };

        // Интерфейс Twitch написан на React: простой .click() он местами
        // игнорирует, потому что слушает последовательность событий мыши.
        // Проверено на живой странице: одиночный click подтверждения не
        // открывал и подписку не снимал.
        const press = (el) => {
          const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
        };

        press(button);
        await sleep(2000);

        // Подтверждение появляется не всегда: в части вариантов интерфейса
        // отписка происходит сразу. Ищем кнопку подтверждения по смыслу,
        // а не по вёрстке — имена классов Twitch меняет постоянно.
        for (let attempt = 0; attempt < 6; attempt++) {
          if (findFollow()) return { ok: true };

          const candidates = [...document.querySelectorAll('[role="dialog"] button, button')];
          const confirm = candidates.find(b => {
            const text = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).trim();
            return /^(отписаться|unfollow|не следить|yes|да)/i.test(text);
          });

          if (confirm) {
            press(confirm);
            await sleep(1500);
            return { ok: true, confirmed: true };
          }

          await sleep(1000);
        }

        return { ok: true, unconfirmed: true };
      })();
    `);

    if (!clicked?.ok) {
      console.warn('[Unsubscribe] Кнопка не найдена на странице');
      return finish({
        success: false,
        error: 'Не удалось найти кнопку подписки на странице канала'
      });
    }

    // Результат подтверждаем запросом, а не верой в клик: страница могла
    // измениться, и нажатие ничего не значит само по себе.
    let followedAfter = true;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(r => setTimeout(r, 900));
      followedAfter = await isFollowingChannel(channelLogin);
      if (followedAfter === false) break;
    }

    if (followedAfter === false) {
      console.log('[Unsubscribe] Отписка подтверждена:', channelLogin);
      return finish({ success: true });
    }

    console.warn('[Unsubscribe] Подписка осталась после нажатия');
    return finish({
      success: false,
      error: 'Twitch не подтвердил отписку. Похоже, изменилась страница канала.'
    });
  } catch (error) {
    console.error('[Unsubscribe] Ошибка:', error.message);
    return finish({ success: false, error: error.message });
  }
});
/**
 * Подробности канала: аватарка, описание, подписчики, эфир, последняя
 * трансляция.
 *
 * Раньше это были пять запросов к Helix с Client-ID приложения и токеном
 * аккаунта, а подписчиков добирали через сторонние api.ivr.fi и decapi.me.
 * Токен аккаунта протух, Helix отвечал 401, /helix/users/follows Twitch
 * удалил — в логе на каждый вызов стояло «No user found», а наружу уходили
 * нули: страница подписок записывала каналам 0 подписчиков и «не в эфире»
 * поверх сохранённого. Эти поля публичные, поэтому теперь один запрос
 * GraphQL с веб-Client-ID без авторизации, и список подписок сторонним
 * сервисам больше не уходит.
 *
 * null — узнать не удалось. Заглушек с нулями нет: вызывающий не должен
 * затирать ими настоящие значения. Токен в аргументах оставлен ради
 * совместимости вызова и не используется.
 */
ipcMain.handle('get-channel-details', async (event, _authToken, channelLogin) => {
  const login = String(channelLogin || '').replace(/^@/, '').trim().toLowerCase();
  if (!login) return null;

  const postData = JSON.stringify({
    query: 'query($login: String!) { user(login: $login) { id profileImageURL(width: 300) description followers { totalCount } lastBroadcast { startedAt } stream { createdAt } } }',
    variables: { login }
  });

  // Страница подписок спрашивает обо всех каналах разом — через общую
  // очередь залпов (см. withTwitchBurstSlot)
  const res = await withTwitchBurstSlot(() => twitchPost(postData, {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }));

  if (!res.ok) {
    console.warn('[Канал] Подробности недоступны:', login, res.error || res.statusCode);
    return null;
  }

  try {
    const parsed = JSON.parse(res.data);
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    // Частичный ответ с ошибкой не годится: пропавший stream прочитался бы
    // как «не в эфире» и лёг бы поверх сохранённого
    if (root?.errors?.length) {
      console.warn('[Канал] Ошибка Twitch:', login, String(root.errors[0]?.message || '').slice(0, 120));
      return null;
    }
    const user = root?.data?.user;
    if (!user) return null;

    const details = {
      profileImageUrl: user.profileImageURL || '',
      description: user.description || '',
      lastStreamDate: user.stream?.createdAt || user.lastBroadcast?.startedAt || null,
      isLive: !!user.stream
    };
    // Нет числа — нет поля: проверка «followers >= 0» пропустила бы и null
    const followers = user.followers?.totalCount;
    if (typeof followers === 'number' && Number.isFinite(followers)) details.followers = followers;
    return details;
  } catch (e) {
    console.warn('[Канал] Ответ не разобран:', login, e.message);
    return null;
  }
});
