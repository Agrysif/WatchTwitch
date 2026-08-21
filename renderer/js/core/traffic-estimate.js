/**
 * TrafficEstimate — во что обошёлся бы просмотр в другом качестве.
 *
 * Приложение намеренно смотрит в самом низком качестве: картинка никому
 * не нужна, а трафик расходуется настоящий. Сколько именно это сберегло,
 * до сих пор нигде не было видно, хотя и расход, и качество измеряются.
 *
 * Оценка приблизительная и честно названа оценкой: битрейт у Twitch
 * плавает, зависит от канала и сцены. Сравнение всегда идёт с конкретным
 * качеством, а не с абстрактным «обычным просмотром».
 */
class TrafficEstimate {
  /** Примерный расход в байтах за минуту для качеств Twitch. */
  static get BYTES_PER_MINUTE() {
    return {
      '160p30': 230 * 1000 / 8 * 60,
      '360p30': 600 * 1000 / 8 * 60,
      '480p30': 1200 * 1000 / 8 * 60,
      '720p60': 3500 * 1000 / 8 * 60,
      'chunked': 6000 * 1000 / 8 * 60
    };
  }

  /** Качество, с которым сравниваем: то, что Twitch включает сам. */
  static get BASELINE() {
    return '720p60';
  }

  static get BASELINE_LABEL() {
    return '720p60';
  }

  /**
   * Сколько байт ушло бы за `minutes` минут в указанном качестве.
   * Неизвестное качество даёт null — выдумывать число не нужно.
   */
  static wouldCost(minutes, quality = TrafficEstimate.BASELINE) {
    const rate = TrafficEstimate.BYTES_PER_MINUTE[quality];
    if (!rate || !(minutes > 0)) return null;
    return rate * minutes;
  }

  /**
   * Сколько сэкономлено по сравнению с базовым качеством.
   *
   * Возвращает null, когда сравнивать не с чем или экономии нет:
   * показывать «сэкономлено 0» или отрицательное число незачем.
   */
  static saved(actualBytes, minutes, baseline = TrafficEstimate.BASELINE) {
    const would = TrafficEstimate.wouldCost(minutes, baseline);
    if (would === null) return null;

    const actual = Number(actualBytes) || 0;
    const diff = would - actual;

    return diff > 0 ? diff : null;
  }

  /** Во сколько раз просмотр вышел экономнее базового качества. */
  static ratio(actualBytes, minutes, baseline = TrafficEstimate.BASELINE) {
    const would = TrafficEstimate.wouldCost(minutes, baseline);
    const actual = Number(actualBytes) || 0;
    if (would === null || actual <= 0) return null;

    return would / actual;
  }
}

if (typeof window !== 'undefined') {
  window.TrafficEstimate = TrafficEstimate;
}
