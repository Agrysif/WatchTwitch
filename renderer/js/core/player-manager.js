/**
 * PlayerManager — единственный на всё приложение webview с Twitch-плеером.
 *
 * Зачем: раньше плееров было три (внутри страницы фарминга, скрытый фоновый и
 * мини-плеер в сайдбаре), и при каждом переходе между страницами поток
 * копировался из одного в другой через присваивание .src. Любое присваивание
 * .src — это полная перезагрузка webview, поэтому стрим останавливался и
 * стартовал заново, а накопленные Twitch минуты просмотра сбрасывались.
 *
 * Решение: webview создаётся один раз, живёт в <body> и НИКОГДА не переезжает
 * по DOM (перенос узла тоже вызывает перезагрузку). Вместо этого он позиционируется
 * поверх «слота» — обычного пустого div-а на нужной странице. Смена страницы
 * меняет только координаты, воспроизведение не прерывается.
 */
class PlayerManager {
  constructor() {
    this.host = null;      // контейнер с overflow: hidden, обрезает плеер по границам области
    this.webview = null;   // сам webview, id="twitch-player"
    this.slot = null;      // элемент-место, поверх которого держим плеер
    this.clipRoot = null;  // область, за которую плеер не должен вылезать
    this.channel = null;   // текущий канал, чтобы не перезагружать плеер зря
    this._rafId = null;
    this._lastGeometry = '';
  }

  static get() {
    if (!window._playerManager) {
      window._playerManager = new PlayerManager();
    }
    return window._playerManager;
  }

  /** Создаёт webview один раз за всё время жизни приложения. */
  ensure() {
    if (this.webview) return this.webview;

    const host = document.createElement('div');
    host.id = 'persistent-player-host';
    host.style.cssText = [
      'position: fixed',
      'overflow: hidden',
      'background: #000',
      'z-index: 5',
      'display: none',
      'pointer-events: auto'
    ].join(';');

    const webview = document.createElement('webview');
    webview.id = 'twitch-player';
    webview.setAttribute('partition', 'persist:twitch');
    webview.setAttribute('allowpopups', 'false');
    webview.setAttribute('disablewebsecurity', '');
    webview.setAttribute('webpreferences', 'contextIsolation=false');
    webview.style.cssText = 'position: absolute; left: 0; top: 0; background: #000; border: none;';

    host.appendChild(webview);
    document.body.appendChild(host);

    this.host = host;
    this.webview = webview;

    console.log('[PlayerManager] Постоянный плеер создан');
    return webview;
  }

  getWebview() {
    return this.ensure();
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
    const url = `https://player.twitch.tv/?channel=${login}&parent=localhost&muted=true&autoplay=true&quality=${quality}`;

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

  /**
   * Привязывает плеер к слоту. Сам webview при этом не трогается —
   * меняются только его координаты на экране.
   */
  attachTo(slotOrId) {
    const slot = typeof slotOrId === 'string' ? document.getElementById(slotOrId) : slotOrId;

    if (!slot) {
      console.warn('[PlayerManager] Слот не найден:', slotOrId);
      this.detach();
      return;
    }

    this.ensure();
    this.slot = slot;
    this.clipRoot = this._findClipRoot(slot);
    this._lastGeometry = '';
    this._startTracking();

    console.log('[PlayerManager] Плеер привязан к слоту:', slot.id || slot.className);
  }

  /** Прячет плеер, НЕ выгружая поток — просмотр продолжает засчитываться. */
  detach() {
    this.slot = null;
    this.clipRoot = null;
    this._stopTracking();
    if (this.host) {
      this.host.style.display = 'none';
    }
  }

  /** Ближайший предок с прокруткой — за его границы плеер вылезать не должен. */
  _findClipRoot(element) {
    let node = element.parentElement;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const overflow = style.overflow + style.overflowY + style.overflowX;
      if (/(auto|scroll|hidden)/.test(overflow)) return node;
      node = node.parentElement;
    }
    return document.documentElement;
  }

  _startTracking() {
    if (this._rafId !== null) return;
    const tick = () => {
      this._sync();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopTracking() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _isVisible(element) {
    if (!element.isConnected) return false;
    if (element.offsetParent === null && window.getComputedStyle(element).position !== 'fixed') return false;
    return true;
  }

  /**
   * Подгоняет геометрию плеера под слот. Вызывается каждый кадр, но стили
   * пишет только когда прямоугольник реально изменился.
   */
  _sync() {
    if (!this.slot || !this.host) return;

    if (!this._isVisible(this.slot)) {
      if (this.host.style.display !== 'none') this.host.style.display = 'none';
      return;
    }

    const rect = this.slot.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      if (this.host.style.display !== 'none') this.host.style.display = 'none';
      return;
    }

    // Пересечение слота с областью прокрутки — плеер не должен наезжать
    // на шапку и соседние блоки при скролле страницы.
    const clip = this.clipRoot === document.documentElement
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : this.clipRoot.getBoundingClientRect();

    const left = Math.max(rect.left, clip.left);
    const top = Math.max(rect.top, clip.top);
    const right = Math.min(rect.right, clip.right);
    const bottom = Math.min(rect.bottom, clip.bottom);

    if (right - left < 1 || bottom - top < 1) {
      if (this.host.style.display !== 'none') this.host.style.display = 'none';
      return;
    }

    const geometry = `${left}|${top}|${right}|${bottom}|${rect.left}|${rect.top}|${rect.width}|${rect.height}`;
    if (geometry === this._lastGeometry) return;
    this._lastGeometry = geometry;

    this.host.style.display = 'block';
    this.host.style.left = `${left}px`;
    this.host.style.top = `${top}px`;
    this.host.style.width = `${right - left}px`;
    this.host.style.height = `${bottom - top}px`;
    this.host.style.borderRadius = window.getComputedStyle(this.slot).borderRadius || '0px';

    this.webview.style.left = `${rect.left - left}px`;
    this.webview.style.top = `${rect.top - top}px`;
    this.webview.style.width = `${rect.width}px`;
    this.webview.style.height = `${rect.height}px`;
  }
}

window.PlayerManager = PlayerManager;
window.playerManager = PlayerManager.get();
