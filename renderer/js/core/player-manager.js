/**
 * PlayerManager — единственный на всё приложение webview с Twitch-плеером.
 *
 * Зачем: раньше плееров было три (внутри страницы фарминга, скрытый фоновый и
 * мини-плеер в сайдбаре), и при каждом переходе между страницами поток
 * копировался из одного в другой через присваивание .src. Любое присваивание
 * .src — это полная перезагрузка webview, поэтому стрим останавливался и
 * стартовал заново, а накопленные Twitch минуты просмотра сбрасывались.
 *
 * Механика позиционирования вынесена в SlottedWebview: плеер создаётся один раз,
 * живёт в <body> и никогда не переезжает по DOM — меняются только его координаты.
 */
class PlayerManager extends SlottedWebview {
  constructor() {
    super({
      logName: 'PlayerManager',
      hostId: 'persistent-player-host',
      webviewId: 'twitch-player',
      zIndex: 5,
      attributes: {
        partition: 'persist:twitch',
        allowpopups: 'false',
        disablewebsecurity: '',
        webpreferences: 'contextIsolation=false'
      }
    });

    this.channel = null; // текущий канал, чтобы не перезагружать плеер зря
  }

  static get() {
    if (!window._playerManager) {
      window._playerManager = new PlayerManager();
    }
    return window._playerManager;
  }

  hasStream() {
    return !!(this.webview && this.webview.src);
  }

  getChannel() {
    return this.channel;
  }

  /**
   * Загружает канал. Если канал тот же — ничего не делает,
   * иначе стрим перезапустился бы впустую.
   */
  load(channelLogin, options = {}) {
    if (!channelLogin) return;

    const login = String(channelLogin).replace(/^@/, '').toLowerCase();
    const webview = this.ensure();

    if (this.channel === login && webview.src) {
      console.log('[PlayerManager] Канал не изменился, перезагрузка не нужна:', login);
      return;
    }

    const quality = options.quality || '160p30';
    // controls=false убирает панель управления и наложенную поверх видео
    // подпись с названием стрима — для фонового просмотра они не нужны.
    const url = `https://player.twitch.tv/?channel=${login}&parent=localhost&muted=true&autoplay=true&controls=false&quality=${quality}`;

    console.log('[PlayerManager] Загружаю канал:', login);
    this.channel = login;
    webview.src = url;
  }

  /** Полная остановка: используется только при реальном завершении фарминга. */
  unload() {
    if (!this.webview) return;
    console.log('[PlayerManager] Останавливаю плеер');
    this.channel = null;
    try {
      this.webview.src = '';
    } catch (e) {
      console.warn('[PlayerManager] Не удалось очистить src:', e.message);
    }
    this.detach();
  }
}

window.PlayerManager = PlayerManager;
window.playerManager = PlayerManager.get();
