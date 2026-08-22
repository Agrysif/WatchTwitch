/**
 * Backup — перенос всего нажитого на другой компьютер.
 *
 * Экспорт был только у настроек, а самое ценное — список категорий с
 * порядком и закреплениями, подписки с приоритетами и накопленная
 * статистика — никуда не выгружалось. Собрать девяносто категорий заново
 * руками — работа на вечер.
 *
 * Аккаунты и токены в копию не попадают намеренно: это ключи от чужого
 * сервиса, и класть их в файл, который пойдёт по почте или в мессенджер,
 * нельзя. После переноса вход выполняется заново.
 */
class Backup {
  static get VERSION() {
    return 1;
  }

  /** Что именно переносим. */
  static get PARTS() {
    return ['categories', 'subscriptions', 'statistics', 'settings'];
  }

  /** Собирает копию. Время проставляет вызывающий — так удобнее проверять. */
  static async collect(stamp) {
    const [categories, subscriptions, statistics] = await Promise.all([
      Storage.getCategories().catch(() => []),
      Storage.getSubscriptions().catch(() => []),
      Storage.getStatistics().catch(() => null)
    ]);

    let settings = null;
    try {
      settings = window.settings?.export ? JSON.parse(window.settings.export()) : null;
    } catch (e) {
      console.warn('[Копия] Настройки прочитать не удалось:', e.message);
    }

    return {
      app: 'WatchTwitch',
      version: Backup.VERSION,
      createdAt: stamp,
      categories: categories || [],
      subscriptions: subscriptions || [],
      statistics: statistics || null,
      settings
    };
  }

  /**
   * Проверяет содержимое файла перед восстановлением.
   *
   * Файл приходит извне, поэтому доверять ему нельзя: чужой или битый
   * json не должен затирать рабочий список категорий.
   */
  static validate(data) {
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Файл не похож на копию' };
    }
    if (data.app !== 'WatchTwitch') {
      return { ok: false, error: 'Это копия не от WatchTwitch' };
    }
    if (!Number.isFinite(data.version) || data.version > Backup.VERSION) {
      return { ok: false, error: 'Копия от более новой версии приложения' };
    }
    if (!Array.isArray(data.categories) && !Array.isArray(data.subscriptions)) {
      return { ok: false, error: 'В копии нет ни категорий, ни подписок' };
    }

    return { ok: true };
  }

  /** Краткое описание копии — показать перед восстановлением. */
  static describe(data) {
    const parts = [];
    if (Array.isArray(data.categories)) parts.push(`категорий: ${data.categories.length}`);
    if (Array.isArray(data.subscriptions)) parts.push(`подписок: ${data.subscriptions.length}`);
    if (data.statistics) parts.push('статистика');
    if (data.settings) parts.push('настройки');
    return parts.join(', ') || 'пусто';
  }

  /**
   * Восстанавливает копию.
   *
   * Разделы применяются по отдельности: если статистика битая, категории
   * всё равно должны встать на место.
   */
  static async restore(data) {
    const check = Backup.validate(data);
    if (!check.ok) throw new Error(check.error);

    const applied = [];

    if (Array.isArray(data.categories)) {
      await Storage.saveCategories(data.categories);
      applied.push('категории');
    }
    if (Array.isArray(data.subscriptions)) {
      await Storage.saveSubscriptions(data.subscriptions);
      applied.push('подписки');
    }
    if (data.statistics) {
      await Storage.set('statistics', data.statistics);
      applied.push('статистика');
    }
    if (data.settings && window.settings?.import) {
      window.settings.import(JSON.stringify(data.settings));
      applied.push('настройки');
    }

    return applied;
  }
}

if (typeof window !== 'undefined') {
  window.Backup = Backup;
}
