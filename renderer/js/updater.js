/**
 * UpdateManager - Управление обновлениями
 * Простая и надежная реализация как в v1.0.6
 */

class UpdateManager {
  constructor() {
    console.log('[Updater] UpdateManager created');
    this.updateAvailable = false;
    this.downloadProgress = 0;
    this.isDownloading = false;
    this.updateInfo = null;
    this.setupListeners();
  }

  setupListeners() {
    // Доступно обновление
    if (window.electronAPI) {
      window.electronAPI.onUpdateAvailable?.((info) => {
        console.log('[Updater] Update available:', info.version);
        this.updateAvailable = true;
        this.updateInfo = info;
        this.showUpdateNotification(info);
      });

      // Прогресс загрузки
      window.electronAPI.onUpdateProgress?.((progress) => {
        console.log('[Updater] Download progress:', progress.percent);
        this.downloadProgress = progress.percent;
        this.isDownloading = true;
        this.updateProgressBar(progress);
      });

      // Обновление загружено
      window.electronAPI.onUpdateDownloaded?.(() => {
        console.log('[Updater] Update downloaded');
        this.isDownloading = false;
        this.showReadyToInstall();
      });

      // Ошибка при обновлении
      window.electronAPI.onUpdateError?.((error) => {
        console.error('[Updater] Update error:', error);
        this.showUpdateError(error);
      });
    }
  }

  showUpdateNotification(info) {
    // Удаляем старое уведомление если есть
    const existing = document.getElementById('update-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'update-notification';
    notification.className = 'update-notification';
    notification.innerHTML = `
      <div class="update-content">
        <div class="update-header">
          <div class="update-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m3.5-9H13V7h-2v4H8.5l3.5 3.5 3.5-3.5z" fill="currentColor"/>
            </svg>
          </div>
          <div class="update-text">
            <div class="update-title">Доступно обновление</div>
            <div class="update-version">Версия ${info.version}</div>
          </div>
          <button class="close-notification" onclick="updateManager.closeNotification()">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="update-progress" style="display: none;" id="update-progress-bar">
          <div class="progress-fill"></div>
        </div>
        <div class="update-actions">
          <button class="btn-secondary" onclick="updateManager.closeNotification()">Позже</button>
          <button class="btn-primary" onclick="updateManager.startUpdate()" id="update-btn">
            Обновить
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(notification);
    this.animateNotification(notification);
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
          Установить и перезагрузиться
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
    errorNotif.id = 'error-notif';
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

    document.body.appendChild(errorNotif);
    this.animateNotification(errorNotif);

    setTimeout(() => errorNotif.remove(), 5000);
  }

  animateNotification(element) {
    element.style.animation = 'slideInRight 0.3s ease-out';
  }

  startUpdate() {
    console.log('[Updater] Starting download...');
    if (window.electronAPI?.downloadUpdate) {
      window.electronAPI.downloadUpdate();
    }
  }

  installUpdate() {
    console.log('[Updater] Installing update...');
    if (window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate();
    }
  }

  closeNotification() {
    const notification = document.getElementById('update-notification');
    if (notification) {
      notification.style.animation = 'slideOutRight 0.3s ease-in';
      setTimeout(() => notification.remove(), 300);
    }
  }

  checkForUpdates() {
    console.log('[Updater] Checking for updates...');
    if (window.electronAPI?.checkForUpdates) {
      window.electronAPI.checkForUpdates();
    }
  }
}

// Создаём глобальный экземпляр СРАЗУ
const updateManager = new UpdateManager();

// Проверяем обновления при запуске приложения
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Updater] DOMContentLoaded - checking for updates');
  setTimeout(() => {
    updateManager.checkForUpdates();
  }, 2000);
});
