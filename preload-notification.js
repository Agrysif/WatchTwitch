/**
 * Мост окна уведомления о награде.
 *
 * Окно показывает название награды и картинку, и Node ему не нужен. Раньше
 * оно работало с nodeIntegration и без изоляции: любая будущая правка,
 * которая вставит в него внешний или неэкранированный текст, сразу дала бы
 * чужому коду доступ ко всему компьютеру. Теперь странице доступны только
 * эти две функции.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notif', {
  // Данные приходят от main уже готовыми: картинка — как data:image/…
  onData: (callback) => ipcRenderer.on('notification-data', (_event, data) => callback(data)),
  close: () => ipcRenderer.send('close-drop-notification')
});
