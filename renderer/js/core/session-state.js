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

    // Учёт баллов канала живёт здесь, а не на странице фарминга.
    // Опрос принадлежал объекту страницы, и destroy() гасил его при уходе с
    // неё — баллы копились только пока страница открыта, а в статистику
    // попадали огрызки.
    this.points = SessionState.emptyPoints();
    this.pointsPollInterval = null;
    this.dropsCollected = 0;
    this.idleTicks = 0;

    // Тикаем всегда: если сессии нет, _tick просто ничего не рисует.
    this._startTicking();
  }

  // Сундук даёт разовую крупную прибавку (Twitch выдаёт 50 и больше),
  // пассивный просмотр начисляет мелкими порциями
  static get CHEST_THRESHOLD() {
    return 50;
  }

  /**
   * Сколько секунд сессия может прожить без играющего стрима.
   * Запас нужен на перезагрузку плеера сторожем и на смену канала —
   * в эти моменты стрима нет секунду-другую, и это нормально.
   */
  static get IDLE_LIMIT_SECONDS() {
    return 45;
  }

  static emptyPoints() {
    return {
      initialized: false,
      startTotal: 0,
      currentTotal: 0,
      earnedThisStream: 0,
      sessionEarned: 0,
      passiveEarned: 0,
      chestsCollected: 0,
      chestsPoints: 0
    };
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
    this.idleTicks = 0;
    this.resetPoints();
    window.shutdownManager?.startSessionTimer();
    window.playerManager?.resetQualityForNewSession();
    this.showFarmingUI();
    this._tick();

    console.log('[SessionState] Сессия начата');
  }

  /** Восстановление ранее начатой сессии (после перезапуска приложения). */
  restore(startTime, meta = {}) {
    this.startTime = startTime || Date.now();
    this.categoryName = meta.categoryName || null;
    this.streamLogin = meta.streamLogin || null;
    this.idleTicks = 0;

    this.showFarmingUI();
    this._tick();

    console.log('[SessionState] Сессия восстановлена');
  }

  stop() {
    this.startTime = null;
    this.categoryName = null;
    this.streamLogin = null;
    this.stopPointsPolling();
    window.shutdownManager?.cancelSessionTimer();
    this.hideFarmingUI();

    console.log('[SessionState] Сессия остановлена');
  }

  // ===== БАЛЛЫ КАНАЛА =====

  /** Полный сброс — новая сессия фарминга. */
  resetPoints() {
    this.points = SessionState.emptyPoints();
    this.dropsCollected = 0;
    this.renderPoints();
  }

  /**
   * Переход на другой стрим: счётчики текущего стрима обнуляются,
   * накопленное за сессию сохраняется.
   */
  onStreamChanged(streamLogin) {
    const carried = this.points;
    this.points = {
      ...SessionState.emptyPoints(),
      sessionEarned: carried.sessionEarned || 0,
      passiveEarned: carried.passiveEarned || 0,
      chestsCollected: carried.chestsCollected || 0,
      chestsPoints: carried.chestsPoints || 0
    };
    this.streamLogin = streamLogin || this.streamLogin;
    this.renderPoints();

    if (this.streamLogin) this.startPointsPolling(this.streamLogin);
  }

  startPointsPolling(streamLogin) {
    if (!streamLogin) return;
    this.streamLogin = streamLogin;

    this.stopPointsPolling();

    // Первый опрос с задержкой: сразу после запуска стрима Twitch ещё не
    // отдаёт корректный баланс
    setTimeout(() => this.pollPoints(), 8000);
    this.pointsPollInterval = setInterval(() => this.pollPoints(), 20000);
  }

  stopPointsPolling() {
    if (this.pointsPollInterval) {
      clearInterval(this.pointsPollInterval);
      this.pointsPollInterval = null;
    }
  }

  /**
   * Сундук забран запросом из main. Учитываем здесь, а прирост баланса,
   * который увидит следующий опрос, в сундуки уже не записываем — иначе
   * он посчитается дважды.
   */
  noteChest(points) {
    this.points.chestsCollected += 1;
    this.points.chestsPoints += Number(points) || 0;
    this._chestClaimedAt = Date.now();
    this.renderPoints();
  }

  async pollPoints() {
    if (!this.streamLogin || !window.electronAPI?.getChannelPoints) return;

    try {
      const result = await window.electronAPI.getChannelPoints(this.streamLogin);
      if (!result || result.error || typeof result.points !== 'number') return;

      const newTotal = result.points;

      // Первое измерение только задаёт точку отсчёта.
      // Флаг нужен отдельно от нуля: баланс канала честно может быть 0,
      // и раньше в этом случае отсчёт переинициализировался бесконечно.
      if (!this.points.initialized) {
        this.points.initialized = true;
        this.points.startTotal = newTotal;
        this.points.currentTotal = newTotal;
        this.renderPoints();
        return;
      }

      const diff = newTotal - this.points.currentTotal;
      this.points.currentTotal = newTotal;

      if (diff > 0) {
        // Накапливаем приросты, а не разницу с началом: если баллы потратить,
        // разница уедет в минус и обнулит показания.
        this.points.earnedThisStream += diff;
        this.points.sessionEarned += diff;

        // Сундук, собранный запросом из main, уже учтён через noteChest.
        // Порядок событий между IPC-сообщением и ответом опроса не
        // гарантирован, поэтому смотрим по времени: прирост в первые
        // полторы минуты после сбора — тот самый сундук
        const chestJustClaimed = this._chestClaimedAt && (Date.now() - this._chestClaimedAt) < 90000;
        if (chestJustClaimed && diff >= SessionState.CHEST_THRESHOLD) {
          this._chestClaimedAt = 0;
        } else if (diff >= SessionState.CHEST_THRESHOLD) {
          this.points.chestsCollected += 1;
          this.points.chestsPoints += diff;
          console.log('[SessionState] Сундук: +' + diff);
        } else {
          this.points.passiveEarned += diff;
        }
      }

      this.renderPoints();
    } catch (error) {
      console.warn('[SessionState] Не удалось опросить баллы:', error?.message);
    }
  }

  /** Отрисовка карточки «Баллы канала». Элементы есть только на странице фарминга. */
  renderPoints() {
    const p = this.points;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    // Колонка 1 — нафармлено за сессию, ниже текущий баланс канала
    set('channel-points-total', p.sessionEarned > 0 ? `+${p.sessionEarned.toLocaleString()}` : '0');
    set('channel-points-earned', p.initialized
      ? `Баланс: ${p.currentTotal.toLocaleString()}`
      : 'Ожидание данных...');

    // Колонка 2 — сундуки: количество и суммарные бонусные баллы
    set('bonus-chests-count', p.chestsCollected.toLocaleString());
    set('bonus-chests-points', p.chestsPoints > 0 ? `+${p.chestsPoints.toLocaleString()} баллов` : '-');

    // Колонка 3 — начислено на текущем стриме
    set('passive-points-earned', p.earnedThisStream > 0 ? `+${p.earnedThisStream.toLocaleString()}` : '0');
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

    // Сессия без стрима — не сессия.
    //
    // Раньше состояние сессии жило само по себе: после запуска приложения
    // в сайдбаре шёл таймер и капал трафик, хотя плеер ничего не играл.
    // Даём запас на перезагрузку плеера и смену канала, а если стрима нет
    // дольше — останавливаем сессию честно.
    if (!window.playerManager?.hasStream()) {
      this.idleTicks = (this.idleTicks || 0) + 1;

      if (this.idleTicks > SessionState.IDLE_LIMIT_SECONDS) {
        console.warn('[SessionState] Стрима нет', this.idleTicks, 'секунд — останавливаю сессию');
        this.idleTicks = 0;
        this.stop();
        window.utils?.showToast('Сессия остановлена: стрим не запущен', 'warning');
        window.notifyFarmingEvent?.('Фарминг остановлен', 'Стрим не запустился, сессия завершена');
        return;
      }
    } else {
      this.idleTicks = 0;
    }

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
      this.renderPoints();
      this._tick();
    } else {
      this.hideFarmingUI();
    }
  }
}

window.SessionState = SessionState;
window.sessionState = SessionState.get();
