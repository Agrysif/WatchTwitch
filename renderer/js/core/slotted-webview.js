/**
 * SlottedWebview — webview, который живёт вне страниц и позиционируется поверх
 * «слота» (пустого div-а) на текущей странице.
 *
 * Зачем такой механизм вообще нужен. Роутер перерисовывает содержимое страницы
 * через innerHTML, поэтому любой webview внутри страницы уничтожается при уходе
 * с неё. Перенести узел в другое место DOM тоже нельзя — webview при этом
 * перезагружается. Значит, единственный способ сохранить живой Twitch-плеер и
 * живой чат между страницами — держать их в <body> и двигать по экрану, а не по
 * дереву документа.
 *
 * Класс отвечает только за геометрию и жизненный цикл узла. Что именно грузится
 * внутрь — дело наследников (PlayerManager, ChatManager).
 */
class SlottedWebview {
  /**
   * Постоянный размер холста webview. Все слоты в приложении имеют
   * соотношение 16:9, поэтому одного базового размера достаточно:
   * меняется только масштаб, а не размеры самого webview.
   */
  static get BASE_SIZE() {
    return { width: 640, height: 360 };
  }

  /**
   * @param {object} options
   * @param {string} options.logName    префикс для логов
   * @param {string} options.hostId     id контейнера-обрезателя
   * @param {string} options.webviewId  id самого webview
   * @param {object} options.attributes атрибуты webview (partition, preload и т.п.)
   * @param {number} options.zIndex     слой относительно интерфейса
   */
  constructor(options = {}) {
    this.logName = options.logName || 'SlottedWebview';
    this.hostId = options.hostId;
    this.webviewId = options.webviewId;
    this.attributes = options.attributes || {};
    this.zIndex = options.zIndex === undefined ? 5 : options.zIndex;

    this.host = null;
    this.webview = null;
    this.slot = null;
    this.clipRoot = null;

    this._tracking = false;
    this._resizeObserver = null;
    this._pollInterval = null;
    this._onGeometryChange = null;
    this._lastGeometry = '';
    this._parked = false;
    this._moveTimer = null;
  }

  /** Создаёт узел один раз за всё время жизни приложения. */
  ensure() {
    if (this.webview) return this.webview;

    const host = document.createElement('div');
    host.id = this.hostId;
    host.style.cssText = [
      'position: fixed',
      'overflow: hidden',
      'background: #000',
      `z-index: ${this.zIndex}`,
      'display: none',
      // Прозрачен для мыши по умолчанию. Webview — отдельный слой, и когда
      // он принимает события, колесо прокрутки уходит внутрь него, а
      // страница под курсором перестаёт прокручиваться. Кликабельные
      // элементы включают pointer-events у себя.
      'pointer-events: none'
    ].join(';');

    const webview = document.createElement('webview');
    webview.id = this.webviewId;
    Object.entries(this.attributes).forEach(([name, value]) => {
      webview.setAttribute(name, value);
    });
    webview.style.cssText = 'position: absolute; left: 0; top: 0; background: #000; border: none;';

    host.appendChild(webview);
    document.body.appendChild(host);

    this.host = host;
    this.webview = webview;

    console.log(`[${this.logName}] Постоянный webview создан`);
    this.onCreated(webview);

    return webview;
  }

  /** Точка расширения для наследников: вызывается сразу после создания узла. */
  onCreated() {}

  /** Точка расширения: вызывается при каждой привязке к слоту. */
  onAttached() {}

  getWebview() {
    return this.ensure();
  }

  /**
   * Привязывает webview к слоту. Сам узел при этом не трогается —
   * меняются только его координаты на экране.
   */
  attachTo(slotOrId, options = {}) {
    const slot = typeof slotOrId === 'string' ? document.getElementById(slotOrId) : slotOrId;

    if (!slot) {
      console.warn(`[${this.logName}] Слот не найден:`, slotOrId);
      this.detach();
      return;
    }

    this.ensure();

    // Плавный переезд между слотами. Анимация включается только на время
    // самого перехода: держать её постоянно нельзя — координаты
    // пересчитываются при каждой прокрутке, и плеер тянулся бы за
    // страницей с задержкой.
    if (options.animate && this.slot && this.slot !== slot && !this._parked) {
      this._animateMove();
    }

    // Слежение всегда перезапускаем: ResizeObserver был подписан на старый слот
    this._stopTracking();
    this.slot = slot;
    this.clipRoot = this._findClipRoot(slot);
    this._lastGeometry = '';
    this._startTracking();

    this.onAttached(options);

    console.log(`[${this.logName}] Привязан к слоту:`, slot.id || slot.className);
  }

  /** Убирает с глаз, НЕ выгружая содержимое. */
  detach() {
    this.slot = null;
    this.clipRoot = null;
    this._stopTracking();
    this._park();
  }

  /**
   * Прячет узел, уводя его за пределы экрана.
   *
   * Здесь принципиально не используется display: none. Скрытый так документ
   * Chromium считает невидимым, и страница внутри webview реагирует на это через
   * Page Visibility API: плеер Twitch встаёт на паузу, чат перестаёт получать
   * сообщения (а значит, и бонусные сундуки). Смещение за экран оставляет
   * содержимое полностью живым.
   */
  _animateMove() {
    const duration = 320;
    const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';

    this.host.style.transition = `left ${duration}ms ${easing}, top ${duration}ms ${easing}, width ${duration}ms ${easing}, height ${duration}ms ${easing}`;
    this.webview.style.transition = `transform ${duration}ms ${easing}`;

    clearTimeout(this._moveTimer);
    this._moveTimer = setTimeout(() => {
      this.host.style.transition = '';
      this.webview.style.transition = '';
    }, duration + 40);
  }

  _park() {
    if (!this.host || this._parked) return;
    this._parked = true;
    this._lastGeometry = '';

    // Прячем, НЕ убирая за пределы экрана. Уехавший за экран элемент
    // Chromium считает невидимым и приостанавливает — видео замирает, а
    // сторож воспроизведения принимает это за зависание и перезагружает
    // плеер. Именно так возникала пауза при переходе на другую вкладку.
    // Схлопнутый до пикселя контейнер оставляет плеер живым: сам webview
    // при этом не меняет размеров, он просто обрезан.
    this.host.style.display = 'block';
    this.host.style.transform = '';
    this.host.style.left = '0px';
    this.host.style.top = '0px';
    this.host.style.width = '1px';
    this.host.style.height = '1px';
    this.host.style.opacity = '0';
  }

  /** Ближайший предок с прокруткой — за его границы вылезать нельзя. */
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

  /**
   * Слежение за геометрией слота.
   *
   * Намеренно НЕ используем постоянный requestAnimationFrame-цикл: приложение
   * работает часами, и держать renderer в непрерывной перерисовке ради пересчёта
   * координат — лишний расход процессора. Пересчитываем по событиям, которые
   * реально способны сдвинуть слот, плюс редкий страховочный опрос на случай
   * изменений, не порождающих событий.
   */
  _startTracking() {
    if (this._tracking) return;
    this._tracking = true;

    // Пачку событий за один кадр схлопываем в один пересчёт. Во время
    // перехода между страницами ResizeObserver и scroll срабатывают
    // десятки раз подряд, а каждое изменение размеров webview заставляет
    // плеер перестраивать поток — отсюда рывки и паузы при переезде
    // в сайдбар.
    let scheduled = false;
    this._onGeometryChange = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        this._sync();
      });
    };

    window.addEventListener('scroll', this._onGeometryChange, { passive: true, capture: true });
    window.addEventListener('resize', this._onGeometryChange, { passive: true });

    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(this._onGeometryChange);
      this._resizeObserver.observe(this.slot);
      this._resizeObserver.observe(document.body);
    }

    // Страховка на случай перемещений, которые не дают ни события прокрутки,
    // ни срабатывания ResizeObserver. Раньше опрос шёл дважды в секунду, и
    // каждый тик читал getBoundingClientRect, заставляя браузер пересчитывать
    // раскладку. Оба обработчика выше покрывают все обычные случаи, поэтому
    // страховке хватает пары секунд.
    this._pollInterval = setInterval(this._onGeometryChange, 2000);

    this._sync();
  }

  _stopTracking() {
    if (!this._tracking) return;
    this._tracking = false;

    if (this._onGeometryChange) {
      window.removeEventListener('scroll', this._onGeometryChange, { capture: true });
      window.removeEventListener('resize', this._onGeometryChange);
      this._onGeometryChange = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  _isVisible(element) {
    if (!element.isConnected) return false;
    if (element.offsetParent === null && window.getComputedStyle(element).position !== 'fixed') return false;
    return true;
  }

  /** Подгоняет геометрию под слот, записывая стили только при реальном сдвиге. */
  _sync() {
    if (!this.slot || !this.host) return;

    if (!this._isVisible(this.slot)) {
      this._park();
      return;
    }

    const rect = this.slot.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      this._park();
      return;
    }

    // Пересечение слота с областью прокрутки — узел не должен наезжать
    // на шапку и соседние блоки при скролле страницы.
    const clip = this.clipRoot === document.documentElement
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : this.clipRoot.getBoundingClientRect();

    const left = Math.max(rect.left, clip.left);
    const top = Math.max(rect.top, clip.top);
    const right = Math.min(rect.right, clip.right);
    const bottom = Math.min(rect.bottom, clip.bottom);

    if (right - left < 1 || bottom - top < 1) {
      this._park();
      return;
    }

    const geometry = `${left}|${top}|${right}|${bottom}|${rect.left}|${rect.top}|${rect.width}|${rect.height}`;
    if (geometry === this._lastGeometry) return;
    this._lastGeometry = geometry;

    this._parked = false;
    this.host.style.display = 'block';
    this.host.style.transform = '';
    this.host.style.opacity = '';
    this.host.style.left = `${left}px`;
    this.host.style.top = `${top}px`;
    this.host.style.width = `${right - left}px`;
    this.host.style.height = `${bottom - top}px`;
    this.host.style.borderRadius = window.getComputedStyle(this.slot).borderRadius || '0px';

    // Размер webview НЕ меняем — только масштабируем изображение.
    //
    // Физическое изменение размеров webview меняет размер окна внутри него,
    // и плеер Twitch на это заново договаривается о потоке: отсюда пауза
    // на несколько секунд при переезде в сайдбар и обратно. Гость об этих
    // переездах вообще не должен знать, поэтому держим ему постоянный
    // холст и подгоняем картинку через transform.
    const base = SlottedWebview.BASE_SIZE;
    const scale = rect.width / base.width;

    this.webview.style.width = `${base.width}px`;
    this.webview.style.height = `${base.height}px`;
    this.webview.style.transformOrigin = 'top left';
    this.webview.style.transform = `translate(${rect.left - left}px, ${rect.top - top}px) scale(${scale})`;
    this.webview.style.left = '0px';
    this.webview.style.top = '0px';
  }
}

window.SlottedWebview = SlottedWebview;
