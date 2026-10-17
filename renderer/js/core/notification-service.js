/**
 * NotificationService — прежняя обёртка над уведомлениями.
 *
 * Своим кодом её почти никто не зовёт: уведомления о событиях фарминга
 * идут через window.notifyFarmingEvent (farming-page.js), окно о награде —
 * через window.showDropNotification, звук — через window.chime. Объект
 * оставлен ради совместимости: settings-manager.js сообщает ему о
 * выключателе звука.
 *
 * Раньше сервис при загрузке создавал собственный AudioContext (открытый
 * аудиопоток Windows на всё время работы) и пищал своим тоном в 800 Гц
 * мимо всех настроек. Теперь звук один — chime.js, с громкостью, тихими
 * часами и игровым режимом. Тексты без эмодзи: Windows рисует их в
 * уведомлениях по-разному, а заголовок и так говорит суть.
 */
class NotificationService {
  constructor() {
    this.soundEnabled = true;
  }

  /** Звук о полученной награде — общим сигналом chime.js. */
  playNotificationSound() {
    if (!this.soundEnabled) return false;
    return !!window.chime?.play?.('drop');
  }

  /** Системное уведомление Windows. */
  async showDesktopNotification(title, body, options = {}) {
    try {
      if (window.electronAPI?.showNotification) {
        window.electronAPI.showNotification(title, body, options.icon || null);
      } else {
        console.warn('[Уведомления] electronAPI недоступен:', title);
      }
    } catch (error) {
      console.error('[Уведомления] Не показано:', error);
    }
  }

  /** Окно о полученной награде (в углу экрана). */
  showCustomDropNotification(dropName, gameName, dropIcon = null, extra = undefined) {
    if (window.electronAPI?.showDropNotification) {
      window.electronAPI.showDropNotification(dropName, gameName, dropIcon, extra);
    } else if (typeof window.showDropNotification === 'function') {
      window.showDropNotification(dropName, gameName, dropIcon, extra);
    } else {
      console.error('[Уведомления] Окно о награде показать нечем');
    }
  }

  /** Награду можно забрать. */
  notifyDropReady(dropName, gameName) {
    return this.showDesktopNotification(
      tr('Награда готова'),
      `${dropName} · ${gameName}`
    );
  }

  /** Награда получена — окно с наградой, если оно не выключено. */
  notifyDropClaimed(dropName, gameName, dropIcon = null) {
    if (window.settings?.get?.('notifyOnDropClaimed') === false) return;

    if (typeof window.showDropNotification === 'function') {
      return window.showDropNotification(dropName, gameName, dropIcon);
    }
    return this.showCustomDropNotification(dropName, gameName, dropIcon);
  }

  /** Ошибка — системным уведомлением. */
  notifyError(message, details = '') {
    return this.showDesktopNotification(tr('Ошибка'), details ? `${message}: ${details}` : message);
  }

  toggleSound(enabled) {
    this.soundEnabled = enabled !== false;
    return this.soundEnabled;
  }

  isSoundEnabled() {
    return this.soundEnabled;
  }
}

// Экспорт синглтона
window.NotificationService = window.NotificationService || new NotificationService();
