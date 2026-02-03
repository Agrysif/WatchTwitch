// Main app initialization
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize title bar controls
  document.getElementById('minimize-btn').addEventListener('click', () => {
    window.electronAPI.minimizeWindow();
  });

  document.getElementById('maximize-btn').addEventListener('click', () => {
    window.electronAPI.maximizeWindow();
  });

  document.getElementById('close-btn').addEventListener('click', () => {
    window.electronAPI.closeWindow();
  });

  // Обработчик закрытия приложения - останавливаем сессию
  window.electronAPI.onAppClosing(() => {
    console.log('[App] Application closing, stopping farming session...');
    if (window.farmingPage) {
      window.farmingPage.stopFarming(false); // false = не показывать toast
    }
  });

  // Обработчик навигации из трея
  if (window.electronAPI.onNavigateToPage) {
    window.electronAPI.onNavigateToPage((page) => {
      console.log('[App] Navigate to page from tray:', page);
      if (window.router) {
        window.router.navigate(page);
      }
    });
  }

  // Initialize router
  window.router = new Router();

  // Apply saved theme
  const settings = await Storage.getSettings();
  document.body.className = `theme-${settings.theme}`;

  // Load saved accounts
  const savedAccounts = await window.auth.loadSavedAccounts();
  
  // Check if user is logged in
  if (savedAccounts.length === 0) {
    // Show login prompt after a delay
    setTimeout(() => {
      router.navigate('accounts');
      window.utils.showToast('Please add an account to start farming', 'info');
    }, 1000);
  } else {
    // Show welcome message
    window.utils.showToast(`Welcome back, ${savedAccounts[0].username}!`, 'success');
  }

  // Auto-update watch time every minute
  setInterval(async () => {
    if (window.streamingManager && window.streamingManager.isFarmingActive()) {
      const stats = await Storage.getStatistics();
      // UI will be updated by streaming manager
    }
  }, 60000);

  // Safety: bind sidebar farming controls even if page init failed
  const startBtn = document.getElementById('sidebar-start-farming-btn');
  const stopBtn = document.getElementById('sidebar-stop-farming-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      console.log('[App] Sidebar start clicked');
      if (!window.farmingPage && window.FarmingPage) {
        window.farmingPage = new FarmingPage();
      }
      window.farmingPage?.startFarming();
    });
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      console.log('[App] Sidebar stop clicked');
      window.farmingPage?.stopFarming();
    });
  }
});

// Global utility functions
window.utils = {
  formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    if (days > 0) {
      return `${days}${i18n.t('statistics.days')} ${remainingHours}${i18n.t('statistics.hours')}`;
    }
    if (hours > 0) {
      return `${hours}${i18n.t('statistics.hours')} ${mins}min`;
    }
    return `${mins}min`;
  },

  formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  showToast(message, type = 'info') {
    // Создаём контейнер для toast если его еще нет
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    toastContainer.appendChild(toast);
    
    // Анимация появления
    setTimeout(() => {
      toast.classList.add('toast-show');
    }, 10);
    
    // Удаление через 3 секунды
    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => {
        if (toast.parentNode) {
          toastContainer.removeChild(toast);
        }
        // Удаляем контейнер если пустой
        if (toastContainer.children.length === 0) {
          document.body.removeChild(toastContainer);
        }
      }, 300);
    }, 3000);
  },

  showConfirmation(title, message = '') {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.id = 'confirmation-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
      `;

      modal.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: 12px; padding: 24px; max-width: 400px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); border: 1px solid var(--border-color);">
          <h2 style="color: var(--text-primary); margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">${title}</h2>
          ${message ? `<p style="color: var(--text-secondary); margin: 0 0 20px 0; font-size: 14px;">${message}</p>` : ''}
          <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button class="btn btn-secondary" id="confirm-cancel" style="min-width: 100px;">Отмена</button>
            <button class="btn btn-primary" id="confirm-ok" style="min-width: 100px;">Подтвердить</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      document.getElementById('confirm-ok').addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve(true);
      });

      document.getElementById('confirm-cancel').addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve(false);
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
          resolve(false);
        }
      });
    });
  },

  showCustomConfirmation(contentHtml, options = {}) {
    return new Promise((resolve) => {
      const {
        confirmText = 'Подтвердить',
        cancelText = 'Отмена',
        confirmClass = 'btn-primary'
      } = options;

      const modal = document.createElement('div');
      modal.id = 'confirmation-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
        backdrop-filter: blur(4px);
      `;

      modal.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: 16px; padding: 32px; max-width: 440px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); border: 1px solid var(--border-color); animation: modalSlideIn 0.3s ease;">
          ${contentHtml}
          <div style="display: flex; gap: 12px; justify-content: center; margin-top: 24px;">
            <button class="btn btn-secondary" id="confirm-cancel" style="flex: 1; max-width: 160px; padding: 12px 24px; font-size: 15px; font-weight: 600; border-radius: 10px; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; text-align: center;">${cancelText}</button>
            <button class="btn ${confirmClass}" id="confirm-ok" style="flex: 1; max-width: 160px; padding: 12px 24px; font-size: 15px; font-weight: 600; border-radius: 10px; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; text-align: center;">${confirmText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      document.getElementById('confirm-ok').addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve(true);
      });

      document.getElementById('confirm-cancel').addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve(false);
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
          resolve(false);
        }
      });
    });
  }
};

// Add toast styles
const style = document.createElement('style');
style.textContent = `
  .toast-container {
    position: fixed;
    top: 60px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
  }

  .toast {
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    opacity: 0;
    transform: translateX(400px);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: auto;
    max-width: 350px;
    word-wrap: break-word;
  }

  .toast-show {
    opacity: 1;
    transform: translateX(0);
  }
  
  .toast-info {
    background: var(--accent-color);
  }
  
  .toast-success {
    background: var(--success-color);
  }
  
  .toast-error {
    background: var(--error-color);
  }
  
  .toast-warning {
    background: var(--warning-color);
  }

  .auth-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
  }

  .auth-modal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
  }

  .auth-modal-content {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--card-bg);
    border-radius: 12px;
    border: 1px solid var(--border-color);
    overflow: hidden;
  }

  .auth-modal-header {
    padding: 20px;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .auth-modal-header h3 {
    margin: 0;
    color: var(--text-primary);
  }

  .close-modal {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-modal:hover {
    color: var(--text-primary);
  }

  .auth-modal-body {
    padding: 20px;
  }

  .shutdown-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
  }

  .modal-content {
    position: relative;
    background: var(--card-bg);
    padding: 32px;
    border-radius: 16px;
    border: 1px solid var(--border-color);
    text-align: center;
    min-width: 400px;
  }

  .modal-content h3 {
    color: var(--text-primary);
    margin-bottom: 16px;
    font-size: 24px;
  }

  .modal-content p {
    color: var(--text-secondary);
    margin-bottom: 24px;
    font-size: 16px;
  }

  .modal-content #countdown {
    color: var(--error-color);
    font-weight: 700;
    font-size: 20px;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
`;
document.head.appendChild(style);
