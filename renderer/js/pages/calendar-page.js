/**
 * CalendarPage — кампании, разложенные по срокам.
 *
 * Приложение и раньше получало полный список кампаний со сроками, но
 * пользовалось им только для выбора категории. Здесь тот же список виден
 * целиком: что горит сегодня, что начинается завтра, а что можно
 * отложить. Отсюда же категорию можно добавить в работу одним нажатием.
 */
class CalendarPage {
  constructor() {
    this.campaigns = [];
    this.categories = [];
    this.filter = 'all';
    this.days = 7;
    // Лента показывает первые TIMELINE_ROWS строк; «Показать все» раскрывает
    // её целиком. Состояние живёт до ухода со страницы
    this.timelineExpanded = false;

    // Обработчики снимаются одним сигналом при уходе со страницы: раньше
    // объект календаря оставался жить после каждого захода вместе с ними
    this._abort = new AbortController();
    this._destroyed = false;

    this.init();
  }

  /** Сколько строк ленты видно до «Показать все». */
  static get TIMELINE_ROWS() {
    return 15;
  }

  /** Освобождение при уходе со страницы (зовёт Router). */
  destroy() {
    this._destroyed = true;
    this._abort.abort();
    // Подписка на настройку живёт в общем менеджере настроек — без
    // отписки он держал бы этот объект после ухода со страницы
    if (typeof this._unsubEnded === 'function') this._unsubEnded();
    this._unsubEnded = null;
  }

  async init() {
    this.bindControls();
    await this.load();
  }

  bindControls() {
    const signal = this._abort.signal;

    // Сегменты: выбранный отмечен и классом, и aria-pressed — по второму
    // экранный диктор понимает, что сейчас показано
    const select = (buttons, chosen) => buttons.forEach(b => {
      b.classList.toggle('active', b === chosen);
      b.setAttribute('aria-pressed', String(b === chosen));
    });

    const filters = [...document.querySelectorAll('.calendar-filter')];
    filters.forEach(btn => {
      btn.addEventListener('click', () => {
        select(filters, btn);
        this.filter = btn.dataset.filter;
        this.render();
      }, { signal });
    });

    const ranges = [...document.querySelectorAll('.calendar-days')];
    ranges.forEach(btn => {
      btn.addEventListener('click', () => {
        select(ranges, btn);
        this.days = Number(btn.dataset.days) || 7;
        this.render();
      }, { signal });
    });

    document.getElementById('calendar-refresh')?.addEventListener('click', () => this.load(true), { signal });

    // «Завершённые» — та же настройка showExpiredCampaigns, что раньше
    // жила в настройках: переключатель стоит там, где виден результат
    document.getElementById('calendar-show-ended')?.addEventListener('click', () => {
      if (typeof window.settings?.set !== 'function') return;
      window.settings.set('showExpiredCampaigns', !this.includeEnded);
      // Перерисовку делает подписка ниже; без менеджера с подпиской —
      // сами, чтобы нажатие не осталось без ответа
      if (typeof this._unsubEnded !== 'function') {
        this.syncEndedChip();
        this.render();
      }
    }, { signal });

    if (typeof window.settings?.onChange === 'function') {
      this._unsubEnded = window.settings.onChange('showExpiredCampaigns', () => {
        if (this._destroyed) return;
        this.syncEndedChip();
        this.render();
      });
    }
    this.syncEndedChip();
  }

  /** Состояние чипа «Завершённые» — по настройке. */
  syncEndedChip() {
    const chip = document.getElementById('calendar-show-ended');
    if (chip) chip.setAttribute('aria-pressed', String(this.includeEnded));
  }

  /**
   * Забирает кампании из двух источников и склеивает.
   *
   * Замер показал, что запрос инвентаря отдаёт всё нужное — сто с лишним
   * кампаний вместе с ещё не начавшимися, — а dashboard-запрос на
   * практике возвращает пустой список. Поэтому инвентарь идёт первым,
   * а второй источник лишь дополняет.
   */
  async load(manual = false) {
    // При ручном обновлении список остаётся на месте, а крутится кнопка:
    // раньше страница сменялась надписью «Обновляю…» и прыгала
    const refresh = document.getElementById('calendar-refresh');
    const page = document.querySelector('.calendar-page');
    if (manual) {
      refresh?.classList.add('is-loading');
      if (refresh) refresh.disabled = true;
      page?.classList.add('is-refreshing');
    }

    this.loading = true;
    let живые;
    try {
      this.categories = (await Storage.getCategories().catch(() => [])) || [];

      // Запросы независимы: отказ одного не должен лишать нас второго.
      // Инвентарь идёт первым, потому что на практике отдаёт всё (включая
      // ещё не начавшиеся кампании), а dashboard-запрос почти всегда
      // возвращает пустой список.
      const inventory = await window.electronAPI.fetchDropsInventory(manual ? { force: true } : undefined)
        .then(r => this.normalize(r))
        .catch(e => { console.warn('[Календарь] Инвентарь не ответил:', e?.message); return []; });

      const dashboard = await window.electronAPI.fetchTwitchDrops()
        .then(r => this.normalize(r))
        .catch(e => { console.warn('[Календарь] Список кампаний не ответил:', e?.message); return []; });

      // Склеиваем по идентификатору, чтобы одна кампания не задвоилась
      const byId = new Map();
      for (const campaign of [...inventory, ...dashboard]) {
        const key = campaign?.id || this.gameName(campaign);
        if (key && !byId.has(key)) byId.set(key, campaign);
      }

      живые = [...byId.values()];

      // Запоминаем увиденное: Twitch выбрасывает закончившиеся кампании из
      // ответа, и без своей памяти показать их было бы неоткуда
      await window.CampaignHistory.remember(живые, Date.now(), { force: manual });

      // Дополняем памятью приложения.
      //
      // Оба запроса работают только с cookie-токеном и Client-Integrity, а те
      // появляются лишь после того, как в приложении запустится стрим. Без
      // него календарь оказывался пустым — «кампании не загрузились», хотя
      // приложение прекрасно знало о сотне с лишним из прошлых запусков.
      // Живые данные главнее: память лишь добавляет то, чего в них нет.
      //
      // Из памяти берём только незавершённые: завершённые приходят отдельно
      // через loadEnded и подмешиваются по настройке. Раньше память
      // подмешивалась целиком, и при включённой настройке каждая завершённая
      // кампания стояла в списке дважды, а счётчик «из памяти» считал их
      // всегда — предупреждение висело даже при свежих данных.
      const сейчас = Date.now();
      const память = await window.CampaignHistory.loadKnown();
      for (const campaign of память) {
        if (this.isEnded(campaign, сейчас)) continue;
        const key = campaign?.id || this.gameName(campaign);
        if (key && !byId.has(key)) byId.set(key, campaign);
      }

      this.campaigns = [...byId.values()];
      this.liveCount = живые.length;
      this.ended = await window.CampaignHistory.loadEnded(сейчас);
    } finally {
      this.loading = false;
      refresh?.classList.remove('is-loading');
      if (refresh) refresh.disabled = false;
      page?.classList.remove('is-refreshing');
    }

    console.log('[Календарь] Кампаний:', this.campaigns.length,
      '(живых:', живые.length + ', из памяти:', (this.campaigns.length - живые.length) + ')');

    this.render();
  }

  /** Приводит разные формы ответа к простому списку кампаний. */
  normalize(result) {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.campaigns)) return result.campaigns;
    return [];
  }

  gameName(campaign) {
    return campaign.game?.displayName || campaign.game?.name || campaign.name || '';
  }

  /**
   * Название самой кампании, если оно отличается от игры.
   *
   * У одной игры бывает несколько кампаний сразу, и строки с одним только
   * названием игры выглядели как дубли.
   */
  campaignTitle(campaign) {
    const title = String(campaign?.name || '').trim();
    const game = this.gameName(campaign);
    if (!title || title.toLowerCase() === String(game).trim().toLowerCase()) return '';
    return title;
  }

  /** Срок кампании уже прошёл — то же правило, что у CampaignHistory.ended. */
  isEnded(campaign, now) {
    const ends = new Date(campaign?.endsAt).getTime();
    return Number.isFinite(ends) && ends <= now;
  }

  /**
   * Форма слова по числу: 1 кампания, 3 кампании, 5 кампаний.
   * Общий хелпер из DOMHelpers берётся, когда он есть.
   */
  plural(n, one, few, many) {
    if (typeof window.DOMHelpers?.plural === 'function') {
      return window.DOMHelpers.plural(n, one, few, many);
    }
    const abs = Math.abs(Math.trunc(Number(n) || 0));
    const mod100 = abs % 100;
    const mod10 = abs % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  /** Иконка из общего набора; до его загрузки — пустая строка. */
  icon(name, size = 16) {
    return window.Icons?.get(name, size) ?? '';
  }

  /**
   * Остаток времени полными словами: «3 д 4 ч», «1 ч 23 мин», «17 мин».
   * У CampaignCalendar.formatLeft сокращения «1ч 23м» — в строке списка
   * среди обычного текста они читались как опечатка.
   */
  formatLeft(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 'завершена';

    const days = Math.floor(minutes / 1440);
    if (days >= 1) {
      const hours = Math.floor((minutes - days * 1440) / 60);
      return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
    }

    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    if (hours > 0) return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
    return `${Math.max(1, rest)} мин`;
  }

  /** Есть ли эта игра в списке категорий пользователя. */
  isMine(campaign) {
    const game = this.gameName(campaign);
    if (!game) return false;

    return this.categories.some(cat => this.isSameCategoryGame(cat, game, campaign.game?.id));
  }

  /**
   * Та ли это игра — по тому же правилу, что у фарминга: id Twitch или
   * точное название. Сравнение по началу названия путало «World of Tanks»
   * и «World of Tanks Console»: чужая кампания стояла «В списке», а
   * добавить нужную игру было нельзя.
   */
  isSameCategoryGame(cat, game, gameId) {
    const SP = window.StreamPicker;
    if (typeof SP?.isExactGame === 'function') return SP.isExactGame(cat?.name, game, cat?.id, gameId);
    return SP.isSameGame(cat?.name, game);
  }

  /** Показывать ли кампании, которые уже закончились. */
  get includeEnded() {
    return window.settings?.get('showExpiredCampaigns') === true;
  }

  /** Все кампании с наградами — до фильтра «Все / Мои / Новые». */
  baseCampaigns() {
    // Завершённые берутся из своей памяти и подмешиваются, только когда
    // об этом попросили настройкой
    const источник = this.includeEnded
      ? [...this.campaigns, ...(this.ended || [])]
      : this.campaigns;

    // Twitch ещё какое-то время отдаёт только что закончившуюся кампанию,
    // и она же лежит в памяти завершённых — показываем один раз, живую
    const seen = new Set();
    return источник.filter(c => {
      if (!Array.isArray(c?.drops) || c.drops.length === 0) return false;
      if (!c.id) return true;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }

  visibleCampaigns(list = this.baseCampaigns()) {
    if (this.filter === 'mine') return list.filter(c => this.isMine(c));
    if (this.filter === 'new') return list.filter(c => !this.isMine(c));
    return list;
  }

  /** Числа в сегментах фильтра: сколько кампаний за каждым вариантом. */
  renderCounts(base) {
    const mine = base.filter(c => this.isMine(c)).length;
    const counts = { all: base.length, mine, new: base.length - mine };
    // Пока кампании не загружены, нули обманывали бы
    const known = !this.loading || base.length > 0;
    document.querySelectorAll('.calendar-filters [data-count]').forEach(el => {
      el.textContent = known ? String(counts[el.dataset.count] ?? '') : '';
    });
  }

  /**
   * Предупреждение о данных из памяти — отдельной тихой строкой, а не
   * жёлтой рамкой посреди сводки.
   */
  renderWarn() {
    const warn = document.getElementById('calendar-warn');
    const text = document.getElementById('calendar-warn-text');
    if (!warn || !text) return;

    // В this.campaigns память добавляет только идущие и будущие кампании,
    // так что разница — ровно то, чего Twitch сейчас не подтвердил
    const total = this.campaigns.length;
    const изПамяти = Math.max(0, total - (this.liveCount || 0));

    if (total === 0 || изПамяти === 0) {
      warn.hidden = true;
      return;
    }

    text.textContent = изПамяти >= total
      ? 'Кампании из памяти приложения: свежий список Twitch присылает только после запуска стрима.'
      : `${изПамяти} ${this.plural(изПамяти, 'кампания', 'кампании', 'кампаний')} из памяти приложения — ` +
        'Twitch подтвердит их после запуска стрима.';
    warn.hidden = false;
  }

  /**
   * Сводка справа от фильтров: что горит. Группы ниже отвечают на тот же
   * вопрос, но на первом экране их не видно — лента занимает его целиком.
   */
  renderSummary(groups) {
    const summary = document.getElementById('calendar-summary');
    if (!summary) return;

    const phrase = (n, when) => `${n} ${this.plural(n, 'кампания', 'кампании', 'кампаний')} ` +
      `${this.plural(n, 'заканчивается', 'заканчиваются', 'заканчиваются')} ${when}`;

    if (!groups) summary.textContent = '';
    else if (groups.today.length > 0) summary.textContent = phrase(groups.today.length, 'сегодня');
    else if (groups.tomorrow.length > 0) summary.textContent = phrase(groups.tomorrow.length, 'завтра');
    else if (groups.week.length > 0) summary.textContent = phrase(groups.week.length, 'на этой неделе');
    else summary.textContent = '';
  }

  render() {
    // Загрузка могла закончиться уже после ухода со страницы
    if (this._destroyed) return;

    const body = document.getElementById('calendar-body');
    if (!body) return;

    const CC = window.CampaignCalendar;
    const now = Date.now();
    const base = this.baseCampaigns();
    const visible = this.visibleCampaigns(base);

    this.renderCounts(base);
    this.renderWarn();
    this.syncEndedChip();

    // Первая загрузка ещё идёт: скелетон ленты остаётся на месте
    if (this.loading && this.campaigns.length === 0) return;

    if (visible.length === 0) {
      // Лента от прошлого фильтра не должна оставаться на экране
      const card = document.getElementById('calendar-timeline-card');
      if (card) card.style.display = 'none';
      this.renderSummary(null);

      const empty = window.DOMHelpers?.emptyState
        ? (opts) => window.DOMHelpers.emptyState(opts)
        : ({ title, text }) => `<div class="empty-state"><h3>${title}</h3><p>${text}</p></div>`;

      body.innerHTML = `<div class="card calendar-empty">${this.campaigns.length === 0
        ? empty({
            icon: 'calendar',
            title: 'Кампаний пока нет',
            text: 'Twitch отдаёт список только после того, как в приложении запустится стрим. Запустите фарминг — и календарь наполнится.'
          })
        : empty({
            icon: 'filter',
            title: 'Под этот фильтр ничего не подходит',
            text: this.filter === 'mine'
              ? 'Ни у одной игры из вашего списка сейчас нет кампаний.'
              : (this.filter === 'new'
                  ? 'Все игры с кампаниями уже есть в вашем списке.'
                  : 'Сейчас нет кампаний с наградами.'),
            actionHtml: this.filter !== 'all'
              ? '<button type="button" class="btn btn-secondary btn-sm" data-calendar-reset>Показать все кампании</button>'
              : ''
          })}</div>`;

      body.querySelector('[data-calendar-reset]')?.addEventListener('click', () => {
        document.querySelector('.calendar-filter[data-filter="all"]')?.click();
      });
      return;
    }

    this.renderTimeline(visible, now);

    const groups = CC.group(visible, now, { includeEnded: this.includeEnded });
    this.renderSummary(groups);

    body.innerHTML = CC.ORDER
      .filter(key => groups[key].length > 0)
      .map(key => `
        <section class="card calendar-group">
          <div class="card-header calendar-group-head">
            <h2 class="card-title calendar-group-title">${CC.TITLES[key]}
              <span class="badge calendar-group-count">${groups[key].length}</span></h2>
          </div>
          <div class="list calendar-list">
            ${groups[key].map(c => this.renderCampaign(c, key, now)).join('')}
          </div>
        </section>
      `)
      .join('');

    body.querySelectorAll('[data-add-game]').forEach(btn => {
      btn.addEventListener('click', () => this.addCategory(btn.dataset.addGame, btn, btn.dataset.addGameId || ''));
    });
  }

  /**
   * Лента времени: каждая кампания — полоса от начала до конца.
   *
   * Списки по группам отвечают на вопрос «что горит», а лента — на
   * вопрос «как всё это накладывается друг на друга»: сразу видно, что
   * три кампании кончаются в один день, а между ними есть просвет.
   *
   * Полосы нейтральные: 51 одинаковая фиолетовая полоса ничего не
   * выделяла. Цвет получают только «не успеть» (янтарь), ещё не
   * начавшиеся (контур) и свои — когда в ленте есть и чужие.
   */
  renderTimeline(campaigns, now) {
    const host = document.getElementById('calendar-timeline');
    const card = document.getElementById('calendar-timeline-card');
    if (!host) return;

    const CC = window.CampaignCalendar;
    const layout = CC.timelineBars(campaigns, { now, days: this.days });

    if (layout.bars.length === 0) {
      if (card) card.style.display = 'none';
      return;
    }
    if (card) card.style.display = '';

    const escape = (t) => String(t ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

    // Подписи дней при узком окне ставим не у каждого деления, иначе
    // они наезжают друг на друга
    const step = this.days <= 7 ? 1 : (this.days <= 14 ? 2 : 5);

    // Подпись стоит по центру деления, и у правого края ленты половина её
    // уходила под обрезку #calendar-timeline: вместо «21 окт.» читалось
    // «21 (». Крайнюю правую подпись прижимаем к делению слева. Левой
    // обрезка не грозит: перед лентой есть колонка названий.
    const labelShift = (at) => at > 92 ? ' transform: translateX(-100%);' : '';

    const ticks = layout.ticks.map((tick, i) => `
      <div class="tl-tick ${tick.weekend ? 'weekend' : ''}" style="left: ${tick.at}%"></div>
      ${i % step === 0 ? `<div class="tl-label" style="left: ${tick.at}%;${labelShift(tick.at)}">${escape(tick.label)}</div>` : ''}
    `).join('');

    // «Мои» имеет смысл выделять, только когда рядом есть чужие: при
    // автофарме в списке все игры, и выделенными оказались бы все полосы.
    // Класс ставится всем своим, а цвет включает .tl-mixed на ленте
    const mineFlags = layout.bars.map(bar => this.isMine(bar.campaign));
    const mixed = mineFlags.some(Boolean) && mineFlags.some(flag => !flag);

    const LIMIT = CalendarPage.TIMELINE_ROWS;
    const expanded = this.timelineExpanded && layout.bars.length > LIMIT;
    const видимые = expanded ? layout.bars : layout.bars.slice(0, LIMIT);

    const legend = { late: false, upcoming: false };

    const rows = видимые.map(bar => {
      const game = this.gameName(bar.campaign);
      const mine = this.isMine(bar.campaign);
      const value = window.CampaignValue.evaluate(bar.campaign, now);
      const late = value.reason === 'tooLate';
      if (late) legend.late = true;
      if (bar.upcoming) legend.upcoming = true;

      const classes = [
        'tl-bar',
        mine ? 'mine' : '',
        bar.upcoming ? 'upcoming' : '',
        late ? 'late' : '',
        bar.clippedEnd ? 'clipped-end' : ''
      ].filter(Boolean).join(' ');

      // Слева — игра, на самой полосе — название кампании: несколько
      // кампаний одной игры иначе выглядели одинаковыми строками
      const title = this.campaignTitle(bar.campaign);
      const fullName = title ? `${game} — ${title}` : game;

      const hint = bar.upcoming
        ? `${fullName} · начнётся ${new Date(bar.campaign.startsAt || bar.campaign.startAt).toLocaleString('ru-RU')}`
        : `${fullName} · до конца ${this.formatLeft(value.minutesLeft)}${late ? ' · все награды уже не успеть' : ''}${bar.clippedEnd ? ' (уходит за край ленты)' : ''}`;

      return `
        <div class="tl-row">
          <div class="tl-name" title="${escape(fullName)}">${escape(game)}</div>
          <div class="tl-track">
            <div class="${classes}" style="left: ${bar.left}%; width: ${bar.width}%" title="${escape(hint)}">
              <span class="tl-bar-text">${escape(title || game)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Молча обрезать список нельзя: иначе кажется, что кампаний меньше.
    // Вместо строки «ещё 11 не поместились» — кнопка, которая их показывает
    const total = layout.bars.length;
    const more = total > LIMIT
      ? `<button type="button" class="btn btn-ghost btn-sm tl-more" aria-expanded="${expanded}">
          ${expanded ? 'Свернуть' : `Показать все (${total})`}
          ${this.icon(expanded ? 'chevron-up' : 'chevron-down', 14)}
        </button>`
      : '';

    // Легенда — только для того, что есть на ленте сейчас
    const keys = [
      '<span class="tl-key"><i class="tl-swatch is-now"></i>сейчас</span>',
      mixed ? '<span class="tl-key"><i class="tl-swatch is-mine"></i>в вашем списке</span>' : '',
      legend.late ? '<span class="tl-key"><i class="tl-swatch is-late"></i>не успеть</span>' : '',
      legend.upcoming ? '<span class="tl-key"><i class="tl-swatch is-upcoming"></i>ещё не началась</span>' : ''
    ].filter(Boolean).join('');

    host.classList.toggle('tl-mixed', mixed);
    host.innerHTML = `
      <div class="tl-chart">
        <div class="tl-scale">
          <div class="tl-name"></div>
          <div class="tl-track">${ticks}</div>
        </div>
        <div class="tl-rows">
          ${rows}
          <div class="tl-now" style="left: calc(var(--tl-name-width) + var(--tl-gap) + (100% - var(--tl-name-width) - var(--tl-gap)) * ${layout.nowAt / 100})"></div>
        </div>
      </div>
      <div class="tl-foot">
        <div class="tl-legend">${keys}</div>
        ${more}
      </div>
    `;

    host.querySelector('.tl-more')?.addEventListener('click', () => {
      this.timelineExpanded = !expanded;
      this.renderTimeline(campaigns, now);
      host.querySelector('.tl-more')?.focus();
    });
  }

  /**
   * Обложка игры в строке. Слот держит размер и серую подложку со
   * значком: пока картинка грузится или если её нет, строка не прыгает.
   */
  coverHtml(url) {
    const escape = (t) => String(t ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
    return `<span class="stats-cover calendar-art" aria-hidden="true">${this.icon('gamepad', 14)}${url
      ? `<img src="${escape(url)}" alt="" loading="lazy" onerror="this.hidden=true">`
      : ''}</span>`;
  }

  renderCampaign(campaign, bucket, now) {
    const CV = window.CampaignValue;

    const game = this.gameName(campaign);
    const mine = this.isMine(campaign);
    const value = CV.evaluate(campaign, now);

    const art = window.farmingPage?.normalizeBoxArtURL
      ? window.farmingPage.normalizeBoxArtURL(campaign.game?.boxArtURL, '52x72')
      : (campaign.game?.boxArtURL || '');

    const escape = (t) => String(t ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

    // Для ещё не начавшихся важен срок начала, а не остаток
    const upcoming = bucket === 'upcoming';
    const ended = bucket === 'ended';

    const when = upcoming
      ? 'старт ' + new Date(campaign.startsAt || campaign.startAt)
          .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      : (ended
          ? 'закончилась ' + new Date(campaign.endsAt || campaign.endAt)
              .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
          : 'до конца ' + this.formatLeft(value.minutesLeft));

    const drops = (campaign.drops || []).length;
    const left = CV.unclaimedDrops(campaign).length;

    // После «из» число стоит в родительном падеже: из 1 награды, из 5 наград
    const dropsWord = this.plural(drops, 'награды', 'наград', 'наград');
    const perHourText = value.perHour > 0
      ? `${value.perHour} ${this.plural(value.perHour, 'награда', 'награды', 'наград')} за час`
      : '';

    // Всё уже получено — так и сказано, а не «осталось 0 из 4». У
    // закончившейся кампании ничего не «осталось» — только итог
    const dropsText = left === 0 && drops > 0
      ? `<span class="tone-ok">все награды получены</span>`
      : (ended
          ? `<span>получено ${drops - left} из ${drops}</span>`
          : `<span>${this.plural(left, 'осталась', 'осталось', 'осталось')} ${left} из ${drops} ${dropsWord}</span>`);

    // Бейдж — одна главная оценка: «не успеть» важнее скорости
    const badge = ended
      ? ''
      : (!upcoming && value.reason === 'tooLate'
          ? '<span class="badge badge-warning calendar-tag late">Не успеть</span>'
          : (!upcoming && perHourText
              ? `<span class="badge badge-success calendar-tag">${perHourText}</span>`
              : ''));

    // Название кампании рядом с игрой: у одной игры их бывает несколько
    const title = this.campaignTitle(campaign);
    const fullName = title ? `${game} — ${title}` : game;
    const hopeless = value.reason === 'tooLate' || ended;

    return `
      <div class="list-row calendar-item ${hopeless ? 'hopeless' : ''}">
        ${this.coverHtml(art)}
        <div class="row-main calendar-info">
          <div class="row-title calendar-name" title="${escape(fullName)}">${escape(game)}${title
            ? `<span class="calendar-campaign"> · ${escape(title)}</span>`
            : ''}</div>
          <div class="row-meta calendar-meta">
            <span class="calendar-when ${upcoming ? 'upcoming' : ''}">${escape(when)}</span>
            ${dropsText}
            ${badge}
          </div>
        </div>
        <div class="calendar-action">
          ${mine
            ? `<span class="badge calendar-owned">${this.icon('check', 12)}В списке</span>`
            : `<button type="button" class="btn btn-secondary btn-sm calendar-add" data-add-game="${escape(game)}" data-add-game-id="${escape(campaign.game?.id || '')}">${this.icon('plus', 14)}<span>Добавить</span></button>`}
        </div>
      </div>
    `;
  }

  /**
   * Страница фарминга, которая держит список категорий в памяти.
   *
   * Она переживает переходы между вкладками и при сохранении пишет свой
   * список целиком. Если календарь писал в хранилище в обход неё, то
   * первое же сохранение на фарминге затирало добавленную игру: она молча
   * пропадала и не фармилась.
   */
  farmingOwner() {
    const page = window.farmingPage;
    if (!page || page._destroyed) return null;
    if (typeof page.addCategory !== 'function' || !Array.isArray(page.categories)) return null;
    return page;
  }

  /**
   * Запасной id для игры, которой не нашлось в ответе Twitch.
   *
   * Только буквы и цифры: id подставляется в разметку и обработчики окна
   * категории, и кавычка из названия (например, «Assassin's Creed»)
   * ломала их. Буквы любого алфавита оставляем, чтобы разные русские
   * названия не схлопнулись в один и тот же id.
   */
  fallbackCategoryId(game) {
    const slug = String(game).toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
    return 'cal-' + (slug || Date.now().toString(36));
  }

  /** Добавляет игру в список категорий и сразу отмечает, что дропсы есть. */
  async addCategory(game, button, gameId = '') {
    if (!game) return;

    // Кольцо вместо подписи «Добавляю…»: ширина кнопки не прыгает
    button.disabled = true;
    button.classList.add('is-loading');

    try {
      const farming = this.farmingOwner();

      // Дубль проверяем по тому списку, который потом будет сохранён:
      // у живой страницы фарминга он свежее хранилища
      const categories = farming
        ? farming.categories
        : ((await Storage.getCategories()) || []);

      if (categories.some(c => this.isSameCategoryGame(c, game, gameId))) {
        window.utils?.showToast('Категория уже в списке', 'info');
        // Кнопка не должна залипать в ожидании: перерисовка покажет
        // «В списке» на месте кнопки
        this.categories = [...categories];
        this.render();
        return;
      }

      // Свежие данные Twitch дают обложку и число зрителей; без них
      // категория тоже работает, просто выглядит беднее
      let fresh = null;
      try {
        const all = await window.electronAPI.fetchTwitchCategories();
        fresh = (all || []).find(c => this.isSameCategoryGame(c, game, gameId)) || null;
      } catch (e) {
        // не критично
      }

      const entry = {
        id: fresh?.id || this.fallbackCategoryId(game),
        name: fresh?.name || game,
        boxArtURL: fresh?.boxArtURL || '',
        viewersCount: fresh?.viewersCount || 0,
        tags: fresh?.tags || [],
        hasDrops: true,
        enabled: true,
        priority: categories.length + 1,
        dropsCompleted: false
      };

      // За время запроса к Twitch страница фарминга могла появиться
      // или пропасть — решаем по текущему состоянию
      const owner = this.farmingOwner();

      if (owner) {
        // Добавляет сама страница фарминга: её список в памяти, хранилище
        // и экран остаются согласованными. Об успехе она сообщает сама.
        await owner.addCategory(entry);
        this.categories = [...owner.categories];
      } else {
        // Фарминг ещё не открывали — он прочитает хранилище при запуске.
        // Событие — для тех, кто уже держит список и должен его перечитать.
        const next = [...categories, entry];
        await Storage.saveCategories(next);
        this.categories = next;
        window.dispatchEvent(new CustomEvent('wt:categories-changed'));
        window.utils?.showToast(`«${game}» добавлена в категории`, 'success');
      }

      this.render();
    } catch (error) {
      console.error('[Календарь] Не удалось добавить категорию:', error);
      window.utils?.showToast('Не удалось добавить категорию', 'error');
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  }
}

window.CalendarPage = CalendarPage;
