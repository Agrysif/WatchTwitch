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

    this.init();
  }

  async init() {
    this.bindControls();
    await this.load();
  }

  bindControls() {
    document.querySelectorAll('.calendar-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.calendar-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filter = btn.dataset.filter;
        this.render();
      });
    });

    document.querySelectorAll('.calendar-days').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.calendar-days').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.days = Number(btn.dataset.days) || 7;
        this.render();
      });
    });

    document.getElementById('calendar-refresh')?.addEventListener('click', () => this.load(true));
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
    const inventory = await window.electronAPI.fetchDropsInventory()
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

    this.campaigns = [...byId.values()];
    this.loading = false;

    console.log('[Календарь] Кампаний:', this.campaigns.length,
      '(инвентарь:', inventory.length + ', список:', dashboard.length + ')');

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

  /** Есть ли эта игра в списке категорий пользователя. */
  isMine(campaign) {
    const game = this.gameName(campaign);
    if (!game) return false;

    const SP = window.StreamPicker;
    return this.categories.some(cat => SP.isSameGame(cat.name, game));
  }

  visibleCampaigns() {
    const list = this.campaigns.filter(c => Array.isArray(c.drops) && c.drops.length > 0);

    if (this.filter === 'mine') return list.filter(c => this.isMine(c));
    if (this.filter === 'new') return list.filter(c => !this.isMine(c));
    return list;
  }

  render() {
    const body = document.getElementById('calendar-body');
    const summary = document.getElementById('calendar-summary');
    if (!body) return;

    const CC = window.CampaignCalendar;
    const now = Date.now();
    const visible = this.visibleCampaigns();

    if (summary) {
      const мои = this.campaigns.filter(c => this.isMine(c)).length;
      summary.innerHTML = this.campaigns.length === 0
        ? ''
        : `Кампаний видно: <b>${this.campaigns.length}</b> · в вашем списке: <b>${мои}</b>`;
    }

    if (visible.length === 0) {
      body.innerHTML = `
        <div class="card" style="text-align:center;padding:40px;color:var(--text-secondary)">
          ${this.loading
            ? 'Загружаю кампании…'
            : (this.campaigns.length === 0
                ? 'Кампании не загрузились. Запустите стрим — Twitch отдаёт список после этого.'
                : 'Под этот фильтр ничего не подходит')}
        </div>`;
      return;
    }

    this.renderTimeline(visible, now);

    const groups = CC.group(visible, now);

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
      btn.addEventListener('click', () => this.addCategory(btn.dataset.addGame, btn));
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

    const ticks = layout.ticks.map((tick, i) => `
      <div class="tl-tick ${tick.weekend ? 'weekend' : ''}" style="left: ${tick.at}%"></div>
      ${i % step === 0 ? `<div class="tl-label" style="left: ${tick.at}%">${escape(tick.label)}</div>` : ''}
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

      const hint = bar.upcoming
        ? `${game} · начнётся ${new Date(bar.campaign.startsAt || bar.campaign.startAt).toLocaleString('ru-RU')}`
        : `${game} · осталось ${CC.formatLeft(value.minutesLeft)}${bar.clippedEnd ? ' (уходит за край ленты)' : ''}`;

      return `
        <div class="tl-row">
          <div class="tl-name" title="${escape(game)}">${escape(game)}</div>
          <div class="tl-track">
            <div class="${classes}" style="left: ${bar.left}%; width: ${bar.width}%" title="${escape(hint)}">
              <span class="tl-bar-text">${escape(game)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Молча обрезать список нельзя: иначе кажется, что кампаний меньше
    const hidden = layout.bars.length - видимые.length;

    host.innerHTML = `
      <div class="tl-scale">
        <div class="tl-name"></div>
        <div class="tl-track">${ticks}</div>
      </div>
      <div class="tl-rows">
        ${rows}
        <div class="tl-now" style="left: calc(var(--tl-name-width) + (100% - var(--tl-name-width)) * ${layout.nowAt / 100})"></div>
      </div>
      ${hidden > 0 ? `<div class="tl-hidden">Ещё ${hidden} ${hidden === 1 ? 'кампания' : 'кампаний'} не поместилось — они есть в списках ниже</div>` : ''}
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
    const when = upcoming
      ? 'старт ' + new Date(campaign.startsAt || campaign.startAt)
          .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      : CC.formatLeft(value.minutesLeft);

    const drops = (campaign.drops || []).length;
    const left = CV.unclaimedDrops(campaign).length;

    return `
      <div class="calendar-item ${value.reason === 'tooLate' ? 'hopeless' : ''}">
        ${art ? `<img class="calendar-art" src="${escape(art)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
        <div class="calendar-info">
          <div class="calendar-name">${escape(game)}</div>
          <div class="calendar-meta">
            <span class="calendar-when ${upcoming ? 'upcoming' : ''}">${escape(when)}</span>
            <span>${left} из ${drops} наград осталось</span>
            ${!upcoming && value.reason === 'tooLate'
              ? '<span class="calendar-tag late">Не успеть</span>'
              : (!upcoming && value.perHour > 0
                  ? `<span class="calendar-tag">${value.perHour} за час</span>`
                  : '')}
          </div>
        </div>
        ${mine
          ? '<span class="calendar-owned">В списке</span>'
          : `<button class="btn btn-secondary calendar-add" data-add-game="${escape(game)}">Добавить</button>`}
      </div>
    `;
  }

  /** Добавляет игру в список категорий и сразу отмечает, что дропсы есть. */
  async addCategory(game, button) {
    if (!game) return;

    button.disabled = true;
    button.textContent = 'Добавляю…';

    try {
      const categories = (await Storage.getCategories()) || [];
      const SP = window.StreamPicker;

      if (categories.some(c => SP.isSameGame(c.name, game))) {
        window.utils?.showToast('Категория уже в списке', 'info');
        return;
      }

      // Свежие данные Twitch дают обложку и число зрителей; без них
      // категория тоже работает, просто выглядит беднее
      let fresh = null;
      try {
        const all = await window.electronAPI.fetchTwitchCategories();
        fresh = (all || []).find(c => SP.isSameGame(c.name, game)) || null;
      } catch (e) {
        // не критично
      }

      categories.push({
        id: fresh?.id || `cal-${game.toLowerCase().replace(/\s+/g, '-')}`,
        name: fresh?.name || game,
        boxArtURL: fresh?.boxArtURL || '',
        viewersCount: fresh?.viewersCount || 0,
        tags: fresh?.tags || [],
        hasDrops: true,
        enabled: true,
        priority: categories.length + 1,
        dropsCompleted: false
      });

      await Storage.saveCategories(categories);
      this.categories = categories;

      window.utils?.showToast(`«${game}» добавлена в категории`, 'success');
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
