/**
 * СТАТУС ФАРМИНГА — что происходит прямо сейчас, одной фразой.
 *
 * Раньше состояние было разбросано по экрану: «Сессия: Активна» в
 * сайдбаре, «Минуты засчитываются» мелко под шкалой дропсов, значок «Нет
 * входа» отдельной плашкой, а на странице — ничего. Чтобы понять, идёт ли
 * фарминг на самом деле, приходилось сверять три места. Здесь всё это
 * сводится в одно состояние: цветная точка + фраза + пояснение.
 *
 *   window.farmStatus.compute() → { tone, text, detail, channel, category, … }
 *     tone: 'idle' | 'busy' | 'ok' | 'wait' | 'error'
 *   window.farmStatus.render()  — пишет #farm-status-dot/-text/-detail
 *     (сайдбар) и #farming-status-line (страница, если она есть)
 *   window.farmStatus.start()   — следит за источниками и перерисовывает
 *
 * Источники — только DOM (зачёт, значки, панель наград) и объекты
 * window.farmingPage / window.sessionState. Сам модуль ничего не решает и
 * никуда не пишет, кроме этих строк: логика фарминга о нём не знает.
 */
class FarmStatus {
  constructor() {
    this._started = false;
    this._timer = null;
    this._interval = null;
    this._observer = null;
    this._observed = new WeakSet();
  }

  /** Виден ли элемент по тем механизмам, которыми его прячет JS. */
  static isShown(el) {
    if (!el || el.hidden) return false;
    return !(el.style && el.style.display === 'none');
  }

  /** Состояние фарминга. Чистое чтение, без записи. */
  compute() {
    const doc = document;
    const page = window.farmingPage;
    const session = window.sessionState;
    const active = !!(session?.isActive?.() || page?.sessionStartTime);

    const channelEl = doc.getElementById('stream-channel');
    const channel = String(page?.currentStream?.displayName || page?.currentStream?.login ||
      (active ? channelEl?.textContent : '') || '').trim();
    const category = String(page?.currentCategory?.name || session?.categoryName || '').trim();

    // Сайдбарная строка под статусом: игра и, если его нет во фразе, канал
    const sideDetail = (withChannel) => [category, withChannel ? channel : '']
      .filter(Boolean).join(' · ');

    if (!active) {
      // Поиск стрима после «Начать»: сессии ещё нет, а кнопка уже занята
      const startBtn = doc.getElementById('sidebar-start-farming-btn');
      if (window._farmingStarting || startBtn?.disabled) {
        return {
          state: 'starting', tone: 'busy', live: false,
          text: tr('Ищу стрим…'), detail: tr('перебираю категории очереди'),
          channel: '', category: '',
          pageText: tr('Ищу стрим…'), pageDetail: tr('перебираю категории очереди'), sideText: tr('Ищу стрим…'), sideDetail: ''
        };
      }
      return {
        state: 'idle', tone: 'idle', live: false,
        text: tr('Фарминг не запущен'), detail: '',
        channel: '', category: '',
        pageText: '', pageDetail: '', sideText: tr('Фарминг идёт'), sideDetail: ''
      };
    }

    // Без входа Twitch минуты не считает — это важнее всего остального
    if (FarmStatus.isShown(doc.getElementById('login-badge'))) {
      return {
        state: 'login', tone: 'error', live: false,
        text: tr('Нет входа в Twitch'), detail: tr('минуты не идут'),
        channel, category,
        pageText: tr('Нет входа в Twitch'), pageDetail: tr('минуты не идут — войдите на вкладке «Аккаунты»'),
        sideText: tr('Нет входа'),
        sideDetail: sideDetail(true)
      };
    }

    const hasStream = window.playerManager?.hasStream ? window.playerManager.hasStream() : !!channel;
    if (!channel || !page?.currentStream || !hasStream) {
      return {
        state: 'searching', tone: 'busy', live: false,
        text: tr('Ищу стрим…'), detail: category ? tr('«{category}»', { category }) : '',
        channel: '', category,
        pageText: tr('Ищу стрим…'), pageDetail: category,
        sideText: tr('Ищу стрим…'),
        sideDetail: sideDetail(false)
      };
    }

    // Все награды категории получены — панель показывает «Все награды
    // кампании получены» и, если есть куда, кнопку перехода
    const panel = doc.getElementById('drops-progress-horizontal');
    if (FarmStatus.isShown(panel) && panel.querySelector('.drops-done')) {
      const next = (page?.categories || []).find(cat =>
        cat.enabled !== false && cat.hasDrops && !cat.dropsCompleted && cat.id !== page?.currentCategory?.id);
      const manual = typeof page?.isManualCategoryActive === 'function' && page.isManualCategoryActive();
      const whatNext = next
        ? (manual ? tr('можно перейти к «{category}»', { category: next.name }) : tr('дальше — «{category}»', { category: next.name }))
        : tr('других категорий с дропсами нет');
      return {
        state: 'done', tone: 'ok', live: false,
        text: tr('Награды собраны'), detail: whatNext,
        channel, category,
        pageText: tr('Награды категории собраны'), pageDetail: whatNext,
        sideText: tr('Всё собрано'),
        sideDetail: sideDetail(true)
      };
    }

    // Зачёт минут — по индикатору под шкалой дропсов (DropCredit)
    const credit = doc.getElementById('sidebar-drops-credit')?.dataset?.state || 'waiting';
    if (credit === 'ok') {
      return {
        state: 'credit-ok', tone: 'ok', live: true,
        text: tr('Смотрим {channel}', { channel }), detail: tr('минуты засчитываются'),
        channel, category,
        pageText: tr('Минуты засчитываются'), pageDetail: '',
        sideText: channel,
        sideDetail: sideDetail(false)
      };
    }
    if (credit === 'none') {
      const autoSwitch = window.settings?.get?.('autoSwitchStreams') !== false;
      const why = autoSwitch ? tr('ищу другой стрим') : tr('автопереключение выключено');
      return {
        state: 'credit-none', tone: 'error', live: false,
        text: tr('Канал не засчитывает'), detail: why,
        channel, category,
        pageText: tr('Канал не засчитывает'), pageDetail: why,
        sideText: tr('Не засчитывает'),
        sideDetail: sideDetail(true)
      };
    }
    // Наград за просмотр у игры не осталось — ждать нечего; «первые минуты
    // это обычно» здесь вводило в заблуждение. Куда дальше — тем же
    // правилом, что у «Награды собраны»: ручную категорию приложение само
    // не меняет, и обещать «перехожу» там нельзя
    if (credit === 'idle') {
      const next = (page?.categories || []).find(cat =>
        cat.enabled !== false && cat.hasDrops && !cat.dropsCompleted && cat.id !== page?.currentCategory?.id);
      const manual = typeof page?.isManualCategoryActive === 'function' && page.isManualCategoryActive();
      const whatNext = next
        ? (manual ? tr('можно перейти к «{category}»', { category: next.name }) : tr('перехожу к следующей категории'))
        : tr('других категорий с дропсами нет');
      return {
        state: 'credit-idle', tone: 'wait', live: false,
        text: tr('Награды за просмотр собраны'), detail: whatNext,
        channel, category,
        pageText: tr('Награды за просмотр собраны'), pageDetail: whatNext,
        sideText: channel,
        sideDetail: sideDetail(false)
      };
    }
    return {
      state: 'credit-wait', tone: 'wait', live: false,
      text: tr('Смотрим {channel}', { channel }), detail: tr('жду подтверждения Twitch'),
      channel, category,
      pageText: tr('Жду подтверждения от Twitch'), pageDetail: tr('первые минуты это обычно'),
      sideText: channel,
      sideDetail: sideDetail(false)
    };
  }

  /** Класс точки по состоянию: .status-dot + is-live/is-ok/is-wait/is-error/is-busy. */
  static dotClass(status) {
    if (status.tone === 'ok') return status.live ? 'is-live' : 'is-ok';
    if (status.tone === 'wait') return 'is-wait';
    if (status.tone === 'error') return 'is-error';
    if (status.tone === 'busy') return 'is-busy';
    return '';
  }

  /** Пишет состояние в сайдбар и на страницу. Меняет только то, что изменилось. */
  render() {
    let status;
    try {
      status = this.compute();
    } catch (error) {
      console.warn('[FarmStatus] Не удалось определить состояние:', error?.message);
      return null;
    }

    const doc = document;
    const setText = (el, text) => {
      if (el && el.textContent !== text) el.textContent = text;
    };
    const setDot = (el) => {
      if (!el) return;
      const name = ('status-dot ' + FarmStatus.dotClass(status)).trim();
      if (el.className !== name) el.className = name;
    };

    // Сайдбар: «● Смотрим Aspen   02:17:42» / «Overwatch   412 МБ»
    setDot(doc.getElementById('farm-status-dot'));
    // В сайдбаре места на полтора слова (рядом таймер), поэтому там
    // короткая подпись: имя канала, «Ищу стрим…», «Нет входа». Цвет точки
    // говорит о зачёте, полная фраза — во всплывающей подсказке
    const sideText = doc.getElementById('farm-status-text');
    setText(sideText, status.sideText || status.text);
    if (sideText) sideText.title = status.detail ? `${status.text} — ${status.detail}` : status.text;
    const sideDetail = doc.getElementById('farm-status-detail');
    setText(sideDetail, status.sideDetail);
    if (sideDetail) sideDetail.title = status.sideDetail;

    // Страница: строка над карточкой канала
    const line = doc.getElementById('farming-status-line');
    if (line) {
      setDot(line.querySelector('.status-dot'));
      setText(line.querySelector('.farm-status-main'), status.pageText);
      setText(line.querySelector('.farm-status-sub'), status.pageDetail);
      line.classList.toggle('is-error', status.tone === 'error');
      line.dataset.state = status.state;
      // Пояснение в узкой колонке обрезается многоточием — целиком фраза
      // видна в подсказке при наведении
      const full = status.pageDetail ? `${status.pageText} — ${status.pageDetail}` : (status.pageText || '');
      if (line.title !== full) line.title = full;
    }

    // Заглушка простоя: пока ищем стрим после «Начать», она говорит об этом,
    // а не «Фарминг не запущен»
    const waiting = doc.getElementById('current-stream-info')?.querySelector?.('.waiting-state');
    if (waiting) {
      const busy = status.state === 'starting';
      waiting.classList.toggle('is-busy', busy);
      waiting.setAttribute('aria-busy', String(busy));
      setText(waiting.querySelector('.waiting-label'), busy ? tr('Ищу стрим…') : tr('Фарминг не запущен'));
    }

    return status;
  }

  /** Подписывает наблюдатель на элемент один раз. */
  _watch(el, options) {
    if (!el || !this._observer || this._observed.has(el)) return;
    this._observed.add(el);
    this._observer.observe(el, options);
  }

  /**
   * Источники состояния. Сайдбар постоянный, а разметка страницы
   * появляется позже (роутер загружает её после старта) — поэтому
   * подписка повторяется при каждой проверке и цепляет новые узлы.
   */
  _watchSources() {
    const doc = document;
    const attrs = (names) => ({ attributes: true, attributeFilter: names });
    this._watch(doc.getElementById('sidebar-drops-credit'), attrs(['data-state']));
    this._watch(doc.getElementById('login-badge'), attrs(['hidden', 'style']));
    this._watch(doc.getElementById('game-mode-badge'), attrs(['hidden', 'style']));
    this._watch(doc.getElementById('farming-session-info'), attrs(['style']));
    this._watch(doc.getElementById('sidebar-start-farming-btn'), attrs(['disabled', 'style']));
    this._watch(doc.getElementById('stream-channel'), { childList: true, characterData: true, subtree: true });
    this._watch(doc.getElementById('drops-progress-horizontal'), { attributes: true, attributeFilter: ['style'], childList: true });
  }

  start() {
    if (this._started || typeof document === 'undefined') return;
    this._started = true;

    const schedule = () => {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        this._timer = null;
        this._watchSources();
        this.render();
      }, 100);
    };

    if (typeof MutationObserver === 'function') {
      this._observer = new MutationObserver(schedule);
    }
    window.addEventListener('wt:farm-status', schedule);

    // Страховка: часть состояния (сессия, текущий стрим, его загрузка в
    // плеер) живёт в объектах, а не в DOM, и наблюдатель её не видит.
    // Проверка дешёвая и ничего не пишет, если состояние то же
    this._interval = setInterval(() => {
      this._watchSources();
      this.render();
    }, 2000);

    this._watchSources();
    this.render();
  }
}

if (typeof window !== 'undefined') {
  window.FarmStatus = FarmStatus;
  window.farmStatus = new FarmStatus();

  // Запускается сам, без правки init страницы: сайдбар уже в разметке,
  // а разметку страницы наблюдатель подхватит, когда она появится
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => window.farmStatus.start(), { once: true });
    } else {
      window.farmStatus.start();
    }
  }
}
