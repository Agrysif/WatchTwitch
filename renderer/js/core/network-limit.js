/**
 * NetworkLimit — потолок скорости загрузки стрима.
 *
 * Видео качается не ровным потоком, а кусками: каждые несколько секунд
 * плеер разом тянет очередной отрезок и на мгновение забивает канал.
 * Очередь в домашнем роутере распухает, и всё остальное — в первую
 * очередь игра — ждёт. Снаружи это выглядит как «пинг резко подрастает,
 * потом отпускает».
 *
 * Лечится не уменьшением объёма, а сглаживанием: если download ограничен
 * сверху, тот же отрезок скачивается дольше, но не вытесняет чужие
 * пакеты. Потолок считается от битрейта выбранного качества с запасом —
 * слишком тесный предел не даст плееру набрать буфер, он встанет, и
 * подбор качества полезет вверх, сделав только хуже.
 */
class NetworkLimit {
  /** Примерный битрейт качеств Twitch, кбит/с. */
  static get BITRATES() {
    return {
      '160p30': 230,
      '360p30': 600,
      '480p30': 1200,
      '720p60': 3500,
      'chunked': 6000
    };
  }

  /**
   * Во сколько раз потолок выше самого битрейта.
   *
   * Меньше двух — плеер не успевает набрать буфер на старте и застревает.
   * Больше пяти — сглаживание перестаёт работать, рывки возвращаются.
   */
  static get DEFAULT_HEADROOM() {
    return 3;
  }

  /** Ниже этого предела не опускаемся ни при каких настройках. */
  static get FLOOR_KBPS() {
    return 500;
  }

  /**
   * Потолок для выбранного качества, кбит/с.
   * Неизвестное качество считаем самым тяжёлым: лучше ограничить слабо,
   * чем задушить поток и получить зависший плеер.
   */
  static forQuality(quality, headroom = NetworkLimit.DEFAULT_HEADROOM) {
    const bitrate = NetworkLimit.BITRATES[quality] || NetworkLimit.BITRATES.chunked;
    const множитель = Number(headroom) > 0 ? Number(headroom) : NetworkLimit.DEFAULT_HEADROOM;

    return Math.max(NetworkLimit.FLOOR_KBPS, Math.round(bitrate * множитель));
  }

  /** Кбит/с в байты в секунду — в таком виде их ждёт отладчик Chromium. */
  static toBytesPerSecond(kbps) {
    return Math.round((Number(kbps) || 0) * 1000 / 8);
  }

  /**
   * Параметры для Network.emulateNetworkConditions.
   *
   * Задержку и отдачу не трогаем: нам нужно ограничить только скачивание.
   * uploadThroughput = -1 означает «без ограничения».
   */
  static conditions(quality, headroom) {
    return {
      offline: false,
      latency: 0,
      downloadThroughput: NetworkLimit.toBytesPerSecond(NetworkLimit.forQuality(quality, headroom)),
      uploadThroughput: -1
    };
  }

  /** Снятие ограничения. */
  static get UNLIMITED() {
    return {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    };
  }

  /** Понятное описание для настроек. */
  static describe(quality, headroom) {
    const kbps = NetworkLimit.forQuality(quality, headroom);
    const mbps = (kbps / 1000).toFixed(1).replace('.', ',');

    return `Потолок примерно ${mbps} Мбит/с при качестве ${quality || 'неизвестном'}`;
  }
}

if (typeof window !== 'undefined') {
  window.NetworkLimit = NetworkLimit;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NetworkLimit;
}
