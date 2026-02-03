// Settings Page
class SettingsPage {
  constructor() {
    this.init();
  }

  init() {
    this.render();
    this.setupEventListeners();
    this.loadAppVersion();
  }

  render() {
    const container = document.getElementById('page-container');
    if (!container) return;

    const settings = window.SettingsManager;

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 10px; vertical-align: -5px; color: var(--accent-color);">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
          Настройки
        </h1>
        <p class="page-subtitle">Конфигурация приложения</p>
      </div>

      <div class="settings-container">
        <!-- Звук и уведомления -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #FFB020;">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
            </svg>
            Уведомления
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Звуковые уведомления</div>
              <div class="settings-item-description">Воспроизводить звук при получении дропа</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-sound" ${settings.get('soundEnabled') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Toast уведомления</div>
              <div class="settings-item-description">Показывать всплывающие уведомления в приложении</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-toast" ${settings.get('toastNotifications') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Сворачивать в трей</div>
              <div class="settings-item-description">При закрытии окна приложение продолжит работу в трее</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-minimize-tray" ${settings.get('minimizeToTray', true) ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>
        </div>

        <!-- Автоматизация -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #00E57A;">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
            </svg>
            Автоматизация
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Автоматическое получение дропов</div>
              <div class="settings-item-description">Получать дропы автоматически когда они готовы</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-auto-claim" ${settings.get('autoClaimDrops') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Автопереключение стримов</div>
              <div class="settings-item-description">Автоматически переключаться на другой стрим если текущий завершился</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-auto-switch" ${settings.get('autoSwitchStreams') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>
        </div>

        <!-- Отображение -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #A855F7;">
              <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            </svg>
            Отображение
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Компактный режим</div>
              <div class="settings-item-description">Уменьшить размер карточек для отображения большего количества</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-compact" ${settings.get('compactMode') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Показывать завершённые кампании</div>
              <div class="settings-item-description">Отображать кампании с полученными дропами</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-show-expired" ${settings.get('showExpiredCampaigns') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Анимации</div>
              <div class="settings-item-description">Включить плавные анимации и переходы</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="setting-animations" ${settings.get('animationsEnabled') ? 'checked' : ''}>
              <span class="settings-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Тема оформления</div>
              <div class="settings-item-description">Выбор цветовой схемы приложения</div>
            </div>
            <select id="setting-theme" class="settings-select">
              <option value="dark" ${settings.get('theme') === 'dark' ? 'selected' : ''}>Тёмная</option>
              <option value="light" ${settings.get('theme') === 'light' ? 'selected' : ''}>Светлая</option>
            </select>
          </div>
        </div>

        <!-- Действия -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #3B82F6;">
              <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
            </svg>
            Действия
          </h2>
          
          <div class="settings-actions">
            <button class="btn btn-secondary" id="reset-settings-btn">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 3a5 5 0 1 0 5 5h-2a3 3 0 1 1-3-3V3zm0-2v2a7 7 0 1 1-7 7H0a8 8 0 1 0 8-8z"/>
              </svg>
              Сбросить настройки
            </button>
            
            <button class="btn btn-secondary" id="export-settings-btn">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0l4 4h-3v5H7V4H4l4-4zm-7 11v4h14v-4h-2v2H3v-2H1z"/>
              </svg>
              Экспорт настроек
            </button>
          </div>
        </div>

        <!-- Обновления -->
        <div class="settings-section">
          <h2 class="settings-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px; vertical-align: -4px; color: #FF6B6B;">
              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
            </svg>
            Обновления
          </h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Версия приложения</div>
              <div class="settings-item-description" id="setting-app-version">—</div>
            </div>
            <button class="btn btn-secondary" id="check-updates-btn">
              Проверить обновления
            </button>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">GitHub</div>
              <div class="settings-item-description">Исходный код и документация</div>
            </div>
            <button class="btn btn-secondary" id="github-link-btn" style="display: flex; align-items: center; gap: 6px;">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              Открыть
            </button>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Telegram</div>
              <div class="settings-item-description">Новости и поддержка</div>
            </div>
            <button class="btn btn-secondary" id="telegram-link-btn" style="display: flex; align-items: center; gap: 6px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.693-1.653-1.124-2.678-1.8-1.185-.781-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.14.121.099.155.232.171.326.016.095.036.312.02.482z"/>
              </svg>
              Открыть
            </button>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Поддержать проект</div>
              <div class="settings-item-description">Финансовая поддержка разработки</div>
            </div>
            <button class="btn btn-secondary" id="boosty-link-btn" style="display: flex; align-items: center; gap: 6px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.31-8.86c-1.77-.45-2.34-.94-2.34-1.67 0-.84.79-1.43 2.1-1.43 1.38 0 1.9.66 1.94 1.64h1.71c-.05-1.34-.87-2.57-2.49-2.97V5H10.9v1.69c-1.51.32-2.72 1.3-2.72 2.81 0 1.79 1.49 2.69 3.66 3.21 1.95.46 2.34 1.15 2.34 1.87 0 .53-.39 1.39-2.1 1.39-1.6 0-2.23-.72-2.32-1.64H8.04c.1 1.7 1.36 2.66 2.86 2.97V19h2.34v-1.67c1.52-.29 2.72-1.16 2.73-2.77-.01-2.2-1.9-2.96-3.66-3.42z"/>
              </svg>
              Открыть
            </button>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const settings = window.SettingsManager;

    // Звук
    const soundToggle = document.getElementById('setting-sound');
    if (soundToggle) {
      soundToggle.addEventListener('change', (e) => {
        settings.set('soundEnabled', e.target.checked);
        window.utils.showToast(
          e.target.checked ? '🔊 Звук включён' : '🔇 Звук выключен',
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
      minimizeTrayToggle.addEventListener('change', (e) => {
        settings.set('minimizeToTray', e.target.checked);
        window.utils.showToast(
          e.target.checked ? '📥 Сворачивание в трей включено' : '📤 Сворачивание в трей выключено',
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
          e.target.checked ? '✅ Авто-получение включено' : '❌ Авто-получение выключено',
          'info'
        );
      });
    }

    // Автопереключение
    const autoSwitchToggle = document.getElementById('setting-auto-switch');
    if (autoSwitchToggle) {
      autoSwitchToggle.addEventListener('change', (e) => {
        settings.set('autoSwitchStreams', e.target.checked);
        window.utils.showToast(
          e.target.checked ? '🔄 Автопереключение включено' : '⏸️ Автопереключение выключено',
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
          e.target.checked ? '📦 Компактный режим' : '📋 Обычный режим',
          'info'
        );
      });
    }

    // Показывать завершённые
    const showExpiredToggle = document.getElementById('setting-show-expired');
    if (showExpiredToggle) {
      showExpiredToggle.addEventListener('change', (e) => {
        settings.set('showExpiredCampaigns', e.target.checked);
        window.utils.showToast(
          e.target.checked ? '👁️ Показывать завершённые' : '🙈 Скрывать завершённые',
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
          e.target.checked ? '✨ Анимации включены' : '⚡ Анимации выключены',
          'info'
        );
      });
    }

    // Тема
    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        settings.set('theme', e.target.value);
        document.body.className = `theme-${e.target.value}`;
        window.utils.showToast(`🎨 Тема: ${e.target.value === 'dark' ? 'Тёмная' : 'Светлая'}`, 'info');
      });
    }

    // Сброс настроек
    const resetBtn = document.getElementById('reset-settings-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Сбросить все настройки к значениям по умолчанию?')) {
          settings.reset();
          this.render();
          this.setupEventListeners();
          window.utils.showToast('⚙️ Настройки сброшены', 'success');
        }
      });
    }

    // Экспорт
    const exportBtn = document.getElementById('export-settings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const data = settings.export();
        navigator.clipboard.writeText(data);
        window.utils.showToast('📋 Настройки скопированы в буфер обмена', 'success');
      });
    }

    // Проверка обновлений
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    if (checkUpdatesBtn) {
      checkUpdatesBtn.addEventListener('click', (event) => {
        if (event?.shiftKey) {
          if (window.UpdateManager?.simulateUpdate) {
            window.UpdateManager.simulateUpdate('test');
            window.utils.showToast('🧪 Тестовое обновление показано', 'info');
          } else {
            window.utils.showToast('Тест недоступен (нет UpdateManager)', 'warning');
          }
          return;
        }

        if (window.electronAPI?.checkForUpdates) {
          window.electronAPI.checkForUpdates();
          window.utils.showToast('🔍 Проверяем обновления...', 'info');
        } else {
          window.utils.showToast('Обновления недоступны в этом режиме', 'warning');
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
  }

  async loadAppVersion() {
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
