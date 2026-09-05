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
    this.bar = null;
    this.muted = true;
    this.lastPlaybackTime = null;
    this.stallStrikes = 0;
    this.playbackProbe = null;
  }

  /** Качества, которые понимает плеер Twitch. */
  static get QUALITIES() {
    return [
      { value: '160p30', label: '160p', hint: 'минимум' },
      { value: '360p30', label: '360p', hint: '' },
      { value: '480p30', label: '480p', hint: '' },
      { value: '720p60', label: '720p', hint: '' },
      // Twitch называет исходное качество chunked. Конкретное разрешение
      // зависит от стримера, поэтому числом его не подписать.
      { value: 'chunked', label: 'Источник', hint: 'как у стримера' }
    ];
  }

  static get() {
    if (!window._playerManager) {
      window._playerManager = new PlayerManager();
    }
    return window._playerManager;
  }

  /**
   * Панель управления поверх плеера.
   *
   * Собственная, а не встроенная в Twitch: встроенная показывает оверлеи с
   * названием канала и перехватывает мышь. Панель — единственный элемент
   * с pointer-events, поэтому прокрутка страницы над плеером работает.
   */
  onCreated(webview) {
    // Тот же preload, что и у чата: он задаёт качество в localStorage
    // плеера ДО запуска его скриптов. Позже это уже не работает —
    // плеер к тому моменту выбрал поток.
    if (window.electronAPI?.getWebviewPreloadPath) {
      window.electronAPI.getWebviewPreloadPath()
        .then(path => { if (path) webview.setAttribute('preload', path); })
        .catch(e => console.warn('[PlayerManager] Не удалось получить preload:', e?.message));
    }

    const bar = document.createElement('div');
    bar.className = 'player-bar';
    bar.style.display = 'none';

    const qualityOptions = PlayerManager.QUALITIES
      .map(q => `
        <button class="player-menu-item" data-quality="${q.value}">
          <span>${q.label}</span>
          ${q.hint ? `<span class="player-menu-hint">${q.hint}</span>` : ''}
        </button>
      `)
      .join('');

    bar.innerHTML = `
      <button class="player-bar-btn" data-role="sound" title="Включить звук">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" data-icon="muted">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z" opacity=".35"/>
          <path d="M19 5L5 19" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" data-icon="loud" style="display: none;">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-1 7-4.6 7-8.8s-3-7.8-7-8.8z"/>
        </svg>
      </button>
      <div class="player-quality">
        <button class="player-bar-btn player-quality-trigger" data-role="quality-trigger">
          <span data-role="quality-label">160p</span>
          <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor"><path d="M6 8L2 4h8z"/></svg>
        </button>
        <div class="player-menu" data-role="quality-menu">${qualityOptions}</div>
      </div>
    `;

    this.host.appendChild(bar);
    this.bar = bar;

    bar.querySelector('[data-role="sound"]').addEventListener('click', () => this.toggleSound());

    const trigger = bar.querySelector('[data-role="quality-trigger"]');
    const menu = bar.querySelector('[data-role="quality-menu"]');

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.classList.toggle('open');
    });

    menu.querySelectorAll('.player-menu-item').forEach(item => {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        menu.classList.remove('open');
        this.setQuality(item.dataset.quality);
      });
    });

    // Клик мимо закрывает список. Слушаем на документе, потому что сам
    // плеер мышь не принимает и клика по нему не будет.
    document.addEventListener('click', () => menu.classList.remove('open'));

    this.syncBar();
  }

  /**
   * В сайдбаре панель сжимается до одной кнопки звука: выбор качества там
   * не поместится, а вот выключить внезапный звук нужно уметь с любой
   * вкладки — иначе пришлось бы возвращаться на страницу фарминга.
   */
  onAttached(options = {}) {
    if (!this.bar) return;

    const compact = options.interactive === false;
    this.bar.style.display = 'flex';
    this.bar.classList.toggle('player-bar-compact', compact);

    const quality = this.bar.querySelector('.player-quality');
    if (quality) quality.style.display = compact ? 'none' : '';
  }

  /**
   * Приводит сохранённое качество к одному из поддерживаемых.
   *
   * У ранних версий здесь могло остаться значение 'auto', которого нет
   * среди вариантов: список тогда показывался пустым, а плеер получал
   * непонятный ему параметр. Всё неизвестное считаем минимальным качеством —
   * оно же и по умолчанию.
   */
  /**
   * Возврат к минимальному качеству в начале каждой сессии фарминга.
   *
   * Выбор пользователя действует до конца сессии — если он поднял качество,
   * оно таким и останется. Но новая сессия всегда стартует с минимума:
   * фарминг обычно идёт часами и фоном, и незаметно унаследованное
   * «Источник» с прошлого раза означает лишние гигабайты трафика.
   */
  resetQualityForNewSession() {
    // Сбрасываем временные значения, а настройку из «Настроек» не трогаем.
    // Раньше сюда записывался минимум поверх выбора пользователя, и сам
    // выбор в настройках терял смысл.
    this.sessionQuality = null;
    this.fallbackQuality = null;
    this._fallbackFor = null;

    console.log('[PlayerManager] Новая сессия: качество', this.resolveQuality());
    this.syncBar();
  }

  /**
   * Какое качество запрашивать.
   *
   * Три уровня, от временного к постоянному:
   *   fallbackQuality — куда лестница поднялась, потому что запрошенного
   *                     качества у канала не оказалось. Живёт до смены канала;
   *   sessionQuality  — что пользователь выбрал на панели плеера. Живёт до
   *                     конца сессии;
   *   настройка       — постоянный выбор в «Настройках».
   *
   * Раньше все три писались в одно поле настроек. Из-за этого один
   * неудачный старт навсегда превращал выбор пользователя в «Источник»:
   * лестница поднималась и сохраняла верхнюю ступень, а автопереключение
   * категорий грузит стримы помногу раз за сессию.
   */
  resolveQuality() {
    const candidates = [
      this.fallbackQuality,
      this.sessionQuality,
      window.settings?.get('preferredStreamQuality')
    ];

    for (const value of candidates) {
      if (value && PlayerManager.QUALITIES.some(q => q.value === value)) return value;
    }
    return PlayerManager.QUALITIES[0].value;
  }

  syncBar() {
    if (!this.bar) return;

    const quality = this.resolveQuality();
    const current = PlayerManager.QUALITIES.find(q => q.value === quality);

    const label = this.bar.querySelector('[data-role="quality-label"]');
    if (label) label.textContent = current ? current.label : '160p';

    this.bar.querySelectorAll('.player-menu-item').forEach(item => {
      item.classList.toggle('active', item.dataset.quality === quality);
    });

    const muted = this.muted !== false;
    const btn = this.bar.querySelector('[data-role="sound"]');
    if (btn) {
      btn.classList.toggle('active', !muted);
      btn.title = muted ? 'Включить звук' : 'Выключить звук';
      btn.querySelector('[data-icon="muted"]').style.display = muted ? '' : 'none';
      btn.querySelector('[data-icon="loud"]').style.display = muted ? 'none' : '';
    }
  }

  /**
   * Звук переключается прямо у видео, без перезагрузки плеера.
   * Состояние намеренно не запоминается между стримами: фарминг фоновый,
   * и внезапно заоравший на следующем канале звук — не то, чего ждут.
   */
  async toggleSound() {
    if (!this.webview) return;

    this.muted = this.muted === false;
    this.syncBar();

    try {
      await this.webview.executeJavaScript(`
        (function () {
          const video = document.querySelector('video');
          if (!video) return false;
          video.muted = ${this.muted};
          if (!video.muted) video.volume = 0.5;
          return true;
        })();
      `);
    } catch (e) {
      console.warn('[PlayerManager] Не удалось переключить звук:', e.message);
    }
  }

  /**
   * Проверяет, что воспроизведение вообще началось, и понижает требования,
   * если нет.
   *
   * Найдено измерением: не у каждого стрима есть запрошенное качество.
   * При запросе 160p30 у канала без такой дорожки плеер не падает и не
   * сообщает об ошибке — он просто молча стоит с currentTime = 0
   * бесконечно. Снаружи это выглядит как «стрим завис».
   *
   * Поэтому после загрузки ждём реальных кадров и, если их нет, идём вверх
   * по лестнице качеств. Последняя ступень — снять закрепление вовсе и
   * отдать выбор плееру.
   */
  ensurePlaybackStarted(requestedQuality) {
    clearTimeout(this.playbackProbe);

    const ladder = PlayerManager.QUALITIES.map(q => q.value);
    const startIndex = ladder.indexOf(requestedQuality);

    this.playbackProbe = setTimeout(async () => {
      if (!this.webview || !this.channel) return;

      let started = false;
      try {
        started = await this.webview.executeJavaScript(
          '(function(){var v=document.querySelector("video");return !!v && v.currentTime > 0.3;})()'
        );
      } catch (e) {
        return;
      }

      if (started) return;

      const next = startIndex >= 0 ? ladder[startIndex + 1] : null;

      if (next) {
        console.warn('[PlayerManager] Качество', requestedQuality,
          'не запускается, пробую', next);
        // В настройку не пишем: это вынужденный подъём, а не выбор
        this.fallbackQuality = next;
        this._fallbackFor = this.channel;
        this.syncBar();

        const channel = this.channel;
        this.channel = null;
        this.load(channel, { quality: next, keepSound: this.muted === false });
        window.utils?.showToast('Качество ' + requestedQuality + ' недоступно, включено ' + next, 'warning');
        return;
      }

      // Ступени кончились — отдаём выбор плееру
      console.warn('[PlayerManager] Снимаю закрепление качества, выбор за плеером');
      try {
        await this.webview.executeJavaScript('localStorage.removeItem("video-quality");');
      } catch (e) {
        // ignore
      }
      try { this.webview.reload(); } catch (e) { /* ignore */ }
    }, 14000);
  }

  /**
   * После перезагрузки плеера видео создаётся заново и стартует немым.
   * Ждём его появления и возвращаем звук.
   */
  restoreSoundAfterLoad() {
    let attempts = 0;

    // Снимать немоту сразу после появления video бесполезно: плеер стартует
    // немым по требованию автозапуска и возвращает muted обратно, пока
    // воспроизведение не началось. Ждём реальных кадров (currentTime растёт)
    // и потом ещё несколько раз проверяем, что немота не вернулась.
    const tryRestore = async () => {
      attempts += 1;
      if (attempts > 30 || this.muted !== false) return;

      let state = null;
      try {
        state = await this.webview.executeJavaScript(`
          (function () {
            const video = document.querySelector('video');
            if (!video) return null;
            const playing = video.currentTime > 0.5 && !video.paused;
            if (playing) {
              video.muted = false;
              video.volume = 0.5;
            }
            return { playing: playing, muted: video.muted };
          })();
        `);
      } catch (e) {
        // документ ещё не готов
      }

      if (state && state.playing && state.muted === false) {
        this.syncBar();
        // Ещё одна проверка позже: плеер иногда возвращает немоту сам
        setTimeout(() => {
          if (this.muted === false) tryRestore();
        }, 3000);
        return;
      }

      setTimeout(tryRestore, 800);
    };

    setTimeout(tryRestore, 1500);
  }

  /**
   * Качество плеер Twitch читает из своего localStorage, поэтому применение
   * требует перезагрузки. Делаем это только по явному выбору пользователя.
   */
  async setQuality(value) {
    // Выбор на панели действует до конца сессии; постоянное значение
    // меняется только в «Настройках»
    this.sessionQuality = value;
    this.fallbackQuality = null;
    window.electronAPI?.refreshStreamLimit?.(value);

    if (!this.webview || !this.channel) return;

    try {
      await this.webview.executeJavaScript(`
        localStorage.setItem('video-quality', JSON.stringify({ default: '${value}' }));
      `);
    } catch (e) {
      console.warn('[PlayerManager] Не удалось записать качество:', e.message);
    }

    // Звук при смене качества сохраняем: пользователь включил его осознанно
    // минуту назад, и терять его из-за перезагрузки плеера — неожиданно
    const keepSound = this.muted === false;

    const channel = this.channel;
    this.channel = null;
    this.load(channel, { quality: value, keepSound });

    const chosen = PlayerManager.QUALITIES.find(q => q.value === value);
    window.utils?.showToast('Качество: ' + (chosen ? chosen.label : value), 'info');
  }

  /**
   * Есть ли сейчас загруженный поток.
   *
   * Признаком служит канал, а не webview.src: присвоение src пустой строки
   * при выгрузке резолвится браузером в адрес самой страницы, поэтому
   * проверка по src оставалась истинной и после остановки фарминга. Из-за
   * этого роутер считал плеер живым и возвращал в сайдбар пустой чёрный
   * прямоугольник при первой же прокрутке.
   */
  hasStream() {
    return !!this.channel;
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

    // Подъём лестницы относится к тому каналу, у которого не оказалось
    // нужной дорожки. На новом канале начинаем с желаемого качества снова,
    // иначе вынужденный подъём тянулся бы через все следующие стримы.
    if (this._fallbackFor && this._fallbackFor !== login) {
      this.fallbackQuality = null;
      this._fallbackFor = null;
    }

    // Качество берём из настроек: это прямой рычаг расхода трафика.
    // Раньше значение было прибито в коде, а настройка в интерфейсе
    // отсутствовала вовсе.
    const quality = options.quality || this.resolveQuality();
    // controls=false убирает панель управления и наложенную поверх видео
    // подпись с названием стрима — для фонового просмотра они не нужны.
    const url = `https://player.twitch.tv/?channel=${login}&parent=localhost&muted=true&autoplay=true&controls=false&quality=${quality}`;

    console.log('[PlayerManager] Загружаю канал:', login);
    this.channel = login;

    // Потолок скорости считается от действующего качества, а не от
    // настройки: иначе после подъёма лестницы предел оказался бы тесным
    window.electronAPI?.refreshStreamLimit?.(quality);
    this.lastPlaybackTime = null;
    this.stallStrikes = 0;
    // Новый канал всегда начинается без звука. Исключение — перезагрузка
    // того же канала ради смены качества: там звук осознанно сохраняем.
    this.muted = options.keepSound ? false : true;
    this.syncBar();
    webview.src = url;
    window.electronAPI?.keepAwake?.(true);

    if (options.keepSound) {
      this.restoreSoundAfterLoad();
    }

    this.ensurePlaybackStarted(quality);

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
          return {
            hasVideo: !!video,
            time: video ? video.currentTime : 0,
            paused: video ? video.paused : true,
            hasError: /Ошибка\\s*#?\\d+|Error\\s*#?\\d+|ошибка сети|network error/i.test(text),
            offline: /не в сети|не в эфире|офлайн|\\boffline\\b/i.test(text)
          };
        })();
      `);
    } catch (e) {
      // Документ ещё не готов — не повод паниковать
      return;
    }

    if (!state) return;

    // Канал не в эфире: чинить плеер бессмысленно, нужен другой стрим.
    // Ждём двух проверок подряд (минуту), чтобы не сорваться на мигание
    // текста во время загрузки страницы.
    if (state.offline && !state.hasVideo) {
      this.offlineStrikes = (this.offlineStrikes || 0) + 1;
      if (this.offlineStrikes >= 2) {
        this.offlineStrikes = 0;
        this.reportDead('канал не в эфире');
      }
      return;
    }
    this.offlineStrikes = 0;

    // Спрятанный плеер дальше не проверяем: пока он не показан, замирание
    // нормально, а вмешательство обернулось бы перезагрузкой и потерей
    // накопленного просмотра.
    if (this._parked) {
      this.lastPlaybackTime = null;
      this.stallStrikes = 0;
      return;
    }

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

    // Лестница починки: нажать кнопку → перезагрузить webview → заново
    // выставить адрес → сдаться и попросить другой стрим. Раньше на
    // четвёртой ступени лестница начиналась с начала, и мёртвый канал
    // перезапускался всю ночь.
    if (this.stallStrikes === 1) {
      await this.nudgePlayer();
    } else if (this.stallStrikes === 2) {
      console.warn('[PlayerManager] Перезагружаю webview');
      try { this.webview.reload(); } catch (e) { /* ignore */ }
    } else if (this.stallStrikes === 3) {
      console.warn('[PlayerManager] Переустанавливаю адрес плеера');
      const channel = this.channel;
      this.channel = null;
      this.load(channel);
      // Счётчик не сбрасываем: если и это не помогло, следующая ступень —
      // смена канала
      this.stallStrikes = 3;
      window.utils?.showToast('Плеер перезапущен автоматически', 'info');
    } else {
      this.stallStrikes = 0;
      this.reportDead('плеер не ожил после перезапуска');
    }
  }

  /**
   * Сообщает странице фарминга, что канал не оживить.
   *
   * Сторож теперь один. Раньше рядом работал второй, в самой странице
   * фарминга, с проверкой каждые десять секунд: перезагрузку плеера
   * отсюда он читал как «стрим умер» и менял канал посреди починки.
   */
  reportDead(reason) {
    console.warn('[PlayerManager] Стрим не оживить:', reason);
    this.lastPlaybackTime = null;
    window.dispatchEvent(new CustomEvent('wt:player-dead', {
      detail: { channel: this.channel, reason }
    }));
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
    clearTimeout(this.playbackProbe);
    this.stopWatchdog();
    this.channel = null;
    window.electronAPI?.keepAwake?.(false);
    try {
      this.webview.src = '';
    } catch (e) {
      console.warn('[PlayerManager] Не удалось очистить src:', e.message);
    }
    this.detach();

    // Плеера больше нет — места под него должны закрыться, иначе в сайдбаре
    // остаётся пустой чёрный прямоугольник
    window.router?.releasePlayerSlots?.();
  }
}

window.PlayerManager = PlayerManager;
window.playerManager = PlayerManager.get();
