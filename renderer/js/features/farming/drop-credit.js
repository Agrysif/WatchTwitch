/**
 * DropCredit — засчитывает ли Twitch просмотр на этом канале.
 *
 * До сих пор приложение узнавало о зачёте только косвенно: раз в минуту
 * перечитывало инвентарь и смотрело, выросли ли минуты. Если стример не
 * входит в список разрешённых каналов кампании или Twitch по своим
 * причинам не ведёт зачёт, минуты не росли часами, а приложение считало,
 * что «фармит». У Twitch есть прямой ответ на этот вопрос —
 * dropCurrentSession: какой канал сейчас засчитывается и сколько минут
 * набрано. Здесь этот ответ превращается в вердикт для сайдбара и в
 * решение «менять ли стрим».
 *
 * Чистые функции: без DOM и сети, чтобы их можно было проверить тестами.
 */
class DropCredit {
  /** Первые минуты после запуска Twitch ещё не отчитывается — это не отказ. */
  static get WARMUP_MS() {
    return 4 * 60 * 1000;
  }

  /** Сколько подряд выборок без зачёта нужно, чтобы вынести приговор. */
  static get STRIKES_TO_LEAVE() {
    return 2;
  }

  static normalizeLogin(value) {
    return String(value || '').replace(/^@/, '').trim().toLowerCase();
  }

  /** Сессия зачёта относится к этому каналу. */
  static matchesChannel(session, login) {
    const channel = session?.channel?.name || session?.channel?.login || '';
    if (!channel) return false;
    return DropCredit.normalizeLogin(channel) === DropCredit.normalizeLogin(login);
  }

  /**
   * Вердикт по накопленным выборкам.
   *
   * samples — [{ at, session }] по времени; session = null, когда Twitch
   * ничего не засчитывает. startedAt — когда включили этот канал.
   *
   *   'ok'      — зачёт идёт на нашем канале;
   *   'waiting' — рано судить: прогрев или мало выборок;
   *   'none'    — за прогревом подряд нет зачёта — канал не подходит.
   */
  static evaluate({ startedAt, login, samples = [], now = Date.now(), progressGrew = false, progressStale = true }) {
    // Минуты в инвентаре растут — зачёт есть, что бы ни ответил запрос о
    // сессии. Это страховка от ложного «не засчитывает».
    if (progressGrew) return { state: 'ok', reason: 'минуты просмотра растут', minutes: 0, required: 0 };

    const latest = samples[samples.length - 1];
    if (!latest) return { state: 'waiting', reason: 'жду первого ответа Twitch' };

    if (DropCredit.matchesChannel(latest.session, login)) {
      return {
        state: 'ok',
        reason: 'зачёт идёт',
        minutes: Number(latest.session.currentMinutesWatched) || 0,
        required: Number(latest.session.requiredMinutesWatched) || 0
      };
    }

    if (now - (startedAt || now) < DropCredit.WARMUP_MS) {
      return { state: 'waiting', reason: 'Twitch ещё не отчитался о зачёте' };
    }

    // После прогрева считаем только свежие выборки: старые могли относиться
    // к прошлому каналу
    const recent = samples.filter(s => now - s.at <= DropCredit.WARMUP_MS + 60000);
    const misses = recent.filter(s => !DropCredit.matchesChannel(s.session, login)).length;

    // Приговор требует двух независимых признаков: сессия пуста И минуты в
    // инвентаре не растут. Запрос о сессии у Twitch ненадёжен (замер: null
    // и «service unavailable» при идущем зачёте), одного его мало.
    if (misses >= DropCredit.STRIKES_TO_LEAVE && progressStale) {
      const elsewhere = latest.session?.channel?.name || latest.session?.channel?.login;
      return {
        state: 'none',
        reason: elsewhere
          ? 'зачёт идёт на другом канале: ' + elsewhere
          : 'канал не засчитывает дропсы'
      };
    }

    if (misses >= DropCredit.STRIKES_TO_LEAVE) {
      return { state: 'waiting', reason: 'сессия пуста, но минуты ещё могут идти — жду инвентарь' };
    }

    return { state: 'waiting', reason: 'жду подтверждения зачёта' };
  }

  /**
   * Каналы, на которых кампании игры вообще засчитываются.
   *
   * Пустой список означает «любой канал категории»: достаточно одной
   * кампании без ограничений, чтобы ограничения остальных не имели
   * значения — смотреть можно где угодно.
   */
  static allowedLogins(campaigns) {
    const list = campaigns || [];
    if (!list.length) return [];

    const set = new Set();
    for (const campaign of list) {
      const allowed = Array.isArray(campaign?.allowedChannels) ? campaign.allowedChannels : [];
      if (!allowed.length) return [];
      allowed.forEach(login => {
        const normalized = DropCredit.normalizeLogin(login);
        if (normalized) set.add(normalized);
      });
    }
    return [...set];
  }

  /** Оставляет из стримов только разрешённые. Без ограничений — все. */
  static filterAllowed(streams, allowed) {
    const pool = Array.isArray(streams) ? streams : [];
    if (!Array.isArray(allowed) || allowed.length === 0) return pool;

    const set = new Set(allowed.map(DropCredit.normalizeLogin));
    return pool.filter(stream => set.has(DropCredit.normalizeLogin(stream?.login)));
  }

  /** Короткая подпись для индикатора в сайдбаре. */
  static describe(verdict) {
    if (!verdict) return 'Жду зачёт от Twitch';
    if (verdict.state === 'ok') {
      if (!verdict.required && verdict.reason === 'минуты просмотра растут') return 'Зачёт идёт: минуты растут';
      return verdict.required > 0
        ? `Зачёт идёт: ${verdict.minutes} из ${verdict.required} мин`
        : 'Зачёт идёт';
    }
    if (verdict.state === 'none') return 'Не засчитывается';
    return 'Жду зачёт от Twitch';
  }
}

if (typeof window !== 'undefined') {
  window.DropCredit = DropCredit;
}
