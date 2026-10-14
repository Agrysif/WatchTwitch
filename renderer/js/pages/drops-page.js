// Drops page - полностью переписан
(function() {
  'use strict';

  if (window.DropsPage) {
    console.log('DropsPage already loaded');
    return;
  }

  // Названия кампаний, игр и наград задаёт разработчик игры, а не
  // приложение. Вставленные в innerHTML как есть, они становились
  // разметкой и могли выполнить код с доступом к electronAPI.
  const esc = (text) => (typeof window.escapeHtml === 'function'
    ? window.escapeHtml(text)
    : String(text ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch])));

  // Адрес картинки попадает внутрь url('…') в атрибуте style. Кавычка или
  // скобка в нём закрывала url() и дописывала свой CSS, поэтому пропускаем
  // только http(s) и data:image, а опасные символы кодируем.
  const safeImageUrl = (url) => {
    const value = String(url || '');
    if (!/^(https?:|data:image\/)/i.test(value)) return '';
    return value.replace(/["'()\\\s<>]/g,
      ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  };

  // Галочка из набора иконок тостов: символ «✓» выглядел чужим рядом
  // с остальными SVG-иконками интерфейса.
  const CHECK_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px;"><polyline points="20 6 9 17 4 12"/></svg>';

  class DropsPage {
    constructor() {
      console.log('DropsPage constructor');
      this.i18n = window.i18n;
      this.campaigns = [];
      this.claimedDrops = [];
      this.updateTimer = null;
      // Обработчики на document переживают уничтожение страницы,
      // поэтому снимаем их централизованно в destroy()
      this._abort = new AbortController();
      this._destroyed = false;
      this.inventoryPage = 1;
      this.inventoryPageSize = 20;
      this.inventoryFilter = 'all'; // all, game, time
      this.inventoryGameFilter = null;
      this.showAllGames = false; // Новое свойство для управления показом всех игр
      this.initialized = false;
      
      // Определение редкостей дропов.
      // Цвета из общей палитры интерфейса: прежние кислотные #00ff00,
      // #9d00ff, #ff0088 резали глаз и не совпадали с остальными экранами.
      this.rarityTiers = [
        { name: 'common', label: 'Обычный', minMinutes: 0, maxMinutes: 60, minViewers: 50000, color: '#8a93a3', glow: 'rgba(138, 147, 163, 0.4)' },
        { name: 'uncommon', label: 'Необычный', minMinutes: 61, maxMinutes: 120, minViewers: 30000, color: '#35d08a', glow: 'rgba(53, 208, 138, 0.4)' },
        { name: 'rare', label: 'Редкий', minMinutes: 121, maxMinutes: 240, minViewers: 15000, color: '#4aa3ff', glow: 'rgba(74, 163, 255, 0.4)' },
        { name: 'epic', label: 'Эпический', minMinutes: 241, maxMinutes: 480, minViewers: 8000, color: '#7c5cff', glow: 'rgba(124, 92, 255, 0.4)' },
        { name: 'legendary', label: 'Легендарный', minMinutes: 481, maxMinutes: 720, minViewers: 3000, color: '#f0a83c', glow: 'rgba(240, 168, 60, 0.4)' },
        { name: 'mythic', label: 'Мифический', minMinutes: 721, maxMinutes: 99999, minViewers: 0, color: '#f0555f', glow: 'rgba(240, 85, 95, 0.4)' }
      ];
      
      this.init();
    }

    async init() {
      console.log('DropsPage init');
      
      // Проверяем авторизацию.
      //
      // Раньше страница смотрела только на getOAuthUser(), а он возвращает
      // null даже у полностью авторизованного пользователя — вся вкладка
      // показывала «Требуется авторизация», хотя фарминг шёл и подписки
      // грузились. Настоящий признак входа лежит в сохранённом аккаунте,
      // как это и делает страница подписок; ответ getOAuthUser лишь
      // дополняет его свежими полями, если он вообще пришёл.
      try {
        const oauthData = await window.electronAPI.getOAuthUser().catch(() => null);
        const accounts = (await Storage.getAccounts().catch(() => [])) || [];
        const account = accounts[0] || null;
        // Пока шёл запрос, пользователь мог уйти на другую страницу
        if (this._destroyed) return;

        const user = (oauthData?.user) || (account && account.accessToken ? {
          displayName: account.displayName || account.username,
          login: account.username,
          email: account.email || '',
          profileImageUrl: account.avatar || ''
        } : null);

        console.log('DropsPage user:', user ? 'authorized' : 'not authorized');
        
        const authSection = document.getElementById('authSection');
        const userInfo = document.getElementById('userInfo');
        const userNameEl = document.getElementById('userName');
        const userEmailEl = document.getElementById('userEmail');
        const userAvatarEl = document.getElementById('userAvatar');
        const logoutBtn = document.getElementById('logoutButton');
        const tabsContainer = document.getElementById('tabsContainer');
        const progressTab = document.getElementById('progressTab');
        
        console.log('DropsPage elements:', { 
          authSection: !!authSection, 
          userInfo: !!userInfo,
          tabsContainer: !!tabsContainer, 
          progressTab: !!progressTab 
        });
        
        if (!user) {
          // Показываем кнопку авторизации
          if (authSection) authSection.style.display = 'block';
          if (userInfo) userInfo.style.display = 'none';
          if (tabsContainer) tabsContainer.style.display = 'none';
          if (progressTab) progressTab.style.display = 'none';
          
          // Добавляем обработчик кнопки авторизации
          const authButton = document.getElementById('authButton');
          if (authButton) {
            authButton.onclick = async () => {
              // Блокируем только от двойного щелчка. Если закрыть вкладку
              // входа в браузере, ответа не будет вовсе, и навсегда
              // выключенная кнопка не дала бы попробовать ещё раз.
              authButton.disabled = true;
              const unlock = setTimeout(() => { authButton.disabled = false; }, 5000);
              try {
                const result = await window.electronAPI.startTwitchAuth();
                // Перерисовываем только эту страницу. Раньше здесь была
                // перезагрузка всего окна — даже при неудачном входе, — и она
                // обрывала фарминг и плеер.
                if (result?.success) {
                  if (!this._destroyed) await this.init();
                } else {
                  // Ошибка из main бывает служебной и английской
                  // («listen EADDRINUSE…»): переводим её тем же правилом,
                  // что и страница аккаунтов
                  const text = typeof window.friendlyLoginError === 'function'
                    ? window.friendlyLoginError(result?.error)
                    : 'Не удалось войти в Twitch — попробуйте ещё раз';
                  window.utils?.showToast(text, 'error');
                }
              } catch (error) {
                console.error('Auth error:', error);
                window.utils?.showToast('Не удалось войти через Twitch', 'error');
              } finally {
                clearTimeout(unlock);
                authButton.disabled = false;
              }
            };
          }
          return;
        }
        
        // Пользователь авторизован - показываем контент
        console.log('DropsPage showing content...');
        if (authSection) {
          authSection.style.display = 'none';
          console.log('Hidden auth section');
        }
        if (userInfo) {
          userInfo.style.display = 'block';
          if (userAvatarEl && user.profileImageUrl) userAvatarEl.src = user.profileImageUrl;
          if (userNameEl) userNameEl.textContent = user.displayName || user.login || 'User';
          if (userEmailEl) userEmailEl.textContent = user.email || '';
          if (logoutBtn) {
            // Здесь была кнопка «Выйти». Она стирала только служебный
            // OAuth-ключ — аккаунт с токеном оставался, и после перезагрузки
            // окна страница снова показывала того же пользователя. Итог:
            // выхода нет, а фарминг и плеер обрывались. Настоящее удаление
            // аккаунта с подтверждением живёт на странице аккаунтов — туда
            // кнопка теперь и ведёт.
            logoutBtn.setAttribute('data-i18n', 'nav.accounts');
            logoutBtn.textContent = this.i18n?.t('nav.accounts') || 'Аккаунты';
            logoutBtn.onclick = () => window.router?.navigate('accounts');
          }
        }
        if (tabsContainer) {
          tabsContainer.style.display = 'flex';
          console.log('Showing tabs container');
        }
        if (progressTab) {
          progressTab.style.display = 'block';
          console.log('Showing progress tab');
        }

        // Убираем любую попытку включить фон-градIENT на этой странице
        
        this.setupTabs();
        this.setupButtons();
        this.setupDropCardClickHandlers();
        await this.loadDrops();
        this.startAutoRefresh();
        this.initialized = true;
        console.log('DropsPage initialized successfully');
      } catch (error) {
        console.error('Error checking auth:', error);
        // В случае ошибки показываем кнопку авторизации
        const authSection = document.getElementById('authSection');
        if (authSection) authSection.style.display = 'block';
      }
    }

    setupTabs() {
      document.querySelectorAll('.drops-tab-button').forEach(button => {
        button.addEventListener('click', () => {
          const tab = button.getAttribute('data-tab');
          
          // Обновляем кнопки
          document.querySelectorAll('.drops-tab-button').forEach(btn => btn.classList.remove('active'));
          button.classList.add('active');
          
          // Показываем нужный таб
          document.getElementById('progressTab').style.display = tab === 'progress' ? 'block' : 'none';
          document.getElementById('inventoryTab').style.display = tab === 'inventory' ? 'block' : 'none';
          
          // Загружаем инвентарь при переключении
          if (tab === 'inventory') {
            this.loadInventory();
          }
        });
      });
    }

    setupButtons() {
      // Кнопка обновления
      const refreshBtn = document.getElementById('refreshButton');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.loadDrops({ force: true }));
      }
      
      // Кнопка получения всех наград
      const claimAllBtn = document.getElementById('claimAllButton');
      if (claimAllBtn) {
        claimAllBtn.addEventListener('click', async () => {
          claimAllBtn.disabled = true;
          claimAllBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/></svg> Получение...';
          
          try {
            const result = await window.electronAPI.claimAllDrops();
            const claimed = Number(result?.claimed) || 0;
            const total = Number(result?.total) || 0;
            // Раньше любой успешный ответ давал зелёное «Получено наград: 0» —
            // и когда забирать было нечего, и когда ни одна награда не
            // далась. Пользователь думал, что всё в порядке, а награды
            // оставались незабранными и могли сгореть с концом кампании.
            if (!result?.success) {
              window.utils?.showToast(result?.error || 'Не удалось получить награды', 'error');
            } else if (claimed === 0 && total > 0) {
              window.utils?.showToast('Не удалось получить награды — заберите их вручную', 'error');
            } else if (claimed === 0) {
              window.utils?.showToast(result.message || 'Забирать пока нечего', 'info');
            } else if (total > claimed) {
              window.utils?.showToast(`Получено ${claimed} из ${total}, остальные заберите вручную`, 'warning');
            } else {
              window.utils?.showToast(`Получено наград: ${claimed}`, 'success');
            }
            if (claimed > 0) setTimeout(() => this.loadDrops(), 2000);
          } catch (error) {
            console.error('Error claiming all drops:', error);
            window.utils?.showToast('Ошибка получения наград', 'error');
          } finally {
            claimAllBtn.disabled = false;
            claimAllBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Получить все награды';
          }
        });
      }
    }

    setupDropCardClickHandlers() {
      // Используем делегирование событий на document
      document.addEventListener('click', (e) => {
        // Кнопка «Забрать» лежит внутри карточки дропа. Раньше клик по ней
        // ещё и открывал окно награды поверх, поэтому кнопку разбираем
        // первой и окно в этом случае не открываем.
        const claimBtn = e.target.closest('[data-claim-drop]');
        if (claimBtn) {
          window.claimDropNow(claimBtn.dataset.claimDrop, claimBtn, e);
          return;
        }

        // Свой класс, а не общий .drop-card-clickable: на тот же класс
        // подписан и делегат страницы фарминга на document, и каждый клик
        // здесь строил окно награды дважды.
        const dropCard = e.target.closest('.drops-page-drop-card');
        if (dropCard && dropCard.dataset.drop) {
          try {
            const drop = JSON.parse(decodeURIComponent(dropCard.dataset.drop));
            const campaign = dropCard.dataset.campaign ? JSON.parse(decodeURIComponent(dropCard.dataset.campaign)) : null;
            this.showDropDetailModal(drop, campaign);
          } catch (error) {
            console.error('Error parsing drop data:', error);
          }
        }
      }, { signal: this._abort.signal });
    }

    /**
     * Почему инвентарь не пришёл, или null, если ответ настоящий.
     *
     * Без cookie-токена, на паузе Twitch и при сбое main отдаёт пустой список
     * кампаний с флагом. Раньше страница принимала его за «дропсов нет» —
     * пользователь думал, что кампаний нет, хотя данные просто не получены.
     */
    describeUnavailable(data) {
      if (!data || !Array.isArray(data.campaigns)) return 'Ошибка запроса к Twitch, обновлю позже';
      if (data.needsStream) return 'Запустите стрим — Twitch отдаёт инвентарь только после этого';
      if (data.rateLimited) return 'Twitch просит паузу, обновлю позже';
      if (data.error) return 'Ошибка запроса к Twitch, обновлю позже';
      return null;
    }

    showEmptyState(el, text) {
      if (!el) return;
      el.textContent = text;
      el.style.display = 'block';
    }

    async loadDrops(options = {}) {
      // Таймер или поздний ответ уже ушедшей страницы не должен рисовать
      // в разметке чужой
      if (this._destroyed) return;

      const loadingEl = document.getElementById('loadingState');
      const containerEl = document.getElementById('campaignsContainer');
      const emptyEl = document.getElementById('emptyState');

      // Фоновое обновление не стирает список заранее: иначе раз в пять
      // минут он пропадал до ответа Twitch и прокрутка прыгала наверх.
      const hadCampaigns = this.campaigns.length > 0;
      const quiet = hadCampaigns && !options.force;

      if (!quiet) {
        if (loadingEl) loadingEl.style.display = 'block';
        if (containerEl) containerEl.innerHTML = '';
      }
      if (emptyEl) emptyEl.style.display = 'none';

      try {
        console.log('Fetching drops inventory...');
        const data = await window.electronAPI.fetchDropsInventory(options.force ? { force: true } : undefined);
        console.log('Drops data received:', data);
        if (this._destroyed) return;

        const unavailable = this.describeUnavailable(data);
        if (unavailable) {
          // Незнание — не повод стирать то, что уже показано, и обнулять
          // счётчики: оставляем прежний список, а без него объясняем причину.
          console.log('[Дропсы] Инвентарь недоступен:', unavailable);
          if (hadCampaigns) {
            if (!quiet) this.renderCampaigns();
            if (options.force) window.utils?.showToast(unavailable, 'warning');
          } else {
            this.showEmptyState(emptyEl, unavailable);
          }
          return;
        }

        this.campaigns = data.campaigns;
        this.claimedDrops = data.claimedDrops || [];
        this.updateStats();
        if (data.campaigns.length > 0) {
          this.renderCampaigns();
        } else {
          if (containerEl) containerEl.innerHTML = '';
          document.getElementById('completedDropsBlock')?.remove();
          this.showEmptyState(emptyEl, this.i18n.t('drops.noCampaigns'));
        }
      } catch (error) {
        console.error('Error loading drops:', error);
        if (this._destroyed) return;
        if (hadCampaigns) {
          if (!quiet) this.renderCampaigns();
          // Ручное обновление без ответа: прежний список вернулся молча,
          // и казалось, что данные свежие
          if (options.force) window.utils?.showToast('Ошибка загрузки дропсов', 'warning');
        } else {
          this.showEmptyState(emptyEl, 'Ошибка загрузки дропсов');
        }
      } finally {
        if (loadingEl) loadingEl.style.display = 'none';
      }
    }

    updateStats() {
      // Функция для определения завершен ли дроп
      const isDropEarned = (drop) => {
        return !!(
          drop.claimed ||
          drop.canClaim ||
          drop.isClaimable ||
          drop.claimable ||
          drop.isUnlocked ||
          (drop.required > 0 && drop.progress >= drop.required)
        );
      };
      
      // Функция для определения завершена ли кампания
      const isCampaignCompleted = (campaign) => {
        if (!campaign.drops || campaign.drops.length === 0) return false;
        return campaign.drops.every(drop => isDropEarned(drop));
      };
      
      // Функция для определения истёк ли срок кампании
      const isCampaignExpired = (campaign) => {
        if (!campaign.endsAt) return false;
        const now = new Date();
        const end = new Date(campaign.endsAt);
        return end < now;
      };
      
      // Подсчитываем статистику
      let totalClaimedDrops = 0;
      let completedCampaigns = 0;
      let activeCampaigns = 0;
      
      this.campaigns.forEach(campaign => {
        
        // Считаем завершенные кампании
        const isCompleted = isCampaignCompleted(campaign) || isCampaignExpired(campaign);
        if (isCompleted) {
          completedCampaigns++;
        } else {
          activeCampaigns++;
        }
      });
      
      // Полученные дропсы считаем по инвентарю, а не по активным кампаниям.
      //
      // Раньше суммировались только те награды, что помечены полученными
      // внутри кампаний, показанных на странице, — а там лежат лишь текущие
      // активные. Всё, что собрано в завершившихся кампаниях, в счётчик не
      // попадало, и цифра выходила заметно меньше реальной.
      totalClaimedDrops = Array.isArray(this.claimedDrops) && this.claimedDrops.length > 0
        ? this.claimedDrops.length
        : this.campaigns.reduce((sum, campaign) =>
            sum + (campaign.drops || []).filter(d => d.claimed).length, 0);

      // Обновляем элементы на странице
      const totalClaimedEl = document.getElementById('totalClaimedDrops');
      const completedCampaignsEl = document.getElementById('completedCampaignsCount');
      const activeCampaignsEl = document.getElementById('activeCampaignsCount');
      
      if (totalClaimedEl) totalClaimedEl.textContent = totalClaimedDrops;
      if (completedCampaignsEl) completedCampaignsEl.textContent = completedCampaigns;
      if (activeCampaignsEl) activeCampaignsEl.textContent = activeCampaigns;
    }

    // Заработан ли дроп — та же логика, что в farming-page.js
    isDropEarned(drop) {
      return !!(
        drop.claimed ||
        drop.canClaim ||
        drop.isClaimable ||
        drop.claimable ||
        drop.isUnlocked ||
        (drop.required > 0 && drop.progress >= drop.required)
      );
    }

    /**
     * Общий прогресс кампании: среднее по процентам всех её дропов.
     *
     * Карточка раньше считала только целиком заработанные дропы и при
     * первом дропе на 95% показывала 0% — будто прогресса нет, хотя
     * сайдбар и сортировка видели почти готовую награду.
     */
    getCampaignProgress(campaign) {
      if (!campaign.drops || campaign.drops.length === 0) return 0;
      let totalProgress = 0;
      campaign.drops.forEach(drop => {
        const earned = this.isDropEarned(drop);
        const dropPercent = earned ? 100 : (drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0);
        totalProgress += dropPercent;
      });
      return Math.floor(totalProgress / campaign.drops.length);
    }

    renderCampaigns() {
      const container = document.getElementById('campaignsContainer');
      if (!container) return;
      
      container.innerHTML = '';
      
      // Удаляем старый блок завершенных дропсов если он есть
      const oldCompletedBlock = document.getElementById('completedDropsBlock');
      if (oldCompletedBlock) {
        oldCompletedBlock.remove();
      }
      
      // Функция для определения завершен ли дроп (как в farming-page.js)
      const isDropEarned = (drop) => {
        return !!(
          drop.claimed ||
          drop.canClaim ||
          drop.isClaimable ||
          drop.claimable ||
          drop.isUnlocked ||
          (drop.required > 0 && drop.progress >= drop.required)
        );
      };
      
      // Функция для определения завершена ли кампания
      const isCampaignCompleted = (campaign) => {
        if (!campaign.drops || campaign.drops.length === 0) return false;
        return campaign.drops.every(drop => isDropEarned(drop));
      };
      
      // Функция для определения истёк ли срок кампании
      const isCampaignExpired = (campaign) => {
        if (!campaign.endsAt) return false;
        const now = new Date();
        const end = new Date(campaign.endsAt);
        return end < now;
      };
      
      // Разделяем на активные (в процессе) и завершенные (100% ИЛИ истёк срок)
      const activeCampaigns = [];
      const completedCampaigns = [];
      
      this.campaigns.forEach(campaign => {
        // Кампания считается завершенной если все дропсы получены ИЛИ истёк срок
        if (isCampaignCompleted(campaign) || isCampaignExpired(campaign)) {
          completedCampaigns.push(campaign);
        } else {
          activeCampaigns.push(campaign);
        }
      });
      
      // Сортируем активные кампании по прогрессу (от большего к меньшему)
      activeCampaigns.sort((a, b) => this.getCampaignProgress(b) - this.getCampaignProgress(a));
      
      // Активные кампании (в процессе)
      if (activeCampaigns.length > 0) {
        activeCampaigns.forEach(campaign => {
          const card = this.createCampaignCard(campaign, false);
          container.appendChild(card);
        });
      }
      
      // Завершенные кампании (100%) - ВЫХОДИМ ИЗ CONTAINER, создаем отдельный блок
      if (completedCampaigns.length > 0) {
        // Находим родительский контейнер (progressTab)
        const progressTab = document.getElementById('progressTab');
        if (progressTab) {
          // Создаем полностью отдельный блок
          const completedBlock = document.createElement('div');
          completedBlock.id = 'completedDropsBlock';
          completedBlock.className = 'card';
          completedBlock.style.cssText = 'margin-top: 30px;';
          
          completedBlock.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; cursor: pointer;" id="completedDropsHeader">
              <h2 style="color: var(--text-secondary); font-size: 18px; font-weight: 600; margin: 0;">Завершенные дропсы <span style="opacity: 0.6; font-size: 14px;">(${completedCampaigns.length})</span></h2>
              <svg id="completedDropsArrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary); transition: transform 0.3s;">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
            <div id="completedCampaignsContainer" style="display: none; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px;"></div>
          `;
          
          progressTab.appendChild(completedBlock);
          
          // Добавляем обработчик сворачивания
          const header = completedBlock.querySelector('#completedDropsHeader');
          const contentContainer = completedBlock.querySelector('#completedCampaignsContainer');
          const arrow = completedBlock.querySelector('#completedDropsArrow');
          
          header.addEventListener('click', () => {
            if (contentContainer.style.display === 'none') {
              contentContainer.style.display = 'grid';
              arrow.style.transform = 'rotate(180deg)';
            } else {
              contentContainer.style.display = 'none';
              arrow.style.transform = 'rotate(0deg)';
            }
          });
          
          completedCampaigns.forEach(campaign => {
            const isExpired = isCampaignExpired(campaign);
            const card = this.createCampaignCard(campaign, true, isExpired);
            contentContainer.appendChild(card);
          });
        }
      }
    }

    createCampaignCard(campaign, isCompleted, isExpired = false) {
      const card = document.createElement('div');
      card.className = 'campaign-card';
      card.style.cssText = `background: rgba(0,0,0,0.2); border-radius: var(--radius-md); overflow: visible; margin-bottom: 20px; transition: border 0.2s; border: 2px solid transparent; transform: none !important; box-shadow: none !important; ${isCompleted ? 'opacity: 0.85;' : ''}`;
      
      // Добавляем обработчики hover только для обводки
      card.addEventListener('mouseenter', () => {
        card.style.border = '2px solid rgba(124, 92, 255,0.6)';
        card.style.transform = 'none';
        card.style.boxShadow = 'none';
      });
      card.addEventListener('mouseleave', () => {
        card.style.border = '2px solid transparent';
        card.style.transform = 'none';
        card.style.boxShadow = 'none';
      });
      
      // Время до конца или статус завершения
      let timeText = '';
      if (campaign.endsAt) {
        const now = new Date();
        const end = new Date(campaign.endsAt);
        const diff = end - now;
        
        if (diff < 0) {
          const daysSince = Math.floor(Math.abs(diff) / (1000 * 60 * 60 * 24));
          if (daysSince > 0) {
            timeText = `Завершено ${daysSince}д назад`;
          } else {
            const hoursSince = Math.floor(Math.abs(diff) / (1000 * 60 * 60));
            timeText = hoursSince > 0 ? `Завершено ${hoursSince}ч назад` : 'Завершено';
          }
        } else {
          const days = Math.floor(diff / (1000 * 60 * 60 * 24));
          const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          
          if (days > 0) {
            timeText = `${this.i18n.t('drops.remaining')}: ${days}${this.i18n.t('common.days')} ${hours}${this.i18n.t('common.hours')}`;
          } else if (hours > 0) {
            timeText = `${this.i18n.t('drops.remaining')}: ${hours}${this.i18n.t('common.hours')} ${minutes}${this.i18n.t('common.minuteShort')}`;
          } else {
            timeText = `${this.i18n.t('drops.remaining')}: ${minutes}${this.i18n.t('common.minuteShort')}`;
          }
        }
      }
      
      // Прогресс - используем ту же логику что и в farming-page.js.
      // Подпись «N из M» считает целые дропы, а полоса и процент —
      // взвешенный общий прогресс, как в сайдбаре.
      const totalDrops = campaign.drops ? campaign.drops.length : 0;
      const completedDrops = campaign.drops ? campaign.drops.filter(d => this.isDropEarned(d)).length : 0;
      const progressPercent = this.getCampaignProgress(campaign);
      
      // Превью игры
      // Обложку берём из любого доступного поля: у кампаний из разных
      // запросов Twitch она лежит по-разному, и раньше при отсутствии
      // boxArtURL карточка оставалась просто тёмной
      const rawCover = campaign.game?.boxArtURL
        || campaign.game?.boxArtUrl
        || campaign.imageUrl
        || campaign.boxArtURL
        || '';
      const gameImage = rawCover
        ? safeImageUrl(rawCover.replace('{width}', '300').replace('{height}', '400'))
        : '';

      // Дополнительная информация.
      // main отдаёт начало как startsAt; читали только startAt, и срок
      // кампании на карточке не выводился вовсе.
      const startRaw = campaign.startsAt || campaign.startAt;
      const startDate = startRaw ? new Date(startRaw).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
      const endDate = campaign.endsAt ? new Date(campaign.endsAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
      
      card.innerHTML = `
        <div style="position: relative; height: 180px; background-color: rgba(0, 0, 0, 0.3); ${gameImage ? `background-image: linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), url('${esc(gameImage)}');` : ''} background-size: cover; background-position: center; display: flex; flex-direction: column; justify-content: flex-end; padding: 20px;">
          <div style="color: #fff; font-size: 20px; font-weight: 700; margin-bottom: 6px; text-shadow: 0 2px 8px rgba(0,0,0,0.8);">${esc(campaign.name || 'Кампания')}</div>
          <div style="color: rgba(255,255,255,0.9); font-size: 14px; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">${esc(campaign.game?.name || 'Неизвестная игра')}</div>
          ${startDate && endDate ? `<div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-top: 4px; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">${startDate} — ${endDate}</div>` : ''}
          ${timeText ? `<div style="color: rgba(255,255,255,0.85); font-size: 13px; margin-top: 6px; font-weight: 600; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">${timeText}</div>` : ''}
          ${isExpired ? '<div style="position: absolute; top: 15px; right: 15px; background: rgba(255,255,255,0.15); color: #fff; padding: 6px 14px; border-radius: var(--radius-md); font-size: 12px; font-weight: 700; backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.2);">Завершено</div>' : (isCompleted ? '<div style="position: absolute; top: 15px; right: 15px; background: rgba(53, 208, 138,0.2); color: #35d08a; padding: 6px 14px; border-radius: var(--radius-md); font-size: 12px; font-weight: 700; backdrop-filter: blur(8px); border: 1px solid rgba(53, 208, 138,0.4); display: inline-flex; align-items: center; gap: 4px;">' + CHECK_ICON + ' 100%</div>' : '')}
        </div>
        
        <div style="padding: 20px; overflow: visible;">
          <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: var(--text-secondary); font-size: 14px; font-weight: 600;">${completedDrops} ${this.i18n.t('common.of')} ${totalDrops} ${this.i18n.t('drops.claimed').toLowerCase()}</span>
              <span style="color: ${progressPercent === 100 ? '#35d08a' : 'var(--accent-color)'}; font-size: 14px; font-weight: 700;">${progressPercent}%</span>
            </div>
            <div class="campaign-progress-container" style="position: relative;">
              <div class="campaign-progress-bar" style="background: rgba(255,255,255,0.08); height: 10px; border-radius: var(--radius-sm); overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.3); cursor: pointer;">
                <div style="background: ${progressPercent === 100 ? '#35d08a' : '#7c5cff'} !important; height: 100%; width: ${progressPercent}%; transition: width 0.5s ease; box-shadow: 0 0 10px ${progressPercent === 100 ? 'rgba(53, 208, 138,0.5)' : 'rgba(124, 92, 255,0.5)'};"></div>
              </div>
              <div class="campaign-progress-tooltip" style="display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px; background: rgba(0,0,0,0.95); border: 1px solid rgba(124, 92, 255,0.3); border-radius: var(--radius-md); padding: 8px; z-index: 1000; backdrop-filter: blur(8px); min-width: 120px;">
                <div class="tooltip-drops-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap: 6px;">
                </div>
              </div>
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 12px;">
            ${campaign.drops && campaign.drops.length > 0 ? campaign.drops.map(drop => this.createDropElement(drop)).join('') : '<div style="color: var(--text-secondary); padding: 20px; text-align: center;">Нет дропсов</div>'}
          </div>
        </div>
      `;
      
      // Добавляем обработчики для tooltip прогресс-бара
      const progressBar = card.querySelector('.campaign-progress-bar');
      const tooltip = card.querySelector('.campaign-progress-tooltip');
      const tooltipGrid = card.querySelector('.tooltip-drops-grid');
      
      console.log('Campaign:', campaign.name, 'progressBar:', !!progressBar, 'tooltip:', !!tooltip, 'tooltipGrid:', !!tooltipGrid, 'drops:', campaign.drops?.length);
      
      if (progressBar && tooltip && tooltipGrid && campaign.drops && campaign.drops.length > 0) {
        progressBar.addEventListener('mouseenter', () => {
          console.log('Tooltip mouseenter, drops:', campaign.drops.length);
          // Очищаем и заполняем tooltip изображениями дропсов
          tooltipGrid.innerHTML = '';
          campaign.drops.forEach((drop, index) => {
            const imageUrl = drop.imageURL || drop.imageUrl || window.DROP_PLACEHOLDER;
            console.log(`Drop ${index}:`, drop.benefitName, 'imageUrl:', imageUrl);
            const dropImg = document.createElement('img');
            dropImg.src = imageUrl;
            dropImg.style.cssText = 'width: 48px; height: 48px; border-radius: var(--radius-sm); object-fit: cover; border: 1px solid rgba(124, 92, 255,0.2); transition: transform 0.2s ease;';
            dropImg.addEventListener('mouseenter', () => {
              dropImg.style.transform = 'scale(1.1)';
              dropImg.style.borderColor = 'rgba(124, 92, 255,0.6)';
            });
            dropImg.addEventListener('mouseleave', () => {
              dropImg.style.transform = 'scale(1)';
              dropImg.style.borderColor = 'rgba(124, 92, 255,0.2)';
            });
            tooltipGrid.appendChild(dropImg);
          });
          tooltip.style.display = 'block';
          // Анимация появления
          tooltip.style.opacity = '0';
          tooltip.style.transition = 'opacity 0.2s ease';
          setTimeout(() => {
            tooltip.style.opacity = '1';
          }, 0);
        });
        
        progressBar.addEventListener('mouseleave', () => {
          tooltip.style.opacity = '0';
          setTimeout(() => {
            tooltip.style.display = 'none';
          }, 200);
        });
      }
      
      return card;
    }

    createDropElement(drop) {
      const imageUrl = safeImageUrl(drop.imageURL) || window.DROP_PLACEHOLDER;
      const percentage = Number(drop.percentage) || 0;
      const benefitName = esc(drop.benefitName || 'Награда');
      const isClaimed = drop.claimed || false;
      const canClaim = !isClaimed && percentage >= 100 && drop.dropInstanceID;
      const progress = drop.progress || 0;
      const required = drop.required || 0;
      const remaining = Math.max(0, required - progress);
      
      // Находим кампанию для этого дропа
      const dropCampaign = this.campaigns.find(c => 
        c.drops && c.drops.some(d => 
          (d.benefitId && d.benefitId === drop.benefitId) || 
          (d.id && d.id === drop.id)
        )
      );
      
      let statusBadge = '';
      let bottomSection = '';
      
      // Сохраняем данные дропа и кампании для клика
      const dropDataStr = encodeURIComponent(JSON.stringify(drop));
      const campaignDataStr = dropCampaign ? encodeURIComponent(JSON.stringify(dropCampaign)) : '';
      
      if (isClaimed) {
        // Получено - бадж внизу над картинкой
        bottomSection = `
          <div style="background: rgba(0,0,0,0.85); padding: 8px;">
            <div style="background: rgba(53, 208, 138,0.95); padding: 4px; text-align: center; font-size: 9px; font-weight: 600; color: #000; text-transform: uppercase; letter-spacing: 0.5px; border-radius: var(--radius-sm); margin-bottom: 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${CHECK_ICON} Получено</div>
            <div style="color: rgba(255,255,255,0.7); font-size: 10px; font-weight: 600; text-align: center;">${benefitName}</div>
          </div>
        `;
      } else if (canClaim) {
        // Готово к получению.
        // Без инлайн-onclick: id дропа от Twitch подставлялся прямо в код
        // обработчика. Клик разбирает делегат в setupDropCardClickHandlers.
        bottomSection = `
          <div style="background: rgba(0,0,0,0.85); padding: 8px;">
            <div style="color: rgba(255,255,255,0.9); font-size: 10px; font-weight: 600; margin-bottom: 6px; text-align: center;">${benefitName}</div>
            <button type="button" data-claim-drop="${esc(drop.dropInstanceID)}" style="width: 100%; background: #7c5cff; color: white; border: none; padding: 6px; border-radius: var(--radius-sm); font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;">${this.i18n.t('farming.claim')}</button>
          </div>
        `;
      } else {
        // В процессе
        bottomSection = `
          <div style="background: rgba(0,0,0,0.9); padding: 8px;">
            <div style="color: rgba(255,255,255,0.9); font-size: 10px; font-weight: 600; margin-bottom: 6px; text-align: center;">${benefitName}</div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: rgba(255,255,255,0.7); font-size: 9px;">${percentage}%</span>
              <span style="color: rgba(255,255,255,0.5); font-size: 9px;">${remaining} мин</span>
            </div>
            <div style="background: rgba(255,255,255,0.1); height: 4px; border-radius: var(--radius-sm); overflow: hidden;">
              <div style="background: #7c5cff; height: 100%; width: ${percentage}%; transition: width 0.5s ease;"></div>
            </div>
          </div>
        `;
      }
      
      return `
        <div class="drops-page-drop-card" data-drop="${dropDataStr}" data-campaign="${campaignDataStr}" style="
          position: relative; 
          background: rgba(0,0,0,0.3); 
          border-radius: var(--radius-md); 
          overflow: hidden;
          cursor: pointer;
          ${isClaimed ? 'opacity: 0.7;' : ''}
        "
        onmouseenter="this.querySelector('.flip-container').style.transform='rotateY(180deg)';" 
        onmouseleave="this.querySelector('.flip-container').style.transform='rotateY(0deg)';">
          
          <!-- Картинка с простым flip эффектом -->
          <div style="perspective: 1000px; aspect-ratio: 1; ${isClaimed ? 'filter: grayscale(0.4);' : ''}">
            <div class="flip-container" style="
              position: relative;
              width: 100%;
              height: 100%;
              transition: transform 0.6s;
              transform-style: preserve-3d;
            ">
              
              <!-- Front -->
              <div style="
                position: absolute;
                width: 100%;
                height: 100%;
                backface-visibility: hidden;
                background: url('${esc(imageUrl)}');
                background-size: cover;
                background-position: center;
              "></div>
              
              <!-- Back - просто та же картинка перевернутая -->
              <div style="
                position: absolute;
                width: 100%;
                height: 100%;
                backface-visibility: hidden;
                transform: rotateY(180deg);
                background: url('${esc(imageUrl)}');
                background-size: cover;
                background-position: center;
              "></div>
            </div>
          </div>
          
          ${bottomSection}
        </div>
      `;
    }

    async loadInventory() {
      const loadingEl = document.getElementById('inventoryLoading');
      const containerEl = document.getElementById('inventoryContainer');
      const emptyEl = document.getElementById('inventoryEmpty');
      
      if (loadingEl) loadingEl.style.display = 'block';
      if (containerEl) containerEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'none';

      try {
        // Используем уже загруженные данные
        let claimedDrops = this.claimedDrops;
        
        if (!claimedDrops || claimedDrops.length === 0) {
          const data = await window.electronAPI.fetchDropsInventory();
          if (this._destroyed) return;
          // Недоступный инвентарь — не «инвентарь пуст»: говорим, почему
          // данных нет, и не затираем то, что уже было известно
          const unavailable = this.describeUnavailable(data);
          if (unavailable) {
            this.showEmptyState(emptyEl, unavailable);
            return;
          }
          claimedDrops = data.claimedDrops || [];
          this.claimedDrops = claimedDrops;
        }

        console.log('Inventory items:', claimedDrops.length);

        if (claimedDrops.length > 0) {
          this.renderInventory(claimedDrops);
        } else {
          this.showEmptyState(emptyEl, 'Инвентарь пуст');
        }
      } catch (error) {
        console.error('Error loading inventory:', error);
        this.showEmptyState(emptyEl, 'Ошибка загрузки инвентаря');
      } finally {
        if (loadingEl) loadingEl.style.display = 'none';
      }
    }

    renderInventory(claimedDrops) {
      const container = document.getElementById('inventoryContainer');
      if (!container) return;
      
      // Очищаем контейнер
      container.innerHTML = '';
      container.style.cssText = 'display: flex; flex-direction: column; gap: 20px;';
      
      console.log('Rendering inventory with', claimedDrops.length, 'claimed drops');
      
      // Собираем все полученные дропсы И готовые к получению
      const allDrops = [];

      // Настоящая дата получения лежит в инвентаре Twitch (lastAwardedAt)
      // по id награды. Раньше всем наградам текущих кампаний ставилось
      // «сейчас», и сортировка по дате выходила неверной.
      const awardedAt = new Map();
      (Array.isArray(claimedDrops) ? claimedDrops : []).forEach(c => {
        if (c?.id) awardedAt.set(c.id, c.lastAwardedAt || null);
      });

      // Дропсы из активных кампаний
      this.campaigns.forEach(campaign => {
        campaign.drops?.forEach(drop => {
          // Добавляем полученные дропсы
          if (drop.claimed) {
            allDrops.push({
              id: drop.benefitId || drop.id,
              dropInstanceID: drop.dropInstanceID,
              name: drop.benefitName || drop.name || 'Награда',
              image: drop.imageURL,
              game: campaign.game?.name || 'Неизвестно',
              claimedAt: awardedAt.get(drop.benefitId) || null,
              claimed: true,
              canClaim: false
            });
          }
          // Добавляем дропсы готовые к получению (100% но не claimed).
          // Даты у них нет: они ещё не получены, «недавно» было бы неправдой.
          else if (drop.percentage >= 100 && !drop.claimed) {
            allDrops.push({
              id: drop.benefitId || drop.id,
              dropInstanceID: drop.dropInstanceID,
              name: drop.benefitName || drop.name || 'Награда',
              image: drop.imageURL,
              game: campaign.game?.name || 'Неизвестно',
              claimedAt: null,
              claimed: false,
              canClaim: true
            });
          }
        });
      });

      // ВАЖНО: Добавляем ВСЕ полученные дропсы из claimedDrops (включая старые)
      // Эти дропсы могут быть из завершенных кампаний
      if (claimedDrops && Array.isArray(claimedDrops)) {
        claimedDrops.forEach(claimed => {
          // Проверяем не добавили ли мы уже этот дроп из активных кампаний
          if (!allDrops.find(d => d.id === claimed.id)) {
            // Название, игру и картинку берём из инвентаря, если main их
            // прислал; заглушки — только когда о награде не известно ничего
            allDrops.push({
              id: claimed.id,
              name: claimed.name || claimed.benefitName || 'Полученная награда',
              image: claimed.imageURL || claimed.imageAssetURL || null,
              game: claimed.game?.displayName || claimed.game?.name || 'Различные игры',
              claimedAt: claimed.lastAwardedAt || null,
              claimed: true
            });
          }
        });
      }

      // Сначала то, что ждёт действия (готово к получению), затем
      // полученные — новые сверху, награды без даты в конце
      const timeOf = (d) => {
        const t = d.claimedAt ? new Date(d.claimedAt).getTime() : NaN;
        return Number.isFinite(t) ? t : -Infinity;
      };
      allDrops.sort((a, b) => {
        if (!!a.canClaim !== !!b.canClaim) return a.canClaim ? -1 : 1;
        const ta = timeOf(a);
        const tb = timeOf(b);
        return ta === tb ? 0 : (tb > ta ? 1 : -1);
      });
      
      // Получаем уникальные игры для фильтра
      const uniqueGames = [...new Set(allDrops.map(d => d.game))].sort();
      
      // Создаем фильтры
      const filtersSection = document.createElement('div');
      filtersSection.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 15px;';
      
      // Кнопка "Все"
      const allFilterBtn = document.createElement('button');
      allFilterBtn.textContent = 'Все';
      allFilterBtn.className = 'btn btn-secondary';
      allFilterBtn.style.cssText = `font-size: 12px; padding: 6px 12px; white-space: nowrap; ${this.inventoryFilter === 'all' ? 'background: rgba(124, 92, 255,0.5);' : ''}`;
      allFilterBtn.onclick = () => {
        this.inventoryFilter = 'all';
        this.inventoryGameFilter = null;
        this.inventoryPage = 1;
        this.renderInventory(this.claimedDrops);
      };
      filtersSection.appendChild(allFilterBtn);
      
      // Ограничиваем количество показываемых игр
      const maxVisibleGames = 8;
      const gamesToShow = this.showAllGames ? uniqueGames : uniqueGames.slice(0, maxVisibleGames);
      const hasMoreGames = uniqueGames.length > maxVisibleGames;
      
      // Кнопки для каждой игры
      gamesToShow.forEach(game => {
        const gameBtn = document.createElement('button');
        gameBtn.textContent = game;
        gameBtn.className = 'btn btn-secondary';
        const isActive = this.inventoryFilter === 'game' && this.inventoryGameFilter === game;
        gameBtn.style.cssText = `font-size: 12px; padding: 6px 12px; white-space: nowrap; ${isActive ? 'background: rgba(124, 92, 255,0.5);' : ''}`;
        gameBtn.onclick = () => {
          this.inventoryFilter = 'game';
          this.inventoryGameFilter = game;
          this.inventoryPage = 1;
          this.renderInventory(this.claimedDrops);
        };
        filtersSection.appendChild(gameBtn);
      });
      
      // Кнопка "Показать ещё" / "Скрыть" для игр
      if (hasMoreGames) {
        const toggleGamesBtn = document.createElement('button');
        toggleGamesBtn.style.cssText = `
          font-size: 12px; 
          padding: 6px 12px; 
          display: inline-flex; 
          align-items: center; 
          gap: 6px;
          background: rgba(124, 92, 255,0.12);
          border: 1px solid rgba(124, 92, 255,0.25);
          color: var(--accent-color);
          font-weight: 500;
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all 0.2s;
        `;
        
        const updateToggleGamesBtn = () => {
          if (this.showAllGames) {
            toggleGamesBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate(180deg);">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <span>Скрыть</span>
            `;
          } else {
            toggleGamesBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <span>+${uniqueGames.length - maxVisibleGames}</span>
            `;
          }
        };
        
        updateToggleGamesBtn();
        
        toggleGamesBtn.onmouseenter = () => {
          toggleGamesBtn.style.background = 'rgba(124, 92, 255,0.2)';
          toggleGamesBtn.style.borderColor = 'rgba(124, 92, 255,0.4)';
        };
        
        toggleGamesBtn.onmouseleave = () => {
          toggleGamesBtn.style.background = 'rgba(124, 92, 255,0.12)';
          toggleGamesBtn.style.borderColor = 'rgba(124, 92, 255,0.25)';
        };
        
        toggleGamesBtn.onclick = () => {
          this.showAllGames = !this.showAllGames;
          this.renderInventory(this.claimedDrops);
        };
        
        filtersSection.appendChild(toggleGamesBtn);
      }
      
      container.appendChild(filtersSection);
      
      // Применяем фильтры
      let filteredDrops = allDrops;
      if (this.inventoryFilter === 'game' && this.inventoryGameFilter) {
        filteredDrops = allDrops.filter(d => d.game === this.inventoryGameFilter);
      }
      
      // Пагинация
      const startIndex = 0;
      const endIndex = this.inventoryPage * this.inventoryPageSize;
      const displayDrops = filteredDrops.slice(startIndex, endIndex);
      const hasMore = endIndex < filteredDrops.length;
      
      // Создаем grid для дропсов
      const grid = document.createElement('div');
      grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 14px;';
      
      displayDrops.forEach(drop => {
        const card = this.createInventoryDropCard(drop);
        grid.appendChild(card);
      });
      
      container.appendChild(grid);
      
      // Кнопка "Показать еще" для дропсов
      if (hasMore) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.textContent = 'Показать ещё дропсы';
        loadMoreBtn.style.cssText = `
          width: 100%;
          font-size: 14px; 
          padding: 12px 16px; 
          display: flex; 
          align-items: center; 
          justify-content: center;
          gap: 8px;
          background: rgba(124, 92, 255,0.08);
          border: 1px solid rgba(124, 92, 255,0.2);
          color: var(--accent-color);
          font-weight: 600;
          cursor: pointer;
          border-radius: var(--radius-md);
          transition: all 0.25s ease;
          margin-top: 30px;
        `;
        
        loadMoreBtn.onmouseenter = () => {
          loadMoreBtn.style.background = 'rgba(124, 92, 255,0.15)';
          loadMoreBtn.style.borderColor = 'rgba(124, 92, 255,0.4)';
          loadMoreBtn.style.transform = 'translateY(-2px)';
          loadMoreBtn.style.boxShadow = '0 4px 12px rgba(124, 92, 255,0.2)';
        };
        
        loadMoreBtn.onmouseleave = () => {
          loadMoreBtn.style.background = 'rgba(124, 92, 255,0.08)';
          loadMoreBtn.style.borderColor = 'rgba(124, 92, 255,0.2)';
          loadMoreBtn.style.transform = 'translateY(0)';
          loadMoreBtn.style.boxShadow = 'none';
        };
        
        loadMoreBtn.onclick = () => {
          this.inventoryPage++;
          this.renderInventory(this.claimedDrops);
        };
        container.appendChild(loadMoreBtn);
      }
    }

    createInventoryDropCard(drop) {
      const imageUrl = safeImageUrl(drop.image) || window.DROP_PLACEHOLDER;
      const timeAgo = drop.claimedAt ? this.getTimeAgo(drop.claimedAt) : '';
      
      // Находим кампанию для этого дропа
      const dropCampaign = this.campaigns.find(c => 
        c.drops && c.drops.some(d => 
          (d.benefitId && d.benefitId === drop.id) || 
          (d.id && d.id === drop.id)
        )
      );
      
      const card = document.createElement('div');
      // Свой класс: на .drop-card-clickable слушает и страница фарминга
      card.className = 'drops-page-drop-card';
      card.dataset.drop = encodeURIComponent(JSON.stringify(drop));
      card.dataset.campaign = dropCampaign ? encodeURIComponent(JSON.stringify(dropCampaign)) : '';
      card.style.cssText = 'position: relative; background: rgba(0,0,0,0.3); border-radius: var(--radius-md); overflow: hidden; cursor: pointer; border: 2px solid transparent; transition: border 0.3s;';
      
      // Анимация flip с подсветкой
      card.onmouseenter = () => {
        card.style.border = '2px solid rgba(124, 92, 255,0.6)';
        card.style.boxShadow = '0 0 20px rgba(124, 92, 255,0.4)';
        const flipContainer = card.querySelector('.flip-container');
        if (flipContainer) flipContainer.style.transform = 'rotateY(180deg)';
      };
      card.onmouseleave = () => {
        card.style.border = '2px solid transparent';
        card.style.boxShadow = 'none';
        const flipContainer = card.querySelector('.flip-container');
        if (flipContainer) flipContainer.style.transform = 'rotateY(0deg)';
      };
      
      card.innerHTML = `
        <div style="perspective: 1000px; aspect-ratio: 1;">
          <div class="flip-container" style="position: relative; width: 100%; height: 100%; transition: transform 0.6s; transform-style: preserve-3d;">
            <!-- Front -->
            <div style="position: absolute; width: 100%; height: 100%; backface-visibility: hidden; background: url('${esc(imageUrl)}'); background-size: cover; background-position: center;"></div>
            
            <!-- Back -->
            <div style="position: absolute; width: 100%; height: 100%; backface-visibility: hidden; transform: rotateY(180deg); background: url('${esc(imageUrl)}'); background-size: cover; background-position: center;"></div>
          </div>
        </div>
        
        <div style="background: rgba(0,0,0,0.9); padding: 10px;">
          ${drop.claimed ? 
            `<div style="display: inline-flex; align-items: center; gap: 3px; background: rgba(0,200,83,0.15); color: #00c853; padding: 2px 6px; border-radius: var(--radius-sm); font-size: 9px; font-weight: 600; margin-bottom: 6px;">${CHECK_ICON} ${this.i18n.t('drops.claimed')}</div>` :
            (drop.canClaim && drop.dropInstanceID) ?
              `<button type="button" data-claim-drop="${esc(drop.dropInstanceID)}" style="width: 100%; background: #7c5cff; color: white; border: none; padding: 6px; border-radius: var(--radius-sm); font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase; margin-bottom: 6px;">${this.i18n.t('farming.claim')}</button>` :
              ''
          }
          <div style="color: #fff; font-size: 12px; font-weight: 600; margin-bottom: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${esc(drop.name)}">${esc(drop.name)}</div>
          <div style="color: rgba(255,255,255,0.6); font-size: 10px; margin-bottom: 4px;">${esc(drop.game)}</div>
          ${timeAgo ? `<div style="color: rgba(255,255,255,0.4); font-size: 9px;">${timeAgo}</div>` : ''}
        </div>
      `;
      
      return card;
    }

    getTimeAgo(dateString) {
      const now = new Date();
      const past = new Date(dateString);
      const diffMs = now - past;
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffWeeks = Math.floor(diffDays / 7);
      const diffMonths = Math.floor(diffDays / 30);
      const diffYears = Math.floor(diffDays / 365);
      
      // До 2 часов - показываем как "Недавно"
      if (diffMinutes < 120) {
        return 'Недавно';
      }
      // До 48 часов - показываем часы
      else if (diffHours < 48) {
        return diffHours === 1 ? '1 час назад' : `${diffHours} ${this.getPluralForm(diffHours, 'час', 'часа', 'часов')} назад`;
      }
      // До недели - показываем дни
      else if (diffDays < 7) {
        return diffDays === 1 ? '1 день назад' : `${diffDays} ${this.getPluralForm(diffDays, 'день', 'дня', 'дней')} назад`;
      }
      // До месяца - показываем недели
      else if (diffWeeks < 4) {
        return diffWeeks === 1 ? '1 неделю назад' : `${diffWeeks} ${this.getPluralForm(diffWeeks, 'неделю', 'недели', 'недель')} назад`;
      }
      // До года - показываем месяцы
      else if (diffMonths < 12) {
        return diffMonths === 1 ? '1 месяц назад' : `${diffMonths} ${this.getPluralForm(diffMonths, 'месяц', 'месяца', 'месяцев')} назад`;
      }
      // Больше года - показываем годы
      else {
        return diffYears === 1 ? '1 год назад' : `${diffYears} ${this.getPluralForm(diffYears, 'год', 'года', 'лет')} назад`;
      }
    }

    getPluralForm(number, one, two, five) {
      const n = Math.abs(number) % 100;
      const n1 = n % 10;
      if (n > 10 && n < 20) return five;
      if (n1 > 1 && n1 < 5) return two;
      if (n1 === 1) return one;
      return five;
    }

    // Вычисление редкости дропа
    calculateDropRarity(drop, campaign) {
      const requiredMinutes = drop.required || drop.requiredMinutesWatched || 0;
      const viewersCount = campaign?.game?.viewersCount || campaign?.viewersCount || 0;
      
      let rarity = this.rarityTiers[0];
      
      for (let tier of this.rarityTiers) {
        if (requiredMinutes >= tier.minMinutes && requiredMinutes <= tier.maxMinutes) {
          rarity = tier;
          break;
        }
      }
      
      if (viewersCount > 0 && viewersCount < rarity.minViewers) {
        const currentIndex = this.rarityTiers.indexOf(rarity);
        if (currentIndex < this.rarityTiers.length - 1) {
          rarity = this.rarityTiers[currentIndex + 1];
        }
      }
      
      // Число «владельцев» отсюда убрано: его выдумывала формула
      // max(зрители × 0,3; 10000) / k², а окно награды показывало его
      // как факт. Настоящих данных о владельцах Twitch не отдаёт.
      const difficulty = Math.min(10, Math.max(1, Math.ceil(requiredMinutes / 90)));

      return {
        ...rarity,
        requiredMinutes,
        viewersCount,
        difficulty
      };
    }

    formatViewersCount(count) {
      if (!count || count === 0) return '—';
      if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
      if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
      return count.toString();
    }

    // Показать модальное окно с деталями дропа
    showDropDetailModal(drop, campaign) {
      if (window.showDropDetailModal) {
        window.showDropDetailModal(drop, campaign, this);
      } else {
        console.error('Drop detail modal script not loaded');
      }
    }

    startAutoRefresh() {
      // init() асинхронный, поэтому сюда можно попасть уже после destroy():
      // без этой проверки каждый заход на страницу оставлял вечный таймер.
      if (this._destroyed) return;

      // Обновляем каждые 5 минут
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
      }
      this.updateTimer = setInterval(() => {
        this.loadDrops();
      }, 5 * 60 * 1000);
    }

    destroy() {
      this._destroyed = true;
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }
      // Контроллер не обнуляем: отменённый сигнал делает поздние
      // addEventListener безвредными пустышками.
      if (this._abort) {
        this._abort.abort();
      }
    }
  }

  // Глобальная функция для получения дропа.
  // Клик по кнопке не должен доходить до карточки и открывать окно награды.
  window.claimDropNow = async function(dropInstanceID, button, event) {
    event?.stopPropagation?.();
    if (!dropInstanceID || !button || button.disabled) return;

    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '...';

    try {
      const result = await window.electronAPI.claimDrop(dropInstanceID);

      if (result?.success) {
        button.innerHTML = CHECK_ICON + ' Получено';
        button.style.background = '#35d08a';
        button.style.color = '#000';
        window.utils?.showToast('Награда получена!', 'success');

        // Обновляем текущий экземпляр страницы, который создаёт роутер.
        // Раньше здесь был собственный экземпляр, созданный самим файлом:
        // его никто не уничтожал, и он жил вечно со своим таймером.
        setTimeout(() => {
          window.dropsPage?.loadDrops?.();
        }, 2000);
      } else {
        button.innerHTML = originalHTML;
        button.disabled = false;
        window.utils?.showToast(result?.error || 'Не удалось получить награду', 'error');
      }
    } catch (error) {
      console.error('Error claiming drop:', error);
      button.innerHTML = originalHTML;
      button.disabled = false;
      window.utils?.showToast('Ошибка получения награды', 'error');
    }
  };

  // Экспорт.
  // Экземпляр создаёт только роутер (window.dropsPage) и он же его
  // уничтожает. Раньше файл при загрузке создавал ещё и свой
  // window.dropsPageInstance: тот никогда не уничтожался, раз в пять минут
  // перерисовывал список, дважды ловил клики по карточкам и по
  // «Получить все награды» — награды запрашивались дважды.
  window.DropsPage = DropsPage;

  console.log('drops-page.js loaded successfully');
})();
