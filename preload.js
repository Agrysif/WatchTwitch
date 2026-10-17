const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Управление окном
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // Хранилище данных
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  settingsMerge: (partial) => ipcRenderer.invoke('settings-merge', partial),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),
  
  // Локальные файлы
  readFile: (relativePath) => ipcRenderer.invoke('read-file', relativePath),
  
  // Стрим
  openStream: (url, account) => ipcRenderer.invoke('open-stream', url, account),
  closeStream: () => ipcRenderer.send('close-stream'),
  
  // Уведомления
  showNotification: (title, body, icon) => ipcRenderer.send('show-notification', { title, body, icon }),
  // extra (необязательно): { kind: 'drop'|'summary'|'test', meta: '2 из 4' }
  showDropNotification: (dropName, gameName, dropIcon, extra) => ipcRenderer.send('show-drop-notification', {
    dropName, gameName, dropIcon,
    extra: extra && typeof extra === 'object'
      ? { kind: extra.kind, meta: extra.meta, count: extra.count }
      : undefined
  }),
  // Системное уведомление при окне в фокусе main присылает сюда: окно
  // показывает его тостом, а не всплывашкой Windows поверх себя
  onInAppNotice: (callback) => ipcRenderer.on('in-app-notice', (_e, notice) => callback(notice)),
  
  // Выключение
  shutdownComputer: (action) => ipcRenderer.invoke('shutdown-computer', action),
  
  // Автозапуск
  setAutostart: (enabled) => ipcRenderer.send('set-autostart', enabled),
  // Включён ли автозапуск на самом деле (по Windows)
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  
  // OAuth
  startTwitchAuth: () => ipcRenderer.invoke('start-twitch-auth'),
  getOAuthUser: () => ipcRenderer.invoke('get-oauth-user'),
  logoutTwitch: () => ipcRenderer.invoke('logout-twitch'),
  
  // Открыть в браузере
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  // Не давать системе уснуть, пока плеер играет (и отпустить, когда стих)
  keepAwake: (on) => ipcRenderer.send('keep-awake', !!on),
  
  // Fetch Twitch categories
  fetchTwitchCategories: () => ipcRenderer.invoke('fetch-twitch-categories'),
  checkCategoryDrops: (categoryName) => ipcRenderer.invoke('check-category-drops', categoryName),
  getStreamsWithDrops: (categoryName) => ipcRenderer.invoke('get-streams-with-drops', categoryName),
  getCategoryOverview: (categoryName) => ipcRenderer.invoke('get-category-overview', categoryName),
  getStreamStats: (channelLogin) => ipcRenderer.invoke('get-stream-stats', channelLogin),
  fetchTwitchDrops: () => ipcRenderer.invoke('fetch-twitch-drops'),
  // options.force — ручное обновление: main сбрасывает свой кэш инвентаря
  fetchDropsInventory: (options) => ipcRenderer.invoke('fetch-drops-inventory', options),
  // Какой канал Twitch засчитывает сейчас: прямая проверка, что фарминг идёт
  getDropSession: (channelLogin) => ipcRenderer.invoke('get-drop-session', channelLogin),
  claimAllDrops: () => ipcRenderer.invoke('claim-all-drops'),
  claimDrop: (dropInstanceID) => ipcRenderer.invoke('claim-drop', dropInstanceID),
  updateTrayStatus: (status) => ipcRenderer.send('tray-status', status),
  refreshStreamLimit: (quality) => ipcRenderer.send('refresh-stream-limit', quality),
  // main ждёт логин канала (session-state передаёт streamLogin), а не id:
  // прежние имена channelId/userId сбивали с толку, второй аргумент main не читал
  getChannelPoints: (channelLogin) => ipcRenderer.invoke('get-channel-points', channelLogin),
  
  // Subscriptions
  getUserSubscriptions: (authToken) => ipcRenderer.invoke('get-user-subscriptions', authToken),
  unsubscribeChannel: (authToken, channelLogin) => ipcRenderer.invoke('unsubscribe-channel', authToken, channelLogin),
  getChannelDetails: (authToken, channelLogin) => ipcRenderer.invoke('get-channel-details', authToken, channelLogin),
  
  // Обработчик закрытия приложения
  onAppClosing: (callback) => ipcRenderer.on('app-closing', callback),
  // Ответ на app-closing: сессия сохранена, можно выходить. Без него main
  // ждёт не дольше 3 секунд при любом выходе: крестик, «Выход» в трее,
  // установка обновления
  notifyFarmingSaved: () => ipcRenderer.send('farming-saved'),
  // Перезапуск приложения обычным выходом (с сохранением сессии): так
  // применяется смена языка интерфейса
  relaunchApp: () => ipcRenderer.invoke('app-relaunch'),

  // Обработчик навигации из трея. Первым аргументом ipcRenderer.on отдаёт
  // событие, а не имя страницы: без обёртки роутер получал объект события,
  // и пункт трея «Открыть настройки» оставлял прежнюю страницу
  onNavigateToPage: (callback) => ipcRenderer.on('navigate-to-page', (_e, page) => callback(page)),
  // Показать окно поверх остальных: отсчёт до выключения ПК не должен
  // идти в спрятанном в трей окне, где его некому прервать
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  onShortcut: (callback) => ipcRenderer.on('shortcut', (e, action) => callback(action)),
  // Необработанная ошибка главного процесса: main шлёт её текст, окно
  // показывает короткое сообщение. Без подписки она была видна только в логе
  onMainProcessError: (callback) => ipcRenderer.on('main-process-error', (_e, message) => callback(message)),
  // Сундук собран запросом из main — для уведомления и звука
  onChestClaimed: (callback) => ipcRenderer.on('chest-claimed', (e, data) => callback(data)),
  // Игровой режим: запущена ли игра (main следит за процессами)
  getGameMode: () => ipcRenderer.invoke('get-game-mode'),
  // Есть ли вход в Twitch (cookie auth-token)
  hasTwitchSession: () => ipcRenderer.invoke('has-twitch-session'),
  onGameMode: (callback) => ipcRenderer.on('game-mode', (e, state) => callback(state)),
  setGlobalShortcuts: (enabled) => ipcRenderer.send('set-global-shortcuts', enabled),
  // Какие сочетания заняты другими программами: { enabled, failed: ['Control+Alt+F', …] }
  getShortcutStatus: () => ipcRenderer.invoke('get-shortcut-status'),

  // Auto updater
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', (e, info) => callback(info)),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-download-progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, data) => callback(data)),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (event, data) => callback(data)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  fetchReleaseNotes: (version) => ipcRenderer.invoke('fetch-release-notes', version),

  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

  // Сетевой трафик
  getTrafficStats: () => ipcRenderer.invoke('get-traffic-stats'),
  resetTrafficSession: () => ipcRenderer.invoke('reset-traffic-session'),

  // Diagnostics
  setProcessLabel: (payload) => ipcRenderer.invoke('set-process-label', payload),
  getProcessMetrics: () => ipcRenderer.invoke('get-process-metrics')
});
