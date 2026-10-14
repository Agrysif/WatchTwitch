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

    // Обработчики снимаются одним сигналом при уходе со страницы: раньше
    // объект календаря оставался жить после каждого захода вместе с ними
    this._abort = new AbortController();
    this._destroyed = false;

    this.init();
  }

  /** Освобождение при уходе со страницы (зовёт Router). */
  destroy() {
    this._destroyed = true;
    this._abort.abort();
  }

  async init() {
    this.bindControls();
    await this.load();
  }

  bindControls() {
    const signal = this._abort.signal;

    document.querySelectorAll('.calendar-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.calendar-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filter = btn.dataset.filter;
        this.render();
      }, { signal });
    });

    document.querySelectorAll('.calendar-days').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.calendar-days').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.days = Number(btn.dataset.days) || 7;
        this.render();
      }, { signal });
    });

    document.getElementById('calendar-refresh')?.addEventListener('click', () => this.load(true), { signal });
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
    const body = document.getElementById('calendar-body');
    if (manual && body) {
      body.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--text-secondary)">Обновляю…</div>';
    }

    this.loading = true;
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

    const живые = [...byId.values()];

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

    this.loading = false;

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

  visibleCampaigns() {
    // Завершённые берутся из своей памяти и подмешиваются, только когда
    // об этом попросили настройкой
    const источник = this.includeEnded
      ? [...this.campaigns, ...(this.ended || [])]
      : this.campaigns;

    // Twitch ещё какое-то время отдаёт только что закончившуюся кампанию,
    // и она же лежит в памяти завершённых — показываем один раз, живую
    const seen = new Set();
    const list = источник.filter(c => {
      if (!Array.isArray(c?.drops) || c.drops.length === 0) return false;
      if (!c.id) return true;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    if (this.filter === 'mine') return list.filter(c => this.isMine(c));
    if (this.filter === 'new') return list.filter(c => !this.isMine(c));
    return list;
  }

  render() {
    // Загрузка могла закончиться уже после ухода со страницы
    if (this._destroyed) return;

    const body = document.getElementById('calendar-body');
    const summary = document.getElementById('calendar-summary');
    if (!body) return;

    const CC = window.CampaignCalendar;
    const now = Date.now();
    const visible = this.visibleCampaigns();

    if (summary) {
      const мои = this.campaigns.filter(c => this.isMine(c)).length;
      // В this.campaigns память добавляет только идущие и будущие кампании,
      // так что разница — ровно то, чего Twitch сейчас не подтвердил
      const изПамяти = Math.max(0, this.campaigns.length - (this.liveCount || 0));

      summary.innerHTML = this.campaigns.length === 0
        ? ''
        : `Кампаний видно: <b>${this.campaigns.length}</b> · в вашем списке: <b>${мои}</b>` +
          (изПамяти > 0
            ? ` <span class="calendar-warn">${изПамяти} из памяти приложения — запустите стрим, чтобы обновить</span>`
            : '');
    }

    if (visible.length === 0) {
      body.innerHTML = `
        <div class="card" style="text-align:center;padding:40px;color:var(--text-secondary)">
          ${this.loading
            ? 'Загружаю кампании…'
            : (this.campaigns.length === 0
                ? 'Кампаний пока нет. Twitch отдаёт список только после того, как в приложении запустится стрим — запустите фарминг, и календарь наполнится.'
                : 'Под этот фильтр ничего не подходит')}
        </div>`;
      return;
    }

    this.renderTimeline(visible, now);

    const groups = CC.group(visible, now, { includeEnded: this.includeEnded });

    body.innerHTML = CC.ORDER
      .filter(key => groups[key].length > 0)
      .map(key => `
        <div class="card calendar-group">
          <div class="calendar-group-head">
            <span class="calendar-group-title">${CC.TITLES[key]}</span>
            <span class="calendar-group-count">${groups[key].length}</span>
          </div>
          <div class="calendar-list">
            ${groups[key].map(c => this.renderCampaign(c, key, now)).join('')}
          </div>
        </div>
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

    const МАКСИМУМ = 40;
    const видимые = layout.bars.slice(0, МАКСИМУМ);

    const rows = видимые.map(bar => {
      const game = this.gameName(bar.campaign);
      const mine = this.isMine(bar.campaign);
      const value = window.CampaignValue.evaluate(bar.campaign, now);

      const classes = [
        'tl-bar',
        mine ? 'mine' : '',
        bar.upcoming ? 'upcoming' : '',
        value.reason === 'tooLate' ? 'late' : '',
        bar.clippedEnd ? 'clipped-end' : ''
      ].filter(Boolean).join(' ');

      // Слева — игра, на самой полосе — название кампании: несколько
      // кампаний одной игры иначе выглядели одинаковыми строками
      const title = this.campaignTitle(bar.campaign);
      const fullName = title ? `${game} — ${title}` : game;

      const hint = bar.upcoming
        ? `${fullName} · начнётся ${new Date(bar.campaign.startsAt || bar.campaign.startAt).toLocaleString('ru-RU')}`
        : `${fullName} · осталось ${CC.formatLeft(value.minutesLeft)}${bar.clippedEnd ? ' (уходит за край ленты)' : ''}`;

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

    // Молча обрезать список нельзя: иначе кажется, что кампаний меньше
    const hidden = layout.bars.length - видимые.length;
    // Одна кампания — «она есть», а не «они есть»
    const hiddenText = `Ещё ${hidden} ${this.plural(hidden, 'кампания', 'кампании', 'кампаний')} ` +
      `${this.plural(hidden, 'не поместилась', 'не поместились', 'не поместились')} — ` +
      `${hidden === 1 ? 'она есть' : 'они есть'} в списках ниже`;

    host.innerHTML = `
      <div class="tl-scale">
        <div class="tl-name"></div>
        <div class="tl-track">${ticks}</div>
      </div>
      <div class="tl-rows">
        ${rows}
        <div class="tl-now" style="left: calc(var(--tl-name-width) + (100% - var(--tl-name-width)) * ${layout.nowAt / 100})"></div>
      </div>
      ${hidden > 0 ? `<div class="tl-hidden">${hiddenText}</div>` : ''}
    `;
  }

  renderCampaign(campaign, bucket, now) {
    const CV = window.CampaignValue;
    const CC = window.CampaignCalendar;

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
          : CC.formatLeft(value.minutesLeft));

    const drops = (campaign.drops || []).length;
    const left = CV.unclaimedDrops(campaign).length;

    // После «из» число стоит в родительном падеже: из 1 награды, из 5 наград
    const dropsWord = this.plural(drops, 'награды', 'наград', 'наград');
    const perHourText = value.perHour > 0
      ? `${value.perHour} ${this.plural(value.perHour, 'награда', 'награды', 'наград')} за час`
      : '';

    // Название кампании рядом с игрой: у одной игры их бывает несколько
    const title = this.campaignTitle(campaign);
    const fullName = title ? `${game} — ${title}` : game;

    return `
      <div class="calendar-item ${value.reason === 'tooLate' || ended ? 'hopeless' : ''}">
        ${art ? `<img class="calendar-art" src="${escape(art)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
        <div class="calendar-info">
          <div class="calendar-name" title="${escape(fullName)}">${escape(game)}${title
            ? `<span style="font-weight: 400; color: var(--text-secondary);"> · ${escape(title)}</span>`
            : ''}</div>
          <div class="calendar-meta">
            <span class="calendar-when ${upcoming ? 'upcoming' : ''}">${escape(when)}</span>
            <span>${this.plural(left, 'осталась', 'осталось', 'осталось')} ${left} из ${drops} ${dropsWord}</span>
            ${ended
              ? ''
              : (!upcoming && value.reason === 'tooLate'
                  ? '<span class="calendar-tag late">Не успеть</span>'
                  : (!upcoming && perHourText
                      ? `<span class="calendar-tag">${perHourText}</span>`
                      : ''))}
          </div>
        </div>
        ${mine
          ? '<span class="calendar-owned">В списке</span>'
          : `<button class="btn btn-secondary calendar-add" data-add-game="${escape(game)}" data-add-game-id="${escape(campaign.game?.id || '')}">Добавить</button>`}
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

    button.disabled = true;
    button.textContent = 'Добавляю…';

    try {
      const farming = this.farmingOwner();

      // Дубль проверяем по тому списку, который потом будет сохранён:
      // у живой страницы фарминга он свежее хранилища
      const categories = farming
        ? farming.categories
        : ((await Storage.getCategories()) || []);

      if (categories.some(c => this.isSameCategoryGame(c, game, gameId))) {
        window.utils?.showToast('Категория уже в списке', 'info');
        // Кнопка не должна залипать в «Добавляю…»: перерисовка покажет
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
      button.textContent = 'Добавить';
    }
  }
}

window.CalendarPage = CalendarPage;
