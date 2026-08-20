// Router for page navigation
class Router {
  constructor() {
    this.pages = {
      farming: './pages/farming.html',
      accounts: './pages/accounts.html',
      drops: './pages/drops.html',
      subscriptions: './pages/subscriptions.html',
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
    console.log('[Router] Navigating to page:', page);
    
    // Гасим уходящую страницу: её таймеры и обработчики иначе продолжают
    // работать и накапливаются с каждой навигацией.
    this.destroyCurrentPage(page);

    // Сохраняем всю информацию о стриме если покидаем страницу farming
    if (this.currentPage === 'farming' && page !== 'farming') {

      // Плеер НЕ трогаем: он живёт вне страницы и продолжает играть.
      // Сохраняем только текстовую информацию для восстановления карточки стрима.
      const playerContainer = document.getElementById('twitch-player-container');

      if (window.playerManager?.hasStream() && playerContainer && playerContainer.style.display !== 'none') {
        window._streamState = {
          channel: document.getElementById('stream-channel')?.textContent || '',
          game: document.getElementById('stream-game')?.textContent || '',
          title: document.getElementById('stream-title')?.textContent || '',
          gameCover: document.getElementById('stream-game-cover')?.src || '',
          viewers: document.getElementById('stream-viewers')?.textContent || '-',
          uptime: document.getElementById('stream-uptime')?.textContent || '-'
        };
        console.log('[Router] Saved stream info (плеер продолжает играть)');
      }
      
      // Сохраняем HTML дропсов
      const dropsHorizontal = document.getElementById('drops-progress-horizontal');
      if (dropsHorizontal && dropsHorizontal.style.display !== 'none') {
        window._dropsState = {
          html: dropsHorizontal.innerHTML,
          display: dropsHorizontal.style.display
        };
        console.log('Saved drops state');
      }
      
      // Сохраняем состояние баллов канала
      const pointsCard = document.getElementById('channel-points-card');
      if (pointsCard && pointsCard.style.display !== 'none') {
        window._channelPointsState = {
          total: document.getElementById('channel-points-total')?.textContent || '-',
          earned: document.getElementById('channel-points-earned')?.textContent || '-',
          chestsPoints: document.getElementById('bonus-chests-points')?.textContent || '-',
          passiveEarned: document.getElementById('passive-points-earned')?.textContent || '-',
          visible: true
        };
        console.log('Saved channel points state:', window._channelPointsState);
      }
    }

    // Update active nav button
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.remove('active');
    });
    const navBtn = document.querySelector(`[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');

    // Load page content
    const container = document.getElementById('page-container');
    container.classList.add('fade-out');

    setTimeout(async () => {
      try {
        const relPath = 'renderer/' + this.pages[page].replace(/^\.\//, '');
        console.log('[Router] Attempting to read page:', relPath);
        let html = '';
        
        try {
          const fileResult = await window.electronAPI.readFile(relPath);
          if (fileResult?.success) {
            html = fileResult.content;
            console.log('[Router] Read page via IPC, length:', html.length);
          } else {
            console.warn('[Router] IPC read failed:', fileResult?.error, '- falling back to fetch');
            const response = await fetch(this.pages[page]);
            html = await response.text();
            console.log('[Router] Read page via fetch, length:', html.length);
          }
        } catch (e) {
          console.error('[Router] Error reading page:', e);
          window.utils?.showToast('Ошибка загрузки страницы: ' + page, 'error');
          return;
        }
        
        if (!html || html.length === 0) {
          console.error('[Router] Page HTML is empty');
          window.utils?.showToast('Страница пуста', 'error');
          return;
        }
        
        // Parse HTML and extract script
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const bodyLen = (doc?.body?.innerHTML || '').length;
        console.log('[Router] Parsed body innerHTML length:', bodyLen);
        
        // Get all script tags
        const scriptTags = doc.querySelectorAll('script');
        const externalScripts = [];
        let inlineScript = '';
        
        scriptTags.forEach(script => {
          if (script.src) {
            // External script - save for later loading
            externalScripts.push(script.src);
          } else if (script.textContent) {
            // Inline script
            inlineScript += script.textContent + '\n';
          }
          script.remove();
        });
        
        // Set HTML content
        console.log('[Router] About to inject:', {
          bodyInnerHtmlLen: doc.body.innerHTML.length,
          containerExists: !!container,
          containerId: container?.id,
          containerClass: container?.className
        });
        
        container.innerHTML = doc.body.innerHTML;
        
        console.log('[Router] After injection. Container child count:', container.children.length, 'innerHTML length:', container.innerHTML.length);
        if (container.children.length === 0) {
          console.warn('[Router] WARNING: Container is empty after injection!');
          console.log('[Router] Container innerHTML sample (first 200 chars):', container.innerHTML.substring(0, 200));
        }
        
        this.currentPage = page;

        // Load external scripts first
        for (const scriptSrc of externalScripts) {
          await this.loadScript(scriptSrc);
        }

        // Execute inline script
        if (inlineScript) {
          eval(inlineScript);
        }

        // Initialize page-specific logic
        this.initPageScripts(page);

        // Приводим сайдбар в соответствие с реальным состоянием сессии.
        // Блок «Сессия» и кнопка старт/стоп живут вне страниц, поэтому после
        // каждой навигации их нужно пересинхронизировать явно.
        window.sessionState?.syncUI();

        // Управляем положением единственного плеера
        this.manageMiniPlayer(page);

        // Восстанавливаем карточку стрима при возврате на farming.
        // Сам плеер не перезагружается — он просто переезжает обратно в свой слот.
        if (page === 'farming' && window._streamState) {
          setTimeout(() => {
            const playerContainer = document.getElementById('twitch-player-container');
            const streamInfo = document.getElementById('current-stream-info');

            if (playerContainer && streamInfo && window._streamState) {
              console.log('[Router] Восстанавливаю карточку стрима без перезагрузки плеера');

              playerContainer.style.display = 'block';
              streamInfo.style.display = 'none';

              // Восстанавливаем информацию
              const channelEl = document.getElementById('stream-channel');
              const gameEl = document.getElementById('stream-game');
              const titleEl = document.getElementById('stream-title');
              const gameCoverEl = document.getElementById('stream-game-cover');
              const viewersEl = document.getElementById('stream-viewers');
              const uptimeEl = document.getElementById('stream-uptime');
              
              if (channelEl) channelEl.textContent = window._streamState.channel;
              if (gameEl) gameEl.textContent = window._streamState.game;
              if (titleEl) titleEl.textContent = window._streamState.title;
              if (uptimeEl) uptimeEl.textContent = window._streamState.uptime;
              if (viewersEl) viewersEl.textContent = window._streamState.viewers;
              
              if (gameCoverEl && window._streamState.gameCover) {
                gameCoverEl.src = window._streamState.gameCover;
                gameCoverEl.style.display = 'block';
              }
            }

            // Восстанавливаем баллы канала
            if (window._channelPointsState && window._channelPointsState.visible) {
              console.log('Restoring channel points');
              const pointsCard = document.getElementById('channel-points-card');
              if (pointsCard) {
                pointsCard.style.display = 'block';
                
                const totalEl = document.getElementById('channel-points-total');
                const earnedEl = document.getElementById('channel-points-earned');
                const chestsEl = document.getElementById('bonus-chests-points');
                const passiveEl = document.getElementById('passive-points-earned');
                
                if (totalEl) totalEl.textContent = window._channelPointsState.total;
                if (earnedEl) earnedEl.textContent = window._channelPointsState.earned;
                if (chestsEl) chestsEl.textContent = window._channelPointsState.chestsPoints;
                if (passiveEl) passiveEl.textContent = window._channelPointsState.passiveEarned;
              }
            }
            
            // Восстанавливаем дропсы
            if (window._dropsState) {
              console.log('Restoring drops');
              const dropsHorizontal = document.getElementById('drops-progress-horizontal');
              if (dropsHorizontal) {
                dropsHorizontal.innerHTML = window._dropsState.html;
                dropsHorizontal.style.display = window._dropsState.display;
              }
            }
          }, 300);
        }

        // Update translations
        i18n.updatePage();

        container.classList.remove('fade-out');
        container.classList.add('fade-in');
      } catch (error) {
        console.error('Error loading page:', error);
      }
    }, 300);
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
      settings: 'settingsPage'
    };
  }

  destroyCurrentPage(nextPage) {
    if (!this.currentPage || this.currentPage === nextPage) return;

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
      // На странице фарминга плеер занимает своё основное место,
      // но уезжает в сайдбар, если его прокрутили за пределы экрана
      const slot = document.getElementById('farming-player-slot');

      if (slot && player.hasStream()) {
        this.watchPlayerVisibility(slot);
      } else {
        this.stopWatchingPlayerVisibility();
        this.hideSidebarMiniPlayer(miniPlayerContainer);
        if (!player.hasStream()) player.detach();
      }
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
