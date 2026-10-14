// Title Manager - управление заголовком окна
//
// Раньше здесь же жил таймер, который каждые 30 секунд «показывал прогресс
// дропсов и фарминга» в заголовке. Он опирался на window.DropsManager и
// streamingManager.currentChannel, а их в приложении нет (первый нигде не
// объявлен, второй никогда не заполняется), поэтому таймер всю жизнь окна
// ставил один и тот же заголовок «WatchTwitch». Таймер и зависящие от
// несуществующих источников методы удалены: заголовок задаёт index.html,
// а явная смена остаётся через update().
class TitleManager {
  constructor() {
    this.baseTitle = 'WatchTwitch';
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
}

// Экспорт синглтона
window.TitleManager = window.TitleManager || new TitleManager();
