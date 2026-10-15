// Statistics page logic
class StatisticsPage {
  constructor() {
    this.currentPeriod = 'all';
    this.customStartDate = null;
    this.customEndDate = null;
    this._abort = new AbortController();
    // Раскрыт ли полный список упущенных наград. Живёт между перерисовками:
    // во время фарминга страница перерисовывается каждые полминуты, и
    // раскрытый список не должен сворачиваться сам
    this._missedExpanded = false;
    this.init();
  }

  destroy() {
    if (this._abort) {
      this._abort.abort();
    }
  }

  async init() {
    this.setupEventListeners();
    await this.loadStatistics();

    // Слушаем события обновления статистики в реальном времени.
    // Подписка снимается в destroy(), иначе каждый заход на страницу
    // добавлял ещё один обработчик и лишнюю перерисовку.
    window.addEventListener('statistics-updated', () => {
      this.loadStatistics();
    }, { signal: this._abort.signal });
  }

  setupEventListeners() {
    // Период — сегменты в шапке. aria-pressed вместе с .active: по нему
    // экранный диктор понимает, какой период выбран
    const periodBtns = document.querySelectorAll('.period-btn');
    periodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        periodBtns.forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        this.currentPeriod = btn.dataset.period;

        // Строка выбора дат под шапкой. Появление анимирует сам CSS
        // (.stats-range): анимация запускается при каждом показе блока
        const datePicker = document.getElementById('custom-date-picker');
        if (this.currentPeriod === 'custom') {
          datePicker.style.display = '';

          // Устанавливаем сегодняшнюю дату автоматически. Дата местная:
          // toISOString давал дату по UTC, и ночью подставлялось «вчера»
          const todayStr = this.localDateString(new Date());
          const startDateInput = document.getElementById('start-date');
          const endDateInput = document.getElementById('end-date');

          if (!startDateInput.value) {
            startDateInput.value = todayStr;
            this.updateDateDisplay('start-date', todayStr);
          }
          if (!endDateInput.value) {
            endDateInput.value = todayStr;
            this.updateDateDisplay('end-date', todayStr);
          }

          // Подставленные даты применяем сразу: иначе кнопка периода уже
          // выделена, а на экране остаются цифры прошлого периода
          this.applyDateRange();
        } else {
          datePicker.style.display = 'none';
          this.loadStatistics();
        }
      });
    });

    // Видимое поле даты — текст в русском формате, а выбор открывает
    // скрытое системное поле. С клавиатуры окно выбора открывается так
    // же, как по щелчку: иначе дату без мыши было не задать
    const bindDate = (id) => {
      const display = document.getElementById(id + '-display');
      const input = document.getElementById(id);
      if (!display || !input) return;

      const open = () => {
        try { input.showPicker(); } catch (e) { /* окно выбора уже открыто */ }
      };
      display.addEventListener('click', open);
      display.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          open();
        }
      });
      input.addEventListener('change', (e) => {
        this.updateDateDisplay(id, e.target.value);
      });
    };
    bindDate('start-date');
    bindDate('end-date');

    // Кнопка применения дат
    const applyBtn = document.getElementById('apply-date-range');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => this.applyDateRange());
    }

    // Export button
    const exportBtn = document.getElementById('export-stats-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportStatistics());
    }
  }

  /** Берёт даты из полей и пересчитывает статистику за этот промежуток. */
  applyDateRange() {
    const startDate = document.getElementById('start-date')?.value;
    const endDate = document.getElementById('end-date')?.value;

    if (!startDate || !endDate) {
      window.utils.showToast('Выберите обе даты', 'warning');
      return;
    }

    // Поле даты отдаёт «ГГГГ-ММ-ДД», а new Date такой строки — это полночь
    // по UTC. В Москве день тогда начинался в три часа ночи, и ночные
    // сессии выпадали из выбранного промежутка. Разбираем как местную дату.
    const start = this.parseLocalDate(startDate);
    const end = this.parseLocalDate(endDate);
    if (!start || !end) {
      window.utils.showToast('Не удалось разобрать дату', 'error');
      return;
    }
    end.setHours(23, 59, 59, 999);

    if (start.getTime() > end.getTime()) {
      window.utils.showToast('Дата начала не может быть позже даты окончания', 'error');
      return;
    }

    this.customStartDate = start.getTime();
    this.customEndDate = end.getTime();
    this.loadStatistics();
  }

  /** «ГГГГ-ММ-ДД» → местная полночь этого дня (или null). */
  parseLocalDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  /** Местная дата в виде «ГГГГ-ММ-ДД» — формат поля type="date". */
  localDateString(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  updateDateDisplay(inputId, dateValue) {
    if (!dateValue) return;

    const date = this.parseLocalDate(dateValue);
    if (!date) return;
    const formatted = date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const displayId = inputId + '-display';
    const displayInput = document.getElementById(displayId);
    if (displayInput) {
      displayInput.value = formatted;
    }
  }

  async loadStatistics() {
    try {
      // Отладочные console.log с JSON всей статистики отсюда убраны: страница
      // перерисовывается каждые полминуты фарминга, а консоль хранит
      // аргументы сообщений — память росла примерно на 5 МБ в час.
      const stats = await Storage.getStatistics();
      const sessions = Array.isArray(stats?.sessions) ? stats.sessions : [];

      // Демонстрационные сессии здесь больше не создаются.
      //
      // Раньше при пустой статистике сюда ЗАПИСЫВАЛИСЬ две выдуманные сессии
      // (Rocket League/shroud и League of Legends/doublelift) — прямо в реальное
      // хранилище, а не только в отображение. Они давали 800 баллов, 3 сундука
      // и 1 дропс, которые потом навсегда смешивались с настоящей статистикой
      // и выглядели как ошибка подсчёта.

      // Фильтруем сессии по периоду
      const filteredSessions = this.filterSessionsByPeriod(sessions);

      // Подозрительные сессии в итоги не идут: на реальных данных шесть
      // таких записей давали 92% всего времени, и ни одной цифре на странице
      // нельзя было верить. Они остаются в списке и в экспорте, а под
      // итогами написано, сколько их и как их удалить.
      const suspect = filteredSessions.filter(s => this.isSuspect(s));
      const counted = filteredSessions.filter(s => !this.isSuspect(s));

      // Сессии по 0 минут — запуски, оборвавшиеся сразу. В число сессий и
      // в средние они не идут: только занижают среднюю длительность.
      const watched = counted.filter(s => (Number(s.duration) || 0) > 0);

      // Считаем общую статистику
      const totalMinutes = counted.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
      const totalStreams = watched.length;

      // Считаем баллы и сундуки
      const totalPoints = counted.reduce((sum, s) => sum + (Number(s.pointsEarned) || 0), 0);
      const totalChests = counted.reduce((sum, s) => sum + (Number(s.chestsCollected) || 0), 0);

      // Считаем полученные дропсы
      const totalDrops = counted.reduce((sum, s) => sum + (Number(s.dropsCollected) || 0), 0);

      // Находим топ категорий с статистикой
      const categoryStats = {};
      watched.forEach(session => {
        const cat = this.categoryLabel(session.category);
        if (!categoryStats[cat]) {
          categoryStats[cat] = { time: 0, box: session.categoryBoxArtURL || '', streams: 0, lastDate: 0 };
        }
        categoryStats[cat].time += (Number(session.duration) || 0);
        categoryStats[cat].streams += 1;
        categoryStats[cat].lastDate = Math.max(categoryStats[cat].lastDate, session.timestamp || 0);
      });

      const topCategories = Object.entries(categoryStats)
        .sort((a, b) => b[1].time - a[1].time)
        .slice(0, 10)
        .map(([name, data]) => ({ name, ...data }));

      // Считаем трафик
      const totalBandwidth = counted.reduce((sum, s) => sum + (Number(s.bandwidth) || 0), 0);

      // Обновляем UI
      this.renderExcluded(suspect);
      this.updateStatsCards(totalMinutes, totalStreams, totalPoints, totalChests, totalBandwidth, totalDrops, suspect.length);
      this.renderAnalytics(watched, { totalMinutes, totalDrops, totalPoints, totalBandwidth, topCategories });
      this.renderTopCategories(topCategories, totalMinutes);
      this.updateSessionsTable(filteredSessions);

    } catch (error) {
      console.error('Error loading statistics:', error);
      console.error('Error stack:', error.stack);
      window.utils.showToast('Ошибка загрузки статистики: ' + error.message, 'error');
    }
  }

  filterSessionsByPeriod(sessions) {
    switch (this.currentPeriod) {
      case 'month': {
        // Кнопка называется «Этот месяц», а считались последние 30 дней —
        // в начале месяца туда попадал почти весь прошлый. Считаем с 1-го.
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
        return sessions.filter(s => s.timestamp >= monthStart);
      }

      case 'custom':
        if (this.customStartDate && this.customEndDate) {
          return sessions.filter(s =>
            s.timestamp >= this.customStartDate &&
            s.timestamp <= this.customEndDate
          );
        }
        return [];

      case 'all':
      default:
        return sessions;
    }
  }

  /** Сессия длиннее этого без признаков жизни считается подозрительной. */
  static get SUSPECT_MINUTES() {
    return 24 * 60;
  }

  /**
   * Подозрительная сессия: больше суток и без отметки lastSeenAt.
   *
   * Отметку текущая версия пишет каждые полминуты. Её нет только у
   * записей старых версий, а те при перезапуске продолжали считать
   * сессию от вчерашнего старта — так появлялись «сессии» на десятки
   * суток при нескольких мегабайтах трафика. Порог по трафику не годится:
   * оценка трафика занижена, и настоящая многочасовая сессия давала
   * меньше 1 МБ в час.
   */
  isSuspect(session) {
    if (!session) return false;
    if (Number(session.lastSeenAt) > 0) return false;
    return (Number(session.duration) || 0) > StatisticsPage.SUSPECT_MINUTES;
  }

  /** 'Unknown' пишет фарминг, когда категория не определилась. */
  categoryLabel(name) {
    return !name || name === 'Unknown' ? 'Без категории' : String(name);
  }

  channelLabel(name) {
    return !name || name === 'Unknown' ? 'Неизвестный канал' : String(name);
  }

  /** Иконка из общего набора; до его загрузки — пустая строка. */
  icon(name, size = 16) {
    return window.Icons?.get(name, size) ?? '';
  }

  /** Пустое состояние общего вида (иконка, заголовок, одно предложение). */
  emptyHtml({ icon, title, text }) {
    if (typeof window.DOMHelpers?.emptyState === 'function') {
      return window.DOMHelpers.emptyState({ icon, title, text });
    }
    const esc = window.escapeHtml;
    return `<div class="empty-state"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
  }

  /**
   * Обложка категории в строке списка.
   *
   * Слот держит размер и серую подложку с тихим значком игры: пока
   * картинка грузится, не загрузилась или её нет вовсе, строка не
   * прыгает и не показывает значок битого изображения.
   */
  coverHtml(url, extraClass = '') {
    const esc = window.escapeHtml;
    return `<span class="stats-cover ${extraClass}" aria-hidden="true">${this.icon('gamepad', 14)}${url
      ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.hidden=true">`
      : ''}</span>`;
  }

  /**
   * Строка о сессиях, не вошедших в итоги, — внизу страницы, рядом со
   * списком, где они помечены. Под итогами об этом говорит подпись
   * «N не учтено».
   */
  renderExcluded(suspect) {
    const box = document.getElementById('stats-excluded');
    if (!box) return;

    if (!suspect || suspect.length === 0) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    const count = suspect.length;
    const minutes = suspect.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);

    box.innerHTML = `
      ${this.icon('info', 16)}
      <div class="stats-excluded-text">
        <b>Не учтено в итогах: ${count} ${this.pluralSessions(count)}</b> — больше суток без отметок
        о просмотре, всего ${this.formatDuration(minutes)}. Так их записывала старая версия приложения.
      </div>
      <button class="btn btn-danger-ghost btn-sm stats-excluded-delete" type="button">Удалить</button>
    `;
    box.style.display = '';

    box.querySelector('.stats-excluded-delete')?.addEventListener('click', () => {
      // Двойное нажатие открывало два окна подтверждения с одинаковыми id,
      // и кнопки второго не работали — окно оставалось висеть
      if (this._deletingSuspect) return;
      this._deletingSuspect = true;
      this.deleteSuspect()
        .catch(error => {
          console.error('[Статистика] Не удалось удалить сессии:', error);
          window.utils.showToast('Не удалось удалить сессии', 'error');
        })
        .finally(() => { this._deletingSuspect = false; });
    }, { signal: this._abort.signal });
  }

  /** Удаляет подозрительные сессии выбранного периода — после подтверждения. */
  async deleteSuspect() {
    const before = await Storage.getStatistics();
    const listBefore = Array.isArray(before?.sessions) ? before.sessions : [];
    const count = this.filterSessionsByPeriod(listBefore).filter(s => this.isSuspect(s)).length;
    if (count === 0) {
      this.loadStatistics();
      return;
    }

    // После «Удалить» нужен винительный падеж: «1 сессию», а не «1 сессия».
    // Одна сессия — «она», а не «они». Классы окна — общие (.dialog-title),
    // без инлайновых цветов: так текст читается и в светлой теме
    const one = count === 1;
    const confirmed = await window.utils.showCustomConfirmation(`
      <h3 class="dialog-title">Удалить ${count} ${this.plural(count, 'сессию', 'сессии', 'сессий')}?</h3>
      <p class="stats-confirm-text">
        ${one
          ? 'Она пропадёт из списка и из экспорта. Вернуть её будет нельзя.'
          : 'Они пропадут из списка и из экспорта. Вернуть их будет нельзя.'}
      </p>
    `, { confirmText: 'Удалить', cancelText: 'Отмена', confirmClass: 'btn-danger' });
    if (!confirmed) return;

    // Перечитываем: пока окно было открыто, фарминг мог дописать текущую
    // сессию, и её обновление нельзя затереть старой копией списка
    const fresh = await Storage.getStatistics();
    const sessions = Array.isArray(fresh?.sessions) ? fresh.sessions : [];
    const inPeriod = new Set(this.filterSessionsByPeriod(sessions));
    const keep = sessions.filter(s => !(inPeriod.has(s) && this.isSuspect(s)));
    const removed = sessions.length - keep.length;

    if (removed > 0) {
      await Storage.updateStatistics({ sessions: keep });
    }

    window.utils.showToast(`Удалено: ${removed} ${this.pluralSessions(removed)}`, 'success');
    // Перерисует эту страницу и всех, кто показывает статистику
    window.dispatchEvent(new CustomEvent('statistics-updated'));
  }

  /**
   * Форма слова по числу: 1 сессия, 3 сессии, 5 сессий.
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

  /** Число по-русски: пробелы между разрядами и десятичная запятая. */
  formatNumber(value, maxDigits = 0, minDigits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits
    }).format(n);
  }

  /** Сколько строк упущенных наград видно, пока список свёрнут. */
  static get MISSED_PREVIEW() {
    return 3;
  }

  /**
   * Все упущенные награды, ближайшие к получению — первыми.
   *
   * MissedDrops.analyze отдаёт для сводки только пять ближайших, а по
   * «Показать все» нужен полный список. Отбор тот же: закончившиеся
   * кампании и награды, к которым приступали, но не добрали
   * (MissedDrops.isMissed), — иначе число на кнопке разошлось бы со сводкой.
   */
  missedList(history, now = Date.now()) {
    const MD = window.MissedDrops;
    const list = [];

    for (const campaign of history || []) {
      const ends = new Date(campaign?.endsAt).getTime();
      if (!Number.isFinite(ends) || ends > now) continue;

      const game = campaign?.game?.displayName || campaign?.game?.name || campaign?.name || '';
      for (const drop of (campaign.drops || [])) {
        if (!MD.isMissed(drop)) continue;
        list.push({
          game,
          name: drop.name || 'Награда',
          shortBy: (Number(drop.required) || 0) - (Number(drop.progress) || 0)
        });
      }
    }

    return list.sort((a, b) => a.shortBy - b.shortBy);
  }

  /**
   * Сколько наград не удалось добрать до конца кампаний.
   *
   * Полезна тут не столько сумма, сколько разбивка: награда, до которой
   * не дотянули двадцать минут, и награда, требовавшая ещё десять часов,
   * — совсем разные поводы. Первое исправляется вниманием, второе не
   * стоило и начинать.
   */
  async renderMissed() {
    const box = document.getElementById('missed-card');
    if (!box || !window.MissedDrops || !window.CampaignHistory) return;

    const history = await window.CampaignHistory.loadKnown();
    const result = window.MissedDrops.analyze(history);

    // Пока приложение не накопило историю, блок честнее спрятать
    if (result.total === 0) {
      box.style.display = 'none';
      this._missed = null;
      return;
    }

    this._missed = { result, items: this.missedList(history) };
    this.paintMissed();
  }

  /** Рисует блок упущенных из запомненных данных (и при раскрытии списка). */
  paintMissed() {
    const box = document.getElementById('missed-card');
    if (!box || !this._missed) return;

    const { result, items } = this._missed;
    const esc = window.escapeHtml;
    const CLOSE = window.MissedDrops.CLOSE_MINUTES;
    const LIMIT = StatisticsPage.MISSED_PREVIEW;
    const expanded = this._missedExpanded && items.length > LIMIT;
    const shown = expanded ? items : items.slice(0, LIMIT);

    // Янтарным — только то, до чего оставалось меньше часа: это самый
    // обидный случай. Остальное — обычным текстом, без заливки строк
    const rows = shown.map(m => `
      <div class="list-row missed-item ${m.shortBy <= CLOSE ? 'close' : ''}">
        <div class="row-main missed-main">
          <span class="missed-name" title="${esc(m.name)}">${esc(m.name)}</span>
          <span class="missed-game" title="${esc(m.game)}">${esc(m.game)}</span>
        </div>
        <span class="missed-short ${m.shortBy <= CLOSE ? 'tone-warn' : ''}">не хватило ${this.formatShort(m.shortBy)}</span>
      </div>
    `).join('');

    box.innerHTML = `
      <div class="card-header">
        <div class="card-title">${this.icon('clock', 16)}<span>Упущенные награды</span></div>
        <span class="missed-sum">${esc(window.MissedDrops.describe(result))}</span>
      </div>
      <div class="list missed-list">${rows}</div>
      <div class="missed-foot">
        <span class="missed-note">Всего не хватило около ${this.formatDuration(result.shortMinutes)} просмотра ·
          по кампаниям, которые приложение видело за последний месяц</span>
        ${items.length > LIMIT ? `
          <button type="button" class="btn btn-ghost btn-sm missed-more" aria-expanded="${expanded}">
            ${expanded ? 'Свернуть' : `Показать все (${items.length})`}
            ${this.icon(expanded ? 'chevron-up' : 'chevron-down', 14)}
          </button>` : ''}
      </div>
    `;
    box.style.display = '';

    box.querySelector('.missed-more')?.addEventListener('click', () => {
      this._missedExpanded = !expanded;
      this.paintMissed();
      // Фокус остаётся на кнопке: она перерисована вместе с блоком
      box.querySelector('.missed-more')?.focus();
    }, { signal: this._abort.signal });
  }

  /** Недобор в человеческом виде: меньше минуты не бывает. */
  formatShort(minutes) {
    return this.formatDuration(Math.max(1, Math.round(Number(minutes) || 0)));
  }

  /**
   * Аналитика: выводы из накопленных цифр.
   *
   * Приложение давно собирало историю сессий, трафик, баллы и категории,
   * но показывало только суммы. Сумма отвечает на вопрос «сколько всего»,
   * а решения принимаются по другим: выгодно ли это, что окупается, чего
   * ждать дальше.
   */
  renderAnalytics(sessions, totals) {
    const card = document.getElementById('analytics-card');
    const grid = document.getElementById('analytics-grid');
    const note = document.getElementById('analytics-note');
    if (!card || !grid) return;

    // Без истории выводы делать не из чего — блок честнее спрятать
    if (!sessions || sessions.length === 0 || totals.totalMinutes <= 0) {
      card.style.display = 'none';
      return;
    }

    const hours = totals.totalMinutes / 60;
    const dropsPerHour = hours > 0 ? totals.totalDrops / hours : 0;
    const pointsPerHour = hours > 0 ? totals.totalPoints / hours : 0;
    const trafficPerHour = hours > 0 ? totals.totalBandwidth / hours : 0;

    // Сколько часов уходит на один дропс — понятнее, чем доли в час
    const hoursPerDrop = totals.totalDrops > 0 ? hours / totals.totalDrops : null;

    const best = (totals.topCategories || [])[0];

    const items = [
      {
        label: 'Наград в час',
        value: totals.totalDrops > 0 ? this.formatNumber(dropsPerHour, 2) : '—',
        sub: hoursPerDrop
          ? `примерно ${this.formatHours(hoursPerDrop)} на одну награду`
          : 'награды пока не засчитывались'
      },
      {
        label: 'Трафик в час',
        value: trafficPerHour > 0 ? this.formatBytes(trafficPerHour) : '—',
        sub: trafficPerHour > 0
          ? `около ${this.formatBytes(trafficPerHour * 24)} за сутки фарминга`
          : 'нет данных о расходе'
      },
      {
        label: 'Баллов в час',
        value: pointsPerHour > 0 ? this.formatNumber(Math.round(pointsPerHour)) : '—',
        sub: `за ${this.formatHours(hours)} просмотра`
      },
      {
        label: 'Средняя сессия',
        value: this.formatHours(totals.totalMinutes / sessions.length / 60),
        sub: `${sessions.length} ${this.pluralSessions(sessions.length)}`
      }
    ];

    // Экономия от просмотра в минимальном качестве. Оценка приблизительная,
    // поэтому сравнение названо явно — с чем именно сравниваем
    const TE = window.TrafficEstimate;
    const saved = TE?.saved(totals.totalBandwidth, totals.totalMinutes);
    if (saved) {
      const ratio = TE.ratio(totals.totalBandwidth, totals.totalMinutes);
      items.push({
        label: 'Экономия трафика',
        value: this.formatBytes(saved),
        sub: ratio
          ? `в ${this.formatNumber(ratio, 1)} раза экономнее, чем в ${TE.BASELINE_LABEL}`
          : `если бы смотрели в ${TE.BASELINE_LABEL}`
      });
    }

    // Упущенные награды: данные о них появились вместе с памятью о
    // кампаниях — раньше они исчезали вместе с самой кампанией
    this.renderMissed().catch(e => console.warn('[Статистика] Упущенные:', e?.message));

    // Показатели внутри карточки — без своих рамок, разделены тонкими
    // вертикальными линиями (.kpi-inline)
    grid.innerHTML = items.map(item => `
      <div class="kpi kpi-inline analytics-item">
        <div class="kpi-label">${item.label}</div>
        <div class="kpi-value">${item.value}</div>
        <div class="kpi-sub">${item.sub}</div>
      </div>
    `).join('');

    if (note) {
      note.textContent = best
        // После «за» нужен винительный падеж: «за 1 сессию», а не «за 1 сессия»
        ? `Больше всего времени уходит на «${best.name}» — ${this.formatHours(best.time / 60)} за ${best.streams} ${this.plural(best.streams, 'сессию', 'сессии', 'сессий')}.`
        : '';
      note.hidden = !best;
    }

    card.style.display = 'block';
  }

  /** Округлённые часы для выводов: «2,5 ч», «14 ч», «40 мин». */
  formatHours(hours) {
    if (!Number.isFinite(hours) || hours <= 0) return '—';
    if (hours < 1) return Math.round(hours * 60) + ' мин';
    if (hours < 10) return this.formatNumber(hours, 1) + ' ч';
    return this.formatNumber(Math.round(hours)) + ' ч';
  }

  pluralSessions(count) {
    return this.plural(count, 'сессия', 'сессии', 'сессий');
  }

  updateStatsCards(minutes, streams, points, chests, bandwidth, drops, excluded = 0) {
    // Общее время просмотра — тем же форматом, что и везде на странице:
    // раньше здесь было «1068h 41m», а рядом «ч/мин» и «ч м»
    const watchTimeEl = document.getElementById('total-watch-time');
    if (watchTimeEl) {
      watchTimeEl.textContent = this.formatDuration(minutes);
    }

    // Под временем — из скольких сессий оно сложилось и сколько не
    // учтено. Объяснение и кнопка удаления — внизу страницы, но сам факт
    // должен быть виден рядом с итогом, иначе цифра молча расходится со
    // списком сессий
    const subEl = document.getElementById('total-sessions-sub');
    if (subEl) {
      const parts = [];
      if (streams > 0) parts.push(`${this.formatNumber(streams)} ${this.pluralSessions(streams)}`);
      if (excluded > 0) parts.push(`${excluded} не ${this.plural(excluded, 'учтена', 'учтены', 'учтено')}`);
      subEl.textContent = parts.join(' · ');
      subEl.title = excluded > 0
        ? 'Сессии больше суток без отметок о просмотре в итоги не входят — подробности внизу страницы'
        : '';
      subEl.hidden = parts.length === 0;
    }

    // Заработано баллов
    const pointsEl = document.getElementById('total-points');
    if (pointsEl) {
      pointsEl.textContent = this.formatNumber(points);
    }

    // Собрано сундучков
    const chestsEl = document.getElementById('total-chests');
    if (chestsEl) {
      chestsEl.textContent = this.formatNumber(chests);
    }

    // Получено дропсов
    const dropsEl = document.getElementById('drops-collected');
    if (dropsEl) {
      dropsEl.textContent = this.formatNumber(drops || 0);
    }
  }

  /**
   * Приводит URL обложки Twitch к нужному размеру.
   * Ссылки приходят либо шаблоном {width}x{height}, либо уже с конкретным
   * размером в имени файла — обрабатываем оба случая.
   */
  upscaleBoxArt(url, size = '285x380') {
    if (!url || typeof url !== 'string') return '';

    let normalized = url.trim();
    if (!normalized) return '';

    if (normalized.startsWith('//')) normalized = `https:${normalized}`;
    normalized = normalized.replace(/^http:\/\//i, 'https://');

    return normalized
      .replace(/\{width\}x\{height\}/gi, size)
      .replace(/-\d+x\d+(\.[a-z0-9]+)(\?.*)?$/i, `-${size}$1$2`);
  }

  /** Обложка в строке: 52×72 — вдвое больше места под неё (32×43). */
  rowCoverUrl(boxUrl, categoryName) {
    const own = this.upscaleBoxArt(boxUrl, '52x72');
    if (own) return own;
    if (!categoryName || categoryName === 'Без категории') return '';
    return this.getDefaultCoverUrl(categoryName);
  }

  /**
   * Топ категорий — список с долей времени.
   *
   * Раньше слева стоял веер из трёх крупных обложек, а цифры были
   * фиолетовыми с зелёной плашкой процента. Теперь акцент — только у
   * полосы доли: по ней сравнивают, а не по цвету текста.
   */
  renderTopCategories(categories, totalMinutes) {
    const container = document.getElementById('top-categories-section');
    if (!container) return;

    if (categories.length === 0) {
      container.innerHTML = this.emptyHtml(this.currentPeriod === 'all'
        ? { icon: 'chart', title: 'Пока пусто', text: 'Здесь появятся игры, на которые уходит больше всего времени фарминга.' }
        : { icon: 'chart', title: 'За этот период ничего нет', text: 'Выберите другой период — например, «Всё время».' });
      return;
    }

    // Названия приходят от Twitch и вставляются в разметку и атрибуты
    const esc = window.escapeHtml;

    // Доля — от всего времени периода, а не только от показанных строк:
    // иначе у пятёрки из двадцати игр проценты в сумме давали бы 100
    const shown = categories.slice(0, Math.min(5, categories.length));
    const totalTime = Number(totalMinutes) > 0
      ? Number(totalMinutes)
      : categories.reduce((sum, cat) => sum + cat.time, 0);

    // Склонение раньше знало только «сеанс» и «сеансов» — выходило
    // «2 сеансов». Слово то же, что в аналитике: «сессия».
    container.innerHTML = shown.map(cat => {
      const percentage = totalTime > 0 ? Math.round((cat.time / totalTime) * 100) : 0;
      const avgSessionMins = cat.streams > 0 ? Math.round(cat.time / cat.streams) : 0;

      return `
        <div class="list-row top-cat-row">
          ${this.coverHtml(this.rowCoverUrl(cat.box, cat.name))}
          <div class="row-main">
            <div class="row-title" title="${esc(cat.name)}">${esc(cat.name)}</div>
            <div class="row-meta">
              <span>${this.formatNumber(cat.streams)} ${this.pluralSessions(cat.streams)}</span>
              <span>в среднем ${this.formatDuration(avgSessionMins)}</span>
            </div>
          </div>
          <div class="top-cat-share">
            <div class="top-cat-time num">${this.formatDuration(cat.time)}</div>
            <div class="progress progress-sm" role="img" aria-label="${percentage}% всего времени">
              <div class="progress-fill" style="width: ${Math.max(percentage, 1)}%"></div>
            </div>
            <div class="top-cat-pct num">${percentage}%</div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Когда была сессия: «сегодня, 01:06», «вчера, 22:02», «10.10, 01:06».
   * Год — только у прошлогодних: в пределах года он лишь удлинял строку.
   */
  sessionWhen(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '';

    const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    const at = date.getTime();

    if (at >= today) return `сегодня, ${time}`;
    if (at >= yesterday) return `вчера, ${time}`;

    const day = date.toLocaleDateString('ru-RU', date.getFullYear() === now.getFullYear()
      ? { day: '2-digit', month: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${day}, ${time}`;
  }

  updateSessionsTable(sessions) {
    const container = document.getElementById('recent-sessions');
    if (!container) return;

    // Показываем последние 10 сессий
    const recentSessions = sessions.slice(-10).reverse();

    // Подписи колонок нужны только над строками
    const cols = document.getElementById('session-cols');
    if (cols) cols.hidden = recentSessions.length === 0;

    if (recentSessions.length === 0) {
      container.innerHTML = this.emptyHtml(this.currentPeriod === 'all'
        ? { icon: 'clock', title: 'Сессий пока нет', text: 'Запустите фарминг — каждая сессия появится здесь с длительностью, баллами и трафиком.' }
        : { icon: 'clock', title: 'За этот период сессий нет', text: 'Выберите другой период — например, «Всё время».' });
      return;
    }

    const esc = window.escapeHtml;

    container.innerHTML = recentSessions.map((session, idx) => {
      const unknownCategory = !session.category || session.category === 'Unknown';
      const category = this.categoryLabel(session.category);
      const channel = this.channelLabel(session.channel);
      const duration = this.formatDuration(session.duration || 0);
      const bandwidth = session.bandwidth ? this.formatBytes(session.bandwidth) : '—';

      // Используем реальную обложку из сессии. Для неизвестной категории
      // подставлять чужую обложку нечестно — лучше без неё
      const coverUrl = unknownCategory ? '' : this.rowCoverUrl(session.categoryBoxArtURL, category);

      // Баллы — те, что сессия записала сама. Раньше здесь стояла выдуманная
      // формула «10 за каждые 5 минут», и список спорил с итогами наверху:
      // сессия с нулём баллов показывала «+55 010». Нет поля — нет цифры.
      const points = Number(session.pointsEarned);
      const noPoints = session.pointsEarned == null || !Number.isFinite(points);
      const pointsText = noPoints ? '—' : (points > 0 ? '+' + this.formatNumber(points) : '0');
      const chests = Number(session.chestsCollected) || 0;

      // Нули и прочерки — тихим цветом: глаз цепляется за то, что есть.
      // Наведение больше ничего не рисует: график скорости по
      // bandwidthHistory жил в блоке без размера и ни разу не показался
      return `
        <div class="list-row session-item" id="session-${idx}">
          ${this.coverHtml(coverUrl, 'is-sm')}
          <div class="row-main">
            <div class="row-title session-game" title="${esc(category)}">${esc(category)}</div>
            <div class="row-meta session-meta">
              <span>${esc(channel)}</span>
              <span>${esc(this.sessionWhen(session.timestamp))}</span>
              ${chests > 0 ? `<span>${this.formatNumber(chests)} ${this.plural(chests, 'сундук', 'сундука', 'сундуков')}</span>` : ''}
              ${this.isSuspect(session)
                ? '<span class="badge badge-warning" title="Больше суток без отметок о просмотре — в итоги не входит">не учтена в итогах</span>'
                : ''}
            </div>
          </div>
          <div class="session-nums">
            <span class="session-num num" title="Длительность"><span class="visually-hidden">Длительность: </span>${duration}</span>
            <span class="session-num num ${noPoints || points <= 0 ? 'is-zero' : ''}" title="Баллы канала"><span class="visually-hidden">Баллы: </span>${pointsText}</span>
            <span class="session-num num ${bandwidth === '—' ? 'is-zero' : ''}" title="Трафик за сессию"><span class="visually-hidden">Трафик: </span>${bandwidth}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  getCategoryIdFromName(name, fallback = '509658') {
    // Мапинг популярных игр (можно расширить)
    const knownGames = {
      'League of Legends': '21779',
      'Rocket League': '30921',
      'Dota 2': '29595',
      'Counter-Strike': '32399',
      'Counter-Strike 2': '32399',
      'Valorant': '516575',
      'Fortnite': '33214',
      'Minecraft': '27471',
      'Grand Theft Auto V': '32982',
      'World of Warcraft': '18122',
      'Apex Legends': '511224',
      'Call of Duty: Warzone': '512710',
      'Overwatch 2': '515024',
      'PUBG: BATTLEGROUNDS': '493057',
      'Dead by Daylight': '491487',
      'Escape from Tarkov': '491931',
      'Lost Ark': '490100',
      'Path of Exile': '29307',
      'Hearthstone': '138585',
      'The Elder Scrolls V: Skyrim': '30028',
      'Dark Souls III': '490292',
      'Elden Ring': '512953',
      'Resident Evil Village': '518014',
      'Spider-Man': '517860',
      'God of War': '6369',
      'The Last of Us': '490639',
      'Just Chatting': '509658',
      'Rust': '263490',
      'Rainbow Six Siege': '460630',
      'Tom Clancy\'s Rainbow Six Siege': '460630',
      'THE FINALS': '519272',
      'Palworld': '1623487072',
      'Lethal Company': '1966064697',
      'Teamfight Tactics': '513143',
      'STALKER 2': '1479742674',
      'Call of Duty: Black Ops 6': '1678052513',
      'EA Sports FC 25': '512938',
      'Warframe': '66170'
    };

    // Попытка найти игру по точному совпадению
    if (knownGames[name]) {
      return knownGames[name];
    }

    // Попытка найти по частичному совпадению (для вариантов типа "Rainbow Six Siege X")
    for (const [gameName, gameId] of Object.entries(knownGames)) {
      if (name.includes(gameName) || gameName.includes(name)) {
        return gameId;
      }
    }

    return fallback; // По умолчанию — Just Chatting
  }

  /**
   * Обложка по названию, если сессия свою не записала. Только для
   * известных игр: чужая обложка («Общение» у Mahjong Soul) хуже пустого
   * места — она выдаёт себя за правду.
   */
  getDefaultCoverUrl(categoryName) {
    const gameId = this.getCategoryIdFromName(categoryName, null);
    return gameId ? `https://static-cdn.jtvnw.net/ttv-boxart/${gameId}-52x72.jpg` : '';
  }

  /**
   * Длительность одним форматом на всю страницу: «1 068 ч 41 мин».
   *
   * Раньше на одной странице соседствовали «1068h 41m», «2ч 5м» и
   * «ч/мин» — каждое место считало по-своему.
   */
  formatDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const mins = total % 60;

    if (hours === 0) return `${mins} мин`;
    if (mins === 0) return `${this.formatNumber(hours)} ч`;
    return `${this.formatNumber(hours)} ч ${mins} мин`;
  }

  /** Единицы русские — в сайдбаре они уже такие, разнобой бросался в глаза. */
  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 Б';

    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    // Трафик в час бывает дробным и меньше байта: логарифм тогда
    // отрицательный, и без нижней границы единица была бы undefined
    const i = Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))));
    const value = bytes / Math.pow(1024, i);
    const digits = i === 0 ? 0 : 1;

    return `${this.formatNumber(value, digits, digits)} ${units[i]}`;
  }

  /** Имя файла с периодом — чтобы выгрузки за разные промежутки не путались. */
  exportFileName() {
    if (this.currentPeriod === 'month') {
      const today = new Date();
      return `watchtwitch-sessions-${this.localDateString(today).slice(0, 7)}.csv`;
    }
    if (this.currentPeriod === 'custom' && this.customStartDate && this.customEndDate) {
      const from = this.localDateString(new Date(this.customStartDate));
      const to = this.localDateString(new Date(this.customEndDate));
      return `watchtwitch-sessions-${from}_${to}.csv`;
    }
    return window.CsvExport.fileName();
  }

  async exportStatistics() {
    try {
      // Раньше здесь выгружался JSON целиком — в таблицу его не вставить.
      // CSV с «;» и BOM русский Excel открывает двойным щелчком.
      const stats = await Storage.getStatistics();
      const all = Array.isArray(stats?.sessions) ? stats.sessions : [];
      if (all.length === 0) {
        window.utils.showToast('Сессий пока нет — экспортировать нечего', 'info');
        return;
      }

      // Выгружаем то, что на экране: раньше при выбранном периоде в файл
      // всё равно уходили все сессии, и таблица не сходилась со страницей
      const sessions = this.filterSessionsByPeriod(all);
      if (sessions.length === 0) {
        window.utils.showToast('За выбранный период сессий нет', 'info');
        return;
      }

      const csv = window.CsvExport.sessions(sessions);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = this.exportFileName();
      a.click();

      URL.revokeObjectURL(url);

      window.utils.showToast('Сессии выгружены в CSV: ' + sessions.length, 'success');
    } catch (error) {
      console.error('Export error:', error);
      window.utils.showToast('Ошибка экспорта', 'error');
    }
  }
}

// Export to global scope
if (typeof window !== 'undefined') {
  window.StatisticsPage = StatisticsPage;
}
