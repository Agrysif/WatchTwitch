// Farming page logic
class FarmingPage {
  constructor() {
    this.categories = [];
    this.updateInterval = null;
    this.dropsFilterEnabled = false;
    this.sessionStartTime = null;
    this.sessionInterval = null;
    this.estimatedBandwidth = 0;
    this.bandwidthHistory = [];
    this.streamStatsInterval = null;
    this.viewersHistory = [];
    this.currentCategory = null;
    this.currentStream = null;
    this.dropsMissingChecks = 0;
    this.activeSessionResumed = false;
    
    // Channel Points tracking
    this.channelPoints = {
      startTotal: 0,
      currentTotal: 0,
      earnedThisStream: 0,
      passiveEarned: 0,
      chestsCollected: 0,
      chestsPoints: 0
    };

    this.init();
  }

  async init() {
    this.categories = await Storage.getCategories();
    this.renderCategories();
    this.setupEventListeners();
    this.startAutoUpdate();

    // Восстанавливаем активную сессию после перезапуска/переключения вкладок
    await this.resumeActiveSession();

    // Если есть авто-категории, автоматически запускаем фарминг (если не восстановили активную)
    if (!this.activeSessionResumed && this.categories.some(cat => cat.autoDrops) && (!window.streamingManager || !window.streamingManager.isFarmingActive || !window.streamingManager.isFarmingActive())) {
      this.startFarming();
    }

    if (window.streamingManager && window.streamingManager.isFarmingActive) {
      if (window.streamingManager.isFarmingActive()) {
        this.showFarmingState();
      }
    }
  }

  startAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.updateInterval = setInterval(() => {
      this.updateCategoriesData();
    }, 30000);
  }

  async updateCategoriesData() {
    if (this.categories.length === 0) return;
    
    try {
      console.log('Updating categories data...');
      
      // Получаем свежие данные о категориях
      const allCategories = await window.electronAPI.fetchTwitchCategories();
      
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
        const hasDrops = await window.electronAPI.checkCategoryDrops(category.name);
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
        .filter(cat => cat.autoDrops === true && cat.hasDrops === false)
        .map(c => c.id);
      if (toRemoveIds.length > 0) {
        // Если текущая категория среди удаляемых, переключаемся корректно
        if (currentId && toRemoveIds.includes(currentId)) {
          console.warn('Current auto category lost drops, switching...');
          await this.handleCategoryNoDrops();
        }
        // Удаляем прочие авто‑категории без дропсов
        const kept = this.categories.filter(cat => !(cat.autoDrops === true && cat.hasDrops === false));
        this.categories = kept;
        await Storage.saveCategories(this.categories);
        this.renderCategories();
        window.utils?.showToast(`Удалено авто‑категорий без дропсов: ${beforeCount - kept.length}`, 'info');
      }

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
        dropsFilterBtn.addEventListener('click', () => {
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
        addAllDropsBtn.addEventListener('click', async () => {
          await this.toggleAutoDropsCategories();
        });
      } else {
        console.warn('add-all-drops-btn not found');
      }

      if (addBtn) {
        addBtn.addEventListener('click', () => {
          this.showCategorySelector();
        });
      } else {
        console.warn('add-category-btn not found');
      }

      if (startBtn) {
        startBtn.addEventListener('click', () => {
          this.startFarming();
        });
      }

      if (stopBtn) {
        stopBtn.addEventListener('click', () => {
          this.stopFarming();
        });
      }

      // Навигация: следующий стрим
      if (nextStreamBtn) {
        nextStreamBtn.addEventListener('click', () => {
          this.switchToNextStream();
        });
      }

      // Навигация: предыдущая категория
      if (prevCategoryBtn) {
        prevCategoryBtn.addEventListener('click', () => {
          this.switchToPrevCategory();
        });
      }

      // Навигация: следующая категория
      if (nextCategoryBtn) {
        nextCategoryBtn.addEventListener('click', () => {
          this.switchToNextCategory();
        });
      }

      // Показать/скрыть чат
      if (toggleChatBtn) {
        toggleChatBtn.addEventListener('click', () => {
          this.toggleChat();
        });
      }
      
      // Подписаться на канал
      const followBtn = document.getElementById('follow-channel-btn');
      if (followBtn) {
        followBtn.addEventListener('click', () => {
          this.followCurrentChannel();
        });
      }
      
      // Уведомления
      const notificationsBtn = document.getElementById('notifications-btn');
      if (notificationsBtn) {
        notificationsBtn.addEventListener('click', () => {
          this.toggleNotifications();
        });
      }
    }, 100);
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
      
      this.sessionInterval = setInterval(() => this.updateSessionInfo(), 1000);

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
          <img src="${cat.boxArtURL || 'https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg'}" alt="${cat.name}">
          <div class="game-item-info">
            <div class="game-item-name">${cat.name}</div>
            <div class="game-item-viewers" style="display: flex; align-items: center;">
              <span style="color: var(--text-secondary); font-size: 13px;">
                ${cat.viewersCount ? `${(cat.viewersCount / 1000).toFixed(1)}K зрителей` : ''}
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
      boxArtURL: category.boxArtURL || '',
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
    const hasAutoDrops = this.categories.some(cat => cat.autoDrops === true);
    const btnText = btn.querySelector('span');

    if (hasAutoDrops) {
      btn.style.background = 'linear-gradient(135deg, #9147ff, #772ce8)';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      btn.style.opacity = '1';
      if (btnText) btnText.textContent = 'Отключить автофарм';
    } else {
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.color = 'var(--text-primary)';
      btn.style.border = '1px solid var(--border-color)';
      btn.style.opacity = '0.9';
      if (btnText) btnText.textContent = 'Фарм всех дропсов';
    }
  }

  async toggleAutoDropsCategories() {
    const hasAutoDrops = this.categories.some(cat => cat.autoDrops === true);
    if (hasAutoDrops) {
      this.categories = this.categories.filter(cat => cat.autoDrops !== true);
      await Storage.saveCategories(this.categories);
      this.renderCategories();
      this.updateAutoDropsButtonState();
      window.utils.showToast('Автофарм дропсов отключен', 'info');
    } else {
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

      const dropsData = await window.electronAPI.fetchDropsInventory();
      const activeCampaignsMap = new Map();
      if (dropsData && dropsData.campaigns) {
        dropsData.campaigns.forEach(campaign => {
          if (campaign.game && campaign.game.name) {
            const totalDrops = campaign.drops.length;
            let completedDrops = 0;
            campaign.drops.forEach(drop => {
              if (drop.claimed || (drop.required > 0 && drop.progress >= drop.required)) {
                completedDrops++;
              }
            });
            const isCompleted = completedDrops >= totalDrops;
            if (!isCompleted) {
              const progress = totalDrops > 0 ? Math.floor((completedDrops / totalDrops) * 100) : 0;
              activeCampaignsMap.set(campaign.game.name.toLowerCase(), {
                campaign,
                progress
              });
            }
          }
        });
      }

      const checkPromises = allCategories.map(async (cat) => {
        if (this.categories.some(c => c.id === cat.id)) return null;
        const gameName = cat.name.toLowerCase();
        const campaignInfo = activeCampaignsMap.get(gameName);
        if (campaignInfo) {
          return { ...cat, campaignInfo };
        }
        const hasDrops = await window.electronAPI.checkCategoryDrops(cat.name);
        if (hasDrops) return cat;
        return null;
      });

      const results = await Promise.all(checkPromises);
      const validCategories = results.filter(cat => cat !== null);
      if (validCategories.length === 0) {
        window.utils.showToast('Не найдено новых категорий с незавершенными дропсами', 'warning');
        return;
      }

      let addedCount = 0;
      for (const category of validCategories) {
        const newCategory = {
          id: category.id,
          name: category.name,
          boxArtURL: category.boxArtURL || '',
          viewersCount: category.viewersCount || 0,
          tags: category.tags || [],
          hasDrops: true,
          autoDrops: true,
          enabled: true,
          priority: this.categories.length + 1
        };
        if (category.campaignInfo) {
          newCategory.dropsProgressPercent = category.campaignInfo.progress;
          newCategory.dropsEndsAt = category.campaignInfo.campaign.endsAt;
          newCategory.dropsCompleted = false;
        }
        this.categories.push(newCategory);
        addedCount++;
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

    container.innerHTML = categoriesToRender.map((cat, index) => {
      const tagsHtml = cat.tags && cat.tags.length > 0 
        ? `<span class="category-tag">${cat.tags[0]}</span>` 
        : '';
      const autoBadge = cat.autoDrops ? `<span class="category-tag" style="background: rgba(145, 71, 255, 0.2); color: #bda0ff; border: 1px solid rgba(145, 71, 255, 0.4);">Авто</span>` : '';
      
      const dropsStatusHtml = cat.hasDrops ? (
        cat.dropsCompleted 
          ? `<span class="category-drops-status completed">
               <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                 <path d="M3.5 7L1 4.5L1.7 3.8L3.5 5.6L8.3 0.8L9 1.5L3.5 7Z"/>
               </svg>
               Дропсы получены
             </span>`
          : `<span class="category-drops-status completed">
               <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                 <circle cx="5" cy="5" r="5"/>
               </svg>
               Drops ${cat.dropsProgressPercent !== undefined ? cat.dropsProgressPercent + '%' : 'Включены'}
               ${cat.dropsEndsAt ? this.formatTimeRemaining(cat.dropsEndsAt) : ''}
             </span>`
      ) : '';
      
      const isDisabled = cat.enabled === false;
      const isCompleted = cat.dropsCompleted && cat.hasDrops;
      
      return `
      <div class="category-item ${isDisabled ? 'disabled' : ''} ${isCompleted ? 'drops-completed' : ''}" draggable="true" data-category-id="${cat.id}">
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
          <img src="${cat.boxArtURL || 'https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg'}" alt="${cat.name}">
        </div>
        <div class="category-info">
          <div class="category-name">${cat.name}</div>
          <div class="category-status">
            <span style="color: var(--text-secondary); font-size: 13px;">${(cat.viewersCount / 1000).toFixed(1)}K зрителей</span>
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

    this.setupDragAndDrop();
    this.setupRemoveButtons();
    this.setupToggleButtons();
    this.setupPlayButtons();
    this.updateAutoDropsButtonState();
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
          
          // Запускаем выбранную категорию
          await this.startFarmingForCategory(category);
        }
      });
    });
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
    const stream = streams[0];
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
    this.updateSessionInfo();
    this.sessionInterval = setInterval(() => {
      this.updateSessionInfo();
    }, 1000);

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
  
  async switchToNextEnabledCategory() {
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
    // Приоритет: 1) ручные категории, 2) наличие дропсов, 3) сохранённый порядок/priority
    const enabledCategories = this.categories
      .filter(cat => cat.enabled && cat.id !== this.currentCategory?.id && !cat.dropsCompleted)
      .sort((a, b) => {
        const aManual = a.autoDrops ? 1 : 0;
        const bManual = b.autoDrops ? 1 : 0;
        if (aManual !== bManual) return aManual - bManual; // 0 (ручные) раньше 1 (авто)
        const aNoDrops = a.hasDrops ? 0 : 1;
        const bNoDrops = b.hasDrops ? 0 : 1;
        if (aNoDrops !== bNoDrops) return aNoDrops - bNoDrops;
        return (a.priority || 0) - (b.priority || 0);
      });
    
    console.log('Enabled categories:', enabledCategories.map(c => c.name));
    
    if (enabledCategories.length === 0) {
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
        const stream = streams[0];
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

  async startFarming() {
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
            <div style="background: rgba(145, 71, 255, 0.1); border: 1px solid rgba(145, 71, 255, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
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
            <div style="background: rgba(145, 71, 255, 0.1); border: 1px solid rgba(145, 71, 255, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
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
    const stream = streams[0];
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
        <div style="margin-bottom: 16px; padding: 16px; background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color);">
          <div style="display: flex; gap: 12px; margin-bottom: 12px;">
            <img src="${campaign.imageUrl}" 
                 alt="${campaign.name}" 
                 style="width: 60px; height: 80px; border-radius: 6px; object-fit: cover; flex-shrink: 0;"
                 onerror="this.style.display='none'">
            <div style="flex: 1;">
              <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${campaign.name}</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">${campaign.game}</div>
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <span style="font-size: 12px; padding: 4px 8px; background: ${campaign.isActive ? 'rgba(0, 245, 147, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${campaign.isActive ? '#00f593' : '#ef4444'}; border-radius: 4px; font-weight: 600;">
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
            ${campaign.drops.map((drop, idx) => `
              <div style="display: flex; gap: 12px; padding: 12px; background: var(--bg-secondary); border-radius: 6px; align-items: center;">
                ${drop.imageUrl ? `
                  <img src="${drop.imageUrl}" 
                       alt="${drop.name}" 
                       style="width: 48px; height: 48px; border-radius: 6px; object-fit: cover; flex-shrink: 0;">
                ` : ''}
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${drop.name}</div>
                  <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">
                    Смотреть ${drop.requiredMinutes} мин
                  </div>
                  <div style="height: 6px; background: var(--bg-primary); border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${drop.progress || 0}%; background: linear-gradient(90deg, var(--accent-color), var(--accent-hover)); transition: width 0.5s ease;"></div>
                  </div>
                </div>
                <div style="font-size: 14px; font-weight: 700; color: ${drop.progress >= 100 ? 'var(--success-color)' : 'var(--accent-color)'}; min-width: 45px; text-align: right;">
                  ${Math.round(drop.progress || 0)}%
                </div>
              </div>
            `).join('')}
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

  async updateDropsHorizontalProgress() {
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
      
      // Находим кампанию для текущей категории
      let currentCampaign = result.campaigns.find(c => 
        c.game && c.game.name && currentGameName && 
        c.game.name.toLowerCase() === currentGameName.toLowerCase()
      );
      // Фолбэк: пытаемся найти по частичному совпадению (иногда названия отличаются)
      if (!currentCampaign) {
        currentCampaign = result.campaigns.find(c => 
          c.game && c.game.name && currentGameName && 
          c.game.name.toLowerCase().includes(currentGameName.toLowerCase())
        );
      }
      
      const horizontal = document.getElementById('drops-progress-horizontal');
      if (!horizontal) return { hasDrops: false };
      
      if (!currentCampaign || currentCampaign.drops.length === 0) {
        horizontal.style.display = 'none';
        return { hasDrops: false };
      }
      
      // Показываем блок
      horizontal.style.display = 'block';
      
      // Вычисляем оставшееся время до окончания кампании
      let timeRemaining = '';
      if (currentCampaign.endsAt) {
        const now = new Date();
        const endDate = new Date(currentCampaign.endsAt);
        const diff = endDate - now;
        
        if (diff > 0) {
          const days = Math.floor(diff / (1000 * 60 * 60 * 24));
          const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          
          if (days > 0) {
            timeRemaining = `${days}д ${hours}ч`;
          } else if (hours > 0) {
            timeRemaining = `${hours}ч ${minutes}м`;
          } else {
            timeRemaining = `${minutes}м`;
          }
        } else {
          timeRemaining = 'Завершена';
        }
      }
      
      const isDropEarned = (drop) => {
        // Считаем дроп завершенным, если он уже получен или доступен к получению
        return !!(
          drop.claimed ||
          drop.canClaim ||
          drop.isClaimable ||
          drop.claimable ||
          drop.isUnlocked ||
          (drop.required > 0 && drop.progress >= drop.required)
        );
      };

      // Вычисляем общий прогресс как сумму процентов всех дропсов
      const totalDrops = currentCampaign.drops.length;
      let totalProgress = 0;
      currentCampaign.drops.forEach(drop => {
        const earned = isDropEarned(drop);
        const dropPercentRaw = drop.required > 0 ? Math.floor((drop.progress / drop.required) * 100) : 0;
        const dropPercent = earned ? 100 : Math.min(100, dropPercentRaw);
        totalProgress += dropPercent;
      });
      const overallPercent = totalDrops > 0 ? Math.floor(totalProgress / totalDrops) : 0;
      const completedDrops = currentCampaign.drops.filter(isDropEarned).length;
      
      // Создаем HTML для всех дропсов
      const dropsHTML = currentCampaign.drops.map((drop, index) => {
        const isCompleted = isDropEarned(drop);
        const dropPercent = isCompleted ? 100 : (drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0);
        const remaining = Math.max(0, drop.required - drop.progress);
        
        // Извлекаем название награды из benefitName или используем имя дропа
        const dropName = drop.benefitName || drop.name || 'Награда';
        
        return `
          <div class="drop-progress-card" style="
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 14px;
            background: rgba(255, 255, 255, ${isCompleted ? '0.03' : '0.05'});
            border-radius: 10px;
            border: 1px solid ${isCompleted ? 'rgba(0, 229, 122, 0.3)' : 'rgba(145, 71, 255, 0.3)'};
            opacity: ${isCompleted ? '0.6' : '1'};
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            min-height: 220px;
            cursor: pointer;
            ${!isCompleted ? 'animation: pulse-glow 3s ease-in-out infinite;' : ''}
          "
          onmouseenter="this.style.transform='translateY(-4px) scale(1.02)'; this.style.boxShadow='0 8px 24px rgba(${isCompleted ? '0, 229, 122' : '145, 71, 255'}, 0.3)'; this.style.borderColor='rgba(${isCompleted ? '0, 229, 122' : '145, 71, 255'}, 0.6)';"
          onmouseleave="this.style.transform='translateY(0) scale(1)'; this.style.boxShadow='none'; this.style.borderColor='rgba(${isCompleted ? '0, 229, 122' : '145, 71, 255'}, 0.3)';"
          >
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">
              ${drop.imageURL ? `
                <img src="${drop.imageURL}" 
                     alt="${dropName}" 
                     style="width: 64px; height: 64px; border-radius: 8px; object-fit: cover; opacity: ${isCompleted ? '0.7' : '1'}; transition: all 0.3s ease;">
              ` : `
                <div style="width: 64px; height: 64px; border-radius: 8px; background: rgba(145, 71, 255, 0.2); display: flex; align-items: center; justify-content: center;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="${isCompleted ? '#00e57a' : '#9147ff'}">
                    <path d="M12 2L15 8H21L16 13L18 19L12 15L6 19L8 13L3 8H9L12 2Z"/>
                  </svg>
                </div>
              `}
            </div>
            <div style="text-align: center; margin-bottom: 10px;">
              <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 8px;">
                <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;" title="${dropName}">${dropName}</span>
                ${isCompleted ? `
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="#00e57a" style="flex-shrink: 0;">
                    <circle cx="8" cy="8" r="8" fill="rgba(0, 229, 122, 0.2)"/>
                    <path d="M5 8L7 10L11 6" stroke="#00e57a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                ` : ''}
              </div>
              <div style="font-size: 18px; font-weight: 700; color: ${isCompleted ? '#00e57a' : '#9147ff'}; margin-bottom: 8px;">${dropPercent}%</div>
            </div>
            <div style="height: 8px; background: rgba(255, 255, 255, 0.12); border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
              <div style="height: 100%; width: ${dropPercent}%; background: ${isCompleted ? '#00e57a' : '#9147ff'} !important; transition: width 0.5s ease;"></div>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); text-align: center;">
              ${isCompleted 
                ? `<span style="color: #00e57a; font-weight: 600;">✓ Получено или доступно</span>` 
                : `<div>${drop.progress} / ${drop.required} мин</div>${remaining > 0 ? `<div style="margin-top: 4px; color: var(--text-tertiary);">Осталось: ${remaining} мин</div>` : ''}`
              }
            </div>
          </div>
        `;
      }).join('');
      
      // Обновляем весь блок
      horizontal.innerHTML = `
        <style>
          @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 0 rgba(145, 71, 255, 0); }
            50% { box-shadow: 0 0 20px rgba(145, 71, 255, 0.3); }
          }
          .drop-progress-card {
            transform: translateY(0) scale(1);
            box-shadow: none;
          }
        </style>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="#9147ff">
                <path d="M8 2L10 6H14L11 9L12 13L8 10.5L4 13L5 9L2 6H6L8 2Z"/>
              </svg>
              <span style="font-size: 15px; font-weight: 700; color: var(--text-primary);">Прогресс дропсов</span>
            </div>
            ${timeRemaining ? `
              <div style="display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: rgba(145, 71, 255, 0.15); border-radius: 12px; border: 1px solid rgba(145, 71, 255, 0.3);">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="#9147ff">
                  <circle cx="8" cy="8" r="7" stroke="#9147ff" stroke-width="1.5" fill="none"/>
                  <path d="M8 3.5V8L11 10" stroke="#9147ff" stroke-width="1.5" stroke-linecap="round" fill="none"/>
                </svg>
                <span style="font-size: 12px; font-weight: 600; color: #9147ff;">${timeRemaining}</span>
              </div>
            ` : ''}
          </div>
          <div style="font-size: 20px; font-weight: 800; color: ${overallPercent === 100 ? '#00e57a' : '#9147ff'};">${overallPercent}%</div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.12); height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 16px;">
          <div style="height: 100%; background: ${overallPercent === 100 ? '#00e57a' : '#9147ff'} !important; width: ${overallPercent}%; transition: width 0.5s ease;"></div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; max-width: 100%;">
          ${dropsHTML}
        </div>
        <div style="margin-top: 12px; padding: 12px; background: rgba(${overallPercent === 100 ? '0, 229, 122' : '145, 71, 255'}, 0.1); border-radius: 6px; border: 1px solid rgba(${overallPercent === 100 ? '0, 229, 122' : '145, 71, 255'}, 0.3); font-size: 13px; color: var(--text-secondary); text-align: center;">
          ${overallPercent === 100 
            ? '<span style="color: #00e57a; font-weight: 600;">✓ Все дропсы получены!</span>' 
            : `<span style="color: var(--text-primary); font-weight: 600;">${completedDrops}/${totalDrops} дропсов получено</span>`
          }
        </div>
      `;
      
      // Обновляем статус категории
      if (this.currentCategory) {
        this.currentCategory.dropsCompleted = overallPercent === 100;
        this.currentCategory.dropsProgressPercent = overallPercent;
        this.currentCategory.dropsEndsAt = currentCampaign.endsAt; // Сохраняем время окончания
        await Storage.saveCategories(this.categories);
        this.renderCategories();
        
        // Обновляем миниатюрный прогресс дропсов в header
        this.updateMiniDropsProgress(overallPercent);
        
        // Если все дропсы получены - сразу переключаемся
        if (overallPercent === 100 && !this.currentCategory._switchScheduled) {
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

  async handleCategoryNoDrops() {
    if (!this.currentCategory) return;

    console.warn('No drops visible for category, disabling from list...', this.currentCategory.name);
    
    // Отключаем категорию без дропсов (не удаляем)
    const categoryName = this.currentCategory.name;
    
    if (this.currentCategory.autoDrops) {
      // Авто-категории можем удалить
      this.categories = this.categories.filter(cat => cat.id !== this.currentCategory.id);
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

  stopFarming() {
    window.utils.showToast('Фарминг остановлен', 'info');
    Storage.delete('activeSession').catch(() => {});
    
    // Сохраняем сессию в статистику перед остановкой
    if (this.sessionStartTime) {
      const duration = Math.floor((Date.now() - this.sessionStartTime) / 60000); // в минутах
      const durationMs = Date.now() - this.sessionStartTime; // в миллисекундах
      
      Storage.addSession({
        timestamp: this.sessionStartTime,
        duration: duration,
        category: this.currentCategory?.name || 'Unknown',
        channel: this.currentStream?.displayName || 'Unknown',
        bandwidth: this.estimatedBandwidth,
        bandwidthHistory: this.bandwidthHistory, // для графика
        categoryBoxArtURL: this.currentCategory?.box_art_url || '', // URL обложки категории
        pointsEarned: this.channelPoints.earnedThisStream || 0,
        chestsCollected: this.channelPoints.chestsCollected || 0
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
    
    // Останавливаем polling баллов
    if (this.pointsPollingInterval) {
      clearInterval(this.pointsPollingInterval);
      this.pointsPollingInterval = null;
    }
    
    // Останавливаем проверку состояния трансляции
    if (this.streamHealthCheckInterval) {
      clearInterval(this.streamHealthCheckInterval);
      this.streamHealthCheckInterval = null;
    }
    
    // Сбрасываем счетчики баллов
    this.channelPoints = {
      startTotal: 0,
      currentTotal: 0,
      earnedThisStream: 0,
      passiveEarned: 0,
      chestsCollected: 0,
      chestsPoints: 0
    };
    
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
    const player = document.getElementById('twitch-player');
    
    if (streamInfo && playerContainer && player) {
      playerContainer.style.display = 'none';
      player.src = '';
      streamInfo.style.display = 'block';
      streamInfo.innerHTML = `
        <div class="no-stream">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="opacity: 0.3;">
            <rect x="2" y="2" width="20" height="20" rx="2" stroke-width="2"/>
            <path d="M2 8h20M8 2v20" stroke-width="2"/>
          </svg>
          <p style="color: var(--text-secondary); margin-top: 16px;">Ожидание</p>
        </div>
      `;
    }
  }

  updateSessionInfo() {
    if (!this.sessionStartTime) return;
    
    const duration = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = duration % 60;
    
    // Обновляем таймер в header
    const sessionTimerDisplay = document.getElementById('session-timer-display');
    const sessionTimeValue = document.getElementById('session-time-value');
    if (sessionTimerDisplay && sessionTimeValue) {
      sessionTimerDisplay.style.display = 'block';
      sessionTimeValue.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    const durationEl = document.getElementById('session-duration');
    if (durationEl) {
      durationEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    // Реальный расчет потребления на основе webview
    const player = document.getElementById('twitch-player');
    const miniPlayer = document.getElementById('mini-twitch-player');
    
    let currentRate = 0;
    
    // Проверяем какой плеер активен
    const activePlayer = (player && player.src) ? player : (miniPlayer && miniPlayer.src) ? miniPlayer : null;
    
    if (activePlayer && activePlayer.src) {
      // Низкое качество 160p: ~250-350 KB/s
      // Используем среднее значение с небольшой вариацией
      const baseRate = 300;
      const variation = Math.sin(Date.now() / 10000) * 50; // Плавная вариация
      currentRate = baseRate + variation;
      
      this.estimatedBandwidth += currentRate;
      
      // Сохраняем в историю (последние 10 значений)
      this.bandwidthHistory.push(currentRate);
      if (this.bandwidthHistory.length > 100) {  // Увеличиваем историю для более гладкого графика
        this.bandwidthHistory.shift();
      }
    }
    
    const bandwidthEl = document.getElementById('session-bandwidth');
    if (bandwidthEl) {
      let totalText = '';
      if (this.estimatedBandwidth < 1024) {
        totalText = `${Math.round(this.estimatedBandwidth)} KB`;
      } else if (this.estimatedBandwidth < 1024 * 1024) {
        totalText = `${(this.estimatedBandwidth / 1024).toFixed(1)} MB`;
      } else {
        totalText = `${(this.estimatedBandwidth / (1024 * 1024)).toFixed(2)} GB`;
      }
      
      // Используем среднее значение из истории для более стабильного отображения
      const avgRate = this.bandwidthHistory.length > 0
        ? this.bandwidthHistory.reduce((a, b) => a + b, 0) / this.bandwidthHistory.length
        : currentRate;
      
      bandwidthEl.textContent = `${totalText} | ${Math.round(avgRate)} KB/s`;
    }
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
          sidebarProgress.style.borderColor = 'rgba(0, 229, 122, 0.4)';
          sidebarBar.style.background = '#00e57a';
        } else {
          sidebarProgress.style.borderColor = 'var(--border-color)';
          sidebarBar.style.background = '#9147ff';
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
    const player = document.getElementById('twitch-player');
    
    if (streamInfo && playerContainer && player) {
      // Скрываем no-stream и показываем плеер
      streamInfo.style.display = 'none';
      playerContainer.style.display = 'block';
      
      // Загружаем стрим в webview с низким качеством
      const embedUrl = `https://player.twitch.tv/?channel=${stream.login}&parent=localhost&muted=true&quality=160p30`;
      player.src = embedUrl;
      
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
      
// Отображаем теги если они есть
          const categoryEl = document.getElementById('stream-category');
          if (categoryEl && stream.tags && stream.tags.length > 0) {
            categoryEl.textContent = stream.tags.join(' · ');
            categoryEl.style.display = 'inline-block';
          } else if (categoryEl) {
            categoryEl.style.display = 'none';
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
    }
  }

  async displayAvailableDrops_DISABLED(gameName) {
    console.log('displayAvailableDrops called for:', gameName);
    
    const dropsInfoContainer = document.getElementById('stream-drops-info');
    const dropsList = document.getElementById('stream-drops-list');
    
    console.log('DOM elements:', { dropsInfoContainer: !!dropsInfoContainer, dropsList: !!dropsList });
    
    if (!dropsInfoContainer || !dropsList) return;
    
    try {
      // Получаем дропсы для этой игры
      const drops = await window.dropsManager.getDropsForGame(gameName);
      
      console.log('Drops found:', drops ? drops.length : 0, drops);
      
      if (!drops || drops.length === 0) {
        dropsInfoContainer.style.display = 'none';
        return;
      }
      
      // Показываем контейнер
      dropsInfoContainer.style.display = 'block';
      
      // Рендерим список дропсов
      dropsList.innerHTML = drops.map(campaign => {
        const daysText = campaign.daysRemaining > 0 
          ? `${campaign.daysRemaining} ${campaign.daysRemaining === 1 ? 'день' : campaign.daysRemaining < 5 ? 'дня' : 'дней'}`
          : `${campaign.hoursRemaining} ${campaign.hoursRemaining === 1 ? 'час' : campaign.hoursRemaining < 5 ? 'часа' : 'часов'}`;
        
        const endingBadge = campaign.isEnding 
          ? `<span style="background: rgba(255, 59, 48, 0.2); color: #ff3b30; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; margin-left: 6px;">⏰ Заканчивается</span>`
          : '';
        
        const dropsItems = campaign.drops.map(drop => {
          const hours = Math.floor(drop.requiredMinutes / 60);
          const mins = drop.requiredMinutes % 60;
          const timeText = hours > 0 ? `${hours}ч ${mins > 0 ? mins + 'м' : ''}` : `${mins}м`;
          
          return `
            <div style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
              ${drop.imageUrl ? `<img src="${drop.imageUrl}" alt="${drop.name}" style="width: 28px; height: 28px; border-radius: 4px; object-fit: cover;">` : '<div style="width: 28px; height: 28px; background: rgba(145, 71, 255, 0.2); border-radius: 4px; display: flex; align-items: center; justify-content: center;"><svg width="14" height="14" viewBox="0 0 16 16" fill="#9147ff"><path d="M8 2L10 6H14L11 9L12 13L8 10.5L4 13L5 9L2 6H6L8 2Z"/></svg></div>'}
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 12px; color: var(--text-primary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${drop.name}</div>
                <div style="font-size: 10px; color: var(--text-tertiary);">⏱ ${timeText}</div>
              </div>
            </div>
          `;
        }).join('');
        
        return `
          <div style="margin-bottom: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${campaign.name}</div>
              <div style="display: flex; align-items: center; font-size: 11px; color: var(--text-secondary);">
                ⏰ ${daysText}
                ${endingBadge}
              </div>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;">🎁 Наград: ${campaign.drops.length}</div>
            <div>${dropsItems}</div>
          </div>
        `;
      }).join('');
      
    } catch (error) {
      console.error('Error displaying drops:', error);
      dropsInfoContainer.style.display = 'none';
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
      campaignEl.style.cssText = 'margin-bottom: 16px; padding: 16px; background: rgba(255, 255, 255, 0.03); border-radius: 6px; border: 1px solid var(--border-color);';
      
      // Заголовок кампании
      let headerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
      `;
      
      if (campaign.game && campaign.game.boxArtURL) {
        headerHTML += `<img src="${campaign.game.boxArtURL}" alt="${campaign.game.name}" style="width: 40px; height: 56px; border-radius: 4px; object-fit: cover;">`;
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
        const progressColor = drop.claimed ? '#00f593' : '#9147ff';
        const statusText = drop.claimed ? 'Получено' : `${drop.progress}/${drop.required} мин`;
        
        dropsHTML += `
          <div style="margin-bottom: 12px; ${drop === campaign.drops[campaign.drops.length - 1] ? '' : 'padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);'}">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
              ${drop.imageURL ? `<img src="${drop.imageURL}" alt="${drop.name}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;">` : ''}
              <div style="flex: 1;">
                <div style="font-size: 13px; color: var(--text-primary); margin-bottom: 2px;">${drop.name}</div>
                <div style="font-size: 11px; color: var(--text-tertiary);">${statusText}</div>
              </div>
              <div style="font-size: 13px; font-weight: 600; color: ${progressColor};">${drop.percentage}%</div>
            </div>
            <div style="width: 100%; height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; overflow: hidden;">
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
          const stream = streams[0];
          
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
    if (this.viewersHistory.length < 2) return;
    
    const canvas = ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const outerPadding = 16;
    const topArea = 34;
    const bottomArea = 46;
    const chartLeft = outerPadding + 8;
    const chartRight = width - outerPadding - 8;
    const chartTop = outerPadding + topArea;
    const chartBottom = height - outerPadding - bottomArea;
    
    // Очищаем canvas
    ctx.clearRect(0, 0, width, height);
    
    // Находим мин/макс
    const values = this.viewersHistory.map(h => h.count);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    // Функция для получения координат точки
    const getPoint = (i) => {
      const x = chartLeft + (i / (this.viewersHistory.length - 1)) * (chartRight - chartLeft);
      const y = chartBottom - ((this.viewersHistory[i].count - min) / range) * (chartBottom - chartTop);
      return { x, y };
    };
    
    // Создаем градиент для заливки
    const gradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
    gradient.addColorStop(0, 'rgba(145, 71, 255, 0.35)');
    gradient.addColorStop(0.6, 'rgba(145, 71, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(145, 71, 255, 0.02)');
    
    // Сетка
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = chartTop + (i / 3) * (chartBottom - chartTop);
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
    }

    // Заливка под графиком с плавными кривыми
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(chartLeft, chartBottom);
    
    // Первая точка
    const firstPoint = getPoint(0);
    ctx.lineTo(firstPoint.x, firstPoint.y);
    
    // Рисуем плавные кривые через все точки
    for (let i = 0; i < this.viewersHistory.length - 1; i++) {
      const current = getPoint(i);
      const next = getPoint(i + 1);
      
      // Контрольные точки для сглаживания
      const cpX = current.x + (next.x - current.x) * 0.5;
      const cpY1 = current.y;
      const cpY2 = next.y;
      
      ctx.bezierCurveTo(cpX, cpY1, cpX, cpY2, next.x, next.y);
    }
    
    ctx.lineTo(chartRight, chartBottom);
    ctx.closePath();
    ctx.fill();
    
    // Рисуем плавную линию
    ctx.strokeStyle = '#9147ff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(145, 71, 255, 0.5)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    
    const startPoint = getPoint(0);
    ctx.moveTo(startPoint.x, startPoint.y);
    
    // Рисуем плавные кривые
    for (let i = 0; i < this.viewersHistory.length - 1; i++) {
      const current = getPoint(i);
      const next = getPoint(i + 1);
      
      const cpX = current.x + (next.x - current.x) * 0.5;
      const cpY1 = current.y;
      const cpY2 = next.y;
      
      ctx.bezierCurveTo(cpX, cpY1, cpX, cpY2, next.x, next.y);
    }
    
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    // Заголовок
    ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#efeff1';
    ctx.fillText('Динамика зрителей', width / 2, outerPadding + 16);

    // Нижняя панель со значениями
    const barWidth = width - outerPadding * 2;
    const barHeight = 30;
    const barX = outerPadding;
    const barY = height - outerPadding - barHeight;
    const segment = barWidth / 3;

    const drawRoundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    drawRoundRect(barX, barY, barWidth, barHeight, 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX + segment, barY + 6);
    ctx.lineTo(barX + segment, barY + barHeight - 6);
    ctx.moveTo(barX + segment * 2, barY + 6);
    ctx.lineTo(barX + segment * 2, barY + barHeight - 6);
    ctx.stroke();

    const current = this.viewersHistory[this.viewersHistory.length - 1];
    const stats = [
      { label: 'Макс', value: max.toLocaleString(), color: '#adadb8' },
      { label: 'Мин', value: min.toLocaleString(), color: '#adadb8' },
      { label: 'Сейчас', value: current.count.toLocaleString(), color: '#00e57a' }
    ];

    stats.forEach((item, i) => {
      const cx = barX + segment * i + segment / 2;
      ctx.textAlign = 'center';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#8f9099';
      ctx.fillText(item.label, cx, barY + 12);
      ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = item.color;
      ctx.fillText(item.value, cx, barY + 26);
    });
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

      // Находим текущий стрим
      const currentIndex = streams.findIndex(s => s.login === this.currentStream?.login);
      
      // Берем следующий стрим (или первый если достигли конца)
      const nextIndex = (currentIndex + 1) % streams.length;
      const nextStream = streams[nextIndex];
      
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
      const stream = streams[0];
      this.currentCategory = prevCategory;
      this.currentStream = stream;
      this.resetChannelPointsTracking();
      
      const player = document.getElementById('twitch-player');
      if (player) {
        player.src = `https://player.twitch.tv/?channel=${stream.login}&parent=localhost&muted=true`;
      }
      
      // Обновляем URL чата (даже если скрыт) для корректной загрузки при открытии
      const chatWebview = document.getElementById('twitch-chat');
      if (chatWebview) {
        chatWebview.src = `https://www.twitch.tv/embed/${stream.login}/chat?parent=localhost&darkpopout`;
      }
      
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
      const stream = streams[0];
      this.currentCategory = nextCategory;
      this.currentStream = stream;
      this.resetChannelPointsTracking();
      
      const player = document.getElementById('twitch-player');
      if (player) {
        player.src = `https://player.twitch.tv/?channel=${stream.login}&parent=localhost&muted=true`;
      }
      
      // Обновляем URL чата (даже если скрыт) для корректной загрузки при открытии
      const chatWebview = document.getElementById('twitch-chat');
      if (chatWebview) {
        chatWebview.src = `https://www.twitch.tv/embed/${stream.login}/chat?parent=localhost&darkpopout`;
      }
      
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
    const chatWebview = document.getElementById('twitch-chat');
    const grid = document.getElementById('player-chat-grid');
    
    if (!playerContainer || !chatContainer || !chatWebview || !grid) {
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
      
      // Загружаем/перезагружаем чат если он не загружен
      const chatUrl = `https://www.twitch.tv/embed/${channel}/chat?parent=localhost&darkpopout`;
      if (!chatWebview.src || chatWebview.src !== chatUrl) {
        chatWebview.src = chatUrl;
      } else {
        // Если URL одинаковый, перезагружаем webview
        chatWebview.reload?.();
      }
      
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
        // НЕ очищаем src, чтобы автосбор бонусов продолжал работать в фоне
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
    const player = document.getElementById('twitch-player');
    if (!player) return;

    // Обновляем текущий стрим
    this.currentStream = stream;
    this.resetChannelPointsTracking();
    
    // Переключаем плеер (используем player.twitch.tv без чата)
    player.src = `https://player.twitch.tv/?channel=${stream.login}&parent=localhost&muted=true`;
    
    // Обновляем URL чата (даже если скрыт) для корректной загрузки при открытии
    const chatWebview = document.getElementById('twitch-chat');
    if (chatWebview) {
      chatWebview.src = `https://www.twitch.tv/embed/${stream.login}/chat?parent=localhost&darkpopout`;
    }
    
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
    
    // Также проверяем периодически в течение первой минуты
    let checks = 0;
    const intervalId = setInterval(() => {
      checks++;
      checkMatureContent();
      if (checks >= 6) { // 6 проверок = 1 минута
        clearInterval(intervalId);
      }
    }, 10000);
  }

  startBonusAutoCollector(chatWebview) {
    if (!chatWebview) return;
    
    // Останавливаем предыдущий интервал если есть
    if (this.bonusCollectorInterval) {
      clearInterval(this.bonusCollectorInterval);
    }
    
    // Ждем загрузки чата
    const setupCollector = () => {
      console.log('Setting up bonus auto-collector...');
      
      // Скрипт для автоматического сбора бонусов
      const collectorScript = `
        (function() {
          // Инициализируем счетчик если его нет
          if (typeof window.__chestsCollectedCount === 'undefined') {
            window.__chestsCollectedCount = 0;
            window.__lastChestPoints = 0;
            console.log('✅ Initialized chest counter');
          }
          
          function clickBonusButton() {
            try {
              // Расширенный список селекторов для кнопок сбора бонусов
              const selectors = [
                // Twitch стандартные селекторы
                'button[class*="ScCoreButton"][class*="ScCoreButtonSuccess"]',
                'button[class*="community-points-summary"]',
                'button[aria-label*="Claim"]',
                'button[aria-label*="claim"]',
                'button[aria-label*="Bonus"]',
                'button[aria-label*="bonus"]',
                'button[data-test-selector*="community-points"]',
                // Селекторы по классам
                'button.tw-button--success',
                'button[class*="claimable"]',
                'button[class*="claim"]',
                // Общие селекторы
                '.community-points-summary button',
                '[class*="community-points"] button[class*="success"]'
              ];
              
              let foundAny = false;
              
              for (const selector of selectors) {
                const buttons = document.querySelectorAll(selector);
                
                for (const button of buttons) {
                  // Проверяем что кнопка существует и видима
                  if (!button || !button.offsetParent) continue;
                  
                  const rect = button.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) continue;
                  
                  const computedStyle = window.getComputedStyle(button);
                  if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') continue;
                  
                  // Получаем текст кнопки
                  const text = (button.textContent || button.innerText || '').toLowerCase();
                  const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
                  const className = button.className.toLowerCase();
                  
                  // Проверяем признаки кнопки сбора бонуса
                  const isClaimButton = 
                    text.includes('claim') || 
                    text.includes('собрать') ||
                    ariaLabel.includes('claim') || 
                    ariaLabel.includes('bonus') ||
                    ariaLabel.includes('бонус') ||
                    className.includes('success') ||
                    className.includes('claimable');
                  
                  if (isClaimButton) {
                    foundAny = true;
                    console.log('✅ Found claimable bonus!');
                    console.log('  Selector:', selector);
                    console.log('  Text:', text);
                    console.log('  Aria-label:', ariaLabel);
                    console.log('  Class:', button.className);
                    
                    button.click();
                    window.__chestsCollectedCount++;
                    window.__lastChestPoints = 50;
                    console.log('💰 Chest #' + window.__chestsCollectedCount + ' collected!');
                    return true;
                  }
                }
              }
              
              if (!foundAny) {
                // Логируем только раз в 10 проверок чтобы не спамить
                if (!window.__checkCount) window.__checkCount = 0;
                window.__checkCount++;
                
                if (window.__checkCount % 10 === 0) {
                  console.log('🔍 No bonus chest found (check #' + window.__checkCount + ')');
                }
              }
              
            } catch (err) {
              console.error('❌ Error in clickBonusButton:', err);
            }
            return false;
          }
          
          // Проверяем сразу после загрузки
          setTimeout(clickBonusButton, 2000);
          
          // MutationObserver для мгновенной реакции на изменения DOM
          const observer = new MutationObserver((mutations) => {
            // Проверяем только если есть изменения в DOM
            let shouldCheck = false;
            
            for (const mutation of mutations) {
              if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Проверяем добавленные узлы
                for (const node of mutation.addedNodes) {
                  if (node.nodeType === 1) { // Element node
                    const text = node.textContent || '';
                    if (text.toLowerCase().includes('claim') || 
                        text.toLowerCase().includes('bonus') ||
                        node.className && node.className.toString().toLowerCase().includes('community-points')) {
                      shouldCheck = true;
                      console.log('🔔 Bonus-related element added to DOM');
                      break;
                    }
                  }
                }
              } else if (mutation.type === 'attributes' && 
                         (mutation.attributeName === 'class' || mutation.attributeName === 'aria-label')) {
                const target = mutation.target;
                if (target.tagName === 'BUTTON') {
                  shouldCheck = true;
                }
              }
              
              if (shouldCheck) break;
            }
            
            if (shouldCheck) {
              clickBonusButton();
            }
          });
          
          // Наблюдаем за областью где появляются бонусы
          setTimeout(() => {
            const chatRoot = document.querySelector('.chat-room, .stream-chat, [class*="chat"]') || document.body;
            observer.observe(chatRoot, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['class', 'aria-label']
            });
            console.log('👀 Observer attached to:', chatRoot.className || 'body');
          }, 1000);
          
          // Интервал как запасной вариант (проверяем каждые 5 секунд)
          setInterval(clickBonusButton, 5000);
          
          console.log('✨ Bonus auto-collector initialized (checking every 5s + on DOM changes)');
        })();
      `;
      
      // Выполняем скрипт в WebView после загрузки
      chatWebview.executeJavaScript(collectorScript)
        .then(() => {
          console.log('Bonus collector script injected successfully');
        })
        .catch(err => {
          console.error('Failed to inject bonus collector:', err);
        });
    };
    
    // Пробуем запустить после небольшой задержки
    chatWebview.addEventListener('dom-ready', () => {
      setTimeout(setupCollector, 3000);
    }, { once: true });
  }

  startBackgroundBonusCollector(channelLogin) {
    console.log('Starting background bonus collector for', channelLogin);
    
    // Используем скрытый WebView для чата
    const chatWebview = document.getElementById('twitch-chat');
    if (!chatWebview) {
      console.error('Chat webview not found');
      return;
    }
    
    // Загружаем чат в фоне (даже если он не показан)
    chatWebview.src = `https://www.twitch.tv/embed/${channelLogin}/chat?parent=localhost&darkpopout`;
    
    // Запускаем автосбор
    this.startBonusAutoCollector(chatWebview);
    
    // Запускаем регулярный опрос баллов
    this.startPointsPolling(chatWebview);
    
    console.log('Background bonus collector started');
  }
  
  startPointsPolling(chatWebview) {
    // Останавливаем предыдущий интервал
    if (this.pointsPollingInterval) {
      clearInterval(this.pointsPollingInterval);
    }
    
    // Опрашиваем баллы каждые 10 секунд
    this.pointsPollingInterval = setInterval(() => {
      this.pollChannelPoints(chatWebview);
    }, 10000);
    
    // Первый опрос через 5 секунд после загрузки
    setTimeout(() => {
      this.pollChannelPoints(chatWebview);
    }, 5000);
  }
  
  async pollChannelPoints(chatWebview) {
    if (!this.currentStream) return;
    
    try {
      // Используем новый API метод вместо парсинга DOM
      const result = await window.electronAPI.getChannelPoints(this.currentStream.login);
      
      if (result && !result.error && typeof result.points === 'number') {
        const newTotal = result.points;
        
        // Если это первое значение, просто сохраняем
        if (this.channelPoints.startTotal === 0 && this.channelPoints.currentTotal === 0) {
          this.channelPoints.startTotal = newTotal;
          this.channelPoints.currentTotal = newTotal;
          console.log('Initial channel points:', newTotal);
          this.updateChannelPointsUI();
        } else if (newTotal !== this.channelPoints.currentTotal) {
          // Обновляем текущее значение
          const earnedSinceStart = newTotal - this.channelPoints.startTotal;
          this.channelPoints.currentTotal = newTotal;
          this.channelPoints.earnedThisStream = Math.max(0, earnedSinceStart);
          
          console.log('Channel points updated:', {
            total: newTotal,
            earned: this.channelPoints.earnedThisStream
          });
          
          // Обновляем UI
          this.updateChannelPointsUI();
        }
      }
    } catch (error) {
      console.error('Error polling channel points:', error);
    }
  }
  
  updateChannelPointsUI() {
    const totalEl = document.getElementById('channel-points-total');
    const earnedEl = document.getElementById('channel-points-earned');
    const passiveEl = document.getElementById('passive-points-earned');
    
    if (totalEl) {
      totalEl.textContent = this.channelPoints.currentTotal > 0 
        ? this.channelPoints.currentTotal.toLocaleString() 
        : '-';
    }
    
    if (earnedEl) {
      if (this.channelPoints.earnedThisStream > 0) {
        earnedEl.textContent = `+${this.channelPoints.earnedThisStream.toLocaleString()} за этот стрим`;
      } else {
        earnedEl.textContent = 'Ожидание данных...';
      }
    }
    
    if (passiveEl) {
      if (this.channelPoints.earnedThisStream > 0) {
        passiveEl.textContent = `+${this.channelPoints.passiveEarned.toLocaleString()} баллов`;
      } else {
        passiveEl.textContent = '-';
      }
    }
  }
  
  resetChannelPointsTracking() {
    this.channelPoints = {
      startTotal: 0,
      currentTotal: 0,
      earnedThisStream: 0,
      passiveEarned: 0,
      chestsCollected: 0,
      chestsPoints: 0
    };
    this.updateChannelPointsUI();
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
        const player = document.getElementById('twitch-player');
        
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
          console.warn('Stream health check failed 2 times, switching to another stream...');
          window.utils.showToast('Стрим недоступен, переключение...', 'warning');
          this.streamHealthFailCount = 0;
          
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
    const intervals = [
      'updateInterval',
      'sessionInterval', 
      'streamStatsInterval',
      'dropsProgressInterval',
      'pointsPollingInterval',
      'streamHealthCheckInterval'
    ];
    intervals.forEach(key => {
      if (this[key]) {
        clearInterval(this[key]);
        delete this[key];
      }
    });
  }
}

// Export to window
window.FarmingPage = FarmingPage;
