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

  /**
   * Служебные поля настроек, которые не переносятся.
   *
   * lastSeenVersion из старой копии показывал ложное «Приложение обновлено»,
   * qualityRepaired повторно запускал разовую починку качества, а autostart
   * отражает то, что записано в Windows на этом компьютере, а не выбор из
   * копии.
   */
  static get SERVICE_SETTINGS() {
    return ['lastSeenVersion', 'qualityRepaired', 'autostart'];
  }

  /** Настройки без служебных полей или null, если это не объект. */
  static cleanSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
    const rest = { ...settings };
    for (const key of Backup.SERVICE_SETTINGS) delete rest[key];
    return rest;
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
      settings: Backup.cleanSettings(settings)
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

  /**
   * Оставляет в копии только записи правильной формы.
   *
   * validate() проверяет лишь, что файл вообще копия WatchTwitch. Но его
   * могли поправить руками, обрезать или собрать старой версией: один null
   * в списке категорий ронял фарминг при старте, а текущие данные к тому
   * моменту были уже перезаписаны. Мусор отбрасываем и считаем, чтобы
   * сказать об этом перед восстановлением.
   *
   * Раздел, в котором не уцелело ни одной записи, считается отсутствующим:
   * иначе битый список молча стёр бы рабочий.
   */
  static sanitize(data) {
    const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const isId = (v) => (typeof v === 'string' && v.trim() !== '') || Number.isFinite(v);
    // Имена попадают в разметку страниц, поэтому угловые скобки не пускаем
    const isName = (v) => typeof v === 'string' && v.trim() !== '' && !/[<>]/.test(v);
    const count = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

    const dropped = { categories: 0, subscriptions: 0, sessions: 0 };

    const pick = (list, ok, key) => {
      if (!Array.isArray(list)) return null;
      const kept = list.filter(ok);
      dropped[key] = list.length - kept.length;
      return list.length > 0 && kept.length === 0 ? null : kept;
    };

    const categories = pick(data?.categories,
      (c) => isObject(c) && isId(c.id) && isName(c.name), 'categories');

    // У подписки нет name: канал определяют id и login, а displayName
    // показывается на странице подписок
    const subscriptions = pick(data?.subscriptions,
      (s) => isObject(s) && isId(s.id) &&
        typeof s.login === 'string' && /^[a-z0-9_]+$/i.test(s.login) &&
        (s.displayName == null || isName(s.displayName)), 'subscriptions');

    let statistics = null;
    if (isObject(data?.statistics)) {
      const raw = Array.isArray(data.statistics.sessions) ? data.statistics.sessions : [];
      const sessions = raw
        .filter((s) => isObject(s) && Number.isFinite(s.timestamp) && Number.isFinite(s.duration))
        // Сессия из копии уже не идёт. Активной её оставлять нельзя:
        // текущий фарминг дописывал бы свои минуты в чужую запись
        .map((s) => (s.isActive ? { ...s, isActive: false } : s));
      dropped.sessions = raw.length - sessions.length;

      statistics = {
        ...data.statistics,
        totalWatchTime: count(data.statistics.totalWatchTime),
        totalDrops: count(data.statistics.totalDrops),
        categoriesCompleted: count(data.statistics.categoriesCompleted),
        sessions
      };
    }

    return {
      categories,
      subscriptions,
      statistics,
      settings: Backup.cleanSettings(data?.settings),
      dropped
    };
  }

  /** Сколько записей отброшено при проверке, по-человечески; '' если ни одной. */
  static describeDropped(dropped) {
    if (!dropped) return '';
    const parts = [];
    if (dropped.categories > 0) parts.push(`категорий: ${dropped.categories}`);
    if (dropped.subscriptions > 0) parts.push(`подписок: ${dropped.subscriptions}`);
    if (dropped.sessions > 0) parts.push(`сессий статистики: ${dropped.sessions}`);
    return parts.join(', ');
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

    const clean = Backup.sanitize(data);

    // Текущие данные откладываем перед перезаписью: если копия окажется
    // не той, к ним можно вернуться. Без этого отката не было вовсе, поэтому
    // при неудаче не восстанавливаем
    try {
      const before = await Backup.collect(new Date().toISOString());
      await Storage.set('backupBeforeRestore', before);
    } catch (error) {
      console.error('[Копия] Не удалось отложить текущие данные:', error);
      throw new Error('Не удалось сохранить текущие данные перед восстановлением');
    }

    const applied = [];

    if (clean.categories) {
      await Storage.saveCategories(clean.categories);
      applied.push('категории');

      // Фарминг держит список категорий в памяти и при следующем сохранении
      // затёр бы восстановленные своим — просим его перечитать хранилище
      window.dispatchEvent(new CustomEvent('wt:categories-changed'));
    }
    if (clean.subscriptions) {
      await Storage.saveSubscriptions(clean.subscriptions);
      applied.push('подписки');
    }
    if (clean.statistics) {
      await Storage.set('statistics', clean.statistics);
      window.dispatchEvent(new CustomEvent('statistics-updated'));
      applied.push('статистика');
    }
    if (clean.settings && window.settings?.import) {
      if (window.settings.import(JSON.stringify(clean.settings))) {
        applied.push('настройки');
      }
    }

    return applied;
  }
}

if (typeof window !== 'undefined') {
  window.Backup = Backup;
}
