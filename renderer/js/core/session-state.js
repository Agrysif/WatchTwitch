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
    // С какого момента у сессии нет стрима (null — стрим есть)
    this.idleSince = null;
    // Последний ответ о трафике: { at, stats }. Страница фарминга берёт
    // отсюда данные для статистики, а не спрашивает main второй раз
    this.lastTraffic = null;

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

/**
   * Сколько можно не видеть сессию, чтобы ещё считать её продолжением.
   * Перезапуск после обновления или падения укладывается в минуту.
   */
  static get RESUME_GAP_MS() {
    return 10 * 60 * 1000;
  }

  /**
   * Сессия из хранилища — продолжение или уже прошлое.
   *
   * Раньше сохранённая сессия восстанавливалась всегда: закрыл приложение
   * вечером, открыл утром — и таймер сессии продолжал считать от вчерашнего
   * старта, засчитывая ночь, когда ничего не работало. В статистике так
   * появилась сессия на десять суток. Последний признак жизни — отметка
   * lastSeenAt, которую статистика пишет раз в минуту; у старых записей
   * её нет, тогда берём начало плюс записанную длительность.
   */
  static lastSeenOf(statsSession) {
    if (!statsSession) return 0;
    if (Number(statsSession.lastSeenAt) > 0) return Number(statsSession.lastSeenAt);
    const start = Number(statsSession.timestamp) || 0;
    const minutes = Number(statsSession.duration) || 0;
    return start ? start + minutes * 60000 : 0;
  }

  static isStale(statsSession, now = Date.now()) {
    const lastSeen = SessionState.lastSeenOf(statsSession);
    if (!lastSeen) return true;
    return now - lastSeen > SessionState.RESUME_GAP_MS;
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
    this.idleSince = null;
    // Замер прошлой сессии в новую не переносим
    this.lastTraffic = null;
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
    this.idleSince = null;

    // Таймер автовыключения живёт в памяти и при перезапуске пропадает.
    // Заводим его заново — на остаток от исходного начала сессии, иначе
    // после обновления приложения компьютер не выключился бы вовсе.
    window.shutdownManager?.startSessionTimer(this.startTime);

    this.showFarmingUI();
    this._tick();

    console.log('[SessionState] Сессия восстановлена');
  }

  stop() {
    this.startTime = null;
    this.categoryName = null;
    this.streamLogin = null;
    this.idleSince = null;
    this.lastTraffic = null;
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
    //
    // Простой считается по часам, а не по числу вызовов: _tick зовут ещё
    // роутер (syncUI) и старт сессии, и счётчик вызовов набегал вдвое
    // быстрее — сессия гасла через 23 секунды вместо 45.
    if (!window.playerManager?.hasStream()) {
      const now = Date.now();
      if (this.idleSince === null) this.idleSince = now;
      const idleSeconds = Math.round((now - this.idleSince) / 1000);

      if (now - this.idleSince > SessionState.IDLE_LIMIT_SECONDS * 1000) {
        console.warn('[SessionState] Стрима нет', idleSeconds, 'секунд — останавливаю сессию');
        this.idleSince = null;
        this._stopIdleSession();
        window.utils?.showToast('Сессия остановлена: стрим не запущен', 'warning');
        window.notifyFarmingEvent?.('Фарминг остановлен', 'Стрим не запустился, сессия завершена');
        return;
      }
    } else {
      this.idleSince = null;
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

  /**
   * Остановка сессии, у которой нет стрима.
   *
   * Раньше здесь был только stop(): блок сессии прятался, а страница
   * фарминга об этом не знала — её проверки дропсов, зачёта и смены игры
   * продолжали ходить в Twitch и могли сами включить плеер уже без сессии.
   * Видео шло, трафик тратился, статистика не писалась. Остановка
   * страницы сама завершит статистику, погасит её таймеры, выгрузит плеер
   * и через sessionStartTime = null вызовет stop(). Свой stop() — запасной
   * путь, когда страницы нет или она не справилась.
   */
  _stopIdleSession() {
    const page = window.farmingPage;
    if (page && !page._destroyed && typeof page.stopFarming === 'function') {
      try {
        page.stopFarming(false);
      } catch (error) {
        console.error('[SessionState] Страница не остановилась:', error);
      }
    }
    if (this.isActive()) this.stop();
  }

  async _updateTraffic() {
    if (!window.electronAPI?.getTrafficStats) return;

    try {
      const stats = await window.electronAPI.getTrafficStats();
      if (!stats) return;
      // Ответ мог прийти уже после остановки сессии
      if (this.isActive()) this.lastTraffic = { at: Date.now(), stats };

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
