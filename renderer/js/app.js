// Main app initialization
document.addEventListener('DOMContentLoaded', async () => {
  const registerWebviewLabel = (id, label) => {
    const webview = document.getElementById(id);
    if (!webview || webview.dataset.processLabelSet === 'true') return;

    const setLabel = () => {
      try {
        const webContentsId = webview.getWebContentsId?.();
        if (!webContentsId) return;
        window.electronAPI.setProcessLabel({ webContentsId, label });
        webview.dataset.processLabelSet = 'true';
      } catch (error) {
        console.warn('[Diagnostics] Failed to set process label for', id, error);
      }
    };

    webview.addEventListener('dom-ready', setLabel, { once: true });
    setTimeout(setLabel, 0);
  };

  try {
    window.electronAPI.setProcessLabel({ label: 'Main Renderer' });
  } catch (error) {
    console.warn('[Diagnostics] Failed to set main process label', error);
  }

  // Плеер теперь один на всё приложение (см. core/player-manager.js)
  registerWebviewLabel('twitch-player', 'Twitch Player');

  // Preload paths are now set automatically via will-attach-webview event in main process
  // This ensures preload is applied BEFORE webview loads any content
  
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
      window.farmingPage.stopFarming(false, true); // preserve active session for auto-start
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

  // Окно «что нового» после обновления. С задержкой, чтобы не перебивать
  // запуск приложения и дать настройкам загрузиться.
  setTimeout(() => {
    window.whatsNew?.checkAfterUpdate().catch(e =>
      console.warn('[Что нового] Проверка не удалась:', e?.message));
  }, 4000);

  // Слежение за избранными каналами: работает независимо от фарминга,
  // поэтому запускается один раз при старте приложения
  window.favouritesWatch?.start();

  // Горячие клавиши работают поверх других окон, поэтому обрабатываются
  // здесь, а не на странице: страница фарминга может быть не открыта
  window.electronAPI?.onShortcut?.((action) => {
    console.log('[Клавиши] Действие:', action);

    if (!window.farmingPage && window.FarmingPage) {
      window.farmingPage = new FarmingPage();
    }

    if (action === 'toggle-farming') {
      const идёт = !!window.farmingPage?.sessionStartTime;
      if (идёт) window.farmingPage.stopFarming();
      else window.farmingPage?.startFarming();
      return;
    }

    if (action === 'next-stream') {
      if (!window.farmingPage?.sessionStartTime) {
        window.utils?.showToast('Фарминг не запущен', 'info');
        return;
      }
      window.farmingPage.switchToNextStream?.();
    }
  });

  // Settings manager is already initialized in settings-manager.js
  // Just ensure it exists
  if (!window.settings) {
    console.error('Settings manager not initialized!');
  }

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
    // Настройка «Toast уведомления» до этого момента ни на что не влияла:
    // её сохраняли, но никто не читал.
    // Ошибки показываем всегда — молча терять их нельзя.
    if (type !== 'error' && window.settings && window.settings.get('toastNotifications') === false) {
      return;
    }

    // Создаём контейнер для toast если его еще нет
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    // Реестр показанных уведомлений: одинаковое сообщение не должно
    // складываться в стопку. Если такое уже висит на экране — продлеваем ему
    // жизнь вместо создания копии. Это страхует от любых повторных вызовов,
    // а не только от тех, что уже найдены и исправлены по месту.
    if (!window._toastRegistry) window._toastRegistry = new Map();
    const registry = window._toastRegistry;
    const key = type + '|' + message;

    const scheduleRemoval = (entry) => {
      clearTimeout(entry.hideTimer);
      clearTimeout(entry.removeTimer);

      // Перезапуск анимации полосы: иначе продлённое уведомление
      // исчезло бы при полосе, досчитавшей до конца ещё в прошлый раз
      const progress = entry.el.querySelector('.toast-progress');
      if (progress) {
        progress.style.animation = 'none';
        void progress.offsetWidth;
        progress.style.animation = '';
      }

      entry.hideTimer = setTimeout(() => {
        entry.el.classList.remove('toast-show');
        entry.removeTimer = setTimeout(() => {
          if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
          registry.delete(key);
          const container = document.getElementById('toast-container');
          if (container && container.children.length === 0 && container.parentNode) {
            container.parentNode.removeChild(container);
          }
        }, 300);
      }, 3000);
    };

    const existing = registry.get(key);
    if (existing && existing.el.isConnected) {
      existing.count += 1;
      const counter = existing.el.querySelector('.toast-count');
      if (counter) {
        counter.textContent = '×' + existing.count;
        counter.style.display = 'inline-block';
      }
      scheduleRemoval(existing);
      return;
    }

    // Иконки для разных типов
    const icons = {
      info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-message">${message}</div>
      <span class="toast-count" style="display: none;"></span>
      <div class="toast-progress"></div>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-show');
    }, 10);

    const entry = { el: toast, count: 1, hideTimer: null, removeTimer: null };
    registry.set(key, entry);
    scheduleRemoval(entry);
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
        <div style="background: var(--bg-primary); border-radius: var(--radius-md); padding: 24px; max-width: 400px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); border: 1px solid var(--border-color);">
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
        <div style="background: var(--bg-primary); border-radius: var(--radius-md); padding: 32px; max-width: 440px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); border: 1px solid var(--border-color); animation: modalSlideIn 0.3s ease;">
          ${contentHtml}
          <div style="display: flex; gap: 12px; justify-content: center; margin-top: 24px;">
            <button class="btn btn-secondary" id="confirm-cancel" style="flex: 1; max-width: 160px; padding: 12px 24px; font-size: 15px; font-weight: 600; border-radius: var(--radius-md); transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; text-align: center;">${cancelText}</button>
            <button class="btn ${confirmClass}" id="confirm-ok" style="flex: 1; max-width: 160px; padding: 12px 24px; font-size: 15px; font-weight: 600; border-radius: var(--radius-md); transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; text-align: center;">${confirmText}</button>
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
    gap: 12px;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    padding-bottom: 10px;
    border-radius: var(--radius-md);
    color: white;
    font-weight: 500;
    font-size: 14px;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 2px 8px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    opacity: 0;
    transform: translateX(400px) scale(0.95);
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    pointer-events: auto;
    max-width: 380px;
    min-width: 280px;
    word-wrap: break-word;
    position: relative;
    overflow: hidden;
    flex-wrap: wrap;
  }

  .toast::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: rgba(255,255,255,0.4);
  }

  .toast-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 3px;
    width: 100%;
    background: rgba(255, 255, 255, 0.3);
    transform-origin: left;
    animation: toastProgress 3s linear forwards;
  }

  @keyframes toastProgress {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }

  .toast-show {
    opacity: 1;
    transform: translateX(0) scale(1);
  }

  .toast-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.15);
  }

  .toast-message {
    flex: 1;
    line-height: 1.4;
  }

  /* Счётчик повторов: показывается, когда одно и то же сообщение
     пришло несколько раз подряд — вместо стопки одинаковых плашек */
  .toast-count {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.22);
  }
  
  .toast-info {
    background: rgba(124, 92, 255, 0.95);
    border-color: rgba(124, 92, 255, 0.4);
  }

  .toast-info .toast-icon {
    background: rgba(255, 255, 255, 0.2);
  }
  
  .toast-success {
    background: rgba(53, 208, 138, 0.95);
    border-color: rgba(53, 208, 138, 0.4);
  }

  .toast-success .toast-icon {
    background: rgba(255, 255, 255, 0.2);
  }
  
  .toast-error {
    background: rgba(240, 85, 95, 0.95);
    border-color: rgba(240, 85, 95, 0.4);
  }

  .toast-error .toast-icon {
    background: rgba(255, 255, 255, 0.2);
  }
  
  .toast-warning {
    background: rgba(240, 168, 60, 0.95);
    border-color: rgba(240, 168, 60, 0.4);
  }

  .toast-warning .toast-icon {
    background: rgba(255, 255, 255, 0.2);
  }

  .auth-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
  }

  .auth-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 9999;
  }

  .auth-modal-content {
    position: relative;
    z-index: 10001;
    background: var(--card-bg);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    overflow: hidden;
    max-width: 500px;
    max-height: 85vh;
    width: 100%;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .auth-modal-header {
    padding: 20px;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
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
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .close-modal:hover {
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .auth-modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .auth-modal-body::-webkit-scrollbar {
    width: 6px;
  }

  .auth-modal-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .auth-modal-body::-webkit-scrollbar-thumb {
    background: rgba(124, 92, 255, 0.3);
    border-radius: var(--radius-sm);
  }

  .auth-modal-body::-webkit-scrollbar-thumb:hover {
    background: rgba(124, 92, 255, 0.5);
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
    border-radius: var(--radius-md);
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
