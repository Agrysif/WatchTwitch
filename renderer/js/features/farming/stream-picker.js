/**
 * StreamPicker — чистая логика выбора стрима и сравнения названий игр.
 *
 * Вынесено из farming-page, где эти правила тонули среди пяти тысяч строк
 * работы с интерфейсом и почти не поддавались проверке. Здесь только
 * вычисления: ни запросов, ни обращений к хранилищу — их страница
 * по-прежнему делает сама и передаёт сюда готовые данные.
 *
 * Методы страницы остались на месте тонкими обёртками, поэтому места
 * вызова не менялись.
 */
class StreamPicker {
  /** Приводит название игры к сравнимому виду. */
  static normalizeGameName(name) {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      .replace(/^\s*(игра|game)\s*:\s*/i, '')
      .replace(/['`’']/g, '')
      .replace(/[^a-zа-я0-9]+/gi, ' ')
      .trim();
  }

  /**
   * Сравнение названий игр по словам.
   *
   * Сравнивать по подстроке нельзя: в «albion online» содержится «line»,
   * и приложение считало игры совпадающими. Совпадением считается только
   * то, что одно название — начало другого по целым словам.
   */
  static isSameGame(a, b) {
    const tokens = (value) => StreamPicker.normalizeGameName(value).split(' ').filter(Boolean);

    const left = tokens(a);
    const right = tokens(b);
    if (left.length === 0 || right.length === 0) return false;

    const isPrefix = (short, long) =>
      short.length <= long.length && short.every((t, i) => t === long[i]);

    return isPrefix(left, right) || isPrefix(right, left);
  }

  /** Логин без «собачки» и регистра. */
  static normalizeLogin(value) {
    return String(value || '').replace(/^@/, '').toLowerCase();
  }

  /**
   * Список стримов без исключённого канала.
   *
   * Исключение приходит от кнопки «Другой стрим». Если после отсева не
   * осталось ничего, возвращаем исходный список: лучше показать тот же
   * канал, чем не показать никакой.
   */
  static poolWithout(streams, exclude) {
    if (!Array.isArray(streams) || streams.length === 0) return [];

    const excluded = StreamPicker.normalizeLogin(exclude);
    if (!excluded) return streams;

    const pool = streams.filter(s => StreamPicker.normalizeLogin(s.login) !== excluded);
    return pool.length > 0 ? pool : streams;
  }

  /**
   * Подписки в порядке проверки: избранные впереди, внутри группы — по
   * заданному пользователем приоритету.
   */
  static orderSubscriptions(subscriptions, exclude) {
    const excluded = StreamPicker.normalizeLogin(exclude);

    return (subscriptions || [])
      .filter(sub => sub && StreamPicker.normalizeLogin(sub.login) !== excluded)
      .slice()
      .sort((a, b) => {
        if (!!a.isFavorite !== !!b.isFavorite) return a.isFavorite ? -1 : 1;
        return (a.priority ?? 9999) - (b.priority ?? 9999);
      });
  }

  /** Первый канал из списка подписок, попавший в выдачу Twitch. */
  static findInList(pool, subscriptions) {
    const known = new Set((subscriptions || []).map(s => StreamPicker.normalizeLogin(s.login)));
    return (pool || []).find(s => known.has(StreamPicker.normalizeLogin(s.login))) || null;
  }

  /** Приводит ответ о канале к виду, в котором приложение хранит стримы. */
  static toStream(subscription, stats) {
    return {
      login: subscription.login,
      displayName: subscription.displayName || subscription.login,
      title: stats?.title || '',
      viewers: stats?.viewers || 0,
      fromSubscription: true,
      isFavorite: !!subscription.isFavorite
    };
  }
}

if (typeof window !== 'undefined') {
  window.StreamPicker = StreamPicker;
}
