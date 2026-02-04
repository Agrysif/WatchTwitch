/**
 * Update Handler Module
 * Manages app update lifecycle and beautiful UI overlay
 */

const UpdateManager = {
  currentVersion: null,
  newVersion: null,
  downloadProgress: 0,
  downloadSpeed: 0,
  lastDownloadedBytes: 0,
  lastSpeedCheckTime: 0,

  init() {
    this.overlay = document.getElementById('update-overlay');
    this.modal = document.querySelector('.update-modal');
    this.downloadBtn = document.getElementById('update-download-btn');
    this.installBtn = document.getElementById('update-install-btn');
    this.laterBtn = document.getElementById('update-later-btn');
    this.progressBar = document.getElementById('update-progress-bar');
    this.progressContainer = document.getElementById('update-progress-container');
    this.updateInfo = document.getElementById('update-info');
    this.updateVersion = document.getElementById('update-version');
    this.percentDisplay = document.getElementById('update-percent');
    this.speedDisplay = document.getElementById('update-speed');
    this.notificationBadge = document.getElementById('update-notification-badge');

    if (!this.overlay) {
      console.warn('[Updater] Update overlay not found in HTML, running in minimal mode');
      // В dev режиме overlay может не быть, но simulateUpdate все равно должен работать
    } else {
      this.setupEventListeners();
      this.setupIPCListeners();
      this.checkForUpdatesOnStart();
      this.setupPeriodicChecks();
    }
  },

  setupEventListeners() {
    if (!this.downloadBtn) return;
    
    this.downloadBtn.addEventListener('click', () => this.requestDownload());
    this.installBtn.addEventListener('click', () => this.requestInstall());
    this.laterBtn.addEventListener('click', () => this.closeOverlay());
  },

  setupIPCListeners() {
    // Update available
    if (window.electronAPI) {
      window.electronAPI.onUpdateAvailable?.((data) => {
        console.log('[Updater] Update available:', data.version);
        this.newVersion = data.version;
        this.showUpdateAvailable();
      });

      // Download progress
      window.electronAPI.onUpdateProgress?.((data) => {
        this.updateDownloadProgress(data);
      });

      // Update downloaded
      window.electronAPI.onUpdateDownloaded?.((data) => {
        console.log('[Updater] Update downloaded');
        this.newVersion = data?.version || this.newVersion;
        this.showUpdateReady();
      });

      // Current version
      window.electronAPI.getAppVersion?.().then((version) => {
        this.currentVersion = version;
        console.log('[Updater] Current version:', version);
      });
    }
  },

  checkForUpdatesOnStart() {
    if (window.electronAPI?.checkForUpdates) {
      // Check for updates after app loads
      setTimeout(() => {
        window.electronAPI.checkForUpdates();
      }, 1000);
    }
  },

  setupPeriodicChecks() {
    if (window.electronAPI?.checkForUpdates) {
      // Check for updates every hour
      setInterval(() => {
        window.electronAPI.checkForUpdates();
      }, 60 * 60 * 1000); // 1 hour
    }
  },

  showUpdateAvailable() {
    if (!this.overlay) return;

    this.updateVersion.textContent = `v${this.newVersion}`;
    this.updateInfo.innerHTML = `
      <p>Новая версия приложения доступна к скачиванию.</p>
      <p style="margin-top: 8px; font-size: 13px; color: var(--text-secondary);">
        Текущая версия: v${this.currentVersion || 'unknown'}
      </p>
    `;

    this.downloadBtn.style.display = 'block';
    this.installBtn.style.display = 'none';
    this.progressContainer.style.display = 'none';

    this.showOverlay();
    this.showNotificationBadge();
  },

  showUpdateReady() {
    if (!this.overlay) return;

    this.updateVersion.textContent = `v${this.newVersion}`;
    this.updateInfo.innerHTML = `
      <p><strong>Обновление загружено и готово к установке!</strong></p>
      <p style="margin-top: 8px; font-size: 13px; color: var(--text-secondary);">
        Приложение перезагрузится и установит обновление.
      </p>
    `;

    this.downloadBtn.style.display = 'none';
    this.installBtn.style.display = 'block';
    this.installBtn.disabled = false;
    this.installBtn.textContent = 'Установить и перезагрузиться';
    this.progressContainer.style.display = 'none';

    this.showOverlay();
    this.showNotificationBadge();
  },

  simulateUpdate(version = 'test') {
    console.log('[Updater] Simulating update to version:', version);
    this.newVersion = version;
    if (this.overlay) {
      this.showUpdateAvailable();
    } else {
      console.log('[Updater] Overlay not found, but test mode confirmed working');
      alert(`Тестовый режим работает!\n\nСимуляция обновления до версии ${version}\n\nВ production mode здесь появится красивое окно обновления.`);
    }
  },

  updateDownloadProgress(data) {
    if (!this.overlay || !this.progressBar) return;

    const percent = Math.min(Math.round((data.transferred / data.total) * 100), 100);
    this.downloadProgress = percent;

    // Calculate speed
    const now = Date.now();
    if (this.lastSpeedCheckTime && now - this.lastSpeedCheckTime >= 500) {
      const bytesDifference = data.transferred - this.lastDownloadedBytes;
      const timeDifference = (now - this.lastSpeedCheckTime) / 1000; // seconds
      this.downloadSpeed = (bytesDifference / timeDifference) / (1024 * 1024); // MB/s
      this.lastDownloadedBytes = data.transferred;
      this.lastSpeedCheckTime = now;
    } else if (!this.lastSpeedCheckTime) {
      this.lastSpeedCheckTime = now;
      this.lastDownloadedBytes = data.transferred;
    }

    // Update UI
    this.progressBar.style.width = `${percent}%`;
    this.percentDisplay.textContent = `${percent}%`;
    this.speedDisplay.textContent = `${this.downloadSpeed.toFixed(1)} MB/s`;

    // Show progress container when download starts
    if (this.progressContainer.style.display === 'none') {
      this.progressContainer.style.display = 'block';
      this.downloadBtn.style.display = 'none';
    }

    // Keep overlay visible during download
    if (this.overlay.style.display === 'none') {
      this.showOverlay();
    }
  },

  requestDownload() {
    if (window.electronAPI?.downloadUpdate) {
      this.downloadBtn.disabled = true;
      this.downloadBtn.textContent = 'Загружается...';
      window.electronAPI.downloadUpdate();
    }
  },

  requestInstall() {
    if (window.electronAPI?.installUpdate) {
      this.installBtn.disabled = true;
      this.installBtn.textContent = 'Установка...';
      window.electronAPI.installUpdate();
    }
  },

  showOverlay() {
    if (!this.overlay) return;
    this.overlay.style.display = 'flex';
    // Prevent scrolling
    document.body.style.overflow = 'hidden';
  },

  closeOverlay() {
    if (!this.overlay) return;
    // Only close if download hasn't started
    if (this.progressContainer.style.display === 'none') {
      this.overlay.style.display = 'none';
      document.body.style.overflow = '';
    }
  },

  showNotificationBadge() {
    if (!this.notificationBadge) return;
    this.notificationBadge.style.display = 'flex';
  },

  hideNotificationBadge() {
    if (!this.notificationBadge) return;
    this.notificationBadge.style.display = 'none';
  }
};

// Make available for debug/test actions
window.UpdateManager = UpdateManager;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    UpdateManager.init();
  });
} else {
  UpdateManager.init();
}

// ============ LEGACY CODE (kept for compatibility) ============
const updaterAPI = window.electronAPI;
if (!updaterAPI) {
  console.warn('[UI] electronAPI not available; updater disabled');
}

class LegacyUpdateManager {
  constructor() {
    this.updateAvailable = false;
    this.downloadProgress = 0;
    this.isDownloading = false;
    this.updateInfo = null;
  }

  updateProgressBar(progress) {
    const progressBar = document.getElementById('update-progress-bar');
    const fill = progressBar?.querySelector('.progress-fill');
    const btn = document.getElementById('update-btn');

    if (progressBar) progressBar.style.display = 'block';
    if (fill) fill.style.width = progress.percent + '%';

    if (btn) {
      btn.disabled = true;
      btn.textContent = `Загрузка ${progress.percent}%`;
    }
  }

  showReadyToInstall() {
    const notification = document.getElementById('update-notification');
    if (notification) {
      const content = notification.querySelector('.update-content');
      const header = notification.querySelector('.update-header');
      const actions = notification.querySelector('.update-actions');

      header.innerHTML = `
        <div class="update-icon success">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/>
          </svg>
        </div>
        <div class="update-text">
          <div class="update-title">Обновление готово</div>
          <div class="update-version">Нажмите, чтобы установить</div>
        </div>
        <button class="close-notification" onclick="updateManager.closeNotification()">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      `;

      actions.innerHTML = `
        <button class="btn-secondary" onclick="updateManager.closeNotification()">Позже</button>
        <button class="btn-primary update-install" onclick="updateManager.installUpdate()">
          Установить и перезагрузить
        </button>
      `;

      notification.classList.add('ready');
    }
  }

  showUpdateError(error) {
    const notification = document.getElementById('update-notification');
    if (notification) notification.remove();

    const errorNotif = document.createElement('div');
    errorNotif.className = 'update-notification error';
    errorNotif.innerHTML = `
      <div class="update-content">
        <div class="update-header">
          <div class="update-icon error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2v2m0-4h-2V7h2v6z" fill="currentColor"/>
            </svg>
          </div>
          <div class="update-text">
            <div class="update-title">Ошибка при проверке обновлений</div>
            <div class="update-version">${error}</div>
          </div>
          <button class="close-notification" onclick="document.getElementById('error-notif').remove()">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    errorNotif.id = 'error-notif';

    document.body.appendChild(errorNotif);
    this.animateNotification(errorNotif);

    setTimeout(() => errorNotif.remove(), 5000);
  }

  animateNotification(element) {
    element.style.animation = 'slideInRight 0.3s ease-out';
  }

  startUpdate() {
    console.log('[UI] Начинаем загрузку обновления...');
    if (!updaterAPI) return;
    this.showOverlayProgressState();
    updaterAPI.downloadUpdate();
  }

  installUpdate() {
    console.log('[UI] Установка обновления...');
    if (!updaterAPI) return;
    updaterAPI.installUpdate();
  }

  closeNotification() {
    const notification = document.getElementById('update-notification');
    if (notification) {
      notification.style.animation = 'slideOutRight 0.3s ease-in';
      setTimeout(() => notification.remove(), 300);
    }
  }

  checkForUpdates() {
    console.log('[UI] Проверка обновлений...');
    if (!updaterAPI) return;
    updaterAPI.checkForUpdates();
  }

  showOverlayProgressState() {
    const overlay = document.getElementById('update-overlay');
    if (!overlay) return;
    const progress = overlay.querySelector('.update-overlay-progress');
    const status = document.getElementById('update-overlay-status');
    const actions = overlay.querySelector('.update-overlay-actions');
    if (progress) progress.style.display = 'block';
    if (status) {
      status.style.display = 'block';
      status.textContent = 'Подготовка...';
    }
    if (actions) {
      actions.innerHTML = `
        <button class="btn-secondary" id="update-overlay-later">Свернуть</button>
      `;
      document.getElementById('update-overlay-later')?.addEventListener('click', () => overlay.remove());
    }
  }

  updateOverlayProgress(progress) {
    const overlay = document.getElementById('update-overlay');
    if (!overlay) return;
    const fill = overlay.querySelector('.update-overlay-progress-fill');
    const status = document.getElementById('update-overlay-status');
    if (fill) fill.style.width = `${progress.percent}%`;
    if (status) status.textContent = `Загрузка ${Math.round(progress.percent)}%`;
  }

  showOverlayReady() {
    const overlay = document.getElementById('update-overlay');
    if (!overlay) return;
    const status = document.getElementById('update-overlay-status');
    if (status) status.textContent = 'Обновление готово к установке';
    const actions = overlay.querySelector('.update-overlay-actions');
    if (actions) {
      actions.innerHTML = `
        <button class="btn-secondary" id="update-overlay-later">Позже</button>
        <button class="btn-primary update-install" id="update-overlay-install">Установить</button>
      `;
      document.getElementById('update-overlay-later')?.addEventListener('click', () => overlay.remove());
      document.getElementById('update-overlay-install')?.addEventListener('click', () => this.installUpdate());
    }
  }

  showOverlayError(error) {
    const overlay = document.getElementById('update-overlay');
    if (!overlay) return;
    const status = document.getElementById('update-overlay-status');
    if (status) status.textContent = `Ошибка: ${error}`;
  }
}

// Создаём глобальный экземпляр (legacy)
const updateManager = new LegacyUpdateManager();

// Проверяем обновления при запуске приложения
document.addEventListener('DOMContentLoaded', () => {
  // Проверяем через 2 секунды после загрузки
  setTimeout(() => {
    updateManager.checkForUpdates();
  }, 2000);
});
