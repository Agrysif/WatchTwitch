/**
 * FavouritesWatch — следит, когда избранный канал выходит в эфир.
 *
 * Приложение и так знает список подписок с отметкой «избранное» и умеет
 * спрашивать у Twitch состояние канала, но пользовался этим только выбор
 * стрима во время фарминга. Здесь то же самое работает постоянно: если
 * любимый стример начал трансляцию — приложение скажет об этом, а если
 * по его игре идут дропсы, скажет и это.
 *
 * Про один и тот же эфир сообщается однажды: повторное уведомление
 * каждые несколько минут раздражало бы сильнее, чем помогало.
 */
class FavouritesWatch {
  constructor() {
    this.interval = null;
    this.live = new Set();
    this.checking = false;
  }

  static get() {
    if (!window._favouritesWatch) {
      window._favouritesWatch = new FavouritesWatch();
    }
    return window._favouritesWatch;
  }

  /** Как часто спрашивать Twitch. */
  static get PERIOD_MS() {
    return 5 * 60 * 1000;
  }

  /** Сколько избранных каналов проверяем за раз. */
  static get MAX_CHANNELS() {
    return 15;
  }

  start() {
    if (this.interval) return;

    this.interval = setInterval(() => this.check(), FavouritesWatch.PERIOD_MS);

    // Первый проход с задержкой: на старте приложение и так занято
    setTimeout(() => this.check(), 30000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.live.clear();
  }

  /**
   * Решает, о ком нужно сказать.
   *
   * Вынесено отдельно от запросов, чтобы правило «сообщаем один раз за
   * эфир» можно было проверить без Twitch: сообщаем о тех, кто в эфире
   * сейчас и кого не было в эфире на прошлой проверке.
   */
  static pickNewlyLive(current, previouslyLive) {
    const now = new Set((current || []).map(c => String(c.login).toLowerCase()));
    const fresh = (current || []).filter(c => !previouslyLive.has(String(c.login).toLowerCase()));
    return { fresh, live: now };
  }

  async check() {
    if (this.checking) return;
    if (window.settings?.get('notifyFavouriteLive') === false) return;
    if (!window.electronAPI?.getStreamStats) return;

    this.checking = true;
    try {
      const subscriptions = (await Storage.getSubscriptions()) || [];
      const favourites = subscriptions
        .filter(s => s.isFavorite && s.login)
        .slice(0, FavouritesWatch.MAX_CHANNELS);

      if (favourites.length === 0) return;

      const states = await Promise.all(favourites.map(async (sub) => {
        try {
          const stats = await window.electronAPI.getStreamStats(sub.login);
          if (!stats || !stats.gameName) return null;
          return {
            login: sub.login,
            displayName: sub.displayName || sub.login,
            game: stats.gameName,
            viewers: stats.viewers || 0
          };
        } catch (e) {
          return null;
        }
      }));

      const current = states.filter(Boolean);
      const { fresh, live } = FavouritesWatch.pickNewlyLive(current, this.live);
      this.live = live;

      for (const channel of fresh) {
        await this.announce(channel);
      }
    } catch (error) {
      console.warn('[Избранное] Проверка не удалась:', error?.message);
    } finally {
      this.checking = false;
    }
  }

  /** Сообщает о вышедшем канале, отдельно отмечая дропсы по его игре. */
  async announce(channel) {
    let withDrops = false;
    try {
      withDrops = !!(await window.electronAPI.checkCategoryDrops?.(channel.game));
    } catch (e) {
      // без этой подробности уведомление всё равно имеет смысл
    }

    const body = withDrops
      ? `${channel.game} — по этой игре идут дропсы`
      : channel.game;

    console.log('[Избранное] В эфире:', channel.displayName, '|', body);

    window.notifyFarmingEvent?.(`${channel.displayName} в эфире`, body);
    window.utils?.showToast(`${channel.displayName} в эфире: ${body}`, withDrops ? 'success' : 'info');
  }
}

if (typeof window !== 'undefined') {
  window.FavouritesWatch = FavouritesWatch;
  window.favouritesWatch = FavouritesWatch.get();
}
