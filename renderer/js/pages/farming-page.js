// Farming page logic
class FarmingPage {
  constructor() {
    this.i18n = window.i18n;
    this.categories = [];
    this.updateInterval = null;
    this.dropsFilterEnabled = false;
    // sessionStartTime намеренно НЕ обнуляется: это свойство проксируется
    // в window.sessionState, который переживает пересоздание страницы.
    this.sessionInterval = null;
    this.statsUpdateInterval = null;
    this.estimatedBandwidth = 0;
    this.sessionBytes = 0;
    this.bandwidthHistory = [];
    this.streamStatsInterval = null;
    this.viewersHistory = [];
    this.currentCategory = null;
    this.currentStream = null;
    this.dropsMissingChecks = 0;
    this.activeSessionResumed = false;
    this.isEventListenersSetup = false;
    this._destroyed = false;
    this.streamInfoClickHandler = null;
    this.isStreamDetailsOpen = false;
    this.activeChatChannelLogin = null;
    this.manualPlayLockCategoryId = null;
    // Категория, запущенная пользователем вручную. Приложение не переключает
    // её самостоятельно — только предлагает.
    this.manualCategoryId = null;
    this.lastAutoDropsSyncAt = 0;
    this.autoDropsModeEnabled = false;

    this.rarityTiers = [
      { name: 'common', label: 'Обычный', minMinutes: 0, maxMinutes: 60, minViewers: 50000, color: '#888888', glow: 'rgba(136, 136, 136, 0.4)' },
      { name: 'uncommon', label: 'Необычный', minMinutes: 61, maxMinutes: 120, minViewers: 30000, color: '#00ff00', glow: 'rgba(0, 255, 0, 0.4)' },
      { name: 'rare', label: 'Редкий', minMinutes: 121, maxMinutes: 240, minViewers: 15000, color: '#0099ff', glow: 'rgba(0, 153, 255, 0.4)' },
      { name: 'epic', label: 'Эпический', minMinutes: 241, maxMinutes: 480, minViewers: 8000, color: '#9d00ff', glow: 'rgba(157, 0, 255, 0.4)' },
      { name: 'legendary', label: 'Легендарный', minMinutes: 481, maxMinutes: 720, minViewers: 3000, color: '#ff8800', glow: 'rgba(255, 136, 0, 0.4)' },
      { name: 'mythic', label: 'Мифический', minMinutes: 721, maxMinutes: 99999, minViewers: 0, color: '#ff0088', glow: 'rgba(255, 0, 136, 0.4)' }
    ];
    
    // Учёт баллов канала.
    //
    // Разделяем три величины, потому что интерфейс показывает разное:
    //   sessionEarned     — накоплено за всю сессию фарминга (переживает смену стрима)
    //   earnedThisStream  — накоплено на текущем стриме
    //   chests*/passive*  — разбивка по источнику: разовые сундуки против просмотра
    // channelPoints и sessionDropsCollected проксируются в window.sessionState:
    // учёт баллов должен переживать пересоздание страницы.

    this.init();
  }

  async init() {
    this.categories = await Storage.getCategories();
    this.autoDropsModeEnabled = await Storage.get('autoDropsModeEnabled', this.categories.some(cat => cat.autoDrops === true));
    this.renderCategories();
    this.setupEventListeners();
    this.startAutoUpdate();

    // Загружаем подписанные каналы и добавляем их в фарминг
    await this.loadAndAddSubscribedChannels();

    // Завершаем сессию при закрытии приложения (сохраняем активную сессию).
    // Подписка одна на всё приложение: страница пересоздаётся при каждой
    // навигации, а ipcRenderer.on не имеет автоснятия — иначе обработчики
    // копились бы бесконечно.
    if (!window._appClosingHooked &&
        window.electronAPI && typeof window.electronAPI.onAppClosing === 'function') {
      window._appClosingHooked = true;
      window.electronAPI.onAppClosing(() => {
        const page = window.farmingPage;
        if (page && page.sessionStartTime) {
          page.updateSessionInfo()
            .catch(() => {})
            .finally(() => page.stopFarming(false, true));
        }
      });
    }

    // Восстанавливаем активную сессию после перезапуска/переключения вкладок
    await this.resumeActiveSession();

    // Если есть авто-категории, автоматически запускаем фарминг (если не восстановили активную)
    if (!this.activeSessionResumed && this.categories.some(cat => cat.enabled) && (!window.streamingManager || !window.streamingManager.isFarmingActive || !window.streamingManager.isFarmingActive())) {
      this.startFarming();
    }

    if (window.streamingManager && window.streamingManager.isFarmingActive) {
      if (window.streamingManager.isFarmingActive()) {
        this.showFarmingState();
      }
    }
  }

  async loadAndAddSubscribedChannels() {
    try {
      const subscriptions = await Storage.getSubscriptions();
      if (!subscriptions || subscriptions.length === 0) {
        console.log('No subscriptions found');
        return;
      }

      let addedCount = 0;
      for (const sub of subscriptions) {
        // Проверяем есть ли уже эта категория (по login)
        const existingCategory = this.categories.find(
          c => c.name.toLowerCase() === sub.login.toLowerCase()
        );

        if (!existingCategory) {
          // Проверяем если у этого канала есть дропсы
          const hasDrops = await window.electronAPI.checkCategoryDrops(sub.login);
          
          // Добавляем категорию только если есть дропсы
          if (hasDrops) {
            const newCategory = {
              id: Date.now().toString() + Math.random(),
              name: sub.login,
              enabled: true,
              autoDrops: false,
              hasDrops: true,
              priority: 0,
              tags: [],
              viewersCount: 0,
              dropsCompleted: false
            };

            this.categories.push(newCategory);
            addedCount++;
            console.log('Added subscription channel to farming:', sub.login);
          }
        }
      }

      if (addedCount > 0) {
        await Storage.saveCategories(this.categories);
        this.renderCategories();
        console.log('Added', addedCount, 'subscription channels to farming');
      }
    } catch (error) {
      console.error('Error loading subscriptions:', error);
    }
  }

  isSingleManualPlayLocked(category = this.currentCategory) {
    if (!category || !this.manualPlayLockCategoryId) return false;
    if (category.id !== this.manualPlayLockCategoryId) return false;
    if (category.autoDrops) return false;

    const enabledCategories = this.categories.filter(cat => cat.enabled);
    return enabledCategories.length === 1 && enabledCategories[0].id === category.id;
  }

  setManualPlayLock(category) {
    if (!category || category.autoDrops) {
      this.manualPlayLockCategoryId = null;
      return;
    }

    const enabledCategories = this.categories.filter(cat => cat.enabled);
    const manualCategories = this.categories.filter(cat => !cat.autoDrops);

    if (enabledCategories.length === 1 && enabledCategories[0].id === category.id && manualCategories.length === 1) {
      this.manualPlayLockCategoryId = category.id;
      console.log('[ManualPlayLock] Enabled for category:', category.name);
      return;
    }

    this.manualPlayLockCategoryId = null;
  }

  buildActiveCampaignsMapFromCampaigns(campaignsData) {
    const activeCampaignsMap = new Map();
    const campaigns = Array.isArray(campaignsData)
      ? campaignsData
      : (Array.isArray(campaignsData?.campaigns) ? campaignsData.campaigns : []);

    if (!campaigns || campaigns.length === 0) {
      return activeCampaignsMap;
    }

    const now = Date.now();

    for (const campaign of campaigns) {
      const gameNameRaw = campaign?.game?.name || campaign?.game?.displayName || campaign?.game;
      if (!gameNameRaw) continue;

      const normalizedGameKey = this.normalizeGameKey(gameNameRaw);
      if (!normalizedGameKey) continue;

      const startAtRaw = campaign?.startAt || campaign?.startsAt;
      const endAtRaw = campaign?.endAt || campaign?.endsAt;
      const startAtMs = startAtRaw ? new Date(startAtRaw).getTime() : null;
      const endAtMs = endAtRaw ? new Date(endAtRaw).getTime() : null;

      if (startAtMs && startAtMs > now) continue;
      if (endAtMs && endAtMs <= now) continue;

      const status = String(campaign?.status || '').toUpperCase();
      if (status === 'EXPIRED') continue;

      const drops = Array.isArray(campaign.timeBasedDrops)
        ? campaign.timeBasedDrops
        : (Array.isArray(campaign.drops) ? campaign.drops : []);
      const totalDrops = drops.length;
      const completedDrops = drops.filter(drop => {
        const required = Number(drop.required) || Number(drop.requiredMinutes) || Number(drop.requiredMinutesWatched) || 0;
        const progress = Number(drop.progress) || 0;
        return !!drop.claimed || !!drop.isClaimed || (required > 0 && progress >= required);
      }).length;

      if (totalDrops > 0 && completedDrops >= totalDrops) {
        continue;
      }

      const progressPercent = totalDrops > 0
        ? Math.floor((completedDrops / totalDrops) * 100)
        : 0;

      activeCampaignsMap.set(normalizedGameKey, {
        campaign,
        progress: progressPercent
      });
    }

    return activeCampaignsMap;
  }

  async loadActiveCampaignsMap() {
    let campaigns = await window.electronAPI.fetchTwitchDrops();
    let campaignsMap = this.buildActiveCampaignsMapFromCampaigns(campaigns);

    // Fallback: если dashboard недоступен/пустой, используем inventory
    if (campaignsMap.size === 0) {
      const inventory = await window.electronAPI.fetchDropsInventory();
      campaignsMap = this.buildActiveCampaignsMapFromCampaigns(inventory);
    }

    return campaignsMap;
  }

  normalizeGameKey(name) {
    if (!name || typeof name !== 'string') return '';
    return name
      .toLowerCase()
      .trim()
      .replace(/[’'`]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  normalizeBoxArtURL(url, size = '52x72') {
    const fallback = `https://static-cdn.jtvnw.net/ttv-boxart/509658-${size}.jpg`;
    if (!url || typeof url !== 'string') return fallback;

    let normalized = url.trim();
    if (!normalized) return fallback;

    if (normalized.startsWith('//')) {
      normalized = `https:${normalized}`;
    }

    normalized = normalized.replace(/^http:\/\//i, 'https://');
    normalized = normalized
      .replace(/\{width\}x\{height\}/gi, size)
      .replace(/(-\d+x\d+)(\.[a-z0-9]+)(\?.*)?$/i, `-${size}$2$3`);

    if (!normalized.startsWith('https://static-cdn.jtvnw.net/ttv-boxart/')) {
      return fallback;
    }

    return normalized;
  }

  async syncAutoDropsCategoriesFromInventory(allCategories, activeCampaignsMap = null) {
    if (!this.autoDropsModeEnabled) return 0;

    const now = Date.now();
    if (now - this.lastAutoDropsSyncAt < 120000) {
      return 0;
    }
    this.lastAutoDropsSyncAt = now;

    let campaignsMap = activeCampaignsMap;
    if (!campaignsMap) {
      campaignsMap = await this.loadActiveCampaignsMap();
    }

    if (!campaignsMap || campaignsMap.size === 0) {
      return 0;
    }

    const categoriesByName = new Map(
      (allCategories || []).map(cat => [this.normalizeGameKey(cat.name), cat])
    );

    let addedCount = 0;
    let changedExisting = false;

    for (const [gameNameKey, campaignInfo] of campaignsMap.entries()) {
      const existing = this.categories.find(cat => this.normalizeGameKey(cat.name) === gameNameKey);
      const freshCategory = categoriesByName.get(gameNameKey);

      if (existing) {
        if (existing.autoDrops) {
          existing.hasDrops = true;
          existing.dropsCompleted = false;
          existing.enabled = true;
          existing.dropsProgressPercent = campaignInfo.progress;
          existing.dropsEndsAt = campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt;
          if (freshCategory?.viewersCount !== undefined) {
            existing.viewersCount = freshCategory.viewersCount;
          }
          if (freshCategory?.boxArtURL) {
            existing.boxArtURL = this.normalizeBoxArtURL(freshCategory.boxArtURL, '52x72');
          }
          changedExisting = true;
        }
        continue;
      }

      const newCategory = {
        id: freshCategory?.id || `${Date.now()}-${Math.random()}`,
        name: freshCategory?.name || campaignInfo.campaign?.game?.name || campaignInfo.campaign?.game?.displayName || campaignInfo.campaign?.game || gameNameKey,
        boxArtURL: this.normalizeBoxArtURL(freshCategory?.boxArtURL || campaignInfo.campaign?.imageUrl || campaignInfo.campaign?.game?.boxArtURL, '52x72'),
        viewersCount: freshCategory?.viewersCount || 0,
        tags: freshCategory?.tags || [],
        hasDrops: true,
        autoDrops: true,
        enabled: true,
        priority: this.categories.length + 1,
        dropsProgressPercent: campaignInfo.progress,
        dropsEndsAt: campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt,
        dropsCompleted: false
      };

      this.categories.push(newCategory);
      addedCount++;
    }

    if (addedCount > 0 || changedExisting) {
      await Storage.saveCategories(this.categories);
      this.renderCategories();
      this.updateAutoDropsButtonState();
    }

    if (addedCount > 0) {
      window.utils.showToast(`Автодобавлено новых категорий с дропсами: ${addedCount}`, 'success');
    }

    // Фарминг отсюда НЕ запускаем. Этот метод вызывается только из init(),
    // который сразу после него сам решает, надо ли стартовать. Отложенный
    // запуск отсюда давал второй параллельный старт — отсюда и брались
    // задвоенные уведомления «Ищем стрим…» и «Нет активных категорий…».

    return addedCount;
  }

  startAutoUpdate() {
    // Страница могла быть уничтожена, пока выполнялся асинхронный init()
    if (this._destroyed) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.updateInterval = setInterval(() => {
      this.updateCategoriesData();
    }, 30000);
  }

  async updateCategoriesData() {
    if (this.categories.length === 0 && !this.autoDropsModeEnabled) return;
    
    try {
      console.log('Updating categories data...');
      
      // Получаем свежие данные о категориях
      const allCategories = await window.electronAPI.fetchTwitchCategories();
      const activeCampaignsMap = await this.loadActiveCampaignsMap();
      const hasInventoryCampaigns = activeCampaignsMap.size > 0;
      
      let updated = false;
      let manualGainedDrops = false;
      
      // Обновляем данные наших сохраненных категорий
      for (let category of this.categories) {
        const freshData = allCategories.find(cat => cat.id === category.id);
        if (freshData) {
          const oldViewers = category.viewersCount;
          category.viewersCount = freshData.viewersCount;
          category.tags = freshData.tags || [];
          
          if (oldViewers !== freshData.viewersCount) {
            updated = true;
          }
        }
        
        // Проверяем наличие дропсов
        const prevHasDrops = !!category.hasDrops;
        const gameNameKey = this.normalizeGameKey(category.name || '');
        const campaignInfo = activeCampaignsMap.get(gameNameKey);

        let hasDrops = false;
        if (campaignInfo) {
          hasDrops = true;

          const prevProgress = category.dropsProgressPercent;
          const prevEndsAt = category.dropsEndsAt;

          category.dropsProgressPercent = campaignInfo.progress;
          category.dropsEndsAt = campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt;
          category.dropsCompleted = false;

          if (prevProgress !== category.dropsProgressPercent || prevEndsAt !== category.dropsEndsAt) {
            updated = true;
          }
        } else if (!hasInventoryCampaigns) {
          hasDrops = await window.electronAPI.checkCategoryDrops(category.name);
        }

        if (category.hasDrops !== hasDrops) {
          category.hasDrops = hasDrops;
          updated = true;
          // Отслеживаем: у ручной категории появились дропсы
          if (!category.autoDrops && hasDrops && !prevHasDrops) {
            manualGainedDrops = true;
          }
        }
      }
      
      // Авто‑категории без дропсов: удаляем из списка
      const beforeCount = this.categories.length;
      const currentId = this.currentCategory?.id;
      const toRemoveIds = this.categories
        .filter(cat => cat.autoDrops === true && cat.hasDrops === false && !cat.pinned)
        .map(c => c.id);
      if (toRemoveIds.length > 0) {
        // Если текущая категория среди удаляемых, переключаемся корректно
        if (currentId && toRemoveIds.includes(currentId)) {
          console.warn('Current auto category lost drops, switching...');
          await this.handleCategoryNoDrops();
        }
        // Удаляем прочие авто‑категории без дропсов
        // Закреплённые не удаляем никогда: закрепление означает «оставить».
        // Раньше закреплённая авто-категория без дропсов вычищалась вместе
        // с остальными и добавлялась заново уже без метки — со стороны это
        // выглядело так, будто закрепление слетает после перезапуска.
        const kept = this.categories.filter(cat => !(cat.autoDrops === true && cat.hasDrops === false && !cat.pinned));
        this.categories = kept;
        await Storage.saveCategories(this.categories);
        this.renderCategories();
        window.utils?.showToast(`Удалено авто‑категорий без дропсов: ${beforeCount - kept.length}`, 'info');
      }

      // Автоскан: добавляем новые категории с дропсами, пока включён автофарм
      await this.syncAutoDropsCategoriesFromInventory(allCategories, activeCampaignsMap);

      if (updated) {
        // Сохраняем обновленные данные
        await Storage.saveCategories(this.categories);
        
        // Перерисовываем список
        this.renderCategories();
        
        console.log('Categories data updated:', this.categories.map(c => `${c.name}: ${(c.viewersCount/1000).toFixed(1)}K`));

        // Приоритет пользователю: если сейчас активна авто‑категория, а у ручной появились дропсы — переключаемся
        if (this.currentCategory && this.currentCategory.autoDrops && manualGainedDrops) {
          console.log('Manual category gained drops; prioritizing manual category');
          await this.switchToNextEnabledCategory();
        }
      }
    } catch (error) {
      console.error('Error updating categories:', error);
    }
  }

  // Ручное обновление
  async manualUpdateCategories() {
    if (this.categories.length === 0) {
      window.utils.showToast('Нет категорий для обновления', 'warning');
      return;
    }
    
    window.utils.showToast('Обновление данных...', 'info');
    await this.updateCategoriesData();
    window.utils.showToast('Данные обновлены', 'success');
  }

  setupEventListeners() {
    // init() асинхронный — страница могла быть уничтожена, пока он выполнялся
    if (this._destroyed) return;

    // Проверяем, были ли уже установлены обработчики
    if (this.isEventListenersSetup) {
      console.log('Event listeners already setup, skipping');
      return;
    }
    this.isEventListenersSetup = true;

    // Все обработчики регистрируем через AbortController.
    // Часть целей (кнопки сайдбара, document) живёт вне страницы и переживает
    // навигацию — без снятия обработчиков каждый повторный заход на страницу
    // фарминга добавлял ещё один комплект: клик срабатывал многократно,
    // а старые экземпляры страницы не освобождались.
    if (this._listenerAbort) {
      this._listenerAbort.abort();
    }
    this._listenerAbort = new AbortController();
    const listenerSignal = this._listenerAbort.signal;
    const on = (el, type, handler) => {
      if (el) el.addEventListener(type, handler, { signal: listenerSignal });
    };

    // Используем setTimeout для гарантии, что DOM загружен
    setTimeout(() => {
      const addBtn = document.getElementById('add-category-btn');
      const addAllDropsBtn = document.getElementById('add-all-drops-btn');
      const dropsFilterBtn = document.getElementById('drops-filter-btn');
      const startBtn = document.getElementById('sidebar-start-farming-btn');
      const stopBtn = document.getElementById('sidebar-stop-farming-btn');
      const nextStreamBtn = document.getElementById('next-stream-btn');
      const prevCategoryBtn = document.getElementById('prev-category-btn');
      const nextCategoryBtn = document.getElementById('next-category-btn');
      const toggleChatBtn = document.getElementById('toggle-chat-btn');

      if (dropsFilterBtn) {
        on(dropsFilterBtn, 'click', () => {
          this.dropsFilterEnabled = !this.dropsFilterEnabled;
          
          if (this.dropsFilterEnabled) {
            dropsFilterBtn.style.background = 'var(--accent-color)';
            dropsFilterBtn.style.color = 'white';
          } else {
            dropsFilterBtn.style.background = '';
            dropsFilterBtn.style.color = '';
          }
          
          this.renderCategories();
        });
      } else {
        console.warn('drops-filter-btn not found');
      }

      if (addAllDropsBtn) {
        this.updateAutoDropsButtonState();
        on(addAllDropsBtn, 'click', async () => {
          await this.toggleAutoDropsCategories();
        });
      } else {
        console.warn('add-all-drops-btn not found');
      }

      if (addBtn) {
        on(addBtn, 'click', () => {
          this.showCategorySelector();
        });
      } else {
        console.warn('add-category-btn not found');
      }

      if (startBtn) {
        on(startBtn, 'click', () => {
          this.startFarming();
        });
      }

      if (stopBtn) {
        on(stopBtn, 'click', () => {
          this.stopFarming();
        });
      }

      // Навигация: следующий стрим
      if (nextStreamBtn) {
        on(nextStreamBtn, 'click', () => {
          this.switchToNextStream();
        });
      }

      // Навигация: предыдущая категория
      if (prevCategoryBtn) {
        on(prevCategoryBtn, 'click', () => {
          this.switchToPrevCategory();
        });
      }

      // Навигация: следующая категория
      if (nextCategoryBtn) {
        on(nextCategoryBtn, 'click', () => {
          this.switchToNextCategory();
        });
      }

      // Показать/скрыть чат
      if (toggleChatBtn) {
        on(toggleChatBtn, 'click', () => {
          this.toggleChat();
        });
      }
      
      // Подписаться на канал
      const followBtn = document.getElementById('follow-channel-btn');
      if (followBtn) {
        on(followBtn, 'click', () => {
          this.followCurrentChannel();
        });
      }
      
      // Уведомления
      const notificationsBtn = document.getElementById('notifications-btn');
      if (notificationsBtn) {
        on(notificationsBtn, 'click', () => {
          this.toggleNotifications();
        });
      }

      // Обработчик кликов по карточкам дропов
      on(document, 'click', (e) => {
        const dropCard = e.target.closest('.drop-card-clickable');
        if (dropCard) {
          const dropData = dropCard.getAttribute('data-drop');
          const campaignData = dropCard.getAttribute('data-campaign');
          
          if (dropData && campaignData) {
            try {
              const drop = JSON.parse(decodeURIComponent(dropData));
              const campaign = JSON.parse(decodeURIComponent(campaignData));

              if (!drop.imageURL && drop.imageUrl) {
                drop.imageURL = drop.imageUrl;
              }
              if (!drop.required && drop.requiredMinutes) {
                drop.required = drop.requiredMinutes;
              }
              
              this.showDropDetailModal(drop, campaign);
            } catch (err) {
              console.error('Ошибка при открытии модального окна с деталями дропа:', err);
            }
          }
        }
      });
    }, 100);
  }

  calculateDropRarity(drop, campaign) {
    const requiredMinutes = drop.required || drop.requiredMinutesWatched || 0;
    const viewersCount = campaign?.game?.viewersCount || campaign?.viewersCount || 0;

    let rarity = this.rarityTiers[0];

    for (const tier of this.rarityTiers) {
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

    const baseOwners = Math.max(viewersCount * 0.3, 10000);
    const rarityMultiplier = Math.pow(this.rarityTiers.indexOf(rarity) + 1, 2);
    const estimatedOwners = Math.floor(baseOwners / rarityMultiplier);

    const difficulty = Math.min(10, Math.max(1, Math.ceil(requiredMinutes / 90)));

    return {
      ...rarity,
      requiredMinutes,
      viewersCount,
      estimatedOwners: estimatedOwners > 1000 ? `${Math.floor(estimatedOwners / 1000)}K+` : `${estimatedOwners}+`,
      difficulty
    };
  }

  showDropDetailModal(drop, campaign) {
    if (typeof window.showDropDetailModal === 'function') {
      window.showDropDetailModal(drop, campaign, this);
    } else {
      console.error('Drop detail modal script not loaded');
    }
  }

  async resumeActiveSession() {
    try {
      const sessionState = await Storage.get('activeSession', null);
      if (!sessionState) return;

      // Подтягиваем категорию
      const category = this.categories.find(c => c.id === sessionState.categoryId) ||
        this.categories.find(c => c.name && c.name.toLowerCase() === (sessionState.categoryName || '').toLowerCase());
      if (!category) return;

      // Собираем данные о стриме
      const stream = {
        login: sessionState.streamLogin,
        displayName: sessionState.streamDisplayName || sessionState.streamLogin,
        title: sessionState.streamTitle || ''
      };

      // Восстанавливаем время сессии
      this.sessionStartTime = sessionState.startTime || Date.now();
      this.currentCategory = category;
      this.currentStream = stream;
      this.dropsMissingChecks = 0;
      this.activeSessionResumed = true;

      // Обновляем UI и перезапускаем интервалы
      await this.updateCurrentStreamUI(stream, category);
      const sessionInfo = document.getElementById('farming-session-info');
      if (sessionInfo) {
        sessionInfo.style.display = 'block';
        sessionInfo.style.opacity = '1';
        sessionInfo.style.transform = 'translateY(0)';
      }
      this.showFarmingState();

      this.updateSessionInfo();
      
      // Очищаем старый интервал если он существует
      if (this.sessionInterval) {
        clearInterval(this.sessionInterval);
        this.sessionInterval = null;
      }
      
      this.sessionInterval = setInterval(() => {
        this.updateSessionInfo();
      }, 1000);

      // Запускаем периодическое обновление статистики (каждые 30 секунд)
      if (this.statsUpdateInterval) {
        clearInterval(this.statsUpdateInterval);
      }
      this.statsUpdateInterval = setInterval(() => {
        this.updateLiveStatistics();
      }, 30000); // 30 секунд

      // Запускаем сборщик бонусов и проверку здоровья стрима
      this.resetChannelPointsTracking();
      this.startBackgroundBonusCollector(stream.login);
      this.startStreamHealthCheck();

      // Показываем баллы
      const pointsCard = document.getElementById('channel-points-card');
      if (pointsCard) pointsCard.style.display = 'block';
    } catch (e) {
      console.error('Failed to resume active session', e);
    }
  }

  async saveActiveSession(stream, category) {
    if (!stream || !category) return;
    await Storage.set('activeSession', {
      startTime: this.sessionStartTime || Date.now(),
      categoryId: category.id,
      categoryName: category.name,
      streamLogin: stream.login,
      streamDisplayName: stream.displayName,
      streamTitle: stream.title || ''
    });
  }

  async showCategorySelector() {
    console.log('Opening category selector...');
    
    try {
      // Загружаем все категории Twitch
      window.utils.showToast('Загрузка категорий...', 'info');
      const categories = await window.electronAPI.fetchTwitchCategories();
      console.log('Categories loaded:', categories.length);
      
      if (!categories || categories.length === 0) {
        window.utils.showToast('Не удалось загрузить категории', 'error');
        return;
      }

      // Проверяем дропсы для первых 10 категорий
      console.log('Checking drops for top 10 categories...');
      const categoriesToCheck = categories.slice(0, 10);
      const dropsChecks = await Promise.all(
        categoriesToCheck.map(async (cat) => {
          const hasDrops = await window.electronAPI.checkCategoryDrops(cat.name);
          return { id: cat.id, hasDrops };
        })
      );

      // Обновляем данные о дропсах
      categories.forEach(cat => {
        const dropsInfo = dropsChecks.find(d => d.id === cat.id);
        cat.hasDrops = dropsInfo ? dropsInfo.hasDrops : false;
      });
      
      const modal = document.createElement('div');
      modal.className = 'auth-modal';
      modal.innerHTML = `
        <div class="auth-modal-overlay"></div>
        <div class="auth-modal-content" style="width: 700px; max-height: 85vh; overflow-y: hidden; display: flex; flex-direction: column;">
          <div class="auth-modal-header">
            <h3>Выберите категорию</h3>
            <button class="close-modal">
              <svg width="20" height="20" viewBox="0 0 20 20">
                <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
          </div>
          <div class="auth-modal-body" style="display: flex; flex-direction: column; gap: 15px; overflow: hidden;">
            <div class="search-container" style="position: sticky; top: 0; z-index: 10; background: var(--bg-secondary); padding: 5px 0;">
              <input 
                type="text" 
                id="category-search" 
                placeholder="Поиск категории..." 
              />
            </div>
            <div class="category-list" id="category-list" style="overflow-y: auto; max-height: calc(85vh - 180px);">
              ${this.renderCategoryItems(categories, categories)}
            </div>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // Focus на поиск
      const searchInput = modal.querySelector('#category-search');
      setTimeout(() => searchInput.focus(), 100);
      
      // Обработчик поиска
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = categories.filter(cat => 
          cat.name.toLowerCase().includes(query)
        );
        
        const list = modal.querySelector('#category-list');
        list.innerHTML = this.renderCategoryItems(filtered, categories);
        
        // Re-attach click handlers
        list.querySelectorAll('.game-item-selector').forEach(item => {
          item.addEventListener('click', () => {
            const categoryId = item.dataset.categoryId;
            const category = categories.find(c => c.id === categoryId);
            if (category) {
              this.addCategory(category);
              document.body.removeChild(modal);
            }
          });
        });
      });
      
      // Обработчик закрытия
      const closeBtn = modal.querySelector('.close-modal');
      const overlay = modal.querySelector('.auth-modal-overlay');
      
      closeBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      overlay.addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      // Обработчик клика на игру
      modal.querySelectorAll('.game-item-selector').forEach(item => {
        item.addEventListener('click', () => {
          const categoryId = item.dataset.categoryId;
          const category = categories.find(c => c.id === categoryId);
          if (category) {
            this.addCategory(category);
            document.body.removeChild(modal);
          }
        });
      });
      
    } catch (error) {
      console.error('Error loading categories:', error);
      window.utils.showToast('Ошибка загрузки категорий', 'error');
    }
  }
  
  renderCategoryItems(categories, allCategories) {
    if (categories.length === 0) {
      return `
        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
          <p>Ничего не найдено</p>
        </div>
      `;
    }
    
    return categories.map(cat => {
      const isAdded = this.categories.some(c => c.id === cat.id);
      
      // Индикатор дропсов
      const dropsIndicator = cat.hasDrops
        ? `<span class="drops-badge" style="font-size: 11px; padding: 2px 6px; margin-left: 8px;">
             <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" style="margin-right: 3px;">
               <circle cx="6" cy="6" r="6"/>
             </svg>
             Drops
           </span>`
        : '';
      
      return `
        <div class="game-item-selector ${isAdded ? 'added' : ''}" data-category-id="${cat.id}" style="cursor: pointer;">
          <img src="${this.normalizeBoxArtURL(cat.boxArtURL, '52x72')}" alt="${cat.name}" onerror="this.onerror=null;this.src='https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg';">
          <div class="game-item-info">
            <div class="game-item-name">${cat.name}</div>
            <div class="game-item-viewers" style="display: flex; align-items: center;">
              <span style="color: var(--text-secondary); font-size: 13px;">
                ${cat.viewersCount ? `${this.formatViewersCount(cat.viewersCount)} зрителей` : ''}
              </span>
              ${dropsIndicator}
            </div>
          </div>
          ${isAdded ? '<div class="game-item-added">✓ Добавлена</div>' : ''}
        </div>
      `;
    }).join('');
  }

  async addCategory(category) {
    console.log('Adding category:', category);
    
    // Check if already added
    if (this.categories.some(cat => cat.id === category.id)) {
      window.utils.showToast(`${category.name} уже добавлена`, 'warning');
      return;
    }

    // Проверяем наличие дропсов перед добавлением
    const hasDrops = await window.electronAPI.checkCategoryDrops(category.name);

    const newCategory = {
      id: category.id,
      name: category.name,
      boxArtURL: this.normalizeBoxArtURL(category.boxArtURL, '52x72'),
      viewersCount: category.viewersCount || 0,
      tags: category.tags || [],
      hasDrops: hasDrops,
      enabled: true, // По умолчанию включена
      priority: this.categories.length + 1
    };

    this.categories.push(newCategory);
    await Storage.saveCategories(this.categories);
    this.renderCategories();
    window.utils.showToast(`${category.name} добавлена`, 'success');
  }

  updateAutoDropsButtonState() {
    const btn = document.getElementById('add-all-drops-btn');
    if (!btn) return;
    const isAutoMode = this.autoDropsModeEnabled === true;
    const btnText = btn.querySelector('span');

    if (isAutoMode) {
      btn.style.background = '#7c5cff';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      btn.style.opacity = '1';
      if (btnText) btnText.textContent = this.i18n.t('farming.disableAutofarming');
    } else {
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.color = 'var(--text-primary)';
      btn.style.border = '1px solid var(--border-color)';
      btn.style.opacity = '0.9';
      if (btnText) btnText.textContent = 'Фарм всех дропсов';
    }
  }

  async toggleAutoDropsCategories() {
    if (this.autoDropsModeEnabled) {
      this.autoDropsModeEnabled = false;
      await Storage.set('autoDropsModeEnabled', false);
      this.categories = this.categories.filter(cat => cat.autoDrops !== true);
      await Storage.saveCategories(this.categories);
      this.renderCategories();
      this.updateAutoDropsButtonState();
      window.utils.showToast('Автофарм дропсов отключен', 'info');
    } else {
      this.autoDropsModeEnabled = true;
      await Storage.set('autoDropsModeEnabled', true);
      this.updateAutoDropsButtonState();
      await this.addAllDropsCategories();
    }
  }

  async addAllDropsCategories() {
    try {
      window.utils.showToast('Загружаем категории с дропсами...', 'info');
      const allCategories = await window.electronAPI.fetchTwitchCategories();
      if (!allCategories || allCategories.length === 0) {
        window.utils.showToast('Не удалось загрузить категории', 'error');
        return;
      }

      const activeCampaignsMap = await this.loadActiveCampaignsMap();
      const categoriesByName = new Map(
        allCategories.map(cat => [this.normalizeGameKey(cat.name), cat])
      );

      let addedCount = 0;

      if (activeCampaignsMap.size > 0) {
        for (const [gameKey, campaignInfo] of activeCampaignsMap.entries()) {
          const existing = this.categories.find(cat => this.normalizeGameKey(cat.name) === gameKey);
          if (existing) {
            if (existing.autoDrops) {
              existing.enabled = true;
              existing.hasDrops = true;
              existing.dropsCompleted = false;
              existing.dropsProgressPercent = campaignInfo.progress;
              existing.dropsEndsAt = campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt;
            }
            continue;
          }

          const freshCategory = categoriesByName.get(gameKey);
          const campaignGameName = campaignInfo.campaign?.game?.name || campaignInfo.campaign?.game?.displayName || campaignInfo.campaign?.game;
          const campaignGameId = campaignInfo.campaign?.gameId || campaignInfo.campaign?.game?.id;

          const newCategory = {
            id: freshCategory?.id || campaignGameId || `${Date.now()}-${Math.random()}`,
            name: freshCategory?.name || campaignGameName || gameKey,
            boxArtURL: this.normalizeBoxArtURL(freshCategory?.boxArtURL || campaignInfo.campaign?.imageUrl || campaignInfo.campaign?.game?.boxArtURL, '52x72'),
            viewersCount: freshCategory?.viewersCount || 0,
            tags: freshCategory?.tags || [],
            hasDrops: true,
            autoDrops: true,
            enabled: true,
            priority: this.categories.length + 1,
            dropsProgressPercent: campaignInfo.progress,
            dropsEndsAt: campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt,
            dropsCompleted: false
          };

          this.categories.push(newCategory);
          addedCount++;
        }
      } else {
        const checkPromises = allCategories.map(async (cat) => {
          if (this.categories.some(c => c.id === cat.id)) return null;
          const hasDrops = await window.electronAPI.checkCategoryDrops(cat.name);
          if (hasDrops) return cat;
          return null;
        });

        const results = await Promise.all(checkPromises);
        const validCategories = results.filter(cat => cat !== null);

        for (const category of validCategories) {
          const newCategory = {
            id: category.id,
            name: category.name,
            boxArtURL: this.normalizeBoxArtURL(category.boxArtURL, '52x72'),
            viewersCount: category.viewersCount || 0,
            tags: category.tags || [],
            hasDrops: true,
            autoDrops: true,
            enabled: true,
            priority: this.categories.length + 1
          };
          this.categories.push(newCategory);
          addedCount++;
        }
      }

      if (addedCount === 0) {
        window.utils.showToast('Не найдено новых категорий с незавершенными дропсами', 'warning');
        return;
      }

      await Storage.saveCategories(this.categories);
      this.renderCategories();
      this.updateAutoDropsButtonState();
      window.utils.showToast(`Добавлено ${addedCount} ${addedCount === 1 ? 'категория' : addedCount < 5 ? 'категории' : 'категорий'} с незавершенными дропсами`, 'success');
      setTimeout(() => this.startFarming(), 1000);
    } catch (error) {
      console.error('Error adding all drops categories:', error);
      window.utils.showToast('Ошибка при добавлении категорий', 'error');
    }
  }

  renderCategories() {
    const container = document.getElementById('categories-list');
    
    if (!container) return;
    
    if (this.categories.length === 0) {
      container.innerHTML = `
        <div class="no-categories" style="text-align: center; padding: 40px; color: var(--text-secondary);">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="opacity: 0.3; margin: 0 auto;">
            <rect x="2" y="2" width="20" height="20" rx="2" stroke-width="2"/>
            <path d="M2 8h20M8 2v20" stroke-width="2"/>
          </svg>
          <p style="margin-top: 16px;">Нет выбранных категорий</p>
          <p style="font-size: 13px; margin-top: 8px;">Нажмите "Добавить категорию" чтобы начать</p>
        </div>
      `;
      this.updateAutoDropsButtonState();
      return;
    }

    // Сортировка категорий: приоритезация по дропсам и статусу
    let categoriesToRender = [...this.categories];
    if (this.dropsFilterEnabled) {
      categoriesToRender.sort((a, b) => {
        const aEnabled = a.enabled !== false;
        const bEnabled = b.enabled !== false;
        const aCompleted = !!(a.dropsCompleted && a.hasDrops);
        const bCompleted = !!(b.dropsCompleted && b.hasDrops);
        
        // Сначала включенные, потом выключенные
        if (aEnabled && !bEnabled) return -1;
        if (!aEnabled && bEnabled) return 1;

        // Завершенные опускаем вниз
        if (aCompleted && !bCompleted) return 1;
        if (!aCompleted && bCompleted) return -1;
        
        // Среди включенных: сначала с дропсами неполными, потом полными, потом без дропсов
        if (aEnabled && bEnabled) {
          const aHasDrops = a.hasDrops && !a.dropsCompleted;
          const bHasDrops = b.hasDrops && !b.dropsCompleted;
          
          if (aHasDrops && !bHasDrops) return -1;
          if (!aHasDrops && bHasDrops) return 1;
          
          // Если оба с неполными дропсами или оба без - сортируем по процентам прогресса (меньший процент = выше приоритет)
          if (aHasDrops && bHasDrops) {
            const aProgress = a.dropsProgressPercent || 0;
            const bProgress = b.dropsProgressPercent || 0;
            return aProgress - bProgress;
          }
        }
        
        return 0;
      });
    } else {
      // Без фильтра: сначала включенные, потом выключенные
      categoriesToRender.sort((a, b) => {
        const aEnabled = a.enabled !== false;
        const bEnabled = b.enabled !== false;
        // Закреплённые всегда наверху, независимо от остального
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        const aCompleted = !!(a.dropsCompleted && a.hasDrops);
        const bCompleted = !!(b.dropsCompleted && b.hasDrops);
        
        if (aEnabled && !bEnabled) return -1;
        if (!aEnabled && bEnabled) return 1;

        // Завершенные внизу
        if (aCompleted && !bCompleted) return 1;
        if (!aCompleted && bCompleted) return -1;
        
        return 0;
      });
    }

    // Граница между закреплёнными и остальными: рисуем разделитель перед
    // первой незакреплённой категорией, но только если закреплённые есть
    const pinnedCount = categoriesToRender.filter(cat => cat.pinned).length;

    container.innerHTML = categoriesToRender.map((cat, index) => {
      const divider = (pinnedCount > 0 && index === pinnedCount)
        ? `<div class="pinned-divider"><span>${this.i18n.t('farming.pinnedDivider')}</span></div>`
        : '';
      const tagsHtml = cat.tags && cat.tags.length > 0 
        ? `<span class="category-tag">${cat.tags[0]}</span>` 
        : '';
      const autoBadge = cat.autoDrops ? `<span class="category-tag" style="background: rgba(124, 92, 255, 0.2); color: #bda0ff; border: 1px solid rgba(124, 92, 255, 0.4);">${this.i18n.t('farming.auto')}</span>` : '';
      
      const dropsStatusHtml = cat.hasDrops ? (
        cat.dropsCompleted 
          ? `<span class="category-drops-status completed">
               <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                 <path d="M3.5 7L1 4.5L1.7 3.8L3.5 5.6L8.3 0.8L9 1.5L3.5 7Z"/>
               </svg>
               ${this.i18n.t('farming.dropsCompleted')}
             </span>`
          : `<span class="category-drops-status completed">
               <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                 <circle cx="5" cy="5" r="5"/>
               </svg>
               Drops ${cat.dropsProgressPercent !== undefined ? cat.dropsProgressPercent + '%' : this.i18n.t('farming.enabled')}
               ${cat.dropsEndsAt ? this.formatTimeRemaining(cat.dropsEndsAt) : ''}
             </span>`
      ) : '';
      
      const isDisabled = cat.enabled === false;
      const isCompleted = cat.dropsCompleted && cat.hasDrops;
      
      return `
      ${divider}
      <div class="category-item ${isDisabled ? 'disabled' : ''} ${isCompleted ? 'drops-completed' : ''} ${cat.pinned ? 'pinned' : ''}" draggable="true" data-category-id="${cat.id}">

        <div class="category-drag-handle">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <circle cx="7" cy="5" r="1.5"/>
            <circle cx="13" cy="5" r="1.5"/>
            <circle cx="7" cy="10" r="1.5"/>
            <circle cx="13" cy="10" r="1.5"/>
            <circle cx="7" cy="15" r="1.5"/>
            <circle cx="13" cy="15" r="1.5"/>
          </svg>
        </div>
        <div class="category-image">
          <img src="${this.normalizeBoxArtURL(cat.boxArtURL, '52x72')}" alt="${cat.name}" onerror="this.onerror=null;this.src='https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg';">
        </div>
        <div class="category-info">
          <div class="category-name">${cat.name}</div>
          <div class="category-status">
            <span style="color: var(--text-secondary); font-size: 13px;">${this.formatViewersCount(cat.viewersCount)} зрителей</span>
            ${tagsHtml}
            ${autoBadge}
            ${dropsStatusHtml}
          </div>
        </div>
        <button class="category-play-btn" data-category-id="${cat.id}" title="Запустить эту категорию">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M3 1L10 6L3 11V1Z"/>
          </svg>
          Play
        </button>
        <button class="category-pin-btn ${cat.pinned ? 'active' : ''}" data-category-id="${cat.id}"
                title="${cat.pinned ? 'Открепить категорию' : 'Закрепить категорию'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 4V2H10v2H8v6l-2 2v2h5v6l1 2 1-2v-6h5v-2l-2-2V4h-2z"/>
          </svg>
        </button>
        <div class="category-priority">#${index + 1}</div>
        <label class="category-toggle-switch ${!isDisabled ? 'checked' : ''}" data-category-id="${cat.id}">
          <input type="checkbox" ${!isDisabled ? 'checked' : ''} data-category-id="${cat.id}">
          <span class="toggle-track"></span>
          <span class="toggle-thumb"></span>
        </label>
        <button class="category-remove" data-category-id="${cat.id}">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>
      </div>
      `;
    }).join('');

    this.setupPinControls();
    this.setupDragAndDrop();
    this.setupRemoveButtons();
    this.setupToggleButtons();
    this.setupPlayButtons();
    this.setupCategoryImageClick();
    this.updateAutoDropsButtonState();
  }

  /**
   * Закрепление категорий.
   *
   * Значок закрепления появляется после удержания карточки около секунды —
   * так он не мешает обычной работе со списком и не конфликтует с
   * перетаскиванием. У уже закреплённых категорий значок виден всегда,
   * иначе открепить их было бы неочевидно.
   */
  /**
   * Кнопка закрепления показывается при наведении на карточку (это делает
   * CSS) и постоянно — у уже закреплённых категорий, иначе открепить их
   * было бы неочевидно. Здесь остаётся только сам обработчик нажатия.
   */
  setupPinControls() {
    document.querySelectorAll('.category-pin-btn').forEach(btn => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await this.togglePinned(btn.dataset.categoryId);
      });
    });
  }

  async togglePinned(categoryId) {
    const category = this.categories.find(cat => cat.id === categoryId);
    if (!category) return;

    category.pinned = !category.pinned;

    // Закреплённые держим в начале массива: порядок массива задаёт
    // очередь фарминга, и после перезапуска он должен сохраниться
    this.categories.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });

    await Storage.saveCategories(this.categories);
    this.renderCategories();

    window.utils.showToast(
      category.pinned
        ? `${category.name} закреплена`
        : `${category.name} откреплена`,
      'success'
    );
  }

  setupPlayButtons() {
    const playButtons = document.querySelectorAll('.category-play-btn');
    playButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const categoryId = e.currentTarget.dataset.categoryId;
        const category = this.categories.find(c => c.id === categoryId);
        
        if (category) {
          console.log('Manual play category:', category.name);
          window.utils.showToast(`Запуск категории ${category.name}...`, 'info');

          // Останавливаем текущий стрим если есть
          if (this.currentStream) {
            this.stopFarming();
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // Отметку ручного запуска ставим ПОСЛЕ остановки: stopFarming
          // сбрасывает её вместе с остальным состоянием сессии, и при
          // установке до остановки защита от автопереключения молча пропадала
          this.manualCategoryId = category.id;
          this.setManualPlayLock(category);

          // Запускаем выбранную категорию
          await this.startFarmingForCategory(category);
        }
      });
    });
  }

  setupCategoryImageClick() {
    const categoryImages = document.querySelectorAll('.category-image');
    categoryImages.forEach(img => {
      img.style.cursor = 'pointer';
      img.addEventListener('click', async (e) => {
        e.stopPropagation();
        const categoryItem = e.currentTarget.closest('.category-item');
        const categoryId = categoryItem?.dataset.categoryId;
        const category = this.categories.find(c => c.id === categoryId);
        
        if (category) {
          await this.showCategoryDetails(category);
        }
      });
    });
  }

  async showCategoryDetails(category) {
    // Разметка окна вынесена в features/farming/category-details-modal.js:
    // 330 строк шаблона мешали читать логику фарминга
    return window.showCategoryDetailsModal(this, category);
  }

  async startStreamFromModal(streamLogin, categoryId) {
    const modal = document.querySelector('.category-detail-modal');
    if (modal) {
      modal.style.opacity = '0';
      setTimeout(() => modal.remove(), 200);
    }

    const category = this.categories.find(c => c.id === categoryId);
    if (!category) return;

    window.utils.showToast(`Запуск стрима ${streamLogin}...`, 'info');

    // Останавливаем текущий стрим если есть
    if (this.currentStream) {
      this.stopFarming(false);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Запускаем выбранную категорию
    await this.startFarmingForCategory(category);
  }

  formatFollowers(count) {
    if (count >= 1000000) {
      return (count / 1000000).toFixed(1) + 'M';
    } else if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
  }

  formatViewersCount(count) {
    if (!count) return '—';
    if (count < 10000) return count.toLocaleString();
    if (count >= 1000000) {
      return (count / 1000000).toFixed(1) + 'M';
    }
    return (count / 1000).toFixed(1) + 'K';
  }
  
  getHighQualityBoxArt(url) {
    return this.normalizeBoxArtURL(url, '285x380');
  }

  getWaitingStateMarkup() {
    return `
      <div class="no-stream waiting-state" tabindex="0" role="button" aria-label="Ожидание стрима">
        <div class="waiting-icon" aria-hidden="true">
          <span class="waiting-ring waiting-ring-outer"></span>
          <span class="waiting-ring waiting-ring-inner"></span>
          <span class="waiting-dot"></span>
        </div>
        <p class="waiting-label">Ожидание</p>
      </div>
    `;
  }
  
  /**
   * Выбирает канал из списка стримов категории.
   *
   * Смысл избранного в подписках именно в этом: если избранный стример
   * сейчас ведёт эфир по нужной игре, смотреть надо его. Раньше избранное
   * не использовалось в фарминге вообще — везде безусловно брался streams[0],
   * то есть первый по версии Twitch. А «приоритет подписок» в настройках
   * сортировал КАТЕГОРИИ, сравнивая название игры с логином стримера, —
   * такое совпадение возможно только случайно.
   *
   * Порядок предпочтения:
   *   1. избранные каналы;
   *   2. остальные подписки, если включён приоритет подписок;
   *   3. первый из выдачи Twitch.
   */
  /**
   * Все категории отработаны — фармить больше нечего.
   *
   * Здесь же срабатывает автовыключение компьютера. Механика выключения
   * в приложении была реализована полностью (IPC в main-процессе, окно с
   * обратным отсчётом и отменой), но вызывать её было некому: обработчик
   * завершения жил в StreamingManager, а тот в текущей версии не участвует
   * в фарминге. Настройка сохранялась и не делала ничего.
   */
  onAllCategoriesCompleted() {
    window.electronAPI?.showNotification?.(
      this.i18n.t('farming.completed'),
      'Все доступные дропсы собраны'
    );

    window.shutdownManager?.onDropsCompleted();
  }

  /**
   * Выбирает канал для просмотра в категории.
   *
   * Ключевой момент: Twitch отдаёт по игре только топ-20 стримов по числу
   * зрителей. Избранные каналы — как правило небольшие, и в эту выдачу они
   * почти никогда не попадают. Поэтому искать их в списке бесполезно:
   * сначала спрашиваем напрямую, в эфире ли они и в той ли игре.
   *
   * Подписки учитываются ТОЛЬКО при включённом приоритете подписок.
   * Порядок предпочтения при включённом:
   *   1. избранные каналы, идущие сейчас по нужной игре;
   *   2. остальные подписки;
   *   3. подписки, попавшие в выдачу Twitch;
   *   4. первый из выдачи.
   *
   * options.exclude — канал, который выбирать нельзя (кнопка «Другой стрим»).
   */
  async pickPreferredStream(streams, categoryName, options = {}) {
    if (!Array.isArray(streams) || streams.length === 0) return null;

    const norm = (value) => String(value || '').replace(/^@/, '').toLowerCase();

    // Канал, который просили не выбирать (кнопка «Другой стрим»)
    const excluded = norm(options.exclude);
    const pool = excluded
      ? streams.filter(stream => norm(stream.login) !== excluded)
      : streams;

    const fallback = pool.length > 0 ? pool : streams;

    try {
      const priorityEnabled = await Storage.getItem('subscriptions_priority_enabled');

      // Выключенный переключатель означает именно выключенный: подписки и
      // избранное не влияют на выбор вообще. Раньше избранные применялись
      // всегда, и отключить их было невозможно — приложение упорно
      // возвращало один и тот же канал.
      if (!priorityEnabled) {
        return fallback[0];
      }

      const subscriptions = (await Storage.getSubscriptions()) || [];
      if (subscriptions.length === 0) return fallback[0];

      // Избранные вперёд, внутри группы — по заданному пользователем порядку
      const ordered = subscriptions
        .filter(sub => norm(sub.login) !== excluded)
        .sort((a, b) => {
          if (!!a.isFavorite !== !!b.isFavorite) return a.isFavorite ? -1 : 1;
          return (a.priority ?? 9999) - (b.priority ?? 9999);
        });

      const direct = await this.findLivePreferredChannel(ordered, categoryName);
      if (direct) return direct;

      // Подстраховка: вдруг подписка всё же попала в выдачу
      const known = new Set(ordered.map(sub => norm(sub.login)));
      const inList = fallback.find(stream => known.has(norm(stream.login)));
      if (inList) {
        console.log('[Выбор стрима] Канал из подписок в выдаче:', inList.displayName || inList.login);
        return inList;
      }
    } catch (error) {
      console.warn('[Выбор стрима] Не удалось учесть подписки:', error?.message);
    }

    return fallback[0];
  }

  /**
   * Спрашивает у Twitch напрямую, идёт ли кто-то из приоритетных каналов
   * по нужной игре. Проверяем ограниченное число каналов и параллельно,
   * чтобы не задерживать запуск стрима.
   */
  async findLivePreferredChannel(orderedSubscriptions, categoryName) {
    if (!categoryName || orderedSubscriptions.length === 0) return null;
    if (!window.electronAPI?.getStreamStats) return null;

    const MAX_CHECKS = 12;
    const candidates = orderedSubscriptions.slice(0, MAX_CHECKS);

    const checked = await Promise.all(candidates.map(async (sub) => {
      try {
        const stats = await window.electronAPI.getStreamStats(sub.login);
        // stats === null означает, что канал сейчас не в эфире
        if (!stats || !stats.gameName) return null;
        if (!this.isSameGame(stats.gameName, categoryName)) return null;

        return {
          login: sub.login,
          displayName: sub.displayName || sub.login,
          title: stats.title || '',
          viewers: stats.viewers || 0,
          fromSubscription: true,
          isFavorite: !!sub.isFavorite
        };
      } catch (error) {
        return null;
      }
    }));

    // Порядок массива сохраняется, поэтому первый непустой — самый приоритетный
    const match = checked.find(Boolean);
    if (match) {
      console.log('[Выбор стрима] %s канал в эфире по нужной игре: %s',
        match.isFavorite ? 'Избранный' : 'Подписанный', match.displayName);
    }
    return match || null;
  }

  /**
   * Сравнение названий игр по словам.
   * Подстрока здесь опасна: в «albion online» содержится «line».
   */
  isSameGame(a, b) {
    const tokens = (value) => this.normalizeGameName(value).split(' ').filter(Boolean);
    const left = tokens(a);
    const right = tokens(b);
    if (left.length === 0 || right.length === 0) return false;

    const isPrefix = (short, long) =>
      short.length <= long.length && short.every((t, i) => t === long[i]);

    return isPrefix(left, right) || isPrefix(right, left);
  }

  async startFarmingForCategory(category) {
    const accounts = await Storage.getAccounts();
    if (accounts.length === 0) {
      window.utils.showToast('Добавьте хотя бы один аккаунт', 'warning');
      return;
    }
    
    // Получаем стримы для этой категории
    const streams = await window.electronAPI.getStreamsWithDrops(category.name);
    
    if (streams.length === 0) {
      window.utils.showToast(`Нет стримов для ${category.name}`, 'warning');
      return;
    }
    
    // Выбираем первый стрим
    const stream = await this.pickPreferredStream(streams, category.name);
    const streamUrl = `https://www.twitch.tv/${stream.login}`;
    
    console.log('Starting stream:', stream.displayName, streamUrl);
    window.utils.showToast(`Запуск стрима: ${stream.displayName}`, 'success');
    
    // Сохраняем текущую категорию и стрим
    this.currentCategory = category;
    this.currentStream = stream;
    this.dropsMissingChecks = 0;
    this.dropsMissingChecks = 0;
    this.dropsMissingChecks = 0;
    
    // Открываем стрим
    await window.electronAPI.openStream(streamUrl, accounts[0]);
    
    // Обновляем UI
    this.updateCurrentStreamUI(stream, category);
    
    // Обновляем кнопки
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    if (startBtn) {
      startBtn.style.display = 'none';
      if (stopBtn) {
        stopBtn.style.display = 'flex';
      }
    }
    
    // Показываем информацию о сессии
    const sessionInfo = document.getElementById('farming-session-info');
    if (sessionInfo) {
      sessionInfo.style.display = 'block';
    }
    
    // Очищаем старый интервал если он существует
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    
    // Запускаем трекинг
    this.sessionStartTime = Date.now();
    this.estimatedBandwidth = 0;
    this.bandwidthHistory = [];
    window.electronAPI?.resetTrafficSession?.();
    this.resetSessionPointsTracking();

    this.updateSessionInfo();
    this.sessionInterval = setInterval(() => {
      this.updateSessionInfo();
    }, 1000);

    // Запускаем периодическое обновление статистики (каждые 30 секунд)
    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
    }
    this.statsUpdateInterval = setInterval(() => {
      this.updateLiveStatistics();
    }, 30000); // 30 секунд

    // Создаем начальную сессию в статистике
    this.updateLiveStatistics();

    // Сбрасываем трекинг баллов для нового стрима
    this.resetChannelPointsTracking();

    // Сохраняем активную сессию
    await this.saveActiveSession(stream, category);
    
    // Загружаем дропсы
    this.loadAndDisplayDrops(stream.login, category.name);
    
    // Показываем блок баллов
    const pointsCard = document.getElementById('channel-points-card');
    if (pointsCard) {
      pointsCard.style.display = 'block';
    }
    
    // Запускаем автосбор
    this.startBackgroundBonusCollector(stream.login);
    
    // Запускаем проверку состояния трансляции
    this.startStreamHealthCheck();

    // Отображаем корректное состояние кнопок
    this.showFarmingState();
  }

  setupToggleButtons() {
    const toggles = document.querySelectorAll('.category-toggle-switch input[type="checkbox"]');
    toggles.forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const categoryId = e.target.dataset.categoryId;
        const category = this.categories.find(c => c.id === categoryId);
        const label = e.target.closest('.category-toggle-switch');
        
        if (category) {
          const wasEnabled = category.enabled;
          category.enabled = e.target.checked;
          
          console.log('Toggle category:', {
            name: category.name,
            id: categoryId,
            wasEnabled,
            nowEnabled: category.enabled,
            currentCategoryId: this.currentCategory?.id,
            isCurrent: this.currentCategory?.id === categoryId
          });
          
          // Обновляем класс для плавной анимации
          if (e.target.checked) {
            label.classList.add('checked');
          } else {
            label.classList.remove('checked');
          }
          
          await Storage.saveCategories(this.categories);
          
          const status = category.enabled ? 'включена' : 'отключена';
          window.utils.showToast(`${category.name} ${status}`, 'success');
          
          // Перерисовываем список для пересортировки
          this.renderCategories();
          
          // Если выключили текущую категорию, переключаемся на следующую
          if (wasEnabled && !category.enabled && this.currentCategory && this.currentCategory.id === categoryId) {
            console.log('Current category disabled, switching to next enabled category');
            setTimeout(() => {
              this.switchToNextEnabledCategory();
            }, 1000);
          }
        }
      });
    });
  }
  
  async addChannelToFarming(channelLogin) {
    // Добавляет канал в список фарминга и запускает его
    try {
      // Ищем категорию для этого канала
      const categoryName = channelLogin;
      
      // Проверяем есть ли уже эта категория
      let category = this.categories.find(c => c.name.toLowerCase() === channelLogin.toLowerCase());
      
      if (!category) {
        // Создаём новую категорию
        category = {
          id: Date.now().toString(),
          name: channelLogin,
          enabled: true,
          autoDrops: false,
          hasDrops: await window.electronAPI.checkCategoryDrops(channelLogin),
          priority: 0,
          tags: [],
          viewersCount: 0,
          dropsCompleted: false
        };
        
        this.categories.push(category);
        await Storage.saveCategories(this.categories);
        this.renderCategories();
      } else if (!category.enabled) {
        category.enabled = true;
        await Storage.saveCategories(this.categories);
        this.renderCategories();
      }

      // Переключаемся на этот канал
      const accounts = await Storage.getAccounts();
      if (!accounts || accounts.length === 0) {
        window.utils.showToast('Нет аккаунтов для запуска', 'error');
        return;
      }

      const account = accounts[0];
      const streams = await window.electronAPI.getStreamsWithDrops(channelLogin);
      
      if (!streams || streams.length === 0) {
        window.utils.showToast(`На канале ${channelLogin} нет стримов с дропсами`, 'warning');
        return;
      }

      const stream = await this.pickPreferredStream(streams, channelLogin);
      
      // Переключаемся на стрим
      await window.electronAPI.openStream(`https://www.twitch.tv/${stream.login}`, account);
      
      this.currentCategory = category;
      this.currentStream = stream;
      this.resetChannelPointsTracking();
      this.updateCurrentStreamUI(stream, category);
      await this.saveActiveSession(stream, category);
      
      window.utils.showToast(`Начинаем фарминг ${stream.displayName}...`, 'success');
    } catch (error) {
      console.error('Error adding channel to farming:', error);
      window.utils.showToast('Ошибка при добавлении канала в фарминг', 'error');
    }
  }

  async switchToNextEnabledCategory() {
    // Категорию, запущенную вручную, не меняем ни по какой причине.
    // Раньше защита стояла только в handleCategoryNoDrops, а сюда ведут
    // и другие пути: смена игры у стримера, завершение дропсов, ошибки.
    if (this.isManualCategoryActive()) {
      console.log('[Ручной запуск] Смена категории отменена:', this.currentCategory?.name);
      this.showSwitchOffer();
      return false;
    }

    console.log('switchToNextEnabledCategory called');
    console.log('Current category:', this.currentCategory);
    console.log('All categories:', this.categories.map(c => ({ name: c.name, id: c.id, enabled: c.enabled })));
    
    // Сохраняем статистику текущей категории перед переключением
    if (this.currentCategory?.name && this.sessionStartTime) {
      const categoryWatchTime = Date.now() - this.sessionStartTime;
      await this.saveWatchTimeForCategory(this.currentCategory.name, categoryWatchTime);
      // Сбрасываем sessionStartTime для новой категории
      this.sessionStartTime = Date.now();
    }
    
    // Находим следующую включенную категорию (пропускаем завершенные)
    // Приоритет: 1) ручные категории, 2) подписанные каналы с дропсами (если включен приоритет), 3) наличие дропсов, 4) сохранённый порядок/priority
    let enabledCategories = this.categories
      .filter(cat => cat.enabled && cat.id !== this.currentCategory?.id && !cat.dropsCompleted);

    // Проверяем включен ли приоритет подписок
    const subscriptionsPriorityEnabled = await Storage.getItem('subscriptions_priority_enabled');
    if (subscriptionsPriorityEnabled) {
      const subscriptions = await Storage.getSubscriptions() || [];
      const subscriptionLogins = subscriptions.map(s => s.login.toLowerCase());
      
      enabledCategories.sort((a, b) => {
        // Закреплённые всегда впереди
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        // Ручные категории имеют наивысший приоритет
        const aManual = a.autoDrops ? 0 : 1;
        const bManual = b.autoDrops ? 0 : 1;
        if (aManual !== bManual) return bManual - aManual;
        
        // Категория считается подписочной, только если её имя в точности
        // совпадает с логином канала. Сравнение через includes ловило ложные
        // совпадения: короткий логин находится внутри названия любой игры.
        const aIsSubscribed = subscriptionLogins.includes(a.name.toLowerCase());
        const bIsSubscribed = subscriptionLogins.includes(b.name.toLowerCase());
        
        if (aIsSubscribed !== bIsSubscribed) return aIsSubscribed ? -1 : 1;
        
        // Если оба подписанные или оба нет, сортируем по остальным критериям
        const aNoDrops = a.hasDrops ? 0 : 1;
        const bNoDrops = b.hasDrops ? 0 : 1;
        if (aNoDrops !== bNoDrops) return aNoDrops - bNoDrops;
        return (a.priority || 0) - (b.priority || 0);
      });
    } else {
      // Обычная сортировка без приоритета подписок
      enabledCategories.sort((a, b) => {
        // Закреплённые всегда впереди
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        // Ручные категории имеют наивысший приоритет
        const aManual = a.autoDrops ? 0 : 1;
        const bManual = b.autoDrops ? 0 : 1;
        if (aManual !== bManual) return bManual - aManual;
        
        const aNoDrops = a.hasDrops ? 0 : 1;
        const bNoDrops = b.hasDrops ? 0 : 1;
        if (aNoDrops !== bNoDrops) return aNoDrops - bNoDrops;
        return (a.priority || 0) - (b.priority || 0);
      });
    }
    
    console.log('Enabled categories:', enabledCategories.map(c => c.name));
    
    if (enabledCategories.length === 0) {
      if (this.isSingleManualPlayLocked()) {
        console.log('[ManualPlayLock] No next categories, keeping current category active');
        window.utils.showToast('Оставляем текущую категорию активной до ручной остановки', 'info');
        return true;
      }

      window.utils.showToast('Нет доступных категорий для переключения', 'warning');
      
      // Закрываем текущий стрим
      console.log('Stopping - no enabled categories');
      await window.electronAPI.closeStream();
      this.currentCategory = null;
      
      // Скрываем плеер, показываем "нет стрима"
      const streamInfo = document.getElementById('current-stream-info');
      const playerContainer = document.getElementById('player-container');
      if (streamInfo && playerContainer) {
        streamInfo.style.display = 'flex';
        playerContainer.style.display = 'none';
      }

      // Больше фармить нечего — это и есть завершение работы
      this.onAllCategoriesCompleted();
      return false;
    }
    
    // Пробуем категории по очереди, пока не найдем со стримами
    for (const nextCategory of enabledCategories) {
      console.log('Trying category:', nextCategory.name);
      
      try {
        const accounts = await Storage.getAccounts();
        if (!accounts || accounts.length === 0) {
          window.utils.showToast('Нет аккаунтов для запуска стрима', 'error');
          return false;
        }
        const account = accounts[0];

        // Получаем стримы для категории
        const streams = await window.electronAPI.getStreamsWithDrops(nextCategory.name);
        
        if (!streams || streams.length === 0) {
          console.warn('No streams found for category:', nextCategory.name, '- disabling instead of removing');
          // Отключаем категорию без стримов вместо удаления
          nextCategory.enabled = false;
          await Storage.saveCategories(this.categories);
          this.renderCategories();
          window.utils.showToast(`${nextCategory.name} отключена (нет стримов)`, 'info');
          continue; // Пробуем следующую категорию
        }
        
        // Нашли стримы! Закрываем текущий и открываем новый
        window.utils.showToast(`Переключение на ${nextCategory.name}...`, 'info');
        console.log('Closing current stream before switching');
        await window.electronAPI.closeStream();
        
        // Берём первый стрим
        const stream = await this.pickPreferredStream(streams, nextCategory.name);
        console.log('Selected stream:', stream.displayName);
        
        // Открываем стрим
        await window.electronAPI.openStream(`https://www.twitch.tv/${stream.login}`, account);
        
        // КРИТИЧЕСКИ ВАЖНО: обновляем UI и устанавливаем currentCategory
        this.currentCategory = nextCategory;
        this.currentStream = stream;
        this.dropsMissingChecks = 0; // Сбрасываем счетчик проверок
        this.resetChannelPointsTracking();
        this.updateCurrentStreamUI(stream, nextCategory);
        await this.saveActiveSession(stream, nextCategory);
        
        window.utils.showToast(`Переключено на: ${stream.displayName}`, 'success');
        console.log('Stream switched successfully, currentCategory set to:', this.currentCategory);
        return true;
      } catch (error) {
        console.error('Error switching to category:', nextCategory.name, error);
        // Отключаем проблемную категорию вместо удаления
        nextCategory.enabled = false;
        await Storage.saveCategories(this.categories);
        this.renderCategories();
        window.utils.showToast(`${nextCategory.name} удалена (ошибка переключения)`, 'error');
        continue;
      }
    }
    
    // Если дошли сюда - не нашли ни одной рабочей категории
    window.utils.showToast('Не удалось найти категорию с доступными стримами', 'error');
    await window.electronAPI.closeStream();
    this.currentCategory = null;
    
    const streamInfo = document.getElementById('current-stream-info');
    const playerContainer = document.getElementById('player-container');
    if (streamInfo && playerContainer) {
      streamInfo.style.display = 'flex';
      playerContainer.style.display = 'none';
    }
    return false;
  }

  setupDragAndDrop() {
    const items = document.querySelectorAll('.category-item');
    let draggedItem = null;

    items.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = this.getDragAfterElement(e.clientY);
        const container = document.getElementById('categories-list');
        if (afterElement == null) {
          container.appendChild(draggedItem);
        } else {
          container.insertBefore(draggedItem, afterElement);
        }
      });
    });

    // Save new order on drop
    document.getElementById('categories-list').addEventListener('drop', async () => {
      const items = document.querySelectorAll('.category-item');
      const newOrder = Array.from(items).map(item => item.getAttribute('data-category-id'));
      
      // Reorder categories array
      this.categories = newOrder.map(id => this.categories.find(cat => cat.id === id));
      this.categories.forEach((cat, index) => {
        cat.priority = index + 1;
      });
      
      await Storage.saveCategories(this.categories);
      this.renderCategories();
    });
  }

  getDragAfterElement(y) {
    const draggableElements = [...document.querySelectorAll('.category-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  setupRemoveButtons() {
    document.querySelectorAll('.category-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const categoryId = btn.getAttribute('data-category-id');
        const isCurrent = this.currentCategory && this.currentCategory.id === categoryId;
        this.categories = this.categories.filter(cat => cat.id !== categoryId);
        await Storage.saveCategories(this.categories);
        this.renderCategories();
        if (isCurrent) {
          await this.stopFarming();
          if (this.categories.length > 0) {
            await this.startFarming();
          } else {
            await window.electronAPI.closeStream();
          }
        }
        window.utils.showToast('Категория удалена', 'success');
      });
    });
  }

  /**
   * Запуск фарминга. Обёртка вокруг реальной реализации.
   *
   * Точек вызова несколько (автозапуск при инициализации, кнопка в сайдбаре,
   * добавление категорий), и они способны сработать почти одновременно —
   * тогда пользователь видел два одинаковых уведомления подряд. Флаг живёт
   * на window, а не на объекте страницы: страница пересоздаётся при каждой
   * навигации, и отложенный вызов от прежнего экземпляра иначе прошёл бы мимо
   * защиты.
   */
  async startFarming() {
    if (window._farmingStarting) {
      console.log('[Farming] Запуск уже выполняется — повторный вызов пропущен');
      return;
    }

    window._farmingStarting = true;
    try {
      return await this._startFarming();
    } finally {
      window._farmingStarting = false;
    }
  }

  async _startFarming() {
    if (this.categories.length === 0) {
      window.utils.showToast('Добавьте хотя бы одну категорию', 'warning');
      return;
    }

    const accounts = await Storage.getAccounts();
    if (accounts.length === 0) {
      window.utils.showToast('Добавьте хотя бы один аккаунт', 'warning');
      if (window.router) {
        window.router.navigate('accounts');
      }
      return;
    }
    
    // Проверяем, есть ли хотя бы один активный аккаунт (OAuth)
    const activeAccounts = accounts.filter(acc => acc.loginMethod === 'oauth');
    if (activeAccounts.length === 0) {
      window.utils.showToast('Для работы требуется OAuth авторизация', 'error');
      
      // Показываем модальное окно с инструкцией
      const modal = document.createElement('div');
      modal.className = 'auth-modal';
      modal.innerHTML = `
        <div class="auth-modal-overlay"></div>
        <div class="auth-modal-content" style="width: 500px;">
          <div class="auth-modal-header">
            <h3>⚠️ Требуется OAuth авторизация</h3>
          </div>
          <div class="auth-modal-body">
            <p style="color: var(--text-secondary); margin-bottom: 16px;">
              Для корректной работы фарминга необходимо авторизоваться через Twitch OAuth.
            </p>
            <div style="background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;">
              <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">Что нужно сделать:</div>
              <ol style="margin: 0; padding-left: 20px; color: var(--text-secondary); font-size: 14px;">
                <li style="margin-bottom: 6px;">Перейдите на вкладку "Аккаунты"</li>
                <li style="margin-bottom: 6px;">Нажмите "Войти через Twitch"</li>
                <li style="margin-bottom: 6px;">Авторизуйтесь в браузере</li>
                <li>Вернитесь в приложение и запустите фарминг</li>
              </ol>
            </div>
            <div style="display: flex; gap: 12px;">
              <button class="btn btn-primary" id="go-to-accounts" style="flex: 1;">Перейти к аккаунтам</button>
              <button class="btn btn-secondary" id="close-modal" style="flex: 1;">Закрыть</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      
      modal.querySelector('#go-to-accounts').addEventListener('click', () => {
        document.body.removeChild(modal);
        if (window.router) {
          window.router.navigate('accounts');
        }
      });
      
      modal.querySelector('#close-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      modal.querySelector('.auth-modal-overlay').addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      return;
    }
    
    // Проверяем вход в Twitch
    const loggedInAccounts = activeAccounts.filter(acc => acc.twitchLoggedIn);
    if (loggedInAccounts.length === 0) {
      window.utils.showToast('Требуется вход в Twitch', 'error');
      
      // Показываем модальное окно с инструкцией
      const modal = document.createElement('div');
      modal.className = 'auth-modal';
      modal.innerHTML = `
        <div class="auth-modal-overlay"></div>
        <div class="auth-modal-content" style="width: 500px;">
          <div class="auth-modal-header">
            <h3>🔐 Требуется вход в Twitch</h3>
          </div>
          <div class="auth-modal-body">
            <p style="color: var(--text-secondary); margin-bottom: 16px;">
              Для фарминга дропсов и баллов канала необходимо войти в Twitch через приложение.
            </p>
            <div style="background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;">
              <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">Что нужно сделать:</div>
              <ol style="margin: 0; padding-left: 20px; color: var(--text-secondary); font-size: 14px;">
                <li style="margin-bottom: 6px;">Перейдите на вкладку "Аккаунты"</li>
                <li style="margin-bottom: 6px;">Найдите свой аккаунт</li>
                <li style="margin-bottom: 6px;">Нажмите кнопку "Войти в Twitch" (иконка Twitch)</li>
                <li style="margin-bottom: 6px;">Войдите в аккаунт в открывшемся окне</li>
                <li>Нажмите "Проверить авторизацию"</li>
              </ol>
            </div>
            <div style="display: flex; gap: 12px;">
              <button class="btn btn-primary" id="go-to-accounts" style="flex: 1;">Перейти к аккаунтам</button>
              <button class="btn btn-secondary" id="close-modal" style="flex: 1;">Закрыть</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      
      modal.querySelector('#go-to-accounts').addEventListener('click', () => {
        document.body.removeChild(modal);
        if (window.router) {
          window.router.navigate('accounts');
        }
      });
      
      modal.querySelector('#close-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      modal.querySelector('.auth-modal-overlay').addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      return;
    }

    window.utils.showToast('Ищем стрим с дропсами...', 'info');
    
    // Находим первую включенную категорию: приоритет ручных, затем по наличию дропсов и priority
    const enabledCategories = this.categories
      .filter(c => c.enabled !== false && !c.dropsCompleted)
      .sort((a, b) => {
        // Закреплённые проверяются на дропсы и фармятся в первую очередь
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        const aManual = a.autoDrops ? 1 : 0;
        const bManual = b.autoDrops ? 1 : 0;
        if (aManual !== bManual) return aManual - bManual;
        const aNoDrops = a.hasDrops ? 0 : 1;
        const bNoDrops = b.hasDrops ? 0 : 1;
        if (aNoDrops !== bNoDrops) return aNoDrops - bNoDrops;
        return (a.priority || 0) - (b.priority || 0);
      })
      .filter(c => c.hasDrops); // стартуем по категории с дропсами
    
    if (enabledCategories.length === 0) {
      window.utils.showToast('Нет активных категорий с дропсами', 'warning');
      return;
    }
    
    // Получаем стримы с дропсами для первой категории
    const category = enabledCategories[0];
    const streams = await window.electronAPI.getStreamsWithDrops(category.name);
    
    if (streams.length === 0) {
      window.utils.showToast(`Нет стримов с дропсами в ${category.name}`, 'warning');
      return;
    }
    
    // Выбираем первый стрим
    const stream = await this.pickPreferredStream(streams, category.name);
    const streamUrl = `https://www.twitch.tv/${stream.login}`;
    
    console.log('Starting stream:', stream.displayName, streamUrl);
    window.utils.showToast(`Запуск стрима: ${stream.displayName}`, 'success');
    
    // Сохраняем текущую категорию и стрим
    this.currentCategory = category;
    this.currentStream = stream;
    this.dropsMissingChecks = 0;
    
    // Открываем стрим в фоновом окне с аккаунтом
    await window.electronAPI.openStream(streamUrl, accounts[0]);
    
    // Обновляем UI текущего стрима
    this.updateCurrentStreamUI(stream, category);
    
    // Обновляем кнопки в сайдбаре с плавной анимацией
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    if (startBtn) {
      startBtn.style.opacity = '0';
      startBtn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        startBtn.style.display = 'none';
        if (stopBtn) {
          stopBtn.style.display = 'flex';
          setTimeout(() => {
            stopBtn.style.opacity = '1';
            stopBtn.style.transform = 'scale(1)';
          }, 10);
        }
      }, 200);
    }
    
    // Показываем информацию о сессии с анимацией
    const sessionInfo = document.getElementById('farming-session-info');
    if (sessionInfo) {
      sessionInfo.style.display = 'block';
      sessionInfo.style.opacity = '0';
      sessionInfo.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        sessionInfo.style.opacity = '1';
        sessionInfo.style.transform = 'translateY(0)';
      }, 10);
    }
    
    // Запускаем трекинг сессии
    this.sessionStartTime = Date.now();
    this.estimatedBandwidth = 0;
    this.bandwidthHistory = [];
    window.electronAPI?.resetTrafficSession?.();
    this.resetSessionPointsTracking();
    this.updateSessionInfo();

    // Mark global farming active for other modules (e.g., mini-player)
    if (window.streamingManager) {
      try { window.streamingManager.isFarming = true; } catch (e) {}
    }
    
    // Очищаем старый интервал если он существует
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    
    this.sessionInterval = setInterval(() => {
      // Используем requestAnimationFrame для более плавного обновления
      requestAnimationFrame(() => {
        this.updateSessionInfo();
      });
    }, 1000);

    // Запускаем периодическое обновление статистики (каждые 30 секунд)
    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
    }
    this.statsUpdateInterval = setInterval(() => {
      this.updateLiveStatistics();
    }, 30000); // 30 секунд

    // Создаем начальную сессию в статистике
    this.updateLiveStatistics();

    // Сохраняем активную сессию для восстановления
    await this.saveActiveSession(stream, category);
    
    // Загружаем и отображаем дропсы
    this.loadAndDisplayDrops(stream.login, category.name);
    
    // Показываем блок баллов
    const pointsCard = document.getElementById('channel-points-card');
    if (pointsCard) {
      pointsCard.style.display = 'block';
    }
    
    // Запускаем автосбор бонусов в фоне
    this.startBackgroundBonusCollector(stream.login);
    
    // Обновляем мини-плеер в сайдбаре если пользователь не на странице фарминга
    if (window.router && typeof window.router.manageMiniPlayer === 'function') {
      window.router.manageMiniPlayer(window.router.currentPage);
    }
  }

  async loadAndDisplayDrops(channelLogin, gameName) {
    try {
      console.log('Loading drops for', channelLogin, gameName);
      
      // Показываем простое уведомление о дропсах
      const container = document.getElementById('drops-progress-container');
      const listEl = document.getElementById('drops-campaigns-list');
      
      if (!container || !listEl) {
        console.log('Drops container not found');
        return;
      }
      
      // Старый контейнер скрываем — используется новый горизонтальный блок прогресса
      container.style.display = 'none';
      listEl.innerHTML = '';
    } catch (error) {
      console.error('Error loading drops:', error);
      this.hideDropsContainer();
    }
  }

  displayDropsCampaigns(campaigns, progress) {
    const container = document.getElementById('drops-progress-container');
    const listEl = document.getElementById('drops-campaigns-list');
    
    if (!container || !listEl) return;
    
    // Показываем контейнер
    container.style.display = 'block';
    
    // Отображаем кампании
    listEl.innerHTML = campaigns.map(campaign => {
      const totalDrops = campaign.drops.length;
      const completedDrops = campaign.drops.filter(d => d.progress >= 100).length;
      
      return `
        <div style="margin-bottom: 16px; padding: 16px; background: var(--bg-primary); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          <div style="display: flex; gap: 12px; margin-bottom: 12px;">
            <img src="${campaign.imageUrl}" 
                 alt="${campaign.name}" 
                 style="width: 60px; height: 80px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0;"
                 onerror="this.style.display='none'">
            <div style="flex: 1;">
              <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${campaign.name}</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">${campaign.game}</div>
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <span style="font-size: 12px; padding: 4px 8px; background: ${campaign.isActive ? 'rgba(53, 208, 138, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${campaign.isActive ? '#35d08a' : '#ef4444'}; border-radius: var(--radius-sm); font-weight: 600;">
                  ${campaign.isActive ? 'Активно' : 'Завершено'}
                </span>
                ${campaign.isActive ? `
                  <span style="font-size: 12px; color: var(--text-secondary);">
                    ${campaign.daysRemaining > 0 ? `${campaign.daysRemaining}д ` : ''}${campaign.hoursRemaining % 24}ч до конца
                  </span>
                ` : ''}
              </div>
            </div>
          </div>
          
          <!-- Список дропсов -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${campaign.drops.map((drop, idx) => {
              const dropData = encodeURIComponent(JSON.stringify(drop));
              const campaignData = encodeURIComponent(JSON.stringify({
                name: campaign.name,
                game: campaign.game,
                imageUrl: campaign.imageUrl,
                startDate: campaign.startDate,
                endDate: campaign.endDate
              }));
              
              return `
              <div class="drop-card-clickable" 
                   data-drop="${dropData}" 
                   data-campaign="${campaignData}"
                   style="display: flex; gap: 12px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-sm); align-items: center; cursor: pointer; transition: all 0.2s ease;"
                   onmouseover="this.style.background='rgba(124, 92, 255, 0.1)'; this.style.transform='translateX(4px)'"
                   onmouseout="this.style.background='var(--bg-secondary)'; this.style.transform='translateX(0)'">
                ${drop.imageUrl ? `
                  <img src="${drop.imageUrl}" 
                       alt="${drop.name}" 
                       style="width: 48px; height: 48px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0;">
                ` : ''}
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${drop.name}</div>
                  <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">
                    Смотреть ${drop.requiredMinutes} мин
                  </div>
                  <div style="height: 6px; background: var(--bg-primary); border-radius: var(--radius-sm); overflow: hidden;">
                    <div style="height: 100%; width: ${drop.progress || 0}%; background: var(--accent-color); transition: width 0.5s ease;"></div>
                  </div>
                </div>
                <div style="font-size: 14px; font-weight: 700; color: ${drop.progress >= 100 ? 'var(--success-color)' : 'var(--accent-color)'}; min-width: 45px; text-align: right;">
                  ${Math.round(drop.progress || 0)}%
                </div>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
    
    // Обновляем общий прогресс
    const totalDrops = campaigns.reduce((sum, c) => sum + c.drops.length, 0);
    const completedDrops = campaigns.reduce((sum, c) => sum + c.drops.filter(d => d.progress >= 100).length, 0);
    
    const overallEl = document.getElementById('drops-overall-progress');
    if (overallEl) {
      overallEl.textContent = `${completedDrops} / ${totalDrops} получено`;
    }
  }

  hideDropsContainer() {
    const container = document.getElementById('drops-progress-container');
    if (container) {
      container.style.display = 'none';
    }
  }

  /**
   * Приводит название игры к виду, пригодному для сравнения.
   * Twitch в разных запросах отдаёт то displayName, то name, плюс различаются
   * регистр, апострофы, тире и лишние пробелы — из-за этого точное сравнение
   * регулярно промахивалось и дропсы выглядели как отсутствующие.
   */
  normalizeGameName(name) {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      .replace(/^\s*(игра|game)\s*:\s*/i, '')
      .replace(/[''`’]/g, '')
      .replace(/[^a-zа-я0-9]+/gi, ' ')
      .trim();
  }

  /**
   * Все активные кампании для указанной игры.
   * Раньше здесь стоял find() и бралась только первая кампания — если у игры
   * их несколько (например, две компании со своими наборами наград),
   * вторая просто не отображалась.
   */
  matchCampaignsForGame(campaigns, gameName) {
    const target = this.normalizeGameName(gameName);
    if (!target || !Array.isArray(campaigns)) return [];

    const nameOf = (campaign) => this.normalizeGameName(
      campaign?.game?.displayName || campaign?.game?.name || campaign?.game
    );

    const exact = campaigns.filter(c => nameOf(c) && nameOf(c) === target);
    if (exact.length > 0) return exact;

    // Фолбэк: сравниваем по словам, а НЕ по вхождению подстроки.
    //
    // Подстрока здесь опасна: в «albion online» содержится «line», в «rust» —
    // «us», поэтому кампания игры с коротким названием могла прицепиться к
    // чужой игре. Риск вырос после того, как в список стали попадать все
    // доступные кампании аккаунта (сотня вместо пары).
    //
    // Совпадением считаем только случай, когда одно название целиком является
    // началом другого по словам: «Albion» ↔ «Albion Online» — да,
    // «Line» ↔ «Albion Online» — нет.
    const targetTokens = target.split(' ').filter(Boolean);
    const isTokenPrefix = (short, long) =>
      short.length > 0 && short.length <= long.length && short.every((t, i) => t === long[i]);

    return campaigns.filter(c => {
      const tokens = nameOf(c).split(' ').filter(Boolean);
      if (tokens.length === 0) return false;
      return isTokenPrefix(tokens, targetTokens) || isTokenPrefix(targetTokens, tokens);
    });
  }

  /** Дроп считается выполненным, если получен или уже доступен к получению. */
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

  /** Человекочитаемый остаток времени кампании. */
  formatCampaignTimeLeft(endsAt) {
    if (!endsAt) return '';

    const diff = new Date(endsAt) - new Date();
    if (diff <= 0) return 'Завершена';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}д ${hours}ч`;
    if (hours > 0) return `${hours}ч ${minutes}м`;
    return `${minutes}м`;
  }

  /** Карточка одного дропа. */
  renderDropCard(drop, campaign, gameName) {
    const i18n = this.i18n;
    const isCompleted = this.isDropEarned(drop);
    const dropPercent = isCompleted
      ? 100
      : (drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0);
    const remaining = Math.max(0, drop.required - drop.progress);
    const dropName = drop.benefitName || drop.name || 'Награда';

    const dropData = encodeURIComponent(JSON.stringify({
      name: dropName,
      imageUrl: drop.imageURL || '',
      requiredMinutes: drop.required || 0,
      progress: dropPercent,
      benefitEdges: drop.benefitEdges || []
    }));

    const campaignData = encodeURIComponent(JSON.stringify({
      name: campaign.name || gameName,
      game: campaign.game?.displayName || campaign.game?.name || gameName,
      imageUrl: campaign.game?.boxArtURL || '',
      startDate: campaign.startAt || '',
      endDate: campaign.endsAt || campaign.endAt || ''
    }));

    const accent = isCompleted ? '53, 208, 138' : '124, 92, 255';
    const accentSolid = isCompleted ? '#35d08a' : '#7c5cff';

    return `
      <div class="drop-progress-card drop-card-clickable"
           data-drop="${dropData}"
           data-campaign="${campaignData}"
           style="
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        background: rgba(${accent}, 0.08);
        border: 1px solid rgba(${accent}, 0.3);
        border-radius: var(--radius-md);
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        min-height: 220px;
        cursor: pointer;
        ${!isCompleted ? 'animation: pulse-glow 3s ease-in-out infinite;' : ''}
      "
      onmouseenter="this.style.boxShadow='0 8px 24px rgba(${accent}, 0.3)'; this.style.borderColor='rgba(${accent}, 0.6)';"
      onmouseleave="this.style.transform='translateY(0) scale(1)'; this.style.boxShadow='none'; this.style.borderColor='rgba(${accent}, 0.3)';"
      >
        <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">
          ${drop.imageURL ? `
            <img src="${drop.imageURL}"
                 alt="${dropName}"
                 style="width: 64px; height: 64px; border-radius: var(--radius-md); object-fit: cover; opacity: ${isCompleted ? '0.7' : '1'}; transition: all 0.3s ease;">
          ` : `
            <div style="width: 64px; height: 64px; border-radius: var(--radius-md); background: rgba(124, 92, 255, 0.2); display: flex; align-items: center; justify-content: center;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="${accentSolid}">
                <path d="M12 2L15 8H21L16 13L18 19L12 15L6 19L8 13L3 8H9L12 2Z"/>
              </svg>
            </div>
          `}
        </div>
        <div style="text-align: center; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 8px;">
            <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;" title="${dropName}">${dropName}</span>
            ${isCompleted ? `
              <svg width="14" height="14" viewBox="0 0 16 16" fill="#35d08a" style="flex-shrink: 0;">
                <circle cx="8" cy="8" r="8" fill="rgba(53, 208, 138, 0.2)"/>
                <path d="M5 8L7 10L11 6" stroke="#35d08a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            ` : ''}
          </div>
          <div style="font-size: 18px; font-weight: 700; color: ${accentSolid}; margin-bottom: 8px;">${dropPercent}%</div>
        </div>
        <div style="height: 8px; background: rgba(255, 255, 255, 0.12); border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 8px;">
          <div style="height: 100%; width: ${dropPercent}%; background: ${accentSolid} !important; transition: width 0.5s ease;"></div>
        </div>
        <div style="font-size: 11px; color: var(--text-secondary); text-align: center;">
          ${isCompleted
            ? `<span style="color: #35d08a; font-weight: 600;">✓ ${i18n.t('farming.claimedOrAvailable')}</span>`
            : `<div>${drop.progress} / ${drop.required} ${i18n.t('farming.min')}</div>${remaining > 0 ? `<div style="margin-top: 4px; color: var(--text-tertiary);">${i18n.t('farming.remaining')}: ${remaining} ${i18n.t('farming.min')}</div>` : ''}`
          }
        </div>
      </div>
    `;
  }

  /** Блок одной кампании: заголовок, свой прогресс и сетка дропсов. */
  renderCampaignSection(campaign, gameName, showHeader) {
    const drops = campaign.drops || [];
    const total = drops.length;

    let sum = 0;
    drops.forEach(drop => {
      const raw = drop.required > 0 ? Math.floor((drop.progress / drop.required) * 100) : 0;
      sum += this.isDropEarned(drop) ? 100 : Math.min(100, raw);
    });

    const percent = total > 0 ? Math.floor(sum / total) : 0;
    const completed = drops.filter(d => this.isDropEarned(d)).length;
    const timeLeft = this.formatCampaignTimeLeft(campaign.endsAt || campaign.endAt);
    const accentSolid = percent === 100 ? '#35d08a' : '#7c5cff';
    const campaignTitle = campaign.name || gameName;
    const notStarted = campaign.inProgress === false;

    // Заголовок кампании показываем только когда кампаний несколько —
    // иначе он дублировал бы общий заголовок блока.
    const header = showHeader ? `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; padding: 8px 12px; background: rgba(124, 92, 255, 0.06); border: 1px solid rgba(124, 92, 255, 0.18); border-radius: var(--radius-md);">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          ${campaign.game?.boxArtURL ? `<img src="${campaign.game.boxArtURL}" alt="" style="width: 24px; height: 32px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0;">` : ''}
          <span style="font-size: 13px; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${campaignTitle}">${campaignTitle}</span>
          ${notStarted ? `<span style="flex-shrink: 0; padding: 2px 6px; background: rgba(255, 152, 0, 0.15); color: #ff9800; border-radius: var(--radius-sm); font-size: 10px; font-weight: 700; text-transform: uppercase;">Не начата</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
          ${timeLeft ? `<span style="font-size: 11px; color: var(--text-secondary);">${timeLeft}</span>` : ''}
          <span style="font-size: 13px; font-weight: 700; color: ${accentSolid};">${completed}/${total} · ${percent}%</span>
        </div>
      </div>
    ` : '';

    return {
      percent,
      total,
      completed,
      html: `
        <div class="drops-campaign-section" style="margin-bottom: 16px;">
          ${header}
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; max-width: 100%;">
            ${drops.map(drop => this.renderDropCard(drop, campaign, gameName)).join('')}
          </div>
        </div>
      `
    };
  }

  async updateDropsHorizontalProgress() {
    const i18n = this.i18n;

    try {
      // Определяем название игры для текущей кампании
      let currentGameName = (this.currentCategory && this.currentCategory.name) ? this.currentCategory.name : '';
      if (!currentGameName) {
        const gameEl = document.getElementById('stream-game');
        if (gameEl && gameEl.textContent) {
          currentGameName = gameEl.textContent.replace(/^\s*Игра:\s*/i, '').trim();
        }
      }
      if (!currentGameName) return { hasDrops: false };

      const result = await window.electronAPI.fetchDropsInventory();
      if (!result || !result.campaigns) return { hasDrops: false };

      // ВСЕ кампании этой игры, а не только первая найденная
      const matched = this.matchCampaignsForGame(result.campaigns, currentGameName)
        .filter(c => Array.isArray(c.drops) && c.drops.length > 0);

      const horizontal = document.getElementById('drops-progress-horizontal');
      if (!horizontal) return { hasDrops: false };

      if (matched.length === 0) {
        horizontal.style.display = 'none';
        return { hasDrops: false };
      }

      console.log('[Drops] Кампаний для', currentGameName + ':', matched.length,
        matched.map(c => c.name).join(' | '));

      this.trackSessionDrops(matched);

      horizontal.style.display = 'block';

      const showCampaignHeaders = matched.length > 1;
      const sections = matched.map(c => this.renderCampaignSection(c, currentGameName, showCampaignHeaders));

      // Общий прогресс — по всем дропсам всех кампаний сразу
      const totalDrops = sections.reduce((sum, s) => sum + s.total, 0);
      const completedDrops = sections.reduce((sum, s) => sum + s.completed, 0);
      const weightedProgress = sections.reduce((sum, s) => sum + s.percent * s.total, 0);
      const overallPercent = totalDrops > 0 ? Math.floor(weightedProgress / totalDrops) : 0;

      // Ближайшее время окончания среди всех кампаний
      const soonestEnd = matched
        .map(c => c.endsAt || c.endAt)
        .filter(Boolean)
        .sort((a, b) => new Date(a) - new Date(b))[0];
      const timeRemaining = this.formatCampaignTimeLeft(soonestEnd);

      const accentSolid = overallPercent === 100 ? '#35d08a' : '#7c5cff';
      const accentRgb = overallPercent === 100 ? '53, 208, 138' : '124, 92, 255';

      horizontal.innerHTML = `
        <style>
          @keyframes pulse-glow {
            0%, 100% { box-shadow: none; }
            50% { box-shadow: none; }
          }
          .drop-progress-card {
            transform: translateY(0) scale(1);
            box-shadow: none;
          }
        </style>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="#7c5cff">
                <path d="M8 2L10 6H14L11 9L12 13L8 10.5L4 13L5 9L2 6H6L8 2Z"/>
              </svg>
              <span style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${i18n.t('farming.dropsProgress')}</span>
            </div>
            ${matched.length > 1 ? `
              <span style="padding: 3px 8px; background: rgba(124, 92, 255, 0.15); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-md); font-size: 11px; font-weight: 700; color: #7c5cff;">
                ${matched.length} кампании
              </span>
            ` : ''}
            ${timeRemaining ? `
              <div style="display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: rgba(124, 92, 255, 0.15); border-radius: var(--radius-md); border: 1px solid rgba(124, 92, 255, 0.3);">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="#7c5cff">
                  <circle cx="8" cy="8" r="7" stroke="#7c5cff" stroke-width="1.5" fill="none"/>
                  <path d="M8 3.5V8L11 10" stroke="#7c5cff" stroke-width="1.5" stroke-linecap="round" fill="none"/>
                </svg>
                <span style="font-size: 12px; font-weight: 600; color: #7c5cff;">${timeRemaining}</span>
              </div>
            ` : ''}
          </div>
          <div style="font-size: 20px; font-weight: 800; color: ${accentSolid};">${overallPercent}%</div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.12); height: 12px; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 16px;">
          <div style="height: 100%; background: ${accentSolid} !important; width: ${overallPercent}%; transition: width 0.5s ease;"></div>
        </div>
        ${sections.map(s => s.html).join('')}
        <div id="drops-received-footer" style="margin-top: 12px; padding: 12px; background: rgba(${accentRgb}, 0.1); border-radius: var(--radius-sm); border: 1px solid rgba(${accentRgb}, 0.3); font-size: 13px; color: var(--text-secondary); text-align: center;">
          ${overallPercent === 100
            ? `<span style="color: #35d08a; font-weight: 600;">✓ ${i18n.t('farming.allDropsClaimed')}</span>`
            : `<span style="color: var(--text-primary); font-weight: 600; cursor: pointer;">${completedDrops}/${totalDrops} ${i18n.t('statistics.dropsReceived')}</span>`
          }
        </div>
      `;

      // Обработчик для тестирования уведомлений (DevMode + Shift + Click)
      setTimeout(() => {
        const footer = document.getElementById('drops-received-footer');
        if (footer && overallPercent < 100) {
          footer.addEventListener('click', (e) => {
            if (!e.shiftKey) return;

            let isDeveloperMode = false;
            try {
              const savedSettings = localStorage.getItem('app_settings');
              if (savedSettings) {
                isDeveloperMode = JSON.parse(savedSettings).developerMode === true;
              }
            } catch (err) {
              console.error('[DropsProgress] Failed to read settings:', err);
            }

            if (isDeveloperMode) {
              window.showDropNotification(
                '8x 250 Lucky Envelopes',
                'Palia',
                'https://static-cdn.jtvnw.net/ttv-boxart/1239948690_IGDB-285x380.jpg'
              );
              window.utils.showToast('Тестовое уведомление отправлено', 'info');
            } else {
              window.utils.showToast('Включите "Режим разработчика" в настройках', 'warning');
            }
          });
        }
      }, 200);

      // Обновляем статус категории
      if (this.currentCategory) {
        this.currentCategory.dropsCompleted = overallPercent === 100;
        this.currentCategory.dropsProgressPercent = overallPercent;
        this.currentCategory.dropsEndsAt = soonestEnd;
        await Storage.saveCategories(this.categories);
        this.renderCategories();

        this.updateMiniDropsProgress(overallPercent);

        // Если все дропсы получены - сразу переключаемся
        if (overallPercent === 100 && !this.currentCategory._switchScheduled) {
          if (this.isSingleManualPlayLocked()) {
            console.log('[ManualPlayLock] Drops completed, keeping category enabled');
            return { hasDrops: true, overallPercent };
          }

          this.currentCategory._switchScheduled = true;

          // Авто-категории удаляем СРАЗУ после завершения
          if (this.currentCategory.autoDrops) {
            console.log('Auto-category completed, removing:', this.currentCategory.name);
            const categoryId = this.currentCategory.id;
            this.categories = this.categories.filter(c => c.id !== categoryId);
            this.currentCategory = null;
            await Storage.saveCategories(this.categories);
            this.renderCategories();
          } else {
            // Пользовательские категории отключаем вместо удаления
            console.log('Category completed, disabling:', this.currentCategory.name);
            this.currentCategory.enabled = false;
            await Storage.saveCategories(this.categories);
            this.renderCategories();
            this.currentCategory = null;
          }

          // Переключаемся на следующую категорию
          setTimeout(() => {
            this.switchToNextEnabledCategory();
          }, 2000);
        }
      }

      return { hasDrops: true, overallPercent };
    } catch (error) {
      console.error('Error updating drops horizontal progress:', error);
    }
  }

  /**
   * Предложение переключиться, когда в вручную запущенной категории нет дропсов.
   *
   * Показывается на месте блока прогресса дропсов — там, где пользователь и
   * ожидает увидеть их состояние. Решение остаётся за ним: приложение не
   * трогает категорию, которую он выбрал сам.
   */
  showSwitchOffer() {
    const container = document.getElementById('drops-progress-horizontal');
    if (!container) return;

    const candidate = this.categories.find(cat =>
      cat.enabled !== false &&
      cat.hasDrops &&
      !cat.dropsCompleted &&
      cat.id !== this.currentCategory?.id
    );

    const categoryName = this.currentCategory?.name || '';

    container.style.display = 'block';
    container.innerHTML = `
      <div class="switch-offer">
        <div class="switch-offer-text">
          <div class="switch-offer-title">В категории «${categoryName}» дропсов нет</div>
          <div class="switch-offer-sub">
            ${candidate
              ? `Категория запущена вручную, поэтому переключать её сами не будем. Есть дропсы в «${candidate.name}».`
              : 'Категория запущена вручную и останется активной. Других категорий с дропсами сейчас нет.'}
          </div>
        </div>
        ${candidate ? `
          <div class="switch-offer-actions">
            <button class="btn btn-secondary" id="switch-offer-stay">Остаться</button>
            <button class="btn btn-primary" id="switch-offer-go" data-category-id="${candidate.id}">
              Перейти в «${candidate.name}»
            </button>
          </div>
        ` : ''}
      </div>
    `;

    const stay = container.querySelector('#switch-offer-stay');
    if (stay) {
      stay.addEventListener('click', () => {
        container.innerHTML = '';
        container.style.display = 'none';
      });
    }

    const go = container.querySelector('#switch-offer-go');
    if (go) {
      go.addEventListener('click', async () => {
        const target = this.categories.find(cat => cat.id === go.dataset.categoryId);
        if (!target) return;

        // Пользователь согласился — отметку ручного запуска снимаем
        this.manualCategoryId = null;
        this.manualPlayLockCategoryId = null;
        container.innerHTML = '';
        container.style.display = 'none';

        await this.startFarmingForCategory(target);
      });
    }
  }

  /** Идёт ли сейчас категория, которую пользователь запустил вручную. */
  isManualCategoryActive() {
    return !!(this.manualCategoryId && this.currentCategory?.id === this.manualCategoryId);
  }

  async handleCategoryNoDrops() {
    if (!this.currentCategory) return;

    // Категорию, запущенную вручную, приложение не переключает само.
    // Прежняя блокировка срабатывала только когда включена ровно одна
    // категория и она же единственная ручная — то есть почти никогда.
    // Теперь достаточно того, что пользователь сам нажал Play.
    if (this.isManualCategoryActive()) {
      console.log('[Ручной запуск] Дропсов нет, но категорию не меняем:', this.currentCategory.name);
      this.dropsMissingChecks = 0;
      this.showSwitchOffer();
      return;
    }

    console.warn('No drops visible for category, disabling from list...', this.currentCategory.name);
    
    // Отключаем категорию без дропсов (не удаляем)
    const categoryName = this.currentCategory.name;
    
    if (this.currentCategory.autoDrops) {
      // Авто-категории можем удалить
      if (this.currentCategory.pinned) {
        // Закреплённую категорию не удаляем, только выключаем
        this.currentCategory.enabled = false;
      } else {
        this.categories = this.categories.filter(cat => cat.id !== this.currentCategory.id);
      }
    } else {
      // Пользовательские категории отключаем
      this.currentCategory.enabled = false;
    }
    
    this.currentCategory = null;
    this.dropsMissingChecks = 0;

    await Storage.saveCategories(this.categories);
    this.renderCategories();
    
    window.utils.showToast(`${categoryName} отключена (дропсы не найдены)`, 'warning');

    // Переключаемся на следующую доступную категорию
    const switched = await this.switchToNextEnabledCategory();
    if (!switched) {
      // Если переключаться некуда — останавливаем фарминг и закрываем стрим
      await this.stopFarming();
    }
  }

  stopFarming(showToast = true, preserveSession = false) {
    this.manualPlayLockCategoryId = null;
    this.manualCategoryId = null;

    if (showToast) {
      window.utils.showToast('Фарминг остановлен', 'info');
    }
    if (!preserveSession) {
      Storage.delete('activeSession').catch(() => {});
    }
    
    // Останавливаем интервал обновления статистики
    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
      this.statsUpdateInterval = null;
    }
    
    // Финализируем текущую сессию в статистике
    if (this.sessionStartTime) {
      const duration = Math.floor((Date.now() - this.sessionStartTime) / 60000); // в минутах
      const durationMs = Date.now() - this.sessionStartTime; // в миллисекундах
      
      Storage.finalizeCurrentSession({
        duration: duration,
        bandwidth: this.estimatedBandwidth,
        bandwidthHistory: this.bandwidthHistory,
        pointsEarned: this.channelPoints.sessionEarned || 0,
        chestsCollected: this.channelPoints.chestsCollected || 0,
        dropsCollected: this.sessionDropsCollected || 0
      });
      
      // Сохраняем статистику по категории
      if (this.currentCategory?.name) {
        this.saveWatchTimeForCategory(this.currentCategory.name, durationMs);
      }
    }
    
    // Обновляем кнопки в сайдбаре с плавной анимацией
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    
    // Скрываем информацию о сессии с анимацией
    const sessionInfo = document.getElementById('farming-session-info');
    if (sessionInfo) {
      sessionInfo.style.opacity = '0';
      sessionInfo.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        sessionInfo.style.display = 'none';
      }, 300);
    }
    
    // Скрываем блок баллов
    const pointsCard = document.getElementById('channel-points-card');
    if (pointsCard) {
      pointsCard.style.display = 'none';
    }
    
    if (stopBtn) {
      stopBtn.style.opacity = '0';
      stopBtn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        stopBtn.style.display = 'none';
        if (startBtn) {
          startBtn.style.display = 'flex';
          setTimeout(() => {
            startBtn.style.opacity = '1';
            startBtn.style.transform = 'scale(1)';
          }, 10);
        }
      }, 200);
    }
    
    // Останавливаем трекинг сессии
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    this.sessionStartTime = null;
    this.estimatedBandwidth = 0;
    
    // Скрываем таймер сессии
    const sessionTimerDisplay = document.getElementById('session-timer-display');
    if (sessionTimerDisplay) {
      sessionTimerDisplay.style.display = 'none';
    }
    
    // Скрываем прогресс дропсов в сайдбаре
    const sidebarProgress = document.getElementById('sidebar-drops-progress');
    if (sidebarProgress) {
      sidebarProgress.style.opacity = '0';
      sidebarProgress.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        sidebarProgress.style.display = 'none';
      }, 300);
    }
    
    // Скрываем панель топ категорий
    const topPanel = document.getElementById('top-categories-panel');
    if (topPanel) {
      topPanel.style.display = 'none';
    }
    
    // Обновляем мини-плеер в сайдбаре - скрываем его
    if (window.router && typeof window.router.manageMiniPlayer === 'function') {
      window.router.manageMiniPlayer(window.router.currentPage);
    }

    // Mark global farming inactive
    if (window.streamingManager) {
      try { window.streamingManager.isFarming = false; } catch (e) {}
    }
    
    // Останавливаем polling баллов (владелец — SessionState)
    window.sessionState?.stopPointsPolling();


    // Останавливаем проверку состояния трансляции
    if (this.streamHealthCheckInterval) {
      clearInterval(this.streamHealthCheckInterval);
      this.streamHealthCheckInterval = null;
    }
    
    // Сбрасываем счетчики баллов.
    //
    // Раньше здесь стояло присваивание в this.channelPoints. После переноса
    // учёта в SessionState это свойство стало вычисляемым, а тело метода
    // класса выполняется в строгом режиме — присваивание выбрасывало
    // TypeError и обрывало stopFarming ровно посередине: уведомление и
    // скрытие сессии успевали произойти, а закрытие стрима и выгрузка
    // плеера, стоящие ниже, — уже нет. Стрим продолжал играть, а запуск
    // другой категории падал вместе с обработчиком.
    window.sessionState?.resetPoints();
    
    // Закрываем стрим
    window.electronAPI.closeStream();
    
    // Останавливаем обновление статистики
    if (this.streamStatsInterval) {
      clearInterval(this.streamStatsInterval);
      this.streamStatsInterval = null;
    }
    
    // Показываем контейнер обратно и очищаем UI текущего стрима
    const streamInfo = document.getElementById('current-stream-info');
    const playerContainer = document.getElementById('twitch-player-container');

    // Здесь фарминг действительно завершается, поэтому плеер выгружаем полностью
    window.playerManager?.unload();

    if (streamInfo && playerContainer) {
      playerContainer.style.display = 'none';
      streamInfo.style.display = 'block';
      streamInfo.innerHTML = this.getWaitingStateMarkup();
    }
  }

  async updateSessionInfo() {
    if (!this.sessionStartTime) return;

    // Отрисовкой таймера и трафика занимается SessionState — он тикает
    // независимо от того, открыта ли сейчас страница фарминга.
    await window.sessionState?._tick();
    await this.updateTrafficInfo();
  }

  /**
   * Забирает реальный расход трафика из main-процесса.
   * Источник — CDP Network.dataReceived, единственный счётчик в приложении.
   */
  async updateTrafficInfo() {
    if (!window.electronAPI?.getTrafficStats) return;

    try {
      const stats = await window.electronAPI.getTrafficStats();
      if (!stats) return;

      this.estimatedBandwidth = stats.sessionBytes || 0;

      // История скорости для графика в статистике (храним последние 120 замеров)
      const rate = Math.round(stats.currentRateKBs || 0);
      this.bandwidthHistory.push(rate);
      if (this.bandwidthHistory.length > 120) {
        this.bandwidthHistory = this.bandwidthHistory.slice(-120);
      }

      const trafficEl = document.getElementById('session-traffic-value');
      if (trafficEl) {
        trafficEl.textContent = this.formatBytes(this.estimatedBandwidth);
      }

      const rateEl = document.getElementById('session-traffic-rate');
      if (rateEl) {
        rateEl.textContent = rate > 1024
          ? `${(rate / 1024).toFixed(1)} МБ/с`
          : `${rate} КБ/с`;
      }
    } catch (error) {
      console.warn('[Traffic] Не удалось получить статистику трафика:', error?.message);
    }
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async updateLiveStatistics() {
    if (!this.sessionStartTime) return;
    
    const duration = Math.floor((Date.now() - this.sessionStartTime) / 60000); // в минутах
    
    await Storage.updateCurrentSession({
      timestamp: this.sessionStartTime,
      duration: duration,
      category: this.currentCategory?.name || 'Unknown',
      channel: this.currentStream?.displayName || 'Unknown',
      bandwidth: this.estimatedBandwidth,
      bandwidthHistory: this.bandwidthHistory,
      categoryBoxArtURL: this.currentCategory?.boxArtURL || '',
      pointsEarned: this.channelPoints.sessionEarned || 0,
      chestsCollected: this.channelPoints.chestsCollected || 0,
      dropsCollected: this.sessionDropsCollected || 0
    });
    
    // Отправляем событие об обновлении статистики
    window.dispatchEvent(new CustomEvent('statistics-updated'));
  }


  updateMiniDropsProgress(percent) {
    const sidebarProgress = document.getElementById('sidebar-drops-progress');
    const sidebarPercent = document.getElementById('sidebar-drops-percent');
    const sidebarBar = document.getElementById('sidebar-drops-bar');
    
    if (sidebarProgress && sidebarPercent && sidebarBar) {
      if (percent > 0) {
        sidebarProgress.style.display = 'block';
        setTimeout(() => {
          sidebarProgress.style.opacity = '1';
          sidebarProgress.style.transform = 'translateY(0)';
        }, 10);
        
        sidebarPercent.textContent = `${Math.round(percent)}%`;
        sidebarBar.style.width = `${percent}%`;
        
        // Меняем цвет в зависимости от прогресса
        if (percent === 100) {
          sidebarProgress.style.borderColor = 'rgba(53, 208, 138, 0.4)';
          sidebarBar.style.background = '#35d08a';
        } else {
          sidebarProgress.style.borderColor = 'var(--border-color)';
          sidebarBar.style.background = '#7c5cff';
        }
      } else {
        sidebarProgress.style.opacity = '0';
        sidebarProgress.style.transform = 'translateY(-10px)';
        setTimeout(() => {
          sidebarProgress.style.display = 'none';
        }, 300);
      }
    }
  }

  async saveWatchTimeForCategory(categoryName, durationMs) {
    try {
      const stats = (await Storage.getWatchTimeStats()) || {};
      
      if (!stats[categoryName]) {
        stats[categoryName] = {
          totalTime: 0,
          sessions: 0,
          lastWatched: 0
        };
      }
      
      stats[categoryName].totalTime += durationMs;
      stats[categoryName].sessions += 1;
      stats[categoryName].lastWatched = Date.now();
      
      await Storage.saveWatchTimeStats(stats);
    } catch (error) {
      console.error('Error saving watch time stats:', error);
    }
  }

  showFarmingState() {
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    if (startBtn) {
      startBtn.style.display = 'none';
      startBtn.style.opacity = '0';
      startBtn.style.transform = 'scale(0.95)';
    }
    if (stopBtn) {
      stopBtn.style.display = 'flex';
      stopBtn.style.opacity = '1';
      stopBtn.style.transform = 'scale(1)';
    }
  }
  
  updateCurrentStreamUI(stream, category) {
    const streamInfo = document.getElementById('current-stream-info');
    const playerContainer = document.getElementById('twitch-player-container');
    const player = window.playerManager?.getWebview();

    this.registerFarmingWebviewLabels();

    if (streamInfo && playerContainer && player) {
      // Скрываем no-stream и показываем плеер
      streamInfo.style.display = 'none';
      playerContainer.style.display = 'block';

      // Загружаем стрим с низким качеством.
      // load() сам проверит, не тот же ли это канал, и не станет
      // перезагружать webview впустую.
      window.playerManager.load(stream.login);
      window.playerManager.attachTo('farming-player-slot');

      // Автоматически обрабатываем mature content warning
      this.setupMatureContentHandler(player);

      // Устанавливаем низкое качество при загрузке плеера
      player.addEventListener('dom-ready', () => {
        // Пробуем установить качество через JavaScript injection
        player.executeJavaScript(`
          setTimeout(() => {
            try {
              // Пытаемся найти кнопку настроек качества
              const settingsBtn = document.querySelector('[data-a-target="player-settings-button"]');
              if (settingsBtn) {
                settingsBtn.click();
                setTimeout(() => {
                  const qualityBtn = document.querySelector('[data-a-target="player-settings-menu-item-quality"]');
                  if (qualityBtn) {
                    qualityBtn.click();
                    setTimeout(() => {
                      // Выбираем самое низкое качество (последний пункт обычно)
                      const qualityOptions = document.querySelectorAll('[data-a-target="player-settings-menu-item-quality"] input');
                      if (qualityOptions.length > 0) {
                        qualityOptions[qualityOptions.length - 1].click();
                      }
                      // Закрываем меню через 100мс
                      setTimeout(() => {
                        const settingsBtn = document.querySelector('[data-a-target="player-settings-button"]');
                        if (settingsBtn) settingsBtn.click();
                      }, 100);
                    }, 300);
                  }
                }, 300);
              }
            } catch(e) {
              console.error('Quality setup error:', e);
            }
          }, 2000);
          // Проверяем видео каждые 10 сек, если паузу жмём play
          setInterval(() => {
            try {
              const video = document.querySelector('video');
              if (video && video.paused) {
                video.play().catch(() => {});
              }
            } catch (e) {}
          }, 10000);
        `).catch(e => console.error('Failed to inject quality script:', e));
      }, { once: true });
      
      // Сохраняем текущую категорию и стрим
      this.currentCategory = category;
      this.currentStream = stream;
      
      // Обновляем информацию о стриме
      document.getElementById('stream-channel').textContent = stream.displayName;
      document.getElementById('stream-game').textContent = `Игра: ${category.name}`;
      document.getElementById('stream-title').textContent = stream.title || 'Без названия';
      
      // Теги стрима. Видимостью управляет CSS через :not(:empty),
      // поэтому здесь достаточно записать текст или очистить его.
      const categoryEl = document.getElementById('stream-category');
      if (categoryEl) {
        const tags = Array.isArray(stream.tags)
          ? stream.tags.filter(tag => tag && String(tag).trim())
          : [];
        categoryEl.textContent = tags.join(' · ');
      }
      
      // Отображаем обложку игры
      const gameCover = document.getElementById('stream-game-cover');
      if (gameCover && category.boxArtURL) {
        gameCover.src = category.boxArtURL;
        gameCover.style.display = 'block';
      }
      
      // Очищаем историю зрителей
      this.viewersHistory = [];
      
      // Настраиваем график зрителей
      this.setupViewersChart();
      
      // Запускаем обновление статистики
      this.startStreamStatsUpdate(stream.login);
      
      // Проверяем статус подписки
      this.checkFollowingStatus();
      
      // Добавляем обработчик клика на информацию о стриме
      this.setupStreamInfoClick();
    }
  }

  registerFarmingWebviewLabels() {
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

    registerWebviewLabel('twitch-player', 'Twitch Player (Main)');
    registerWebviewLabel('twitch-chat', 'Twitch Chat');
    registerWebviewLabel('drops-data-extractor', 'Drops Data Extractor');
  }

  setupStreamInfoClick() {
    const streamDetails = document.getElementById('stream-details');
    if (streamDetails) {
      streamDetails.style.cursor = 'pointer';

      if (this.streamInfoClickHandler) {
        streamDetails.removeEventListener('click', this.streamInfoClickHandler);
      }
      
      // Клик на блок с информацией о стриме
      this.streamInfoClickHandler = async (e) => {
        // Игнорируем клик на кнопку чата
        if (e.target.closest('#toggle-chat-btn')) return;

        if (!this.currentStream || !this.currentCategory) return;
        if (this.isStreamDetailsOpen) return;
        if (document.querySelector('.category-detail-modal')) return;

        this.isStreamDetailsOpen = true;
        await this.showCurrentStreamDetails();
      };

      streamDetails.addEventListener('click', this.streamInfoClickHandler);
    }
  }

  async showCurrentStreamDetails() {
    if (!this.currentStream || !this.currentCategory) return;
    if (document.querySelector('.category-detail-modal')) return;

    this.isStreamDetailsOpen = true;

    const i18n = window.i18n;
    const stream = this.currentStream;
    const category = this.currentCategory;

    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'category-detail-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.2s ease;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      width: 90%;
      max-width: 800px;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.3s ease;
    `;

    // Получаем полную информацию о канале
    const accounts = await Storage.getAccounts();
    
    // Пытаемся найти токен: сначала из кук (authToken), потом OAuth (accessToken)
    let authToken = '';
    let account = null;
    
    // Приоритет 1: auth-token из кук
    for (const acc of accounts) {
      if (acc.cookies) {
        try {
          const cookies = JSON.parse(acc.cookies);
          const authTokenCookie = cookies.find(c => c.name === 'auth-token');
          if (authTokenCookie?.value) {
            authToken = authTokenCookie.value;
            account = acc;
            console.log('[StreamDetails] Using auth-token from cookies');
            break;
          }
        } catch (e) {
          console.warn('[StreamDetails] Failed to parse cookies:', e);
        }
      }
    }
    
    // Приоритет 2: OAuth accessToken если auth-token не найден
    if (!authToken) {
      account = accounts.find(acc => acc.accessToken);
      authToken = account?.accessToken || '';
      if (authToken) {
        console.log('[StreamDetails] Using OAuth accessToken');
      }
    }
    
    console.log('[StreamDetails] Found accounts:', accounts.length);
    console.log('[StreamDetails] Selected account:', account?.username || 'none');
    console.log('[StreamDetails] Auth token available:', !!authToken);
    
    let channelDetails = {
      profileImageUrl: '',
      description: '',
      followers: 0,
      isLive: false
    };
    let streamStats = {
      viewers: 0,
      uptime: '',
      points: 0
    };
    
    try {
      // Загружаем данные параллельно
      const promises = [
        window.electronAPI.getStreamStats(stream.login)
      ];
      
      // getChannelDetails требует токен
      if (authToken) {
        promises.push(window.electronAPI.getChannelDetails(authToken, stream.login));
      }
      
      const results = await Promise.all(promises);
      streamStats = results[0] || streamStats;
      
      if (results.length > 1) {
        channelDetails = results[1] || channelDetails;
      }
      
      console.log('[StreamDetails] Channel details:', channelDetails);
      console.log('[StreamDetails] Channel details JSON:', JSON.stringify(channelDetails, null, 2));
      console.log('[StreamDetails] Stream stats:', streamStats);
      console.log('[StreamDetails] Stream stats JSON:', JSON.stringify(streamStats, null, 2));
      console.log('[StreamDetails] profileImageUrl:', channelDetails.profileImageUrl);
      console.log('[StreamDetails] followers:', channelDetails.followers);
      console.log('[StreamDetails] description:', channelDetails.description);
    } catch (error) {
      console.error('[StreamDetails] Error fetching details:', error);
    }

    // Фоллбэк для аватарки
    const profileImageUrl = channelDetails.profileImageUrl || 
      `https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-300x300.png`;
    
    console.log('[StreamDetails] Profile image URL:', profileImageUrl);
    
    // Функция форматирования зрителей
    const formatViewers = (count) => {
      if (!count) return '—';
      if (count < 10000) return count.toLocaleString();
      return (count / 1000).toFixed(1) + 'K';
    };

    modalContent.innerHTML = `
      <div style="position: relative;">
        <button id="close-stream-modal" style="position: absolute; top: 16px; right: 16px; background: rgba(255, 255, 255, 0.1); border: none; width: 32px; height: 32px; border-radius: var(--radius-circle); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; z-index: 10;" onmouseover="this.style.background='rgba(255, 255, 255, 0.2)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.1)'">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="color: var(--text-primary);">
            <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <!-- Header with blur background -->
        <div style="position: relative; height: 180px; overflow: hidden; border-radius: 16px 16px 0 0;">
          <div style="position: absolute; inset: 0; background: url('${profileImageUrl}'); background-size: cover; background-position: center; filter: blur(40px) brightness(0.6); transform: scale(1.2);"></div>
          <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.3);"></div>
          
          <div style="position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center;">
            <div style="position: relative; margin-bottom: 12px;">
              <img src="${profileImageUrl}" 
                   alt="${stream.displayName}"
                   onerror="this.onerror=null; this.src='https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-300x300.png';"
                   style="width: 80px; height: 80px; border-radius: var(--radius-circle); border: 3px solid white; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);">
              ${channelDetails.isLive ? '<div style="position: absolute; bottom: 0; right: 0; width: 24px; height: 24px; background: #ff0000; border: 3px solid white; border-radius: var(--radius-circle); box-shadow: 0 0 12px rgba(255, 0, 0, 0.8);"></div>' : ''}
            </div>
            <h2 style="color: white; font-size: 26px; font-weight: 700; margin: 0 0 4px; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);">${stream.displayName}</h2>
            <div style="color: rgba(255, 255, 255, 0.8); font-size: 14px; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);">@${stream.login}</div>
          </div>
        </div>

        <!-- Content -->
        <div style="padding: 24px;">
          <!-- Stats Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px;">
            ${channelDetails.followers ? `
            <div style="background: rgba(255, 215, 0, 0.1); border: 1px solid rgba(255, 215, 0, 0.2); border-radius: var(--radius-md); padding: 16px; text-align: center;">
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: rgba(255, 215, 0, 0.8); margin-bottom: 6px; letter-spacing: 0.5px;">Подписчиков</div>
              <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${this.formatFollowers(channelDetails.followers)}</div>
            </div>` : ''}
            ${streamStats.viewers ? `
            <div style="background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.2); border-radius: var(--radius-md); padding: 16px; text-align: center;">
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: rgba(124, 92, 255, 0.8); margin-bottom: 6px; letter-spacing: 0.5px;">Зрителей</div>
              <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${formatViewers(streamStats.viewers)}</div>
            </div>` : ''}
            ${streamStats.uptime ? `
            <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: var(--radius-md); padding: 16px; text-align: center;">
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: rgba(59, 130, 246, 0.8); margin-bottom: 6px; letter-spacing: 0.5px;">В эфире</div>
              <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${streamStats.uptime}</div>
            </div>` : ''}
            ${streamStats.points ? `
            <div style="background: rgba(53, 208, 138, 0.1); border: 1px solid rgba(53, 208, 138, 0.2); border-radius: var(--radius-md); padding: 16px; text-align: center;">
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: rgba(53, 208, 138, 0.8); margin-bottom: 6px; letter-spacing: 0.5px;">Очки канала</div>
              <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${streamStats.points.toLocaleString()}</div>
            </div>` : ''}
          </div>

          <!-- Stream Title -->
          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width: 2;">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
              Название стрима
            </div>
            <div id="stream-title-text" style="font-size: 15px; line-height: 1.5; color: var(--text-primary); font-weight: 500; cursor: pointer; padding: 8px; margin: -8px; border-radius: var(--radius-sm); transition: all 0.2s;" onmouseover="this.style.background='rgba(124, 92, 255, 0.1)'" onmouseout="this.style.background='transparent'" onclick="
              navigator.clipboard.writeText('${(stream.title || 'Без названия').replace(/'/g, "\\'")}').then(() => {
                window.utils.showToast('Название скопировано', 'success');
              }).catch(() => {
                window.utils.showToast('Ошибка копирования', 'error');
              });
            ">${stream.title || 'Без названия'}</div>
          </div>

          <!-- Category Info -->
          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width: 2;">
                <rect x="6" y="2" width="12" height="20" rx="2"/>
                <path d="M12 6h.01M10 10h4M10 14h4"/>
              </svg>
              Категория
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${category.boxArtURL || 'https://static-cdn.jtvnw.net/ttv-boxart/509658-60x84.jpg'}" 
                   alt="${category.name}"
                   style="width: 48px; height: 67px; border-radius: var(--radius-md); object-fit: cover; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);">
              <div style="flex: 1;">
                <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${category.name}</div>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <span style="color: var(--text-secondary); font-size: 12px; display: flex; align-items: center; gap: 4px;">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="color: #7c5cff;">
                      <path d="M8 2C4.5 2 1.5 4.5 0 8c1.5 3.5 4.5 6 8 6s6.5-2.5 8-6c-1.5-3.5-4.5-6-8-6zm0 10c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4zm0-6.5c-1.4 0-2.5 1.1-2.5 2.5s1.1 2.5 2.5 2.5 2.5-1.1 2.5-2.5-1.1-2.5-2.5-2.5z"/>
                    </svg>
                    ${this.formatViewersCount(category.viewersCount)} зрителей
                  </span>
                  ${category.hasDrops ? `
                  <span style="display: flex; align-items: center; gap: 4px; padding: 3px 8px; background: rgba(124, 92, 255, 0.15); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-md); font-size: 11px; font-weight: 600; color: #7c5cff;">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 2L10 6H14L11 9L12 13L8 10.5L4 13L5 9L2 6H6L8 2Z"/>
                    </svg>
                    Дропсы
                  </span>` : ''}
                </div>
              </div>
            </div>
          </div>

          ${channelDetails.description ? `
          <!-- Channel Description -->
          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width: 2;">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4M12 8h.01"/>
              </svg>
              О канале
            </div>
            <div style="font-size: 13px; line-height: 1.6; color: var(--text-primary);">${channelDetails.description}</div>
          </div>` : ''}

          <!-- Action Buttons -->
          <div style="display: flex; gap: 12px; margin-top: 20px;">
            <button onclick="window.electronAPI.openExternal('https://twitch.tv/${stream.login}')" style="flex: 1; padding: 12px 20px; background: #7c5cff; color: white; border: none; border-radius: var(--radius-md); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;" onmouseover="this.style.boxShadow='0 4px 12px rgba(124, 92, 255, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 1h12l1 1v10l-1 1h-3v2l-2-2H6l-2 2v-2H2l-1-1V2l1-1z"/>
                <path d="M5 4h1v4H5V4zm4 0h1v4H9V4z" fill="#7c5cff"/>
              </svg>
              Открыть на Twitch
            </button>
          </div>
        </div>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Обработчик закрытия
    const closeModal = () => {
      modal.style.opacity = '0';
      modalContent.style.transform = 'translateY(20px)';
      setTimeout(() => {
        document.body.removeChild(modal);
        this.isStreamDetailsOpen = false;
      }, 200);
    };

    // Закрытие по клику на overlay
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Закрытие по клику на кнопку
    const closeBtn = modal.querySelector('#close-stream-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }
  }

  
  startStreamStatsUpdate(channelLogin) {
    // Очищаем старый интервал
    if (this.streamStatsInterval) {
      clearInterval(this.streamStatsInterval);
    }
    
    // Обновляем сразу и каждые 30 секунд
    const updateStats = async () => {
      try {
        const stats = await window.electronAPI.getStreamStats(channelLogin);
        if (stats) {
          // Обновляем зрителей
          const viewers = stats.viewers || 0;
          document.getElementById('stream-viewers').textContent = viewers.toLocaleString();
          
          // Сохраняем в историю (максимум 100 значений)
          this.viewersHistory.push({
            time: Date.now(),
            count: viewers
          });
          if (this.viewersHistory.length > 100) {
            this.viewersHistory.shift();
          }
          
          // Обновляем uptime
          document.getElementById('stream-uptime').textContent = 
            stats.uptime || '-';

          // Проверяем, что стример всё ещё в нужной игре (категории)
          const expectedCategory = this.currentCategory?.name;
          const currentGame = stats.gameName || '';
          if (expectedCategory && currentGame) {
            const match = this._gameMatchesCategory(currentGame, expectedCategory);
            if (!match) {
              this._gameMismatchCount = (this._gameMismatchCount || 0) + 1;
              console.log('Game mismatch detected:', { currentGame, expectedCategory, count: this._gameMismatchCount });
              const MAX_MISMATCHES = 2; // две проверки подряд (~60 сек)
              if (this._gameMismatchCount >= MAX_MISMATCHES) {
                this._gameMismatchCount = 0;
                window.utils?.showToast('Стример сменил игру — переключаюсь', 'info');
                try {
                  // Пытаемся найти другой стрим в той же категории
                  const streams = await window.electronAPI.getStreamsWithDrops(expectedCategory);
                  if (streams && streams.length > 0) {
                    // Если текущий стрим в списке, берем следующий, иначе берем первый
                    const currentIdx = streams.findIndex(s => s.login === this.currentStream?.login);
                    const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % streams.length : 0;
                    const nextStream = streams[nextIdx];
                    if (nextStream) {
                      await this.switchToStream(nextStream);
                      return;
                    }
                  }
                  // Если нет стримов в категории — идём к следующей включенной
                  await this.switchToNextEnabledCategory();
                } catch (switchErr) {
                  console.error('Error switching after game change:', switchErr);
                }
              }
            } else {
              this._gameMismatchCount = 0;
            }
          }
        }
      } catch (e) {
        console.error('Error updating stream stats:', e);
      }
    };
    
    updateStats();
    this.streamStatsInterval = setInterval(updateStats, 30000);
    
    // Также запускаем обновление прогресса дропсов
    this.startDropsProgressUpdate(channelLogin);
  }

  _gameMatchesCategory(gameName, categoryName) {
    const a = (gameName || '').toLowerCase();
    const b = (categoryName || '').toLowerCase();
    if (!a || !b) return false;
    // Точное или частичное совпадение (на случай различий в локализации/вариантах)
    return a === b || a.includes(b) || b.includes(a);
  }
  
  startDropsProgressUpdate(channelLogin) {
    // Очищаем старый интервал
    if (this.dropsProgressInterval) {
      clearInterval(this.dropsProgressInterval);
    }
    
    const hideOldContainer = () => {
      const legacyContainer = document.getElementById('drops-progress-container');
      if (legacyContainer) legacyContainer.style.display = 'none';
    };

    // Обновляем только новую цветную раскладку, старый список скрываем
    const updateDrops = async () => {
      try {
        hideOldContainer();
        const progressState = await this.updateDropsHorizontalProgress();
        const hasDrops = progressState && progressState.hasDrops;

        if (hasDrops) {
          this.dropsMissingChecks = 0;
        } else {
          this.dropsMissingChecks = (this.dropsMissingChecks || 0) + 1;
          // If drops not visible for a while, treat category as completed and move on
          const MAX_MISSING_CHECKS = 3; // ~90s with 30s interval
          if (this.dropsMissingChecks >= MAX_MISSING_CHECKS) {
            await this.handleCategoryNoDrops();
            return;
          }
        }
      } catch (e) {
        console.error('Error updating drops progress:', e);
      }
    };
    
    updateDrops();
    this.dropsProgressInterval = setInterval(updateDrops, 30000);
  }
  
  renderDropsProgress(dropsData) {
    const container = document.getElementById('drops-progress-container');
    const campaignsList = document.getElementById('drops-campaigns-list');
    const overallProgress = document.getElementById('drops-overall-progress');
    const timeRemaining = document.getElementById('drops-time-remaining');
    
    if (!container || !campaignsList) return;
    
    container.style.display = 'block';
    
    // Общий прогресс
    if (dropsData.totalProgress) {
      overallProgress.textContent = `Общий прогресс: ${dropsData.totalProgress.completed}/${dropsData.totalProgress.total} (${dropsData.totalProgress.percentage}%)`;
    }
    
    // Очищаем список
    campaignsList.innerHTML = '';
    
    // Рендерим каждую кампанию
    dropsData.campaigns.forEach(campaign => {
      const campaignEl = document.createElement('div');
      campaignEl.style.cssText = 'margin-bottom: 16px; padding: 16px; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid var(--border-color);';
      
      // Заголовок кампании
      let headerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
      `;
      
      if (campaign.game && campaign.game.boxArtURL) {
        headerHTML += `<img src="${campaign.game.boxArtURL}" alt="${campaign.game.name}" style="width: 40px; height: 56px; border-radius: var(--radius-sm); object-fit: cover;">`;
      }
      
      headerHTML += `
          <div style="flex: 1;">
            <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);">${campaign.name}</div>
            ${campaign.game ? `<div style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">${campaign.game.name}</div>` : ''}
          </div>
          <div style="font-size: 13px; color: var(--text-tertiary);">${campaign.completedDrops}/${campaign.totalDrops}</div>
        </div>
      `;
      
      // Дропсы
      let dropsHTML = '';
      campaign.drops.forEach(drop => {
        const progressColor = drop.claimed ? '#35d08a' : '#7c5cff';
        const statusText = drop.claimed ? 'Получено' : `${drop.progress}/${drop.required} мин`;
        
        dropsHTML += `
          <div style="margin-bottom: 12px; ${drop === campaign.drops[campaign.drops.length - 1] ? '' : 'padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);'}">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
              ${drop.imageURL ? `<img src="${drop.imageURL}" alt="${drop.name}" style="width: 32px; height: 32px; border-radius: var(--radius-sm); object-fit: cover;">` : ''}
              <div style="flex: 1;">
                <div style="font-size: 13px; color: var(--text-primary); margin-bottom: 2px;">${drop.name}</div>
                <div style="font-size: 11px; color: var(--text-tertiary);">${statusText}</div>
              </div>
              <div style="font-size: 13px; font-weight: 600; color: ${progressColor};">${drop.percentage}%</div>
            </div>
            <div style="width: 100%; height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: var(--radius-sm); overflow: hidden;">
              <div style="width: ${drop.percentage}%; height: 100%; background: ${progressColor}; transition: width 0.3s ease;"></div>
            </div>
          </div>
        `;
      });
      
      campaignEl.innerHTML = headerHTML + dropsHTML;
      campaignsList.appendChild(campaignEl);
    });
    
    // Рассчитываем оставшееся время
    const totalMinutesRemaining = this.calculateRemainingTime(dropsData.campaigns);
    if (totalMinutesRemaining > 0) {
      timeRemaining.style.display = 'block';
      const hours = Math.floor(totalMinutesRemaining / 60);
      const minutes = totalMinutesRemaining % 60;
      timeRemaining.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: middle; margin-right: 6px;">
          <circle cx="8" cy="8" r="7" stroke="currentColor" fill="none" stroke-width="1.5"/>
          <path d="M8 4v4l3 3" stroke="currentColor" fill="none" stroke-width="1.5"/>
        </svg>
        Примерно ${hours > 0 ? hours + 'ч ' : ''}${minutes}м до получения всех дропсов
      `;
    } else {
      timeRemaining.style.display = 'none';
    }
    
    // Проверяем завершенность дропсов для автопереключения
    this.checkDropsCompletion(dropsData);
  }
  
  calculateRemainingTime(campaigns) {
    let totalMinutes = 0;
    
    campaigns.forEach(campaign => {
      campaign.drops.forEach(drop => {
        if (!drop.claimed) {
          totalMinutes += (drop.required - drop.progress);
        }
      });
    });
    
    return Math.max(0, totalMinutes);
  }
  
  checkDropsCompletion(dropsData) {
    // Проверяем, все ли дропсы получены
    const allCampaignsCompleted = dropsData.campaigns.every(campaign => 
      campaign.completedDrops === campaign.totalDrops
    );
    
    if (allCampaignsCompleted && this.currentCategory) {
      // Помечаем категорию как завершенную
      const category = this.categories.find(c => c.id === this.currentCategory.id);
      if (category) {
        category.dropsCompleted = true;
        category.dropsCompletedDate = new Date().toISOString();
        
        // Сохраняем
        Storage.saveCategories(this.categories);
        
        // Показываем уведомление
        window.utils.showToast(`Все дропсы получены для ${category.name}!`, 'success');
        
        // Переключаемся на следующую категорию
        setTimeout(() => {
          this.switchToNextCategoryWithDrops();
        }, 5000);
      }
    }
  }
  
  async switchToNextCategoryWithDrops() {
    // Находим следующую категорию с незавершенными дропсами
    const nextCategory = this.categories.find(cat => 
      cat.hasDrops && !cat.dropsCompleted && cat.id !== this.currentCategory?.id
    );
    
    if (nextCategory) {
      window.utils.showToast(`Переключение на ${nextCategory.name}...`, 'info');
      
      // Закрываем текущий стрим
      await window.electronAPI.closeStream();
      
      // Запускаем новый стрим
      setTimeout(async () => {
        try {
          // Получаем стримы для категории
          const streams = await window.electronAPI.getStreamsWithDrops(nextCategory.name);
          
          if (!streams || streams.length === 0) {
            window.utils.showToast(`Нет активных стримов для ${nextCategory.name}`, 'error');
            return;
          }
          
          // Берём первый стрим
          const stream = await this.pickPreferredStream(streams, nextCategory.name);
          
          // Открываем стрим
          await window.electronAPI.openStream(`https://www.twitch.tv/${stream.login}`);
          
          // КРИТИЧЕСКИ ВАЖНО: обновляем UI и устанавливаем currentCategory
          this.updateCurrentStreamUI(stream, nextCategory);
          
          window.utils.showToast(`Переключено на: ${stream.displayName}`, 'success');
        } catch (error) {
          console.error('Error switching stream:', error);
          window.utils.showToast('Ошибка при переключении стрима', 'error');
        }
      }, 2000);
    } else {
      window.utils.showToast('Нет категорий с активными дропсами', 'warning');
    }
  }
  
  setupViewersChart() {
    const viewersEl = document.getElementById('stream-viewers');
    const canvas = document.getElementById('viewers-chart');
    
    if (!viewersEl || !canvas) return;
    
    const ctx = canvas.getContext('2d');
    let isShowing = false;
    
    // Расширяем область срабатывания - берём весь родительский контейнер со статистикой
    const statsContainer = viewersEl.closest('[style*="text-align: center"]')?.parentElement;
    const targetElement = statsContainer || viewersEl.parentElement || viewersEl;
    
    const showChart = () => {
      if (isShowing) return;
      isShowing = true;
      
      const rect = viewersEl.getBoundingClientRect();
      // Позиционируем СЛЕВА от элемента
      canvas.style.left = Math.max(10, rect.left - 420) + 'px';
      canvas.style.top = Math.max(10, rect.top - 60) + 'px';
      canvas.style.display = 'block';
      this.drawViewersChart(ctx);
    };
    
    const hideChart = () => {
      isShowing = false;
      canvas.style.display = 'none';
    };
    
    targetElement.addEventListener('mouseenter', showChart);
    targetElement.addEventListener('mouseleave', hideChart);
    
    // Также следим за canvas чтобы не скрывался если мышь на нём
    canvas.addEventListener('mouseenter', () => {
      isShowing = true;
    });
    
    canvas.addEventListener('mouseleave', hideChart);
  }
  
  drawViewersChart(ctx) {
    // Отрисовка вынесена в features/farming/viewers-chart.js —
    // это чистая работа с canvas, состояние страницы ей не нужно
    window.drawViewersChart(ctx, this.viewersHistory);
  }

  // === Навигация между стримами и категориями ===
  
  async switchToNextStream() {
    if (!this.currentCategory || !this.currentStream) {
      window.utils.showToast('Нет активного стрима', 'warning');
      return;
    }

    try {
      window.utils.showToast('Ищем следующий стрим...', 'info');
      
      // Получаем стримы текущей категории
      const streams = await window.electronAPI.getStreamsWithDrops(this.currentCategory.name);
      
      if (!streams || streams.length === 0) {
        window.utils.showToast('Нет доступных стримов', 'warning');
        return;
      }

      // Явно исключаем текущий канал: иначе выбор мог вернуть тот же самый,
      // и кнопка «Другой стрим» выглядела бы неработающей
      const nextStream = await this.pickPreferredStream(
        streams,
        this.currentCategory.name,
        { exclude: this.currentStream?.login }
      );

      if (nextStream && nextStream.login === this.currentStream?.login) {
        window.utils.showToast('Других стримов в этой категории нет', 'warning');
        return;
      }
      
      if (nextStream) {
        // Переключаемся на следующий стрим
        await this.switchToStream(nextStream);
        window.utils.showToast(`Переключено на ${nextStream.displayName}`, 'success');
      }
    } catch (error) {
      console.error('Error switching stream:', error);
      window.utils.showToast('Ошибка переключения стрима', 'error');
    }
  }

  async switchToPrevCategory() {
    // Фильтруем только активные категории
    const activeCategories = this.categories.filter(c => c.enabled !== false);
    
    if (activeCategories.length < 2) {
      window.utils.showToast('Добавьте больше активных категорий', 'warning');
      return;
    }

    if (!this.currentCategory || !this.sessionStartTime) {
      window.utils.showToast('Нет активной категории', 'warning');
      return;
    }

    // Сохраняем статистику текущей категории
    if (this.currentCategory?.name && this.sessionStartTime) {
      const categoryWatchTime = Date.now() - this.sessionStartTime;
      await this.saveWatchTimeForCategory(this.currentCategory.name, categoryWatchTime);
      this.sessionStartTime = Date.now();
    }

    try {
      // Находим текущую категорию в активных
      const currentIndex = activeCategories.findIndex(c => c.id === this.currentCategory.id);
      
      // Берем предыдущую категорию (или последнюю если в начале)
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : activeCategories.length - 1;
      const prevCategory = activeCategories[prevIndex];
      
      window.utils.showToast(`Ищем стримы в ${prevCategory.name}...`, 'info');
      
      // Получаем стримы для предыдущей категории
      const streams = await window.electronAPI.getStreamsWithDrops(prevCategory.name);
      
      if (!streams || streams.length === 0) {
        window.utils.showToast('Нет доступных стримов', 'warning');
        return;
      }
      
      // Запускаем первый стрим
      const stream = await this.pickPreferredStream(streams, prevCategory.name);
      this.currentCategory = prevCategory;
      this.currentStream = stream;
      this.resetChannelPointsTracking();
      
      // Смена канала — единственный случай, когда перезагрузка плеера уместна
      window.playerManager?.load(stream.login);
      
      // Чат переводим на новый канал (он живёт вне страницы и не перезагружается зря)
      window.chatManager?.load(stream.login);
      
      this.updateCurrentStreamUI(stream, prevCategory);
      this.startStreamStatsUpdate(stream.login);
      
      window.utils.showToast(`Переключено на ${prevCategory.name}`, 'success');
    } catch (error) {
      console.error('Error switching to prev category:', error);
      window.utils.showToast('Ошибка переключения категории', 'error');
    }
  }

  async switchToNextCategory() {
    // Фильтруем только активные категории
    const activeCategories = this.categories.filter(c => c.enabled !== false);
    
    if (activeCategories.length < 2) {
      window.utils.showToast('Добавьте больше активных категорий', 'warning');
      return;
    }

    if (!this.currentCategory || !this.sessionStartTime) {
      window.utils.showToast('Нет активной категории', 'warning');
      return;
    }

    // Сохраняем статистику текущей категории
    if (this.currentCategory?.name && this.sessionStartTime) {
      const categoryWatchTime = Date.now() - this.sessionStartTime;
      await this.saveWatchTimeForCategory(this.currentCategory.name, categoryWatchTime);
      this.sessionStartTime = Date.now();
    }

    try {
      // Находим текущую категорию в активных
      const currentIndex = activeCategories.findIndex(c => c.id === this.currentCategory.id);
      
      // Берем следующую категорию (или первую если в конце)
      const nextIndex = (currentIndex + 1) % activeCategories.length;
      const nextCategory = activeCategories[nextIndex];
      
      window.utils.showToast(`Ищем стримы в ${nextCategory.name}...`, 'info');
      
      // Получаем стримы для следующей категории
      const streams = await window.electronAPI.getStreamsWithDrops(nextCategory.name);
      
      if (!streams || streams.length === 0) {
        window.utils.showToast('Нет доступных стримов', 'warning');
        return;
      }
      
      // Запускаем первый стрим
      const stream = await this.pickPreferredStream(streams, nextCategory.name);
      this.currentCategory = nextCategory;
      this.currentStream = stream;
      this.resetChannelPointsTracking();
      
      // Смена канала — единственный случай, когда перезагрузка плеера уместна
      window.playerManager?.load(stream.login);
      
      // Чат переводим на новый канал (он живёт вне страницы и не перезагружается зря)
      window.chatManager?.load(stream.login);
      
      this.updateCurrentStreamUI(stream, nextCategory);
      this.startStreamStatsUpdate(stream.login);
      
      window.utils.showToast(`Переключено на ${nextCategory.name}`, 'success');
    } catch (error) {
      console.error('Error switching to next category:', error);
      window.utils.showToast('Ошибка переключения категории', 'error');
    }
  }

  toggleChat() {
    // Сначала проверяем наличие необходимых элементов
    const playerContainer = document.getElementById('twitch-player-container');
    const chatContainer = document.getElementById('twitch-chat-container');
    const chatSlot = document.getElementById('farming-chat-slot');
    const grid = document.getElementById('player-chat-grid');

    if (!playerContainer || !chatContainer || !chatSlot || !grid) {
      window.utils.showToast('Чат не найден', 'error');
      return;
    }

    // Проверяем видим ли контейнер плеера (значит стрим активен)
    if (playerContainer.style.display === 'none') {
      window.utils.showToast('Нет активного стрима', 'warning');
      return;
    }

    const channel = this.currentStream?.login;
    
    if (!channel) {
      window.utils.showToast('Нет активного стрима', 'warning');
      return;
    }
    
    // Переключаем видимость чата
    if (chatContainer.style.display === 'none') {
      // Показываем чат с анимацией
      chatContainer.style.display = 'block';
      grid.style.gridTemplateColumns = '1fr 340px'; // Плеер + Чат

      // Чат уже загружен в фоне ради автосбора сундуков — здесь его достаточно
      // показать. Перезагрузка сбросила бы сборщик и накопленное состояние.
      window.chatManager?.load(channel);
      window.chatManager?.attachTo(chatSlot);

      // Запускаем анимацию появления
      setTimeout(() => {
        chatContainer.style.opacity = '1';
        chatContainer.style.transform = 'translateX(0)';
      }, 10);
      
      window.utils.showToast('Чат показан', 'info');
    } else {
      // Скрываем чат с анимацией (но не выгружаем, чтобы автосбор продолжал работать)
      chatContainer.style.opacity = '0';
      chatContainer.style.transform = 'translateX(20px)';
      grid.style.gridTemplateColumns = '1fr'; // Только плеер
      
      setTimeout(() => {
        chatContainer.style.display = 'none';
        // Отвязываем от слота, но НЕ выгружаем: автосбор сундуков
        // должен продолжать работать в фоне
        window.chatManager?.detach();
      }, 300); // Ждем завершения анимации
      
      window.utils.showToast('Чат скрыт', 'info');
    }
  }
  
  followCurrentChannel() {
    if (!this.currentStream) {
      window.utils.showToast('Нет активного стрима', 'warning');
      return;
    }
    
    // Проверяем авторизацию
    const authData = JSON.parse(localStorage.getItem('authData') || '{}');
    if (!authData.username) {
      window.utils.showToast('Необходима авторизация в Twitch', 'warning');
      return;
    }
    
    const followBtn = document.getElementById('follow-channel-btn');
    if (followBtn) {
      followBtn.disabled = true;
      followBtn.style.opacity = '0.5';
    }
    
    window.utils.showToast('Подписка на канал...', 'info');
    
    window.electronAPI.followChannel(this.currentStream.login)
      .then(result => {
        if (result.success) {
          window.utils.showToast(`Подписка на ${this.currentStream.displayName} оформлена!`, 'success');
          
          // Обновляем кнопку
          if (followBtn) {
            const span = followBtn.querySelector('span');
            if (span) span.textContent = 'Подписан';
            followBtn.style.background = 'var(--accent-color)';
            followBtn.style.color = 'white';
          }
        } else {
          window.utils.showToast(`Ошибка подписки: ${result.error || 'Unknown'}`, 'error');
        }
      })
      .catch(err => {
        console.error('Follow error:', err);
        window.utils.showToast('Ошибка подписки', 'error');
      })
      .finally(() => {
        if (followBtn) {
          followBtn.disabled = false;
          followBtn.style.opacity = '1';
        }
      });
  }
  
  async checkFollowingStatus() {
    if (!this.currentStream) return;
    
    const result = await window.electronAPI.checkFollowing(this.currentStream.login);
    
    const followBtn = document.getElementById('follow-channel-btn');
    if (!followBtn) return;
    
    if (result.success && result.following) {
      const span = followBtn.querySelector('span');
      if (span) span.textContent = 'Подписан';
      followBtn.style.background = 'var(--accent-color)';
      followBtn.style.color = 'white';
      followBtn.disabled = true;
    } else {
      const span = followBtn.querySelector('span');
      if (span) span.textContent = 'Подписаться';
      followBtn.style.background = '';
      followBtn.style.color = '';
      followBtn.disabled = false;
    }
  }
  
  toggleNotifications() {
    if (!this.currentStream) {
      window.utils.showToast('Нет активного стрима', 'warning');
      return;
    }
    
    const channelUrl = `https://www.twitch.tv/${this.currentStream.login}`;
    window.electronAPI.openExternal(channelUrl);
    window.utils.showToast('Откройте страницу канала для настройки уведомлений', 'info');
  }

  async switchToStream(stream) {
    const player = window.playerManager?.getWebview();
    if (!player) return;

    // Обновляем текущий стрим
    this.currentStream = stream;
    this.resetChannelPointsTracking();

    // Переключаем плеер на другой канал
    window.playerManager.load(stream.login);
    
    // Чат переводим на новый канал
    window.chatManager?.load(stream.login);
    
    // Обновляем информацию о стриме
    this.updateCurrentStreamUI(stream, this.currentCategory);
    
    // Обновляем статистику
    this.startStreamStatsUpdate(stream.login);
    
    // Автоматически кликаем на кнопку Continue Watching если появится mature content warning
    this.setupMatureContentHandler(player);
  }
  
  setupMatureContentHandler(player) {
    if (!player) return;
    
    // Ждем загрузки страницы
    const checkMatureContent = () => {
      player.executeJavaScript(`
        (function() {
          // Ищем кнопку "Continue Watching" или "Start Watching"
          const selectors = [
            'button[data-a-target="player-overlay-mature-accept"]',
            'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
            'button:has-text("Start Watching")',
            'button:has-text("Continue Watching")',
            'button[class*="consent-banner"] button[class*="primary"]',
            'button[aria-label*="Start Watching"]',
            'button[aria-label*="Continue"]'
          ];
          
          for (const selector of selectors) {
            try {
              const button = document.querySelector(selector);
              if (button && button.offsetParent) {
                console.log('✅ Found mature content button, clicking...', selector);
                button.click();
                return true;
              }
            } catch (e) {}
          }
          
          // Проверяем текст кнопок
          const allButtons = document.querySelectorAll('button');
          for (const btn of allButtons) {
            const text = (btn.textContent || btn.innerText || '').toLowerCase();
            if (text.includes('start watching') || 
                text.includes('continue watching') ||
                text.includes('i understand')) {
              console.log('✅ Found mature content button by text, clicking...', text);
              btn.click();
              return true;
            }
          }
          
          return false;
        })();
      `).catch(e => console.log('Error checking mature content:', e));
    };
    
    // Проверяем сразу после загрузки
    player.addEventListener('dom-ready', () => {
      setTimeout(checkMatureContent, 2000);
      // Проверяем повторно через 5 секунд
      setTimeout(checkMatureContent, 5000);
    }, { once: true });
    
    // Также проверяем периодически в течение первой минуты.
    // Плеер теперь постоянный, поэтому старый интервал обязательно гасим —
    // иначе при каждой смене канала их накапливалось бы всё больше.
    if (this.matureCheckInterval) {
      clearInterval(this.matureCheckInterval);
    }
    let checks = 0;
    this.matureCheckInterval = setInterval(() => {
      checks++;
      checkMatureContent();
      if (checks >= 6) { // 6 проверок = 1 минута
        clearInterval(this.matureCheckInterval);
        this.matureCheckInterval = null;
      }
    }, 10000);
  }

  /**
   * Формирует скрипт автосбора бонусных сундуков и отдаёт его ChatManager.
   *
   * Само внедрение делает ChatManager при каждой загрузке чата: инъекция
   * пропадает после смены канала, а чат теперь переживает навигацию.
   */
  startBonusAutoCollector() {
    // Сам скрипт вынесен в features/farming/bonus-collector-script.js:
    // это 150 строк кода, исполняемого внутри чата, и к странице они
    // отношения не имеют.
    window.chatManager?.setCollectorScript(window.BONUS_COLLECTOR_SCRIPT);
  }

  startBackgroundBonusCollector(channelLogin) {
    const chat = window.chatManager;
    if (!chat) {
      console.error('[Chest] ChatManager недоступен');
      return;
    }

    if (chat.isReadyFor(channelLogin)) {
      this.startPointsPolling();
      console.log('[Chest] Сборщик уже работает для', channelLogin);
      return;
    }

    console.log('[Chest] Запускаю фоновый сборщик сундуков для', channelLogin);

    // Скрипт регистрируем до загрузки: ChatManager внедрит его сам,
    // как только документ чата будет готов
    this.startBonusAutoCollector();
    chat.load(channelLogin);

    this.startPointsPolling();
  }
  
  /**
   * Опрос баллов ведёт SessionState — он переживает навигацию.
   * Раньше интервал принадлежал странице и гасился её destroy(), поэтому
   * баллы начислялись только пока страница фарминга открыта.
   */
  startPointsPolling() {
    window.sessionState?.startPointsPolling(this.currentStream?.login);
  }
  
  updateChannelPointsUI() {
    window.sessionState?.renderPoints();
  }

  /** Смена стрима: счётчики текущего стрима обнуляются, сессионные остаются. */
  resetChannelPointsTracking() {
    window.sessionState?.onStreamChanged(this.currentStream?.login);
  }

  /** Полный сброс — только при старте новой сессии фарминга. */
  resetSessionPointsTracking() {
    window.sessionState?.resetPoints();
    this._sessionDropsBaseline = null;
    this._sessionCountedDrops = null;
  }

  /**
   * Считает дропсы, полученные именно в этой сессии.
   *
   * Первый проход только запоминает уже полученное ранее, иначе весь
   * накопленный за месяцы инвентарь засчитался бы как добытый сейчас.
   * Раньше в статистику писался жёсткий ноль (стояла заглушка с TODO),
   * поэтому счётчик «Дропсов получено» ничего не отражал.
   */
  trackSessionDrops(campaigns) {
    const firstPass = !this._sessionDropsBaseline;
    if (firstPass) {
      this._sessionDropsBaseline = new Set();
      this._sessionCountedDrops = new Set();
    }

    campaigns.forEach(campaign => {
      (campaign.drops || []).forEach(drop => {
        if (!this.isDropEarned(drop)) return;

        const id = drop.id || `${campaign.id}:${drop.name}`;

        if (firstPass) {
          this._sessionDropsBaseline.add(id);
          return;
        }

        if (this._sessionDropsBaseline.has(id) || this._sessionCountedDrops.has(id)) return;

        this._sessionCountedDrops.add(id);
        this.sessionDropsCollected = (this.sessionDropsCollected || 0) + 1;
        console.log('[Drops] Получен дроп за сессию:', drop.benefitName || drop.name,
          '(всего за сессию:', this.sessionDropsCollected + ')');
      });
    });
  }

  // Проверка состояния трансляции
  startStreamHealthCheck() {
    // Останавливаем предыдущий интервал если есть
    if (this.streamHealthCheckInterval) {
      clearInterval(this.streamHealthCheckInterval);
    }
    
    // Счетчик неудачных проверок
    this.streamHealthFailCount = 0;
    
    // Проверяем каждые 10 секунд (более агрессивно)
    this.streamHealthCheckInterval = setInterval(async () => {
      if (!this.currentStream || !this.currentCategory) return;
      
      try {
        const player = window.playerManager?.getWebview();

        if (!player || !player.src) {
          console.warn('Player not found or no src');
          this.streamHealthFailCount++;
        } else {
          // Проверяем состояние загрузки webview
          try {
            // Проверяем на ошибки, оффлайн, черный экран
            const hasIssue = await player.executeJavaScript(`
              (function() {
                // Проверяем ошибки
                const errorElements = document.querySelectorAll('[class*="error"], [class*="Error"], [data-test-selector*="error"]');
                const offlineElements = document.querySelectorAll('[class*="offline"], [class*="Offline"], [data-a-target*="offline"]');
                
                if (errorElements.length > 0 || offlineElements.length > 0) {
                  console.log('❌ Stream error detected:', errorElements.length + offlineElements.length, 'elements');
                  return true;
                }
                
                // Проверяем черный экран - нет видео элемента или он не играет
                const video = document.querySelector('video');
                if (video) {
                  // Проверяем что видео действительно играет
                  const isPlaying = !video.paused && !video.ended && video.readyState > 2;
                  const hasBlackScreen = video.videoWidth === 0 || video.videoHeight === 0;
                  
                  if (!isPlaying || hasBlackScreen) {
                    console.log('❌ Video issue:', { 
                      paused: video.paused, 
                      ended: video.ended, 
                      readyState: video.readyState,
                      width: video.videoWidth,
                      height: video.videoHeight
                    });
                    return true;
                  }
                } else {
                  console.log('❌ No video element found');
                  return true;
                }
                
                return false;
              })()
            `);
            
            if (hasIssue) {
              console.warn('Stream health issue detected');
              this.streamHealthFailCount++;
            } else {
              // Стрим загрузился и играет успешно
              this.streamHealthFailCount = 0;
            }
          } catch (e) {
            console.log('Error checking webview state:', e);
            this.streamHealthFailCount++;
          }
        }
        
        // Если 2 проверки подряд провалились - переключаемся на другой стрим (быстрее реакция)
        if (this.streamHealthFailCount >= 2) {
          this.streamHealthFailCount = 0;

          // Настройка «Автопереключение стримов» раньше сохранялась,
          // но нигде не проверялась — переключение шло всегда.
          if (window.settings && window.settings.get('autoSwitchStreams') === false) {
            console.log('[Health] Стрим недоступен, но автопереключение выключено в настройках');
            window.utils.showToast('Стрим недоступен. Автопереключение выключено', 'warning');
            return;
          }

          console.warn('Stream health check failed 2 times, switching to another stream...');
          window.utils.showToast('Стрим недоступен, переключение...', 'warning');

          // Переключаемся на другой стрим той же категории
          await this.switchToNextStream();
        }
      } catch (error) {
        console.error('Error in stream health check:', error);
      }
    }, 10000); // Каждые 10 секунд (более частая проверка)
  }
  
  // Форматирование оставшегося времени
  formatTimeRemaining(endsAt) {
    if (!endsAt) return '';
    
    const now = new Date();
    const endDate = new Date(endsAt);
    const diff = endDate - now;
    
    if (diff <= 0) return ' <span style="opacity: 0.6;">(завершено)</span>';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      return ` <span style="opacity: 0.6;">(${days}д ${hours}ч)</span>`;
    } else if (hours > 0) {
      return ` <span style="opacity: 0.6;">(${hours}ч)</span>`;
    } else {
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      return ` <span style="opacity: 0.6;">(${minutes}м)</span>`;
    }
  }

  destroy() {
    console.log('🧹 FarmingPage destroy: очищаю интервалы');
    this._destroyed = true;
    const intervals = [
      'updateInterval',
      'sessionInterval',
      'statsUpdateInterval',
      'streamStatsInterval',
      'dropsProgressInterval',
      'streamHealthCheckInterval',
      'matureCheckInterval',
      'bonusCollectorInterval'
    ];
    intervals.forEach(key => {
      if (this[key]) {
        clearInterval(this[key]);
        delete this[key];
      }
    });

    // Снимаем все обработчики событий этого экземпляра страницы.
    // Без этого обработчики на кнопках сайдбара и на document оставались
    // висеть после каждой навигации вместе со всем объектом страницы.
    // Контроллер намеренно НЕ обнуляем: addEventListener с уже отменённым
    // сигналом ничего не делает, поэтому обработчики, зарегистрированные
    // асинхронным кодом уже после уничтожения страницы, просто не появятся.
    if (this._listenerAbort) {
      this._listenerAbort.abort();
    }
    this.isEventListenersSetup = false;
  }
}

/**
 * sessionStartTime проксируется в глобальный SessionState.
 *
 * Так вся существующая логика страницы (а она обращается к этому свойству в
 * двух десятках мест) продолжает работать без правок, но реальное состояние
 * сессии больше не умирает вместе с объектом страницы при навигации.
 */
/**
 * channelPoints и sessionDropsCollected тоже проксируются в SessionState,
 * чтобы существующий код страницы читал и писал единое состояние сессии.
 */
Object.defineProperty(FarmingPage.prototype, 'channelPoints', {
  configurable: true,
  get() {
    return window.sessionState ? window.sessionState.points : SessionState.emptyPoints();
  },
  // Сеттер нужен именно как страховка: файл большой и legacy, присваивание
  // может встретиться там, где его не ждут. Без сеттера любое такое место
  // валит метод целиком, потому что классы работают в строгом режиме.
  set(value) {
    if (window.sessionState && value && typeof value === 'object') {
      window.sessionState.points = value;
    }
  }
});

Object.defineProperty(FarmingPage.prototype, 'sessionDropsCollected', {
  configurable: true,
  get() {
    return window.sessionState ? window.sessionState.dropsCollected : 0;
  },
  set(value) {
    if (window.sessionState) window.sessionState.dropsCollected = value;
  }
});

Object.defineProperty(FarmingPage.prototype, 'sessionStartTime', {
  configurable: true,
  get() {
    return window.sessionState ? window.sessionState.startTime : null;
  },
  set(value) {
    const state = window.sessionState;
    if (!state) return;

    if (value === null || value === undefined) {
      state.stop();
      return;
    }

    if (state.isActive()) {
      // Сессия уже идёт — это сдвиг точки отсчёта при смене категории
      state.startTime = value;
    } else {
      state.restore(value, {
        categoryName: this.currentCategory?.name,
        streamLogin: this.currentStream?.login
      });
    }
  }
});

// Export to window
window.FarmingPage = FarmingPage;

// Глобальная функция для показа кастомных уведомлений о дропах
window.showDropNotification = function(dropName, gameName, dropIcon = null) {
  // Используем Electron API для показа уведомления на экране (не внутри приложения)
  if (window.electronAPI && window.electronAPI.showDropNotification) {
    window.electronAPI.showDropNotification(dropName, gameName, dropIcon);
  } else {
    console.error('[DropNotification] electronAPI.showDropNotification not available');
  }
};

window.hideDropNotification = function(notificationId) {
  // Не нужно - Electron окно закрывается само
};
