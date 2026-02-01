// Settings Manager - управление настройками приложения
class SettingsManager {
  constructor() {
    this.settings = this.loadSettings();
    this.listeners = new Map();
  }

  /**
   * Загрузить настройки из localStorage
   */
  loadSettings() {
    const defaultSettings = {
      // Звук
      soundEnabled: false,
      soundVolume: 0.5,
      
      // Уведомления
      desktopNotifications: false,
      toastNotifications: true,
      
      // Авто-получение
      autoClaimDrops: true,
      
      // Отображение
      compactMode: false,
      showExpiredCampaigns: false,
      animationsEnabled: true,
      
      // Фарминг
      autoSwitchStreams: false,
      preferredStreamQuality: 'auto',
      
      // Язык
      language: 'ru',
      
      // Тема
      theme: 'dark'
    };

    try {
      const saved = localStorage.getItem('app_settings');
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }

    return defaultSettings;
  }

  /**
   * Сохранить настройки в localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem('app_settings', JSON.stringify(this.settings));
      return true;
    } catch (error) {
      console.error('Failed to save settings:', error);
      return false;
    }
  }

  /**
   * Получить значение настройки
   */
  get(key) {
    return this.settings[key];
  }

  /**
   * Установить значение настройки
   */
  set(key, value) {
    const oldValue = this.settings[key];
    this.settings[key] = value;
    this.saveSettings();
    
    // Уведомляем слушателей
    this.notifyListeners(key, value, oldValue);
    
    return true;
  }

  /**
   * Обновить несколько настроек
   */
  update(updates) {
    Object.entries(updates).forEach(([key, value]) => {
      this.set(key, value);
    });
  }

  /**
   * Сбросить настройки к значениям по умолчанию
   */
  reset() {
    this.settings = this.loadSettings();
    localStorage.removeItem('app_settings');
    this.notifyListeners('*', this.settings, {});
  }

  /**
   * Подписаться на изменения настройки
   */
  onChange(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(callback);
    
    // Возвращаем функцию отписки
    return () => {
      const listeners = this.listeners.get(key);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * Уведомить слушателей об изменении
   */
  notifyListeners(key, newValue, oldValue) {
    // Уведомляем конкретных слушателей
    const listeners = this.listeners.get(key);
    if (listeners) {
      listeners.forEach(callback => callback(newValue, oldValue));
    }
    
    // Уведомляем глобальных слушателей
    const globalListeners = this.listeners.get('*');
    if (globalListeners) {
      globalListeners.forEach(callback => callback(key, newValue, oldValue));
    }
  }

  /**
   * Применить настройки звука
   */
  applySoundSettings() {
    if (window.NotificationService) {
      window.NotificationService.toggleSound(this.get('soundEnabled'));
    }
  }

  /**
   * Применить настройки авто-получения
   */
  applyAutoClaimSettings() {
    if (window.ClaimService) {
      window.ClaimService.toggleAutoClaim(this.get('autoClaimDrops'));
    }
  }

  /**
   * Применить все настройки
   */
  applyAll() {
    this.applySoundSettings();
    this.applyAutoClaimSettings();
    
    // Тема
    document.body.className = `theme-${this.get('theme')}`;
    
    // Анимации
    if (!this.get('animationsEnabled')) {
      document.body.classList.add('no-animations');
    } else {
      document.body.classList.remove('no-animations');
    }
  }

  /**
   * Экспорт настроек
   */
  export() {
    return JSON.stringify(this.settings, null, 2);
  }

  /**
   * Импорт настроек
   */
  import(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      this.settings = { ...this.settings, ...imported };
      this.saveSettings();
      this.applyAll();
      return true;
    } catch (error) {
      console.error('Failed to import settings:', error);
      return false;
    }
  }
}

// Экспорт синглтона
window.SettingsManager = window.SettingsManager || new SettingsManager();

// Применяем настройки при загрузке
window.addEventListener('DOMContentLoaded', () => {
  window.SettingsManager.applyAll();
});
