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
   * Показать desktop уведомление (отключено по умолчанию)
   */
  async showDesktopNotification(title, body, options = {}) {
    // Desktop уведомления отключены - используем только toast внутри приложения
    console.log('Desktop notification (disabled):', title, body);
    return null;
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
  notifyDropClaimed(dropName, gameName) {
    return this.showDesktopNotification(
      '✅ Дроп получен!',
      `${dropName}\n${gameName}`,
      { 
        icon: '../assets/icon.png',
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
