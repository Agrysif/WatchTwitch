/**
 * SessionState — состояние сессии фарминга, живущее НАД страницами.
 *
 * Зачем: блок «Сессия» и кнопки старт/стоп находятся в сайдбаре (index.html),
 * то есть существуют всегда. А управлял ими объект FarmingPage, который роутер
 * пересоздаёт при каждом заходе на страницу фарминга и чей destroy() гасит
 * sessionInterval при уходе с неё. В результате таймер замерзал, а кнопки и блок
 * сессии показывались или нет в зависимости от того, какая ветка кода успела
 * отработать последней.
 *
 * Теперь единственный владелец этого состояния — данный синглтон. Его таймер
 * не привязан к жизни страницы и не останавливается при навигации.
 */
class SessionState {
  constructor() {
    this.startTime = null;
    this.categoryName = null;
    this.streamLogin = null;
    this.tickInterval = null;

    // Тикаем всегда: если сессии нет, _tick просто ничего не рисует.
    this._startTicking();
  }

  static get() {
    if (!window._sessionState) {
      window._sessionState = new SessionState();
    }
    return window._sessionState;
  }

  isActive() {
    return this.startTime !== null;
  }

  /** Начало новой сессии. Обнуляет счётчик трафика. */
  start(meta = {}) {
    this.startTime = Date.now();
    this.categoryName = meta.categoryName || null;
    this.streamLogin = meta.streamLogin || null;

    window.electronAPI?.resetTrafficSession?.();
    this.showFarmingUI();
    this._tick();

    console.log('[SessionState] Сессия начата');
  }

  /** Восстановление ранее начатой сессии (после перезапуска приложения). */
  restore(startTime, meta = {}) {
    this.startTime = startTime || Date.now();
    this.categoryName = meta.categoryName || null;
    this.streamLogin = meta.streamLogin || null;

    this.showFarmingUI();
    this._tick();

    console.log('[SessionState] Сессия восстановлена');
  }

  stop() {
    this.startTime = null;
    this.categoryName = null;
    this.streamLogin = null;
    this.hideFarmingUI();

    console.log('[SessionState] Сессия остановлена');
  }

  getDurationMs() {
    return this.startTime ? Date.now() - this.startTime : 0;
  }

  _startTicking() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this._tick(), 1000);
  }

  _formatDuration(ms) {
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':');
  }

  _formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async _tick() {
    if (!this.isActive()) return;

    const text = this._formatDuration(this.getDurationMs());

    // Сайдбар — существует всегда
    const sidebarDuration = document.getElementById('session-duration');
    if (sidebarDuration) sidebarDuration.textContent = text;

    // Таймер в шапке страницы фарминга — только когда эта страница открыта
    const headerTimer = document.getElementById('session-timer-display');
    const headerValue = document.getElementById('session-time-value');
    if (headerTimer && headerValue) {
      headerTimer.style.display = 'block';
      headerValue.textContent = text;
    }

    await this._updateTraffic();
  }

  async _updateTraffic() {
    if (!window.electronAPI?.getTrafficStats) return;

    try {
      const stats = await window.electronAPI.getTrafficStats();
      if (!stats) return;

      const valueEl = document.getElementById('session-traffic-value');
      if (valueEl) valueEl.textContent = this._formatBytes(stats.sessionBytes || 0);

      const rateEl = document.getElementById('session-traffic-rate');
      if (rateEl) {
        const rate = Math.round(stats.currentRateKBs || 0);
        rateEl.textContent = rate > 1024 ? `${(rate / 1024).toFixed(1)} МБ/с` : `${rate} КБ/с`;
      }
    } catch (error) {
      // молча: отсутствие статистики не должно ломать таймер
    }
  }

  /** Сайдбар в режиме активного фарминга: блок сессии + кнопка «Остановить». */
  showFarmingUI() {
    const sessionInfo = document.getElementById('farming-session-info');
    if (sessionInfo) {
      sessionInfo.style.display = 'block';
      requestAnimationFrame(() => {
        sessionInfo.style.opacity = '1';
        sessionInfo.style.transform = 'translateY(0)';
      });
    }

    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');

    if (startBtn) {
      startBtn.style.display = 'none';
      startBtn.style.opacity = '0';
      startBtn.style.transform = 'scale(0.95)';
    }
    if (stopBtn) {
      stopBtn.style.display = 'flex';
      stopBtn.style.opacity = '1';
      stopBtn.style.transform = 'scale(1)';
    }
  }

  hideFarmingUI() {
    const sessionInfo = document.getElementById('farming-session-info');
    if (sessionInfo) {
      sessionInfo.style.opacity = '0';
      sessionInfo.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        if (!this.isActive()) sessionInfo.style.display = 'none';
      }, 300);
    }

    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');

    if (stopBtn) {
      stopBtn.style.opacity = '0';
      stopBtn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        if (!this.isActive()) stopBtn.style.display = 'none';
      }, 200);
    }
    if (startBtn) {
      startBtn.style.display = 'flex';
      requestAnimationFrame(() => {
        startBtn.style.opacity = '1';
        startBtn.style.transform = 'scale(1)';
      });
    }

    const headerTimer = document.getElementById('session-timer-display');
    if (headerTimer) headerTimer.style.display = 'none';
  }

  /**
   * Приводит сайдбар в соответствие с состоянием. Вызывается роутером после
   * каждой навигации — раньше именно этой синхронизации и не хватало,
   * из-за чего кнопка и блок сессии «пропадали».
   */
  syncUI() {
    if (this.isActive()) {
      this.showFarmingUI();
      this._tick();
    } else {
      this.hideFarmingUI();
    }
  }
}

window.SessionState = SessionState;
window.sessionState = SessionState.get();
