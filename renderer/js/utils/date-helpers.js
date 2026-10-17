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

    if (diffSecs < 60) return tr('только что');
    if (diffMins < 60) return tr('{n} мин назад', { n: diffMins });
    if (diffHours < 24) return tr('{n} ч назад', { n: diffHours });
    if (diffDays < 7) return tr('{n} дн назад', { n: diffDays });
    if (diffDays < 30) return tr('{n} нед назад', { n: Math.floor(diffDays / 7) });
    if (diffDays < 365) return tr('{n} мес назад', { n: Math.floor(diffDays / 30) });
    return tr('{n} г назад', { n: Math.floor(diffDays / 365) });
  },

  /**
   * Форматировать оставшееся время
   */
  timeRemaining(endDate) {
    if (!endDate) return '';
    
    const now = new Date();
    const end = new Date(endDate);
    const diffMs = end - now;
    
    if (diffMs < 0) return tr('Завершена');
    
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return tr('{d}д {h}ч', { d: diffDays, h: diffHours % 24 });
    if (diffHours > 0) return tr('{h}ч {m}м', { h: diffHours, m: diffMins % 60 });
    if (diffMins > 0) return tr('{m}м', { m: diffMins });
    return tr('меньше минуты');
  },

  /**
   * Форматировать длительность в минутах
   */
  formatDuration(minutes) {
    if (!minutes || minutes < 0) return tr('{m}м', { m: 0 });
    
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    
    if (hours > 0) {
      return mins > 0 ? tr('{h}ч {m}м', { h: hours, m: mins }) : tr('{h}ч', { h: hours });
    }
    return tr('{m}м', { m: mins });
  },

  /**
   * Форматировать дату в читаемый формат
   */
  formatDate(date, includeTime = false) {
    if (!date) return '';
    
    const d = new Date(date);
    // «ДД.ММ.ГГГГ» — русский порядок; в английском дату пишет Intl
    if (tr.lang() === 'en') {
      const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
      if (includeTime) Object.assign(options, { hour: 'numeric', minute: '2-digit' });
      return d.toLocaleString(tr.locale(), options);
    }
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
