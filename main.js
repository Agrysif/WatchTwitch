const { app, BrowserWindow, ipcMain, Notification, powerSaveBlocker, shell, Tray, Menu, webContents, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const http = require('http');
const https = require('https');
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
  inFlight: 30 * 1000
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
      return result;
    })
    .catch(error => {
      twitchCache.delete(key);
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
  const Store = require('electron-store');
  const раннийStore = new Store();
  if (раннийStore.get('settings.lowGraphics') !== false) {
    app.disableHardwareAcceleration();
    console.log('[Графика] Экономный режим: аппаратное ускорение отключено');
  }
} catch (e) {
  console.warn('[Графика] Не удалось прочитать настройку:', e.message);
}

app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('log-level', '3');

const store = new Store();
const processLabels = new Map();

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
const SCOPES = [
  // User data
  'user:read:email',
  'user:read:follows',
  'user:read:subscriptions',
  'user:read:blocked_users',
  'user:edit',
  'user:edit:follows',
  'user:edit:broadcast',
  // Channel data
  'channel:read:subscriptions',
  'channel:read:redemptions',
  'channel:read:hype_train',
  'channel:read:polls',
  'channel:read:predictions',
  'channel:read:goals',
  'channel:read:charity',
  'channel:read:editors',
  'channel:read:stream_key',
  'channel:read:vips',
  'channel:manage:redemptions',
  'channel:manage:polls',
  'channel:manage:predictions',
  'channel:manage:broadcast',
  'channel:manage:extensions',
  'channel:manage:videos',
  'channel:manage:vips',
  // Moderation
  'moderation:read',
  'moderator:read:followers',
  'moderator:read:chatters',
  'moderator:read:chat_settings',
  'moderator:read:automod_settings',
  'moderator:read:blocked_terms',
  'moderator:read:chat_messages',
  // Clips & Videos
  'clips:edit',
  // Bits
  'bits:read',
  'channel:read:charity',
  // Analytics
  'analytics:read:extensions',
  'analytics:read:games',
  // Chat
  'chat:read',
  'chat:edit',
  'whispers:read',
  'whispers:edit'
];
let appAccessTokenCache = {
  token: null,
  expiresAt: 0
};

const getAppAccessToken = () => new Promise((resolve, reject) => {
  const now = Date.now();
  if (appAccessTokenCache.token && appAccessTokenCache.expiresAt > now + 60000) {
    resolve(appAccessTokenCache.token);
    return;
  }

  const tokenPath = `/oauth2/token?client_id=${TWITCH_CLIENT_ID}` +
    `&client_secret=${TWITCH_CLIENT_SECRET}` +
    `&grant_type=client_credentials`;

  const req = httpsRequestWithTimeout({
    hostname: 'id.twitch.tv',
    path: tokenPath,
    method: 'POST'
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json?.access_token && json?.expires_in) {
          appAccessTokenCache = {
            token: json.access_token,
            expiresAt: now + (json.expires_in * 1000)
          };
          resolve(appAccessTokenCache.token);
        } else {
          reject(new Error('No access_token in client credentials response'));
        }
      } catch (e) {
        reject(e);
      }
    });
  });

  req.on('error', reject);
  req.end();
});

const getFollowersFromDecapi = (login) => new Promise((resolve) => {
  const req = httpsRequestWithTimeout({
    hostname: 'api.decapi.me',
    path: `/twitch/followers/${encodeURIComponent(login)}`,
    method: 'GET'
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const value = parseInt(data, 10);
      if (Number.isFinite(value)) {
        resolve(value);
      } else {
        resolve(null);
      }
    });
  });

  req.on('error', () => resolve(null));
  req.end();
});

const getFollowersFromIvr = (login) => new Promise((resolve) => {
  const req = httpsRequestWithTimeout({
    hostname: 'api.ivr.fi',
    path: `/v2/twitch/user?login=${encodeURIComponent(login)}`,
    method: 'GET'
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const user = Array.isArray(json) ? json[0] : json;
        const value = user?.followers;
        if (typeof value === 'number') {
          resolve(value);
        } else {
          resolve(null);
        }
      } catch (e) {
        resolve(null);
      }
    });
  });

  req.on('error', () => resolve(null));
  req.end();
});
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
 * Список процессов берём у Windows раз в двадцать секунд — это дешевле,
 * чем один кусок видео.
 */
let gameModeState = { active: false, game: null, since: null };
let gameCheckBusy = false;

function checkRunningGame() {
  if (gameCheckBusy) return;
  if (store.get('settings.gameMode') === false) {
    if (gameModeState.active) setGameModeState(null);
    return;
  }
  if (process.platform !== 'win32') return;

  gameCheckBusy = true;
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

function setGameModeState(game) {
  const active = !!game;
  const sameGame = active && gameModeState.active && gameModeState.game?.exe === game.exe;
  if (active === gameModeState.active && (sameGame || !active)) return;

  gameModeState = { active, game: game || null, since: active ? Date.now() : null };
  console.log(active
    ? '[Игра] Запущена ' + game.title + ' (' + game.exe + ') — качество ' + GameMode.QUALITY + ', потолок ×' + GameMode.HEADROOM
    : '[Игра] Игра закрыта — возвращаю обычные настройки');

  refreshStreamLimits();
  sendToMain('game-mode', gameModeState);
}

ipcMain.handle('get-game-mode', () => gameModeState);

// Есть ли вход в Twitch: cookie auth-token в webview. Дёшево — без сети.
ipcMain.handle('has-twitch-session', async () => ({ loggedIn: !!(await getCookieAuthToken()) }));

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
    console.error('[Updater] Ошибка проверки:', err);
    sendToMain('update-error', err?.message || 'Не удалось проверить обновления');
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
 */
ipcMain.on('install-update', () => {
  console.log('[IPC] Готовлюсь к установке обновления…');

  app.isQuitting = true;

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
    autoUpdater.quitAndInstall(true, true);
  }, 800);
});

ipcMain.on('download-update', async () => {
  console.log('[IPC] Загрузка обновления...');
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error('[Updater] Ошибка загрузки обновления:', error);
    if (mainWindow) {
      sendToMain('update-error', error?.message || 'Ошибка загрузки обновления');
    }
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
              .filter(r => r && !r.draft)
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

// Read local file content for renderer
ipcMain.handle('read-file', async (event, relativePath) => {
  try {
    const fullPath = path.join(__dirname, relativePath);
    const fs = require('fs');

    // Check if path exists
    const exists = fs.existsSync(fullPath);

    if (!exists) {
      console.error('[IPC] File not found:', fullPath);
      // Try some alternative paths
      return { success: false, error: 'File not found: ' + fullPath };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    return { success: true, content };
  } catch (e) {
    console.error('[IPC] Failed to read file:', relativePath, e.message);
    return { success: false, error: e.message };
  }
});

// Автозапуск настройки
app.setLoginItemSettings({
  openAtLogin: store.get('settings.autostart', false)
});

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile('splash.html');
  splashWindow.center();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
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

  // В dev-режиме дублируем консоль renderer в терминал: без этого ошибки
  // интерфейса видны только в DevTools и легко проходят мимо.
  if (!app.isPackaged) {
    // Electron 36 передаёт параметры в объекте события; старую форму с
    // отдельными аргументами оставляем для совместимости
    mainWindow.webContents.on('console-message', (event, legacyLevel, legacyMessage, legacyLine, legacySource) => {
      const modern = event && typeof event.message === 'string';
      const message = modern ? event.message : legacyMessage;
      const line = modern ? event.lineNumber : legacyLine;
      const sourceId = modern ? event.sourceId : legacySource;
      const level = modern ? event.level : (legacyLevel === 3 ? 'error' : (legacyLevel === 2 ? 'warning' : 'info'));
      if (level !== 'warning' && level !== 'error') return;

      const source = String(sourceId || '').split('/').pop();
      console.log('[Renderer:' + (level === 'error' ? 'error' : 'warn') + '] ' + message + ' (' + source + ':' + line + ')');
    });
  }

  // Трафик считаем только у webview с видео: само окно приложения
  // почти ничего не качает, а отладчик на нём — лишняя нагрузка
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    setupTrafficMonitoring(webContents);
  });

  // Показываем главное окно после загрузки и закрываем splash
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, 1500); // Минимум 1.5 секунды splash screen
  });

  // Открыть DevTools в режиме разработки
  // mainWindow.webContents.openDevTools(); // Временно для отладки
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Продолжаем работу в фоне при минимизации
  mainWindow.on('minimize', (event) => {
    console.log('Window minimized - continuing background work');
    // Можем свернуть в трей если нужно
    // event.preventDefault();
    // mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    // Сворачиваем в трей при закрытии (если включено)
    const minimizeToTray = store.get('settings.minimizeToTray', false); // По умолчанию выключено
    console.log('[DEBUG] Close event triggered');
    console.log('[DEBUG] app.isQuitting:', app.isQuitting);
    console.log('[DEBUG] minimizeToTray:', minimizeToTray);
    console.log('[DEBUG] Full settings object:', store.get('settings'));
    
    if (!app.isQuitting && minimizeToTray) {
      console.log('[DEBUG] Hiding window to tray');
      event.preventDefault();
      mainWindow.hide();
      // Показываем уведомление при первом сворачивании
      if (!store.get('trayNotificationShown', false)) {
        new Notification({
          title: 'WatchTwitch свернут в трей',
          body: 'Приложение продолжает работать в фоновом режиме. Кликните на иконку в трее для восстановления.'
        }).show();
        store.set('trayNotificationShown', true);
      }
    } else {
      // Сигнализируем renderer процессу о закрытии
      sendToMain('app-closing');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Показать/Скрыть',
        click: () => {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Открыть настройки',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
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

    tray.on('click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
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

function registerShortcuts() {
  if (store.get('settings.globalShortcuts') === false) {
    console.log('[Клавиши] Отключены в настройках');
    return;
  }

  for (const item of SHORTCUTS) {
    const ok = globalShortcut.register(item.accelerator, () => {
      if (item.action === 'toggle-window') {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else { mainWindow.show(); mainWindow.focus(); }
        return;
      }
      sendToMain('shortcut', item.action);
    });

    if (!ok) {
      console.warn('[Клавиши] Сочетание занято другой программой:', item.accelerator, '—', item.title);
    }
  }
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

ipcMain.on('set-global-shortcuts', (event, enabled) => {
  store.set('settings.globalShortcuts', !!enabled);
  unregisterShortcuts();
  if (enabled) registerShortcuts();
});

// Оставлять перехват клавиш после закрытия приложения нельзя
app.on('will-quit', unregisterShortcuts);

// OAuth авторизация Twitch
let authServer = null;

function startAuthServer() {
  return new Promise((resolve, reject) => {
    if (authServer) {
      authServer.close();
    }

    authServer = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);

      if (parsedUrl.pathname === '/auth/callback') {
        const { code, error } = parsedUrl.query;

        if (error) {
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
    <p>${error}</p>
  </div>
</body>
</html>`);
          authServer.close();
          reject(new Error(error));
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
              store.set('oauth', {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
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
      <img src="${user.profile_image_url}" alt="Avatar">
      <span>${user.display_name}</span>
    </div>
    <div class="countdown">Можете закрыть эту вкладку</div>
  </div>
</body>
</html>`);

              // Закрываем сервер через 2 секунды, чтобы браузер успел загрузить страницу
              setTimeout(() => {
                if (authServer) {
                  authServer.close();
                  authServer = null;
                }
              }, 2000);

              resolve(tokenData);
            } else {
              throw new Error('Не удалось получить access token');
            }
          } catch (error) {
            console.error('OAuth error:', error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Ошибка авторизации');
            authServer.close();
            authServer = null;
            reject(error);
          }
        }
      }
    });

    authServer.listen(3000, () => {
      console.log('Auth server started on port 3000');
    });

    authServer.on('error', (err) => {
      console.error('Auth server error:', err);
      reject(err);
    });
  });
}

// Открытие окна авторизации Twitch
async function openTwitchAuthWindow() {
  try {
    // Запускаем локальный сервер
    const serverPromise = startAuthServer();

    // Формируем URL авторизации
    const authUrl = `https://id.twitch.tv/oauth2/authorize?` +
      `client_id=${TWITCH_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(SCOPES.join(' '))}`;

    // Открываем в системном браузере (как просили)
    await shell.openExternal(authUrl);

    // Ждем результата от сервера
    const tokenData = await serverPromise;
    // Страница успеха сама закроется через 5 секунд (может потребоваться разрешение браузера)
    return { success: true, user: store.get('oauth.user') };
  } catch (error) {
    console.error('OAuth error:', error);
    if (authServer) {
      authServer.close();
      authServer = null;
    }
    return { success: false, error: error.message };
  }
}

async function refreshAccessToken() {
  const oauth = store.get('oauth');
  if (!oauth || !oauth.refreshToken) {
    throw new Error('No refresh token available');
  }

  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken
      })
    });

    const tokenData = await response.json();

    if (tokenData.access_token) {
      store.set('oauth.accessToken', tokenData.access_token);
      store.set('oauth.refreshToken', tokenData.refresh_token);
      store.set('oauth.expiresAt', Date.now() + (tokenData.expires_in * 1000));
      return tokenData.access_token;
    }

    throw new Error('Failed to refresh token');
  } catch (error) {
    console.error('Token refresh error:', error);
    // Если refresh не удался, удаляем старые данные
    store.delete('oauth');
    throw error;
  }
}

async function getValidAccessToken() {
  const oauth = store.get('oauth');

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

async function createStreamView(url, account = null) {
  if (!mainWindow) {
    console.error('Main window not available');
    return;
  }

  // Удаляем старый view если есть
  if (streamView) {
    mainWindow.removeBrowserView(streamView);
    streamView.destroy();
  }

  streamView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:twitch'
    }
  });

  // Реальный мониторинг трафика для BrowserView
  setupTrafficMonitoring(streamView.webContents);

  mainWindow.addBrowserView(streamView);

  // Устанавливаем размер и позицию - в области current-stream-info
  // Позиция: сверху после header, слева после sidebar
  const bounds = mainWindow.getBounds();
  streamView.setBounds({
    x: 250, // ширина sidebar
    y: 100,  // отступ сверху
    width: Math.min(800, bounds.width - 280),
    height: 450
  });

  console.log('Opening stream:', url);

  // Устанавливаем OAuth токен или cookies
  const oauth = store.get('oauth');
  if (oauth && oauth.accessToken) {
    console.log('Setting OAuth cookies for authenticated session');
    await setOAuthCookies(oauth.accessToken);
  } else if (account && account.webviewCookies) {
    // Используем куки из webview если есть
    console.log('Setting webview cookies for account:', account.username);
    await setStreamCookies(account.webviewCookies);
  } else if (account && account.cookies) {
    await setStreamCookies(account.cookies);
    console.log('Cookies set for account:', account.username);
  }

  streamView.webContents.loadURL(url);
  streamView.webContents.setAudioMuted(true);

  // Настраиваем качество после загрузки страницы
  streamView.webContents.once('did-finish-load', () => {
    console.log('Stream loaded, setting up quality...');

    // Если есть OAuth токен, инжектим его в localStorage
    const oauth = store.get('oauth');
    if (oauth && oauth.accessToken) {
      streamView.webContents.executeJavaScript(`
        (function() {
          try {
            // Устанавливаем токен в localStorage (как это делает Twitch)
            localStorage.setItem('auth-token', '${oauth.accessToken}');
            localStorage.setItem('login-token', '${oauth.accessToken}');
            
            // Также устанавливаем информацию о пользователе если есть
            if ('${oauth.user?.login}') {
              localStorage.setItem('login-username', '${oauth.user.login}');
              localStorage.setItem('twilight.user', JSON.stringify({
                id: '${oauth.user.id}',
                login: '${oauth.user.login}',
                displayName: '${oauth.user.displayName}'
              }));
            }
            
            console.log('✅ OAuth tokens injected into localStorage');
            
            // Перезагружаем страницу чтобы применить авторизацию
            setTimeout(() => location.reload(), 100);
          } catch (e) {
            console.error('❌ Error injecting OAuth tokens:', e);
          }
        })();
      `).then(() => {
        console.log('OAuth injection script executed');
      }).catch(err => {
        console.error('Failed to inject OAuth:', err);
      });
    } else {
      setupStreamQuality();
    }
  });

  // Обрабатываем повторную загрузку (после применения OAuth)
  streamView.webContents.on('did-finish-load', () => {
    // Проверяем был ли уже инжектирован OAuth (чтобы не зацикливаться)
    streamView.webContents.executeJavaScript(`localStorage.getItem('auth-token')`).then(authToken => {
      if (authToken) {
        console.log('OAuth already injected, setting up quality');
        setupStreamQuality();
      }
    });
  });

  // Логируем ошибки
  streamView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Stream failed to load:', errorCode, errorDescription);
  });


  // Перерисовка при изменении размера окна
  mainWindow.on('resize', () => {
    if (streamView) {
      const bounds = mainWindow.getBounds();
      streamView.setBounds({
        x: 250,
        y: 100,
        width: Math.min(800, bounds.width - 280),
        height: 450
      });
    }
  });
}

// Установка OAuth куки для авторизованной сессии
async function setOAuthCookies(accessToken) {
  if (!streamView || !accessToken) return;

  const session = streamView.webContents.session;

  try {
    // Устанавливаем auth-token cookie
    await session.cookies.set({
      url: 'https://www.twitch.tv',
      name: 'auth-token',
      value: accessToken,
      domain: '.twitch.tv',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction'
    });

    console.log('OAuth auth-token cookie set successfully');
  } catch (error) {
    console.error('Error setting OAuth cookies:', error);
  }
}

async function setStreamCookies(cookies) {
  if (!streamView || !cookies) return;

  const session = streamView.webContents.session;

  // Парсим cookies и устанавливаем их
  if (typeof cookies === 'string') {
    const cookiePairs = cookies.split(';');
    for (const pair of cookiePairs) {
      const [name, ...valueParts] = pair.trim().split('=');
      const value = valueParts.join('=');

      if (name && value) {
        try {
          await session.cookies.set({
            url: 'https://www.twitch.tv',
            name: name,
            value: value,
            domain: '.twitch.tv',
            path: '/',
            secure: true,
            httpOnly: false
          });
        } catch (e) {
          console.error('Error setting cookie:', name, e.message);
        }
      }
    }
    console.log('Cookies installed from string');
  } else if (Array.isArray(cookies)) {
    for (const cookie of cookies) {
      try {
        await session.cookies.set({
          url: 'https://www.twitch.tv',
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || '.twitch.tv',
          path: cookie.path || '/',
          secure: cookie.secure !== false,
          httpOnly: cookie.httpOnly || false,
          expirationDate: cookie.expirationDate
        });
      } catch (e) {
        console.error('Error setting cookie:', cookie.name, e.message);
      }
    }
    console.log('Cookies installed from array, count:', cookies.length);
  }
}

function setupStreamQuality() {
  if (!streamView) return;

  console.log('Setting up stream quality...');

  setTimeout(() => {
    streamView.webContents.executeJavaScript(`
      (function() {
        console.log('Quality setup script running...');
        
        const player = document.querySelector('video');
        if (player) {
          player.volume = 0;
          player.muted = true;
          player.play().catch(e => console.log('Play error:', e));
          console.log('Video player found and muted');
        } else {
          console.log('Video player not found');
        }
        
        setTimeout(() => {
          const settingsButton = document.querySelector('[data-a-target="player-settings-button"]');
          console.log('Settings button:', settingsButton ? 'found' : 'not found');
          
          if (settingsButton) {
            settingsButton.click();
            
            setTimeout(() => {
              const qualityButton = document.querySelector('[data-a-target="player-settings-menu-item-quality"]');
              console.log('Quality button:', qualityButton ? 'found' : 'not found');
              
              if (qualityButton) {
                qualityButton.click();
                
                setTimeout(() => {
                  const qualityInputs = document.querySelectorAll('input[type="radio"][name="quality"]');
                  console.log('Quality options found:', qualityInputs.length);
                  
                  if (qualityInputs.length > 0) {
                    qualityInputs[qualityInputs.length - 1].click();
                    console.log('Selected lowest quality');
                  }
                  
                  setTimeout(() => {
                    const closeButtons = document.querySelectorAll('[aria-label="Close"]');
                    if (closeButtons.length > 0) {
                      closeButtons[0].click();
                      console.log('Closed settings menu');
                    }
                  }, 300);
                }, 500);
              }
            }, 500);
          }
        }, 2000);
      })();
    `).then(() => {
      console.log('Quality setup script executed');
    }).catch(err => {
      console.error('Error executing quality setup:', err);
    });
  }, 3000);
}

// Получить статистику стрима
ipcMain.handle('get-stream-stats', async (event, channelLogin) => {
  const safeLogin = String(channelLogin || '').replace(/"/g, '');
  if (!safeLogin) return null;

  const postData = JSON.stringify({
    query: 'query { user(login: "' + safeLogin + '") { stream { title viewersCount createdAt game { name } } channel { self { communityPoints { balance } } } } }'
  });

  const authToken = await getCookieAuthToken();
  const headers = {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'text/plain;charset=UTF-8',
    'Content-Length': Buffer.byteLength(postData)
  };
  if (authToken) headers['Authorization'] = 'OAuth ' + authToken;

  // С повтором: сетевой сбой не должен читаться как «канал офлайн» —
  // именно по этому признаку приложение решает, жив ли стрим
  const res = await twitchPost(postData, headers);

  if (!res.ok) {
    console.warn('[Стрим] Статистика недоступна:', res.error || res.statusCode);
    return null;
  }

  try {
    const user = JSON.parse(res.data)?.data?.user;
    const stream = user?.stream;
    if (!stream) return null;

    return {
      // title нужен, когда канал выбран напрямую из подписок и не попал
      // в выдачу по игре: иначе карточка стрима осталась бы без названия
      title: stream.title || '',
      viewers: stream.viewersCount || 0,
      points: user?.channel?.self?.communityPoints?.balance || 0,
      uptime: calculateUptime(stream.createdAt),
      gameName: stream.game?.name || null
    };
  } catch (e) {
    console.warn('[Стрим] Ошибка разбора статистики:', e.message);
    return null;
  }
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

// Парсинг данных дропсов
function parseDropsData(response) {
  try {
    // Пытаемся найти данные о дропсах в разных возможных путях
    let campaigns = [];

    // Вариант 1: массив ответов
    if (Array.isArray(response)) {
      for (const item of response) {
        if (item.data && item.data.currentUser) {
          const drops = item.data.currentUser.dropCampaigns || [];
          campaigns = campaigns.concat(processDropCampaigns(drops));
        }
      }
    }

    // Вариант 2: одиночный ответ
    if (response.data && response.data.currentUser) {
      const drops = response.data.currentUser.dropCampaigns || [];
      campaigns = campaigns.concat(processDropCampaigns(drops));
    }

    // Вариант 3: инвентарь
    if (response.data && response.data.currentUser && response.data.currentUser.inventory) {
      const inventory = response.data.currentUser.inventory;
      if (inventory.dropCampaignsInProgress) {
        campaigns = campaigns.concat(processDropCampaigns(inventory.dropCampaignsInProgress));
      }
    }

    return {
      campaigns: campaigns,
      totalProgress: calculateTotalProgress(campaigns)
    };
  } catch (e) {
    console.log('Error processing drops data:', e.message);
    return { campaigns: [], error: e.message };
  }
}

// Обработка кампаний дропсов
function processDropCampaigns(campaigns) {
  if (!Array.isArray(campaigns)) return [];

  console.log('Processing campaigns:', JSON.stringify(campaigns, null, 2));

  return campaigns.map(campaign => {
    const drops = (campaign.timeBasedDrops || []).map(drop => {
      const progress = drop.self ? drop.self.currentMinutesWatched || 0 : 0;
      const required = drop.requiredMinutesWatched || 1;
      const percentage = Math.min(100, Math.floor((progress / required) * 100));

      // Получаем картинку из benefitEdges
      let imageURL = null;
      if (drop.benefitEdges && Array.isArray(drop.benefitEdges) && drop.benefitEdges.length > 0) {
        if (drop.benefitEdges[0].benefit && drop.benefitEdges[0].benefit.imageAssetURL) {
          imageURL = drop.benefitEdges[0].benefit.imageAssetURL;
        }
      }

      console.log(`Drop ${drop.name}: progress=${progress}, required=${required}, imageURL=${imageURL}`);

      return {
        id: drop.id,
        name: drop.name,
        imageURL: imageURL,
        progress: progress,
        required: required,
        percentage: percentage,
        claimed: drop.self ? drop.self.isClaimed : false
      };
    });

    return {
      id: campaign.id,
      name: campaign.name,
      game: campaign.game ? {
        name: campaign.game.displayName,
        boxArtURL: campaign.game.boxArtURL
      } : null,
      endAt: campaign.endAt,
      drops: drops,
      totalDrops: drops.length,
      completedDrops: drops.filter(d => d.claimed).length
    };
  });
}

// Расчет общего прогресса
function calculateTotalProgress(campaigns) {
  if (!campaigns || campaigns.length === 0) {
    return { percentage: 0, completed: 0, total: 0 };
  }

  let totalDrops = 0;
  let completedDrops = 0;

  campaigns.forEach(campaign => {
    totalDrops += campaign.totalDrops;
    completedDrops += campaign.completedDrops;
  });

  return {
    percentage: totalDrops > 0 ? Math.floor((completedDrops / totalDrops) * 100) : 0,
    completed: completedDrops,
    total: totalDrops
  };
}

// Устанавливаем название приложения для Windows уведомлений
if (process.platform === 'win32') {
  app.setAppUserModelId('WatchTwitch.App');
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
  setupAdBlock();

  // Игровой режим: первый опрос через 15 секунд, дальше каждые 20
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
        console.log('[WebView] Preload set before attach:', preloadPath);
      });
    }
  });

  createSplashWindow();

  // Создаем главное окно через небольшую задержку
  setTimeout(() => {
    createMainWindow();
    createTray();
    registerShortcuts();

    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    } else {
      console.log('[Updater] Skipping update check in dev mode');
    }

  }, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (powerSaveBlockerId) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }
  // На macOS приложения обычно остаются активными
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  
  // Уведомляем рендерер о закрытии для завершения сессии
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendToMain('app-closing');
    // Даем время на сохранение сессии
    await new Promise(resolve => setTimeout(resolve, 500));
  }
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

// OAuth IPC handlers
ipcMain.handle('start-twitch-auth', async () => {
  return await openTwitchAuthWindow();
});

ipcMain.handle('get-oauth-user', async () => {
  const oauth = store.get('oauth');
  if (!oauth) return null;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  const refreshed = store.get('oauth') || oauth;
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
  store.set('settings', { ...current, ...partial });
  return true;
});

ipcMain.handle('store-get', (event, key) => {
  return store.get(key);
});

ipcMain.handle('store-set', (event, key, value) => {
  store.set(key, value);
});

ipcMain.handle('store-delete', (event, key) => {
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

function createDropNotification(dropName, gameName, dropIcon) {
  // Закрываем предыдущее уведомление если есть
  if (dropNotificationWindow && !dropNotificationWindow.isDestroyed()) {
    dropNotificationWindow.close();
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Параметры уведомления
  const notificationWidth = 360;
  const notificationHeight = 100;
  const margin = 20;

  dropNotificationWindow = new BrowserWindow({
    width: notificationWidth,
    height: notificationHeight,
    x: width - notificationWidth - margin,
    y: height - notificationHeight - margin,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // Разрешаем загрузку внешних изображений
    }
  });

  // Формируем URL с параметрами - передаем напрямую через IPC
  dropNotificationWindow.loadFile('renderer/notification.html');

  // Ссылку держим свою, а не глобальную: окно живёт несколько секунд и
  // закрывается само, обработчик 'closed' обнуляет dropNotificationWindow.
  // Если это случится до 'ready-to-show' — а так бывает при подряд идущих
  // наградах, — обращение к глобальной ссылке уронит весь главный процесс.
  // Ровно это и произошло: приложение упало ночью, и фарминг встал до утра.
  const notificationWindow = dropNotificationWindow;

  dropNotificationWindow.once('ready-to-show', () => {
    if (!notificationWindow || notificationWindow.isDestroyed()) {
      console.log('[Main] Окно уведомления закрылось до показа');
      return;
    }
    notificationWindow.show();

    const targetWindow = notificationWindow;
    const sendToNotification = (dropIconData) => {
      if (!targetWindow || targetWindow.isDestroyed()) {
        console.log('[Main] Окно уведомления уже закрыто, картинка не нужна');
        return;
      }
      targetWindow.webContents.send('notification-data', { dropName, gameName, dropIcon: dropIconData });
    };
    
    // Загружаем картинку через главный процесс и передаем как base64
    if (dropIcon && dropIcon.startsWith('http')) {
      const https = require('https');
      const http = require('http');
      const protocol = dropIcon.startsWith('https') ? https : http;
      
      console.log('[Main] Downloading image:', dropIcon);
      
      protocol.get(dropIcon, (response) => {
        console.log('[Main] Response status:', response.statusCode);
        console.log('[Main] Response content-type:', response.headers['content-type']);
        
        // Проверяем что ответ успешный и это изображение
        if (response.statusCode !== 200 || !response.headers['content-type']?.startsWith('image/')) {
          console.error('[Main] Invalid response - not an image or error status');
          sendToNotification(null);
          return;
        }
        
        const chunks = [];
        
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString('base64');
          const contentType = response.headers['content-type'];
          const dataUrl = `data:${contentType};base64,${base64}`;
          
          console.log('[Main] Image downloaded successfully, size:', buffer.length, 'bytes');
          sendToNotification(dataUrl);
        });
        
      }).on('error', (err) => {
        console.error('[Main] Failed to download image:', err.message);
        sendToNotification(null);
      });
    } else {
      sendToNotification(null);
    }
  });

  dropNotificationWindow.on('closed', () => {
    dropNotificationWindow = null;
  });
}

ipcMain.on('show-drop-notification', (event, { dropName, gameName, dropIcon }) => {
  console.log('[Main] show-drop-notification received:', { dropName, gameName, dropIcon });
  createDropNotification(dropName, gameName, dropIcon);
});

ipcMain.on('close-drop-notification', () => {
  if (dropNotificationWindow && !dropNotificationWindow.isDestroyed()) {
    dropNotificationWindow.close();
  }
});

// Старые системные уведомления (оставляем для совместимости)
ipcMain.on('show-notification', (event, { title, body, icon }) => {
  console.log('[Main] show-notification received:', { title, body, icon });
  const notificationsEnabled = store.get('settings.notifications', true);
  console.log('[Main] Notifications enabled:', notificationsEnabled);
  
  if (notificationsEnabled) {
    console.log('[Main] Showing notification');
    const notificationOptions = { 
      title, 
      body,
      silent: false,
      timeoutType: 'default'
    };
    
    // Если передана иконка (URL), пытаемся её использовать
    if (icon) {
      notificationOptions.icon = icon;
    }
    
    new Notification(notificationOptions).show();
  } else {
    console.log('[Main] Notifications disabled in store');
  }
});

// Открытие внешнюю ссылку
ipcMain.handle('open-external', async (event, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
});

// Follow/Unfollow channel
ipcMain.handle('follow-channel', async (event, channelLogin) => {
  const https = require('https');

  // Получаем токен авторизации
  const authToken = getAuthToken();

  if (!authToken) {
    console.error('No auth token found');
    return { success: false, error: 'Not authenticated' };
  }

  return new Promise((resolve) => {
    // Сначала получаем ID пользователя и ID канала
    const getUserData = () => {
      return new Promise((resolveUser) => {
        const options = {
          hostname: 'api.twitch.tv',
          port: 443,
          path: `/helix/users?login=${channelLogin}`,
          method: 'GET',
          headers: {
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            'Authorization': `Bearer ${authToken}`
          }
        };

        const req = httpsRequestWithTimeout(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              console.log('User data response:', parsed);

              if (parsed.data && parsed.data.length > 0) {
                resolveUser({ success: true, userId: parsed.data[0].id });
              } else {
                resolveUser({ success: false, error: 'User not found' });
              }
            } catch (err) {
              console.error('Error parsing user data:', err);
              resolveUser({ success: false, error: err.message });
            }
          });
        });

        req.on('error', (err) => {
          console.error('Request error:', err);
          resolveUser({ success: false, error: err.message });
        });

        req.end();
      });
    };

    // Получаем ID текущего пользователя
    const getCurrentUser = () => {
      return new Promise((resolveUser) => {
        const options = {
          hostname: 'api.twitch.tv',
          port: 443,
          path: '/helix/users',
          method: 'GET',
          headers: {
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            'Authorization': `Bearer ${authToken}`
          }
        };

        const req = httpsRequestWithTimeout(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              console.log('Current user response:', parsed);

              if (parsed.data && parsed.data.length > 0) {
                resolveUser({ success: true, userId: parsed.data[0].id });
              } else {
                resolveUser({ success: false, error: 'Current user not found' });
              }
            } catch (err) {
              console.error('Error parsing current user:', err);
              resolveUser({ success: false, error: err.message });
            }
          });
        });

        req.on('error', (err) => {
          console.error('Request error:', err);
          resolveUser({ success: false, error: err.message });
        });

        req.end();
      });
    };

    // Выполняем оба запроса
    Promise.all([getCurrentUser(), getUserData()]).then(([currentUserResult, targetUserResult]) => {
      if (!currentUserResult.success || !targetUserResult.success) {
        resolve({
          success: false,
          error: currentUserResult.error || targetUserResult.error
        });
        return;
      }

      // Теперь делаем follow запрос
      const postData = JSON.stringify({
        from_id: currentUserResult.userId,
        to_id: targetUserResult.userId
      });

      const options = {
        hostname: 'api.twitch.tv',
        port: 443,
        path: '/helix/users/follows',
        method: 'POST',
        headers: {
          'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = httpsRequestWithTimeout(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log('Follow response status:', res.statusCode);

          if (res.statusCode === 204 || res.statusCode === 200) {
            resolve({ success: true, followed: true });
          } else {
            resolve({ success: false, error: data });
          }
        });
      });

      req.on('error', (err) => {
        console.error('Follow request error:', err);
        resolve({ success: false, error: err.message });
      });

      req.write(postData);
      req.end();
    });
  });
});

// Check if following channel
ipcMain.handle('check-following', async (event, channelLogin) => {
  const https = require('https');

  const authToken = getAuthToken();

  if (!authToken) {
    return { success: false, following: false };
  }

  return new Promise((resolve) => {
    // Сначала получаем ID текущего пользователя и ID канала
    const getCurrentUser = () => {
      return new Promise((resolveUser) => {
        const options = {
          hostname: 'api.twitch.tv',
          port: 443,
          path: '/helix/users',
          method: 'GET',
          headers: {
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            'Authorization': `Bearer ${authToken}`
          }
        };

        const req = httpsRequestWithTimeout(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.data && parsed.data.length > 0) {
                resolveUser({ success: true, userId: parsed.data[0].id });
              } else {
                resolveUser({ success: false });
              }
            } catch (err) {
              resolveUser({ success: false });
            }
          });
        });

        req.on('error', () => resolveUser({ success: false }));
        req.end();
      });
    };

    const getTargetUser = () => {
      return new Promise((resolveUser) => {
        const options = {
          hostname: 'api.twitch.tv',
          port: 443,
          path: `/helix/users?login=${channelLogin}`,
          method: 'GET',
          headers: {
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            'Authorization': `Bearer ${authToken}`
          }
        };

        const req = httpsRequestWithTimeout(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.data && parsed.data.length > 0) {
                resolveUser({ success: true, userId: parsed.data[0].id });
              } else {
                resolveUser({ success: false });
              }
            } catch (err) {
              resolveUser({ success: false });
            }
          });
        });

        req.on('error', () => resolveUser({ success: false }));
        req.end();
      });
    };

    Promise.all([getCurrentUser(), getTargetUser()]).then(([currentUserResult, targetUserResult]) => {
      if (!currentUserResult.success || !targetUserResult.success) {
        resolve({ success: false, following: false });
        return;
      }

      // Проверяем подписку
      const options = {
        hostname: 'api.twitch.tv',
        port: 443,
        path: `/helix/users/follows?from_id=${currentUserResult.userId}&to_id=${targetUserResult.userId}`,
        method: 'GET',
        headers: {
          'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Authorization': `Bearer ${authToken}`
        }
      };

      const req = httpsRequestWithTimeout(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const following = parsed.data && parsed.data.length > 0;
            resolve({ success: true, following });
          } catch (err) {
            resolve({ success: false, following: false });
          }
        });
      });

      req.on('error', () => resolve({ success: false, following: false }));
      req.end();
    });
  });
});

// Fetch Twitch categories/games
ipcMain.handle('fetch-twitch-categories', async () => {
  const https = require('https');

  return new Promise((resolve) => {
    console.log('Fetching Twitch top categories...');

    // Упрощенный GraphQL запрос без tags
    const postData = JSON.stringify({
      query: 'query { games(first: 100) { edges { node { id name displayName boxArtURL(width: 52, height: 72) viewersCount } } } }'
    });

    const options = {
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = httpsRequestWithTimeout(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log('Response received:', data.substring(0, 200));

          // Пробуем разные пути к данным
          const edges = response?.data?.games?.edges ||
            response[0]?.data?.games?.edges ||
            response?.data?.directoriesWithTags?.edges ||
            response[0]?.data?.directoriesWithTags?.edges || [];

          const categories = edges.map(edge => ({
            id: edge.node.id,
            name: edge.node.displayName || edge.node.name,
            boxArtURL: edge.node.boxArtURL || edge.node.avatarURL || '',
            viewersCount: edge.node.viewersCount || 0,
            tags: [] // Пока пустой массив
          }));

          console.log('Fetched', categories.length, 'categories');
          resolve(categories);
        } catch (e) {
          console.log('Error parsing categories:', e.message);
          resolve([]);
        }
      });
    });

    req.on('error', (e) => {
      console.log('Request error:', e.message);
      resolve([]);
    });

    req.write(postData);
    req.end();
  });
});

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
  const https = require('https');

  return new Promise((resolve) => {
    const escapedName = String(categoryName || '').replace(/"/g, '\\"');
    const postData = JSON.stringify({
      query:
        'query { game(name: "' + escapedName + '") { viewersCount streams(first: 30) { edges { node { title viewersCount broadcaster { login displayName profileImageURL(width: 70) } freeformTags { name } } } } } }'
    });

    const req = httpsRequestWithTimeout({
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const game = JSON.parse(data)?.data?.game;
          const edges = game?.streams?.edges || [];

          const streams = edges.map(edge => {
            const node = edge.node;
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

          resolve({
            gameViewers: game?.viewersCount || 0,
            streamsChecked: edges.length,
            streamsWithDrops: streams.filter(s => s.hasDrops).length,
            streams
          });
        } catch (e) {
          console.log('[CategoryOverview] Ошибка разбора:', e.message);
          resolve({ gameViewers: 0, streamsChecked: 0, streamsWithDrops: 0, streams: [] });
        }
      });
    });

    req.on('error', (e) => {
      console.log('[CategoryOverview] Ошибка запроса:', e.message);
      resolve({ gameViewers: 0, streamsChecked: 0, streamsWithDrops: 0, streams: [] });
    });

    req.write(postData);
    req.end();
  });
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

  // С повтором: обрыв связи не должен выглядеть как «стримов нет»
  const res = await twitchPost(postData, {
    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  });

  if (!res.ok) {
    console.warn('[Стримы] Не удалось получить список:', res.error || res.statusCode);
    return [];
  }

  try {
    const game = JSON.parse(res.data)?.data?.game;
    const edges = game?.streams?.edges || [];

    // Тег «Drops» ставят не все стримеры, а открытая кампания засчитывается
    // на любом канале категории. Раньше без тега приложение отвечало «Нет
    // стримов». Помеченные — вперёд, без пометки — в запас.
    const tagged = edges.filter(edge => streamHasDropsSignal(edge.node));
    const pool = tagged.length ? tagged : edges;
    if (!tagged.length && edges.length) {
      console.log('[Стримы] Тега Drops нет ни у кого, беру все стримы категории:', edges.length);
    }

    return pool
      .map(edge => {
        const broadcaster = edge.node?.broadcaster;
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
  } catch (e) {
    console.warn('[Стримы] Ошибка разбора ответа:', e.message);
    return [];
  }
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
  return Array.isArray(inventory?.campaigns) ? inventory.campaigns : [];
});

/**
 * Кампании из ViewerDropsDashboard — все активные кампании аккаунта.
 * Нужны потому, что inventory.dropCampaignsInProgress отдаёт ТОЛЬКО те кампании,
 * где уже накоплена хотя бы минута просмотра. Пока фарм не начался, доступные
 * дропсы там отсутствуют — и приложение делало вид, что дропсов нет вообще.
 * Возвращает сырые кампании в том же виде, что и inventory (game — объект).
 */
function fetchViewerDropsDashboardCampaignsUncached(authToken) {
  const https = require('https');

  return new Promise((resolve) => {
    if (!authToken) {
      resolve([]);
      return;
    }

    // Без Client-Integrity запрос гарантированно вернёт IntegrityCheckFailed,
    // поэтому не тратим на него сеть и время.
    if (!hasFreshIntegrity()) {
      console.log('[Drops] Client-Integrity ещё не перехвачен — пропускаю запрос списка кампаний');
      resolve([]);
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
      resolve([]);
      return;
    }

    const req = httpsRequestWithTimeout({
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        twitchRateLimit.noteResponse(res.statusCode, res.headers);
        try {
          const response = JSON.parse(data);
          const root = Array.isArray(response) ? response[0] : response;

          if (root?.errors) {
            console.warn('[Drops] Dashboard GraphQL errors:', JSON.stringify(root.errors).slice(0, 200));
          }

          const campaigns = root?.data?.currentUser?.dropCampaigns || [];
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
          resolve([]);
        }
      });
    });

    req.on('error', (e) => {
      console.warn('[Drops] Dashboard request error:', e.message);
      resolve([]);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Список кампаний из общего кэша: один запрос на десять минут для всех,
 * кто спрашивает. Пустой ответ (Client-Integrity ещё не перехвачен)
 * держим недолго, чтобы не пропустить момент, когда он появится.
 */
function fetchViewerDropsDashboardCampaigns(authToken) {
  if (!authToken) return Promise.resolve([]);
  return cachedTwitchCall(
    'dashboard',
    () => fetchViewerDropsDashboardCampaignsUncached(authToken),
    result => (Array.isArray(result) && result.length ? TWITCH_CACHE_TTL.dashboard : TWITCH_CACHE_TTL.dashboardEmpty)
  );
}

// Fetch Drops Inventory (full inventory with progress tracking)
function fetchDropsInventoryUncached() {
  const https = require('https');

  return new Promise(async (resolve) => {
    console.log('Fetching drops inventory...');

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

    if (!authToken) {
      console.log('No cookie token - user needs to watch a stream first');
      resolve({ campaigns: [], currentDrop: null, needsStream: true });
      return;
    }

    console.log('Using cookie token for drops');

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
      resolve({ campaigns: [], currentDrop: null, rateLimited: true });
      return;
    }

    const req = httpsRequestWithTimeout(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', async () => {
        twitchRateLimit.noteResponse(res.statusCode, res.headers);
        try {
          const responses = JSON.parse(data);

          // Parse inventory (only in-progress campaigns available due to integrity check)
          const currentUser = responses[0]?.data?.currentUser || {};
          const inventory = currentUser.inventory || {};
          const ongoingCampaigns = inventory.dropCampaignsInProgress || [];

          console.log('Ongoing campaigns:', ongoingCampaigns.length);

          // Создаем мапу полученных дропсов из инвентаря ПЕРЕД использованием в map
          const claimedDrops = {};
          (inventory.gameEventDrops || []).forEach(drop => {
            claimedDrops[drop.id] = drop.lastAwardedAt;
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
          dashboardCampaigns.forEach(campaign => {
            if (!campaign?.id || campaignsMap.has(campaign.id)) return;
            campaignsMap.set(campaign.id, {
              ...campaign,
              inProgress: false
            });
          });

          console.log('[Drops] Кампаний всего:', campaignsMap.size,
            '(в прогрессе:', ongoingCampaigns.length,
            ', ещё не начатых:', campaignsMap.size - ongoingCampaigns.length, ')');

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
              game: {
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

          // Find current drop (first drop that can be earned and isn't claimed)
          let currentDrop = null;
          for (const campaign of activeCampaigns) {
            if (campaign.status === 'active') {
              const activeDrop = campaign.drops.find(d => !d.isClaimed && d.currentMinutes < d.requiredMinutes);
              if (activeDrop) {
                const remainingMinutes = activeDrop.requiredMinutes - activeDrop.currentMinutes;
                currentDrop = {
                  game: campaign.game,
                  campaignName: campaign.name,
                  campaignId: campaign.id,
                  dropId: activeDrop.id,
                  rewards: activeDrop.rewards.map(r => r.name).join(', '),
                  currentMinutes: activeDrop.currentMinutes,
                  requiredMinutes: activeDrop.requiredMinutes,
                  progress: activeDrop.progress,
                  remainingSeconds: remainingMinutes * 60,
                  campaignProgress: campaign.progress,
                  claimedDrops: campaign.claimedDrops,
                  totalDrops: campaign.totalDrops
                };
                break;
              }
            }
          }

          resolve({
            campaigns: activeCampaigns,
            currentDrop: currentDrop,
            claimedDrops: Object.keys(claimedDrops).map(id => ({ id, lastAwardedAt: claimedDrops[id] }))
          });
        } catch (e) {
          console.error('Error parsing inventory:', e);
          resolve({ campaigns: [], currentDrop: null, error: true });
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      resolve({ campaigns: [], currentDrop: null, error: true });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Инвентарь из общего кэша: не чаще раза в минуту, сколько бы мест его
 * ни спрашивало. Прогресс просмотра Twitch и сам считает по минутам.
 * force — ручное обновление кнопкой: тогда кэш сбрасывается.
 */
function getDropsInventory(options = {}) {
  if (options && options.force) invalidateTwitchCache('inventory');
  return cachedTwitchCall(
    'inventory',
    fetchDropsInventoryUncached,
    result => (Array.isArray(result?.campaigns) && result.campaigns.length
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
    const { data, error } = parse(await twitchPost(postData, gqlHeaders(postData)));
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
  const https = require('https');

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

  return new Promise((resolve) => {
    const escapedName = categoryName.replace(/"/g, '\\"');
    const postData = JSON.stringify({
      query: 'query { game(name: "' + escapedName + '") { streams(first: 10) { edges { node { title broadcaster { login } freeformTags { name } } } } } }'
    });

    const options = {
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = httpsRequestWithTimeout(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const streams = response?.data?.game?.streams?.edges || [];

          // Fallback: эвристика по тегам/тайтлу
          const hasDrops = streams.some(edge => streamHasDropsSignal(edge.node));

          resolve(hasDrops);
        } catch (e) {
          console.log('Error checking drops:', e.message);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.log('Request error:', e.message);
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
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
  const points = community.channel?.self?.communityPoints?.balance || 0;
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
  const oauth = store.get('oauth');
  const token = cookieToken || oauth?.accessToken;

  if (!token) {
    return { success: false, error: 'Требуется вход в Twitch. Откройте стрим в приложении.' };
  }

  console.log('[Награда] Получаю', dropInstanceID, '| токен:', cookieToken ? 'cookie' : 'OAuth');

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

  const send = async (body) => {
    const res = await twitchPost(body, buildHeaders(body));

    if (!res.ok) {
      if (res.statusCode === 401 || res.statusCode === 403) {
        return { success: false, error: 'Twitch отклонил авторизацию. Откройте стрим в приложении и повторите.' };
      }
      return { success: false, error: res.error || ('код ответа ' + res.statusCode) };
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
        const message = errors[0]?.message || 'ошибка Twitch';
        return { success: false, error: message, staleHash: /PersistedQueryNotFound/i.test(message) };
      }

      // Прежний код на любой неожиданный ответ выдавал одинаковую фразу,
      // по которой невозможно было понять причину
      if (status) {
        return { success: false, error: 'Twitch ответил: ' + status };
      }

      // Ответ пустой: Twitch не признал эту награду. Обычно её уже забрали
      // на сайте либо кампания закончилась, а список в приложении устарел.
      return {
        success: false,
        error: 'Twitch не подтвердил награду — возможно, её уже забрали или кампания закончилась. Обновите список.',
        stale: true
      };
    } catch (e) {
      return { success: false, error: 'не удалось разобрать ответ Twitch' };
    }
  };

  let outcome = await send(persisted);

  if (outcome.staleHash) {
    console.warn('[Награда] Хеш запроса устарел, повторяю обычным текстом мутации');
    outcome = await send(inline);
  }

  return outcome;
});

// Получение всех доступных наград
ipcMain.handle('claim-all-drops', async () => {
  const https = require('https');

  return new Promise(async (resolve) => {
    console.log('Claiming all available drops...');

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

    if (!authToken) {
      resolve({ success: false, error: 'Требуется авторизация' });
      return;
    }

    try {
      // Сначала получаем список всех дропсов которые можно получить
      const drops = await new Promise((resolveDrops) => {
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

        const req = httpsRequestWithTimeout(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const responses = JSON.parse(data);
              const campaigns = responses[0]?.data?.currentUser?.inventory?.dropCampaignsInProgress || [];

              const claimableDrops = [];
              campaigns.forEach(campaign => {
                campaign.timeBasedDrops?.forEach(drop => {
                  if (drop.self && !drop.self.isClaimed && drop.self.dropInstanceID) {
                    const progress = drop.self.currentMinutesWatched || 0;
                    const required = drop.requiredMinutesWatched || 0;
                    if (progress >= required) {
                      claimableDrops.push(drop.self.dropInstanceID);
                    }
                  }
                });
              });

              resolveDrops(claimableDrops);
            } catch (e) {
              console.error('Error parsing drops:', e);
              resolveDrops([]);
            }
          });
        });

        req.on('error', () => resolveDrops([]));
        req.write(postData);
        req.end();
      });

      if (drops.length === 0) {
        resolve({ success: true, claimed: 0, message: 'Нет доступных наград для получения' });
        return;
      }

      // Получаем все награды
      let claimed = 0;
      for (const dropInstanceID of drops) {
        const claimData = JSON.stringify([{
          operationName: 'DropsPage_ClaimDropRewards',
          variables: {
            input: {
              dropInstanceID: dropInstanceID
            }
          },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930'
            }
          }
        }]);

        const claimHeaders = {
          'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Authorization': `OAuth ${authToken}`,
          'Content-Type': 'text/plain;charset=UTF-8'
        };

        // Мутации проходят проверку целостности клиента, в отличие от запросов
        if (hasFreshIntegrity()) {
          claimHeaders['Client-Integrity'] = twitchGqlHeaders.integrity;
          if (twitchGqlHeaders.deviceId) claimHeaders['X-Device-Id'] = twitchGqlHeaders.deviceId;
          if (twitchGqlHeaders.clientVersion) claimHeaders['Client-Version'] = twitchGqlHeaders.clientVersion;
          if (twitchGqlHeaders.sessionId) claimHeaders['Client-Session-Id'] = twitchGqlHeaders.sessionId;
        }

        const claimResult = await new Promise((resolveClaim) => {
          const options = {
            hostname: 'gql.twitch.tv',
            port: 443,
            path: '/gql',
            method: 'POST',
            headers: claimHeaders
          };

          const req = httpsRequestWithTimeout(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                const response = JSON.parse(data);
                const status = response[0]?.data?.claimDropRewards?.status;
                // Уже забранная награда — тот же результат, считаем успехом
                const success = status === 'ELIGIBLE_FOR_ALL' || status === 'DROP_INSTANCE_ALREADY_CLAIMED';
                if (!success) {
                  console.warn('[Награды] Не удалось забрать', dropInstanceID + ':',
                    response[0]?.errors?.[0]?.message || status || 'неожиданный ответ');
                }
                resolveClaim(success);
              } catch (e) {
                resolveClaim(false);
              }
            });
          });

          req.on('error', () => resolveClaim(false));
          req.write(claimData);
          req.end();
        });

        if (claimResult) claimed++;

        // Небольшая задержка между получениями
        await new Promise(r => setTimeout(r, 500));
      }

      if (claimed > 0) invalidateTwitchCache('inventory');

      resolve({
        success: true,
        claimed: claimed,
        total: drops.length,
        message: `Получено наград: ${claimed}/${drops.length}`
      });

    } catch (error) {
      console.error('Error claiming drops:', error);
      resolve({ success: false, error: error.message });
    }
  });
});

// Автозапуск
ipcMain.on('set-autostart', (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled
  });
  store.set('settings.autostart', enabled);
});
// Подписки текущего пользователя.
//
// Раньше шли через Helix с OAuth-токеном приложения, а тот давно протух:
// Twitch отвечал 401, список никогда не обновлялся, и страница молча
// показывала сохранённый. Теперь тот же GraphQL с cookie-токеном, что и
// у всего остального. Аргумент вызова оставлен ради совместимости.
ipcMain.handle('get-user-subscriptions', async () => {
  const authToken = await getCookieAuthToken();
  if (!authToken) {
    console.log('[Подписки] Нет cookie-токена — нужен хотя бы один запуск стрима');
    return [];
  }

  const result = [];
  let cursor = null;

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
    try {
      const parsed = JSON.parse(res.data);
      const root = Array.isArray(parsed) ? parsed[0] : parsed;
      if (root?.errors) console.warn('[Подписки] GraphQL:', JSON.stringify(root.errors).slice(0, 200));
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
        profileImageUrl: node.profileImageURL || '',
        followers: 0,
        lastStreamDate: null,
        streamFrequency: 0,
        consistency: 0,
        hasDrops: false,
        isLive: false
      });
      cursor = edge.cursor || cursor;
    }

    if (!follows.pageInfo?.hasNextPage || edges.length === 0) break;
  }

  console.log('[Подписки] Загружено:', result.length);
  return result;
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
function isFollowingChannel(login) {
  const https = require('https');

  return new Promise(async (resolve) => {
    const token = await getCookieAuthToken();
    if (!token || !login) {
      resolve(null);
      return;
    }

    const safeLogin = String(login).replace(/"/g, '');
    const body = JSON.stringify({
      query: 'query { user(login: "' + safeLogin + '") { id self { follower { followedAt } } } }'
    });

    const req = httpsRequestWithTimeout({
      hostname: 'gql.twitch.tv', port: 443, path: '/gql', method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Authorization': 'OAuth ' + token,
        'Content-Type': 'text/plain;charset=UTF-8'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const user = JSON.parse(data)?.data?.user;
          if (!user) {
            resolve(null);
            return;
          }
          resolve(!!user.self?.follower?.followedAt);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
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
// Загрузка дополнительных данных для одного канала (картинка, фолловеры, стримы)
ipcMain.handle('get-channel-details', async (event, authToken, channelLogin) => {
  return new Promise((resolve) => {
    if (!authToken || !channelLogin) {
      console.log('[GetChannelDetails] Missing auth or login');
      resolve({ profileImageUrl: '', followers: 0, lastStreamDate: null, isLive: false });
      return;
    }

    console.log(`[GetChannelDetails] Starting fetch for ${channelLogin}`);

    // Шаг 1: Получаем юзера для аватарки и ID
    const userOptions = {
      hostname: 'api.twitch.tv',
      path: `/helix/users?login=${encodeURIComponent(channelLogin)}`,
      method: 'GET',
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${authToken}`
      }
    };

    httpsRequestWithTimeout(userOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const user = json?.data?.[0];

          if (!user) {
            console.log(`[GetChannelDetails] No user found for ${channelLogin}`);
            resolve({ profileImageUrl: '', followers: 0, lastStreamDate: null, isLive: false });
            return;
          }

          const userId = user.id;
          const profileImageUrl = user.profile_image_url || '';
          const description = user.description || '';
          console.log(`[GetChannelDetails] Got user ${channelLogin} with ID ${userId}`);

          let followersData = null;
          let streamData = null;
          let lastVideoDate = null;
          let requestsComplete = 0;

          const finalResolve = () => {
            requestsComplete++;
            if (requestsComplete === 4) {
              const result = {
                profileImageUrl: profileImageUrl,
                description: description,
                followers: typeof followersData === 'number' ? followersData : 0,
                lastStreamDate: streamData?.started_at || lastVideoDate || null,
                isLive: !!streamData
              };
              console.log(`[GetChannelDetails] Final result for ${channelLogin}:`, result);
              resolve(result);
            }
          };

          // Шаг 2: GraphQL (lastBroadcast + stream). Фолловеры пробуем через app token ниже.
          const gqlQuery = {
            query: `query($login: String!) {
              user(login: $login) {
                followers { totalCount }
                lastBroadcast { startedAt }
                stream { createdAt }
              }
            }`,
            variables: { login: channelLogin }
          };

          const gqlBody = JSON.stringify(gqlQuery);
          const gqlOptions = {
            hostname: 'gql.twitch.tv',
            path: '/gql',
            method: 'POST',
            headers: {
              'Client-ID': TWITCH_CLIENT_ID,
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(gqlBody)
            }
          };

          httpsRequestWithTimeout(gqlOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                const gqlUser = json?.data?.user;

                if (gqlUser?.followers?.totalCount !== undefined && followersData === null) {
                  followersData = gqlUser.followers.totalCount || 0;
                  console.log(`[GetChannelDetails] Followers (GQL) ${channelLogin}: total=${followersData}`);
                }

                if (gqlUser?.lastBroadcast?.startedAt) {
                  lastVideoDate = gqlUser.lastBroadcast.startedAt;
                  console.log(`[GetChannelDetails] Last broadcast ${channelLogin}: ${lastVideoDate}`);
                }

                if (gqlUser?.stream?.createdAt) {
                  streamData = { started_at: gqlUser.stream.createdAt };
                  console.log(`[GetChannelDetails] Stream (GQL) ${channelLogin}: started_at=${gqlUser.stream.createdAt}`);
                }
              } catch (e) {
                console.error('[GetChannelDetails] Error parsing GraphQL:', e.message);
              }

              if (followersData === null) {
                const gqlOptionsNoAuth = {
                  hostname: 'gql.twitch.tv',
                  path: '/gql',
                  method: 'POST',
                  headers: {
                    'Client-ID': TWITCH_CLIENT_ID,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(gqlBody)
                  }
                };

                httpsRequestWithTimeout(gqlOptionsNoAuth, (res2) => {
                  let data2 = '';
                  res2.on('data', chunk => data2 += chunk);
                  res2.on('end', () => {
                    try {
                      const json2 = JSON.parse(data2);
                      const gqlUser2 = json2?.data?.user;
                      if (gqlUser2?.followers?.totalCount !== undefined) {
                        followersData = gqlUser2.followers.totalCount || 0;
                        console.log(`[GetChannelDetails] Followers (GQL no auth) ${channelLogin}: total=${followersData}`);
                      }
                    } catch (e) {
                      console.error('[GetChannelDetails] Error parsing GraphQL (no auth):', e.message);
                    }
                    finalResolve();
                  });
                }).on('error', (e) => {
                  console.error('[GetChannelDetails] GraphQL no-auth request error:', e.message);
                  finalResolve();
                }).end(gqlBody);
              } else {
                finalResolve();
              }
            });
          }).on('error', (e) => {
            console.error('[GetChannelDetails] GraphQL request error:', e.message);
            finalResolve();
          }).end(gqlBody);

          // Шаг 2.1: Фолловеры через Helix users/follows с app token
          getAppAccessToken()
            .then((appToken) => {
              const followersOptions = {
                hostname: 'api.twitch.tv',
                path: `/helix/users/follows?to_id=${userId}&first=1`,
                method: 'GET',
                headers: {
                  'Client-ID': TWITCH_CLIENT_ID,
                  'Authorization': `Bearer ${appToken}`
                }
              };

              httpsRequestWithTimeout(followersOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                  try {
                    if (res.statusCode !== 200) {
                      console.error(`[GetChannelDetails] Followers helix status ${res.statusCode} for ${channelLogin}`);
                    }
                    const json = JSON.parse(data);
                    if (typeof json?.total === 'number') {
                      followersData = json.total;
                      console.log(`[GetChannelDetails] Followers (helix app) ${channelLogin}: total=${followersData}`);
                    } else {
                      getFollowersFromIvr(channelLogin).then((ivrTotal) => {
                        if (typeof ivrTotal === 'number') {
                          followersData = ivrTotal;
                          console.log(`[GetChannelDetails] Followers (ivr) ${channelLogin}: total=${followersData}`);
                          finalResolve();
                          return;
                        }

                        getFollowersFromDecapi(channelLogin).then((fallbackTotal) => {
                          if (typeof fallbackTotal === 'number') {
                            followersData = fallbackTotal;
                            console.log(`[GetChannelDetails] Followers (decapi) ${channelLogin}: total=${followersData}`);
                          }
                          finalResolve();
                        });
                      });
                      return;
                    }
                  } catch (e) {
                    console.error('[GetChannelDetails] Error parsing followers (helix):', e.message);
                    getFollowersFromIvr(channelLogin).then((ivrTotal) => {
                      if (typeof ivrTotal === 'number') {
                        followersData = ivrTotal;
                        console.log(`[GetChannelDetails] Followers (ivr) ${channelLogin}: total=${followersData}`);
                        finalResolve();
                        return;
                      }

                      getFollowersFromDecapi(channelLogin).then((fallbackTotal) => {
                        if (typeof fallbackTotal === 'number') {
                          followersData = fallbackTotal;
                          console.log(`[GetChannelDetails] Followers (decapi) ${channelLogin}: total=${followersData}`);
                        }
                        finalResolve();
                      });
                    });
                    return;
                  }
                  finalResolve();
                });
              }).on('error', (e) => {
                console.error('[GetChannelDetails] Followers helix request error:', e.message);
                getFollowersFromIvr(channelLogin).then((ivrTotal) => {
                  if (typeof ivrTotal === 'number') {
                    followersData = ivrTotal;
                    console.log(`[GetChannelDetails] Followers (ivr) ${channelLogin}: total=${followersData}`);
                    finalResolve();
                    return;
                  }

                  getFollowersFromDecapi(channelLogin).then((fallbackTotal) => {
                    if (typeof fallbackTotal === 'number') {
                      followersData = fallbackTotal;
                      console.log(`[GetChannelDetails] Followers (decapi) ${channelLogin}: total=${followersData}`);
                    }
                    finalResolve();
                  });
                });
              }).end();
            })
            .catch((e) => {
              console.error('[GetChannelDetails] App token error:', e.message);
              finalResolve();
            });

          // Шаг 3: Получаем инфо о стриме
          const streamOptions = {
            hostname: 'api.twitch.tv',
            path: `/helix/streams?user_id=${userId}&first=1`,
            method: 'GET',
            headers: {
              'Client-ID': TWITCH_CLIENT_ID,
              'Authorization': `Bearer ${authToken}`
            }
          };

          httpsRequestWithTimeout(streamOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                const stream = json?.data?.[0];

                if (stream) {
                  streamData = stream;
                  console.log(`[GetChannelDetails] Stream ${channelLogin}: started_at=${stream.started_at}`);
                } else {
                  console.log(`[GetChannelDetails] Stream ${channelLogin}: offline (no active stream)`);
                }
              } catch (e) {
                console.error('[GetChannelDetails] Error parsing stream:', e.message);
              }
              finalResolve();
            });
          }).on('error', (e) => {
            console.error('[GetChannelDetails] Stream request error:', e.message);
            finalResolve();
          }).end();

          // Шаг 4: Получаем дату последнего стрима из видео (если не в эфире)
          const videosOptions = {
            hostname: 'api.twitch.tv',
            path: `/helix/videos?user_id=${userId}&first=1&sort=time&type=archive`,
            method: 'GET',
            headers: {
              'Client-ID': TWITCH_CLIENT_ID,
              'Authorization': `Bearer ${authToken}`
            }
          };

          httpsRequestWithTimeout(videosOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                const video = json?.data?.[0];
                lastVideoDate = video?.created_at || null;
                if (lastVideoDate) {
                  console.log(`[GetChannelDetails] Last video ${channelLogin}: ${lastVideoDate}`);
                }
              } catch (e) {
                console.error('[GetChannelDetails] Error parsing videos:', e.message);
              }
              finalResolve();
            });
          }).on('error', (e) => {
            console.error('[GetChannelDetails] Videos request error:', e.message);
            finalResolve();
          }).end();

        } catch (e) {
          console.error('[GetChannelDetails] Error parsing user response:', e);
          resolve({ profileImageUrl: '', followers: 0, lastStreamDate: null, isLive: false });
        }
      });
    }).on('error', (e) => {
      console.error('[GetChannelDetails] User request error:', e);
      resolve({ profileImageUrl: '', followers: 0, lastStreamDate: null, isLive: false });
    }).end();
  });
});

// Загрузка изображения по URL и возврат как base64 data URL
ipcMain.handle('load-image', async (event, imageUrl) => {
  return new Promise((resolve) => {
    if (!imageUrl || imageUrl.includes('data:')) {
      resolve(imageUrl);
      return;
    }

    try {
      const urlObj = new URL(imageUrl);
      const hostname = urlObj.hostname;
      const path = urlObj.pathname + urlObj.search;

      const imgReq = httpsRequestWithTimeout({
        hostname: hostname,
        path: path,
        method: 'GET'
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => { chunks.push(chunk); });
        res.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            const base64 = buffer.toString('base64');
            const mimeType = res.headers['content-type'] || 'image/png';
            const dataUrl = `data:${mimeType};base64,${base64}`;
            console.log('[LoadImage] Successfully loaded image:', imageUrl.substring(0, 50));
            resolve(dataUrl);
          } catch (e) {
            console.error('[LoadImage] Error converting to base64:', e);
            resolve(imageUrl); // Fallback to original URL
          }
        });
      });

      imgReq.on('error', (e) => {
        console.error('[LoadImage] Error fetching image:', e);
        resolve(imageUrl); // Fallback to original URL
      });

      imgReq.end();
    } catch (error) {
      console.error('[LoadImage] Error:', error);
      resolve(imageUrl); // Fallback to original URL
    }
  });
});