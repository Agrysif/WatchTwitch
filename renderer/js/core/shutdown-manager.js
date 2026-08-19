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
 *   shutdownTrigger       — drops | streamEnd | any (по какому событию срабатывать)
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
