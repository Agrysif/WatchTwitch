/**
 * Auto-Update Manager v2 - Полная переделка логики обновлений
 * Встроенное красивое окно с прогресс баром в стиле приложения
 */

class UpdateManager {
  constructor() {
    this.checking = false;
    this.downloading = false;
    this.updateInfo = null;
    this.checkInterval = null;

    // Окно строится целиком из этих полей, а не латается по кусочку.
    // Раньше showWindow сбрасывала только часть полей, и после любой
    // ошибки кнопка навсегда оставалась «Попробовать ещё»: найденное
    // обновление нельзя было скачать до перезапуска приложения.
    this.downloaded = false;
    this.downloadedVersion = null;
    this.progressPercent = 0;

    // Ручная проверка — кнопка в настройках. Тостами отвечаем только на
    // неё: автопроверка идёт раз в полчаса, и «Проверяю обновления…» с
    // «Последней версией» сыпались круглые сутки.
    this.manualCheck = false;
    this.manualTimer = null;

    // Версия, отложенная кнопкой «Позже». Автопроверка раз в полчаса
    // снова находит её и раньше каждый раз открывала окно поверх
    // приложения. Помним только до перезапуска: другого напоминания об
    // обновлении нет, а одно окно при запуске не мешает.
    this.dismissedVersion = null;

    this.createOverlay();
    this.setupListeners();
    this.startAutoCheck();
  }

  /**
   * Значки статуса — из того же набора, что у тостов (app.js).
   * Символы ✓ и ✗ рисовались шрифтом и выбивались из остальных иконок.
   */
  static get statusIcons() {
    return {
      success: window.Icons?.get?.('check-circle', 16) || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
      error: window.Icons?.get?.('error', 16) || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>'
    };
  }

  /**
   * Сбой сети, а не обновления. Пользователю «net::ERR_NETWORK_CHANGED»
   * ничего не говорит — по этому признаку выбираем понятную фразу.
   */
  static isNetworkError(message) {
    return /net::ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION_\w+|NAME_NOT_RESOLVED|TIMED_OUT|ADDRESS_UNREACHABLE)|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/
      .test(String(message || ''));
  }

  /**
   * Окно обновления — на общих классах .dialog* и .btn, стили — в
   * styles/notifications.css. Раньше оно несло свою таблицу стилей
   * строкой: глиф Twitch на фиолетовой плашке, свои кнопки с «волной» и
   * свой .spinner, который перебивал общий во всём приложении.
   * id элементов прежние: по ним окно перерисовывается (render).
   */
  createOverlay() {
    const icon = (name, size) => window.Icons?.get?.(name, size) ?? '';
    const overlay = document.createElement('div');
    overlay.id = 'update-overlay';
    overlay.className = 'dialog-backdrop';
    // Подписи кнопок обязаны лежать в span: смена подписи ищет именно его
    // и не трогает значок рядом
    overlay.innerHTML = `
      <div class="dialog update-window" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <div class="dialog-head update-head">
          <img class="update-logo" src="../assets/logo.svg" alt="" width="40" height="40">
          <div class="update-titles">
            <div class="dialog-eyebrow is-success">${tr('Доступно обновление')}</div>
            <h2 class="dialog-title" id="update-dialog-title">WatchTwitch <span id="update-version-text" class="num"></span></h2>
            <div class="update-subtitle" id="update-subtitle"></div>
          </div>
          <button type="button" class="dialog-close" id="update-close-btn" title="${tr('Закрыть')}" aria-label="${tr('Закрыть')}">${icon('close', 16)}</button>
        </div>

        <div class="dialog-body">
          <div class="update-notes" id="update-notes" style="display: none;"></div>

          <div class="update-progress-section" id="progress-section" style="display: none;">
            <div class="update-progress-label">
              <span>${tr('Загрузка обновления')}</span>
              <span class="num" id="progress-percent">0%</span>
            </div>
            <div class="progress progress-lg" role="progressbar" aria-label="${tr('Загрузка обновления')}">
              <div class="progress-fill" id="update-progress-fill" style="width: 0%;"></div>
            </div>
          </div>

          <div class="update-status" id="update-status" role="status"></div>
        </div>

        <div class="dialog-foot update-actions">
          <button type="button" class="btn btn-secondary" id="update-later-btn">
            <span>${tr('Позже')}</span>
          </button>
          <button type="button" class="btn btn-primary" id="update-download-btn">
            ${icon('download', 16)}<span>${tr('Скачать обновление')}</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.window = overlay.querySelector('.update-window');

    overlay.querySelector('#update-later-btn').addEventListener('click', () => this.closeWindow());
    overlay.querySelector('#update-close-btn').addEventListener('click', () => this.closeWindow());
    // Обработчик «Скачать/Установить» назначает render: подпись и действие
    // кнопки меняются вместе
    overlay.querySelector('#update-download-btn').onclick = () => this.downloadUpdate();

    // Какая версия стоит сейчас — рядом с новой: так видно, насколько
    // обновление большое (1.0.25 → 1.0.26 или → 1.2.0)
    window.electronAPI?.getAppVersion?.().then((version) => {
      const subtitle = document.getElementById('update-subtitle');
      if (subtitle && version) subtitle.textContent = tr('Сейчас установлена {version}', { version });
    }).catch(() => {});

    // Закрытие по Escape и щелчку по фону. Без них оборвавшаяся загрузка
    // запирала окно поверх всего приложения: «Позже» было спрятано, а
    // другого способа убрать оверлей не было.
    // Щелчок считаем по фону, только если и нажали на фоне: иначе
    // выделение текста в заметках с отпусканием мыши снаружи закрывало окно.
    let pressedOnBackdrop = false;
    overlay.addEventListener('mousedown', (e) => {
      pressedOnBackdrop = e.target === overlay;
    });
    overlay.addEventListener('click', (e) => {
      if (pressedOnBackdrop && e.target === overlay) this.closeWindow();
      pressedOnBackdrop = false;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.isOpen()) return;
      // Окно «Что нового» и подтверждение лежат выше и закрываются своим
      // обработчиком — одно нажатие не должно убирать оба окна сразу
      if (document.getElementById('whats-new-overlay') || document.getElementById('confirmation-modal')) return;
      this.closeWindow();
    });
  }

  /**
   * Настраиваем IPC слушатели
   */
  setupListeners() {
    if (!window.electronAPI) {
      console.warn('[UpdateManager] electronAPI not available');
      return;
    }

    // Обновление доступно
    window.electronAPI.onUpdateAvailable?.((info) => {
      const manual = this.finishCheck();
      const version = info?.version || null;
      console.log('[UpdateManager] Update available:', version);
      this.updateInfo = info;

      // Скачанное раньше относится к другой версии — кнопка «Установить»
      // поставила бы не то, что написано в окне
      if (this.downloadedVersion && this.downloadedVersion !== version) {
        this.downloaded = false;
        this.downloadedVersion = null;
      }

      this.updateVersionText(version);
      this.showReleaseNotes(info?.releaseNotes);

      // Отложенную версию автопроверка больше не показывает. Ручная
      // проверка из настроек это обходит: другого пути к окну нет.
      // Скачанное обновление и так поставится при выходе из приложения
      // (autoInstallOnAppQuit в main.js).
      if (!manual && version && version === this.dismissedVersion) {
        console.log('[UpdateManager] Версия', version, 'отложена — окно не открываю');
        this.render();
        return;
      }

      this.showWindow();
    });

    // Прогресс загрузки
    window.electronAPI.onUpdateProgress?.((progress) => {
      this.downloading = true;
      this.progressPercent = Number(progress?.percent) || 0;
      this.render();
    });

    // Обновление загружено и готово к установке
    window.electronAPI.onUpdateDownloaded?.((data) => {
      console.log('[UpdateManager] Update downloaded, ready to install');
      this.downloading = false;
      this.downloaded = true;
      this.downloadedVersion = (data?.version && data.version !== 'unknown')
        ? data.version
        : (this.updateInfo?.version || null);
      this.render();

      // Окно могли закрыть во время загрузки — тогда без тоста
      // пользователь так и не узнал бы, что обновление готово
      if (!this.isOpen()) {
        window.utils?.showToast(tr('Обновление скачано — установится при выходе из приложения'), 'success');
      }
    });

    // Без этого нажатие «Проверить обновления» на свежей версии не давало
    // никакого отклика, и кнопка казалась неработающей
    window.electronAPI.onUpdateNotAvailable?.((info) => {
      if (!this.finishCheck()) return;
      // Версию не экранируем: showToast кладёт текст через textContent,
      // и экранированная строка вывелась бы с &amp; и &lt; как есть
      window.utils?.showToast(
        tr(info?.version ? 'Установлена последняя версия — {version}' : 'Установлена последняя версия',
          { version: info?.version }),
        'success'
      );
    });

    // Ошибка обновления
    window.electronAPI.onUpdateError?.((error) => {
      const message = String(error ?? '');
      const manual = this.finishCheck();
      const network = UpdateManager.isNetworkError(message);

      // Загрузка оборвалась: показываем ошибку в окне с повтором загрузки
      if (this.downloading) {
        console.error('[UpdateManager] Ошибка загрузки обновления:', message);
        this.showError(tr(network ? 'Нет связи с GitHub — проверьте интернет' : 'Не удалось скачать обновление'));
        if (!this.isOpen()) {
          window.utils?.showToast(
            tr(network ? 'Не удалось скачать обновление — нет связи с GitHub' : 'Не удалось скачать обновление'),
            'error'
          );
        }
        return;
      }

      // Ошибка проверки окно не трогает. Раньше она записывалась в
      // скрытое окно, и найденное позже обновление открывалось с кнопкой
      // «Попробовать ещё», которая только перепроверяла.
      if (manual) {
        console.error('[UpdateManager] Ошибка проверки обновлений:', message);
        window.utils?.showToast(
          tr(network ? 'Не удалось проверить обновления — нет связи с GitHub' : 'Не удалось проверить обновления'),
          'error'
        );
      } else {
        console.warn('[UpdateManager] Автопроверка обновлений не удалась:', message);
      }
    });
  }

  /**
   * Проверка закончилась: снимает признаки и говорит, была ли она ручной.
   * Ответ на ручную проверку получает тост, а следующие ответы
   * (автопроверки, проверка при запуске из main) — нет.
   */
  finishCheck() {
    this.checking = false;
    const manual = this.manualCheck;
    this.manualCheck = false;
    clearTimeout(this.manualTimer);
    return manual;
  }

  isOpen() {
    return this.overlay.classList.contains('show');
  }

  /**
   * Показать окно обновления
   */
  showWindow() {
    this.render();
    const wasOpen = this.isOpen();
    this.overlay.classList.add('show');
    // Фокус на главную кнопку: Enter сразу скачивает, Esc — «Позже»
    if (!wasOpen) {
      this.returnFocus = document.activeElement;
      setTimeout(() => document.getElementById('update-download-btn')?.focus({ preventScroll: true }), 0);
    }
  }

  /**
   * Закрыть окно обновления
   *
   * Любое закрытие — «Позже» для этой версии: автопроверка её больше
   * не откроет. Загрузка при этом идёт дальше, ей окно не нужно.
   */
  closeWindow() {
    const wasOpen = this.isOpen();
    this.overlay.classList.remove('show');
    if (this.updateInfo?.version) this.dismissedVersion = this.updateInfo.version;
    if (wasOpen && this.returnFocus?.isConnected) {
      try { this.returnFocus.focus({ preventScroll: true }); } catch (e) { /* элемент ушёл */ }
    }
    this.returnFocus = null;
  }

  /**
   * Перерисовывает окно из состояния: доступно / загружается / скачано.
   * Окно не открывает — только приводит его содержимое в порядок.
   * @param {string} [error] - текст ошибки загрузки, если она оборвалась
   */
  render(error = null) {
    const btn = document.getElementById('update-download-btn');
    const later = document.getElementById('update-later-btn');
    const status = document.getElementById('update-status');
    const progress = document.getElementById('progress-section');
    if (!btn || !later || !status || !progress) return;

    // Класс присваиваем целиком: раньше 'error' добавлялся и не снимался,
    // и «Обновление готово» после любой ошибки горело красным
    status.className = 'update-status';
    status.textContent = '';

    btn.disabled = false;
    // Пустое значение, а не 'block': кнопка — inline-flex, и block
    // ломал выравнивание подписи
    later.style.display = '';
    this.setButtonLabel(later, tr('Позже'));

    // Надзаголовок говорит, на каком шаге обновление: найдено или уже
    // скачано и ждёт перезапуска
    const eyebrow = this.overlay?.querySelector('.dialog-eyebrow');
    if (eyebrow) eyebrow.textContent = tr(this.downloaded ? 'Обновление скачано' : 'Доступно обновление');
    // Значок кнопки — по действию: скачать или перезапустить
    const iconSvg = window.Icons?.get?.(this.downloaded ? 'refresh' : 'download', 16);
    const oldIcon = btn.querySelector('svg');
    if (iconSvg && oldIcon && oldIcon.dataset.icon !== (this.downloaded ? 'refresh' : 'download')) {
      oldIcon.outerHTML = iconSvg.replace('<svg', '<svg data-icon="' + (this.downloaded ? 'refresh' : 'download') + '"');
    }

    if (this.downloaded) {
      progress.style.display = 'none';
      this.setStatus(status, 'success', tr('Обновление готово к установке'));
      this.setButtonLabel(btn, tr('Установить и перезагрузить'));
      btn.onclick = () => this.installUpdate();
      return;
    }

    if (this.downloading) {
      progress.style.display = 'block';
      const percent = Math.max(0, Math.min(100, this.progressPercent));
      document.getElementById('update-progress-fill').style.width = percent + '%';
      document.getElementById('progress-percent').textContent = Math.round(percent) + '%';

      btn.disabled = true;
      this.setButtonLabel(btn, tr('Загрузка…'));
      btn.onclick = () => this.downloadUpdate();
      // Загрузка идёт в main, окно ей не нужно — его можно убрать
      this.setButtonLabel(later, tr('Скрыть'));
      return;
    }

    progress.style.display = 'none';
    if (error) this.setStatus(status, 'error', error);
    this.setButtonLabel(btn, tr(error ? 'Попробовать ещё' : 'Скачать обновление'));
    btn.onclick = () => this.downloadUpdate();
  }

  /** Строка статуса со значком; текст вставляем только как текст. */
  setStatus(status, type, text) {
    status.className = 'update-status ' + type;
    status.innerHTML = UpdateManager.statusIcons[type] || '';
    const label = document.createElement('span');
    label.textContent = text;
    status.appendChild(label);
  }

  /**
   * Показывает список изменений из описания релиза.
   *
   * Описание пишется на двух языках, разделённых заголовками с флагами.
   * Выбираем секцию под текущий язык интерфейса, а не показываем обе:
   * иначе окно превращается в простыню.
   */
  showReleaseNotes(notes) {
    const box = document.getElementById('update-notes');
    if (!box) return;

    const raw = typeof notes === 'string'
      ? notes
      : Array.isArray(notes)
        ? notes.map(n => (typeof n === 'string' ? n : n?.note || '')).join('\n')
        : '';

    if (!raw.trim()) {
      box.style.display = 'none';
      return;
    }

    // Язык интерфейса выбран при запуске (js/core/tr.js)
    const isRussian = (window.tr?.lang?.() || window.i18n?.currentLang || 'ru') !== 'en';
    const sections = raw.split(/^##\s+/m).filter(Boolean);

    let chosen = sections.find(part => isRussian
      ? /^\s*(🇷🇺|Что нового)/i.test(part)
      : /^\s*(🇬🇧|What)/i.test(part));

    if (!chosen) chosen = sections[0] || raw;

    const lines = chosen.split('\n').map(l => l.trim()).filter(Boolean);
    // Флаг в заголовке нужен только для выбора языка выше. Windows флаги
    // не рисует и выводит вместо них буквы «RU»
    const title = (lines.shift() || '').replace(/^(?:[\u{1F1E6}-\u{1F1FF}]{2})\s*/u, '');
    const items = lines
      .filter(l => l.startsWith('-') || l.startsWith('*'))
      .map(l => l.replace(/^[-*]\s*/, ''));

    // Разметку собираем сами: описание релиза — внешний текст,
    // вставлять его как HTML нельзя
    const escape = (text) => text.replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

    // Пункты — через formatInline окна «Что нового»: оно сначала
    // экранирует, потом превращает **…** в жирный. Без этого первое,
    // что видел пользователь в окне обновления, — звёздочки разметки
    const formatItem = window.whatsNew?.formatInline
      ? (text) => window.whatsNew.formatInline(text)
      : escape;

    box.innerHTML = (title ? '<div class="update-notes-title">' + escape(title) + '</div>' : '') +
      (items.length ? '<ul>' + items.map(i => '<li>' + formatItem(i) + '</li>').join('') + '</ul>' : '');
    box.style.display = 'block';
  }

  /**
   * Обновить текст версии
   */
  updateVersionText(version) {
    // Номер — в заголовке рядом с названием: «WatchTwitch 1.0.26»
    const el = document.getElementById('update-version-text');
    if (el) el.textContent = version || '';
  }

  /**
   * Меняет подпись кнопки, не трогая значок.
   *
   * Через btn.textContent значок пропадал: он лежит отдельным элементом
   * внутри кнопки и стирался вместе с прежней подписью.
   */
  setButtonLabel(btn, text) {
    if (!btn) return;
    const label = btn.querySelector('span');
    if (label) label.textContent = text;
    else btn.textContent = text;
  }

  /**
   * Показать ошибку загрузки
   */
  showError(text) {
    this.downloading = false;
    this.render(text);
  }

  /**
   * Проверить обновления
   * @param {object} [options]
   * @param {boolean} [options.manual] - нажата кнопка: отвечать тостами
   */
  checkForUpdates({ manual = false } = {}) {
    if (manual) {
      // Обновление уже скачивается — показываем окно с ходом загрузки
      if (this.downloading) {
        this.showWindow();
        return;
      }

      // Отклик сразу: проверка идёт по сети и может занять пару секунд,
      // а до ответа кнопка выглядела бы мёртвой. Если автопроверка уже
      // идёт, её ответ и будет ответом на нажатие.
      this.manualCheck = true;
      clearTimeout(this.manualTimer);
      // Ответ может не прийти совсем (в режиме разработки проверка
      // пропускается) — тогда признак не должен достаться следующей
      // автопроверке
      this.manualTimer = setTimeout(() => { this.manualCheck = false; }, 2 * 60 * 1000);
      window.utils?.showToast(tr('Проверяю обновления…'), 'info');
    }

    if (this.checking || this.downloading) return;

    this.checking = true;
    console.log('[UpdateManager] Проверяю обновления…');

    if (window.electronAPI?.checkForUpdates) {
      window.electronAPI.checkForUpdates();
    }

    setTimeout(() => {
      this.checking = false;
    }, 5000);
  }

  /**
   * Загрузить обновление
   */
  downloadUpdate() {
    if (this.downloading || !window.electronAPI?.downloadUpdate) return;

    console.log('[UpdateManager] Starting download...');

    // Отклик сразу, а не на первом download-progress: при разностной
    // загрузке ему предшествует скачивание blockmap, и секунду-две
    // кнопка выглядела ненажатой
    this.downloading = true;
    this.progressPercent = 0;
    this.render();

    window.electronAPI.downloadUpdate();
  }

  /**
   * Установить обновление
   */
  installUpdate() {
    console.log('[UpdateManager] Installing update...');

    if (window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate();
    }
  }

  /**
   * Автоматическая проверка каждые 30 минут — молча: тосты только на
   * ручную проверку, окно — только если нашлась неотложенная версия
   */
  startAutoCheck() {
    // Первая проверка через 3 секунды после запуска
    setTimeout(() => {
      this.checkForUpdates();
    }, 3000);

    // Затем проверяем каждые 30 минут
    this.checkInterval = setInterval(() => {
      if (!this.checking && !this.downloading) {
        this.checkForUpdates();
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  /**
   * Остановить автоматическую проверку
   */
  stopAutoCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// Создаём глобальный экземпляр
const updateManager = new UpdateManager();

// Явно на window: кнопка «Проверить обновления» в настройках должна идти
// через updateManager.checkForUpdates({ manual: true }), иначе ответ на
// неё не отличить от автопроверки и он останется без тоста
window.updateManager = updateManager;

// Очищаем при закрытии окна
window.addEventListener('beforeunload', () => {
  updateManager.stopAutoCheck();
});
