// Локализация
const translations = {
  ru: {
    nav: {
      farming: 'Фарминг',
      accounts: 'Аккаунты',
      statistics: 'Статистика',
      settings: 'Настройки'
    },
    farming: {
      title: 'Фарминг дропсов',
      subtitle: 'Автоматический сбор дропсов на Twitch',
      selectCategories: 'Выберите категории',
      priority: 'Приоритет',
      status: 'Статус',
      idle: 'Ожидание',
      farming: 'Фарминг',
      completed: 'Завершено',
      noDrops: 'Нет дропсов',
      currentStream: 'Текущий стрим',
      progress: 'Прогресс',
      timeRemaining: 'Осталось времени',
      dropsCompleted: 'Дропсов получено',
      startFarming: 'Начать фарминг',
      stopFarming: 'Остановить',
      addCategory: 'Добавить категорию',
      selectGame: 'Выберите игру',
      noCategories: 'Нет выбранных категорий',
      dragToReorder: 'Перетащите для изменения порядка'
    },
    accounts: {
      title: 'Аккаунты',
      subtitle: 'Управление Twitch аккаунтами',
      addAccount: 'Добавить аккаунт',
      loginWithTwitch: 'Войти через Twitch',
      loginWithCookies: 'Войти через cookies',
      username: 'Имя пользователя',
      status: 'Статус',
      connected: 'Подключен',
      disconnected: 'Отключен',
      remove: 'Удалить',
      noAccounts: 'Нет добавленных аккаунтов'
    },
    statistics: {
      title: 'Статистика',
      subtitle: 'Ваша статистика фарминга',
      totalWatchTime: 'Всего просмотрено',
      totalDrops: 'Всего дропсов',
      timeSaved: 'Сэкономлено времени',
      categoriesCompleted: 'Категорий завершено',
      period: 'Период',
      allTime: 'Все время',
      thisMonth: 'Этот месяц',
      custom: 'Настраиваемый',
      export: 'Экспорт',
      hours: 'ч',
      days: 'дн'
    },
    settings: {
      title: 'Настройки',
      subtitle: 'Конфигурация приложения',
      general: 'Общие',
      language: 'Язык',
      theme: 'Тема',
      dark: 'Темная',
      light: 'Светлая',
      autostart: 'Автозапуск при старте Windows',
      notifications: 'Уведомления',
      enableNotifications: 'Включить уведомления',
      soundAlerts: 'Звуковые уведомления',
      farming: 'Фарминг',
      streamQuality: 'Качество стрима',
      lowest: 'Минимальное',
      checkInterval: 'Интервал проверки (минуты)',
      preferredLanguage: 'Предпочитаемый язык стримов',
      russian: 'Русский',
      english: 'Английский',
      any: 'Любой',
      shutdown: 'Выключение',
      enableShutdown: 'Включить автовыключение',
      shutdownAction: 'Действие после завершения',
      shutdownPC: 'Выключить компьютер',
      sleep: 'Спящий режим',
      hibernate: 'Гибернация',
      advanced: 'Расширенные',
      enableLogging: 'Включить логирование',
      clearCache: 'Очистить кэш',
      save: 'Сохранить'
    },
    common: {
      yes: 'Да',
      no: 'Нет',
      cancel: 'Отмена',
      ok: 'ОК',
      save: 'Сохранить',
      delete: 'Удалить',
      edit: 'Редактировать',
      close: 'Закрыть',
      loading: 'Загрузка...'
    }
  },
  en: {
    nav: {
      farming: 'Farming',
      accounts: 'Accounts',
      statistics: 'Statistics',
      settings: 'Settings'
    },
    farming: {
      title: 'Drops Farming',
      subtitle: 'Automatic Twitch drops collection',
      selectCategories: 'Select Categories',
      priority: 'Priority',
      status: 'Status',
      idle: 'Idle',
      farming: 'Farming',
      completed: 'Completed',
      noDrops: 'No Drops',
      currentStream: 'Current Stream',
      progress: 'Progress',
      timeRemaining: 'Time Remaining',
      dropsCompleted: 'Drops Completed',
      startFarming: 'Start Farming',
      stopFarming: 'Stop',
      addCategory: 'Add Category',
      selectGame: 'Select Game',
      noCategories: 'No categories selected',
      dragToReorder: 'Drag to reorder'
    },
    accounts: {
      title: 'Accounts',
      subtitle: 'Manage Twitch accounts',
      addAccount: 'Add Account',
      loginWithTwitch: 'Login with Twitch',
      loginWithCookies: 'Login with Cookies',
      username: 'Username',
      status: 'Status',
      connected: 'Connected',
      disconnected: 'Disconnected',
      remove: 'Remove',
      noAccounts: 'No accounts added'
    },
    statistics: {
      title: 'Statistics',
      subtitle: 'Your farming statistics',
      totalWatchTime: 'Total Watch Time',
      totalDrops: 'Total Drops',
      timeSaved: 'Time Saved',
      categoriesCompleted: 'Categories Completed',
      period: 'Period',
      allTime: 'All Time',
      thisMonth: 'This Month',
      custom: 'Custom',
      export: 'Export',
      hours: 'h',
      days: 'd'
    },
    settings: {
      title: 'Settings',
      subtitle: 'Application configuration',
      general: 'General',
      language: 'Language',
      theme: 'Theme',
      dark: 'Dark',
      light: 'Light',
      autostart: 'Autostart with Windows',
      notifications: 'Notifications',
      enableNotifications: 'Enable notifications',
      soundAlerts: 'Sound alerts',
      farming: 'Farming',
      streamQuality: 'Stream quality',
      lowest: 'Lowest',
      checkInterval: 'Check interval (minutes)',
      preferredLanguage: 'Preferred stream language',
      russian: 'Russian',
      english: 'English',
      any: 'Any',
      shutdown: 'Shutdown',
      enableShutdown: 'Enable auto-shutdown',
      shutdownAction: 'Action after completion',
      shutdownPC: 'Shutdown PC',
      sleep: 'Sleep',
      hibernate: 'Hibernate',
      advanced: 'Advanced',
      enableLogging: 'Enable logging',
      clearCache: 'Clear cache',
      save: 'Save'
    },
    common: {
      yes: 'Yes',
      no: 'No',
      cancel: 'Cancel',
      ok: 'OK',
      save: 'Save',
      delete: 'Delete',
      edit: 'Edit',
      close: 'Close',
      loading: 'Loading...'
    }
  }
};

class I18n {
  constructor() {
    this.currentLang = 'ru';
    this.init();
  }

  async init() {
    const savedLang = await window.electronAPI.storeGet('settings.language');
    if (savedLang) {
      this.currentLang = savedLang;
    }
    this.updatePage();
  }

  setLanguage(lang) {
    this.currentLang = lang;
    window.electronAPI.storeSet('settings.language', lang);
    this.updatePage();
  }

  t(key) {
    const keys = key.split('.');
    let value = translations[this.currentLang];
    
    for (const k of keys) {
      value = value?.[k];
    }
    
    return value || key;
  }

  updatePage() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.getAttribute('data-i18n');
      element.textContent = this.t(key);
    });
  }
}

// Create global instance
if (!window.i18n) {
  window.i18n = new I18n();
}
