/**
 * ПАНЕЛЬ ЖУРНАЛА и сводка «Пока вас не было» (window.eventLogUI).
 *
 * Журнал открывается кнопкой #journal-btn в заголовке окна и выезжает
 * справа поверх контента: страница под ним не перестраивается, и закрыть
 * его можно щелчком мимо или Esc. Точка/число #journal-badge — важные
 * события (награды, «всё собрано», ошибки, нет входа), которых пользователь
 * ещё не видел. Открыл журнал — увидел, значок гаснет.
 *
 * Сводка «Пока вас не было» отвечает на утренний вопрос «что было ночью»
 * одним взглядом, без пролистывания журнала. Показывается:
 *   — при первом действии в окне после двух часов без действий;
 *   — когда окно снова получает фокус после получаса в фоне (показ из
 *     трея, возврат из игры);
 *   — при запуске, если с прошлого раза накопились события.
 * На «Фарминге» это карточка в #away-summary-slot, на остальных страницах —
 * тост с кнопкой «Подробнее». Событий нет — ничего не показываем.
 *
 * Хранилище и API записи — в event-log.js.
 */
(function () {
  const AWAY_IDLE_MS = 2 * 60 * 60 * 1000;
  const AWAY_BLUR_MS = 30 * 60 * 1000;
  const STARTUP_DELAY_MS = 8000;
  // Что считаем в сводке
  const SUMMARY_TYPES = ['drop', 'chest', 'switch', 'error', 'login', 'all-done'];
  // Ради чего её вообще показывать. Одни сундуки — нет: они идут каждые
  // 15 минут, и сводка всплывала бы при каждом возвращении в окно
  const SUMMARY_TRIGGERS = ['drop', 'switch', 'error', 'login', 'all-done'];

  const FILTERS = {
    all: null,
    drops: ['drop', 'all-done'],
    problems: ['warning', 'error', 'login']
  };

  // Значок и тон строки по типу записи. Цвет — только у того, что значит
  // «хорошо» или «плохо», остальное нейтрально
  const TYPE_VIEW = {
    drop: { icon: 'gift', tone: 'ok' },
    chest: { icon: 'chest' },
    switch: { icon: 'swap' },
    start: { icon: 'play' },
    stop: { icon: 'stop' },
    warning: { icon: 'warning', tone: 'warn' },
    error: { icon: 'error', tone: 'error' },
    login: { icon: 'user-x', tone: 'error' },
    'all-done': { icon: 'check-circle', tone: 'ok' },
    'game-mode': { icon: 'gamepad' },
    'favourite-live': { icon: 'heart' }
  };

  const esc = (text) => (typeof window.escapeHtml === 'function'
    ? window.escapeHtml(String(text ?? ''))
    : String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const icon = (name, size = 16) => window.Icons?.get?.(name, size) ?? '';
  const plural = (n, one, few, many) => {
    if (window.DOMHelpers?.plural) return window.DOMHelpers.plural(n, one, few, many);
    const d = Math.abs(n) % 100;
    const u = d % 10;
    if (d > 10 && d < 20) return many;
    if (u === 1) return one;
    if (u >= 2 && u <= 4) return few;
    return many;
  };
  // «12 400», а не «12400»: тысячи читаются с разделителем
  const num = (n) => Number(n || 0).toLocaleString(tr.locale());

  function formatDuration(ms) {
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return tr('{minutes} мин', { minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      const rest = minutes % 60;
      return rest ? tr('{hours} ч {minutes} мин', { hours, minutes: rest }) : tr('{hours} ч', { hours });
    }
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? tr('{days} д {hours} ч', { days, hours: restHours }) : tr('{days} д', { days });
  }

  function dayLabel(at, now = new Date()) {
    const d = new Date(at);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (at >= start) return tr('Сегодня');
    if (at >= start - 24 * 60 * 60 * 1000) return tr('Вчера');
    return d.toLocaleDateString(tr.locale(), { weekday: 'short', day: 'numeric', month: 'long' });
  }

  // 24-часовой формат и в английском: колонка времени в журнале узкая (40px),
  // и «03:52 PM» переносился на две строки
  function timeLabel(at) {
    return new Date(at).toLocaleTimeString(tr.locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }

  /**
   * Заголовок и подпись строки журнала. Запись хранится на том языке, на
   * котором её сделали: старую русскую с известной строкой переводим при
   * показе, остальное (английское, имена наград) tr() отдаёт как есть
   */
  function describe(entry) {
    let title = tr(entry.title);
    const meta = [];
    if (entry.type === 'chest' && entry.count > 1) {
      title = tr('Собрано {count} {chests}', { count: entry.count, chests: plural(entry.count, 'сундук', 'сундука', 'сундуков') });
    }
    if (entry.type === 'chest' && entry.points) {
      meta.push('+' + num(entry.points) + ' ' + plural(entry.points, 'балл', 'балла', 'баллов'));
    }
    if (entry.detail) meta.push(tr(entry.detail));
    if (entry.game && entry.game !== entry.detail) meta.push(entry.game);
    const repeat = entry.type !== 'chest' && entry.count > 1 ? entry.count : 0;
    return { title, meta: meta.join(' · '), repeat };
  }

  /** Сводка по записям: сколько чего. */
  function tally(entries) {
    const t = { drops: 0, chests: 0, switches: 0, problems: 0, allDone: false, icons: [] };
    for (const e of entries) {
      const count = e.count || 1;
      if (e.type === 'drop') {
        t.drops += count;
        if (e.icon && t.icons.length < 5) t.icons.push({ src: e.icon, title: tr(e.title) });
      } else if (e.type === 'chest') t.chests += count;
      else if (e.type === 'switch') t.switches += count;
      else if (e.type === 'error' || e.type === 'login') t.problems += count;
      else if (e.type === 'all-done') t.allDone = true;
    }
    return t;
  }

  function tallyParts(t) {
    const parts = [];
    if (t.drops) parts.push({ text: t.drops + ' ' + plural(t.drops, 'награда', 'награды', 'наград'), tone: 'success' });
    if (t.chests) parts.push({ text: t.chests + ' ' + plural(t.chests, 'сундук', 'сундука', 'сундуков') });
    if (t.switches) parts.push({ text: t.switches + ' ' + plural(t.switches, 'смена категории', 'смены категорий', 'смен категорий') });
    if (t.allDone) parts.push({ text: tr('всё собрано'), tone: 'success' });
    if (t.problems) parts.push({ text: t.problems + ' ' + plural(t.problems, 'проблема', 'проблемы', 'проблем'), tone: 'error' });
    return parts;
  }

  class EventLogUI {
    constructor() {
      this.drawer = null;
      this.filter = 'all';
      this.isOpen = false;
      this.prevSeenAt = 0;
      this.lastActivityAt = Date.now();
      this.blurAt = 0;
      this.awayShownFor = 0;
      this.abort = null;
      this.returnFocus = null;
    }

    init() {
      if (this.initialized) return;
      this.initialized = true;
      const log = window.eventLog;
      if (!log) return;

      const button = document.getElementById('journal-btn');
      button?.addEventListener('click', () => this.toggle());

      log.onChange(() => {
        this.renderBadge();
        if (this.isOpen) {
          // Журнал открыт — значит, новое пользователь видит сразу
          if (log.unseenCount() > 0) log.markSeen();
          this.renderList();
        }
      });
      log.load().then(() => this.renderBadge());

      // Активность в окне: по ней считаем «два часа без действий»
      const onActivity = () => {
        const now = Date.now();
        const idleFor = now - this.lastActivityAt;
        const anchor = this.lastActivityAt;
        this.lastActivityAt = now;
        if (idleFor >= AWAY_IDLE_MS) this.checkAway({ since: anchor, awayMs: idleFor });
      };
      window.addEventListener('pointerdown', onActivity, true);
      window.addEventListener('keydown', onActivity, true);

      // Возврат в окно после долгого фона: показ из трея, выход из игры.
      // Видимость страницы здесь не помогает: при выключенном
      // backgroundThrottling Chromium считает окно видимым всегда
      window.addEventListener('blur', () => { this.blurAt = Date.now(); });
      window.addEventListener('focus', () => {
        const away = this.blurAt ? Date.now() - this.blurAt : 0;
        if (away >= AWAY_BLUR_MS) this.checkAway({ since: this.blurAt, awayMs: away });
        this.blurAt = 0;
      });

      setTimeout(() => this.checkAway({ startup: true }), STARTUP_DELAY_MS);
    }

    /* ── Значок в заголовке ── */

    renderBadge() {
      const badge = document.getElementById('journal-badge');
      const button = document.getElementById('journal-btn');
      if (!badge) return;
      const count = window.eventLog?.unseenCount?.() || 0;
      badge.hidden = count === 0;
      badge.textContent = count > 9 ? '9+' : (count ? String(count) : '');
      if (button) {
        const label = count
          ? tr('Журнал событий — {count} {word}', { count, word: plural(count, 'новое', 'новых', 'новых') })
          : tr('Журнал событий');
        button.title = label;
        button.setAttribute('aria-label', label);
      }
    }

    /* ── Панель ── */

    ensureDrawer() {
      if (this.drawer?.isConnected) return this.drawer;
      const drawer = document.createElement('aside');
      drawer.className = 'journal-drawer';
      drawer.id = 'journal-drawer';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-label', tr('Журнал событий'));
      drawer.setAttribute('aria-hidden', 'true');
      drawer.tabIndex = -1;
      drawer.innerHTML = `
        <div class="journal-head">
          <h2 class="journal-heading">${tr('Журнал')}</h2>
          <div class="segmented journal-filter" role="tablist" aria-label="${tr('Что показывать')}">
            <button type="button" role="tab" data-filter="all">${tr('Все')}</button>
            <button type="button" role="tab" data-filter="drops">${tr('Награды')}</button>
            <button type="button" role="tab" data-filter="problems">${tr('Проблемы')}</button>
          </div>
          <button type="button" class="btn btn-ghost btn-icon btn-sm journal-close" title="${tr('Закрыть')}" aria-label="${tr('Закрыть')}">${icon('close', 16)}</button>
        </div>
        <div class="journal-list" id="journal-list" aria-live="polite"></div>
        <div class="journal-foot">
          <span class="journal-foot-note">${tr('Хранится 14 дней')}</span>
          <button type="button" class="btn btn-danger-ghost btn-sm" id="journal-clear">${tr('Очистить журнал')}</button>
        </div>
      `;
      document.body.appendChild(drawer);

      drawer.querySelector('.journal-close').addEventListener('click', () => this.close());
      drawer.querySelector('.journal-filter').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        this.filter = btn.dataset.filter;
        this.renderList();
      });
      drawer.querySelector('#journal-clear').addEventListener('click', () => this.confirmClear());
      this.drawer = drawer;
      return drawer;
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    async open(filter) {
      if (filter && Object.prototype.hasOwnProperty.call(FILTERS, filter)) this.filter = filter;
      const drawer = this.ensureDrawer();
      const log = window.eventLog;
      await log?.load?.();

      if (!this.isOpen) {
        this.returnFocus = document.activeElement;
        // Что было новым до открытия — подсвечиваем, отметку сдвигаем
        this.prevSeenAt = log?.lastSeenAt || 0;
      }
      this.isOpen = true;
      this.renderList();
      drawer.setAttribute('aria-hidden', 'false');
      // Кадр между вставкой и классом: иначе панель появится без выезда
      requestAnimationFrame(() => drawer.classList.add('open'));
      document.getElementById('journal-btn')?.classList.add('is-active');
      log?.markSeen?.();
      this.dismissAwayCard(false);

      this.abort?.abort();
      this.abort = new AbortController();
      const signal = this.abort.signal;
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // Окно подтверждения поверх панели закрывается своим обработчиком
        if (document.getElementById('confirmation-modal')) return;
        e.preventDefault();
        this.close();
      }, { signal });
      document.addEventListener('pointerdown', (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest('#journal-drawer, #journal-btn, #confirmation-modal, .toast-container')) return;
        this.close(false);
      }, { capture: true, signal });

      setTimeout(() => {
        if (this.isOpen) drawer.focus({ preventScroll: true });
      }, 30);
    }

    close(restoreFocus = true) {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.abort?.abort();
      this.abort = null;
      if (this.drawer) {
        this.drawer.classList.remove('open');
        this.drawer.setAttribute('aria-hidden', 'true');
      }
      document.getElementById('journal-btn')?.classList.remove('is-active');
      if (restoreFocus && this.returnFocus?.isConnected) {
        try { this.returnFocus.focus({ preventScroll: true }); } catch (e) { /* элемент ушёл */ }
      }
      this.returnFocus = null;
    }

    renderList() {
      const drawer = this.drawer;
      if (!drawer) return;
      drawer.querySelectorAll('.journal-filter button').forEach(btn => {
        const on = btn.dataset.filter === this.filter;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      const list = drawer.querySelector('#journal-list');
      const entries = window.eventLog?.entriesSync?.({ types: FILTERS[this.filter] }) || [];
      const clear = drawer.querySelector('#journal-clear');
      if (clear) clear.disabled = (window.eventLog?.entriesSync?.({ limit: 1 }) || []).length === 0;

      if (!entries.length) {
        const empty = {
          all: [tr('Пока пусто'), tr('Здесь появятся награды, сундуки и смены категорий')],
          drops: [tr('Наград пока нет'), tr('Полученные награды появятся здесь сразу после зачёта')],
          problems: [tr('Проблем не было'), tr('Сюда попадут остановки фарминга и пропавший вход в Twitch')]
        }[this.filter];
        list.innerHTML = window.DOMHelpers?.emptyState
          ? window.DOMHelpers.emptyState({ icon: this.filter === 'problems' ? 'check-circle' : 'journal', title: empty[0], text: empty[1] })
          : `<div class="empty-state"><h3>${esc(empty[0])}</h3><p>${esc(empty[1])}</p></div>`;
        return;
      }

      const now = new Date();
      let html = '';
      let currentDay = null;
      for (const entry of entries) {
        const day = dayLabel(entry.at, now);
        if (day !== currentDay) {
          if (currentDay !== null) html += '</div>';
          html += `<div class="journal-group"><div class="journal-day">${esc(day)}</div>`;
          currentDay = day;
        }
        const view = TYPE_VIEW[entry.type] || { icon: 'info' };
        const { title, meta, repeat } = describe(entry);
        const isNew = entry.at > this.prevSeenAt;
        html += `
          <div class="journal-row${view.tone ? ' tone-' + view.tone : ''}${isNew ? ' is-new' : ''}">
            <span class="journal-time">${esc(timeLabel(entry.at))}</span>
            <span class="journal-icon" aria-hidden="true">${icon(view.icon, 16)}</span>
            <div class="journal-main">
              <div class="journal-title">${esc(title)}${repeat ? ` <span class="journal-repeat">×${repeat}</span>` : ''}</div>
              ${meta ? `<div class="journal-detail">${esc(meta)}</div>` : ''}
            </div>
            ${entry.icon ? `<img class="journal-art" src="${esc(entry.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          </div>`;
      }
      if (currentDay !== null) html += '</div>';
      list.innerHTML = html;
      // Битая картинка награды — просто без неё, а не значок «нет файла»
      list.querySelectorAll('img.journal-art').forEach(img => {
        img.addEventListener('error', () => img.remove(), { once: true });
      });
    }

    async confirmClear() {
      const ok = await window.utils?.showConfirmation?.(
        tr('Очистить журнал?'),
        tr('Записи удалятся из приложения. Награды в инвентаре Twitch это не затронет.'),
        { confirmText: tr('Очистить'), confirmClass: 'btn-danger' }
      );
      if (!ok) return;
      window.eventLog?.clear?.();
      this.renderList();
    }

    /* ── «Пока вас не было» ── */

    /**
     * Показать сводку, если есть что показать.
     *   since — с какого момента считать события (начало отсутствия);
     *   awayMs — сколько не было; startup — проверка при запуске.
     */
    async checkAway({ since = 0, awayMs = 0, startup = false } = {}) {
      const log = window.eventLog;
      if (!log) return false;
      try {
        await log.load();
      } catch (e) {
        return false;
      }
      // Уже виденное в журнале и уже показанное в прошлой сводке не повторяем
      const from = Math.max(since || 0, log.lastSeenAt || 0, log.summaryAt || 0);
      const entries = log.entriesSync({ since: from, types: SUMMARY_TYPES });
      if (!entries.some(e => SUMMARY_TRIGGERS.includes(e.type))) return false;

      const t = tally(entries);
      const parts = tallyParts(t);
      if (!parts.length) return false;

      let duration = '';
      if (awayMs > 0) duration = formatDuration(awayMs);
      else if (startup) {
        // При запуске время отсутствия неизвестно — берём от самого
        // раннего события, если это не больше трёх суток
        const span = Date.now() - entries[entries.length - 1].at;
        if (span > 0 && span < 3 * 24 * 60 * 60 * 1000) duration = formatDuration(span);
      }

      log.markSummarized();
      this.awayShownFor = from;
      this.showAway({ t, parts, duration });
      return true;
    }

    showAway({ t, parts, duration }) {
      const slot = document.getElementById('away-summary-slot');
      const onFarming = window.router?.currentPage === 'farming';
      if (slot && onFarming && slot.isConnected) {
        this.renderAwayCard(slot, { t, parts, duration });
        return;
      }
      window.utils?.showToast?.(parts.map(p => p.text).join(' · '), t.problems ? 'warning' : 'success', {
        title: duration ? tr('Пока вас не было · {time}', { time: duration }) : tr('Пока вас не было'),
        action: { label: tr('Подробнее'), onClick: () => this.open(t.problems && !t.drops ? 'problems' : 'all') },
        duration: 12000
      });
    }

    renderAwayCard(slot, { t, parts, duration }) {
      const chips = parts.map(p => `<span class="badge${p.tone ? ' badge-' + p.tone : ''}">${esc(p.text)}</span>`).join('');
      const thumbs = t.icons.map(i => `<img src="${esc(i.src)}" alt="" title="${esc(i.title)}" referrerpolicy="no-referrer">`).join('');
      slot.innerHTML = `
        <section class="card away-card" role="status" aria-label="${tr('Пока вас не было')}">
          <div class="away-head">
            <h3 class="away-title">${tr('Пока вас не было')}${duration ? `<span class="away-duration"> · ${esc(duration)}</span>` : ''}</h3>
            <button type="button" class="btn btn-ghost btn-icon btn-sm away-close" title="${tr('Скрыть')}" aria-label="${tr('Скрыть')}">${icon('close', 16)}</button>
          </div>
          <div class="away-chips">${chips}</div>
          <div class="away-foot">
            ${thumbs ? `<div class="away-thumbs">${thumbs}</div><span class="away-thumbs-label">${tr('последние награды')}</span>` : ''}
            <button type="button" class="btn btn-secondary btn-sm away-open">${icon('journal', 14)}<span>${tr('Открыть журнал')}</span></button>
          </div>
        </section>
      `;
      slot.querySelectorAll('.away-thumbs img').forEach(img => img.addEventListener('error', () => img.remove(), { once: true }));
      slot.querySelector('.away-close').addEventListener('click', () => this.dismissAwayCard(true));
      slot.querySelector('.away-open').addEventListener('click', () => this.open());
    }

    /** Убрать карточку сводки. seen — отметить события просмотренными. */
    dismissAwayCard(seen) {
      const slot = document.getElementById('away-summary-slot');
      const card = slot?.querySelector('.away-card');
      if (!card) return;
      card.remove();
      if (seen) window.eventLog?.markSeen?.();
    }
  }

  window.EventLogUI = EventLogUI;
  window.eventLogUI = window.eventLogUI || new EventLogUI();

  // Разметка заголовка (#journal-btn) уже в index.html, но скрипт грузится
  // в <body> раньше её конца — ждём готовности документа
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.eventLogUI.init());
  } else {
    window.eventLogUI.init();
  }
})();
