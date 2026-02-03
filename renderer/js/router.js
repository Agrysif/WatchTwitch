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

    // Global toggle handler (delegated)
    this.installToggleDelegation();

    // Load initial page
    this.navigate('farming');
  }

  installToggleDelegation() {
    if (this._toggleDelegationInstalled) return;
    this._toggleDelegationInstalled = true;

    document.addEventListener('click', (event) => {
      if (this.currentPage !== 'settings') return;
      const toggle = event.target.closest('.toggle-switch');
      if (!toggle) return;

      event.preventDefault();
      event.stopPropagation();

      const isActive = toggle.classList.contains('active');
      if (isActive) {
        toggle.classList.remove('active');
        toggle.style.setProperty('background', '#4a4a4a', 'important');
      } else {
        toggle.classList.add('active');
        toggle.style.setProperty('background', '#9147FF', 'important');
      }

      toggle.setAttribute('aria-pressed', (!isActive).toString());

      if (toggle.id === 'shutdown-toggle') {
        const shutdownSetting = document.getElementById('shutdown-action-setting');
        if (shutdownSetting) shutdownSetting.style.display = !isActive ? 'flex' : 'none';
      }
    });
  }

  async navigate(page) {
    console.log('[Router] Navigating to page:', page);
    
    // Сохраняем всю информацию о стриме если покидаем страницу farming
    if (this.currentPage === 'farming' && page !== 'farming') {
      // Не останавливаем стрим, только чистим интервалы UI, чтобы не плодить дубли
      try {
        if (window.farmingPage && window.farmingPage.destroy) {
          window.farmingPage.destroy();
        }
      } catch (e) {
        console.error('[Router] Error destroying farmingPage intervals:', e);
      }

      const mainPlayer = document.getElementById('twitch-player');
      const playerContainer = document.getElementById('twitch-player-container');
      const bgPlayer = document.getElementById('background-twitch-player');
      
      if (mainPlayer && mainPlayer.src && playerContainer && playerContainer.style.display !== 'none') {
        // Сохраняем полную информацию о текущем стриме
        window._streamState = {
          url: mainPlayer.src,
          channel: document.getElementById('stream-channel')?.textContent || '',
          game: document.getElementById('stream-game')?.textContent || '',
          title: document.getElementById('stream-title')?.textContent || '',
          gameCover: document.getElementById('stream-game-cover')?.src || '',
          viewers: document.getElementById('stream-viewers')?.textContent || '-',
          uptime: document.getElementById('stream-uptime')?.textContent || '-'
        };
        console.log('[Router] Saved stream state:', window._streamState);

        // Перекладываем воспроизведение в фоновый webview с добавлением параметров автозапуска
        if (bgPlayer && window._streamState.url) {
          try {
            let bgUrl = window._streamState.url;
            // Убеждаемся, что URL содержит параметры для автозапуска
            if (bgUrl.includes('player.twitch.tv')) {
              if (!bgUrl.includes('muted=true')) {
                bgUrl += (bgUrl.includes('?') ? '&' : '?') + 'muted=true';
              }
              if (!bgUrl.includes('autoplay=true')) {
                bgUrl += (bgUrl.includes('?') ? '&' : '?') + 'autoplay=true';
              }
            }
            
            if (!bgPlayer.src || bgPlayer.src !== bgUrl) {
              bgPlayer.src = bgUrl;
              console.log('[Router] Background player set to:', bgUrl.substring(0, 100));
            }
          } catch (e) {
            console.error('[Router] Failed to set background player src:', e);
          }
        }
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

        // Управляем мини-плеером в сайдбаре
        this.manageMiniPlayer(page);

        // Восстанавливаем стрим при возврате на farming (без перезагрузки)
        if (page === 'farming' && window._streamState) {
          setTimeout(() => {
            const mainPlayer = document.getElementById('twitch-player');
            const playerContainer = document.getElementById('twitch-player-container');
            const streamInfo = document.getElementById('current-stream-info');
            const bgPlayer = document.getElementById('background-twitch-player');
            
            if (mainPlayer && playerContainer && streamInfo && window._streamState) {
              console.log('Restoring stream without reload');
              
              // Сначала пробуем вернуть поток из фонового плеера, иначе используем сохранённый URL
              if (bgPlayer && bgPlayer.src) {
                mainPlayer.src = bgPlayer.src;
                try { bgPlayer.src = ''; } catch (e) { console.error('Failed to clear background player:', e); }
                console.log('Restored stream from background player');
              } else if (!mainPlayer.src || mainPlayer.src !== window._streamState.url) {
                mainPlayer.src = window._streamState.url;
              }
              
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

            // Дополнительно убеждаемся, что фоновый плеер очищен
            if (bgPlayer && bgPlayer.src) {
              try { bgPlayer.src = ''; } catch (e) { console.error('Failed to clear background player:', e); }
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

  manageMiniPlayer(page) {
    const miniPlayerContainer = document.getElementById('sidebar-mini-player-container');
    const miniPlayer = document.getElementById('sidebar-mini-player');
    const bgPlayer = document.getElementById('background-twitch-player');
    
    if (!miniPlayerContainer || !miniPlayer) return;

    // Показываем мини-плеер только если:
    // 1. НЕ на странице фарминга
    // 2. Есть активная сессия (фарминг запущен)
    // 3. Есть активный стрим
    const isFarmingActive = !!(window.streamingManager?.isFarmingActive?.() || window.farmingPage?.sessionStartTime);
    const hasStream = !!(
      (window._streamState && window._streamState.url) ||
      (window._streamState && window._streamState.channel) ||
      (document.getElementById('twitch-player')?.src) ||
      (bgPlayer?.src)
    );
    
    console.log('[Router] Mini-player check:', { page, isFarmingActive, hasStream });
    
    if (page !== 'farming' && isFarmingActive && hasStream) {
      // Получаем URL стрима - приоритет: фоновый плеер → основной плеер → сохраненное состояние
      const bgPlayer = document.getElementById('background-twitch-player');
      const mainPlayer = document.getElementById('twitch-player');
      let streamUrl = (bgPlayer && bgPlayer.src) ? bgPlayer.src : 
                      (mainPlayer && mainPlayer.src) ? mainPlayer.src : 
                      window._streamState?.url;

      // Fallback: construct embed URL if only channel name is known
      if (!streamUrl && window._streamState?.channel) {
        const channelLogin = window._streamState.channel.replace(/^@/, '').toLowerCase();
        streamUrl = `https://player.twitch.tv/?channel=${channelLogin}&parent=localhost&muted=true&autoplay=true&quality=160p30`;
        console.log('[MiniPlayer] Constructed fallback URL from channel:', channelLogin);
      }
      
      // Убеждаемся, что URL содержит параметры для автозапуска
      if (streamUrl && streamUrl.includes('player.twitch.tv')) {
        // Убираем существующие параметры autoplay, чтобы добавить их заново
        streamUrl = streamUrl.replace(/[?&]autoplay=[^&]*/g, '');
        streamUrl = streamUrl.replace(/[?&]muted=[^&]*/g, '');
        streamUrl = streamUrl.replace(/[?&]quality=[^&]*/g, '');
        
        // Добавляем параметры правильно
        const separator = streamUrl.includes('?') ? '&' : '?';
        streamUrl += separator + 'muted=true&autoplay=true&quality=160p30';
        
        console.log('[MiniPlayer] Updated URL with autoplay params:', streamUrl.substring(0, 100));
      }
      
      if (streamUrl && miniPlayer.src !== streamUrl) {
        console.log('[MiniPlayer] Setting URL:', streamUrl.substring(0, 100));
        miniPlayer.src = streamUrl;
        
        // После загрузки плеера пытаемся запустить его через инъекцию скрипта
        // Используем 'did-finish-load' событие для лучшего таймирования
        const onLoadHandler = () => {
          console.log('[MiniPlayer] Webview loaded, injecting autoplay script');
          
          // Инъецируем скрипт который найдет и кликнет play button
          miniPlayer.executeJavaScript(`
            (function() {
              let attemptCount = 0;
              const maxAttempts = 15; // Увеличиваем количество попыток
              
              const startAutoplay = () => {
                attemptCount++;
                console.log('[Autoplay] Attempt', attemptCount, 'of', maxAttempts);
                
                // Ищем play button с несколькими подходами
                const selectors = [
                  'button[aria-label*="Play"]',
                  '[role="button"][aria-label*="Play"]',
                  '.player-button--play',
                  '[data-a-target="play-pause-button"]',
                  'button[data-a-target*="play"]',
                  'div[role="button"] svg[class*="play"]',
                  'button svg[class*="play"]',
                  '[class*="play-pause"]',
                  'video' // Прямо видео элемент
                ];
                
                let playBtn = null;
                let videoEl = null;
                
                for (let selector of selectors) {
                  const el = document.querySelector(selector);
                  if (el) {
                    if (selector === 'video') {
                      videoEl = el;
                      console.log('[Autoplay] Found video element');
                    } else {
                      playBtn = el.closest('button') || el;
                      console.log('[Autoplay] Found play button with selector:', selector);
                      break;
                    }
                  }
                }
                
                // Пытаемся кликнуть button
                if (playBtn) {
                  console.log('[Autoplay] Clicking play button');
                  playBtn.click();
                  setTimeout(() => playBtn.click(), 100); // Двойной клик с задержкой
                  return true; // Успех
                }
                
                // Пытаемся запустить видео напрямую
                if (videoEl && videoEl.paused) {
                  console.log('[Autoplay] Trying to play video directly');
                  videoEl.play().then(() => {
                    console.log('[Autoplay] Video started successfully');
                  }).catch(e => {
                    console.log('[Autoplay] Video play error:', e.message);
                  });
                  return true; // Попытка сделана
                }
                
                // Если ничего не найдено и еще есть попытки, повторяем
                if (attemptCount < maxAttempts) {
                  console.log('[Autoplay] Nothing found, will retry in 1s');
                  setTimeout(startAutoplay, 1000);
                  return false;
                } else {
                  console.log('[Autoplay] Max attempts reached, giving up');
                  return false;
                }
              };
              
              // Запускаем с разными интервалами для покрытия всех случаев
              setTimeout(startAutoplay, 100);    // Очень быстро
              setTimeout(startAutoplay, 500);    // Быстро
              setTimeout(startAutoplay, 1000);   // Средне
              setTimeout(startAutoplay, 2000);   // Медленно
              setTimeout(startAutoplay, 3000);   // Очень медленно
              setTimeout(startAutoplay, 5000);   // Для очень медленной загрузки
            })();
          `).catch(e => {
            console.log('[MiniPlayer] Script injection error:', e.message);
          });
          
          miniPlayer.removeEventListener('did-finish-load', onLoadHandler);
        };
        
        miniPlayer.addEventListener('did-finish-load', onLoadHandler);
        
        // Показываем с анимацией
        miniPlayerContainer.style.display = 'block';
        setTimeout(() => {
          miniPlayerContainer.style.opacity = '1';
          miniPlayerContainer.style.transform = 'translateY(0)';
        }, 50);
        console.log('[MiniPlayer] Mini player shown in sidebar (farming active)');
      } else if (!streamUrl) {
        console.log('[MiniPlayer] No stream URL found');
      }
    } else {
      // Скрываем мини-плеер с анимацией исчезновения
      if (miniPlayerContainer.style.display !== 'none') {
        console.log('[MiniPlayer] Hiding mini-player', { page, isFarmingActive, hasStream });
        miniPlayerContainer.style.opacity = '0';
        miniPlayerContainer.style.transform = 'translateY(-10px)';
        setTimeout(() => {
          miniPlayerContainer.style.display = 'none';
          miniPlayer.src = '';
        }, 300);
      }
    }
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
  
  // Синхронизация фонового плеера с мини-плеером
  syncBackgroundPlayerToMini() {
    setInterval(() => {
      if (this.currentPage !== 'farming') {
        const bgPlayer = document.getElementById('background-twitch-player');
        const miniPlayer = document.getElementById('sidebar-mini-player');
        
        if (bgPlayer && bgPlayer.src && miniPlayer && miniPlayer.src !== bgPlayer.src) {
          console.log('[Router] Syncing background player URL to mini player');
          miniPlayer.src = bgPlayer.src;
        }
      }
    }, 2000); // Проверяем каждые 2 секунды
  }
}

// Инициализируем синхронизацию при загрузке
document.addEventListener('DOMContentLoaded', () => {
  // Синхронизируем фоновый плеер с мини-плеером каждые 3 секунды
  setInterval(() => {
    const bgPlayer = document.getElementById('background-twitch-player');
    const miniPlayer = document.getElementById('sidebar-mini-player');
    
    if (bgPlayer && bgPlayer.src && miniPlayer) {
      if (miniPlayer.src !== bgPlayer.src && document.querySelector('.nav-item.active')?.getAttribute('data-page') !== 'farming') {
        console.log('[Sync] Syncing background player to mini player');
        miniPlayer.src = bgPlayer.src;
        
        // Пытаемся запустить воспроизведение после синхронизации
        setTimeout(() => {
          try {
            miniPlayer.executeJavaScript(`
              try {
                const buttons = document.querySelectorAll('button, [role="button"]');
                let playBtn = null;
                for (let btn of buttons) {
                  const ariaLabel = btn.getAttribute('aria-label') || '';
                  if (ariaLabel.includes('Play') || btn.title?.includes('Play')) {
                    playBtn = btn;
                    break;
                  }
                }
                if (playBtn && playBtn.offsetParent !== null) {
                  playBtn.click();
                }
              } catch (e) {}
            `, false);
          } catch (e) {}
        }, 500);
      }
    }
  }, 3000);
  
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
