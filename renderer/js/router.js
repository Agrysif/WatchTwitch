// Router for page navigation
class Router {
  constructor() {
    this.pages = {
      farming: './pages/farming.html',
      accounts: './pages/accounts.html',
      drops: './pages/drops.html',
      subscriptions: './pages/subscriptions.html',
      calendar: './pages/calendar.html',
      statistics: './pages/statistics.html',
      settings: './pages/settings.html'
    };
    this.currentPage = null;
    this.init();
  }

  init() {
    // Set up navigation
    document.querySelectorAll('.nav-item').forEach(button => {
      button.addEventListener('click', () => {
        const page = button.getAttribute('data-page');
        this.navigate(page);
      });
    });

    // Load initial page
    this.navigate('farming');
  }

  /**
   * Раньше здесь висел глобальный обработчик кликов по '.toggle-switch':
   * он сам переключал вид элемента и гасил событие через stopPropagation.
   *
   * Удалён по двум причинам. Элементов с таким классом в приложении нет
   * (переключатели настроек — это .settings-toggle с настоящим checkbox
   * внутри), то есть код был мёртвым. При этом он оставался миной: любой
   * будущий переключатель с этим классом получил бы только смену внешнего
   * вида, а сохранение настройки не сработало бы — событие до страницы
   * просто не доходило.
   */

  async navigate(page) {
    if (!this.pages[page]) return;
    const navigation = this._navigationId = (this._navigationId || 0) + 1;
    if (this.currentPage === page) return;
    const container = document.getElementById('page-container');
    container.classList.add('fade-out');
    try {
      const restoringFarming = page === 'farming' && this._farmingContent;
      let doc;
      let externalScripts = [];
      let inlineScript = '';
      if (!restoringFarming) {
        const relPath = 'renderer/' + this.pages[page].replace(/^\.\//, '');
        const result = await window.electronAPI.readFile(relPath);
        const html = result?.success ? result.content : await (await fetch(this.pages[page])).text();
        if (!html) throw new Error('Страница пуста: ' + page);
        doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script').forEach(script => {
          if (script.src) externalScripts.push(script.src);
          else inlineScript += (script.textContent || '') + '\n';
          script.remove();
        });
        for (const src of externalScripts) await this.loadScript(src);
      }
      if (navigation !== this._navigationId) return;
      this.destroyCurrentPage(page);
      if (this.currentPage === 'farming') {
        // Keep farming automation and its DOM alive while another page is visible.
        // The persistent player is outside this subtree and is never moved.
        const parked = document.createElement('div');
        parked.id = 'farming-background-content';
        parked.hidden = true;
        document.body.appendChild(parked);
        while (container.firstChild) parked.appendChild(container.firstChild);
        this._farmingContent = parked;
      }
      if (restoringFarming) {
        container.replaceChildren(...this._farmingContent.childNodes);
        this._farmingContent.remove();
        this._farmingContent = null;
      } else {
        container.innerHTML = doc.body.innerHTML;
      }
      this.currentPage = page;
      document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-page') === page);
      });
      if (!restoringFarming) {
        if (inlineScript) {
          const script = document.createElement('script');
          script.textContent = '(function () {\n' + inlineScript + '\n})();';
          document.body.appendChild(script);
          script.remove();
        }
        this.initPageScripts(page);
      }
      window.sessionState?.syncUI();
      this.manageMiniPlayer(page);
      i18n.updatePage();
      container.classList.add('fade-in');
    } catch (error) {
      console.error('Error loading page:', error);
      window.utils?.showToast('Ошибка загрузки страницы: ' + page, 'error');
    } finally {
      if (navigation === this._navigationId) container.classList.remove('fade-out');
    }
  }

  /**
   * Объекты страниц, живущие в window. Роутер создаёт их заново при каждой
   * навигации, поэтому уходящий экземпляр обязан освободить свои ресурсы.
   * Раньше destroy() вызывался только у страницы фарминга, а таймеры
   * остальных страниц продолжали тикать до самого закрытия приложения.
   */
  static get PAGE_INSTANCES() {
    return {
      farming: 'farmingPage',
      drops: 'dropsPage',
      subscriptions: 'subscriptionsPage',
      statistics: 'statisticsPage',
      settings: 'settingsPage',
      calendar: 'calendarPage'
    };
  }

  destroyCurrentPage(nextPage) {
    if (!this.currentPage || this.currentPage === nextPage) return;
    // Farming owns session automation and survives navigation.
    if (this.currentPage === 'farming') return;

    const key = Router.PAGE_INSTANCES[this.currentPage];
    if (!key) return;

    const instance = window[key];
    if (!instance || typeof instance.destroy !== 'function') return;

    try {
      instance.destroy();
      console.log('[Router] Освобождена страница:', this.currentPage);
    } catch (e) {
      console.error('[Router] Ошибка при освобождении страницы', this.currentPage, e);
    }
  }

  initPageScripts(page) {
    console.log('Initializing page scripts for:', page);
    
    switch (page) {
      case 'farming':
        if (window.FarmingPage) {
          window.farmingPage = new FarmingPage();
        }
        break;
      case 'accounts':
        if (window.initAccountsPage) {
          window.initAccountsPage();
        }
        break;
      case 'drops':
        // Всегда создаём новый экземпляр при навигации
        if (window.DropsPage) {
          console.log('Creating new DropsPage instance');
          window.dropsPage = new DropsPage();
        }
        break;
      case 'subscriptions':
        if (window.SubscriptionsPage) {
          console.log('Creating new SubscriptionsPage instance');
          window.subscriptionsPage = new SubscriptionsPage();
        }
        break;
      case 'calendar':
        if (window.CalendarPage) {
          window.calendarPage = new CalendarPage();
        }
        break;
      case 'statistics':
        if (window.StatisticsPage) {
          window.statisticsPage = new StatisticsPage();
        }
        break;
      case 'settings':
        if (window.SettingsPage) {
          window.settingsPage = new SettingsPage();
        }
        break;
    }
  }

  /**
   * Решает, где сейчас должен находиться единственный плеер приложения.
   *
   * Плеер не пересоздаётся и не перезагружается — меняется только слот,
   * поверх которого он рисуется. Поэтому переход между страницами больше
   * не прерывает просмотр и накопление минут для дропсов.
   */
  manageMiniPlayer(page) {
    // Чат нигде, кроме страницы фарминга, не показывается. Отвязываем его от
    // слота, чтобы не следить за уже удалённым элементом — сам чат при этом
    // остаётся загруженным и продолжает собирать бонусные сундуки.
    if (page !== 'farming') {
      window.chatManager?.detach();
    }

    const player = window.playerManager;
    if (!player) return;

    const miniPlayerContainer = document.getElementById('sidebar-mini-player-container');

    if (page === 'farming') {
      this.placePlayerOnFarming();
      return;
    }

    this.stopWatchingPlayerVisibility();

    // На остальных страницах — мини-плеер в сайдбаре, но только если
    // фарминг реально идёт и есть загруженный поток.
    const isFarmingActive = !!(
      window.streamingManager?.isFarmingActive?.() ||
      window.farmingPage?.sessionStartTime ||
      window.sessionState?.isActive?.()
    );

    if (!isFarmingActive || !player.hasStream()) {
      console.log('[MiniPlayer] Прячу мини-плеер', { page, isFarmingActive, hasStream: player.hasStream() });
      this.hideSidebarMiniPlayer(miniPlayerContainer);
      player.detach();
      return;
    }

    if (miniPlayerContainer) {
      miniPlayerContainer.style.display = 'block';
      requestAnimationFrame(() => {
        miniPlayerContainer.style.opacity = '1';
        miniPlayerContainer.style.transform = 'translateY(0)';
      });
    }

    const sidebarSlot = document.getElementById('sidebar-player-slot');
    if (sidebarSlot) {
      player.attachTo(sidebarSlot, { interactive: false });
    }
  }

  /**
   * Размещает плеер на странице фарминга и включает слежение за видимостью.
   *
   * Вызывается и роутером при навигации, и самой страницей — когда стрим
   * стартовал уже после открытия страницы. Раньше страница привязывала
   * плеер напрямую, минуя роутер, и наблюдатель за прокруткой в этом случае
   * не заводился вовсе: плеер уезжал под верхний край и оставался там.
   */
  placePlayerOnFarming() {
    const player = window.playerManager;
    if (!player) return;

    const slot = document.getElementById('farming-player-slot');
    const miniPlayerContainer = document.getElementById('sidebar-mini-player-container');

    if (slot && player.hasStream()) {
      this.watchPlayerVisibility(slot);
      return;
    }

    this.stopWatchingPlayerVisibility();
    this.hideSidebarMiniPlayer(miniPlayerContainer);
    if (!player.hasStream()) player.detach();
  }

  /**
   * Следит, виден ли плеер на странице фарминга.
   *
   * Когда его прокручивают за пределы экрана, плеер переезжает в сайдбар и
   * продолжает работу там; когда возвращается в поле зрения — едет обратно.
   * Оба переезда анимированы, а сам поток не прерывается: webview не
   * пересоздаётся и не меняет размеров, меняются только координаты.
   */
  watchPlayerVisibility(slot) {
    if (this._visibilityTarget === slot) return;
    this.stopWatchingPlayerVisibility();
    this._visibilityTarget = slot;

    const apply = (visible) => {
      if (this._playerInSidebar === !visible) return;
      this._playerInSidebar = !visible;

      const player = window.playerManager;
      const container = document.getElementById('sidebar-mini-player-container');

      if (visible) {
        this.hideSidebarMiniPlayer(container);
        player.attachTo(slot, { animate: true });
        return;
      }

      const sidebarSlot = document.getElementById('sidebar-player-slot');
      if (!sidebarSlot) return;

      if (container) {
        container.style.display = 'block';
        requestAnimationFrame(() => {
          container.style.opacity = '1';
          container.style.transform = 'translateY(0)';
        });
      }
      player.attachTo(sidebarSlot, { interactive: false, animate: true });
    };

    // Порог в четверть: переезд происходит, когда плеера почти не видно,
    // а не при первом же пикселе за краем — иначе он дёргался бы
    // туда-сюда от небольшой прокрутки.
    this._visibilityObserver = new IntersectionObserver(
      (entries) => apply(entries[0].intersectionRatio >= 0.25),
      { threshold: [0, 0.25, 0.5] }
    );

    this._visibilityObserver.observe(slot);
    this._playerInSidebar = null;
  }

  stopWatchingPlayerVisibility() {
    if (this._visibilityObserver) {
      this._visibilityObserver.disconnect();
      this._visibilityObserver = null;
    }
    this._visibilityTarget = null;
    this._playerInSidebar = null;
  }

  /**
   * Освобождает оба места плеера: наблюдатель за прокруткой и мини-плеер
   * в сайдбаре.
   *
   * Вызывается самой выгрузкой плеера. Раньше страница фарминга просила
   * роутер обновить мини-плеер до unload(), поэтому hasStream() был ещё
   * истинным, роутер решал, что плеер на месте, и сайдбарный контейнер
   * не закрывался — от остановленного фарминга оставался чёрный прямоугольник.
   */
  releasePlayerSlots() {
    this.stopWatchingPlayerVisibility();
    this.hideSidebarMiniPlayer(document.getElementById('sidebar-mini-player-container'));
  }

  hideSidebarMiniPlayer(container) {
    const miniPlayerContainer = container || document.getElementById('sidebar-mini-player-container');
    if (!miniPlayerContainer || miniPlayerContainer.style.display === 'none') return;

    miniPlayerContainer.style.opacity = '0';
    miniPlayerContainer.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      miniPlayerContainer.style.display = 'none';
    }, 300);
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      console.log('Loading script:', src);
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        console.log('Script loaded:', src);
        resolve();
      };
      script.onerror = (error) => {
        console.error('Failed to load script:', src, error);
        reject(error);
      };
      document.head.appendChild(script);
    });
  }
  
}

// Периодическая синхронизация фонового и мини-плеера удалена:
// раньше два таймера (каждые 2 и каждые 10 секунд) переприсваивали .src
// между плеерами, из-за чего стрим самопроизвольно перезапускался даже
// без переходов между страницами. Плеер теперь один и такой синхронизации
// не требует.

document.addEventListener('DOMContentLoaded', () => {
  // Обработчик закрытия mini PiP
  const closeBtn = document.getElementById('close-mini-stream');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const miniPip = document.getElementById('mini-stream-pip');
      const miniPlayer = document.getElementById('mini-twitch-player');
      if (miniPip && miniPlayer) {
        miniPip.style.display = 'none';
        miniPlayer.src = '';
        window._streamState = null;
      }
    });
  }
});
