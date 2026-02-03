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
        <h1 class="page-title">⚙️ Настройки</h1>
        <p class="page-subtitle">Конфигурация приложения</p>
      </div>

      <div class="settings-container">
        <!-- Звук и уведомления -->
        <div class="settings-section">
          <h2 class="settings-section-title">🔔 Уведомления</h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Звуковые уведомления</div>
              <div class="settings-item-description">Воспроизводить звук при получении дропа</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="setting-sound" ${settings.get('soundEnabled') ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Toast уведомления</div>
              <div class="settings-item-description">Показывать всплывающие уведомления в приложении</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="setting-toast" ${settings.get('toastNotifications') ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <!-- Автоматизация -->
        <div class="settings-section">
          <h2 class="settings-section-title">🤖 Автоматизация</h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Автоматическое получение дропов</div>
              <div class="settings-item-description">Получать дропы автоматически когда они готовы</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="setting-auto-claim" ${settings.get('autoClaimDrops') ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Автопереключение стримов</div>
              <div class="settings-item-description">Автоматически переключаться на другой стрим если текущий завершился</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="setting-auto-switch" ${settings.get('autoSwitchStreams') ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <!-- Отображение -->
        <div class="settings-section">
          <h2 class="settings-section-title">🎨 Отображение</h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Компактный режим</div>
              <div class="settings-item-description">Уменьшить размер карточек для отображения большего количества</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="setting-compact" ${settings.get('compactMode') ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Показывать завершённые кампании</div>
              <div class="settings-item-description">Отображать кампании с полученными дропами</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="setting-show-expired" ${settings.get('showExpiredCampaigns') ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Анимации</div>
              <div class="settings-item-description">Включить плавные анимации и переходы</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="setting-animations" ${settings.get('animationsEnabled') ? 'checked' : ''}>
              <span class="toggle-slider"></span>
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
          <h2 class="settings-section-title">🔧 Действия</h2>
          
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
          <h2 class="settings-section-title">⬆️ Обновления</h2>
          
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">Версия приложения</div>
              <div class="settings-item-description" id="setting-app-version">—</div>
            </div>
            <button class="btn btn-secondary" id="check-updates-btn">
              Проверить обновления
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
      checkUpdatesBtn.addEventListener('click', () => {
        if (window.electronAPI?.checkForUpdates) {
          window.electronAPI.checkForUpdates();
          window.utils.showToast('🔍 Проверяем обновления...', 'info');
        } else {
          window.utils.showToast('Обновления недоступны в этом режиме', 'warning');
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
