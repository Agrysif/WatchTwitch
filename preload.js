const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Управление окном
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // Хранилище данных
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),
  
  // Локальные файлы
  readFile: (relativePath) => ipcRenderer.invoke('read-file', relativePath),
  
  // Стрим
  openStream: (url, account) => ipcRenderer.invoke('open-stream', url, account),
  closeStream: () => ipcRenderer.send('close-stream'),
  
  // Уведомления
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  
  // Выключение
  shutdownComputer: (action) => ipcRenderer.invoke('shutdown-computer', action),
  
  // Автозапуск
  setAutostart: (enabled) => ipcRenderer.send('set-autostart', enabled),
  
  // OAuth
  startTwitchAuth: () => ipcRenderer.invoke('start-twitch-auth'),
  getOAuthUser: () => ipcRenderer.invoke('get-oauth-user'),
  logoutTwitch: () => ipcRenderer.invoke('logout-twitch'),
  
  // Открыть в браузере
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Follow/Unfollow
  followChannel: (channelLogin) => ipcRenderer.invoke('follow-channel', channelLogin),
  checkFollowing: (channelLogin) => ipcRenderer.invoke('check-following', channelLogin),
  
  // Fetch Twitch categories
  fetchTwitchCategories: () => ipcRenderer.invoke('fetch-twitch-categories'),
  checkCategoryDrops: (categoryName) => ipcRenderer.invoke('check-category-drops', categoryName),
  getStreamsWithDrops: (categoryName) => ipcRenderer.invoke('get-streams-with-drops', categoryName),
  getStreamStats: (channelLogin) => ipcRenderer.invoke('get-stream-stats', channelLogin),
  getDropsProgress: (channelLogin) => ipcRenderer.invoke('get-drops-progress', channelLogin),
  fetchTwitchDrops: () => ipcRenderer.invoke('fetch-twitch-drops'),
  fetchDropsInventory: () => ipcRenderer.invoke('fetch-drops-inventory'),
  claimAllDrops: () => ipcRenderer.invoke('claim-all-drops'),
  claimDrop: (dropInstanceID) => ipcRenderer.invoke('claim-drop', dropInstanceID),
  getChannelPoints: (channelId, userId) => ipcRenderer.invoke('get-channel-points', channelId, userId)
});
