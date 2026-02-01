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
    this.isInitialized = false; // Флаг инициализации
    this.eventListeners = []; // Массив для хранения обработчиков
    
    // Channel Points tracking
    this.channelPoints = {
      startTotal: 0,        // Баллы в начале стрима
      currentTotal: 0,      // Текущее количество баллов
      earnedThisStream: 0,  // Заработано за этот стрим
      passiveEarned: 0,     // Заработано пассивно
      chestsCollected: 0,   // Собрано сундучков
      chestsPoints: 0       // Баллов из сундучков
    };
    
    this.init();
  }

  setupMatureContentAutoClick(player) {
    if (!player || !player.src) return;
    
    const autoClick = () => {
      setTimeout(() => {
        player.executeJavaScript(`
          (function() {
            const startButton = document.querySelector('button[data-a-target="player-overlay-mature-accept"]') ||
                              document.querySelector('button[data-test-selector="player-overlay-mature-accept"]') ||
                              Array.from(document.querySelectorAll('button')).find(btn => 
                                btn.textContent.includes('Начать просмотр') || 
                                btn.textContent.includes('Start Watching')
                              );
            
            if (startButton) {
              console.log('Auto-clicking mature content button');
              startButton.click();
              return true;
            }
            return false;
          })();
        `).then(clicked => {
          if (!clicked) {
            setTimeout(autoClick, 2000);
          }
        }).catch(() => {});
      }, 1000);
    };
    
    player.addEventListener('did-finish-load', autoClick, { once: true });
  }

  async init() {
    if (this.isInitialized) {
      console.log('FarmingPage already initialized, skipping...');
      return;
    }
    console.log('FarmingPage.init() called');
    this.categories = await Storage.getCategories();
    console.log('Categories loaded in FarmingPage:', this.categories.length);
    this.renderCategories();
    this.setupEventListeners();
    
    // Запускаем обновление данных каждые 2 минуты
    this.startAutoUpdate();
    
    // Check if already farming - восстанавливаем состояние кнопок
    if (window.streamingManager && window.streamingManager.isFarmingActive) {
      if (window.streamingManager.isFarmingActive()) {
        console.log('Restoring farming state - stream is active');
        this.showFarmingState();
        
        // Восстанавливаем информацию о сессии
        const sessionInfo = document.getElementById('farming-session-info');
        if (sessionInfo) {
          sessionInfo.style.display = 'block';
        }
        
        // Восстанавливаем таймер сессии если он был активен
        if (this.sessionStartTime) {
          if (this.sessionInterval) {
            clearInterval(this.sessionInterval);
          }
          this.sessionInterval = setInterval(() => {
            this.updateSessionInfo();
          }, 1000);
        }
      } else {
        // Нет активного стрима - проверяем, нужно ли автозапустить
        this.checkAutoStart();
      }
    }
    
    this.isInitialized = true;
    console.log('FarmingPage initialization complete');
  }

  async checkAutoStart() {
    // Проверяем, есть ли категории с незавершенными дропсами
    const categoriesWithDrops = this.categories.filter(cat => 
      cat.enabled !== false && cat.hasDrops && !cat.dropsCompleted
    );
    
    if (categoriesWithDrops.length > 0) {
      console.log('Auto-starting farming for drops categories');
      window.utils.showToast('Автозапуск фарминга дропсов...', 'info');
      
      // Запускаем фарминг с задержкой для корректной инициализации
      setTimeout(() => {
        console.log('Setting isAutoStarted = true before startFarming');
        this.isAutoStarted = true; // Устанавливаем флаг ДО вызова startFarming
        this.startFarming();
      }, 2000);
    }
  }

  startAutoUpdate() {
    // Очищаем старый интервал если есть
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    // И затем каждые 30 секунд
    this.updateInterval = setInterval(() => {
      this.updateCategoriesData();
    }, 30000); // 30 секунд
  }

  async updateCategoriesData() {
    if (this.categories.length === 0) return;
    
    try {
      console.log('Updating categories data...');
      
      // Получаем свежие данные о категориях
      const allCategories = await window.electronAPI.fetchTwitchCategories();
      
      let updated = false;
      
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
        const hasDrops = await window.electronAPI.checkCategoryDrops(category.name);
        if (category.hasDrops !== hasDrops) {
          category.hasDrops = hasDrops;
          updated = true;
        }
      }
      
      if (updated) {
        // Сохраняем обновленные данные
        await Storage.saveCategories(this.categories);
        
        // Перерисовываем список
        this.renderCategories();
        
        console.log('Categories data updated:', this.categories.map(c => `${c.name}: ${(c.viewersCount/1000).toFixed(1)}K`));
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
    const addBtn = document.getElementById('add-category-btn');
    const addAllDropsBtn = document.getElementById('add-all-drops-btn');
    const dropsFilterBtn = document.getElementById('drops-filter-btn');
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    const nextStreamBtn = document.getElementById('next-stream-btn');
    const prevCategoryBtn = document.getElementById('prev-category-btn');
    const nextCategoryBtn = document.getElementById('next-category-btn');
    const toggleChatBtn = document.getElementById('toggle-chat-btn');
    
    console.log('Setting up event listeners, buttons found:', {
      addBtn: !!addBtn,
      addAllDropsBtn: !!addAllDropsBtn,
      startBtn: !!startBtn
    });

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
      // Проверяем при загрузке, есть ли уже авто-дропсы
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
      stopBtn.addEventListener('click', async () => {
        await this.stopFarming();
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

      // Получаем данные о дропсах из inventory (для активных кампаний с прогрессом)
      const dropsData = await window.electronAPI.fetchDropsInventory();
      console.log('Drops data:', dropsData);
      
      // Создаем карту активных кампаний из inventory
      const campaignMap = new Map();
      if (dropsData && dropsData.campaigns) {
        dropsData.campaigns.forEach(campaign => {
          if (campaign.game && campaign.game.name) {
            const gameName = campaign.game.name.toLowerCase();
            campaignMap.set(gameName, campaign);
          }
        });
      }
      
      // Проверяем ВСЕ категории на наличие дропсов параллельно
      console.log('Checking drops for all categories...');
      const dropsChecks = await Promise.all(
        categories.map(async (cat) => {
          try {
            const hasDrops = await window.electronAPI.checkCategoryDrops(cat.name);
            const campaign = campaignMap.get(cat.name.toLowerCase());
            
            return { 
              id: cat.id, 
              hasDrops,
              campaign: campaign || null
            };
          } catch (error) {
            console.error(`Error checking drops for ${cat.name}:`, error);
            return { 
              id: cat.id, 
              hasDrops: false,
              campaign: null
            };
          }
        })
      );

      // Обновляем данные о дропсах
      categories.forEach(cat => {
        const dropsInfo = dropsChecks.find(d => d.id === cat.id);
        if (dropsInfo) {
          cat.hasDrops = dropsInfo.hasDrops;
          
          if (dropsInfo.campaign) {
            const campaign = dropsInfo.campaign;
            cat.dropsEndsAt = campaign.endsAt;
            
            // Вычисляем прогресс
            const totalDrops = campaign.drops.length;
            let totalProgress = 0;
            campaign.drops.forEach(drop => {
              const dropPercent = drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0;
              totalProgress += dropPercent;
            });
            cat.dropsProgressPercent = totalDrops > 0 ? Math.floor(totalProgress / totalDrops) : 0;
            cat.dropsCompleted = cat.dropsProgressPercent >= 100;
          } else {
            cat.dropsProgressPercent = 0;
            cat.dropsCompleted = false;
          }
        } else {
          cat.hasDrops = false;
        }
      });
      
      let modalDropsFilterEnabled = false;
      
      const modal = document.createElement('div');
      modal.className = 'auth-modal';
      modal.innerHTML = `
        <div class="auth-modal-overlay"></div>
        <div class="auth-modal-content" style="width: 750px; max-height: 85vh; overflow-y: hidden; display: flex; flex-direction: column;">
          <div class="auth-modal-header">
            <h3>Выберите категорию</h3>
            <button class="close-modal">
              <svg width="20" height="20" viewBox="0 0 20 20">
                <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
          </div>
          <div class="auth-modal-body" style="display: flex; flex-direction: column; gap: 12px; overflow: hidden;">
            <div style="display: flex; gap: 10px; position: sticky; top: 0; z-index: 10; background: var(--bg-secondary); padding: 5px 0;">
              <input 
                type="text" 
                id="category-search" 
                placeholder="Поиск категории..." 
                style="flex: 1; padding: 10px 14px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-primary); font-size: 14px; outline: none; transition: all 0.2s;"
              />
              <button id="modal-drops-filter-btn" style="padding: 10px 16px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-secondary); cursor: pointer; white-space: nowrap; font-size: 13px; font-weight: 600; transition: all 0.2s;">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 6px; vertical-align: middle;">
                  <path d="M8 2L10 6H14L11 9L12 13L8 10.5L4 13L5 9L2 6H6L8 2Z"/>
                </svg>
                Drops сверху
              </button>
            </div>
            <div class="category-list" id="modal-category-list" style="overflow-y: auto; max-height: calc(85vh - 200px);">
              ${this.renderCategoryItems(categories, categories)}
            </div>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // Focus на поиск
      const searchInput = modal.querySelector('#category-search');
      setTimeout(() => searchInput.focus(), 100);
      
      // Обработчик фильтра дропсов
      const modalDropsFilterBtn = modal.querySelector('#modal-drops-filter-btn');
      if (modalDropsFilterBtn) {
        modalDropsFilterBtn.addEventListener('click', () => {
          modalDropsFilterEnabled = !modalDropsFilterEnabled;
          
          if (modalDropsFilterEnabled) {
            modalDropsFilterBtn.style.background = 'var(--accent-color)';
            modalDropsFilterBtn.style.color = 'white';
            modalDropsFilterBtn.style.borderColor = 'var(--accent-color)';
          } else {
            modalDropsFilterBtn.style.background = 'var(--bg-primary)';
            modalDropsFilterBtn.style.color = 'var(--text-secondary)';
            modalDropsFilterBtn.style.borderColor = 'var(--border-color)';
          }
          
          // Применяем фильтр
          const query = searchInput.value.toLowerCase().trim();
          let filtered = categories.filter(cat => 
            cat.name.toLowerCase().includes(query)
          );
          
          // Сортируем и фильтруем
          filtered = this.sortAndFilterCategoriesForModal(filtered, modalDropsFilterEnabled);
          
          const list = modal.querySelector('#modal-category-list');
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
      }
      
      // Обработчик поиска
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        let filtered = categories.filter(cat => 
          cat.name.toLowerCase().includes(query)
        );
        
        // Сортируем и фильтруем
        filtered = this.sortAndFilterCategoriesForModal(filtered, modalDropsFilterEnabled);
        
        const list = modal.querySelector('#modal-category-list');
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
  
  sortAndFilterCategoriesForModal(categories, dropsFilterEnabled) {
    let result = [...categories];
    
    // Фильтруем если включен фильтр дропсов
    if (dropsFilterEnabled) {
      result = result.filter(cat => cat.hasDrops && !cat.dropsCompleted);
      
      // Сортируем по дропсам: активные с прогрессом > активные без прогресса > остальные
      result.sort((a, b) => {
        const aActiveDrops = a.hasDrops && !a.dropsCompleted;
        const bActiveDrops = b.hasDrops && !b.dropsCompleted;
        const aCompletedDrops = a.hasDrops && a.dropsCompleted;
        const bCompletedDrops = b.hasDrops && b.dropsCompleted;
        
        // Активные дропсы в начале
        if (aActiveDrops && !bActiveDrops && !bCompletedDrops) return -1;
        if (bActiveDrops && !aActiveDrops && !aCompletedDrops) return 1;
        
        // Завершенные дропсы в конце
        if (aCompletedDrops && !bCompletedDrops) return 1;
        if (bCompletedDrops && !aCompletedDrops) return -1;
        
        // Среди активных сортируем по прогрессу
        if (aActiveDrops && bActiveDrops) {
          const aProgress = a.dropsProgressPercent || 0;
          const bProgress = b.dropsProgressPercent || 0;
          return aProgress - bProgress;
        }
        
        // По умолчанию по количеству зрителей
        return (b.viewersCount || 0) - (a.viewersCount || 0);
      });
    } else {
      // Если фильтр выключен - обычная сортировка по количеству зрителей
      result.sort((a, b) => (b.viewersCount || 0) - (a.viewersCount || 0));
    }
    
    return result;
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
      
      // Индикатор дропсов с улучшенной информацией
      let dropsIndicator = '';
      if (cat.hasDrops) {
        if (cat.dropsCompleted) {
          dropsIndicator = `
            <span class="drops-badge" style="font-size: 11px; padding: 4px 8px; background: rgba(0, 245, 147, 0.15); color: #00f593; border-radius: 4px; font-weight: 600; margin-left: 8px; display: inline-flex; align-items: center; gap: 4px;">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d="M3.5 7L1 4.5L1.7 3.8L3.5 5.6L8.3 0.8L9 1.5L3.5 7Z"/>
              </svg>
              ДРОПСЫ ПОЛУЧЕНЫ
            </span>
          `;
        } else if (cat.dropsProgressPercent !== undefined && cat.dropsProgressPercent > 0) {
          const timeText = cat.dropsEndsAt ? this.formatTimeRemaining(cat.dropsEndsAt) : '';
          dropsIndicator = `
            <span class="drops-badge" style="font-size: 11px; padding: 4px 8px; background: rgba(145, 71, 255, 0.15); color: #9147ff; border-radius: 4px; font-weight: 600; margin-left: 8px; display: inline-flex; align-items: center; gap: 4px;">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="6" cy="6" r="6"/>
              </svg>
              DROPS ${cat.dropsProgressPercent}%${timeText}
            </span>
          `;
        } else {
          const timeText = cat.dropsEndsAt ? this.formatTimeRemaining(cat.dropsEndsAt) : '';
          dropsIndicator = `
            <span class="drops-badge" style="font-size: 11px; padding: 4px 8px; background: rgba(145, 71, 255, 0.15); color: #9147ff; border-radius: 4px; font-weight: 600; margin-left: 8px; display: inline-flex; align-items: center; gap: 4px;">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="6" cy="6" r="6"/>
              </svg>
              DROPS ВКЛЮЧЕНЫ${timeText}
            </span>
          `;
        }
      }
      
      return `
        <div class="game-item-selector ${isAdded ? 'added' : ''}" data-category-id="${cat.id}" style="cursor: pointer;">
          <img src="${cat.boxArtURL || 'https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg'}" alt="${cat.name}">
          <div class="game-item-info">
            <div class="game-item-name">${cat.name}</div>
            <div class="game-item-viewers" style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
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
      btn.style.position = 'relative';
      btn.style.overflow = 'visible';
      if (btnText) btnText.textContent = 'Отключить автофарм';
      
      // Добавляем анимацию звезд
      if (!btn.querySelector('.star-effect')) {
        this.addStarEffect(btn);
      }
    } else {
      btn.style.background = '';
      btn.style.position = '';
      btn.style.overflow = '';
      if (btnText) btnText.textContent = 'Фарм всех дропсов';
      
      // Удаляем звезды
      const stars = btn.querySelectorAll('.star-effect');
      stars.forEach(star => star.remove());
    }
  }
  
  addStarEffect(button) {
    // Создаем контейнер для звезд
    const starsContainer = document.createElement('div');
    starsContainer.className = 'star-effect';
    starsContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
    `;
    
    // Добавляем несколько звезд
    for (let i = 0; i < 6; i++) {
      const star = document.createElement('div');
      star.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
      star.style.cssText = `
        position: absolute;
        font-size: 12px;
        animation: sparkle ${2 + Math.random()}s ease-in-out infinite;
        animation-delay: ${i * 0.3}s;
        opacity: 0;
        color: #FFD700;
      `;
      
      // Случайная позиция вокруг кнопки
      const angle = (i / 6) * Math.PI * 2;
      const radius = 25;
      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;
      star.style.left = `${x}%`;
      star.style.top = `${y}%`;
      star.style.transform = 'translate(-50%, -50%)';
      
      starsContainer.appendChild(star);
    }
    
    button.style.position = 'relative';
    button.appendChild(starsContainer);
    
    // Добавляем CSS анимацию если её еще нет
    if (!document.getElementById('sparkle-animation')) {
      const style = document.createElement('style');
      style.id = 'sparkle-animation';
      style.textContent = `
        @keyframes sparkle {
          0%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  async toggleAutoDropsCategories() {
    const hasAutoDrops = this.categories.some(cat => cat.autoDrops === true);
    
    if (hasAutoDrops) {
      // Удаляем все категории с autoDrops
      this.categories = this.categories.filter(cat => cat.autoDrops !== true);
      await Storage.saveCategories(this.categories);
      this.renderCategories();
      this.updateAutoDropsButtonState();
      window.utils.showToast('Автофарм дропсов отключен', 'info');
    } else {
      // Добавляем категории с дропсами
      await this.addAllDropsCategories();
    }
  }

  async addAllDropsCategories() {
    try {
      window.utils.showToast('Загружаем категории с дропсами...', 'info');
      
      // Загружаем все категории
      const allCategories = await window.electronAPI.fetchTwitchCategories();
      
      if (!allCategories || allCategories.length === 0) {
        window.utils.showToast('Не удалось загрузить категории', 'error');
        return;
      }

      // Загружаем данные о дропсах для проверки статуса
      const dropsData = await window.electronAPI.fetchDropsInventory();
      console.log('Drops data for auto-add:', dropsData);
      
      // Создаем карту активных кампаний (незавершенных)
      const activeCampaignsMap = new Map();
      if (dropsData && dropsData.campaigns) {
        dropsData.campaigns.forEach(campaign => {
          if (campaign.game && campaign.game.name) {
            // Проверяем, все ли дропсы получены
            const totalDrops = campaign.drops.length;
            let completedDrops = 0;
            campaign.drops.forEach(drop => {
              if (drop.claimed || (drop.required > 0 && drop.progress >= drop.required)) {
                completedDrops++;
              }
            });
            
            const isCompleted = completedDrops >= totalDrops;
            const gameName = campaign.game.name.toLowerCase();
            
            // Добавляем только незавершенные кампании
            if (!isCompleted) {
              activeCampaignsMap.set(gameName, {
                campaign: campaign,
                progress: totalDrops > 0 ? Math.floor((completedDrops / totalDrops) * 100) : 0
              });
            }
          }
        });
      }

      // Проверяем все категории на наличие незавершенных дропсов
      const categoriesWithActiveDrops = [];
      const checkPromises = allCategories.map(async (cat) => {
        try {
          // Пропускаем уже добавленные категории
          if (this.categories.some(c => c.id === cat.id)) {
            return null;
          }
          
          const gameName = cat.name.toLowerCase();
          const campaignInfo = activeCampaignsMap.get(gameName);
          
          // Если есть активная кампания с незавершенными дропсами
          if (campaignInfo) {
            return {
              ...cat,
              campaignInfo: campaignInfo
            };
          }
          
          // Если нет в активных кампаниях, проверяем есть ли вообще дропсы
          const hasDrops = await window.electronAPI.checkCategoryDrops(cat.name);
          if (hasDrops) {
            return cat;
          }
        } catch (error) {
          console.error(`Error checking drops for ${cat.name}:`, error);
        }
        return null;
      });

      const results = await Promise.all(checkPromises);
      const validCategories = results.filter(cat => cat !== null);

      if (validCategories.length === 0) {
        window.utils.showToast('Не найдено новых категорий с незавершенными дропсами', 'warning');
        return;
      }

      // Добавляем все категории с дропсами с флагом autoDrops
      let addedCount = 0;
      for (const category of validCategories) {
        const newCategory = {
          id: category.id,
          name: category.name,
          boxArtURL: category.boxArtURL || '',
          viewersCount: category.viewersCount || 0,
          tags: category.tags || [],
          hasDrops: true,
          autoDrops: true, // ФЛАГ: категория добавлена автоматически для дропсов
          enabled: true,
          priority: this.categories.length + 1
        };
        
        // Добавляем информацию о прогрессе если есть
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
      this.updateAutoDropsButtonState(); // Обновляем состояние кнопки
      window.utils.showToast(`Добавлено ${addedCount} ${addedCount === 1 ? 'категория' : addedCount < 5 ? 'категории' : 'категорий'} с незавершенными дропсами`, 'success');
      
      // Автоматически запускаем фарминг
      setTimeout(() => {
        this.startFarming();
      }, 1000);
    } catch (error) {
      console.error('Error adding all drops categories:', error);
      window.utils.showToast('Ошибка при добавлении категорий', 'error');
    }
  }

  renderCategories() {
    console.log('renderCategories called, categories count:', this.categories.length);
    const container = document.getElementById('categories-list');
    
    if (!container) {
      console.warn('categories-list container not found! Retrying in 100ms...');
      // Повторяем попытку через 100мс если DOM еще не загружен
      setTimeout(() => this.renderCategories(), 100);
      return;
    }
    
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
      return;
    }

    // Сортировка категорий: приоритезация по времени окончания дропсов
    let categoriesToRender = [...this.categories];
    
    categoriesToRender.sort((a, b) => {
      const aEnabled = a.enabled !== false;
      const bEnabled = b.enabled !== false;
      
      // Сначала включенные, потом выключенные
      if (aEnabled && !bEnabled) return -1;
      if (!aEnabled && bEnabled) return 1;
      
      // Среди включенных категорий:
      if (aEnabled && bEnabled) {
        // 1. Категории с активными дропсами (не завершены) - наверху
        const aActiveDrops = a.hasDrops && !a.dropsCompleted;
        const bActiveDrops = b.hasDrops && !b.dropsCompleted;
        
        // Если оба с активными дропсами - сортируем по оставшемуся времени
        if (aActiveDrops && bActiveDrops) {
          // Приоритет по времени окончания (меньше времени = выше)
          if (a.dropsEndsAt && b.dropsEndsAt) {
            const aTime = new Date(a.dropsEndsAt).getTime();
            const bTime = new Date(b.dropsEndsAt).getTime();
            return aTime - bTime; // Раньше заканчивается = выше в списке
          }
          // Если у одного есть время, а у другого нет
          if (a.dropsEndsAt && !b.dropsEndsAt) return -1;
          if (!a.dropsEndsAt && b.dropsEndsAt) return 1;
          
          // Если времени нет у обоих - сортируем по прогрессу
          const aProgress = a.dropsProgressPercent || 0;
          const bProgress = b.dropsProgressPercent || 0;
          return aProgress - bProgress;
        }
        
        // 2. Категории с завершенными дропсами - внизу
        const aCompletedDrops = a.hasDrops && a.dropsCompleted;
        const bCompletedDrops = b.hasDrops && b.dropsCompleted;
        
        // Приоритет: активные дропсы > без дропсов > завершенные дропсы
        if (aActiveDrops && !bActiveDrops && !bCompletedDrops) return -1;
        if (bActiveDrops && !aActiveDrops && !aCompletedDrops) return 1;
        
        if (aCompletedDrops && !bCompletedDrops) return 1;
        if (bCompletedDrops && !aCompletedDrops) return -1;
        
        // Если оба с активными дропсами - сортируем по прогрессу (меньший процент = выше)
        if (aActiveDrops && bActiveDrops) {
          const aProgress = a.dropsProgressPercent || 0;
          const bProgress = b.dropsProgressPercent || 0;
          return aProgress - bProgress;
        }
      }
      
      return 0;
    });
    
    // Если включен фильтр дропсов - показываем только категории с активными дропсами
    if (this.dropsFilterEnabled) {
      categoriesToRender = categoriesToRender.filter(cat => 
        cat.enabled !== false && cat.hasDrops && !cat.dropsCompleted
      );
    }

    container.innerHTML = categoriesToRender.map((cat, index) => {
      const tagsHtml = cat.tags && cat.tags.length > 0 
        ? `<span class="category-tag">${cat.tags[0]}</span>` 
        : '';
      
      const dropsStatusHtml = cat.hasDrops ? (
        cat.dropsCompleted 
          ? `<span class="category-drops-status" style="color: #00f593; background: rgba(0, 245, 147, 0.15); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
               <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="margin-right: 4px;">
                 <path d="M3.5 7L1 4.5L1.7 3.8L3.5 5.6L8.3 0.8L9 1.5L3.5 7Z"/>
               </svg>
               ДРОПСЫ ПОЛУЧЕНЫ
             </span>`
          : `<span class="category-drops-status" style="color: #9147ff; background: rgba(145, 71, 255, 0.15); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
               <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="margin-right: 4px;">
                 <circle cx="5" cy="5" r="5"/>
               </svg>
               ${cat.dropsProgressPercent !== undefined ? `DROPS ${cat.dropsProgressPercent}%` : 'DROPS ВКЛЮЧЕНЫ'}
               ${cat.dropsEndsAt ? this.formatTimeRemaining(cat.dropsEndsAt) : ''}
             </span>`
      ) : '';
      
      const isDisabled = cat.enabled === false;
      const isCompleted = cat.dropsCompleted && cat.hasDrops;
      const isAutoDrops = cat.autoDrops === true;
      
      return `
      <div class="category-item ${isDisabled ? 'disabled' : ''} ${isCompleted ? 'drops-completed' : ''}" draggable="true" data-category-id="${cat.id}">
        ${isAutoDrops ? '<div style="position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: linear-gradient(180deg, #ff9800, #ff6f00); border-radius: 8px 0 0 8px;"></div>' : ''}
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
          <div class="category-name">
            ${cat.name}
            ${isAutoDrops ? '<span style="display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; padding: 2px 6px; background: rgba(255, 152, 0, 0.15); color: #ff9800; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase;"><svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1L7.5 4.5H11L8.5 7L9.5 11L6 8.5L2.5 11L3.5 7L1 4.5H4.5L6 1Z"/></svg>AUTO</span>' : ''}
          </div>
          <div class="category-status">
            <span style="color: var(--text-secondary); font-size: 13px;">${(cat.viewersCount / 1000).toFixed(1)}K зрителей</span>
            ${tagsHtml}
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
    this.setupContextMenu();
    this.updateAutoDropsButtonState(); // Обновляем состояние кнопки автофарма
  }

  setupContextMenu() {
    const categoryItems = document.querySelectorAll('.category-item');
    categoryItems.forEach(item => {
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const categoryId = item.dataset.categoryId;
        const category = this.categories.find(c => c.id === categoryId);
        
        if (!category) return;
        
        // Удаляем старое меню если есть
        const oldMenu = document.getElementById('category-context-menu');
        if (oldMenu) oldMenu.remove();
        
        // Создаем контекстное меню
        const menu = document.createElement('div');
        menu.id = 'category-context-menu';
        menu.style.cssText = `
          position: fixed;
          left: ${e.clientX}px;
          top: ${e.clientY}px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 4px;
          z-index: 10000;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          min-width: 200px;
        `;
        
        const menuItems = [];
        
        // Если есть дропсы и они не завершены
        if (category.hasDrops && !category.dropsCompleted) {
          menuItems.push({
            icon: '✓',
            text: 'Отметить как выполненное',
            color: '#00f593',
            action: () => this.markCategoryAsCompleted(categoryId)
          });
        }
        
        // Если дропсы завершены
        if (category.dropsCompleted) {
          menuItems.push({
            icon: '↺',
            text: 'Отметить как активное',
            color: '#9147ff',
            action: () => this.markCategoryAsActive(categoryId)
          });
        }
        
        menuItems.forEach(item => {
          const btn = document.createElement('div');
          btn.style.cssText = `
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-primary);
            font-size: 14px;
            transition: background 0.2s;
          `;
          btn.innerHTML = `
            <span style="color: ${item.color}; font-weight: 700;">${item.icon}</span>
            <span>${item.text}</span>
          `;
          btn.onmouseover = () => btn.style.background = 'rgba(145,71,255,0.1)';
          btn.onmouseout = () => btn.style.background = 'transparent';
          btn.onclick = () => {
            item.action();
            menu.remove();
          };
          menu.appendChild(btn);
        });
        
        document.body.appendChild(menu);
        
        // Закрываем меню при клике вне его
        const closeMenu = (e) => {
          if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
          }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 100);
      });
    });
  }

  async markCategoryAsCompleted(categoryId) {
    const category = this.categories.find(c => c.id === categoryId);
    if (!category) return;
    
    category.dropsCompleted = true;
    category.dropsCompletedDate = new Date().toISOString();
    
    // Если это autoDrops категория - удаляем её
    if (category.autoDrops === true) {
      window.utils.showToast(`${category.name} отмечена как выполненная и удалена`, 'success');
      this.categories = this.categories.filter(c => c.id !== categoryId);
    } else {
      window.utils.showToast(`${category.name} отмечена как выполненная`, 'success');
    }
    
    await Storage.saveCategories(this.categories);
    this.renderCategories();
    
    // Если это текущая категория - переключаемся на следующую
    if (this.currentCategory && this.currentCategory.id === categoryId) {
      setTimeout(() => {
        this.switchToNextCategoryWithDrops();
      }, 1000);
    }
  }

  async markCategoryAsActive(categoryId) {
    const category = this.categories.find(c => c.id === categoryId);
    if (!category) return;
    
    category.dropsCompleted = false;
    delete category.dropsCompletedDate;
    
    await Storage.saveCategories(this.categories);
    this.renderCategories();
    
    window.utils.showToast(`${category.name} снова активна`, 'success');
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
    
    // Запускаем трекинг
    this.sessionStartTime = Date.now();
    console.log('Session started at:', new Date(this.sessionStartTime).toLocaleString(), 'isAutoStarted:', this.isAutoStarted);
    this.updateSessionInfo();
    this.sessionInterval = setInterval(() => {
      this.updateSessionInfo();
    }, 1000);
    
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
    
    // Находим следующую включенную категорию
    const enabledCategories = this.categories.filter(cat => cat.enabled && cat.id !== this.currentCategory?.id);
    
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
      return;
    }
    
    // Если включен фильтр дропсов, выбираем категорию с дропсами
    let nextCategory;
    if (this.dropsFilterEnabled) {
      nextCategory = enabledCategories.find(cat => cat.hasDrops && !cat.dropsCompleted);
      console.log('Drops filter enabled, found category with drops:', nextCategory?.name);
    }
    
    // Если не нашли или фильтр выключен, берем первую включенную
    if (!nextCategory) {
      nextCategory = enabledCategories[0];
      console.log('Using first enabled category:', nextCategory.name);
    }
    
    window.utils.showToast(`Переключение на ${nextCategory.name}...`, 'info');
    
    // Закрываем текущий стрим
    console.log('Closing current stream before switching');
    await window.electronAPI.closeStream();
    
    // Запускаем новый стрим
    setTimeout(async () => {
      console.log('Starting new stream for:', nextCategory.name);
      
      try {
        // Получаем стримы для категории
        const streams = await window.electronAPI.getStreamsWithDrops(nextCategory.name);
        
        if (!streams || streams.length === 0) {
          console.error('No streams found for category:', nextCategory.name);
          window.utils.showToast(`Нет активных стримов для ${nextCategory.name}`, 'error');
          return;
        }
        
        // Берём первый стрим
        const stream = streams[0];
        console.log('Selected stream:', stream.displayName);
        
        // Открываем стрим
        await window.electronAPI.openStream(`https://www.twitch.tv/${stream.login}`);
        
        // КРИТИЧЕСКИ ВАЖНО: обновляем UI и устанавливаем currentCategory
        this.updateCurrentStreamUI(stream, nextCategory);
        
        window.utils.showToast(`Переключено на: ${stream.displayName}`, 'success');
        console.log('Stream switched successfully, currentCategory set to:', this.currentCategory);
      } catch (error) {
        console.error('Error switching stream:', error);
        window.utils.showToast('Ошибка при переключении стрима', 'error');
      }
    }, 2000);
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
        this.categories = this.categories.filter(cat => cat.id !== categoryId);
        await Storage.saveCategories(this.categories);
        this.renderCategories();
        window.utils.showToast('Категория удалена', 'success');
      });
    });
  }

  async startFarming() {
    // Сохраняем текущее состояние isAutoStarted или устанавливаем false если не было установлено
    const wasAutoStarted = this.isAutoStarted === true;
    console.log('startFarming called, isAutoStarted =', wasAutoStarted);
    
    if (!wasAutoStarted) {
      this.isAutoStarted = false;
    }
    
    if (this.categories.length === 0) {
      window.utils.showToast('Добавьте хотя бы одну категорию', 'warning');
      return;
    }

    const accounts = await Storage.getAccounts();
    if (accounts.length === 0) {
      window.utils.showToast('Добавьте хотя бы один аккаунт', 'warning');
      return;
    }

    window.utils.showToast('Ищем стрим с дропсами...', 'info');
    
    // Находим первую включенную категорию с дропсами
    const enabledCategories = this.categories.filter(c => c.enabled !== false && c.hasDrops);
    
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
    
    this.sessionInterval = setInterval(() => {
      this.updateSessionInfo();
    }, 1000);
    
    // Загружаем и отображаем дропсы
    this.loadAndDisplayDrops(stream.login, category.name);
    
    // Показываем блок баллов
    const pointsCard = document.getElementById('channel-points-card');
    if (pointsCard) {
      pointsCard.style.display = 'block';
    }
    
    // Запускаем автосбор бонусов в фоне
    this.startBackgroundBonusCollector(stream.login);
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
      
      // Получаем дропсы для текущей игры
      const dropsData = await window.electronAPI.fetchDropsInventory();
      
      if (dropsData && dropsData.campaigns) {
        // ФИЛЬТРУЕМ дропсы - показываем ТОЛЬКО для текущей игры
        const gameCampaigns = dropsData.campaigns.filter(campaign => {
          const campaignGame = campaign.game?.name || campaign.game || '';
          return campaignGame.toLowerCase() === gameName.toLowerCase();
        });
        
        if (gameCampaigns.length > 0) {
          // Показываем дропсы для этой игры
          this.displayDropsCampaignsForGame(gameCampaigns, gameName);
        } else {
          // Нет дропсов для этой игры
          container.style.display = 'block';
          listEl.innerHTML = `
            <div style="padding: 20px; text-align: center; background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color);">
              <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 12px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" style="flex-shrink: 0;">
                  <circle cx="12" cy="12" r="10" stroke-width="2"/>
                  <path d="M12 6v6l4 2" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span style="font-size: 16px; font-weight: 600; color: var(--text-secondary);">Нет активных дропсов</span>
              </div>
              <p style="color: var(--text-secondary); font-size: 13px; margin: 0;">
                Для игры ${gameName} сейчас нет доступных дропсов
              </p>
            </div>
          `;
        }
      } else {
        // Показываем простое уведомление
        container.style.display = 'block';
        listEl.innerHTML = `
          <div style="padding: 20px; text-align: center; background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color);">
            <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 12px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00f593" style="flex-shrink: 0;">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="22 4 12 14.01 9 11.01" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span style="font-size: 16px; font-weight: 600; color: #00f593;">Дропсы активны</span>
            </div>
            <p style="color: var(--text-secondary); font-size: 13px; margin: 0;">
              Продолжайте смотреть стрим для получения дропсов<br>
              <a href="https://www.twitch.tv/drops/inventory" target="_blank" style="color: var(--accent-primary); text-decoration: none; margin-top: 8px; display: inline-block;">Проверить прогресс →</a>
            </p>
          </div>
        `;
      }
      
      console.log('Drops notification displayed');
    } catch (error) {
      console.error('Error loading drops:', error);
      this.hideDropsContainer();
    }
  }
  
  displayDropsCampaignsForGame(campaigns, gameName) {
    const container = document.getElementById('drops-progress-container');
    const listEl = document.getElementById('drops-campaigns-list');
    
    if (!container || !listEl) return;
    
    container.style.display = 'block';
    
    listEl.innerHTML = campaigns.map(campaign => {
      const drops = campaign.drops || [];
      const activeDrops = drops.filter(d => !d.claimed && d.percentage < 100);
      const completedDrops = drops.filter(d => d.claimed || d.percentage >= 100);
      
      return `
        <div style="margin-bottom: 16px; padding: 16px; background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color);">
          <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">
            ${campaign.name}
          </div>
          
          ${activeDrops.length > 0 ? `
            <div style="margin-bottom: 12px;">
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Активные:</div>
              ${activeDrops.map(drop => this.createCompactDropElement(drop)).join('')}
            </div>
          ` : ''}
          
          ${completedDrops.length > 0 ? `
            <div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Завершенные:</div>
              ${completedDrops.map(drop => this.createCompactDropElement(drop)).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }
  
  createCompactDropElement(drop) {
    const progress = drop.percentage || 0;
    const isClaimed = drop.claimed;
    const canClaim = !isClaimed && progress >= 100;
    const benefitName = drop.benefitName || drop.name || 'Награда';
    const imageUrl = drop.imageURL || '';
    
    return `
      <div style="display: flex; gap: 8px; padding: 8px; background: var(--bg-secondary); border-radius: 6px; align-items: center; margin-bottom: 6px;">
        ${imageUrl ? `<img src="${imageUrl}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; flex-shrink: 0;">` : ''}
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${benefitName}</div>
          ${!isClaimed ? `
            <div style="height: 4px; background: var(--bg-primary); border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: ${progress}%; background: linear-gradient(90deg, #9147ff, #b565ff); transition: width 0.5s ease;"></div>
            </div>
          ` : ''}
        </div>
        <div style="font-size: 11px; font-weight: 600; ${isClaimed ? 'color: #00f593;' : canClaim ? 'color: #9147ff;' : 'color: var(--text-secondary);'}">
          ${isClaimed ? '✓' : canClaim ? 'Готов' : `${Math.round(progress)}%`}
        </div>
      </div>
    `;
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
      if (!this.currentCategory || !this.currentCategory.name) return;
      
      const result = await window.electronAPI.fetchDropsInventory();
      if (!result || !result.campaigns) return;
      
      // Находим кампанию для текущей категории
      const currentCampaign = result.campaigns.find(c => 
        c.game && c.game.name && this.currentCategory.name && 
        c.game.name.toLowerCase() === this.currentCategory.name.toLowerCase()
      );
      
      const horizontal = document.getElementById('drops-progress-horizontal');
      if (!horizontal) return;
      
      if (!currentCampaign || currentCampaign.drops.length === 0) {
        horizontal.style.display = 'none';
        return;
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
      
      // Вычисляем общий прогресс как сумму процентов всех дропсов
      const totalDrops = currentCampaign.drops.length;
      let totalProgress = 0;
      currentCampaign.drops.forEach(drop => {
        const dropPercent = drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0;
        totalProgress += dropPercent;
      });
      const overallPercent = totalDrops > 0 ? Math.floor(totalProgress / totalDrops) : 0;
      const completedDrops = currentCampaign.drops.filter(d => d.claimed || d.progress >= d.required).length;
      
      // Создаем HTML для всех дропсов
      const dropsHTML = currentCampaign.drops.map((drop, index) => {
        const isCompleted = drop.claimed || drop.progress >= drop.required;
        const dropPercent = drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0;
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
            <div style="height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
              <div style="height: 100%; width: ${dropPercent}%; background: ${isCompleted ? 'linear-gradient(90deg, #00e57a, #00c06a)' : 'linear-gradient(90deg, #9147ff, #b380ff)'}; transition: width 0.5s ease;"></div>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); text-align: center;">
              ${isCompleted 
                ? `<span style="color: #00e57a; font-weight: 600;">✓ Получено</span>` 
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
        <div style="background: rgba(255, 255, 255, 0.1); height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 16px;">
          <div style="height: 100%; background: linear-gradient(90deg, #9147ff, ${overallPercent === 100 ? '#00e57a' : '#b380ff'}); width: ${overallPercent}%; transition: width 0.5s ease;"></div>
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
        
        // Если все дропсы получены, через 3 секунды переключаемся
        if (overallPercent === 100 && !this.currentCategory._switchScheduled) {
          this.currentCategory._switchScheduled = true;
          setTimeout(() => {
            this.switchToNextEnabledCategory();
          }, 3000);
        }
      }
    } catch (error) {
      console.error('Error updating drops horizontal progress:', error);
    }
  }

  async stopFarming() {
    window.utils.showToast('Фарминг остановлен', 'info');
    
    // Сохраняем сессию в статистику перед остановкой
    if (this.sessionStartTime) {
      const duration = Math.floor((Date.now() - this.sessionStartTime) / 60000); // в минутах
      
      // Подсчитываем собранные дропсы за эту сессию
      let dropsCollected = 0;
      if (this.currentCategory && this.currentCategory.dropsCompleted) {
        dropsCollected = 1; // Категория с дропсами завершена
      }
      
      const sessionData = {
        timestamp: this.sessionStartTime,
        duration: duration,
        category: this.currentCategory?.name || 'Unknown',
        channel: this.currentStream?.displayName || this.currentStream?.login || 'Unknown',
        bandwidth: this.estimatedBandwidth,
        pointsEarned: this.channelPoints.earnedThisStream || 0,
        chestsCollected: this.channelPoints.chestsCollected || 0,
        dropsCollected: dropsCollected
      };
      
      console.log('Saving session to storage:', sessionData);
      console.log('Session start time:', new Date(this.sessionStartTime).toLocaleString());
      console.log('Duration minutes:', duration);
      await Storage.addSession(sessionData);
      console.log('Session saved successfully');
    }
    
    // Сбрасываем флаг автозапуска после остановки
    this.isAutoStarted = false;
    
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
    
    // Останавливаем обновление дропсов
    if (this.dropsProgressInterval) {
      clearInterval(this.dropsProgressInterval);
      this.dropsProgressInterval = null;
    }
    // НЕ скрываем контейнер дропсов - оставляем последнее состояние видимым
    
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
    
    const durationEl = document.getElementById('session-duration');
    if (durationEl) {
      let durationText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      
      // Add "Авто" label if session was auto-started
      if (this.isAutoStarted) {
        durationText += ' <span style="color: #ff8c00; font-weight: 600; margin-left: 8px;">Авто</span>';
        console.log('Displaying Auto label, isAutoStarted =', this.isAutoStarted);
      }
      
      durationEl.innerHTML = durationText;
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
      if (this.bandwidthHistory.length > 10) {
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

  showFarmingState() {
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'flex';
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
                    }, 300);
                  }
                }, 300);
              }
            } catch(e) {
              console.error('Quality setup error:', e);
            }
          }, 2000);
        `).catch(e => console.error('Failed to inject quality script:', e));
      }, { once: true });
      
      // Сохраняем текущую категорию и стрим
      this.currentCategory = category;
      this.currentStream = stream;
      
      // Обновляем информацию о стриме
      document.getElementById('stream-channel').textContent = stream.displayName;
      document.getElementById('stream-game').textContent = `Игра: ${category.name}`;
      document.getElementById('stream-title').textContent = stream.title || 'Без названия';
      
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
          const viewersEl = document.getElementById('stream-viewers');
          if (viewersEl) {
            viewersEl.textContent = viewers.toLocaleString();
          }
          
          // Сохраняем в историю (максимум 100 значений)
          this.viewersHistory.push({
            time: Date.now(),
            count: viewers
          });
          if (this.viewersHistory.length > 100) {
            this.viewersHistory.shift();
          }
          
          // Обновляем uptime
          const uptimeEl = document.getElementById('stream-uptime');
          if (uptimeEl) {
            uptimeEl.textContent = stats.uptime || '-';
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
  
  startDropsProgressUpdate(channelLogin) {
    // Очищаем старый интервал
    if (this.dropsProgressInterval) {
      clearInterval(this.dropsProgressInterval);
    }
    
    // Обновляем сразу и каждые 30 секунд
    const updateDrops = async () => {
      try {
        const dropsData = await window.electronAPI.getDropsProgress(channelLogin);
        
        if (dropsData && dropsData.campaigns && dropsData.campaigns.length > 0) {
          this.renderDropsProgress(dropsData);
        } else {
          // Скрываем контейнер если нет дропсов
          const container = document.getElementById('drops-progress-container');
          if (container) {
            container.style.display = 'none';
          }
        }
      } catch (e) {
        console.error('Error updating drops progress:', e);
      }
    };
    
    updateDrops();
    // Отключаем старый горизонтальный блок дропсов - используем только вертикальный
    // this.updateDropsHorizontalProgress();
    this.dropsProgressInterval = setInterval(() => {
      updateDrops();
      // this.updateDropsHorizontalProgress();
    }, 30000);
  }
  
  renderDropsProgress(dropsData) {
    const container = document.getElementById('drops-progress-container');
    const campaignsList = document.getElementById('drops-campaigns-list');
    const overallProgress = document.getElementById('drops-overall-progress');
    const timeRemaining = document.getElementById('drops-time-remaining');
    
    if (!container || !campaignsList) {
      console.warn('Drops container not found');
      return;
    }
    
    // Always clear and reset first to avoid showing old data
    campaignsList.innerHTML = '';
    
    // If no data, hide container completely
    if (!dropsData || !dropsData.campaigns || dropsData.campaigns.length === 0) {
      container.style.display = 'none';
      return;
    }
    
    container.style.display = 'block';
    
    // Общий прогресс
    if (dropsData.totalProgress) {
      overallProgress.textContent = `Общий прогресс: ${dropsData.totalProgress.completed}/${dropsData.totalProgress.total} (${dropsData.totalProgress.percentage}%)`;
    }
    
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
        
        // Если это autoDrops категория - удаляем её из списка
        if (category.autoDrops === true) {
          window.utils.showToast(`Все дропсы получены для ${category.name}! Категория удалена.`, 'success');
          
          // Удаляем категорию
          this.categories = this.categories.filter(c => c.id !== category.id);
          Storage.saveCategories(this.categories);
          this.renderCategories();
          
          // Переключаемся на следующую категорию
          setTimeout(() => {
            this.switchToNextCategoryWithDrops();
          }, 3000);
        } else {
          // Обычная категория - просто сохраняем и показываем уведомление
          Storage.saveCategories(this.categories);
          window.utils.showToast(`Все дропсы получены для ${category.name}!`, 'success');
          
          // Переключаемся на следующую категорию
          setTimeout(() => {
            this.switchToNextCategoryWithDrops();
          }, 5000);
        }
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
  
  destroy() {
    console.log('Destroying FarmingPage instance...');
    
    // Останавливаем все таймеры
    if (this.updateInterval) clearInterval(this.updateInterval);
    if (this.sessionInterval) clearInterval(this.sessionInterval);
    if (this.streamStatsInterval) clearInterval(this.streamStatsInterval);
    if (this.dropsProgressInterval) clearInterval(this.dropsProgressInterval);
    
    // Удаляем все обработчики событий
    this.eventListeners.forEach(({element, event, handler}) => {
      if (element && element.removeEventListener) {
        element.removeEventListener(event, handler);
      }
    });
    this.eventListeners = [];
    
    this.isInitialized = false;
    console.log('FarmingPage destroyed');
  }
  
  setupViewersChart() {
    const viewersEl = document.getElementById('stream-viewers');
    const canvas = document.getElementById('viewers-chart');
    
    if (!viewersEl || !canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    viewersEl.addEventListener('mouseenter', () => {
      canvas.style.display = 'block';
      this.drawViewersChart(ctx);
    });
    
    viewersEl.addEventListener('mousemove', (e) => {
      canvas.style.left = (e.clientX + 15) + 'px';
      canvas.style.top = (e.clientY - 60) + 'px';
      this.drawViewersChart(ctx);
    });
    
    viewersEl.addEventListener('mouseleave', () => {
      canvas.style.display = 'none';
    });
  }
  
  drawViewersChart(ctx) {
    if (this.viewersHistory.length < 2) return;
    
    const canvas = ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const padding = 30;
    
    // Очищаем canvas
    ctx.clearRect(0, 0, width, height);
    
    // Находим мин/макс
    const values = this.viewersHistory.map(h => h.count);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    // Функция для получения координат точки
    const getPoint = (i) => {
      const x = padding + (i / (this.viewersHistory.length - 1)) * (width - padding * 2);
      const y = height - padding - ((this.viewersHistory[i].count - min) / range) * (height - padding * 2);
      return { x, y };
    };
    
    // Создаем градиент для заливки
    const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, 'rgba(145, 71, 255, 0.35)');
    gradient.addColorStop(0.6, 'rgba(145, 71, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(145, 71, 255, 0.02)');
    
    // Заливка под графиком с плавными кривыми
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    
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
    
    ctx.lineTo(width - padding, height - padding);
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
    
    // Текст с значениями
    ctx.fillStyle = '#fff';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Макс: ${max.toLocaleString()}`, 12, 20);
    ctx.fillText(`Мин: ${min.toLocaleString()}`, 12, height - 12);
    
    // Заголовок
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Динамика зрителей', width / 2, 20);
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
      
      const player = document.getElementById('twitch-player');
      if (player) {
        player.src = `https://player.twitch.tv/?channel=${stream.login}&parent=localhost&muted=true`;
      }
      
      // Обновляем чат если он открыт
      const chatContainer = document.getElementById('twitch-chat-container');
      const chatWebview = document.getElementById('twitch-chat');
      if (chatContainer && chatContainer.style.display !== 'none' && chatWebview) {
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
      
      const player = document.getElementById('twitch-player');
      if (player) {
        player.src = `https://player.twitch.tv/?channel=${stream.login}&parent=localhost&muted=true`;
        this.setupMatureContentAutoClick(player);
      }
      
      // Обновляем чат если он открыт
      const chatContainer = document.getElementById('twitch-chat-container');
      const chatWebview = document.getElementById('twitch-chat');
      if (chatContainer && chatContainer.style.display !== 'none' && chatWebview) {
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
    // Check if we have a current stream (either active session or restored state)
    if (!this.currentStream) {
      window.utils.showToast('Нет активного стрима', 'warning');
      return;
    }

    const chatContainer = document.getElementById('twitch-chat-container');
    const chatWebview = document.getElementById('twitch-chat');
    const grid = document.getElementById('player-chat-grid');
    
    if (!chatContainer || !chatWebview || !grid) {
      window.utils.showToast('Чат не найден', 'error');
      return;
    }

    const channel = this.currentStream.login;
    
    // Переключаем видимость чата
    if (chatContainer.style.display === 'none') {
      // Показываем чат с анимацией (чат уже загружен в фоне)
      // Если src пустой, загружаем чат
      if (!chatWebview.src) {
        chatWebview.src = `https://www.twitch.tv/embed/${channel}/chat?parent=localhost&darkpopout`;
      }
      
      chatContainer.style.display = 'block';
      grid.style.gridTemplateColumns = '1fr 340px'; // Плеер + Чат
      
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
    
    // Переключаем плеер (используем player.twitch.tv без чата)
    player.src = `https://player.twitch.tv/?channel=${stream.login}&parent=localhost&muted=true`;
    this.setupMatureContentAutoClick(player);
    
    // Обновляем чат если он открыт
    const chatContainer = document.getElementById('twitch-chat-container');
    const chatWebview = document.getElementById('twitch-chat');
    if (chatContainer && chatContainer.style.display !== 'none' && chatWebview) {
      chatWebview.src = `https://www.twitch.tv/embed/${stream.login}/chat?parent=localhost&darkpopout`;
    }
    
    // Обновляем информацию о стриме
    this.updateCurrentStreamUI(stream, this.currentCategory);
    
    // Обновляем статистику
    this.startStreamStatsUpdate(stream.login);
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
      
      if (result && !result.error && result.points > 0) {
        const newTotal = result.points;
        
        // Если это первое значение, просто сохраняем
        if (this.channelPoints.startTotal === 0 && this.channelPoints.currentTotal === 0) {
          this.channelPoints.startTotal = newTotal;
          this.channelPoints.currentTotal = newTotal;
          console.log('Initial channel points:', newTotal);
        } else if (newTotal !== this.channelPoints.currentTotal) {
          // Вычисляем разницу для этого обновления
          const pointsDiff = newTotal - this.channelPoints.currentTotal;
          
          // Обновляем текущее значение
          this.channelPoints.currentTotal = newTotal;
          const earnedSinceStart = newTotal - this.channelPoints.startTotal;
          this.channelPoints.earnedThisStream = Math.max(0, earnedSinceStart);
          
          // Определяем тип начисления
          if (pointsDiff >= 45 && pointsDiff <= 55) {
            // Сундук дает ~50 баллов
            this.channelPoints.chestsCollected++;
            this.channelPoints.chestsPoints += pointsDiff;
            console.log('Bonus chest detected! +', pointsDiff, 'Total chests:', this.channelPoints.chestsCollected);
          } else if (pointsDiff > 0) {
            // Пассивные баллы за просмотр (обычно 10 каждые 5 минут)
            this.channelPoints.passiveEarned += pointsDiff;
            console.log('Passive points earned:', pointsDiff);
          }
          
          console.log('Channel points updated:', {
            total: newTotal,
            earned: this.channelPoints.earnedThisStream,
            passive: this.channelPoints.passiveEarned,
            chestsPoints: this.channelPoints.chestsPoints
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
      if (this.channelPoints.passiveEarned > 0) {
        passiveEl.textContent = `+${this.channelPoints.passiveEarned.toLocaleString()}`;
      } else {
        passiveEl.textContent = '-';
      }
    }
    
    // Обновляем сундуки
    const chestsCount = document.getElementById('bonus-chests-count');
    const chestsPoints = document.getElementById('bonus-chests-points');
    
    if (chestsCount) {
      chestsCount.textContent = this.channelPoints.chestsCollected || 0;
    }
    
    if (chestsPoints) {
      const chestPointsValue = this.channelPoints.chestsPoints || 0;
      chestsPoints.textContent = chestPointsValue > 0 ? `+${chestPointsValue} баллов` : '-';
    }
  }
  
  // Проверка состояния трансляции
  startStreamHealthCheck() {
    // Останавливаем предыдущий интервал если есть
    if (this.streamHealthCheckInterval) {
      clearInterval(this.streamHealthCheckInterval);
    }
    
    // Проверяем каждые 30 секунд
    this.streamHealthCheckInterval = setInterval(async () => {
      if (!this.currentStream || !this.currentCategory) return;
      
      try {
        // Проверяем что webview все еще загружен и работает
        const webviews = document.querySelectorAll('webview[partition="persist:twitch"]');
        let isStreamActive = false;
        
        for (const webview of webviews) {
          if (webview && webview.src && webview.src.includes('twitch.tv')) {
            // Проверяем что страница не показывает ошибку
            try {
              const pageTitle = await webview.executeJavaScript('document.title');
              if (pageTitle && !pageTitle.includes('Error') && !pageTitle.includes('404')) {
                isStreamActive = true;
                break;
              }
            } catch (e) {
              console.log('Error checking webview:', e);
            }
          }
        }
        
        // Если трансляция не активна, пробуем перезапустить
        if (!isStreamActive) {
          console.log('Stream seems inactive, attempting restart...');
          window.utils.showToast('Обнаружена проблема с трансляцией, перезапуск...', 'warning');
          
          // Сохраняем текущую категорию и аккаунт
          const category = this.currentCategory;
          const accounts = await Storage.getAccounts();
          
          if (!category || accounts.length === 0) {
            console.error('Cannot restart - no category or account');
            return;
          }
          
          // Закрываем текущий стрим
          await window.electronAPI.closeStream();
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Получаем новый список стримов
          const streams = await window.electronAPI.getStreamsWithDrops(category.name);
          
          if (!streams || streams.length === 0) {
            window.utils.showToast(`Нет доступных стримов для ${category.name}`, 'error');
            return;
          }
          
          // Запускаем новый стрим
          const stream = streams[0];
          const streamUrl = `https://www.twitch.tv/${stream.login}`;
          
          console.log('Restarting stream:', stream.displayName);
          
          // Открываем стрим
          await window.electronAPI.openStream(streamUrl, accounts[0]);
          
          // Обновляем текущий стрим
          this.currentStream = stream;
          
          // Обновляем UI
          this.updateCurrentStreamUI(stream, category);
          
          // Перезапускаем автосбор
          this.startBackgroundBonusCollector(stream.login);
          
          window.utils.showToast(`Трансляция перезапущена: ${stream.displayName}`, 'success');
        }
      } catch (error) {
        console.error('Error in stream health check:', error);
      }
    }, 30000); // Каждые 30 секунд
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
}

// Export to window
window.FarmingPage = FarmingPage;
