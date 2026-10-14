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
   *
   * startedAt — когда началась сессия. При восстановлении после
   * перезапуска приложения таймер заводится на остаток, а не на полный
   * срок заново. Если срок уже вышел, пока приложение не работало, не
   * заводим: выключать компьютер сразу после запуска — слишком внезапно.
   */
  startSessionTimer(startedAt = Date.now()) {
    this.cancelSessionTimer();

    const settings = this.settings;
    if (!settings || !settings.get('enableShutdown')) return;
    if ((settings.get('shutdownTrigger') || 'drops') !== 'timer') return;

    const hours = Number(settings.get('shutdownTimerHours'));
    if (!Number.isFinite(hours) || hours <= 0) return;

    const start = Number(startedAt) || Date.now();
    const elapsed = Math.max(0, Date.now() - start);
    const ms = hours * 60 * 60 * 1000 - elapsed;
    if (ms <= 0) {
      console.log('[Выключение] Срок таймера сессии вышел, пока приложение не работало — не завожу');
      return;
    }
    console.log('[Выключение] Таймер сессии на', hours, 'ч',
      elapsed > 60 * 1000 ? `(осталось ${Math.round(ms / 60000)} мин)` : '');

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
    this._announce(action, totalSeconds);
  }

  /**
   * Отсчёт должен быть виден, даже когда окно спрятано в трей.
   *
   * Раньше оверлей появлялся только внутри окна: если оно было свёрнуто в
   * трей, а пользователь играл или работал, компьютер выключался без
   * всякого предупреждения — обещание «отсчёт можно прервать» ничего не
   * стоило. Теперь окно выводится на глаза (main мигает кнопкой на панели
   * задач, если Windows не отдаёт фокус), а системное уведомление говорит,
   * что будет и как отменить.
   *
   * Уведомление идёт мимо тихих часов: выключение компьютера — не новость,
   * о которой можно не сказать.
   */
  _announce(action, totalSeconds) {
    try {
      const shown = window.electronAPI?.showMainWindow?.();
      if (shown && typeof shown.catch === 'function') shown.catch(() => {});
    } catch (error) {
      // окно не показалось — остаётся уведомление
    }

    const when = totalSeconds < 60
      ? `${totalSeconds} с`
      : `${Math.round(totalSeconds / 60)} мин`;

    try {
      window.electronAPI?.showNotification?.(
        this._countdownTitle(action).replace(/ через$/, ''),
        `${this._countdownTitle(action)} ${when} — откройте WatchTwitch, чтобы отменить`
      );
    } catch (error) {
      // без уведомления отсчёт всё равно идёт в окне
    }
  }

  /** Заголовок отсчёта: что произойдёт, без времени. */
  _countdownTitle(action) {
    if (action === 'sleep') return 'Компьютер уйдёт в сон через';
    if (action === 'hibernate') return 'Компьютер уйдёт в гибернацию через';
    return 'Компьютер выключится через';
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
    // Заголовок читается вместе с отсчётом: «Компьютер выключится через
    // 04:59». Прежнее «Выключение компьютера» над голыми цифрами не
    // говорило, что это обратный отсчёт и что он закончится выключением.
    overlay.innerHTML = `
      <div class="shutdown-dialog" role="alertdialog" aria-live="assertive">
        <div class="shutdown-title"></div>
        <div class="shutdown-countdown" id="shutdown-countdown">${this._format(remaining)}</div>
        <div class="shutdown-reason"></div>
        <button class="btn btn-primary" id="shutdown-cancel" style="margin-top: 18px;">Отменить</button>
      </div>
    `;
    // Тексты — только как текст: причина собирается из названий категорий
    overlay.querySelector('.shutdown-title').textContent = this._countdownTitle(action);
    overlay.querySelector('.shutdown-reason').textContent = reasonText || '';

    document.body.appendChild(overlay);
    this.overlay = overlay;

    const cancelBtn = overlay.querySelector('#shutdown-cancel');
    cancelBtn.addEventListener('click', () => this.cancel());
    // Окно вывели на глаза — отменить можно сразу клавишей Enter или пробелом
    try { cancelBtn.focus(); } catch (error) { /* без фокуса кнопка работает мышью */ }

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
