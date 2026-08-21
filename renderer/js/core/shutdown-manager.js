/**
 * ShutdownManager — выключение компьютера после того, как фарминг закончил работу.
 *
 * Механика выключения в main-процессе (shutdown / sleep / hibernate) была
 * реализована давно, но вызвать её было некому: обработчик завершения жил
 * в неиспользуемой части StreamingManager. Здесь она собрана целиком и
 * управляется настройками.
 *
 * Настройки:
 *   enableShutdown        — включено ли вообще
 *   shutdownAction        — shutdown | sleep | hibernate
 *   shutdownTrigger       — drops | streamEnd | any | timer (когда срабатывать)
 *   shutdownTimerHours    — для режима timer: через сколько часов фарминга
 *   shutdownDelayMinutes  — сколько ждать перед выполнением
 *
 * Отсчёт всегда виден и всегда отменяем: выключение чужого компьютера без
 * возможности передумать — не то, что приложение вправе делать молча.
 */
class ShutdownManager {
  constructor() {
    this.armed = false;
    this.timer = null;
    this.tick = null;
    this.overlay = null;
    this.sessionTimer = null;
  }

  static get() {
    if (!window._shutdownManager) {
      window._shutdownManager = new ShutdownManager();
    }
    return window._shutdownManager;
  }

  get settings() {
    return window.settings;
  }

  /** Все дропсы собраны, фармить больше нечего. */
  onDropsCompleted() {
    this._maybeArm('drops', 'Все дропсы собраны');
  }

  /** Стрим закончился, а переключаться не на что или запрещено. */
  onStreamEnded() {
    this._maybeArm('streamEnd', 'Стрим завершён');
  }

  /**
   * Таймер обратного отсчёта от старта фарминга.
   *
   * Отдельный режим, не связанный с дропсами: «пусть фармит три часа и
   * выключит компьютер». Заводится при старте сессии и снимается при
   * остановке — иначе он сработал бы после того, как фарминг уже не идёт.
   */
  startSessionTimer() {
    this.cancelSessionTimer();

    const settings = this.settings;
    if (!settings || !settings.get('enableShutdown')) return;
    if ((settings.get('shutdownTrigger') || 'drops') !== 'timer') return;

    const hours = Number(settings.get('shutdownTimerHours'));
    if (!Number.isFinite(hours) || hours <= 0) return;

    const ms = hours * 60 * 60 * 1000;
    console.log('[Выключение] Таймер сессии на', hours, 'ч');

    // Момент срабатывания запоминаем отдельно: из setTimeout его не
    // достать, а он нужен, чтобы показать, что успеется забрать до него
    this.sessionTimerAt = Date.now() + ms;

    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null;
      this.sessionTimerAt = null;
      this.arm(
        settings.get('shutdownAction') || 'shutdown',
        Number(settings.get('shutdownDelayMinutes')) || 0,
        `Прошло ${hours} ч фарминга`
      );
    }, ms);
  }

  cancelSessionTimer() {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    this.sessionTimerAt = null;
  }

  /**
   * Сколько минут осталось до автовыключения по таймеру.
   * null — таймер не заведён, значит и ограничения по времени нет.
   */
  minutesUntilTimer() {
    if (!this.sessionTimerAt) return null;

    const left = (this.sessionTimerAt - Date.now()) / 60000;
    return left > 0 ? left : null;
  }

  /**
   * Человеческое описание того, когда сработает выключение.
   * Показывается в настройках: включать переключатель, не понимая,
   * что произойдёт и когда, — страшно.
   */
  describeSchedule() {
    const settings = this.settings;
    if (!settings || !settings.get('enableShutdown')) return 'Выключение отключено';

    const trigger = settings.get('shutdownTrigger') || 'drops';
    const delay = Number(settings.get('shutdownDelayMinutes')) || 0;
    const hours = Number(settings.get('shutdownTimerHours')) || 0;

    const when = {
      drops: 'когда будут собраны все дропсы',
      streamEnd: 'когда завершится стрим',
      any: 'когда собраны все дропсы или завершится стрим',
      timer: `через ${hours} ч после начала фарминга`
    }[trigger] || '';

    const after = delay > 0
      ? `, затем ещё ${delay} мин на отмену`
      : ', с отсчётом в полминуты на отмену';

    return `Сработает ${when}${after}. Отсчёт можно прервать.`;
  }

  _maybeArm(event, reasonText) {
    const settings = this.settings;
    if (!settings || !settings.get('enableShutdown')) return;

    const trigger = settings.get('shutdownTrigger') || 'drops';
    if (trigger !== 'any' && trigger !== event) {
      console.log('[Выключение] Событие', event, 'не соответствует настройке', trigger);
      return;
    }

    const minutes = Number(settings.get('shutdownDelayMinutes'));
    const delayMinutes = Number.isFinite(minutes) && minutes >= 0 ? minutes : 5;

    this.arm(settings.get('shutdownAction') || 'shutdown', delayMinutes, reasonText);
  }

  arm(action, delayMinutes, reasonText) {
    if (this.armed) {
      console.log('[Выключение] Отсчёт уже идёт');
      return;
    }

    this.armed = true;

    // Ноль минут не означает «мгновенно»: полминуты на отмену остаётся всегда
    const totalSeconds = Math.max(30, Math.round(delayMinutes * 60));
    console.log('[Выключение] Отсчёт запущен:', action, totalSeconds, 'сек, причина:', reasonText);

    this._showOverlay(action, totalSeconds, reasonText);
  }

  cancel() {
    if (!this.armed) return;

    this.armed = false;
    clearTimeout(this.timer);
    clearInterval(this.tick);
    this.timer = null;
    this.tick = null;

    if (this.overlay?.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;

    console.log('[Выключение] Отменено пользователем');
    window.utils?.showToast('Выключение отменено', 'info');
  }

  _actionLabel(action) {
    const i18n = window.i18n;
    if (action === 'sleep') return i18n ? i18n.t('settings.sleep') : 'Спящий режим';
    if (action === 'hibernate') return i18n ? i18n.t('settings.hibernate') : 'Гибернация';
    return i18n ? i18n.t('settings.shutdownPC') : 'Выключение компьютера';
  }

  _format(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  _showOverlay(action, totalSeconds, reasonText) {
    let remaining = totalSeconds;

    const overlay = document.createElement('div');
    overlay.className = 'shutdown-overlay';
    overlay.innerHTML = `
      <div class="shutdown-dialog" role="alertdialog" aria-live="assertive">
        <div class="shutdown-title">${this._actionLabel(action)}</div>
        <div class="shutdown-reason">${reasonText}</div>
        <div class="shutdown-countdown" id="shutdown-countdown">${this._format(remaining)}</div>
        <button class="btn btn-primary" id="shutdown-cancel">Отменить</button>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;

    overlay.querySelector('#shutdown-cancel').addEventListener('click', () => this.cancel());

    const counter = overlay.querySelector('#shutdown-countdown');
    this.tick = setInterval(() => {
      remaining -= 1;
      if (counter) counter.textContent = this._format(Math.max(0, remaining));
    }, 1000);

    this.timer = setTimeout(() => {
      clearInterval(this.tick);
      this.tick = null;
      this.armed = false;
      console.log('[Выключение] Выполняю:', action);
      window.electronAPI?.shutdownComputer?.(action);
    }, totalSeconds * 1000);
  }
}

window.ShutdownManager = ShutdownManager;
window.shutdownManager = ShutdownManager.get();
