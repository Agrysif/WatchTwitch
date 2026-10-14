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

  // Закрытие приложения обрабатывает только страница фарминга (её
  // подписка на app-closing — одна на всё приложение). Здесь раньше был
  // второй обработчик: он срабатывал первым и останавливал фарминг сам,
  // поэтому сохранение на странице фарминга и её ответ главному процессу
  // не выполнялись

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

  // Экран повторного входа: cookie Twitch может пропасть, и без него
  // минуты не идут. Значок в сайдбаре ведёт на вкладку аккаунтов
  window.loginGuard?.start();
  document.getElementById('login-badge')?.addEventListener('click', async () => {
    // Окну входа нужен аккаунт, к которому привязать вход. Без него окно
    // не находило, кого отметить вошедшим, и не закрывалось даже после
    // успешного входа. Фарминг работает под первым аккаунтом — его и берём
    let account;
    try {
      account = (await Storage.getAccounts())?.[0];
    } catch (e) {
      console.warn('[Вход] Не удалось прочитать аккаунты:', e?.message);
    }
    window.loginGuard?.openLogin(account);
  });

  // Необработанная ошибка в главном процессе раньше видна была только в
  // логе, и фарминг мог тихо встать. Сообщаем коротко и не чаще раза в
  // минуту, чтобы серия одинаковых сбоев не завалила экран тостами
  let lastMainErrorToastAt = 0;
  window.electronAPI?.onMainProcessError?.((message) => {
    console.warn('[Главный процесс] Ошибка:', message);
    const now = Date.now();
    if (now - lastMainErrorToastAt < 60 * 1000) return;
    lastMainErrorToastAt = now;
    window.utils?.showToast('Внутренняя ошибка, подробности в логе', 'error');
  });

  // Игровой режим: main следит за процессами, здесь — плеер и значок
  const applyGameMode = (state, announce) => {
    if (!state) return;
    // Стрим проверяем до переключения: плеер на время перезагрузки
    // канала на миг остаётся без него
    const streaming = !!window.playerManager?.hasStream?.();
    window.playerManager?.setGameMode?.(state.active);

    const badge = document.getElementById('game-mode-badge');
    const text = document.getElementById('game-mode-text');
    if (badge && text) {
      badge.hidden = !state.active;
      text.textContent = state.active ? 'Игровой режим: ' + (state.game?.title || 'игра запущена') : '';
    }

    // Тост говорит о качестве стрима, поэтому без стрима он лишний: игру
    // запускали и закрывали, пока ничего не фармилось, а тост всё равно
    // всплывал. Значок выше обновляется всегда
    if (announce && streaming) {
      window.utils?.showToast(state.active
        ? 'Запущена ' + (state.game?.title || 'игра') + ': стрим на минимуме, чтобы не мешать'
        : 'Игра закрыта: качество и скорость стрима возвращены', 'info');
    }
  };
  window.electronAPI?.getGameMode?.().then(state => applyGameMode(state, false)).catch(() => {});
  window.electronAPI?.onGameMode?.((state) => applyGameMode(state, true));

  // Сундук забран запросом из main-процесса: показываем и отмечаем
  window.electronAPI?.onChestClaimed?.((data) => {
    const points = Number(data?.points) || 0;
    window.utils?.showToast(points > 0 ? 'Сундук собран: +' + points + ' баллов' : 'Сундук собран', 'success');
    window.sessionState?.noteChest?.(points);
  });

  // Горячие клавиши работают поверх других окон, поэтому обрабатываются
  // здесь, а не на странице: страница фарминга может быть не открыта
  window.electronAPI?.onShortcut?.((action) => {
    console.log('[Клавиши] Действие:', action);
    // Горячая клавиша — тоже действие пользователя: ответы на неё
    // показываются и при выключенных всплывающих сообщениях
    window.utils?.noteUserAction?.();

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
  // Сбой чтения аккаунтов не должен оборвать запуск: ниже привязаны
  // кнопки «Старт/Стоп» в сайдбаре, и других обработчиков у них нет.
  // Список не прочитан — это не «аккаунтов нет», на вкладку не ведём
  let savedAccounts = null;
  try {
    savedAccounts = await window.auth.loadSavedAccounts();
  } catch (error) {
    console.error('[App] Не удалось прочитать аккаунты:', error);
  }

  // Без аккаунта сразу ведём на вкладку аккаунтов. Тост не нужен: там
  // написано «Нет добавленных аккаунтов», а фарминг при автозапуске сам
  // говорит «Добавьте хотя бы один аккаунт». Прежний английский тост
  // дублировал это. Приветствие при каждом запуске (в том числе при
  // автозапуске Windows) тоже убрано: оно ничего не сообщало
  if (Array.isArray(savedAccounts) && savedAccounts.length === 0) {
    setTimeout(() => {
      router.navigate('accounts');
    }, 1000);
  }

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
    // Единица минут из словаря: раньше тут было английское «min»
    if (hours > 0) {
      return `${hours}${i18n.t('statistics.hours')} ${mins} ${i18n.t('common.min')}`;
    }
    return `${mins} ${i18n.t('common.min')}`;
  },

  // Короткие ссылки на общие хелперы из dom-helpers.js, чтобы страницы
  // могли звать их так же, как остальные утилиты
  escapeHtml(text) {
    return window.escapeHtml(text);
  },

  plural(n, one, few, many) {
    return window.DOMHelpers.plural(n, one, few, many);
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

  // Отметка последнего действия пользователя (клик, клавиша, горячая
  // клавиша). По ней showToast отличает ответ на действие от фоновой
  // новости
  noteUserAction() {
    window._lastUserActionAt = Date.now();
  },

  /**
   * Тост — ответ на действие пользователя? Явный флаг в вызове или клик/
   * клавиша за последние 5 секунд (столько же Chromium считает жест
   * пользователя активным; за это время успевают ответить и запросы к
   * Twitch, которые идут после нажатия «Начать фарминг»).
   */
  isUserActionToast(options) {
    if (options && options.userAction === true) return true;
    const at = window._lastUserActionAt || 0;
    return Date.now() - at < 5000;
  },

  // Сколько держать тост: меньше трёх секунд не читается, а длинный текст
  // за три секунды не успеть прочесть. 60 мс на символ — обычная скорость
  // чтения; потолок, чтобы случайная простыня не висела минутами
  toastDuration(text) {
    return Math.min(15000, Math.max(3000, 60 * String(text ?? '').length));
  },

  showToast(message, type = 'info', options = {}) {
    // Выключенная настройка всплывающих сообщений глушит только фоновые
    // новости. Ответ на клик гасить нельзя: с выключенной настройкой
    // «Начать фарминг» без категорий не давал никакой реакции.
    // Ошибки показываем всегда — молча терять их нельзя.
    if (type !== 'error' && window.settings && window.settings.get('toastNotifications') === false &&
        !window.utils.isUserActionToast(options)) {
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
    const text = String(message ?? '');
    const key = type + '|' + text;

    // Больше трёх тостов разом никто не читает: при переборе категорий их
    // высыпалось по дюжине за пару секунд, и они закрывали экран
    const MAX_VISIBLE = 3;

    // Убрать тост с экрана. Вытесненный лимитом сразу выходит из реестра:
    // то же сообщение позже должно появиться заново, а не оживить
    // уходящую плашку
    const dismiss = (entry, evicted = false) => {
      clearTimeout(entry.hideTimer);
      clearTimeout(entry.removeTimer);
      entry.leaving = true;
      if (evicted && registry.get(entry.key) === entry) registry.delete(entry.key);
      entry.el.classList.remove('toast-show');
      entry.el.classList.add('toast-leaving');
      entry.removeTimer = setTimeout(() => {
        if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        if (registry.get(entry.key) === entry) registry.delete(entry.key);
        const container = document.getElementById('toast-container');
        if (container && container.children.length === 0 && container.parentNode) {
          container.parentNode.removeChild(container);
        }
      }, 300);
    };

    const scheduleRemoval = (entry) => {
      clearTimeout(entry.hideTimer);
      clearTimeout(entry.removeTimer);

      // Ошибка висит до клика: за три секунды её не успевали прочесть, а
      // повторить её нельзя
      if (entry.sticky) return;

      // Перезапуск анимации полосы: иначе продлённое уведомление
      // исчезло бы при полосе, досчитавшей до конца ещё в прошлый раз.
      // Длительность полосы совпадает со временем жизни тоста
      const progress = entry.el.querySelector('.toast-progress');
      if (progress) {
        progress.style.animation = 'none';
        void progress.offsetWidth;
        progress.style.animation = `toastProgress ${entry.duration}ms linear forwards`;
      }

      entry.hideTimer = setTimeout(() => dismiss(entry), entry.duration);
    };

    // Лишние сверх лимита уходят, начиная с самых старых. Ошибки держим
    // дольше остальных: их терять хуже, чем очередное «Переключение…».
    // Зовётся и для нового тоста, и для ожившего повтора: ожившая плашка
    // снова занимает место, и без проверки их становилось четыре
    const enforceLimit = (keep) => {
      const nodes = [...toastContainer.children];
      const visible = [...registry.values()]
        .filter(e => !e.leaving && e.el.parentNode === toastContainer)
        .sort((a, b) => nodes.indexOf(a.el) - nodes.indexOf(b.el));
      let extra = visible.length - MAX_VISIBLE;
      if (extra <= 0) return;
      const order = [
        ...visible.filter(e => e !== keep && !e.el.classList.contains('toast-error')),
        ...visible.filter(e => e !== keep && e.el.classList.contains('toast-error'))
      ];
      for (const old of order) {
        if (extra <= 0) break;
        dismiss(old, true);
        extra--;
      }
    };

    const existing = registry.get(key);
    if (existing && existing.el.isConnected) {
      existing.count += 1;
      const counter = existing.el.querySelector('.toast-count');
      if (counter) {
        counter.textContent = '×' + existing.count;
        counter.style.display = 'inline-block';
      }
      // Повтор мог прийти, когда плашка уже начала гаснуть, — возвращаем
      // её, иначе она висела бы невидимой ещё три секунды
      existing.leaving = false;
      existing.el.classList.remove('toast-leaving');
      existing.el.classList.add('toast-show');
      scheduleRemoval(existing);
      enforceLimit(existing);
      return;
    }

    // Иконки для разных типов
    const icons = {
      info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };

    const sticky = type === 'error';
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.title = 'Нажмите, чтобы закрыть';
    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-message"></div>
      <span class="toast-count" style="display: none;"></span>
      ${sticky
        ? `<button type="button" class="toast-close" aria-label="Закрыть"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`
        : '<div class="toast-progress"></div>'}
    `;
    // Текст — только как текст. В сообщения попадают названия категорий,
    // имена каналов и ответы Twitch; через innerHTML строка вида
    // <img onerror=…> исполнилась бы в окне с доступом к electronAPI
    toast.querySelector('.toast-message').textContent = text;

    toastContainer.appendChild(toast);

    const entry = {
      el: toast, key, count: 1, hideTimer: null, removeTimer: null, leaving: false,
      sticky, duration: window.utils.toastDuration(text)
    };

    // Любой тост закрывается щелчком; для ошибки это единственный способ
    toast.addEventListener('click', () => {
      if (!entry.leaving) dismiss(entry, true);
    });

    setTimeout(() => {
      // Тост мог быть вытеснен раньше, чем успел появиться
      if (!entry.leaving) toast.classList.add('toast-show');
    }, 10);

    registry.set(key, entry);
    scheduleRemoval(entry);
    enforceLimit(entry);
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

      // Заголовок и текст — обычные строки, не разметка: экранируем, чтобы
      // имя канала в вопросе не могло стать HTML
      modal.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: var(--radius-md); padding: 24px; max-width: 400px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); border: 1px solid var(--border-color);">
          <h2 style="color: var(--text-primary); margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">${window.escapeHtml(title)}</h2>
          ${message ? `<p style="color: var(--text-secondary); margin: 0 0 20px 0; font-size: 14px;">${window.escapeHtml(message)}</p>` : ''}
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

// Клики и клавиши в окне отмечаются заранее, в фазе перехвата: так
// отметка стоит раньше, чем обработчик кнопки успеет показать тост.
// Программный element.click() сюда не попадает — он не шлёт pointerdown
window.addEventListener('pointerdown', () => window.utils.noteUserAction(), true);
window.addEventListener('keydown', () => window.utils.noteUserAction(), true);

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
    cursor: pointer;
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

  /* Крестик у ошибки: она не гаснет сама и ждёт щелчка */
  .toast-close {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    opacity: 0.8;
    cursor: pointer;
  }

  .toast-close:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.18);
  }

  .toast-info {
    background: rgba(124, 92, 255, 0.95);
    border-color: rgba(124, 92, 255, 0.4);
  }

  .toast-info .toast-icon {
    background: rgba(255, 255, 255, 0.2);
  }
  
  /* На светлом зелёном и оранжевом белый текст давал контраст около
     2,2:1 и плохо читался. Тёмный текст на тех же цветах — около 9:1 */
  .toast-success {
    background: rgba(53, 208, 138, 0.95);
    border-color: rgba(53, 208, 138, 0.4);
    color: #0a0b0d;
  }

  .toast-success .toast-icon {
    background: rgba(10, 11, 13, 0.12);
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
    color: #0a0b0d;
  }

  .toast-warning .toast-icon {
    background: rgba(10, 11, 13, 0.12);
  }

  /* Полоса и счётчик на светлом фоне — тёмные, белые там не видны */
  .toast-success .toast-progress,
  .toast-warning .toast-progress {
    background: rgba(10, 11, 13, 0.25);
  }

  .toast-success .toast-count,
  .toast-warning .toast-count {
    background: rgba(10, 11, 13, 0.14);
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
