// Notification Service - централизованная система уведомлений
class NotificationService {
  constructor() {
    this.soundEnabled = true;
    this.notificationSound = null;
    this.initSound();
  }

  /**
   * Инициализация звука для уведомлений
   */
  initSound() {
    // Создаём простой звук уведомления используя Web Audio API
    // Можно будет заменить на реальный аудио файл
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  /**
   * Воспроизвести звук уведомления
   */
  playNotificationSound() {
    if (!this.soundEnabled || !this.audioContext) return;

    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
      
      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.5);
    } catch (error) {
      console.error('Failed to play notification sound:', error);
    }
  }

  /**
   * Показать desktop уведомление
   */
  async showDesktopNotification(title, body, options = {}) {
    console.log('[NotificationService] showDesktopNotification called:', { title, body, options, hasElectronAPI: !!window.electronAPI });
    
    try {
      if (window.electronAPI && window.electronAPI.showNotification) {
        console.log('[NotificationService] Calling electronAPI.showNotification');
        window.electronAPI.showNotification(title, body, options.icon || null);
      } else {
        console.warn('[NotificationService] electronAPI not available. Notification:', title, body);
      }
    } catch (error) {
      console.error('[NotificationService] Failed to show desktop notification:', error);
    }
  }

  /**
   * Показать кастомное уведомление о дропе (в стиле приложения)
   */
  showCustomDropNotification(dropName, gameName, dropIcon = null) {
    // Используем Electron API для показа уведомления на экране (не внутри приложения)
    if (window.electronAPI && window.electronAPI.showDropNotification) {
      window.electronAPI.showDropNotification(dropName, gameName, dropIcon);
    } else if (typeof window.showDropNotification === 'function') {
      window.showDropNotification(dropName, gameName, dropIcon);
    } else {
      console.error('[NotificationService] No method available to show drop notification');
    }
  }

  /**
   * Уведомление о готовности дропа
   */
  notifyDropReady(dropName, gameName) {
    return this.showDesktopNotification(
      '🎁 Дроп готов к получению!',
      `${dropName}\n${gameName}`,
      { 
        icon: '../assets/icon.png',
        tag: `drop-ready-${dropName}` // Предотвращает дубликаты
      }
    );
  }

  /**
   * Уведомление об успешном получении дропа
   */
  notifyDropClaimed(dropName, gameName, dropIcon = null) {
    // Проверяем настройку перед показом уведомления
    const settings = window.SettingsManager;
    if (!settings || !settings.get('notifyOnDropClaimed')) {
      return;
    }
    
    // Показываем кастомное уведомление в стиле приложения
    // Используем глобальную функцию если доступна, иначе собственную
    if (typeof window.showDropNotification === 'function') {
      return window.showDropNotification(dropName, gameName, dropIcon);
    } else {
      return this.showCustomDropNotification(dropName, gameName, dropIcon);
    }
  }
        tag: `drop-claimed-${dropName}`
      }
    );
  }

  /**
   * Уведомление об ошибке
   */
  notifyError(message, details = '') {
    return this.showDesktopNotification(
      '❌ Ошибка',
      `${message}\n${details}`,
      { 
        icon: '../assets/icon.png',
        playSound: false
      }
    );
  }

  /**
   * Включить/выключить звук
   */
  toggleSound(enabled) {
    this.soundEnabled = enabled;
    return this.soundEnabled;
  }

  /**
   * Проверить статус звука
   */
  isSoundEnabled() {
    return this.soundEnabled;
  }
}

// Экспорт синглтона
window.NotificationService = window.NotificationService || new NotificationService();
