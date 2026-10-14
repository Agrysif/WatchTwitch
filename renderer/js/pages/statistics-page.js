// Statistics page logic
class StatisticsPage {
  constructor() {
    this.currentPeriod = 'all';
    this.customStartDate = null;
    this.customEndDate = null;
    this._abort = new AbortController();
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
    // Period buttons
    const periodBtns = document.querySelectorAll('.period-btn');
    periodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        periodBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentPeriod = btn.dataset.period;
        
        // Показываем/скрываем календарь
        const datePicker = document.getElementById('custom-date-picker');
        if (this.currentPeriod === 'custom') {
          datePicker.style.display = 'block';
          // Своё имя анимации: общее fadeIn из animations.css страница
          // раньше переопределяла для всего приложения
          datePicker.style.animation = 'statsFadeIn 0.3s ease';

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
    
    // Обработчики для кастомных дат
    const startDateDisplay = document.getElementById('start-date-display');
    const endDateDisplay = document.getElementById('end-date-display');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    
    if (startDateDisplay && startDateInput) {
      startDateDisplay.addEventListener('click', () => {
        startDateInput.showPicker();
      });
      
      startDateInput.addEventListener('change', (e) => {
        this.updateDateDisplay('start-date', e.target.value);
      });
    }
    
    if (endDateDisplay && endDateInput) {
      endDateDisplay.addEventListener('click', () => {
        endDateInput.showPicker();
      });
      
      endDateInput.addEventListener('change', (e) => {
        this.updateDateDisplay('end-date', e.target.value);
      });
    }
    
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
      // нельзя было верить. Они остаются в списке и в экспорте, а над
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
      this.updateStatsCards(totalMinutes, totalStreams, totalPoints, totalChests, totalBandwidth, totalDrops);
      this.renderAnalytics(watched, { totalMinutes, totalDrops, totalPoints, totalBandwidth, topCategories });
      this.renderTopCategories(topCategories);
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

  /** Строка над итогами: сколько сессий не учтено и кнопка их удалить. */
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
      <div class="stats-excluded-text">
        <b>Исключено из итогов: ${count} ${this.pluralSessions(count)}</b> с подозрительной
        длительностью — больше суток без отметок о просмотре, всего ${this.formatDuration(minutes)}.
        Так их записывала старая версия приложения.
      </div>
      <button class="btn btn-secondary stats-excluded-delete" type="button">Удалить</button>
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
    // Одна сессия — «она», а не «они»
    const one = count === 1;
    const confirmed = await window.utils.showCustomConfirmation(`
      <div style="text-align: center;">
        <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">
          Удалить ${count} ${this.plural(count, 'сессию', 'сессии', 'сессий')}?
        </h3>
        <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0;">
          ${one
            ? 'Она пропадёт из списка и из экспорта. Вернуть её будет нельзя.'
            : 'Они пропадут из списка и из экспорта. Вернуть их будет нельзя.'}
        </p>
      </div>
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

  /**
   * Аналитика: выводы из накопленных цифр.
   *
   * Приложение давно собирало историю сессий, трафик, баллы и категории,
   * но показывало только суммы. Сумма отвечает на вопрос «сколько всего»,
   * а решения принимаются по другим: выгодно ли это, что окупается, чего
   * ждать дальше.
   */
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
      return;
    }
    box.style.display = '';

    const escape = (t) => String(t ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

    box.innerHTML = `
      <div class="missed-head">
        <span class="missed-title">Упущенные награды</span>
        <span class="missed-sum">${escape(window.MissedDrops.describe(result))}</span>
      </div>
      <div class="missed-note">
        Всего не хватило около ${this.formatDuration(result.shortMinutes)} просмотра · считается по кампаниям,
        которые приложение видело за последний месяц
      </div>
      <div class="missed-list">
        ${result.closest.map(m => `
          <div class="missed-item ${m.shortBy <= window.MissedDrops.CLOSE_MINUTES ? 'close' : ''}">
            <div class="missed-name">${escape(m.name)}</div>
            <div class="missed-game">${escape(m.game)}</div>
            <div class="missed-short">не хватило ${this.formatShort(m.shortBy)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /** Недобор в человеческом виде: меньше минуты не бывает. */
  formatShort(minutes) {
    return this.formatDuration(Math.max(1, Math.round(Number(minutes) || 0)));
  }

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
        label: 'Дропсов в час',
        value: totals.totalDrops > 0 ? this.formatNumber(dropsPerHour, 2) : '—',
        sub: hoursPerDrop
          ? `примерно ${this.formatHours(hoursPerDrop)} на одну награду`
          : 'награды пока не засчитывались'
      },
      {
        label: 'Трафик на час',
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
        label: 'Сэкономлено трафика',
        value: this.formatBytes(saved),
        sub: ratio
          ? `в ${this.formatNumber(ratio, 1)} раза экономнее, чем в ${TE.BASELINE_LABEL}`
          : `если бы смотрели в ${TE.BASELINE_LABEL}`
      });
    }

    // Упущенные награды: данные о них появились вместе с памятью о
    // кампаниях — раньше они исчезали вместе с самой кампанией
    this.renderMissed().catch(e => console.warn('[Статистика] Упущенные:', e?.message));

    grid.innerHTML = items.map(item => `
      <div class="analytics-item">
        <div class="analytics-label">${item.label}</div>
        <div class="analytics-value">${item.value}</div>
        <div class="analytics-sub">${item.sub}</div>
      </div>
    `).join('');

    if (note) {
      note.textContent = best
        // После «за» нужен винительный падеж: «за 1 сессию», а не «за 1 сессия»
        ? `Больше всего времени уходит на «${best.name}» — ${this.formatHours(best.time / 60)} за ${best.streams} ${this.plural(best.streams, 'сессию', 'сессии', 'сессий')}.`
        : '';
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

  updateStatsCards(minutes, streams, points, chests, bandwidth, drops) {
    // Общее время просмотра — тем же форматом, что и везде на странице:
    // раньше здесь было «1068h 41m», а рядом «ч/мин» и «ч м»
    const watchTimeEl = document.getElementById('total-watch-time');
    if (watchTimeEl) {
      watchTimeEl.textContent = this.formatDuration(minutes);
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
   * Приводит URL обложки Twitch к крупному размеру.
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

  renderTopCategories(categories) {
    const i18n = window.i18n;
    const container = document.getElementById('top-categories-section');
    if (!container) return;
    
    if (categories.length === 0) {
      container.innerHTML = `<div style="color: var(--text-secondary); text-align: center; padding: 40px;">${i18n.t('statistics.noData')}</div>`;
      return;
    }

    const topThree = categories.slice(0, 3);
    // Названия приходят от Twitch и вставляются в разметку и атрибуты
    const esc = window.escapeHtml;

    let html = `
      <div style="display: flex; gap: 28px; align-items: stretch;">
        <!-- Обложки (стопка) с новым дизайном -->
        <div class="categories-stack-wrapper">
          <div class="categories-stack-container">
    `;

    // Стопка первых 3 обложек
    topThree.forEach((cat, idx) => {
      const offset = idx * 12;
      const gameId = this.getCategoryIdFromName(cat.name);
      // В сессиях обложка сохраняется в размере 52x72 (миниатюра для списка
      // категорий), а здесь она рисуется крупно — отсюда мыло. Поднимаем размер.
      const boxUrl = this.upscaleBoxArt(cat.box) || `https://static-cdn.jtvnw.net/ttv-boxart/${gameId}-272x380.jpg`;
      html += `
        <div class="stack-cover-wrapper" style="transform: translate(${offset * 2}px, ${offset}px); z-index: ${10 - idx};">
          <img src="${esc(boxUrl)}"
               alt="${esc(cat.name)}"
               class="stack-cover"
               data-category="${esc(cat.name)}"
               data-game-id="${esc(gameId)}"
               title="${esc(cat.name)}"
               onerror="this.style.background='rgba(124, 92, 255, 0.2)'; this.style.opacity='0.6';">
        </div>`;
    });

    html += `
          </div>
        </div>
        <!-- Информация с новым дизайном -->
        <div style="flex: 1; min-width: 0;">
          <div class="top-categories-list">
    `;

    // Считаем общее время для процентов
    const totalTime = categories.reduce((sum, cat) => sum + cat.time, 0);
    
    categories.slice(0, Math.min(5, categories.length)).forEach((cat, idx) => {
      // Процент от общего времени
      const percentage = totalTime > 0 ? Math.round((cat.time / totalTime) * 100) : 0;

      // Средняя длительность сессии
      const avgSessionMins = cat.streams > 0 ? Math.round(cat.time / cat.streams) : 0;

      // Склонение раньше знало только «сеанс» и «сеансов» — выходило
      // «2 сеансов». Слово то же, что в аналитике: «сессия».
      html += `
        <div class="category-item">
          <div class="category-rank">#${idx + 1}</div>
          <div class="category-info">
            <div class="category-name" title="${esc(cat.name)}">${esc(cat.name)}</div>
            <div class="category-meta">
              <span class="category-sessions">${cat.streams} ${this.pluralSessions(cat.streams)}</span>
              <span class="category-divider">•</span>
              <span class="category-avg">в среднем ${this.formatDuration(avgSessionMins)}</span>
            </div>
          </div>
          <div class="category-stats">
            <div class="category-time">${this.formatDuration(cat.time)}</div>
            <div class="category-percentage">${percentage}%</div>
          </div>
        </div>
      `;
    });

    html += `</div></div></div>`;
    
    container.innerHTML = html;

    // Добавляем интерактивность к стопке
    const stackContainer = container.querySelector('.categories-stack-container');
    if (stackContainer) {
      stackContainer.addEventListener('mouseenter', () => {
        const covers = stackContainer.querySelectorAll('.stack-cover-wrapper');
        covers.forEach((wrapper, idx) => {
          wrapper.style.transform = `translateX(${idx * 125}px) translateY(${idx * 5}px) scale(1.08)`;
          wrapper.style.zIndex = idx + 100;
        });
      });
      stackContainer.addEventListener('mouseleave', () => {
        const covers = stackContainer.querySelectorAll('.stack-cover-wrapper');
        covers.forEach((wrapper, idx) => {
          const offset = idx * 12;
          wrapper.style.transform = `translate(${offset * 2}px, ${offset}px) scale(1)`;
          wrapper.style.zIndex = 10 - idx;
        });
      });
    }
  }

  updateSessionsTable(sessions) {
    const i18n = window.i18n;
    const container = document.getElementById('recent-sessions');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Показываем последние 10 сессий
    const recentSessions = sessions.slice(-10).reverse();
    
    if (recentSessions.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-secondary);">${i18n.t('statistics.noData')}</div>`;
      return;
    }
    
    const esc = window.escapeHtml;

    recentSessions.forEach((session, idx) => {
      const div = document.createElement('div');
      div.className = 'session-item';
      div.id = `session-${idx}`;
      
      const date = new Date(session.timestamp);
      const dateStr = date.toLocaleDateString('ru-RU');
      const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      
      const duration = this.formatDuration(session.duration || 0);
      const unknownCategory = !session.category || session.category === 'Unknown';
      const category = this.categoryLabel(session.category);
      const channel = this.channelLabel(session.channel);
      const bandwidth = session.bandwidth ? this.formatBytes(session.bandwidth) : '—';

      // Используем реальную обложку из сессии. Для неизвестной категории
      // подставлять обложку «Общения» нечестно — лучше без неё
      const coverUrl = session.categoryBoxArtURL || (unknownCategory ? '' : this.getDefaultCoverUrl(category));

      // Данные для графика (история пинга/интернета)
      const bandwidthHistory = session.bandwidthHistory || [];

      // Баллы — те, что сессия записала сама. Раньше здесь стояла выдуманная
      // формула «10 за каждые 5 минут», и список спорил с итогами наверху:
      // сессия с нулём баллов показывала «+55 010». Нет поля — нет цифры.
      const points = Number(session.pointsEarned);
      const pointsText = session.pointsEarned == null || !Number.isFinite(points)
        ? '—'
        : (points > 0 ? '+' + this.formatNumber(points) : '0');
      const chests = Number(session.chestsCollected) || 0;

      div.innerHTML = `
        <div class="session-cover-wrapper">
          ${coverUrl ? `<img src="${esc(coverUrl)}"
               alt="${esc(category)}"
               class="session-cover"
               onerror="this.style.display='none'">` : ''}
        </div>
        <div class="session-info" style="flex: 1; min-width: 0;">
          <div class="session-game">${esc(category)}</div>
          <div class="session-meta">
            <span style="display: flex; align-items: center; gap: 4px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              ${esc(channel)}
            </span>
            <span class="session-divider">•</span>
            <span>${dateStr} ${timeStr}</span>
            ${chests > 0 ? `
              <span class="session-divider">•</span>
              <span>${this.formatNumber(chests)} ${this.plural(chests, 'сундук', 'сундука', 'сундуков')}</span>` : ''}
            ${this.isSuspect(session) ? `
              <span class="session-divider">•</span>
              <span class="session-suspect" title="Больше суток без отметок о просмотре — в итоги не входит">не учтена в итогах</span>` : ''}
          </div>
        </div>
        <div class="session-stats-grid">
          <div class="session-stat">
            <div class="session-stat-value">${duration}</div>
            <div class="session-stat-label">${i18n.t('statistics.duration')}</div>
          </div>
          <div class="session-stat">
            <div class="session-stat-value session-points">${pointsText}</div>
            <div class="session-stat-label">${i18n.t('statistics.points')}</div>
          </div>
          <div class="session-stat">
            <div class="session-stat-value session-bandwidth">${bandwidth}</div>
            <div class="session-stat-label">${i18n.t('statistics.traffic')}</div>
          </div>
        </div>
        <div style="position: relative; overflow: hidden; display: none;" class="session-graph-container" data-graph-id="graph-${idx}">
          <canvas id="graph-${idx}" width="300" height="80" style="position: absolute; right: 0; bottom: 0; width: 300px; height: 80px;"></canvas>
        </div>
      `;
      
      div.style.transition = 'all 0.2s';
      div.addEventListener('mouseenter', () => {
        div.style.background = 'rgba(124, 92, 255, 0.08)';
        this.showBandwidthGraph(div, bandwidthHistory, idx);
      });
      div.addEventListener('mouseleave', () => {
        div.style.background = '';
        const graph = div.querySelector('.session-graph-container');
        if (graph) graph.style.display = 'none';
      });
      
      container.appendChild(div);
    });
  }

  showBandwidthGraph(element, bandwidthHistory, sessionIdx) {
    const graphContainer = element.querySelector('.session-graph-container');
    if (!graphContainer || bandwidthHistory.length === 0) return;
    
    graphContainer.style.display = 'block';
    const canvas = element.querySelector(`#graph-${sessionIdx}`);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 8;
    
    // Очищаем канвас
    ctx.clearRect(0, 0, width, height);
    
    // Данные для графика (берем последние 30 точек)
    const data = bandwidthHistory.slice(-30);
    if (data.length < 2) return;
    
    // Находим макс/мин значения
    const maxBw = Math.max(...data);
    const minBw = Math.min(...data);
    const range = maxBw - minBw || 1;
    
    // Размеры графика
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;
    const pointSpacing = graphWidth / (data.length - 1);
    
    // Рисуем фон градиента
    const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, 'rgba(124, 92, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(124, 92, 255, 0.02)');
    
    // Рисуем линию
    ctx.strokeStyle = 'rgb(124, 92, 255)';  // Твитч фиолетовый
    ctx.fillStyle = gradient;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Путь линии
    ctx.beginPath();
    data.forEach((value, i) => {
      const x = padding + i * pointSpacing;
      const normalizedValue = (value - minBw) / range;
      const y = height - padding - normalizedValue * graphHeight;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    // Замыкаем область для заливки
    const lastX = padding + (data.length - 1) * pointSpacing;
    ctx.lineTo(lastX, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();
    
    ctx.fill();
    
    // Рисуем линию поверх
    ctx.strokeStyle = 'rgb(124, 92, 255)';
    ctx.beginPath();
    data.forEach((value, i) => {
      const x = padding + i * pointSpacing;
      const normalizedValue = (value - minBw) / range;
      const y = height - padding - normalizedValue * graphHeight;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    
    // Рисуем точки
    ctx.fillStyle = 'rgb(124, 92, 255)';
    data.forEach((value, i) => {
      const x = padding + i * pointSpacing;
      const normalizedValue = (value - minBw) / range;
      const y = height - padding - normalizedValue * graphHeight;
      
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  getCategoryIdFromName(name) {
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
    
    return '509658'; // Fallback to Just Chatting
  }
  
  getDefaultCoverUrl(categoryName) {
    const gameId = this.getCategoryIdFromName(categoryName);
    return `https://static-cdn.jtvnw.net/ttv-boxart/${gameId}-272x380.jpg`;
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
