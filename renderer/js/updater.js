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
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
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
   * Создаём красивое overlay окно для обновлений
   */
  createOverlay() {
    const style = document.createElement('style');
    // Цвета текста и фона — из переменных темы: с зашитыми тёмными
    // значениями окно оставалось чёрным в светлой теме
    style.textContent = `
      #update-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(4px);
        animation: fadeIn 0.3s ease-out;
      }

      #update-overlay.show {
        display: flex;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .update-window {
        background: var(--bg-secondary);
        border-radius: var(--radius-md);
        padding: 32px;
        width: 90%;
        max-width: 500px;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.8);
        animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        border: 1px solid rgba(124, 92, 255, 0.2);
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(40px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .update-logo {
        width: 80px;
        height: 80px;
        background: #7c5cff;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 24px;
        box-shadow: none;
      }

      .update-logo svg {
        width: 48px;
        height: 48px;
        fill: white;
      }

      .update-title {
        font-size: 24px;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: 8px;
        text-align: center;
      }

      .update-subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        text-align: center;
        margin-bottom: 24px;
      }

      .update-notes {
        max-height: 190px;
        overflow-y: auto;
        text-align: left;
        margin-bottom: 20px;
        padding: 12px 14px;
        background: var(--hover-bg);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--text-secondary);
      }

      .update-notes-title {
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 6px;
      }

      .update-notes strong {
        font-weight: 600;
        color: var(--text-primary);
      }

      .update-notes ul {
        margin: 0;
        padding-left: 18px;
      }

      .update-notes li {
        margin-bottom: 3px;
      }

      .update-version {
        font-size: 13px;
        color: #7c5cff;
        text-align: center;
        margin-bottom: 24px;
        padding: 8px 12px;
        background: rgba(124, 92, 255, 0.1);
        border-radius: var(--radius-md);
        display: inline-block;
        width: 100%;
      }

      .update-progress-section {
        margin-bottom: 24px;
      }

      .update-progress-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        font-size: 13px;
        color: var(--text-secondary);
      }

      .update-progress-bar {
        width: 100%;
        height: 6px;
        background: rgba(124, 92, 255, 0.1);
        border-radius: var(--radius-sm);
        overflow: hidden;
        position: relative;
      }

      .update-progress-fill {
        height: 100%;
        background: #7c5cff;
        border-radius: var(--radius-sm);
        width: 0%;
        transition: width 0.3s ease-out;
        box-shadow: none;
      }

      .update-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
      }

      .update-btn {
        padding: 12px 24px;
        border-radius: var(--radius-md);
        border: none;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        flex: 1;
      }

      .update-btn-primary {
        background: #7c5cff;
        color: white;
        box-shadow: none;
      }

      .update-btn-primary:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: none;
      }

      .update-btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .update-btn-secondary {
        background: rgba(124, 92, 255, 0.1);
        color: #7c5cff;
        border: 1px solid rgba(124, 92, 255, 0.3);
      }

      .update-btn-secondary:hover:not(:disabled) {
        background: rgba(124, 92, 255, 0.2);
        border-color: rgba(124, 92, 255, 0.5);
      }

      .update-status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        text-align: center;
        font-size: 13px;
        color: var(--text-secondary);
        margin-bottom: 16px;
      }

      .update-status svg {
        flex-shrink: 0;
      }

      .update-status.success {
        color: var(--success-color);
      }

      .update-status.error {
        color: var(--error-color);
      }

      .spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(124, 92, 255, 0.3);
        border-top-color: #7c5cff;
        border-radius: var(--radius-circle);
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'update-overlay';
    overlay.innerHTML = `
      <div class="update-window">
        <div class="update-logo">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
          </svg>
        </div>

        <div class="update-title">Доступно обновление</div>
        <div class="update-subtitle" id="update-subtitle">Новая версия приложения</div>
        <div class="update-version" id="update-version-text">Загрузка информации...</div>

        <div class="update-notes" id="update-notes" style="display: none;"></div>

        <div class="update-progress-section" id="progress-section" style="display: none;">
          <div class="update-progress-label">
            <span>Загрузка обновления</span>
            <span id="progress-percent">0%</span>
          </div>
          <div class="update-progress-bar">
            <div class="update-progress-fill" id="update-progress-fill"></div>
          </div>
        </div>

        <div class="update-status" id="update-status"></div>

        <div class="update-actions">
          <button class="update-btn update-btn-secondary" id="update-later-btn" onclick="updateManager.closeWindow()">
            <span>Позже</span>
          </button>
          <!-- Подпись обязана лежать в span: смена подписи ищет именно его,
               а правила переноса привязаны к нему же. Без span длинное
               «Установить и перезагрузить» вылезало за края кнопки. -->
          <button class="update-btn update-btn-primary" id="update-download-btn" onclick="updateManager.downloadUpdate()">
            <span>Скачать обновление</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.window = overlay.querySelector('.update-window');

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
      // Окно «Что нового» лежит выше и закрывается своим обработчиком —
      // одно нажатие не должно убирать оба окна сразу
      if (document.getElementById('whats-new-overlay')) return;
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
        window.utils?.showToast('Обновление скачано — установится при выходе из приложения', 'success');
      }
    });

    // Без этого нажатие «Проверить обновления» на свежей версии не давало
    // никакого отклика, и кнопка казалась неработающей
    window.electronAPI.onUpdateNotAvailable?.((info) => {
      if (!this.finishCheck()) return;
      // Версию не экранируем: showToast кладёт текст через textContent,
      // и экранированная строка вывелась бы с &amp; и &lt; как есть
      window.utils?.showToast(
        'Установлена последняя версия' + (info?.version ? ' — ' + info.version : ''),
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
        this.showError(network ? 'Нет связи с GitHub — проверьте интернет' : 'Не удалось скачать обновление');
        if (!this.isOpen()) {
          window.utils?.showToast(
            network ? 'Не удалось скачать обновление — нет связи с GitHub' : 'Не удалось скачать обновление',
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
          network ? 'Не удалось проверить обновления — нет связи с GitHub' : 'Не удалось проверить обновления',
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
    this.overlay.classList.add('show');
  }

  /**
   * Закрыть окно обновления
   *
   * Любое закрытие — «Позже» для этой версии: автопроверка её больше
   * не откроет. Загрузка при этом идёт дальше, ей окно не нужно.
   */
  closeWindow() {
    this.overlay.classList.remove('show');
    if (this.updateInfo?.version) this.dismissedVersion = this.updateInfo.version;
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
    later.style.display = 'block';
    this.setButtonLabel(later, 'Позже');

    if (this.downloaded) {
      progress.style.display = 'none';
      this.setStatus(status, 'success', 'Обновление готово');
      this.setButtonLabel(btn, 'Установить и перезагрузить');
      btn.onclick = () => this.installUpdate();
      return;
    }

    if (this.downloading) {
      progress.style.display = 'block';
      const percent = Math.max(0, Math.min(100, this.progressPercent));
      document.getElementById('update-progress-fill').style.width = percent + '%';
      document.getElementById('progress-percent').textContent = Math.round(percent) + '%';

      btn.disabled = true;
      this.setButtonLabel(btn, 'Загрузка…');
      btn.onclick = () => this.downloadUpdate();
      // Загрузка идёт в main, окно ей не нужно — его можно убрать
      this.setButtonLabel(later, 'Скрыть');
      return;
    }

    progress.style.display = 'none';
    if (error) this.setStatus(status, 'error', error);
    this.setButtonLabel(btn, error ? 'Попробовать ещё' : 'Скачать обновление');
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

    const isRussian = (window.i18n?.currentLang || 'ru') === 'ru';
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
    document.getElementById('update-version-text').textContent = `Версия ${version || ''}`;
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
      window.utils?.showToast('Проверяю обновления…', 'info');
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
