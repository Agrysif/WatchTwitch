// Channel Points - система отслеживания баллов канала
class ChannelPointsTracker {
  constructor() {
    this.points = {
      startTotal: 0,
      currentTotal: 0,
      earnedThisStream: 0,
      passiveEarned: 0,
      chestsCollected: 0,
      chestsPoints: 0
    };
    this.currentChannelId = null;
    this.updateInterval = null;
  }

  /**
   * Начать отслеживание баллов для канала
   */
  async startTracking(channelId) {
    this.currentChannelId = channelId;
    
    // Получаем начальное количество баллов
    const initialPoints = await this.fetchChannelPoints(channelId);
    if (initialPoints !== null) {
      this.points.startTotal = initialPoints;
      this.points.currentTotal = initialPoints;
      this.points.earnedThisStream = 0;
    }

    // Начинаем периодическое обновление
    this.startAutoUpdate();
  }

  /**
   * Остановить отслеживание
   */
  stopTracking() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.currentChannelId = null;
  }

  /**
   * Запустить автоматическое обновление
   */
  startAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Обновляем каждые 30 секунд
    this.updateInterval = setInterval(async () => {
      if (!this.currentChannelId) return;
      
      const currentPoints = await this.fetchChannelPoints(this.currentChannelId);
      if (currentPoints !== null) {
        this.updatePoints(currentPoints);
      }
    }, 30000);
  }

  /**
   * Получить баллы канала через API
   */
  async fetchChannelPoints(channelId) {
    try {
      const result = await window.TwitchAPI.getChannelPoints(channelId);
      return result?.balance || null;
    } catch (error) {
      console.error('Failed to fetch channel points:', error);
      return null;
    }
  }

  /**
   * Обновить баллы
   */
  updatePoints(newTotal) {
    const diff = newTotal - this.points.currentTotal;
    
    if (diff > 0) {
      // Баллы увеличились
      this.points.currentTotal = newTotal;
      this.points.earnedThisStream = newTotal - this.points.startTotal;
      
      // Пытаемся определить источник баллов
      // Если прирост > 50, вероятно это сундучок
      if (diff >= 50) {
        this.points.chestsCollected++;
        this.points.chestsPoints += diff;
      } else {
        this.points.passiveEarned += diff;
      }
    } else {
      // Баллы потрачены или не изменились
      this.points.currentTotal = newTotal;
    }
  }

  /**
   * Получить текущую статистику
   */
  getStats() {
    return {
      ...this.points,
      // Дополнительные вычисляемые поля
      totalEarned: this.points.passiveEarned + this.points.chestsPoints,
      averagePerChest: this.points.chestsCollected > 0 
        ? Math.round(this.points.chestsPoints / this.points.chestsCollected)
        : 0
    };
  }

  /**
   * Сбросить статистику
   */
  reset() {
    this.points = {
      startTotal: this.points.currentTotal,
      currentTotal: this.points.currentTotal,
      earnedThisStream: 0,
      passiveEarned: 0,
      chestsCollected: 0,
      chestsPoints: 0
    };
  }

  /**
   * Форматировать баллы для отображения
   */
  formatPoints(points) {
    if (points >= 1000000) {
      return (points / 1000000).toFixed(1) + 'M';
    }
    if (points >= 1000) {
      return (points / 1000).toFixed(1) + 'K';
    }
    return points.toString();
  }
}

// Экспорт синглтона
window.ChannelPointsTracker = window.ChannelPointsTracker || new ChannelPointsTracker();
