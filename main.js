const { app, BrowserWindow, ipcMain, Notification, powerSaveBlocker, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const http = require('http');
const https = require('https');
const url = require('url');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

const store = new Store();

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
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Agrysif',
    repo: 'WatchTwitch',
    releaseType: 'release',
    // Explicitly point to latest release
    updaterCacheDirName: 'watchtwitch-updater'
  });
  console.log('[Updater] Feed URL configured for GitHub releases (isPackaged:', app.isPackaged, ', isDev:', isDev, ')');
  console.log('[Updater] App version:', app.getVersion());
  console.log('[Updater] Will check: https://github.com/Agrysif/WatchTwitch/releases');
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

  const req = https.request({
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
  const req = https.request({
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
  const req = https.request({
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
let mainWindow;
let splashWindow;
let powerSaveBlockerId;
let tray = null;

// Мониторинг сетевого трафика
let trafficData = {
  totalBytes: 0,
  lastBytes: 0,
  lastUpdate: Date.now(),
  currentRate: 0,
  sessionStartBytes: 0
};
let streamTrafficInterval = null;

const monitoredWebContents = new Set();

function updateTrafficCounters(bytes) {
  if (!bytes || bytes <= 0) return;
  trafficData.totalBytes += bytes;
  const now = Date.now();
  const timeDiff = (now - trafficData.lastUpdate) / 1000;
  if (timeDiff >= 1) {
    const bytesDiff = trafficData.totalBytes - trafficData.lastBytes;
    trafficData.currentRate = bytesDiff / timeDiff / 1024; // KB/s
    trafficData.lastBytes = trafficData.totalBytes;
    trafficData.lastUpdate = now;
    console.log('[Traffic] Updated rate:', trafficData.currentRate.toFixed(1), 'KB/s | Total:', trafficData.totalBytes);
  }
}

// Проверяем не идет ли "dead time" без трафика
setInterval(() => {
  const timeSinceLastUpdate = (Date.now() - trafficData.lastUpdate) / 1000;
  if (timeSinceLastUpdate > 3 && trafficData.currentRate > 0) {
    console.log('[Traffic] No data for', timeSinceLastUpdate.toFixed(1), 's - setting rate to 0');
    trafficData.currentRate = 0;
  }
}, 2000);

function startStreamTrafficSampling(webContents) {
  if (!webContents || webContents.isDestroyed()) return;

  if (streamTrafficInterval) {
    clearInterval(streamTrafficInterval);
    streamTrafficInterval = null;
  }

  let lastEntryCount = 0;

  streamTrafficInterval = setInterval(async () => {
    if (!webContents || webContents.isDestroyed()) return;
    try {
      const result = await webContents.executeJavaScript(`
        (() => {
          const entries = performance.getEntriesByType('resource');
          let total = 0;
          for (const e of entries) {
            if (typeof e.transferSize === 'number' && e.transferSize > 0) total += e.transferSize;
          }
          return { total, entryCount: entries.length };
        })();
      `, true);

      if (result && result.total > 0) {
        console.log('[Stream Traffic] Performance API:', result.total, 'bytes from', result.entryCount, 'entries');
        updateTrafficCounters(result.total);
        lastEntryCount = result.entryCount;
      }
    } catch (e) {
      // ignore sampling errors
    }
  }, 1000);
}

function setupTrafficMonitoring(webContents) {
  if (!webContents || webContents.isDestroyed() || monitoredWebContents.has(webContents.id)) return;
  monitoredWebContents.add(webContents.id);

  try {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3');
    }
    webContents.debugger.sendCommand('Network.enable');
    webContents.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: true });

    webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.dataReceived') {
        updateTrafficCounters(params.encodedDataLength || params.dataLength || 0);
      }
      if (method === 'Network.loadingFinished') {
        updateTrafficCounters(params.encodedDataLength || 0);
      }
    });

    webContents.on('destroyed', () => {
      monitoredWebContents.delete(webContents.id);
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
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('[Updater] ===== UPDATE NOT AVAILABLE =====');
  console.log('[Updater] Current version is up-to-date');
  console.log('[Updater] App version:', app.getVersion());
});

autoUpdater.on('error', (error) => {
  console.error('[Updater] ===== UPDATE CHECK ERROR =====');
  console.error('[Updater] Error type:', error.name);
  console.error('[Updater] Error message:', error.message);
  console.error('[Updater] Error stack:', error.stack);
  if (mainWindow) {
    mainWindow.webContents.send('update-error', error.message);
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', {
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
    mainWindow.webContents.send('update-downloaded', {
      version: updateInfo?.version || 'unknown'
    });
  }
});

// IPC обработчики для обновления
ipcMain.on('check-for-updates', async () => {
  console.log('[IPC] Проверка обновлений... (app version:', app.getVersion(), ')');
  try {
    const result = await autoUpdater.checkForUpdates();
    console.log('[Updater] Check result:', result);
  } catch (err) {
    console.error('[Updater] Error during check:', err);
  }
});

ipcMain.on('install-update', () => {
  console.log('[IPC] Установка обновления...');
  autoUpdater.quitAndInstall(true, true);
});

ipcMain.on('download-update', async () => {
  console.log('[IPC] Загрузка обновления...');
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error('[Updater] Ошибка загрузки обновления:', error);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', error?.message || 'Ошибка загрузки обновления');
    }
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-webview-preload-path', () => {
  const preloadPath = path.join(__dirname, 'renderer', 'js', 'webview-traffic-preload.js');
  return pathToFileURL(preloadPath).toString();
});

ipcMain.on('webview-traffic', (_event, bytes) => {
  bytes = Number(bytes) || 0;
  if (bytes > 0) {
    console.log('[WebView Traffic IPC] Received:', bytes, 'bytes | Total now:', trafficData.totalBytes + bytes);
    updateTrafficCounters(bytes);
  }
});

// Обработка автоматического сбора сундуков
ipcMain.on('chest-claimed', (_event, data) => {
  console.log('[Chest] Автоматический сбор сундука:', data.timestamp);
});
// Получить данные о трафике
ipcMain.handle('get-traffic-data', () => {
  const sessionBytes = trafficData.totalBytes - trafficData.sessionStartBytes;
  const result = {
    totalBytes: trafficData.totalBytes,
    sessionBytes: sessionBytes,
    currentRate: trafficData.currentRate,
    lastUpdate: trafficData.lastUpdate
  };
  console.log('[IPC] get-traffic-data:', result.currentRate.toFixed(1), 'KB/s |', (result.sessionBytes / 1024 / 1024).toFixed(1), 'MB in session');
  return result;
});

// Сбросить счетчик сессии
ipcMain.handle('reset-session-traffic', () => {
  trafficData.sessionStartBytes = trafficData.totalBytes;
  trafficData.lastBytes = trafficData.totalBytes;
  trafficData.lastUpdate = Date.now();
  return { success: true };
});

// Read local file content for renderer
ipcMain.handle('read-file', async (event, relativePath) => {
  try {
    console.log('[IPC] read-file requested:', relativePath);
    console.log('[IPC] __dirname:', __dirname);
    const fullPath = path.join(__dirname, relativePath);
    console.log('[IPC] full path:', fullPath);
    const fs = require('fs');

    // Check if path exists
    const exists = fs.existsSync(fullPath);
    console.log('[IPC] File exists:', exists);

    if (!exists) {
      console.error('[IPC] File not found:', fullPath);
      // Try some alternative paths
      const altPath1 = path.join(__dirname, '..', 'renderer', relativePath.split('/').pop());
      console.log('[IPC] Trying alternative:', altPath1, 'exists:', fs.existsSync(altPath1));
      return { success: false, error: 'File not found: ' + fullPath };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    console.log('[IPC] read-file success, length:', content.length, 'first 100 chars:', content.substring(0, 100));
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

  // Настраиваем реальный мониторинг трафика через CDP (включая webview)
  setupTrafficMonitoring(mainWindow.webContents);
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
    const minimizeToTray = store.get('settings.minimizeToTray', true); // По умолчанию включено
    if (!app.isQuitting && minimizeToTray) {
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
      mainWindow.webContents.send('app-closing');
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
          mainWindow.webContents.send('navigate-to-page', 'settings');
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

    tray.setToolTip('WatchTwitch - Фарминг дропсов');
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

    startStreamTrafficSampling(streamView.webContents);

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

  streamView.webContents.on('destroyed', () => {
    if (streamTrafficInterval) {
      clearInterval(streamTrafficInterval);
      streamTrafficInterval = null;
    }
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
  const https = require('https');

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      query: 'query { user(login: "' + channelLogin + '") { stream { viewersCount createdAt game { name } } channel { self { communityPoints { balance } } } } }'
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

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const user = response?.data?.user;
          const stream = user?.stream;
          const points = user?.channel?.self?.communityPoints?.balance;

          if (stream) {
            const uptime = calculateUptime(stream.createdAt);
            resolve({
              viewers: stream.viewersCount || 0,
              points: points || 0,
              uptime: uptime,
              gameName: (stream.game && stream.game.name) ? stream.game.name : null
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          console.log('Error getting stream stats:', e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.log('Request error:', e.message);
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
});

function calculateUptime(createdAt) {
  const start = new Date(createdAt);
  const now = new Date();
  const diff = Math.floor((now - start) / 1000);

  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  return hours + 'ч ' + minutes + 'м';
}

// Получить прогресс дропсов
ipcMain.handle('get-drops-progress', async (event, channelLogin) => {
  console.log('Drops progress requested for:', channelLogin);

  try {
    // Используем fetch-drops-inventory для получения данных
    const inventoryData = await mainWindow.webContents.executeJavaScript('window.electronAPI.fetchDropsInventory()');

    if (!inventoryData || !inventoryData.campaigns) {
      return {
        campaigns: [],
        totalProgress: { percentage: 0, completed: 0, total: 0 }
      };
    }

    // Преобразуем данные в нужный формат
    const campaigns = inventoryData.campaigns.map(campaign => {
      const drops = campaign.drops || [];
      const completedDrops = drops.filter(d => d.isClaimed || d.percentage >= 100).length;

      return {
        id: campaign.id,
        name: campaign.name,
        game: campaign.game,
        drops: drops.map(drop => ({
          id: drop.id,
          name: drop.name,
          imageURL: drop.imageAssetURL,
          progress: drop.currentMinutesWatched,
          required: drop.requiredMinutesWatched,
          percentage: drop.percentage,
          claimed: drop.isClaimed || drop.percentage >= 100
        })),
        totalDrops: drops.length,
        completedDrops: completedDrops
      };
    });

    const totalProgress = calculateTotalProgress(campaigns);

    return {
      campaigns: campaigns,
      totalProgress: totalProgress
    };
  } catch (error) {
    console.error('Error getting drops progress:', error);
    return {
      campaigns: [],
      totalProgress: { percentage: 0, completed: 0, total: 0 }
    };
  }
});

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

app.whenReady().then(() => {
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

    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    } else {
      console.log('[Updater] Skipping update check in dev mode');
    }

    // Блокировать режим сна во время фарминга
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
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
    mainWindow.webContents.send('app-closing');
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
let authWindow = null;

ipcMain.handle('open-auth-window-old', async () => {
  return new Promise((resolve, reject) => {
    authWindow = new BrowserWindow({
      width: 600,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:twitch-auth' // Separate session for auth
      },
      parent: mainWindow,
      modal: true
    });

    // Clear session before loading
    authWindow.webContents.session.clearStorageData({
      storages: ['cookies', 'localstorage']
    }).then(() => {
      authWindow.loadURL('https://www.twitch.tv/login');
    });

    // Check for successful login
    const checkInterval = setInterval(() => {
      const url = authWindow.webContents.getURL();

      if (url.includes('twitch.tv') &&
        !url.includes('login') &&
        !url.includes('passport') &&
        !url.includes('authenticate')) {

        // Get cookies, username and OAuth token
        authWindow.webContents.executeJavaScript(`
          (function() {
            const selectors = [
              '[data-a-target="user-display-name"]',
              '[data-a-target="user-menu-toggle"]',
              '.user-display-name'
            ];
            
            let username = null;
            for (const selector of selectors) {
              const el = document.querySelector(selector);
              if (el) {
                username = el.textContent.trim();
                break;
              }
            }
            
            // Get avatar
            const avatarSelectors = [
              '[data-a-target="user-menu-toggle"] img',
              '.tw-avatar img',
              '[aria-label*="profile"] img',
              '[aria-label*="профил"] img'
            ];
            
            let avatar = '';
            for (const selector of avatarSelectors) {
              const img = document.querySelector(selector);
              if (img && img.src) {
                avatar = img.src;
                break;
              }
            }
            
            // Try to get OAuth token from localStorage
            let oauthToken = '';
            try {
              const keys = Object.keys(localStorage);
              for (const key of keys) {
                if (key.includes('token') || key.includes('auth') || key.includes('oauth')) {
                  const value = localStorage.getItem(key);
                  if (value && value.length > 20) {
                    try {
                      const parsed = JSON.parse(value);
                      if (parsed.token || parsed.access_token) {
                        oauthToken = parsed.token || parsed.access_token;
                        break;
                      }
                    } catch (e) {
                      if (value.match(/^[a-z0-9]{30,}$/i)) {
                        oauthToken = value;
                        break;
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.log('Error getting token from localStorage:', e);
            }
            
            return { username, avatar, oauthToken };
          })()
        `).then(userData => {
          if (userData && userData.username) {
            clearInterval(checkInterval);

            authWindow.webContents.session.cookies.get({})
              .then(cookies => {
                const cookieString = cookies.map(c => c.name + '=' + c.value).join('; ');

                // Extract auth-token from cookies if not found in localStorage
                let finalToken = userData.oauthToken || '';
                if (!finalToken) {
                  const authCookie = cookies.find(c => c.name === 'auth-token' || c.name === 'twilight-user.auth-token');
                  if (authCookie) {
                    finalToken = authCookie.value;
                  }
                }

                authWindow.close();
                authWindow = null;
                resolve({
                  username: userData.username,
                  avatar: userData.avatar || '',
                  cookies: cookieString,
                  oauthToken: finalToken
                });
              })
              .catch(err => {
                clearInterval(checkInterval);
                if (authWindow) authWindow.close();
                authWindow = null;
                reject(err);
              });
          }
        }).catch(err => console.log('Check error:', err));
      }
    }, 2000);

    authWindow.on('closed', () => {
      clearInterval(checkInterval);
      authWindow = null;
      reject(new Error('Window closed'));
    });
  });
});

// Сохранение данных
ipcMain.handle('store-get', (event, key) => {
  return store.get(key);
});

ipcMain.handle('store-set', (event, key, value) => {
  store.set(key, value);
});

ipcMain.handle('store-delete', (event, key) => {
  store.delete(key);
});

// Открытие стрима
ipcMain.handle('open-stream', async (event, url, account = null) => {
  console.log('Stream requested:', url);
  // Просто возвращаем данные для отображения в webview
  // BrowserView не используется - webview в HTML обрабатывает отображение
  return { success: true, url, account };
});

ipcMain.on('close-stream', () => {
  console.log('Stream closed');
});

// Уведомления
ipcMain.on('show-notification', (event, { title, body }) => {
  if (store.get('settings.notifications', true)) {
    new Notification({ title, body }).show();
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

        const req = https.request(options, (res) => {
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

        const req = https.request(options, (res) => {
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

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log('Follow response status:', res.statusCode);
          console.log('Follow response:', data);

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

        const req = https.request(options, (res) => {
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

        const req = https.request(options, (res) => {
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

      const req = https.request(options, (res) => {
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

    const req = https.request(options, (res) => {
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

// Получить стримы с дропсами для категории
ipcMain.handle('get-streams-with-drops', async (event, categoryName) => {
  const https = require('https');

  return new Promise((resolve) => {
    const escapedName = categoryName.replace(/"/g, '\\"');
    const postData = JSON.stringify({
      query:
        'query { game(name: "' + escapedName + '") { streams(first: 20) { edges { node { title broadcaster { login displayName } freeformTags { name } } } } } }'
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

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const streams = response?.data?.game?.streams?.edges || [];

          // Фильтруем только стримы с тегами дропсов
          const dropsStreams = streams.filter(edge => {
            const tags = edge.node?.freeformTags || [];
            return tags.some(tag => {
              const tagName = tag.name.toLowerCase();
              return tagName.includes('drops') ||
                tagName.includes('dropsenabled') ||
                tagName === 'dropson';
            });
          }).map(edge => {
            return {
              login: edge.node.broadcaster.login,
              displayName: edge.node.broadcaster.displayName,
              title: edge.node.title
            };
          });

          resolve(dropsStreams);
        } catch (e) {
          console.log('Error getting streams:', e.message);
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

// Получить активные кампании дропсов
ipcMain.handle('fetch-twitch-drops', async () => {
  const https = require('https');

  return new Promise(async (resolve) => {
    console.log('Fetching Twitch drops campaigns...');

    // Получаем auth token
    const authToken = await getAuthToken();

    console.log('Auth token available:', authToken ? 'YES (length: ' + authToken.length + ')' : 'NO');

    if (!authToken) {
      console.log('No auth token available, cannot fetch drops');
      resolve([]);
      return;
    }

    // Используем правильный GraphQL запрос для получения дропсов
    const postData = JSON.stringify({
      operationName: 'ViewerDropsDashboard',
      variables: {},
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: 'e8b98b52bbd7ccd37d0b671ad0d47be5238caa5bea637d2a65776175b4a23a64'
        }
      }
    });

    const headers = {
      'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Authorization': `OAuth ${authToken}`,
      'Content-Type': 'text/plain;charset=UTF-8'
    };

    const options = {
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log('Raw API response:', JSON.stringify(response).substring(0, 500));

          // Получаем кампании из ответа
          const dropCampaigns = response?.data?.currentUser?.dropCampaigns || [];

          console.log('Fetched', dropCampaigns.length, 'drop campaigns');

          if (dropCampaigns.length > 0) {
            console.log('First campaign:', JSON.stringify(dropCampaigns[0]).substring(0, 400));
          }

          // Форматируем кампании
          const formatted = dropCampaigns.map(campaign => {
            const drops = (campaign.timeBasedDrops || []).map(drop => ({
              id: drop.id,
              name: drop.name,
              requiredMinutes: drop.requiredMinutesWatched || 0,
              requiredMinutesWatched: drop.requiredMinutesWatched || 0,
              imageUrl: drop.benefitEdges?.[0]?.benefit?.imageAssetURL || '',
              imageURL: drop.benefitEdges?.[0]?.benefit?.imageAssetURL || ''
            }));

            return {
              id: campaign.id,
              name: campaign.name,
              game: campaign.game?.displayName || campaign.game?.name,
              gameId: campaign.game?.id,
              status: campaign.status,
              startAt: campaign.startAt,
              endAt: campaign.endAt,
              imageUrl: campaign.game?.boxArtURL || '',
              timeBasedDrops: drops,
              drops: drops
            };
          });

          resolve(formatted);
        } catch (e) {
          console.log('Error parsing drops:', e.message, data.substring(0, 200));
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

// Helper function to get stream count for a game
async function getStreamCountForGame(gameName, authToken) {
  const https = require('https');

  return new Promise((resolve) => {
    const query = `
      query {
        game(name: "${gameName.replace(/"/g, '\\"')}") {
          viewersCount
        }
      }
    `;

    const postData = JSON.stringify({
      query: query
    });

    const options = {
      hostname: 'gql.twitch.tv',
      port: 443,
      path: '/gql',
      method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `OAuth ${authToken}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const viewersCount = response?.data?.game?.viewersCount;
          resolve(viewersCount);
        } catch (e) {
          resolve(undefined);
        }
      });
    });

    req.on('error', () => {
      resolve(undefined);
    });

    req.write(postData);
    req.end();
  });
}

// Fetch Drops Inventory (full inventory with progress tracking)
ipcMain.handle('fetch-drops-inventory', async () => {
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

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', async () => {
        try {
          console.log('GraphQL Response:', data);
          const responses = JSON.parse(data);
          console.log('Parsed responses:', responses);

          // Parse inventory (only in-progress campaigns available due to integrity check)
          const currentUser = responses[0]?.data?.currentUser || {};
          const inventory = currentUser.inventory || {};
          const ongoingCampaigns = inventory.dropCampaignsInProgress || [];

          console.log('Inventory:', inventory);
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

            // Получаем количество стримов для категории
            let streamCount = undefined;
            const gameName = campaign.game?.displayName || campaign.game?.name;
            if (gameName && authToken) {
              try {
                streamCount = await getStreamCountForGame(gameName, authToken);
              } catch (e) {
                console.error('Error getting stream count:', e);
              }
            }

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
              streamCount: streamCount
            };
          }));

          // Find current drop (first drop that can be earned and isn't claimed)
          let currentDrop = null;
          for (const campaign of campaigns) {
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
            campaigns: campaigns,
            currentDrop: currentDrop,
            claimedDrops: Object.keys(claimedDrops).map(id => ({ id, lastAwardedAt: claimedDrops[id] }))
          });
        } catch (e) {
          console.error('Error parsing inventory:', e);
          resolve({ campaigns: [], currentDrop: null });
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      resolve({ campaigns: [], currentDrop: null });
    });

    req.write(postData);
    req.end();
  });
});

// Проверка наличия стримов с дропсами в категории
ipcMain.handle('check-category-drops', async (event, categoryName) => {
  const https = require('https');

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

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const streams = response?.data?.game?.streams?.edges || [];

          // Проверяем есть ли стримы с тегами дропсов
          const hasDrops = streams.some(edge => {
            const tags = edge.node?.freeformTags || [];
            return tags.some(tag => {
              const tagName = tag.name.toLowerCase();
              return tagName.includes('drops') ||
                tagName.includes('dropsenabled') ||
                tagName === 'dropson';
            });
          });

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
ipcMain.handle('get-channel-points', async (event, channelId, userId) => {
  const https = require('https');

  return new Promise(async (resolve) => {
    try {
      // Получаем cookie token из webview
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
        console.log('No auth token available');
        resolve({ points: 0, error: 'No auth token' });
        return;
      }

      // GraphQL запрос для получения баллов
      const postData = JSON.stringify([{
        operationName: 'ChannelPointsContext',
        variables: {
          channelLogin: channelId
        },
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: '1530a003a7d374b0380b79db0be0534f30ff46e61cffa2bc0e2468a909fbc024'
          }
        }
      }]);

      const options = {
        hostname: 'gql.twitch.tv',
        port: 443,
        path: '/gql',
        method: 'POST',
        headers: {
          'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Authorization': `OAuth ${authToken}`,
          'Content-Type': 'text/plain;charset=UTF-8',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            const channelData = response[0]?.data?.community?.channel;
            const points = channelData?.self?.communityPoints?.balance || 0;

            resolve({ points, error: null });
          } catch (e) {
            console.error('Error parsing points response:', e);
            resolve({ points: 0, error: e.message });
          }
        });
      });

      req.on('error', (e) => {
        console.error('Request error:', e);
        resolve({ points: 0, error: e.message });
      });

      req.write(postData);
      req.end();
    } catch (error) {
      console.error('Error getting channel points:', error);
      resolve({ points: 0, error: error.message });
    }
  });
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
ipcMain.handle('claim-drop', async (event, dropInstanceID) => {
  const https = require('https');

  return new Promise(async (resolve) => {
    console.log('Claiming drop:', dropInstanceID);

    let authToken = null;

    // Сначала пробуем получить OAuth токен
    const oauth = store.get('oauth');
    if (oauth && oauth.accessToken) {
      authToken = oauth.accessToken;
      console.log('Using OAuth token for claim');
    } else {
      // Если нет OAuth, пробуем куки
      const { session } = require('electron');
      const twitchSession = session.fromPartition('persist:twitch');

      try {
        const cookies = await twitchSession.cookies.get({
          url: 'https://www.twitch.tv',
          name: 'auth-token'
        });

        if (cookies && cookies.length > 0) {
          authToken = cookies[0].value;
          console.log('Using cookie token for claim');
        }
      } catch (e) {
        console.error('Error getting cookie token:', e.message);
      }
    }

    if (!authToken) {
      console.error('No auth token found');
      resolve({ success: false, error: 'Требуется авторизация в Twitch' });
      return;
    }

    try {
      const postData = JSON.stringify([{
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

      const options = {
        hostname: 'gql.twitch.tv',
        port: 443,
        path: '/gql',
        method: 'POST',
        headers: {
          'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Authorization': `OAuth ${authToken}`,
          'Content-Type': 'text/plain;charset=UTF-8',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            console.log('Claim response:', response);

            if (response[0]?.data?.claimDropRewards?.status === 'ELIGIBLE_FOR_ALL') {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: 'Не удалось получить награду' });
            }
          } catch (e) {
            console.error('Error parsing claim response:', e);
            resolve({ success: false, error: e.message });
          }
        });
      });

      req.on('error', (e) => {
        console.error('Request error:', e);
        resolve({ success: false, error: e.message });
      });

      req.write(postData);
      req.end();
    } catch (error) {
      console.error('Error claiming drop:', error);
      resolve({ success: false, error: error.message });
    }
  });
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

        const req = https.request(options, (res) => {
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
              sha256Hash: '2f884fa187b8fadb2a49db0adc033e636f7b6aaee6e76de1e2bba9a7baf0daf6'
            }
          }
        }]);

        const claimResult = await new Promise((resolveClaim) => {
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

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                const response = JSON.parse(data);
                const success = response[0]?.data?.claimDropRewards?.status === 'ELIGIBLE_FOR_ALL';
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
// Получение подписок пользователя
ipcMain.handle('get-user-subscriptions', async (event, authToken) => {
  return new Promise((resolve) => {
    if (!authToken) {
      console.log('[GetSubscriptions] No authToken provided!');
      resolve([]);
      return;
    }

    console.log('[GetSubscriptions] Starting with token:', authToken.substring(0, 20) + '...');

    try {
      // Используем Helix API вместо GraphQL для получения follows
      // Сначала получаем user ID
      const userOptions = {
        hostname: 'api.twitch.tv',
        path: '/helix/users',
        method: 'GET',
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${authToken}`
        }
      };

      const userReq = https.request(userOptions, (userRes) => {
        let userData = '';
        userRes.on('data', (chunk) => { userData += chunk; });
        userRes.on('end', () => {
          try {
            const userResponse = JSON.parse(userData);
            const userId = userResponse?.data?.[0]?.id;
            console.log('[GetSubscriptions] Got user ID:', userId);

            if (!userId) {
              console.log('[GetSubscriptions] No user ID found in response!');
              console.log('[GetSubscriptions] Full response:', userData);
              resolve([]);
              return;
            }

            // Теперь получаем список follows через Helix API (минимальные данные)
            const followsOptions = {
              hostname: 'api.twitch.tv',
              path: `/helix/channels/followed?user_id=${userId}&first=100`,
              method: 'GET',
              headers: {
                'Client-ID': TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${authToken}`
              }
            };

            const followsReq = https.request(followsOptions, (followsRes) => {
              let followsData = '';
              followsRes.on('data', (chunk) => { followsData += chunk; });
              followsRes.on('end', () => {
                try {
                  const followsResponse = JSON.parse(followsData);
                  const follows = followsResponse?.data || [];

                  console.log('[GetSubscriptions] Got follows response, count:', follows.length);

                  if (follows.length === 0) {
                    resolve([]);
                    return;
                  }

                  // УПРОЩЕННЫЙ ВАРИАНТ - возвращаем только то что есть из API
                  const formatted = follows.map(channel => ({
                    id: channel.broadcaster_id,
                    login: channel.broadcaster_login,
                    displayName: channel.broadcaster_name,
                    profileImageUrl: '', // Будет загружено асинхронно в renderer
                    followers: 0, // Будет получено из кеша или API
                    lastStreamDate: null, // Будет получено из кеша или API
                    streamFrequency: 0,
                    consistency: 0,
                    hasDrops: false,
                    isLive: false
                  }));

                  console.log(`[GetSubscriptions] Loaded ${formatted.length} subscriptions`);
                  console.log('[GetSubscriptions] About to resolve with data');
                  resolve(formatted);
                } catch (e) {
                  console.error('[GetSubscriptions] Error parsing follows:', e);
                  console.log('[GetSubscriptions] Raw data:', followsData);
                  resolve([]);
                }
              });
            });

            followsReq.on('error', (e) => {
              console.error('[GetSubscriptions] Error fetching follows:', e);
              resolve([]);
            });

            followsReq.end();

          } catch (e) {
            console.error('[GetSubscriptions] Error parsing user data:', e);
            console.log('[GetSubscriptions] Raw user data:', userData);
            resolve([]);
          }
        });
      });

      userReq.on('error', (e) => {
        console.error('[GetSubscriptions] Error fetching user:', e);
        resolve([]);
      });

      userReq.end();

    } catch (error) {
      console.error('[GetSubscriptions] Error in get-user-subscriptions:', error);
      console.error('[GetSubscriptions] Stack:', error.stack);
      resolve([]);
    }

    // Таймаут на случай если что-то зависло
    setTimeout(() => {
      console.warn('[GetSubscriptions] Request timeout - 30 seconds elapsed');
    }, 30000);
  });
});

// Отписка от канала через GraphQL API
ipcMain.handle('unsubscribe-channel', async (event, authToken, broadcasterId) => {
  return new Promise(async (resolve) => {
    console.log('[Unsubscribe] Starting unsubscribe for broadcaster:', broadcasterId);
    
    if (!authToken || !broadcasterId) {
      console.error('[Unsubscribe] Missing auth token or broadcaster ID');
      resolve({ success: false, error: 'Missing auth token or broadcaster ID' });
      return;
    }

    try {
      // Используем GraphQL API для реальной отписки
      const graphqlQuery = {
        operationName: 'FollowButton_UnfollowUser',
        variables: {
          input: {
            targetID: broadcasterId
          }
        },
        query: `mutation FollowButton_UnfollowUser($input: FollowUserInput!) {
          unfollowUser(input: $input) {
            follow {
              user {
                id
                self {
                  follower {
                    followedAt
                  }
                }
              }
            }
          }
        }`
      };

      const postData = JSON.stringify([graphqlQuery]);

      const options = {
        hostname: 'gql.twitch.tv',
        path: '/gql',
        method: 'POST',
        headers: {
          'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Authorization': `OAuth ${authToken}`,
          'Content-Type': 'text/plain;charset=UTF-8',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      console.log('[Unsubscribe] Sending GraphQL request to unfollow broadcaster:', broadcasterId);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log('[Unsubscribe] Response status:', res.statusCode);
          console.log('[Unsubscribe] Response data:', data);
          
          try {
            const response = JSON.parse(data);
            
            // GraphQL может вернуть массив или объект
            const result = Array.isArray(response) ? response[0] : response;
            
            // Проверяем на ошибки
            if (result.errors && result.errors.length > 0) {
              console.error('[Unsubscribe] GraphQL errors:', result.errors);
              resolve({ success: false, error: result.errors[0].message });
              return;
            }
            
            // Проверяем успешность - может быть data.unfollowUser или просто data
            if (result.data) {
              console.log('[Unsubscribe] Successfully unfollowed broadcaster:', broadcasterId);
              resolve({ success: true });
            } else {
              console.error('[Unsubscribe] No data in response:', result);
              resolve({ success: false, error: 'No data in response' });
            }
          } catch (e) {
            console.error('[Unsubscribe] Error parsing response:', e);
            console.error('[Unsubscribe] Raw data:', data);
            resolve({ success: false, error: 'Invalid response format' });
          }
        });
      });

      req.on('error', (e) => {
        console.error('[Unsubscribe] Request error:', e);
        resolve({ success: false, error: e.message });
      });

      req.write(postData);
      req.end();
    } catch (error) {
      console.error('[Unsubscribe] Error in unsubscribe-channel:', error);
      resolve({ success: false, error: error.message });
    }
  });
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

    https.request(userOptions, (res) => {
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

          https.request(gqlOptions, (res) => {
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

                https.request(gqlOptionsNoAuth, (res2) => {
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

              https.request(followersOptions, (res) => {
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

          https.request(streamOptions, (res) => {
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

          https.request(videosOptions, (res) => {
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

      const imgReq = https.request({
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