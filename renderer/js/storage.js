// Storage wrapper
class Storage {
  static async get(key, defaultValue = null) {
    const value = await window.electronAPI.storeGet(key);
    return value !== undefined ? value : defaultValue;
  }

  static async set(key, value) {
    await window.electronAPI.storeSet(key, value);
  }

  static async delete(key) {
    await window.electronAPI.storeDelete(key);
  }

  static async getAccounts() {
    return await this.get('accounts', []);
  }

  static async saveAccount(account) {
    const accounts = await this.getAccounts();
    const existingIndex = accounts.findIndex(a => a.username === account.username);
    
    if (existingIndex >= 0) {
      accounts[existingIndex] = account;
    } else {
      accounts.push(account);
    }
    
    await this.set('accounts', accounts);
  }

  static async removeAccount(username) {
    const accounts = await this.getAccounts();
    const filtered = accounts.filter(a => a.username !== username);
    await this.set('accounts', filtered);
  }

  static async getCategories() {
    return await this.get('categories', []);
  }

  static async saveCategories(categories) {
    await this.set('categories', categories);
  }

  static async getStatistics() {
    return await this.get('statistics', {
      totalWatchTime: 0,
      totalDrops: 0,
      categoriesCompleted: 0,
      sessions: []
    });
  }

  static async updateStatistics(update) {
    const stats = await this.getStatistics();
    Object.assign(stats, update);
    await this.set('statistics', stats);
  }

  static async addSession(session) {
    const stats = await this.getStatistics();
    if (!stats.sessions) {
      stats.sessions = [];
    }
    stats.sessions.push({
      ...session,
      timestamp: session.timestamp || Date.now(),
      isActive: session.isActive || false
    });
    await this.set('statistics', stats);
  }

  static async updateCurrentSession(sessionData) {
    const stats = await this.getStatistics();
    if (!stats.sessions) {
      stats.sessions = [];
    }
    
    // Находим активную сессию
    const activeIndex = stats.sessions.findIndex(s => s.isActive === true);
    
    if (activeIndex >= 0) {
      // Обновляем существующую активную сессию
      stats.sessions[activeIndex] = {
        ...stats.sessions[activeIndex],
        ...sessionData,
        isActive: true
      };
    } else {
      // Создаем новую активную сессию
      stats.sessions.push({
        ...sessionData,
        timestamp: sessionData.timestamp || Date.now(),
        isActive: true
      });
    }
    
    await this.set('statistics', stats);
  }

  static async finalizeCurrentSession(finalData) {
    const stats = await this.getStatistics();
    if (!stats.sessions) return;
    
    // Находим активную сессию и завершаем её
    const activeIndex = stats.sessions.findIndex(s => s.isActive === true);
    
    if (activeIndex >= 0) {
      stats.sessions[activeIndex] = {
        ...stats.sessions[activeIndex],
        ...finalData,
        isActive: false
      };
      await this.set('statistics', stats);
    }
  }

  /**
   * Полная очистка накопленной статистики.
   *
   * Нужна потому, что до исправления счётчиков в сессии писались неверные
   * значения: вместо нафармленного за сессию сохранялись баллы текущего
   * стрима, а количество дропсов вообще было заглушкой с нулём. Эти записи
   * уже лежат в хранилище, и пересчитать их задним числом неоткуда —
   * исходных данных не сохранилось.
   */
  static async clearStatistics() {
    await this.set('statistics', {
      totalWatchTime: 0,
      totalDrops: 0,
      categoriesCompleted: 0,
      sessions: []
    });
    await this.saveWatchTimeStats({});
    console.log('[Storage] Статистика очищена');
  }

  static async getSettings() {
    return await this.get('settings', {
      language: 'ru',
      theme: 'dark',
      autostart: false,
      notifications: true,
      soundAlerts: true,
      streamQuality: 'lowest',
      checkInterval: 1,
      preferredLanguage: 'russian',
      enableShutdown: false,
      shutdownAction: 'shutdown',
      enableLogging: false,
      minimizeToTray: false
    });
  }

  static async saveSettings(settings) {
    await this.set('settings', settings);
  }

  static async getBlacklist() {
    return await this.get('blacklist', []);
  }

  static async addToBlacklist(streamerName) {
    const blacklist = await this.getBlacklist();
    if (!blacklist.includes(streamerName)) {
      blacklist.push(streamerName);
      await this.set('blacklist', blacklist);
    }
  }

  static async removeFromBlacklist(streamerName) {
    const blacklist = await this.getBlacklist();
    const filtered = blacklist.filter(name => name !== streamerName);
    await this.set('blacklist', filtered);
  }

  static async getWatchTimeStats() {
    return await this.get('watchTimeStats', {});
  }

  static async saveWatchTimeStats(stats) {
    await this.set('watchTimeStats', stats);
  }

  static async getSubscriptions() {
    return await this.get('subscriptions', []);
  }

  static async saveSubscriptions(subscriptions) {
    await this.set('subscriptions', subscriptions);
  }

  static async getItem(key, defaultValue = null) {
    return await this.get(key, defaultValue);
  }

  static async setItem(key, value) {
    await this.set(key, value);
  }
}
