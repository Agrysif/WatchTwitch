/**
 * TwitchRateLimit — пауза после ответа 429 «слишком много запросов».
 *
 * Twitch отвечает 429, когда клиент слишком назойлив. Раньше приложение на
 * это никак не реагировало: повторяло запрос через полторы секунды и
 * получало 429 снова, а все остальные опросы продолжали стучать по
 * расписанию. Здесь один общий счётчик: после 429 все запросы ждут, пока
 * пауза не пройдёт, и каждая следующая подряд удваивает её.
 *
 * Чистая логика без сети — чтобы её можно было проверить тестами.
 */
class TwitchRateLimit {
  /** Пауза после первого 429, если Twitch не назвал свою. */
  static get BASE_MS() {
    return 30 * 1000;
  }

  /** Дольше этого не ждём даже после серии отказов. */
  static get MAX_MS() {
    return 10 * 60 * 1000;
  }

  constructor() {
    this.until = 0;
    this.strikes = 0;
  }

  /** Сколько ещё ждать, мс. Ноль — можно слать. */
  remainingMs(now = Date.now()) {
    return Math.max(0, this.until - now);
  }

  isLimited(now = Date.now()) {
    return this.remainingMs(now) > 0;
  }

  /**
   * Учитывает ответ сервера.
   *
   * 429 — пауза: из заголовка Retry-After (секунды), иначе 30 с, 60 с,
   * 2 мин… до десяти минут. Любой другой ответ сбрасывает серию.
   * Возвращает длину назначенной паузы в мс (0, если паузы нет).
   */
  noteResponse(statusCode, headers = {}, now = Date.now()) {
    if (Number(statusCode) !== 429) {
      if (Number(statusCode) >= 200 && Number(statusCode) < 500) this.strikes = 0;
      return 0;
    }

    this.strikes += 1;

    const header = headers && (headers['retry-after'] || headers['Retry-After']);
    const fromHeader = Number(header) * 1000;
    const backoff = Math.min(TwitchRateLimit.MAX_MS, TwitchRateLimit.BASE_MS * Math.pow(2, this.strikes - 1));
    const pause = Number.isFinite(fromHeader) && fromHeader > 0 ? Math.min(TwitchRateLimit.MAX_MS, fromHeader) : backoff;

    this.until = Math.max(this.until, now + pause);
    return pause;
  }

  /** Короткое пояснение для лога. */
  describe(now = Date.now()) {
    const sec = Math.ceil(this.remainingMs(now) / 1000);
    return sec > 0 ? 'Twitch просит подождать ещё ' + sec + ' с' : 'ограничений нет';
  }
}

if (typeof window !== 'undefined') {
  window.TwitchRateLimit = TwitchRateLimit;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TwitchRateLimit;
}
