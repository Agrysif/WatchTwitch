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
    
    this.createOverlay();
    this.setupListeners();
    this.startAutoCheck();
  }

  /**
   * Создаём красивое overlay окно для обновлений
   */
  createOverlay() {
    const style = document.createElement('style');
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
        background: linear-gradient(135deg, #0e0e10 0%, #1a1a2e 100%);
        border-radius: 16px;
        padding: 32px;
        width: 90%;
        max-width: 500px;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.8);
        animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        border: 1px solid rgba(145, 71, 255, 0.2);
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
        background: linear-gradient(135deg, #9147ff 0%, #772ce8 100%);
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 24px;
        box-shadow: 0 15px 40px rgba(145, 71, 255, 0.3);
      }

      .update-logo svg {
        width: 48px;
        height: 48px;
        fill: white;
      }

      .update-title {
        font-size: 24px;
        font-weight: 700;
        color: #efeff1;
        margin-bottom: 8px;
        text-align: center;
      }

      .update-subtitle {
        font-size: 14px;
        color: #adadb8;
        text-align: center;
        margin-bottom: 24px;
      }

      .update-version {
        font-size: 13px;
        color: #9147ff;
        text-align: center;
        margin-bottom: 24px;
        padding: 8px 12px;
        background: rgba(145, 71, 255, 0.1);
        border-radius: 8px;
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
        color: #adadb8;
      }

      .update-progress-bar {
        width: 100%;
        height: 6px;
        background: rgba(145, 71, 255, 0.1);
        border-radius: 3px;
        overflow: hidden;
        position: relative;
      }

      .update-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #9147ff 0%, #00e57a 100%);
        border-radius: 3px;
        width: 0%;
        transition: width 0.3s ease-out;
        box-shadow: 0 0 12px rgba(145, 71, 255, 0.6);
      }

      .update-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
      }

      .update-btn {
        padding: 12px 24px;
        border-radius: 8px;
        border: none;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        flex: 1;
      }

      .update-btn-primary {
        background: linear-gradient(135deg, #9147ff 0%, #772ce8 100%);
        color: white;
        box-shadow: 0 8px 24px rgba(145, 71, 255, 0.3);
      }

      .update-btn-primary:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px rgba(145, 71, 255, 0.4);
      }

      .update-btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .update-btn-secondary {
        background: rgba(145, 71, 255, 0.1);
        color: #9147ff;
        border: 1px solid rgba(145, 71, 255, 0.3);
      }

      .update-btn-secondary:hover:not(:disabled) {
        background: rgba(145, 71, 255, 0.2);
        border-color: rgba(145, 71, 255, 0.5);
      }

      .update-status {
        text-align: center;
        font-size: 13px;
        color: #adadb8;
        margin-bottom: 16px;
      }

      .update-status.success {
        color: #00e57a;
      }

      .update-status.error {
        color: #ff4444;
      }

      .spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(145, 71, 255, 0.3);
        border-top-color: #9147ff;
        border-radius: 50%;
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
            Позже
          </button>
          <button class="update-btn update-btn-primary" id="update-download-btn" onclick="updateManager.downloadUpdate()">
            Загрузить и установить
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.window = overlay.querySelector('.update-window');
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
      console.log('[UpdateManager] Update available:', info.version);
      this.updateInfo = info;
      this.showWindow();
      this.updateVersionText(info.version);
    });

    // Прогресс загрузки
    window.electronAPI.onUpdateProgress?.((progress) => {
      this.downloading = true;
      this.showProgress(progress.percent);
    });

    // Обновление загружено и готово к установке
    window.electronAPI.onUpdateDownloaded?.(() => {
      console.log('[UpdateManager] Update downloaded, ready to install');
      this.downloading = false;
      this.showReadyToInstall();
    });

    // Ошибка обновления
    window.electronAPI.onUpdateError?.((error) => {
      console.error('[UpdateManager] Update error:', error);
      this.showError(error);
    });
  }

  /**
   * Показать окно обновления
   */
  showWindow() {
    this.overlay.classList.add('show');
    document.getElementById('progress-section').style.display = 'none';
    document.getElementById('update-status').textContent = '';
    document.getElementById('update-later-btn').style.display = 'block';
  }

  /**
   * Закрыть окно обновления
   */
  closeWindow() {
    this.overlay.classList.remove('show');
  }

  /**
   * Обновить текст версии
   */
  updateVersionText(version) {
    document.getElementById('update-version-text').textContent = `Версия ${version}`;
  }

  /**
   * Показать прогресс загрузки
   */
  showProgress(percent) {
    const progressSection = document.getElementById('progress-section');
    progressSection.style.display = 'block';
    
    const fill = document.getElementById('update-progress-fill');
    const percentText = document.getElementById('progress-percent');
    
    fill.style.width = percent + '%';
    percentText.textContent = Math.round(percent) + '%';
    
    const btn = document.getElementById('update-download-btn');
    btn.disabled = true;
    btn.textContent = 'Загрузка...';
    
    document.getElementById('update-later-btn').style.display = 'none';
  }

  /**
   * Показать что обновление готово к установке
   */
  showReadyToInstall() {
    const fill = document.getElementById('update-progress-fill');
    fill.style.width = '100%';
    
    const btn = document.getElementById('update-download-btn');
    btn.disabled = false;
    btn.textContent = 'Установить и перезагрузить';
    btn.onclick = () => this.installUpdate();
    
    const status = document.getElementById('update-status');
    status.textContent = '✓ Обновление готово';
    status.classList.add('success');
    
    document.getElementById('update-later-btn').style.display = 'block';
  }

  /**
   * Показать ошибку
   */
  showError(error) {
    this.downloading = false;
    
    const btn = document.getElementById('update-download-btn');
    btn.disabled = false;
    btn.textContent = 'Попробовать ещё';
    btn.onclick = () => this.checkForUpdates();
    
    const status = document.getElementById('update-status');
    status.textContent = '✗ Ошибка: ' + error;
    status.classList.add('error');
    
    document.getElementById('progress-section').style.display = 'none';
  }

  /**
   * Проверить обновления
   */
  checkForUpdates() {
    if (this.checking || this.downloading) return;
    
    this.checking = true;
    console.log('[UpdateManager] Checking for updates...');
    
    if (window.electronAPI?.checkForUpdates) {
      window.electronAPI.checkForUpdates();
    }
    
    setTimeout(() => {
      this.checking = false;
    }, 2000);
  }

  /**
   * Загрузить обновление
   */
  downloadUpdate() {
    if (this.downloading) return;
    
    console.log('[UpdateManager] Starting download...');
    
    if (window.electronAPI?.downloadUpdate) {
      window.electronAPI.downloadUpdate();
    }
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
   * Автоматическая проверка каждые 30 минут
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

// Очищаем при закрытии окна
window.addEventListener('beforeunload', () => {
  updateManager.stopAutoCheck();
});
