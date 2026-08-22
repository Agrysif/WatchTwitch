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
          datePicker.style.animation = 'fadeIn 0.3s ease';
          
          // Устанавливаем сегодняшнюю дату автоматически
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];
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
      applyBtn.addEventListener('click', () => {
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        
        if (!startDate || !endDate) {
          window.utils.showToast('Выберите обе даты', 'warning');
          return;
        }
        
        this.customStartDate = new Date(startDate).getTime();
        this.customEndDate = new Date(endDate).setHours(23, 59, 59, 999);
        
        if (this.customStartDate > this.customEndDate) {
          window.utils.showToast('Дата начала не может быть позже даты окончания', 'error');
          return;
        }
        
        this.loadStatistics();
      });
    }

    // Export button
    const exportBtn = document.getElementById('export-stats-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportStatistics());
    }
  }
  
  updateDateDisplay(inputId, dateValue) {
    if (!dateValue) return;
    
    const date = new Date(dateValue);
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
      console.log('Loading statistics...');
      const stats = await Storage.getStatistics();
      console.log('Raw stats:', JSON.stringify(stats, null, 2));
      let sessions = stats.sessions || [];
      console.log('Sessions from storage:', sessions.length, sessions);
      
      // Демонстрационные сессии здесь больше не создаются.
      //
      // Раньше при пустой статистике сюда ЗАПИСЫВАЛИСЬ две выдуманные сессии
      // (Rocket League/shroud и League of Legends/doublelift) — прямо в реальное
      // хранилище, а не только в отображение. Они давали 800 баллов, 3 сундука
      // и 1 дропс, которые потом навсегда смешивались с настоящей статистикой
      // и выглядели как ошибка подсчёта.

      // Фильтруем сессии по периоду
      const filteredSessions = this.filterSessionsByPeriod(sessions);
      console.log('Filtered sessions count:', filteredSessions.length, filteredSessions);
      
      // Считаем общую статистику
      const totalMinutes = filteredSessions.reduce((sum, s) => sum + (s.duration || 0), 0);
      const totalStreams = filteredSessions.length;
      
      // Считаем баллы и сундуки
      const totalPoints = filteredSessions.reduce((sum, s) => sum + (s.pointsEarned || 0), 0);
      const totalChests = filteredSessions.reduce((sum, s) => sum + (s.chestsCollected || 0), 0);
      
      // Считаем полученные дропсы
      const totalDrops = filteredSessions.reduce((sum, s) => sum + (s.dropsCollected || 0), 0);
      
      // Находим топ категорий с статистикой
      const categoryStats = {};
      filteredSessions.forEach(session => {
        const cat = session.category || 'Unknown';
        if (!categoryStats[cat]) {
          categoryStats[cat] = { time: 0, box: session.categoryBoxArtURL || '', streams: 0, lastDate: 0 };
        }
        categoryStats[cat].time += (session.duration || 0);
        categoryStats[cat].streams += 1;
        categoryStats[cat].lastDate = Math.max(categoryStats[cat].lastDate, session.timestamp || 0);
      });
      
      const topCategories = Object.entries(categoryStats)
        .sort((a, b) => b[1].time - a[1].time)
        .slice(0, 10)
        .map(([name, data]) => ({ name, ...data }));
      
      // Считаем трафик (из последних сессий)
      let totalBandwidth = 0;
      filteredSessions.forEach(session => {
        if (session.bandwidth) {
          totalBandwidth += session.bandwidth;
        }
      });
      
      // Обновляем UI
      console.log('Updating UI with stats:', { totalMinutes, totalStreams, totalPoints, totalChests, totalDrops });
      this.updateStatsCards(totalMinutes, totalStreams, totalPoints, totalChests, totalBandwidth, totalDrops);
      this.renderAnalytics(filteredSessions, { totalMinutes, totalDrops, totalPoints, totalBandwidth, topCategories });
      
      // Рендерим топ категорий
      console.log('Rendering top categories:', topCategories);
      this.renderTopCategories(topCategories);
      
      // Обновляем список сессий
      console.log('Rendering sessions table:', filteredSessions.length, 'sessions');
      this.updateSessionsTable(filteredSessions);
      
    } catch (error) {
      console.error('Error loading statistics:', error);
      console.error('Error stack:', error.stack);
      window.utils.showToast('Ошибка загрузки статистики: ' + error.message, 'error');
    }
  }

  filterSessionsByPeriod(sessions) {
    const now = Date.now();
    
    switch (this.currentPeriod) {
      case 'month':
        const monthAgo = now - (30 * 24 * 60 * 60 * 1000);
        return sessions.filter(s => s.timestamp > monthAgo);
      
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

    const часы = Math.round(result.shortMinutes / 60);

    box.innerHTML = `
      <div class="missed-head">
        <span class="missed-title">Упущенные награды</span>
        <span class="missed-sum">${escape(window.MissedDrops.describe(result))}</span>
      </div>
      <div class="missed-note">
        Всего не хватило около ${часы} ч просмотра · считается по кампаниям,
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

  /** Недобор в человеческом виде. */
  formatShort(minutes) {
    const total = Math.max(1, Math.round(minutes));
    if (total < 60) return `${total} мин`;

    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
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
        value: totals.totalDrops > 0 ? dropsPerHour.toFixed(2) : '—',
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
        value: pointsPerHour > 0 ? Math.round(pointsPerHour).toLocaleString() : '—',
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
          ? `в ${ratio.toFixed(1)} раза экономнее, чем в ${TE.BASELINE_LABEL}`
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
        ? `Больше всего времени уходит на «${best.name}» — ${this.formatHours(best.time / 60)} за ${best.streams} ${this.pluralSessions(best.streams)}.`
        : '';
    }

    card.style.display = 'block';
  }

  formatHours(hours) {
    if (!Number.isFinite(hours) || hours <= 0) return '—';
    if (hours < 1) return Math.round(hours * 60) + ' мин';
    if (hours < 10) return hours.toFixed(1).replace('.0', '') + ' ч';
    return Math.round(hours) + ' ч';
  }

  pluralSessions(count) {
    const n = Math.abs(count) % 100;
    if (n >= 11 && n <= 14) return 'сессий';
    const last = n % 10;
    if (last === 1) return 'сессия';
    if (last >= 2 && last <= 4) return 'сессии';
    return 'сессий';
  }

  updateStatsCards(minutes, streams, points, chests, bandwidth, drops) {
    // Общее время просмотра
    const watchTimeEl = document.getElementById('total-watch-time');
    if (watchTimeEl) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      watchTimeEl.textContent = `${hours}h ${mins}m`;
    }
    
    // Заработано баллов
    const pointsEl = document.getElementById('total-points');
    if (pointsEl) {
      pointsEl.textContent = points.toLocaleString('ru-RU');
    }
    
    // Собрано сундучков
    const chestsEl = document.getElementById('total-chests');
    if (chestsEl) {
      chestsEl.textContent = chests;
    }
    
    // Получено дропсов
    const dropsEl = document.getElementById('drops-collected');
    if (dropsEl) {
      dropsEl.textContent = drops || 0;
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
          <img src="${boxUrl}" 
               alt="${cat.name}" 
               class="stack-cover" 
               data-category="${cat.name}"
               data-game-id="${gameId}"
               title="${cat.name}"
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
      const hours = Math.floor(cat.time / 60);
      const mins = cat.time % 60;
      const lastDate = new Date(cat.lastDate).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
      
      // Процент от общего времени
      const percentage = totalTime > 0 ? Math.round((cat.time / totalTime) * 100) : 0;
      
      // Средняя длительность сессии
      const avgSessionMins = cat.streams > 0 ? Math.round(cat.time / cat.streams) : 0;
      const avgHours = Math.floor(avgSessionMins / 60);
      const avgMins = avgSessionMins % 60;
      const avgText = avgHours > 0 ? `${avgHours}ч ${avgMins}м` : `${avgMins}м`;
      
      html += `
        <div class="category-item">
          <div class="category-rank">#${idx + 1}</div>
          <div class="category-info">
            <div class="category-name">${cat.name}</div>
            <div class="category-meta">
              <span class="category-sessions">${cat.streams} сеанс${cat.streams % 10 === 1 && cat.streams !== 11 ? '' : 'ов'}</span>
              <span class="category-divider">•</span>
              <span class="category-avg">~${avgText}/сессия</span>
            </div>
          </div>
          <div class="category-stats">
            <div class="category-time">${hours}ч ${mins > 0 ? mins + 'м' : ''}</div>
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
    
    recentSessions.forEach((session, idx) => {
      const div = document.createElement('div');
      div.className = 'session-item';
      div.id = `session-${idx}`;
      
      const date = new Date(session.timestamp);
      const dateStr = date.toLocaleDateString('ru-RU');
      const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      
      const duration = this.formatDuration(session.duration || 0);
      const category = session.category || '-';
      const channel = session.channel || '-';
      const bandwidth = session.bandwidth ? this.formatBytes(session.bandwidth) : '-';
      
      // Используем реальную обложку из сессии
      const coverUrl = session.categoryBoxArtURL || this.getDefaultCoverUrl(category);
      
      // Данные для графика (история пинга/интернета)
      const bandwidthHistory = session.bandwidthHistory || [];
      const dataJson = encodeURIComponent(JSON.stringify(bandwidthHistory));
      
      // Вычисляем баллы заработанные за сессию (примерно)
      const pointsEarned = Math.floor((session.duration || 0) / 5) * 10;
      
      div.innerHTML = `
        <div class="session-cover-wrapper">
          <img src="${coverUrl}" 
               alt="${category}" 
               class="session-cover"
               onerror="this.style.display='none'">
        </div>
        <div class="session-info" style="flex: 1; min-width: 0;">
          <div class="session-game">${category}</div>
          <div class="session-meta">
            <span style="display: flex; align-items: center; gap: 4px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              ${channel}
            </span>
            <span class="session-divider">•</span>
            <span>${dateStr} ${timeStr}</span>
          </div>
        </div>
        <div class="session-stats-grid">
          <div class="session-stat">
            <div class="session-stat-value">${duration}</div>
            <div class="session-stat-label">${i18n.t('statistics.duration')}</div>
          </div>
          <div class="session-stat">
            <div class="session-stat-value session-points">+${pointsEarned}</div>
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

  formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  /** Единицы русские — в сайдбаре они уже такие, разнобой бросался в глаза. */
  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 Б';

    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);

    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async exportStatistics() {
    try {
      const stats = await Storage.getStatistics();
      const dataStr = JSON.stringify(stats, null, 2);
      
      // Создаем blob и скачиваем
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `watchtwitch-stats-${Date.now()}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      
      window.utils.showToast('Статистика экспортирована', 'success');
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
