// Settings Page with i18n support
class SettingsPage {
  constructor() {
    // Обработчики на document не исчезают вместе со страницей —
    // снимаем их разом в destroy()
    this._abort = new AbortController();
    this.init();
  }

  destroy() {
    // Контроллер не обнуляем: render() асинхронный, и setupEventListeners
    // может отработать уже после уничтожения страницы — отменённый сигнал
    // не даст обработчикам закрепиться на document.
    if (this._abort) {
      this._abort.abort();
    }
  }

  async init() {
    await this.render();
    this.setupEventListeners();
    this.loadAppVersion();
  }

  async render() {
    const container = document.getElementById('page-container');
    if (!container) return;

    const settings = window.settings;
    if (!settings) {
      console.error('Settings manager not initialized');
      return;
    }

    const i18n = window.i18n;
    const currentLang = i18n?.currentLang || 'ru';

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 10px; vertical-align: -5px; color: var(--accent-color);">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
          ${i18n.t('settings.title')}
        </h1>
        <p class="page-subtitle">${i18n.t('settings.subtitle')}</p>
      </div>

      <div class="settings-container">
        <!-- Уведомления -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #FFB020;">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
            </svg>
            ${i18n.t('settings.notifications')}
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.soundNotifications')}</div>
              <div class="settings-item-description">${i18n.t('settings.soundNotificationsDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-sound" ${settings.get('soundEnabled') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.toastNotifications')}</div>
              <div class="settings-item-description">${i18n.t('settings.toastNotificationsDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-toast" ${settings.get('toastNotifications') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.minimizeToTray')}</div>
              <div class="settings-item-description">${i18n.t('settings.minimizeToTrayDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-minimize-tray" ${settings.get('minimizeToTray') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>
        </div>

        <!-- Автоматизация -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #35d08a;">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
            </svg>
            ${i18n.t('settings.automation')}
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.autoClaimDrops')}</div>
              <div class="settings-item-description">${i18n.t('settings.autoClaimDropsDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-auto-claim" ${settings.get('autoClaimDrops') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.lowGraphics')}</div>
              <div class="settings-item-description">${i18n.t('settings.lowGraphicsDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-low-graphics" ${settings.get('lowGraphics') !== false ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Фоновый чат Twitch</div>
              <div class="settings-item-description">Выключено: сундуки собираются запросом к Twitch без чата — около 190 МБ памяти и заметно меньше процессора. Включите, если сундуки перестали собираться</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-background-chat" ${settings.get('backgroundChat') === true ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.limitStreamSpeed')}</div>
              <div class="settings-item-description">${i18n.t('settings.limitStreamSpeedDesc')}</div>
              <div class="quiet-note" id="limit-note" style="margin-top: 8px;"></div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-limit-speed" ${settings.get('limitStreamSpeed') !== false ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.quietHours')}</div>
              <div class="settings-item-description">${i18n.t('settings.quietHoursDesc')}</div>
              <div class="quiet-range">
                <input type="time" id="setting-quiet-from" value="${settings.get('quietFrom') || '23:00'}">
                <span>—</span>
                <input type="time" id="setting-quiet-to" value="${settings.get('quietTo') || '09:00'}">
                <span class="quiet-note" id="quiet-note"></span>
              </div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-quiet" ${settings.get('quietHours') !== false ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.suggestCategories')}</div>
              <div class="settings-item-description">${i18n.t('settings.suggestCategoriesDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-suggest" ${settings.get('suggestCategories') !== false ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.globalShortcuts')}</div>
              <div class="settings-item-description">${i18n.t('settings.globalShortcutsDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-shortcuts" ${settings.get('globalShortcuts') !== false ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.notifyFavouriteLive')}</div>
              <div class="settings-item-description">${i18n.t('settings.notifyFavouriteLiveDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-favourite-live" ${settings.get('notifyFavouriteLive') !== false ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.smartCategorySwitch')}</div>
              <div class="settings-item-description">${i18n.t('settings.smartCategorySwitchDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-smart-switch" ${settings.get('smartCategorySwitch') !== false ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.notifyOnDropClaimed')}</div>
              <div class="settings-item-description">${i18n.t('settings.notifyOnDropClaimedDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-notify-drop" ${settings.get('notifyOnDropClaimed') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.autoSwitchStreams')}</div>
              <div class="settings-item-description">${i18n.t('settings.autoSwitchStreamsDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-auto-switch" ${settings.get('autoSwitchStreams') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.autostart')}</div>
              <div class="settings-item-description">${i18n.t('settings.autostartDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-autostart" ${settings.get('autostart') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.streamQuality')}</div>
              <div class="settings-item-description">${i18n.t('settings.streamQualityDesc')}</div>
            </div>
            <select class="input-field" id="setting-quality" style="width: 190px; flex-shrink: 0;">
              <option value="160p30" ${settings.get('preferredStreamQuality') === '160p30' ? 'selected' : ''}>${i18n.t('settings.lowest')} (160p)</option>
              <option value="360p30" ${settings.get('preferredStreamQuality') === '360p30' ? 'selected' : ''}>360p</option>
              <option value="480p30" ${settings.get('preferredStreamQuality') === '480p30' ? 'selected' : ''}>480p</option>
            </select>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.enableShutdown')}</div>
              <div class="settings-item-description">${i18n.t('settings.enableShutdownDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-shutdown" ${settings.get('enableShutdown') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item shutdown-option" style="${settings.get('enableShutdown') ? '' : 'display: none;'}">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.shutdownAction')}</div>
              <div class="settings-item-description">${i18n.t('settings.shutdownActionDesc')}</div>
            </div>
            <select class="input-field" id="setting-shutdown-action" style="width: 190px; flex-shrink: 0;">
              <option value="shutdown" ${settings.get('shutdownAction') === 'shutdown' ? 'selected' : ''}>${i18n.t('settings.shutdownPC')}</option>
              <option value="sleep" ${settings.get('shutdownAction') === 'sleep' ? 'selected' : ''}>${i18n.t('settings.sleep')}</option>
              <option value="hibernate" ${settings.get('shutdownAction') === 'hibernate' ? 'selected' : ''}>${i18n.t('settings.hibernate')}</option>
            </select>
          </div>

          <div class="settings-item shutdown-option" style="${settings.get('enableShutdown') ? '' : 'display: none;'}">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.shutdownTrigger')}</div>
              <div class="settings-item-description">${i18n.t('settings.shutdownTriggerDesc')}</div>
            </div>
            <select class="input-field" id="setting-shutdown-trigger" style="width: 190px; flex-shrink: 0;">
              <option value="drops" ${settings.get('shutdownTrigger') === 'drops' ? 'selected' : ''}>${i18n.t('settings.triggerDrops')}</option>
              <option value="streamEnd" ${settings.get('shutdownTrigger') === 'streamEnd' ? 'selected' : ''}>${i18n.t('settings.triggerStreamEnd')}</option>
              <option value="any" ${settings.get('shutdownTrigger') === 'any' ? 'selected' : ''}>${i18n.t('settings.triggerAny')}</option>
              <option value="timer" ${settings.get('shutdownTrigger') === 'timer' ? 'selected' : ''}>${i18n.t('settings.triggerTimer')}</option>
            </select>
          </div>

          <div class="settings-item shutdown-option" style="${settings.get('enableShutdown') ? '' : 'display: none;'}">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.shutdownTimer')}</div>
              <div class="settings-item-description">${i18n.t('settings.shutdownTimerDesc')}</div>
            </div>
            <select class="input-field" id="setting-shutdown-timer" style="width: 190px; flex-shrink: 0;">
              ${[1, 2, 3, 4, 6, 8, 12].map(h => `
                <option value="${h}" ${String(settings.get('shutdownTimerHours')) === String(h) ? 'selected' : ''}>${h} ${i18n.t('settings.hoursShort')}</option>
              `).join('')}
            </select>
          </div>

          <div class="settings-item shutdown-option" style="${settings.get('enableShutdown') ? '' : 'display: none;'}">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.shutdownDelay')}</div>
              <div class="settings-item-description">${i18n.t('settings.shutdownDelayDesc')}</div>
            </div>
            <select class="input-field" id="setting-shutdown-delay" style="width: 190px; flex-shrink: 0;">
              <option value="0" ${String(settings.get('shutdownDelayMinutes')) === '0' ? 'selected' : ''}>${i18n.t('settings.delayNow')}</option>
              <option value="5" ${String(settings.get('shutdownDelayMinutes')) === '5' ? 'selected' : ''}>5 ${i18n.t('farming.min')}</option>
              <option value="15" ${String(settings.get('shutdownDelayMinutes')) === '15' ? 'selected' : ''}>15 ${i18n.t('farming.min')}</option>
              <option value="30" ${String(settings.get('shutdownDelayMinutes')) === '30' ? 'selected' : ''}>30 ${i18n.t('farming.min')}</option>
              <option value="60" ${String(settings.get('shutdownDelayMinutes')) === '60' ? 'selected' : ''}>60 ${i18n.t('farming.min')}</option>
            </select>
          </div>

          <div class="shutdown-summary shutdown-option" id="shutdown-summary"
               style="${settings.get('enableShutdown') ? '' : 'display: none;'}">
            ${window.shutdownManager ? window.shutdownManager.describeSchedule() : ''}
          </div>
        </div>

        <!-- Отображение -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #A855F7;">
              <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            </svg>
            ${i18n.t('settings.display')}
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.compactMode')}</div>
              <div class="settings-item-description">${i18n.t('settings.compactModeDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-compact" ${settings.get('compactMode') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.showExpiredCampaigns')}</div>
              <div class="settings-item-description">${i18n.t('settings.showExpiredCampaignsDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-show-expired" ${settings.get('showExpiredCampaigns') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.animations')}</div>
              <div class="settings-item-description">${i18n.t('settings.animationsDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-animations" ${settings.get('animationsEnabled') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.developerMode')}</div>
              <div class="settings-item-description">${i18n.t('settings.developerModeDesc')}</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-developer-mode" ${settings.get('developerMode') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.languageSelect')}</div>
              <div class="settings-item-description">${i18n.t('settings.languageSelectDesc')}</div>
            </div>
            <div class="custom-select" id="language-select">
              <div class="custom-select-trigger">
                <span class="custom-select-value">${currentLang === 'ru' ? 'Русский' : 'English'}</span>
                <svg class="custom-select-arrow" width="14" height="8" viewBox="0 0 14 8" fill="none">
                  <path d="M1 1L7 7L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div class="custom-select-options">
                <div class="custom-select-option ${currentLang === 'ru' ? 'selected' : ''}" data-value="ru">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M3 9h18"/>
                    <path d="M3 15h18"/>
                  </svg>
                  <span>Русский</span>
                  <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div class="custom-select-option ${currentLang === 'en' ? 'selected' : ''}" data-value="en">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 3h18v18H3z"/>
                    <path d="M3 3l18 18M21 3L3 21"/>
                  </svg>
                  <span>English</span>
                  <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.themeSelect')}</div>
              <div class="settings-item-description">${i18n.t('settings.themeSelectDesc')}</div>
            </div>
            <div class="custom-select" id="theme-select">
              <div class="custom-select-trigger">
                <span class="custom-select-value">${settings.get('theme') === 'dark' ? i18n.t('settings.dark') : i18n.t('settings.light')}</span>
                <svg class="custom-select-arrow" width="14" height="8" viewBox="0 0 14 8" fill="none">
                  <path d="M1 1L7 7L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div class="custom-select-options">
                <div class="custom-select-option ${settings.get('theme') === 'dark' ? 'selected' : ''}" data-value="dark">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                  <span>${i18n.t('settings.dark')}</span>
                  <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div class="custom-select-option ${settings.get('theme') === 'light' ? 'selected' : ''}" data-value="light">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                  <span>${i18n.t('settings.light')}</span>
                  <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Диагностика -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #22C55E;">
              <path d="M3 3h18v4H3V3zm0 7h10v4H3v-4zm0 7h18v4H3v-4zm12-7h6v4h-6v-4z"/>
            </svg>
            Диагностика
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Процессы</div>
              <div class="settings-item-description">Показывает, что именно грузит память и CPU</div>
            </div>
            <button class="btn btn-secondary" id="refresh-processes-btn">Обновить</button>
          </div>

          <div id="processes-list" style="display: grid; gap: 8px;"></div>
        </div>

        <!-- Действия -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #3B82F6;">
              <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
            </svg>
            ${i18n.t('settings.actions')}
          </h2>
          
          <div class="settings-actions">
            <button class="btn btn-secondary" id="reset-settings-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
              ${i18n.t('settings.resetSettings')}
            </button>
            
            <button class="btn btn-secondary" id="whats-new-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              ${i18n.t('settings.whatsNew')}
            </button>

            <button class="btn btn-secondary" id="clear-statistics-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"></path>
                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              </svg>
              ${i18n.t('settings.clearStatistics')}
            </button>

            <button class="btn btn-secondary" id="export-settings-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              ${i18n.t('settings.exportSettings')}
            </button>

            <button class="btn btn-secondary" id="backup-export-btn" style="margin-left: 8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <path d="M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Сохранить копию всего
            </button>

            <button class="btn btn-secondary" id="backup-import-btn" style="margin-left: 8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <path d="M7 9l5-5 5 5M12 4v12"/>
              </svg>
              Восстановить из копии
            </button>
            <input type="file" id="backup-file-input" accept="application/json,.json" style="display: none;">

            <button class="btn btn-secondary" id="open-logs-btn" style="margin-left: 8px;" title="Журнал работы приложения — пригодится, если что-то пошло не так ночью">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6M8 13h8M8 17h8"/>
              </svg>
              Папка логов
            </button>

            <div class="settings-item-description" style="width: 100%; margin-top: 10px;">
              В копию попадают категории с порядком и закреплениями, подписки, статистика и настройки.
              Аккаунты и токены не сохраняются — после переноса нужно войти заново.
            </div>
          </div>
        </div>

        <!-- Обновления -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #f0555f;">
              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
            </svg>
            ${i18n.t('settings.updates')}
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.appVersion')}</div>
              <div class="settings-item-description" id="setting-app-version">—</div>
            </div>
            <button class="btn btn-secondary" id="check-updates-btn">
              ${i18n.t('settings.checkUpdates')}
            </button>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.github')}</div>
              <div class="settings-item-description">${i18n.t('settings.githubDesc')}</div>
            </div>
            <button class="btn btn-secondary" id="github-link-btn" style="display: flex; align-items: center; gap: 6px;">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              ${i18n.t('settings.open')}
            </button>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.telegram')}</div>
              <div class="settings-item-description">${i18n.t('settings.telegramDesc')}</div>
            </div>
            <button class="btn btn-secondary" id="telegram-link-btn" style="display: flex; align-items: center; gap: 6px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.693-1.653-1.124-2.678-1.8-1.185-.781-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.14.121.099.155.232.171.326.016.095.036.312.02.482z"/>
              </svg>
              ${i18n.t('settings.open')}
            </button>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${i18n.t('settings.supportProject')}</div>
              <div class="settings-item-description">${i18n.t('settings.supportProjectDesc')}</div>
            </div>
            <button class="btn btn-secondary" id="boosty-link-btn" style="display: flex; align-items: center; gap: 6px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.31-8.86c-1.77-.45-2.34-.94-2.34-1.67 0-.84.79-1.43 2.1-1.43 1.38 0 1.9.66 1.94 1.64h1.71c-.05-1.34-.87-2.57-2.49-2.97V5H10.9v1.69c-1.51.32-2.72 1.3-2.72 2.81 0 1.79 1.49 2.69 3.66 3.21 1.95.46 2.34 1.15 2.34 1.87 0 .53-.39 1.39-2.1 1.39-1.6 0-2.23-.72-2.32-1.64H8.04c.1 1.7 1.36 2.66 2.86 2.97V19h2.34v-1.67c1.52-.29 2.72-1.16 2.73-2.77-.01-2.2-1.9-2.96-3.66-3.42z"/>
              </svg>
              ${i18n.t('settings.open')}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const settings = window.settings;
    const i18n = window.i18n;

    // Звук
    const soundToggle = document.getElementById('setting-sound');
    if (soundToggle) {
      soundToggle.addEventListener('change', (e) => {
        settings.set('soundEnabled', e.target.checked);
        // Сразу проигрываем тот самый сигнал: понять, что включаешь,
        // проще на слух, чем по названию
        if (e.target.checked) window.chime?.dropClaimed();
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.enabled') : i18n.t('settings.disabled'),
          'info'
        );
      });
    }

    // Toast уведомления
    const toastToggle = document.getElementById('setting-toast');
    if (toastToggle) {
      toastToggle.addEventListener('change', (e) => {
        settings.set('toastNotifications', e.target.checked);
      });
    }

    // Сворачивать в трей
    const minimizeTrayToggle = document.getElementById('setting-minimize-tray');
    if (minimizeTrayToggle) {
      minimizeTrayToggle.addEventListener('change', async (e) => {
        settings.set('minimizeToTray', e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.minimizeToTray') : i18n.t('settings.minimizeToTray'),
          'info'
        );
      });
    }

    // Автоматическое получение
    const autoClaimToggle = document.getElementById('setting-auto-claim');
    if (autoClaimToggle) {
      autoClaimToggle.addEventListener('change', (e) => {
        settings.set('autoClaimDrops', e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.autoClaimDrops') : i18n.t('settings.autoClaimDrops'),
          'info'
        );
      });
    }

    // Экономный режим графики. Аппаратное ускорение отключается только до
    // готовности приложения, поэтому меняется оно лишь при следующем запуске
    const chatToggle = document.getElementById('setting-background-chat');
    if (chatToggle) {
      chatToggle.addEventListener('change', (e) => {
        settings.set('backgroundChat', e.target.checked);
        if (!e.target.checked) {
          window.chatManager?.unload();
          window.utils.showToast('Фоновый чат выключен, сундуки собираются запросом', 'info');
        } else {
          const login = window.farmingPage?.currentStream?.login;
          if (login) {
            window.farmingPage?.startBonusAutoCollector?.();
            window.chatManager?.load(login);
          }
          window.utils.showToast('Фоновый чат включён', 'info');
        }
      });
    }

    const lowGraphicsToggle = document.getElementById('setting-low-graphics');
    if (lowGraphicsToggle) {
      lowGraphicsToggle.addEventListener('change', (e) => {
        settings.set('lowGraphics', e.target.checked);
        window.utils.showToast('Вступит в силу после перезапуска приложения', 'info');
      });
    }

    // Потолок скорости загрузки стрима
    const limitToggle = document.getElementById('setting-limit-speed');
    const limitNote = document.getElementById('limit-note');

    const обновитьПотолок = () => {
      if (!limitNote) return;
      limitNote.textContent = settings.get('limitStreamSpeed') === false
        ? 'Выключено — стрим качается на полной скорости'
        : window.NetworkLimit.describe(
            settings.get('preferredStreamQuality'), settings.get('streamSpeedHeadroom'));
    };
    обновитьПотолок();

    if (limitToggle) {
      limitToggle.addEventListener('change', (e) => {
        settings.set('limitStreamSpeed', e.target.checked);
        обновитьПотолок();
        // Настройка зеркалится в главный процесс не мгновенно, поэтому
        // просим переприменить потолок явно
        setTimeout(() => window.electronAPI?.refreshStreamLimit?.(), 300);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.enabled') : i18n.t('settings.disabled'), 'info');
      });
    }

    // Тихие часы
    const quietToggle = document.getElementById('setting-quiet');
    const quietFrom = document.getElementById('setting-quiet-from');
    const quietTo = document.getElementById('setting-quiet-to');
    const quietNote = document.getElementById('quiet-note');

    const обновитьПодпись = () => {
      if (!quietNote) return;
      const включено = settings.get('quietHours') !== false;
      quietNote.textContent = включено
        ? window.QuietHours.describe(settings.get('quietFrom'), settings.get('quietTo'))
        : 'Выключено';
    };
    обновитьПодпись();

    if (quietToggle) {
      quietToggle.addEventListener('change', (e) => {
        settings.set('quietHours', e.target.checked);
        обновитьПодпись();
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.enabled') : i18n.t('settings.disabled'), 'info');
      });
    }

    // Пустое или неразобранное время не сохраняем: иначе тишина
    // выключилась бы молча, а пользователь думал бы, что она работает
    const сохранитьВремя = (input, key) => {
      if (!input) return;
      input.addEventListener('change', () => {
        if (window.QuietHours.toMinutes(input.value) === null) {
          input.value = settings.get(key);
          window.utils.showToast('Время указано неверно', 'warning');
          return;
        }
        settings.set(key, input.value);
        обновитьПодпись();
      });
    };
    сохранитьВремя(quietFrom, 'quietFrom');
    сохранитьВремя(quietTo, 'quietTo');

    // Подсказки о выгодных категориях
    const suggestToggle = document.getElementById('setting-suggest');
    if (suggestToggle) {
      suggestToggle.addEventListener('change', (e) => {
        settings.set('suggestCategories', e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.enabled') : i18n.t('settings.disabled'), 'info');
      });
    }

    // Горячие клавиши перехватываются у всей системы, поэтому их
    // включение и выключение выполняет главный процесс
    const shortcutsToggle = document.getElementById('setting-shortcuts');
    if (shortcutsToggle) {
      shortcutsToggle.addEventListener('change', (e) => {
        settings.set('globalShortcuts', e.target.checked);
        window.electronAPI?.setGlobalShortcuts?.(e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.enabled') : i18n.t('settings.disabled'), 'info');
      });
    }

    // Уведомление о выходе избранного канала
    const favouriteLiveToggle = document.getElementById('setting-favourite-live');
    if (favouriteLiveToggle) {
      favouriteLiveToggle.addEventListener('change', (e) => {
        settings.set('notifyFavouriteLive', e.target.checked);
        if (e.target.checked) window.favouritesWatch?.start();
        else window.favouritesWatch?.stop();
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.enabled') : i18n.t('settings.disabled'),
          'info'
        );
      });
    }

    // Выбор категории по выгоде
    const smartSwitchToggle = document.getElementById('setting-smart-switch');
    if (smartSwitchToggle) {
      smartSwitchToggle.addEventListener('change', (e) => {
        settings.set('smartCategorySwitch', e.target.checked);
        window.utils.showToast(
          e.target.checked
            ? 'Категории выбираются по выгоде'
            : 'Категории выбираются по прежним правилам',
          'info'
        );
      });
    }

    // Уведомления о получении дропов
    const notifyDropToggle = document.getElementById('setting-notify-drop');
    if (notifyDropToggle) {
      notifyDropToggle.addEventListener('change', (e) => {
        settings.set('notifyOnDropClaimed', e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.enabled') : i18n.t('settings.disabled'),
          'info'
        );
      });
    }

    // Автозапуск вместе с системой
    const autostartToggle = document.getElementById('setting-autostart');
    if (autostartToggle) {
      autostartToggle.addEventListener('change', (e) => {
        settings.set('autostart', e.target.checked);
        // Реальный автозапуск включает main-процесс через системный API
        window.electronAPI?.setAutostart?.(e.target.checked);
      }, { signal: this._abort.signal });
    }

    // Качество стрима: напрямую влияет на расход трафика
    const qualitySelect = document.getElementById('setting-quality');
    if (qualitySelect) {
      qualitySelect.addEventListener('change', (e) => {
        settings.set('preferredStreamQuality', e.target.value);
        обновитьПотолок();
        setTimeout(() => window.electronAPI?.refreshStreamLimit?.(), 300);
        window.utils.showToast(i18n.t('settings.qualityApplied'), 'info');
      }, { signal: this._abort.signal });
    }

    // Автовыключение после сбора всех дропсов
    const shutdownToggle = document.getElementById('setting-shutdown');
    if (shutdownToggle) {
      shutdownToggle.addEventListener('change', (e) => {
        settings.set('enableShutdown', e.target.checked);

        document.querySelectorAll('.shutdown-option').forEach(row => {
          row.style.display = e.target.checked ? '' : 'none';
        });
        refreshSummary();

        window.utils.showToast(
          e.target.checked ? i18n.t('settings.shutdownEnabled') : i18n.t('settings.shutdownDisabled'),
          e.target.checked ? 'warning' : 'info'
        );
      }, { signal: this._abort.signal });
    }

    const refreshSummary = () => {
      const box = document.getElementById('shutdown-summary');
      if (box && window.shutdownManager) {
        box.textContent = window.shutdownManager.describeSchedule();
      }
    };

    const shutdownSelects = [
      ['setting-shutdown-action', 'shutdownAction'],
      ['setting-shutdown-trigger', 'shutdownTrigger'],
      ['setting-shutdown-delay', 'shutdownDelayMinutes'],
      ['setting-shutdown-timer', 'shutdownTimerHours']
    ];
    shutdownSelects.forEach(([elementId, settingKey]) => {
      const select = document.getElementById(elementId);
      if (!select) return;
      select.addEventListener('change', (e) => {
        const numeric = settingKey === 'shutdownDelayMinutes' || settingKey === 'shutdownTimerHours';
        settings.set(settingKey, numeric ? Number(e.target.value) : e.target.value);
        refreshSummary();
      }, { signal: this._abort.signal });
    });

    // Автопереключение
    const autoSwitchToggle = document.getElementById('setting-auto-switch');
    if (autoSwitchToggle) {
      autoSwitchToggle.addEventListener('change', (e) => {
        settings.set('autoSwitchStreams', e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.autoSwitchStreams') : i18n.t('settings.autoSwitchStreams'),
          'info'
        );
      });
    }

    // Компактный режим
    const compactToggle = document.getElementById('setting-compact');
    if (compactToggle) {
      compactToggle.addEventListener('change', (e) => {
        settings.set('compactMode', e.target.checked);
        document.body.classList.toggle('compact-mode', e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.compactMode') : i18n.t('settings.compactMode'),
          'info'
        );
      });
    }

    // Показывать завершённые
    const showExpiredToggle = document.getElementById('setting-show-expired');
    if (showExpiredToggle) {
      showExpiredToggle.addEventListener('change', (e) => {
        settings.set('showExpiredCampaigns', e.target.checked);
        // Календарь может быть уже открыт — показываем изменение сразу
        window.calendarPage?.render?.();
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.showExpiredCampaigns') : i18n.t('settings.showExpiredCampaigns'),
          'info'
        );
      });
    }

    // Анимации
    const animationsToggle = document.getElementById('setting-animations');
    if (animationsToggle) {
      animationsToggle.addEventListener('change', (e) => {
        settings.set('animationsEnabled', e.target.checked);
        document.body.classList.toggle('no-animations', !e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.animations') : i18n.t('settings.animations'),
          'info'
        );
      });
    }

    // Режим разработчика
    const developerModeToggle = document.getElementById('setting-developer-mode');
    if (developerModeToggle) {
      developerModeToggle.addEventListener('change', (e) => {
        settings.set('developerMode', e.target.checked);
        window.utils.showToast(
          e.target.checked ? i18n.t('settings.enabled') : i18n.t('settings.disabled'),
          'info'
        );
      });
    }

    // Выбор языка (кастомный select)
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
      const trigger = languageSelect.querySelector('.custom-select-trigger');
      const options = languageSelect.querySelectorAll('.custom-select-option');
      
      // Открытие/закрытие dropdown
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        languageSelect.classList.toggle('open');
      });
      
      // Выбор опции
      options.forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          const value = option.dataset.value;
          const label = option.querySelector('span').textContent;
          
          // Обновляем выбранную опцию
          options.forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
          
          // Обновляем отображаемое значение
          trigger.querySelector('.custom-select-value').textContent = label;
          
          // Сохраняем и применяем язык
          i18n.setLanguage(value);
          
          // Перерендериваем страницу с новым языком
          this.render();
          this.setupEventListeners();
          this.loadAppVersion();
          
          window.utils.showToast(`${i18n.t('settings.language')}: ${label}`, 'success');
          
          // Закрываем dropdown
          languageSelect.classList.remove('open');
        });
      });
      
      // Закрытие при клике вне dropdown
      document.addEventListener('click', () => {
        languageSelect.classList.remove('open');
      }, { signal: this._abort.signal });
    }

    // Тема (кастомный select)
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      const trigger = themeSelect.querySelector('.custom-select-trigger');
      const options = themeSelect.querySelectorAll('.custom-select-option');
      
      // Открытие/закрытие dropdown
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        themeSelect.classList.toggle('open');
      });
      
      // Выбор опции
      options.forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          const value = option.dataset.value;
          const label = option.querySelector('span').textContent;
          
          // Обновляем выбранную опцию
          options.forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
          
          // Обновляем отображаемое значение
          trigger.querySelector('.custom-select-value').textContent = label;
          
          // Сохраняем и применяем тему
          settings.set('theme', value);
          document.body.className = `theme-${value}`;
          window.utils.showToast(`${i18n.t('settings.theme')}: ${label}`, 'info');
          
          // Закрываем dropdown
          themeSelect.classList.remove('open');
        });
      });
      
      // Закрытие при клике вне dropdown
      document.addEventListener('click', () => {
        themeSelect.classList.remove('open');
      }, { signal: this._abort.signal });
    }

    // Сброс настроек
    const whatsNewBtn = document.getElementById('whats-new-btn');
    if (whatsNewBtn) {
      whatsNewBtn.addEventListener('click', () => {
        window.whatsNew?.show();
      }, { signal: this._abort.signal });
    }

    const clearStatsBtn = document.getElementById('clear-statistics-btn');
    if (clearStatsBtn) {
      clearStatsBtn.addEventListener('click', async () => {
        if (!confirm(i18n.t('settings.clearStatisticsConfirm'))) return;

        try {
          await Storage.clearStatistics();
          // Страница статистики слушает это событие и перерисуется сама
          window.dispatchEvent(new CustomEvent('statistics-updated'));
          window.utils.showToast(i18n.t('settings.clearStatisticsDone'), 'success');
        } catch (error) {
          console.error('[Settings] Не удалось очистить статистику:', error);
          window.utils.showToast('Не удалось очистить статистику', 'error');
        }
      }, { signal: this._abort.signal });
    }

    const resetBtn = document.getElementById('reset-settings-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm(i18n.t('settings.resetSettings') + '?')) {
          settings.reset();
          this.render();
          this.setupEventListeners();
          window.utils.showToast(i18n.t('settings.resetSettings'), 'success');
        }
      });
    }

    // Экспорт
    // Полная копия: категории, подписки, статистика, настройки
    const backupExportBtn = document.getElementById('backup-export-btn');
    if (backupExportBtn) {
      backupExportBtn.addEventListener('click', async () => {
        try {
          const data = await window.Backup.collect(new Date().toISOString());
          const день = new Date().toISOString().slice(0, 10);

          const сохранить = (содержимое, тип, имя) => {
            const blob = new Blob([содержимое], { type: тип });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = имя;
            a.click();
            URL.revokeObjectURL(url);
          };

          сохранить(JSON.stringify(data, null, 2), 'application/json',
            `watchtwitch-backup-${день}.json`);

          // Заодно сроки кампаний для обычного календаря: приложение знает,
          // когда что заканчивается, но это знание жило только внутри него
          const известные = await window.CampaignHistory.loadKnown();
          const календарь = window.IcsExport.build(известные);

          if (календарь.events > 0) {
            сохранить(календарь.text, 'text/calendar',
              `watchtwitch-drops-${день}.ics`);
          }

          const итог = window.Backup.describe(data) +
            (календарь.events > 0
              ? `; сроков в календарь: ${календарь.events}`
              : '; сроков календаря пока нет');

          window.utils.showToast('Копия сохранена: ' + итог, 'success');
        } catch (error) {
          console.error('[Копия] Не удалось сохранить:', error);
          window.utils.showToast('Не удалось сохранить копию', 'error');
        }
      });
    }

    const logsBtn = document.getElementById('open-logs-btn');
    if (logsBtn) {
      logsBtn.addEventListener('click', async () => {
        const result = await window.electronAPI.openLogsFolder?.();
        if (result && !result.success) {
          window.utils.showToast('Не удалось открыть папку логов: ' + (result.error || ''), 'error');
        }
      });
    }

    const backupImportBtn = document.getElementById('backup-import-btn');
    const backupInput = document.getElementById('backup-file-input');
    if (backupImportBtn && backupInput) {
      backupImportBtn.addEventListener('click', () => backupInput.click());

      backupInput.addEventListener('change', async () => {
        const file = backupInput.files?.[0];
        if (!file) return;

        try {
          const text = await file.text();
          const data = JSON.parse(text);

          const check = window.Backup.validate(data);
          if (!check.ok) {
            window.utils.showToast(check.error, 'error');
            return;
          }

          // Восстановление затирает текущий список, поэтому спрашиваем
          const ok = confirm(
            `Восстановить копию от ${new Date(data.createdAt).toLocaleString('ru-RU')}?

` +
            `Будет заменено: ${window.Backup.describe(data)}.
` +
            'Текущие данные перезапишутся.'
          );
          if (!ok) return;

          const applied = await window.Backup.restore(data);
          window.utils.showToast('Восстановлено: ' + applied.join(', ') + '. Перезапустите приложение', 'success');
        } catch (error) {
          console.error('[Копия] Не удалось восстановить:', error);
          window.utils.showToast('Не удалось прочитать копию: ' + error.message, 'error');
        } finally {
          backupInput.value = '';
        }
      });
    }

    const exportBtn = document.getElementById('export-settings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const data = settings.export();
        navigator.clipboard.writeText(data);
        window.utils.showToast(i18n.t('settings.exportSettings'), 'success');
      });
    }

    // Проверка обновлений
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    if (checkUpdatesBtn) {
      checkUpdatesBtn.addEventListener('click', (event) => {
        if (event?.shiftKey) {
          if (window.UpdateManager?.simulateUpdate) {
            window.UpdateManager.simulateUpdate('test');
            window.utils.showToast('Test mode activated', 'info');
          } else {
            window.utils.showToast('UpdateManager not loaded', 'warning');
          }
          return;
        }

        if (window.electronAPI?.checkForUpdates) {
          window.electronAPI.checkForUpdates();
          window.utils.showToast(i18n.t('settings.checkUpdates') + '...', 'info');
        } else {
          window.utils.showToast('Updates unavailable in dev mode', 'warning');
        }
      });
    }

    // GitHub link
    const githubBtn = document.getElementById('github-link-btn');
    if (githubBtn) {
      githubBtn.addEventListener('click', () => {
        if (window.electronAPI?.openExternal) {
          window.electronAPI.openExternal('https://github.com/Agrysif/WatchTwitch');
        } else {
          window.open('https://github.com/Agrysif/WatchTwitch', '_blank');
        }
      });
    }

    // Telegram link
    const telegramBtn = document.getElementById('telegram-link-btn');
    if (telegramBtn) {
      telegramBtn.addEventListener('click', () => {
        if (window.electronAPI?.openExternal) {
          window.electronAPI.openExternal('https://t.me/ebalashovv');
        } else {
          window.open('https://t.me/ebalashovv', '_blank');
        }
      });
    }

    // Boosty link
    const boostyBtn = document.getElementById('boosty-link-btn');
    if (boostyBtn) {
      boostyBtn.addEventListener('click', () => {
        if (window.electronAPI?.openExternal) {
          window.electronAPI.openExternal('https://boosty.to/agrysif');
        } else {
          window.open('https://boosty.to/agrysif', '_blank');
        }
      });
    }

    this.setupDiagnostics();
  }

  setupDiagnostics() {
    const refreshBtn = document.getElementById('refresh-processes-btn');
    const list = document.getElementById('processes-list');
    if (!refreshBtn || !list || !window.electronAPI?.getProcessMetrics) return;

    if (!refreshBtn.dataset.bound) {
      refreshBtn.addEventListener('click', () => this.renderProcessMetrics());
      refreshBtn.dataset.bound = 'true';
    }

    this.renderProcessMetrics();
  }

  async renderProcessMetrics() {
    const list = document.getElementById('processes-list');
    if (!list) return;

    try {
      const metrics = await window.electronAPI.getProcessMetrics();
      if (!metrics || metrics.length === 0) {
        list.innerHTML = '<div style="color: var(--text-secondary);">Нет данных</div>';
        return;
      }

      const formatMb = (kb) => {
        if (typeof kb !== 'number') return '—';
        return `${(kb / 1024).toFixed(1)} MB`;
      };

      const formatCpu = (cpu) => {
        const value = cpu?.percentCPUUsage;
        if (typeof value !== 'number') return '—';
        return `${value.toFixed(1)}%`;
      };

      list.innerHTML = metrics.map(metric => {
        const label = metric.label || metric.type || 'process';
        const memory = formatMb(metric.memory?.workingSetSize);
        const cpu = formatCpu(metric.cpu);
        const pid = metric.pid || '—';

        return `
          <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 10px 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
            <div>
              <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${label}</div>
              <div style="font-size: 11px; color: var(--text-secondary);">pid: ${pid} • type: ${metric.type || '—'}</div>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">CPU ${cpu}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">RAM ${memory}</div>
          </div>
        `;
      }).join('');
    } catch (error) {
      console.error('[Diagnostics] Failed to load process metrics:', error);
      list.innerHTML = '<div style="color: var(--text-secondary);">Ошибка загрузки данных</div>';
    }
  }

  async loadAppVersion() {
    const i18n = window.i18n;
    const versionEl = document.getElementById('setting-app-version');
    if (!versionEl) return;
    try {
      if (window.electronAPI?.getAppVersion) {
        const version = await window.electronAPI.getAppVersion();
        versionEl.textContent = `v${version}`;
      }
    } catch (e) {
      versionEl.textContent = '—';
    }
  }
}

window.SettingsPage = SettingsPage;
