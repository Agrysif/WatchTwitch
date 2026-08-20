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
    this.watchdog = null;
    this.lastPlaybackTime = null;
    this.stallStrikes = 0;
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

    // Качество берём из настроек: это прямой рычаг расхода трафика.
    // Раньше значение было прибито в коде, а настройка в интерфейсе
    // отсутствовала вовсе.
    const quality = options.quality
      || window.settings?.get('preferredStreamQuality')
      || '160p30';
    // controls=false убирает панель управления и наложенную поверх видео
    // подпись с названием стрима — для фонового просмотра они не нужны.
    const url = `https://player.twitch.tv/?channel=${login}&parent=localhost&muted=true&autoplay=true&controls=false&quality=${quality}`;

    console.log('[PlayerManager] Загружаю канал:', login);
    this.channel = login;
    this.lastPlaybackTime = null;
    this.stallStrikes = 0;
    webview.src = url;

    this.startWatchdog();
  }

  /**
   * Сторож воспроизведения.
   *
   * Плеер Twitch умеет вставать намертво: показывает «Произошла ошибка сети
   * (Ошибка #2000)» с кнопкой перезагрузки или просто замирает. При фоновом
   * просмотре этого никто не видит и не нажимает, а фарминг тем временем
   * стоит. Единственным способом вернуть картинку был перезапуск приложения.
   *
   * Раз в 30 секунд смотрим, двигается ли currentTime у видео. Если нет —
   * чиним по нарастающей: клик по кнопке перезагрузки, затем перезагрузка
   * webview, затем переустановка адреса.
   */
  startWatchdog() {
    if (this.watchdog) return;

    this.watchdog = setInterval(() => this.checkPlayback(), 30000);
    console.log('[PlayerManager] Сторож воспроизведения запущен');
  }

  stopWatchdog() {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.lastPlaybackTime = null;
    this.stallStrikes = 0;
  }

  async checkPlayback() {
    if (!this.webview || !this.channel || !this.webview.src) return;

    let state;
    try {
      state = await this.webview.executeJavaScript(`
        (function () {
          const video = document.querySelector('video');
          const text = document.body ? document.body.innerText || '' : '';
          const hasError = /Ошибка\s*#?\d+|Error\s*#?\d+|ошибка сети|network error/i.test(text);
          return {
            hasVideo: !!video,
            time: video ? video.currentTime : 0,
            paused: video ? video.paused : true,
            hasError: hasError
          };
        })();
      `);
    } catch (e) {
      // Документ ещё не готов — не повод паниковать
      return;
    }

    if (!state) return;

    const advanced = this.lastPlaybackTime !== null && state.time > this.lastPlaybackTime + 0.5;
    const stalled = state.hasError || !state.hasVideo || (!advanced && this.lastPlaybackTime !== null);

    this.lastPlaybackTime = state.time;

    if (!stalled) {
      if (this.stallStrikes > 0) {
        console.log('[PlayerManager] Воспроизведение восстановилось');
      }
      this.stallStrikes = 0;
      return;
    }

    this.stallStrikes += 1;
    console.warn('[PlayerManager] Плеер стоит (попытка ' + this.stallStrikes + '), ошибка на странице:', state.hasError);

    if (this.stallStrikes === 1) {
      await this.nudgePlayer();
    } else if (this.stallStrikes === 2) {
      console.warn('[PlayerManager] Перезагружаю webview');
      try { this.webview.reload(); } catch (e) { /* ignore */ }
    } else {
      console.warn('[PlayerManager] Переустанавливаю адрес плеера');
      const channel = this.channel;
      this.channel = null;
      this.load(channel);
      this.stallStrikes = 0;
      window.utils?.showToast('Плеер перезапущен автоматически', 'info');
    }
  }

  /** Мягкая попытка: нажать кнопку перезагрузки Twitch или запустить видео. */
  async nudgePlayer() {
    try {
      await this.webview.executeJavaScript(`
        (function () {
          const selectors = [
            'button[data-a-target="player-overlay-refresh-button"]',
            'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
            '[data-a-target="player-overlay-click-handler"] button',
            'button'
          ];
          for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
              const label = (node.innerText || '') + ' ' + (node.getAttribute('aria-label') || '');
              if (/перезагрузить|reload|refresh|начать просмотр|start watching/i.test(label)) {
                node.click();
                return 'clicked';
              }
            }
          }
          const video = document.querySelector('video');
          if (video && video.paused) { video.play().catch(function () {}); return 'played'; }
          return 'nothing';
        })();
      `);
    } catch (e) {
      // ignore
    }
  }

  /** Полная остановка: используется только при реальном завершении фарминга. */
  unload() {
    if (!this.webview) return;
    console.log('[PlayerManager] Останавливаю плеер');
    this.stopWatchdog();
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
