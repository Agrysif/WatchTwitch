/**
 * Мост окна уведомления о награде.
 *
 * Окно показывает название награды и картинку, и Node ему не нужен. Раньше
 * оно работало с nodeIntegration и без изоляции: любая будущая правка,
 * которая вставит в него внешний или неэкранированный текст, сразу дала бы
 * чужому коду доступ ко всему компьютеру. Теперь странице доступны только
 * эти функции, и каждая шлёт main одно сообщение без данных от страницы
 * (кроме флага паузы).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notif', {
  // Данные приходят от main уже готовыми: картинка — как data:image/…
  onData: (callback) => ipcRenderer.on('notification-data', (_event, data) => callback(data)),
  // За этим окном в очереди ждут ещё награды: живём короче
  onQueue: (callback) => ipcRenderer.on('notification-queue', (_event, data) => callback(data)),
  close: () => ipcRenderer.send('close-drop-notification'),
  // Щелчок по карточке: открыть приложение на странице наград
  open: () => ipcRenderer.send('open-drop-notification'),
  // Курсор на карточке: main снимает свою страховку закрытия, пока его
  // не уберут, — иначе окно исчезало из-под курсора на середине чтения
  hold: (on) => ipcRenderer.send('hold-drop-notification', !!on)
});
