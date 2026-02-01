// Date helpers - утилиты для работы с датами
const DateHelpers = {
  /**
   * Форматировать время в "X ago" формат
   */
  timeAgo(date) {
    if (!date) return '';
    
    const now = new Date();
    const past = new Date(date);
    const diffMs = now - past;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    if (diffDays < 7) return `${diffDays} дн назад`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед назад`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} мес назад`;
    return `${Math.floor(diffDays / 365)} г назад`;
  },

  /**
   * Форматировать оставшееся время
   */
  timeRemaining(endDate) {
    if (!endDate) return '';
    
    const now = new Date();
    const end = new Date(endDate);
    const diffMs = end - now;
    
    if (diffMs < 0) return 'Завершена';
    
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}д ${diffHours % 24}ч`;
    if (diffHours > 0) return `${diffHours}ч ${diffMins % 60}м`;
    if (diffMins > 0) return `${diffMins}м`;
    return 'меньше минуты';
  },

  /**
   * Форматировать длительность в минутах
   */
  formatDuration(minutes) {
    if (!minutes || minutes < 0) return '0м';
    
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    
    if (hours > 0) {
      return mins > 0 ? `${hours}ч ${mins}м` : `${hours}ч`;
    }
    return `${mins}м`;
  },

  /**
   * Форматировать дату в читаемый формат
   */
  formatDate(date, includeTime = false) {
    if (!date) return '';
    
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    
    if (!includeTime) {
      return `${day}.${month}.${year}`;
    }
    
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  },

  /**
   * Проверить истекла ли кампания
   */
  isCampaignExpired(endDate) {
    if (!endDate) return false;
    return new Date(endDate) < new Date();
  },

  /**
   * Проверить начата ли кампания
   */
  isCampaignStarted(startDate) {
    if (!startDate) return true;
    return new Date(startDate) <= new Date();
  },

  /**
   * Проверить активна ли кампания
   */
  isCampaignActive(startDate, endDate) {
    return this.isCampaignStarted(startDate) && !this.isCampaignExpired(endDate);
  },

  /**
   * Получить оставшееся время в часах
   */
  getHoursRemaining(endDate) {
    if (!endDate) return Infinity;
    
    const now = new Date();
    const end = new Date(endDate);
    const diffMs = end - now;
    
    if (diffMs < 0) return 0;
    
    return Math.floor(diffMs / (1000 * 60 * 60));
  }
};

window.DateHelpers = DateHelpers;
