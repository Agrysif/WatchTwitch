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
    // Звук (chime.js) во время игры молчит, кроме «нужно внимание»: ему
    // нужно знать состояние, а спрашивать main на каждый сигнал незачем
    window.gameModeState = { active: !!state.active, game: state.game || null };
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
    // В журнал — каждое переключение: утром по нему видно, почему ночью
    // стрим шёл на минимальном качестве
    if (announce) {
      window.eventLog?.add({
        type: 'game-mode',
        title: state.active ? 'Игровой режим включён' : 'Игровой режим выключен',
        detail: state.active
          ? (state.game?.title || 'Запущена игра') + ' — стрим на минимальном качестве'
          : 'Качество стрима возвращено'
      });
    }
  };
  window.electronAPI?.getGameMode?.().then(state => applyGameMode(state, false)).catch(() => {});
  window.electronAPI?.onGameMode?.((state) => applyGameMode(state, true));

  // Сундук забран запросом из main-процесса: показываем и отмечаем
  window.electronAPI?.onChestClaimed?.((data) => {
    const points = Number(data?.points) || 0;
    window.utils?.showToast(points > 0 ? 'Сундук собран: +' + points + ' баллов' : 'Сундук собран', 'success');
    window.sessionState?.noteChest?.(points);
    window.eventLog?.add({ type: 'chest', title: 'Сундук собран', detail: data?.channel || '', points });
    window.chime?.play('chest');
  });

  // Системное уведомление при окне в фокусе: main его не показывает, а
  // присылает сюда — человек и так смотрит в окно, и всплывашка Windows
  // в углу экрана только дублировала бы то, что видно на странице
  window.electronAPI?.onInAppNotice?.((notice) => {
    const title = String(notice?.title || '').trim();
    const body = String(notice?.body || '').trim();
    if (!title && !body) return;
    const noticeAt = Date.now();
    // Небольшая пауза: страница, позвавшая уведомление, часто сразу
    // показывает и свой тост — тогда второй, о том же, не нужен
    setTimeout(() => {
      if (window.utils.hasRecentToast(noticeAt - 2000, [title, body])) return;
      const problem = /остановлен|не получен|не удалось|ошибк|нет входа|не засчит/i.test(title + ' ' + body);
      window.utils.showToast(body || title, problem ? 'warning' : 'info', {
        title: body ? title : undefined,
        // Пользователь включил уведомления об этих событиях; выключенные
        // всплывающие сообщения не должны их терять — системного
        // уведомления вместо тоста уже не будет
        force: true
      });
    }, 400);
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

  /**
   * Был ли тост с похожим текстом после момента since: в окне уже
   * сказано то же самое, повторять незачем. Сравнение грубое, по
   * вхождению: «Канал в эфире: Overwatch» содержит и «Overwatch».
   */
  hasRecentToast(since, texts = []) {
    const registry = window._toastRegistry;
    if (!registry) return false;
    const wanted = texts.map(t => String(t || '').toLowerCase().trim()).filter(t => t.length >= 6);
    for (const entry of registry.values()) {
      if (entry.leaving || entry.createdAt < since) continue;
      const shown = (entry.title + ' ' + entry.text).toLowerCase();
      if (!wanted.length || wanted.some(t => shown.includes(t))) return true;
      // Свой тост страница показала в тот же миг — значит, о событии уже
      // сказано, пусть и другими словами
      if (entry.createdAt >= since && entry.type !== 'info') return true;
    }
    return false;
  },

  /**
   * Короткое сообщение в правом нижнем углу.
   *
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} [type]
   * @param {object} [options]
   *   title      — жирная первая строка;
   *   action     — { label, onClick }: кнопка, после нажатия тост закрывается;
   *   duration   — сколько держать, мс (иначе — по длине текста);
   *   sticky     — не гаснуть самому (ошибки так ведут себя всегда);
   *   userAction — ответ на действие пользователя (см. isUserActionToast);
   *   force      — показать и при выключенных всплывающих сообщениях.
   */
  showToast(message, type = 'info', options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    if (!['info', 'success', 'warning', 'error'].includes(type)) type = 'info';

    // Выключенная настройка всплывающих сообщений глушит только фоновые
    // новости. Ответ на клик гасить нельзя: с выключенной настройкой
    // «Начать фарминг» без категорий не давал никакой реакции.
    // Ошибки показываем всегда — молча терять их нельзя.
    if (type !== 'error' && !opts.force && window.settings && window.settings.get('toastNotifications') === false &&
        !window.utils.isUserActionToast(opts)) {
      return;
    }

    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      toastContainer.setAttribute('role', 'region');
      toastContainer.setAttribute('aria-label', 'Уведомления');
      document.body.appendChild(toastContainer);
    }

    // Реестр показанных уведомлений: одинаковое сообщение не должно
    // складываться в стопку. Если такое уже висит на экране — продлеваем ему
    // жизнь вместо создания копии. Это страхует от любых повторных вызовов,
    // а не только от тех, что уже найдены и исправлены по месту.
    if (!window._toastRegistry) window._toastRegistry = new Map();
    const registry = window._toastRegistry;
    const text = String(message ?? '');
    const title = opts.title ? String(opts.title) : '';
    const key = type + '|' + title + '|' + text;

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
      }, 220);
    };

    // Часы тоста. Наведение ставит их на паузу вместе с полосой: тост с
    // длинным текстом раньше исчезал прямо из-под курсора
    const runTimer = (entry) => {
      clearTimeout(entry.hideTimer);
      if (entry.sticky || entry.paused || entry.leaving) return;
      entry.startedAt = Date.now();
      entry.hideTimer = setTimeout(() => dismiss(entry), entry.remaining);
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
        progress.style.animation = `toast-progress ${entry.duration}ms linear forwards`;
      }

      entry.remaining = entry.duration;
      runTimer(entry);
    };

    const pause = (entry) => {
      if (entry.sticky || entry.paused || entry.leaving) return;
      clearTimeout(entry.hideTimer);
      entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
      entry.paused = true;
      entry.el.classList.add('is-paused');
    };

    const resume = (entry) => {
      if (!entry.paused) return;
      entry.paused = false;
      entry.el.classList.remove('is-paused');
      // Ушёл курсор — дочитать последнюю строчку ещё успеваем
      entry.remaining = Math.max(entry.remaining, 1200);
      runTimer(entry);
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
        ...visible.filter(e => e !== keep && e.type !== 'error'),
        ...visible.filter(e => e !== keep && e.type === 'error')
      ];
      for (const old of order) {
        if (extra <= 0) break;
        dismiss(old, true);
        extra--;
      }
    };

    window._lastToastAt = Date.now();

    const existing = registry.get(key);
    if (existing && existing.el.isConnected) {
      existing.count += 1;
      existing.createdAt = Date.now();
      const counter = existing.el.querySelector('.toast-count');
      if (counter) {
        counter.textContent = '×' + existing.count;
        counter.hidden = false;
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

    const iconName = { info: 'info', success: 'check', warning: 'warning', error: 'error' }[type];
    const fallbackIcons = {
      info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
      warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
      error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>'
    };
    const iconSvg = window.Icons?.get?.(iconName, 16) || fallbackIcons[type];
    const closeSvg = window.Icons?.get?.('close', 14) ||
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    const sticky = opts.sticky === true || (type === 'error' && opts.sticky !== false);
    const action = opts.action && typeof opts.action.onClick === 'function' && opts.action.label
      ? opts.action : null;
    const duration = Number(opts.duration) > 0
      ? Math.min(60000, Number(opts.duration))
      : window.utils.toastDuration(title ? title + ' ' + text : text) + (action ? 3000 : 0);

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // Ошибки и предупреждения зачитываются сразу, остальное — в очередь
    toast.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
    toast.innerHTML = `
      <div class="toast-icon" aria-hidden="true">${iconSvg}</div>
      <div class="toast-body">
        ${title ? '<div class="toast-title"></div>' : ''}
        <div class="toast-message"></div>
        ${action ? '<button type="button" class="btn btn-ghost btn-sm toast-action"></button>' : ''}
      </div>
      <span class="badge toast-count" hidden></span>
      <button type="button" class="btn btn-ghost btn-icon btn-sm toast-close" title="Закрыть" aria-label="Закрыть">${closeSvg}</button>
      ${sticky ? '' : '<div class="toast-progress" aria-hidden="true"></div>'}
    `;
    // Текст — только как текст. В сообщения попадают названия категорий,
    // имена каналов и ответы Twitch; через innerHTML строка вида
    // <img onerror=…> исполнилась бы в окне с доступом к electronAPI
    toast.querySelector('.toast-message').textContent = text;
    if (title) toast.querySelector('.toast-title').textContent = title;
    if (action) toast.querySelector('.toast-action').textContent = String(action.label);

    toastContainer.appendChild(toast);

    const entry = {
      el: toast, key, type, title, text, count: 1, hideTimer: null, removeTimer: null, leaving: false,
      sticky, duration, remaining: duration, startedAt: Date.now(), paused: false, createdAt: Date.now()
    };

    // Любой тост закрывается щелчком; для ошибки это главный способ.
    // Кнопка действия тоже закрывает, но сначала делает своё
    toast.addEventListener('click', (e) => {
      if (entry.leaving) return;
      const actionBtn = e.target.closest?.('.toast-action');
      if (actionBtn) {
        e.stopPropagation();
        try {
          action.onClick();
        } catch (err) {
          console.warn('[Тост] Действие не выполнено:', err?.message);
        }
      }
      dismiss(entry, true);
    });
    toast.addEventListener('mouseenter', () => pause(entry));
    toast.addEventListener('mouseleave', () => resume(entry));
    toast.addEventListener('focusin', () => pause(entry));
    toast.addEventListener('focusout', (e) => {
      if (!toast.contains(e.relatedTarget)) resume(entry);
    });

    setTimeout(() => {
      // Тост мог быть вытеснен раньше, чем успел появиться
      if (!entry.leaving) toast.classList.add('toast-show');
    }, 10);

    registry.set(key, entry);
    scheduleRemoval(entry);
    enforceLimit(entry);
  },

  /**
   * Окно подтверждения на общих классах .dialog*.
   *
   * Поведение одинаковое для всех окон: Esc — отмена, Enter — подтвердить,
   * фокус сразу на кнопке подтверждения, после закрытия — обратно туда,
   * откуда открыли. Щелчок по фону отменяет, только если и нажали на фоне:
   * иначе выделение текста с отпусканием мыши снаружи закрывало окно.
   *
   * contentHtml — готовая разметка тела (её экранирует вызывающий).
   */
  openConfirmDialog({ titleText = '', messageText = '', contentHtml = '', confirmHtml, cancelHtml, confirmClass = 'btn-primary', size = 'sm' } = {}) {
    return new Promise((resolve) => {
      const esc = window.escapeHtml;
      // .btn-warning в наборе компонентов нет: «Выйти» и подобное — это
      // необратимое действие, и красная кнопка честнее безликой
      const cls = confirmClass === 'btn-warning' ? 'btn-danger' : (confirmClass || 'btn-primary');
      const custom = !!contentHtml;
      const returnFocus = document.activeElement;

      const modal = document.createElement('div');
      modal.id = 'confirmation-modal';
      modal.className = 'dialog-backdrop';
      modal.innerHTML = `
        <div class="dialog ${size === 'md' ? '' : 'dialog-' + size} confirm-dialog${custom ? ' is-custom' : ''}" role="alertdialog" aria-modal="true"
             ${titleText ? 'aria-labelledby="confirm-title"' : ''} ${messageText ? 'aria-describedby="confirm-text"' : ''}>
          ${titleText ? `
            <div class="dialog-head">
              <div><h2 class="dialog-title" id="confirm-title">${esc(titleText)}</h2></div>
            </div>` : ''}
          ${custom
            ? `<div class="dialog-body">${contentHtml}</div>`
            : (messageText ? `<div class="dialog-body"><p id="confirm-text">${esc(messageText)}</p></div>` : '')}
          <div class="dialog-foot">
            <button type="button" class="btn btn-secondary" id="confirm-cancel">${cancelHtml}</button>
            <button type="button" class="btn ${cls}" id="confirm-ok">${confirmHtml}</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      const okBtn = modal.querySelector('#confirm-ok');
      const cancelBtn = modal.querySelector('#confirm-cancel');

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        modal.remove();
        if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
          try { returnFocus.focus({ preventScroll: true }); } catch (e) { /* элемент ушёл */ }
        }
        resolve(value);
      };

      const onKey = (e) => {
        if (!modal.isConnected) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        } else if (e.key === 'Enter') {
          // Enter на кнопке нажимает её саму; в поле ввода — не подтверждение
          const t = e.target;
          if (t instanceof Element && (t.closest('button') || t.matches('textarea, input[type="text"], input[type="search"]'))) return;
          if (okBtn.disabled) return;
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Tab') {
          // Фокус не уходит за пределы окна: под фоном — вся страница
          const focusables = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(el => !el.disabled && el.offsetParent !== null);
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      // Фаза перехвата: окна ниже (журнал, «Что нового») не должны
      // получить тот же Esc и закрыться вместе с подтверждением
      document.addEventListener('keydown', onKey, true);

      okBtn.addEventListener('click', () => finish(true));
      cancelBtn.addEventListener('click', () => finish(false));

      let pressedOnBackdrop = false;
      modal.addEventListener('mousedown', (e) => { pressedOnBackdrop = e.target === modal; });
      modal.addEventListener('click', (e) => {
        if (pressedOnBackdrop && e.target === modal) finish(false);
        pressedOnBackdrop = false;
      });

      setTimeout(() => {
        if (!settled) okBtn.focus({ preventScroll: true });
      }, 0);
    });
  },

  /**
   * Вопрос с двумя кнопками. title и message — обычные строки (экранируются).
   * options: confirmText, cancelText, confirmClass ('btn-danger' для
   * опасного — тогда и подпись нужна глаголом: «Удалить», «Очистить»).
   */
  showConfirmation(title, message = '', options = {}) {
    const esc = window.escapeHtml;
    const {
      confirmText = 'Подтвердить',
      cancelText = 'Отмена',
      confirmClass = 'btn-primary'
    } = options || {};
    return window.utils.openConfirmDialog({
      titleText: title,
      messageText: message,
      confirmHtml: esc(confirmText),
      cancelHtml: esc(cancelText),
      confirmClass
    });
  },

  /**
   * Подтверждение со своей разметкой. contentHtml и подписи кнопок —
   * готовая разметка: их экранирует вызывающий (так было и раньше).
   */
  showCustomConfirmation(contentHtml, options = {}) {
    const {
      confirmText = 'Подтвердить',
      cancelText = 'Отмена',
      confirmClass = 'btn-primary'
    } = options || {};
    return window.utils.openConfirmDialog({
      contentHtml: String(contentHtml ?? ''),
      confirmHtml: confirmText,
      cancelHtml: cancelText,
      confirmClass,
      size: 'md'
    });
  },

  /**
   * Проверка окна о награде из настроек. Показывает окно всегда — это
   * явное действие, — и честно говорит, если настоящие уведомления сейчас
   * не всплывут: иначе проверка выглядела бы работающей, а ночью окна не было.
   */
  testDropNotification() {
    const api = window.electronAPI;
    if (!api?.showDropNotification) {
      window.utils.showToast('Окно уведомлений недоступно', 'error');
      return false;
    }
    api.showDropNotification('Так будет выглядеть награда', 'WatchTwitch', null, { kind: 'test' });

    const s = window.settings;
    let note = '';
    if (s && (s.get('systemNotifications') === false || s.get('notifications') === false)) {
      note = 'Уведомления Windows сейчас выключены — окно показано только для проверки';
    } else if (s && s.get('notifyOnDropClaimed') === false) {
      note = 'Окна о полученных наградах сейчас выключены — это только проверка';
    } else if (window.QuietHours?.active?.()) {
      note = 'Сейчас тихие часы: до их конца окна о наградах не всплывают';
    }
    if (note) window.utils.showToast(note, 'info', { userAction: true });
    return true;
  }
};

// Клики и клавиши в окне отмечаются заранее, в фазе перехвата: так
// отметка стоит раньше, чем обработчик кнопки успеет показать тост.
// Программный element.click() сюда не попадает — он не шлёт pointerdown
window.addEventListener('pointerdown', () => window.utils.noteUserAction(), true);
window.addEventListener('keydown', () => window.utils.noteUserAction(), true);

// Стили тостов, подтверждений и окон входа — в styles/notifications.css
