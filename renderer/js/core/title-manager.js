// Title Manager - управление заголовком окна
class TitleManager {
  constructor() {
    this.baseTitle = 'WatchTwitch';
    this.updateInterval = null;
    this.startAutoUpdate();
  }

  /**
   * Обновить заголовок окна
   */
  update(title) {
    if (title) {
      document.title = title;
    } else {
      document.title = this.baseTitle;
    }
  }

  /**
   * Показать прогресс дропов в заголовке
   */
  updateWithDropsProgress() {
    if (!window.DropsManager) {
      this.update();
      return;
    }

    const progress = window.DropsManager.getOverallProgress();
    
    if (progress.total === 0) {
      this.update();
      return;
    }

    const readyDrops = progress.ready;
    const completedDrops = progress.completed;
    const totalDrops = progress.total;

    if (readyDrops > 0) {
      // Есть готовые дропы к получению
      this.update(`🎁 ${readyDrops} готов${readyDrops === 1 ? '' : 'о'} | ${this.baseTitle}`);
    } else if (completedDrops > 0) {
      // Есть прогресс
      this.update(`⏳ ${completedDrops}/${totalDrops} | ${this.baseTitle}`);
    } else {
      // Нет прогресса
      this.update(`${totalDrops} дроп${totalDrops === 1 ? '' : totalDrops < 5 ? 'а' : 'ов'} | ${this.baseTitle}`);
    }
  }

  /**
   * Показать статистику фарминга
   */
  updateWithFarmingStats(channelName, duration) {
    if (channelName && duration) {
      this.update(`▶️ ${channelName} • ${duration} | ${this.baseTitle}`);
    } else {
      this.updateWithDropsProgress();
    }
  }

  /**
   * Показать количество уведомлений
   */
  updateWithNotifications(count) {
    if (count > 0) {
      this.update(`(${count}) ${this.baseTitle}`);
    } else {
      this.update();
    }
  }

  /**
   * Сбросить заголовок
   */
  reset() {
    this.update();
  }

  /**
   * Запустить автоматическое обновление заголовка
   */
  startAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Обновляем каждые 30 секунд
    this.updateInterval = setInterval(() => {
      if (window.streamingManager?.isFarmingActive?.()) {
        // Если идёт фарминг, показываем статистику
        const channelName = window.streamingManager.currentChannel;
        const duration = this.formatFarmingDuration();
        this.updateWithFarmingStats(channelName, duration);
      } else {
        // Иначе показываем прогресс дропов
        this.updateWithDropsProgress();
      }
    }, 30000);

    // Первое обновление сразу
    setTimeout(() => {
      this.updateWithDropsProgress();
    }, 1000);
  }

  /**
   * Остановить автоматическое обновление
   */
  stopAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Форматировать длительность фарминга
   */
  formatFarmingDuration() {
    if (!window.farmingPage?.sessionStartTime) {
      return '';
    }

    const now = Date.now();
    const elapsed = now - window.farmingPage.sessionStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0) {
      return `${hours}ч ${mins}м`;
    }
    return `${mins}м`;
  }
}

// Экспорт синглтона
window.TitleManager = window.TitleManager || new TitleManager();
