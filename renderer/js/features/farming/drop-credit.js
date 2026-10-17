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
   * Сколько минуты в инвентаре могут стоять после прогрева, прежде чем
   * решить «не засчитывает» без ответа о сессии. Twitch обновляет минуты раз
   * в минуту; десять минут без единой — это не задержка
   */
  static get STALE_LIMIT_MS() {
    return 10 * 60 * 1000;
  }

  /**
   * Вердикт по накопленным выборкам.
   *
   * samples — [{ at, session }] по времени; session = null, когда Twitch
   * ничего не засчитывает. startedAt — когда включили этот канал.
   * staleForMs — сколько минуты в инвентаре не растут; hasWatchable — есть
   * ли у игры награды, которые ещё можно получить просмотром.
   *
   *   'ok'      — зачёт идёт на нашем канале;
   *   'waiting' — рано судить: прогрев или мало выборок;
   *   'none'    — за прогревом подряд нет зачёта — канал не подходит;
   *   'idle'    — наград за просмотр не осталось, ждать зачёт не от чего.
   *
   * reason всегда по-русски: его сверяют describe() и тесты, он же идёт в
   * лог. Для подсказки в интерфейсе — explain(), на языке приложения.
   */
  static evaluate({ startedAt, login, samples = [], now = Date.now(), progressGrew = false, progressStale = true, staleForMs = 0, hasWatchable = true }) {
    // Минуты в инвентаре растут — зачёт есть, что бы ни ответил запрос о
    // сессии. Это страховка от ложного «не засчитывает».
    if (progressGrew) return { state: 'ok', reason: 'минуты просмотра растут', minutes: 0, required: 0 }; // i18n-ignore

    // Наград за просмотр у игры не осталось — зачёт ждать не от чего
    if (!hasWatchable) return { state: 'idle', reason: 'награды за просмотр собраны' }; // i18n-ignore

    const warmedUp = now - (startedAt || now) >= DropCredit.WARMUP_MS;

    // Запрос о сессии может не отвечать часами. Тогда решают минуты:
    // после прогрева они стоят десять минут подряд — канал не засчитывает.
    // Перебить это может только свежий ответ о сессии с нашим каналом:
    // давний (до того, как запрос начал падать) держал бы «зачёт идёт»
    // до утра, хотя минуты давно стоят
    if (warmedUp && staleForMs >= DropCredit.STALE_LIMIT_MS) {
      const latestSession = samples[samples.length - 1];
      const fresh = !!latestSession && now - latestSession.at <= DropCredit.WARMUP_MS + 60000;
      if (!fresh || !DropCredit.matchesChannel(latestSession.session, login)) {
        const staleMinutes = Math.round(staleForMs / 60000);
        return { state: 'none', reason: 'минуты не растут ' + staleMinutes + ' мин', staleMinutes }; // i18n-ignore
      }
    }

    const latest = samples[samples.length - 1];
    if (!latest) return { state: 'waiting', reason: 'жду первого ответа Twitch' }; // i18n-ignore

    if (DropCredit.matchesChannel(latest.session, login)) {
      return {
        state: 'ok',
        reason: 'зачёт идёт', // i18n-ignore
        minutes: Number(latest.session.currentMinutesWatched) || 0,
        required: Number(latest.session.requiredMinutesWatched) || 0
      };
    }

    if (now - (startedAt || now) < DropCredit.WARMUP_MS) {
      return { state: 'waiting', reason: 'Twitch ещё не отчитался о зачёте' }; // i18n-ignore
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
          ? 'зачёт идёт на другом канале: ' + elsewhere // i18n-ignore
          : 'канал не засчитывает дропсы', // i18n-ignore
        elsewhere: elsewhere || ''
      };
    }

    if (misses >= DropCredit.STRIKES_TO_LEAVE) {
      return { state: 'waiting', reason: 'сессия пуста, но минуты ещё могут идти — жду инвентарь' }; // i18n-ignore
    }

    return { state: 'waiting', reason: 'жду подтверждения зачёта' }; // i18n-ignore
  }

  /** Пояснение вердикта (reason) на языке интерфейса — для подсказки индикатора. */
  static explain(verdict) {
    const reason = verdict?.reason || '';
    if (!reason) return '';
    if (verdict.staleMinutes != null) return tr('минуты не растут {minutes} мин', { minutes: verdict.staleMinutes });
    if (verdict.elsewhere) return tr('зачёт идёт на другом канале: {channel}', { channel: verdict.elsewhere });
    const texts = {
      'минуты просмотра растут': tr('минуты просмотра растут'), // i18n-ignore
      'награды за просмотр собраны': tr('награды за просмотр собраны'), // i18n-ignore
      'жду первого ответа Twitch': tr('жду первого ответа Twitch'), // i18n-ignore
      'зачёт идёт': tr('зачёт идёт'), // i18n-ignore
      'Twitch ещё не отчитался о зачёте': tr('Twitch ещё не отчитался о зачёте'), // i18n-ignore
      'канал не засчитывает дропсы': tr('канал не засчитывает дропсы'), // i18n-ignore
      'сессия пуста, но минуты ещё могут идти — жду инвентарь': tr('сессия пуста, но минуты ещё могут идти — жду инвентарь'), // i18n-ignore
      'жду подтверждения зачёта': tr('жду подтверждения зачёта') // i18n-ignore
    };
    return Object.prototype.hasOwnProperty.call(texts, reason) ? texts[reason] : reason;
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
    if (!verdict) return tr('Жду зачёт от Twitch');
    if (verdict.state === 'ok') {
      if (!verdict.required && verdict.reason === 'минуты просмотра растут') return tr('Зачёт идёт: минуты растут'); // i18n-ignore
      return verdict.required > 0
        ? tr('Зачёт идёт: {minutes} из {required} мин', { minutes: verdict.minutes, required: verdict.required })
        : tr('Зачёт идёт');
    }
    if (verdict.state === 'none') return tr('Не засчитывается');
    if (verdict.state === 'idle') return tr('Награды за просмотр собраны');
    return tr('Жду зачёт от Twitch');
  }
}

if (typeof window !== 'undefined') {
  window.DropCredit = DropCredit;
}
