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
      // Системные уведомления Windows. Ключ назван так же, как его читает
      // main-процесс (store.get('settings.notifications')): раньше здесь
      // лежал desktopNotifications, который не совпадал с ним ни именем,
      // ни значением по умолчанию.
      notifications: true,
      toastNotifications: true,
      notifyOnDropClaimed: true,

      // Тихие часы: включены по умолчанию намеренно — про эту настройку
      // узнаёшь ровно тогда, когда она уже разбудила
      quietHours: true,
      quietFrom: '23:00',
      quietTo: '09:00',
      
      // Авто-получение
      autoClaimDrops: true,
      
      // Отображение
      compactMode: false,
      showExpiredCampaigns: false,
      animationsEnabled: true,
      
      // Фарминг
      autoSwitchStreams: false,
      preferredStreamQuality: '160p30',

      // Потолок скорости загрузки стрима. Включён по умолчанию: видео
      // качается рывками, и каждый рывок подбрасывает пинг в играх
      // Экономный режим графики включён по умолчанию: приложению не нужно
      // аппаратное ускорение ради видео в 160p фоном, а сто мегабайт и
      // свободная видеокарта для игр нужны
      lowGraphics: true,
      // Фоновый чат Twitch выключен: сундуки собираются запросом, а webview
      // чата стоил ~190 МБ памяти и процессор
      backgroundChat: false,
      // Игровой режим: пока запущена игра, стрим на минимуме с жёстким
      // потолком скорости. Дополнительные процессы — через запятую
      gameMode: true,
      gameModeProcesses: '',
      limitStreamSpeed: true,
      streamSpeedHeadroom: 3,
      autostart: false,
      lastSeenVersion: null,
      
      // Язык
      language: 'ru',
      
      // Тема
      theme: 'dark',
      
      // Завершение работы
      enableShutdown: false,
      shutdownAction: 'shutdown',
      shutdownTrigger: 'drops',
      shutdownDelayMinutes: 5,
      shutdownTimerHours: 3,

      // Разработчик
      developerMode: false
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
      this.mirrorToMainProcess();
      return true;
    } catch (error) {
      console.error('Failed to save settings:', error);
      return false;
    }
  }

  /**
   * Дублирует настройки в electron-store.
   *
   * Без этого половина переключателей была декоративной: интерфейс сохранял
   * настройки в localStorage, а main-процесс и preload читали их из
   * electron-store — например, store.get('settings.minimizeToTray') при
   * закрытии окна и 'settings.autoClaimDrops' в preload чата. Два хранилища
   * никогда не пересекались, поэтому там всегда были значения по умолчанию.
   */
  mirrorToMainProcess() {
    if (!window.electronAPI?.settingsMerge) return;

    // Именно слияние: в ключе settings у main-процесса лежат собственные поля
    // (автозапуск, системные уведомления), которых здесь нет, и запись
    // объекта целиком их стёрла бы.
    window.electronAPI.settingsMerge(this.settings)
      .catch(error => console.warn('[Settings] Не удалось передать настройки в main:', error?.message));
  }

  /**
   * Получить значение настройки
   */
  get(key) {
    return this.settings[key];
  }

  /**
   * Разовая синхронизация при запуске: переносит уже накопленные в
   * localStorage настройки в electron-store, иначе на существующих
   * установках main-процесс продолжил бы видеть значения по умолчанию.
   */
  syncOnStartup() {
    this.mirrorToMainProcess();
  }

  /**
   * Установить значение настройки
   */
  set(key, value) {
    const oldValue = this.settings[key];
    this.settings[key] = value;
    this.saveSettings();

    // Применяем сразу. Раньше applyAll() вызывался только на DOMContentLoaded,
    // поэтому переключатели вступали в силу лишь после перезапуска приложения —
    // со стороны это выглядело так, будто они вообще не работают.
    this.applyAll();

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
  /**
   * Разовое лечение настройки качества.
   *
   * Подбор качества при неудачном старте записывал поднятую ступень в
   * постоянную настройку, а автопереключение категорий грузит стримы
   * помногу раз за сессию. В итоге у многих там осело «Источник» —
   * приложение месяцами качало по шесть мегабит вместо двухсот килобит,
   * а пользователь этого не выбирал.
   *
   * Отличить испорченное значение от осознанного выбора задним числом
   * нельзя, поэтому сбрасываем один раз и оставляем отметку. Дальше
   * настройка снова полностью принадлежит пользователю.
   */
  repairQualityAfterLadderBug() {
    if (this.settings.qualityRepaired) return;

    const текущее = this.settings.preferredStreamQuality;
    const испорчено = текущее === 'chunked' || текущее === '720p60';

    this.settings.qualityRepaired = true;

    if (испорчено) {
      console.log('[Настройки] Качество', текущее, 'сброшено на минимальное:',
        'прежняя версия записывала туда вынужденный подъём');
      this.settings.preferredStreamQuality = '160p30';
    }

    this.saveSettings();
  }

  applyAll() {
    this.repairQualityAfterLadderBug();

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

    // Компактный режим. Класс вешается ПОСЛЕ строки с темой: присваивание
    // className выше затирает всё остальное. Переключатель в настройках
    // вешал этот класс сам, но при следующем запуске он не возвращался —
    // режим включался и молча пропадал.
    document.body.classList.toggle('compact-mode', this.get('compactMode') === true);

    // Экономный режим графики: отключение ускорения требует перезапуска,
    // а вот размытие, тени и вечные анимации можно снять сразу — без
    // видеокарты их рисует процессор, и в фоне это заметно
    document.body.classList.toggle('low-graphics', this.get('lowGraphics') !== false);
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
window.settings = window.settings || new SettingsManager();

// Применяем настройки при загрузке
window.addEventListener('DOMContentLoaded', () => {
  window.settings.applyAll();
  window.settings.syncOnStartup();
});
