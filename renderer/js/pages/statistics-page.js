// Statistics page logic
class StatisticsPage {
  constructor() {
    this.currentPeriod = 'all';
    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.loadStatistics();
  }

  setupEventListeners() {
    // Period buttons
    const periodBtns = document.querySelectorAll('.period-btn');
    periodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        periodBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentPeriod = btn.dataset.period;
        this.loadStatistics();
      });
    });

    // Export button
    const exportBtn = document.getElementById('export-stats-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportStatistics());
    }
  }

  async loadStatistics() {
    try {
      console.log('Loading statistics...');
      const stats = await Storage.getStatistics();
      console.log('Raw stats:', JSON.stringify(stats, null, 2));
      let sessions = stats.sessions || [];
      console.log('Sessions from storage:', sessions.length, sessions);
      
      // Если нет сессий, добавляем тестовые для демонстрации
      if (sessions.length === 0) {
        console.log('No sessions found, adding test data...');
        
        // Ждём каждого addSession
        await Storage.addSession({
          timestamp: Date.now() - 3600000,
          duration: 60,
          category: 'Rocket League',
          channel: 'shroud',
          bandwidth: 1024000,
          bandwidthHistory: [300, 310, 295, 320, 300],
          categoryBoxArtURL: 'https://static-cdn.jtvnw.net/ttv-boxart/30921-272x380.jpg',
          pointsEarned: 500,
          chestsCollected: 2,
          dropsCollected: 1
        });
        console.log('Test session 1 added');
        
        await Storage.addSession({
          timestamp: Date.now() - 7200000,
          duration: 45,
          category: 'League of Legends',
          channel: 'doublelift',
          bandwidth: 900000,
          bandwidthHistory: [250, 260, 240, 270, 260],
          categoryBoxArtURL: 'https://static-cdn.jtvnw.net/ttv-boxart/21779-272x380.jpg',
          pointsEarned: 300,
          chestsCollected: 1,
          dropsCollected: 0
        });
        console.log('Test session 2 added');
        
        const updatedStats = await Storage.getStatistics();
        sessions = updatedStats.sessions || [];
        console.log('After adding test data, sessions:', sessions.length, sessions);
      }
      
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
      
      case 'all':
      default:
        return sessions;
    }
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

  renderTopCategories(categories) {
    const container = document.getElementById('top-categories-section');
    if (!container) return;
    
    if (categories.length === 0) {
      container.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 20px;">Нет данных</div>';
      return;
    }

    const topThree = categories.slice(0, 3);
    const rest = categories.slice(3);

    let html = `
      <div style="display: flex; gap: 24px; align-items: flex-start;">
        <!-- Обложки (стопка) -->
        <div class="categories-stack-container" style="position: relative; width: 140px; height: 180px; cursor: pointer; flex-shrink: 0;">
    `;

    // Стопка первых 3 обложек
    topThree.forEach((cat, idx) => {
      const offset = idx * 10;
      // Используем правильный размер 272x380 для лучшего качества
      const gameId = this.getCategoryIdFromName(cat.name);
      const boxUrl = cat.box || `https://static-cdn.jtvnw.net/ttv-boxart/${gameId}-272x380.jpg`;
      html += `
        <img src="${boxUrl}" 
             alt="${cat.name}" 
             style="position: absolute; width: 110px; height: 150px; border-radius: 10px; object-fit: cover; 
                    left: ${offset}px; top: ${offset}px; z-index: ${10 - idx}; 
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); cursor: pointer; background: var(--bg-secondary);"
             class="stack-cover" 
             data-category="${cat.name}"
             data-game-id="${gameId}"
             title="${cat.name}"
             onerror="this.style.background='linear-gradient(135deg, var(--bg-secondary) 0%, rgba(145, 71, 255, 0.1) 100%)'; this.style.opacity='0.6';">`;
    });

    html += `
        </div>
        <!-- Информация -->
        <div style="flex: 1;">
          <div style="display: grid; gap: 12px;">
    `;

    categories.slice(0, Math.min(5, categories.length)).forEach(cat => {
      const hours = Math.floor(cat.time / 60);
      const mins = cat.time % 60;
      const lastDate = new Date(cat.lastDate).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
      html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; 
                    background: var(--surface-bg); border-radius: 8px; border-left: 3px solid var(--accent-color);">
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px; font-size: 14px;">${cat.name}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${cat.streams} сеанс${cat.streams % 10 === 1 && cat.streams !== 11 ? '' : 'ов'}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 700; color: var(--accent-color); font-size: 16px;">${hours}ч</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${lastDate}</div>
          </div>
        </div>
      `;
    });

    if (rest.length > 0) {
      html += `<div style="text-align: center; padding: 12px; color: var(--text-secondary); font-size: 13px; border-top: 1px solid var(--border-color); margin-top: 8px;">+ ещё ${rest.length} категорий</div>`;
    }

    html += `</div></div></div>`;
    
    container.innerHTML = html;

    // Добавляем интерактивность к стопке
    const stackContainer = container.querySelector('.categories-stack-container');
    if (stackContainer) {
      stackContainer.addEventListener('mouseenter', () => {
        const covers = stackContainer.querySelectorAll('.stack-cover');
        covers.forEach((cover, idx) => {
          cover.style.transform = `translateX(${idx * 115}px) scale(1.05)`;
          cover.style.zIndex = idx + 100;
          cover.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)';
        });
      });
      stackContainer.addEventListener('mouseleave', () => {
        const covers = stackContainer.querySelectorAll('.stack-cover');
        covers.forEach((cover, idx) => {
          cover.style.transform = 'translateX(0) scale(1)';
          cover.style.zIndex = 10 - idx;
          cover.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
        });
      });
    }
  }

  updateSessionsTable(sessions) {
    const container = document.getElementById('recent-sessions');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Показываем последние 10 сессий
    const recentSessions = sessions.slice(-10).reverse();
    
    if (recentSessions.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No sessions recorded yet</div>';
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
      
      div.innerHTML = `
        <img src="${coverUrl}" 
             alt="${category}" 
             style="width: 52px; height: 72px; border-radius: 6px; object-fit: cover; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);"
             onerror="this.style.display='none'">
        <div class="session-info" style="flex: 1; min-width: 0;">
          <div class="session-game" style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${category}</div>
          <div class="session-meta" style="font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="display: flex; align-items: center; gap: 3px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              ${channel}
            </span>
            <span style="opacity: 0.5;">•</span>
            <span>${dateStr} ${timeStr}</span>
          </div>
        </div>
        <div style="text-align: right; display: flex; flex-direction: column; gap: 3px; align-items: flex-end;">
          <div style="font-size: 16px; font-weight: 700; color: var(--accent-color);">${duration}</div>
          <div style="font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 3px;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            ${bandwidth}
          </div>
        </div>
        <div style="position: relative; overflow: hidden; display: none;" class="session-graph-container" data-graph-id="graph-${idx}">
          <canvas id="graph-${idx}" width="300" height="80" style="position: absolute; right: 0; bottom: 0; width: 300px; height: 80px;"></canvas>
        </div>
      `;
      
      div.style.transition = 'all 0.2s';
      div.addEventListener('mouseenter', () => {
        div.style.background = 'rgba(145, 71, 255, 0.08)';
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
    gradient.addColorStop(0, 'rgba(145, 71, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(145, 71, 255, 0.02)');
    
    // Рисуем линию
    ctx.strokeStyle = 'rgb(145, 71, 255)';  // Твитч фиолетовый
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
    ctx.strokeStyle = 'rgb(145, 71, 255)';
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
    ctx.fillStyle = 'rgb(145, 71, 255)';
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
      'Just Chatting': '509658'
    };
    
    return knownGames[name] || '509658'; // Fallback to Just Chatting
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

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
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
