class SubscriptionsPage {
  constructor() {
    this.subscriptions = [];
    this.filteredSubscriptions = [];
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.currentView = 'list';
    this.subscriptionStats = {
      total: 0,
      withDrops: 0,
      active: 0,
      inactive: 0
    };
    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.loadSubscriptions();
  }

  setupEventListeners() {
    // Фильтры
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.applyFilter();
      });
    });

    // Кнопки управления
    document.getElementById('refresh-subs-btn')?.addEventListener('click', () => this.refreshSubscriptions());
    document.getElementById('cleanup-subs-btn')?.addEventListener('click', () => this.cleanupInactive());
    document.getElementById('priority-subs-toggle')?.addEventListener('change', (e) => this.savePrioritySetting(e.target.checked));

    // Поиск
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.applyFilter();
    });

    // Переключатель вида
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentView = btn.dataset.view;
        this.updateViewMode();
      });
    });

    // Авторизация
    document.getElementById('subscriptions-auth-btn')?.addEventListener('click', () => {
      window.router?.switchPage('accounts');
    });

    // Модальное окно
    document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('channel-detail-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'channel-detail-modal') this.closeModal();
    });
  }

  async loadSubscriptions() {
    try {
      const accounts = await Storage.getAccounts();
      if (!accounts || accounts.length === 0) {
        this.showAuthSection();
        return;
      }

      const account = accounts[0];
      let oauthData = null;
      try {
        oauthData = await window.electronAPI.getOAuthUser?.();
      } catch (e) {
        console.warn('Failed to get OAuth data:', e);
      }

      if (oauthData?.accessToken) {
        const tokenChanged = oauthData.accessToken !== account.accessToken;
        const refreshChanged = oauthData.refreshToken && oauthData.refreshToken !== account.refreshToken;

        if (tokenChanged || refreshChanged) {
          account.accessToken = oauthData.accessToken;
          if (oauthData.refreshToken) {
            account.refreshToken = oauthData.refreshToken;
          }
          await Storage.saveAccount(account);
        }
      }
      console.log('[Subscriptions] Account found:', account?.username);
      console.log('[Subscriptions] Account has accessToken:', !!account?.accessToken);
      console.log('[Subscriptions] Token value:', account?.accessToken ? account.accessToken.substring(0, 20) + '...' : 'NONE');

      if (!account.accessToken) {
        console.log('[Subscriptions] No token found, showing auth section');
        this.showAuthSection();
        return;
      }

      this.showContentSection();
      this.showLoadingState();

      // Загружаем подписки
      console.log('[Subscriptions] Fetching subscriptions...');

      const fetchPromise = window.electronAPI.getUserSubscriptions(account.accessToken);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API timeout after 10 seconds')), 10000);
      });

      this.subscriptions = await Promise.race([fetchPromise, timeoutPromise]);
      console.log('[Subscriptions] Loaded:', this.subscriptions?.length, 'subscriptions');

      // Загружаем сохраненные данные о подписках
      const savedSubs = await Storage.getSubscriptions();

      // Мержим данные
      this.subscriptions = this.subscriptions.map(sub => {
        const saved = savedSubs?.find(s => s.id === sub.id) || {};
        return {
          ...sub,
          ...saved,
          lastSeen: saved.lastSeen || new Date().toISOString(),
          rating: this.calculateRating(sub, saved),
          recommended: this.shouldRecommendUnsubscribe(sub, saved)
        };
      });

      // Сохраняем
      await Storage.saveSubscriptions(this.subscriptions);

      // Загружаем доп данные (картинки, фолловеры, стримы) в фоне для каждого канала
      console.log('[Subscriptions] Loading channel details in background...');
      console.log('[Subscriptions] electronAPI available?', !!window.electronAPI);
      console.log('[Subscriptions] getChannelDetails available?', !!window.electronAPI?.getChannelDetails);

      try {
        const account = accounts[0];
        if (!account) {
          console.error('[Subscriptions] No account found!');
          return;
        }

        console.log(`[Subscriptions] Account: ${account.login}, Token: ${account.accessToken?.substring(0, 20)}...`);

        this.subscriptions.forEach((sub, idx) => {
          console.log(`[Subscriptions] ${idx + 1}/${this.subscriptions.length} Calling getChannelDetails for ${sub.login}`);

          if (!window.electronAPI?.getChannelDetails) {
            console.error('[Subscriptions] getChannelDetails is not available!');
            return;
          }

          window.electronAPI.getChannelDetails(account.accessToken, sub.login)
            .then(details => {
              console.log(`[Subscriptions] Received details for ${sub.login}:`, details);
              if (!details) {
                console.log(`[Subscriptions] Details is null for ${sub.login}`);
                return;
              }

              // Обновляем данные
              if (details.profileImageUrl) sub.profileImageUrl = details.profileImageUrl;
              if (details.description) sub.description = details.description;
              if (details.followers >= 0) sub.followers = details.followers;
              if (details.lastStreamDate) sub.lastStreamDate = details.lastStreamDate;
              if (details.isLive !== undefined) sub.isLive = details.isLive;

              // Пересчитываем рейтинг
              sub.rating = this.calculateRating(sub);

              console.log(`[Subscriptions] Updated ${sub.login}: followers=${details.followers}, date=${details.lastStreamDate}, isLive=${details.isLive}`);

              // Обновляем в DOM
              this.updateChannelCard(sub);
            })
            .catch(e => {
              console.error(`[Subscriptions] ERROR loading ${sub.login}:`, e);
              console.error('Stack:', e.stack);
            });
        });
      } catch (e) {
        console.error('[Subscriptions] Error in background loading:', e);
        console.error('Stack:', e.stack);
      }

      this.updateStats();
      this.applyFilter();
      this.loadPrioritySetting();
    } catch (error) {
      console.error('Error loading subscriptions:', error);
      window.utils.showToast('Ошибка загрузки подписок', 'error');
      this.hideLoadingState();
      this.showEmptyState();
    }
  }

  calculateRating(subscription, saved = {}) {
    let rating = 0;
    let score = 50; // базовый балл

    // Частота стримов (вес: 30%)
    const streamFrequency = subscription.streamFrequency || 0; // стримов в неделю
    score += Math.min(streamFrequency * 10, 30);

    // Регулярность (вес: 25%)
    const consistency = subscription.consistency || 0; // 0-100
    score += (consistency / 100) * 25;

    // Количество фолловеров (вес: 20%)
    const followers = subscription.followers || 0;
    if (followers > 50000) score += 20;
    else if (followers > 10000) score += 15;
    else if (followers > 1000) score += 10;

    // Время последнего стрима (вес: 15%)
    const lastStreamDate = new Date(subscription.lastStreamDate || 0);
    const daysSinceStream = (Date.now() - lastStreamDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceStream < 7) score += 15;
    else if (daysSinceStream < 14) score += 10;
    else if (daysSinceStream < 30) score += 5;

    // Наличие дропсов (бонус: 10%)
    if (subscription.hasDrops) score += 10;

    // Язык трансляции (бонус для предпочитаемых языков)
    if (subscription.language === 'ru') score += 5;

    rating = Math.min(100, Math.max(0, score));
    // Добавляем небольшую случайную вариацию чтобы рейтинги не были кратны 5
    const variation = (subscription.id?.charCodeAt(0) || 0) % 5;
    return Math.round(rating + variation);
  }

  shouldRecommendUnsubscribe(subscription, saved = {}) {
    const lastStreamDate = new Date(subscription.lastStreamDate || 0);
    const daysSinceStream = (Date.now() - lastStreamDate.getTime()) / (1000 * 60 * 60 * 24);

    // Рекомендуем отписаться если:
    // 1. Не стримил более 90 дней
    // 2. Рейтинг очень низкий (< 20)
    // 3. Есть дропсы но регулярность низкая

    return daysSinceStream > 90 || this.calculateRating(subscription, saved) < 20;
  }

  updateStats() {
    this.subscriptionStats = {
      total: this.subscriptions.length,
      withDrops: this.subscriptions.filter(s => s.hasDrops).length,
      active: this.subscriptions.filter(s => this.isChannelActive(s)).length,
      inactive: this.subscriptions.filter(s => !this.isChannelActive(s)).length
    };

    document.getElementById('subs-count').textContent = `${this.subscriptionStats.total} подписок`;
  }

  isChannelActive(subscription) {
    if (subscription.isLive !== undefined) return subscription.isLive === true;
    return false;
  }

  applyFilter() {
    let filtered = this.subscriptions;

    // Применяем фильтр
    switch (this.currentFilter) {
      case 'active':
        filtered = this.subscriptions.filter(s => this.isChannelActive(s));
        break;
      case 'with-drops':
        filtered = this.subscriptions.filter(s => s.hasDrops);
        break;
      case 'inactive':
        filtered = this.subscriptions.filter(s => !this.isChannelActive(s));
        break;
      case 'favorites':
        filtered = this.subscriptions.filter(s => s.isFavorite);
        break;
    }

    // Применяем поиск
    if (this.searchQuery) {
      filtered = filtered.filter(s =>
        s.displayName?.toLowerCase().includes(this.searchQuery) ||
        s.loginName?.toLowerCase().includes(this.searchQuery)
      );
    }

    // Сортируем: избранные вверху, потом по рейтингу
    this.filteredSubscriptions = filtered.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return b.rating - a.rating;
    });

    this.renderSubscriptions();
  }

  renderSubscriptions() {
    const list = document.getElementById('subscriptions-list');
    const empty = document.getElementById('subscriptions-empty');
    const loading = document.getElementById('subscriptions-loading');

    if (!list) return;

    // Скрываем loading
    if (loading) loading.style.display = 'none';

    if (this.filteredSubscriptions.length === 0) {
      list.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'grid';
    empty.style.display = 'none';

    // Разделяем на избранные и обычные
    const favorites = this.filteredSubscriptions.filter(s => s.isFavorite);
    const regular = this.filteredSubscriptions.filter(s => !s.isFavorite);

    let html = '';
    if (favorites.length > 0) {
      html += favorites.map(sub => this.renderSubscriptionItem(sub)).join('');
      if (regular.length > 0) {
        html += '<div class="subscriptions-divider"><span>Остальные каналы</span></div>';
      }
    }
    html += regular.map(sub => this.renderSubscriptionItem(sub)).join('');

    list.innerHTML = html;

    // Добавляем event listeners
    this.filteredSubscriptions.forEach(sub => {
      const item = list.querySelector(`[data-channel-id="${sub.id}"]`);
      if (item) {
        // Drag and drop
        item.draggable = true;
        item.addEventListener('dragstart', (e) => this.handleDragStart(e, sub));
        item.addEventListener('dragend', (e) => this.handleDragEnd(e));
        item.addEventListener('dragover', (e) => this.handleDragOver(e));
        item.addEventListener('drop', (e) => this.handleDrop(e, sub));
        item.addEventListener('dragleave', (e) => this.handleDragLeave(e));

        item.addEventListener('click', (e) => {
          if (!e.target.closest('.subscription-action-btn')) {
            this.showChannelDetails(sub);
          }
        });

        // Кнопка отписки
        const unsubBtn = item.querySelector('.unsub-btn');
        if (unsubBtn) {
          unsubBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.unsubscribeChannel(sub);
          });
        }

        // Кнопка просмотра на Twitch
        const twitchBtn = item.querySelector('.twitch-btn');
        if (twitchBtn) {
          twitchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.electronAPI.openExternal(`https://www.twitch.tv/${sub.login}`);
          });
        }

        // Кнопка старта фарминга
        const farmBtn = item.querySelector('.farm-btn');
        if (farmBtn) {
          farmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.startFarmingChannel(sub);
          });
        }

        // Кнопка избранного
        const favoriteBtn = item.querySelector('.favorite-btn');
        if (favoriteBtn) {
          favoriteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.toggleFavorite(sub);
          });
        }
      }
    });
  }

  renderSubscriptionItem(sub) {
    const ratingColor = sub.rating >= 70 ? 'good' : sub.rating >= 40 ? 'neutral' : 'bad';
    const lastStreamText = this.getLastStreamText(sub.lastStreamDate);
    const isLive = sub.isLive === true;
    const ratingText = sub.rating >= 70 ? 'Отличный рейтинг' : sub.rating >= 40 ? 'Средний рейтинг' : 'Низкий рейтинг';
    const isFavorite = sub.isFavorite || false;
    const gameName = sub.gameName || '';
    const gameImageUrl = sub.gameImageUrl || '';

    return `
      <div class="subscription-card ${isFavorite ? 'favorite' : ''}" data-channel-id="${sub.id}">
        <div class="subscription-card-main">
          <div class="subscription-card-left">
            <div class="subscription-card-avatar-wrapper" style="background-image: url('${sub.profileImageUrl || ''}');">
              <img src="${sub.profileImageUrl || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22%3E%3Crect fill=%22%234a3f9f%22 width=%2248%22 height=%2248%22/%3E%3Ctext x=%2224%22 y=%2235%22 font-size=%2230%22 fill=%22white%22 text-anchor=%22middle%22%3E?%3C/text%3E%3C/svg%3E'}" 
                   alt="${sub.displayName}" 
                   class="subscription-card-avatar">
              ${isLive ? '<div class="subscription-card-live-indicator"></div>' : ''}
              
              <div class="subscription-card-rating ${ratingColor}" title="${ratingText}: ${Math.round(sub.rating)}/100 (качество канала для фарминга)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  ${sub.rating >= 70 ? '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>' :
        sub.rating >= 40 ? '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>' :
          '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>'}
                </svg>
                <span>${Math.round(sub.rating)}</span>
              </div>
              
              <div class="subscription-card-status-overlay ${isLive ? 'live' : 'offline'}">
                <span class="status-dot"></span>
                <span class="status-text">${isLive ? 'В эфире' : 'Офлайн'}</span>
              </div>
              
              <div class="subscription-card-stats-overlay">
                <div class="subscription-stat">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <span>${this.formatFollowers(sub.followers || 0)}</span>
                </div>
                <div class="subscription-stat">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>${lastStreamText}</span>
                </div>
              </div>
            </div>
            
            <div class="subscription-card-info">
              <div class="subscription-card-name-line">
                <span class="subscription-card-name">${sub.displayName}</span>
                <div class="subscription-card-rating-inline ${ratingColor}" title="${ratingText}: ${Math.round(sub.rating)}/100">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    ${sub.rating >= 70 ? '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>' :
        sub.rating >= 40 ? '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>' :
          '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>'}
                  </svg>
                  <span>${Math.round(sub.rating)}</span>
                </div>
              </div>
              <div class="subscription-card-status ${isLive ? 'live' : 'offline'}">
                <span class="status-dot"></span>
                <span class="status-text">${isLive ? 'В эфире' : 'Офлайн'}</span>
                ${isLive && gameName ? `<span class="game-name">${gameName}</span>` : ''}
              </div>
              <div class="subscription-card-mini-stats">
                <div class="mini-stat">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <span>${this.formatFollowers(sub.followers || 0)}</span>
                </div>
                <span class="mini-stat-separator">•</span>
                <div class="mini-stat">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>${lastStreamText}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="subscription-card-right">
            <div class="subscription-card-stats">
              <div class="subscription-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span>${this.formatFollowers(sub.followers || 0)}</span>
              </div>
              
              <div class="subscription-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>${lastStreamText}</span>
              </div>
            </div>
            
            <div class="subscription-card-actions">
              <button class="subscription-action-btn favorite-btn ${isFavorite ? 'active' : ''}" title="${isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </button>
              <button class="subscription-action-btn twitch-btn" title="Открыть на Twitch">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
                </svg>
              </button>
              <button class="subscription-action-btn farm-btn" title="Начать фарм">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                </svg>
              </button>
              <button class="subscription-action-btn unsub-btn" title="Отписаться">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  formatFollowers(count) {
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
    return count.toString();
  }

  updateChannelCard(sub) {
    const cardElement = document.querySelector(`[data-channel-id="${sub.id}"]`);
    if (!cardElement) return;

    // Обновляем аватарку
    const img = cardElement.querySelector('.subscription-card-avatar');
    if (img && sub.profileImageUrl) {
      img.src = sub.profileImageUrl;
    }

    // Обновляем статус
    const isLive = sub.isLive === true;
    const statusEl = cardElement.querySelector('.subscription-card-status');
    if (statusEl) {
      statusEl.className = `subscription-card-status ${isLive ? 'live' : 'offline'}`;
      const statusText = statusEl.querySelector('.status-text');
      if (statusText) {
        statusText.textContent = isLive ? 'В эфире' : 'Офлайн';
      }
    }

    // Обновляем индикатор в эфире
    const avatarWrapper = cardElement.querySelector('.subscription-card-avatar-wrapper');
    const liveIndicator = avatarWrapper?.querySelector('.subscription-card-live-indicator');
    if (isLive && !liveIndicator) {
      avatarWrapper.insertAdjacentHTML('beforeend', '<div class="subscription-card-live-indicator"></div>');
    } else if (!isLive && liveIndicator) {
      liveIndicator.remove();
    }

    // Обновляем статистику
    const statsEl = cardElement.querySelector('.subscription-card-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="subscription-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span>${this.formatFollowers(sub.followers || 0)}</span>
        </div>
        
        <div class="subscription-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>${this.getLastStreamText(sub.lastStreamDate)}</span>
        </div>
      `;
    }

    // Обновляем рейтинг
    const ratingEl = cardElement.querySelector('.subscription-card-rating');
    if (ratingEl) {
      const ratingColor = sub.rating >= 70 ? 'good' : sub.rating >= 40 ? 'neutral' : 'bad';
      const ratingText = sub.rating >= 70 ? 'Отличный рейтинг' : sub.rating >= 40 ? 'Средний рейтинг' : 'Низкий рейтинг';
      ratingEl.className = `subscription-card-rating ${ratingColor}`;
      ratingEl.title = `${ratingText}: ${Math.round(sub.rating)}/100 (качество канала для фарминга)`;
      const ratingValue = ratingEl.querySelector('span');
      if (ratingValue) {
        ratingValue.textContent = Math.round(sub.rating);
      }
    }
  }

  getLastStreamText(lastStreamDate) {
    if (!lastStreamDate) return 'Никогда';

    const date = new Date(lastStreamDate);
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Сегодня';
    if (days === 1) return 'Вчера';
    if (days < 7) return `${days} дней назад`;
    if (days < 30) return `${Math.floor(days / 7)} недель назад`;
    if (days < 365) return `${Math.floor(days / 30)} месяцев назад`;
    return `${Math.floor(days / 365)} лет назад`;
  }

  showChannelDetails(sub) {
    const modal = document.getElementById('channel-detail-modal');
    const content = document.getElementById('modal-content');

    const lastStreamDate = new Date(sub.lastStreamDate || 0);
    const daysSinceStream = (Date.now() - lastStreamDate.getTime()) / (1000 * 60 * 60 * 24);
    const isLive = sub.isLive === true;
    const ratingColor = sub.rating >= 70 ? '#00e57a' : sub.rating >= 40 ? '#9147ff' : '#ff6b6b';
    const activityStatus = daysSinceStream > 30 ? 'Неактивен' : daysSinceStream > 7 ? 'Редко' : 'Активен';
    const activityIcon = daysSinceStream > 30 ? '🔴' : daysSinceStream > 7 ? '🟡' : '🟢';
    const activityColor = daysSinceStream > 30 ? '#ff6b6b' : daysSinceStream > 7 ? '#ffaa00' : '#00e57a';

    content.innerHTML = `
      <div style="position: relative; margin-bottom: 20px;">
        <div style="position: absolute; top: 0; left: 0; right: 0; height: 120px; background-image: url('${sub.profileImageUrl || ''}'); background-size: cover; background-position: center; filter: blur(40px); opacity: 0.3; border-radius: 8px;"></div>
        <div style="position: relative; text-align: center; padding: 20px 0;">
          <div style="position: relative; display: inline-block;">
            <img src="${sub.profileImageUrl || ''}" alt="${sub.displayName}" style="width: 100px; height: 100px; border-radius: 50%; border: 4px solid var(--bg-primary); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);">
            ${isLive ? '<div style="position: absolute; bottom: 5px; right: 5px; width: 20px; height: 20px; background: #ff0000; border: 3px solid var(--bg-primary); border-radius: 50%; box-shadow: 0 0 10px rgba(255, 0, 0, 0.8);"></div>' : ''}
          </div>
          <h2 style="color: var(--text-primary); font-size: 24px; font-weight: 700; margin: 12px 0 4px;">${sub.displayName}</h2>
          <p style="color: var(--text-secondary); font-size: 14px; margin: 0 0 8px;">@${sub.login}</p>
          ${sub.description ? `
          <div style="max-width: 400px; margin: 0 auto 12px;">
            <p id="channel-description" style="color: var(--text-secondary); font-size: 13px; line-height: 1.4; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${sub.description}</p>
            <button id="show-more-desc" style="display: none; background: none; border: none; color: var(--accent-color); font-size: 12px; cursor: pointer; margin: 4px auto 0; padding: 0;"></button>
          </div>` : ''}
          ${isLive ? `<div style="display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 4px 12px; background: rgba(255, 0, 0, 0.15); border: 1px solid rgba(255, 0, 0, 0.3); border-radius: 20px; font-size: 12px; font-weight: 600; color: #ff4444;">
            <span style="width: 8px; height: 8px; background: #ff0000; border-radius: 50%; animation: pulse-live 2s ease-in-out infinite;"></span>
            <span>В эфире</span>
            ${sub.gameName ? `<span style="opacity: 0.7;">• ${sub.gameName}</span>` : ''}
          </div>` : ''}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
        <div style="padding: 16px; background: linear-gradient(135deg, rgba(0, 229, 122, 0.1) 0%, rgba(0, 229, 122, 0.05) 100%); border: 1px solid rgba(0, 229, 122, 0.2); border-radius: 10px; text-align: center;">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Рейтинг</div>
          <div style="font-size: 24px; font-weight: 700; color: ${ratingColor};">
            ${Math.round(sub.rating)}
          </div>
          <div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">${sub.rating >= 70 ? 'Отличный' : sub.rating >= 40 ? 'Средний' : 'Низкий'}</div>
        </div>
        
        <div style="padding: 16px; background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 10px; text-align: center;">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Фолловеров</div>
          <div style="font-size: 24px; font-weight: 700; color: var(--accent-color);">${this.formatFollowers(sub.followers || 0)}</div>
          <div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">${(sub.followers || 0).toLocaleString()}</div>
        </div>
        
        <div style="padding: 16px; background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(168, 85, 247, 0.05) 100%); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 10px; text-align: center;">
          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Активность</div>
          <div style="font-size: 20px; margin-bottom: 2px;">${activityIcon}</div>
          <div style="font-size: 13px; font-weight: 600; color: ${activityColor};">${activityStatus}</div>
        </div>
      </div>

      <div style="padding: 16px; background: var(--bg-secondary); border-radius: 10px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary);">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <div style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Последний стрим</div>
        </div>
        <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${this.getLastStreamText(sub.lastStreamDate)}</div>
      </div>

      ${sub.hasDrops ? '<div style="padding: 16px; background: linear-gradient(135deg, rgba(145, 71, 255, 0.15) 0%, rgba(145, 71, 255, 0.05) 100%); border: 1px solid rgba(145, 71, 255, 0.3); border-radius: 10px; display: flex; align-items: center; gap: 12px; margin-bottom: 16px;"><div style="font-size: 24px;">💎</div><div><div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">Доступны дропсы</div><div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">На канале можно получить награды</div></div></div>' : ''}

      <div style="display: flex; gap: 10px;">
        <button class="modal-btn modal-btn-primary" id="farm-channel-detail-btn" style="flex: 1; padding: 12px; background: linear-gradient(135deg, var(--accent-color) 0%, #7c3aed 100%); border: none; border-radius: 8px; color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(145, 71, 255, 0.3);">
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
            </svg>
            <span>Начать фарминг</span>
          </div>
        </button>
        <button class="modal-btn modal-btn-secondary" id="view-twitch-btn" style="padding: 12px 16px; background: rgba(145, 71, 255, 0.1); border: 1px solid rgba(145, 71, 255, 0.3); border-radius: 8px; color: var(--accent-color); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
          </svg>
        </button>
        <button class="modal-btn modal-btn-danger" id="unsub-channel-detail-btn" style="padding: 12px 16px; background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 8px; color: #ff6b6b; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    `;

    document.getElementById('farm-channel-detail-btn')?.addEventListener('click', () => {
      this.startFarmingChannel(sub);
      this.closeModal();
    });

    document.getElementById('view-twitch-btn')?.addEventListener('click', () => {
      window.electronAPI.openExternal(`https://www.twitch.tv/${sub.login}`);
    });

    document.getElementById('unsub-channel-detail-btn')?.addEventListener('click', () => {
      this.unsubscribeChannel(sub);
      this.closeModal();
    });

    // Добавляем стили для кнопок при наведении
    const style = document.createElement('style');
    style.textContent = `
      .modal-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
      .modal-btn-primary:hover {
        box-shadow: 0 4px 16px rgba(145, 71, 255, 0.5) !important;
      }
      .modal-btn-secondary:hover {
        background: rgba(145, 71, 255, 0.2);
      }
      .modal-btn-danger:hover {
        background: rgba(255, 107, 107, 0.2);
      }
    `;
    if (!document.getElementById('modal-btn-styles')) {
      style.id = 'modal-btn-styles';
      document.head.appendChild(style);
    }

    // Проверяем, нужна ли кнопка "Показать больше" для описания
    if (sub.description) {
      setTimeout(() => {
        const descElement = document.getElementById('channel-description');
        const btnElement = document.getElementById('show-more-desc');

        if (descElement && btnElement) {
          // Проверяем, переполнен ли текст (есть ли обрезка)
          const isOverflowing = descElement.scrollWidth > descElement.clientWidth;

          if (isOverflowing) {
            btnElement.style.display = 'block';
            btnElement.textContent = 'Показать больше';

            btnElement.onclick = () => {
              if (descElement.style.whiteSpace === 'nowrap') {
                descElement.style.whiteSpace = 'normal';
                descElement.style.overflow = 'visible';
                btnElement.textContent = 'Скрыть';
              } else {
                descElement.style.whiteSpace = 'nowrap';
                descElement.style.overflow = 'hidden';
                btnElement.textContent = 'Показать больше';
              }
            };
          }
        }
      }, 100);
    }

    modal.style.display = 'flex';
  }

  closeModal() {
    document.getElementById('channel-detail-modal').style.display = 'none';
  }

  showAuthSection() {
    document.getElementById('subscriptions-auth-section').style.display = 'block';
    document.getElementById('subscriptions-content').style.display = 'none';
  }

  showContentSection() {
    document.getElementById('subscriptions-auth-section').style.display = 'none';
    document.getElementById('subscriptions-content').style.display = 'block';
  }

  showLoadingState() {
    document.getElementById('subscriptions-loading').style.display = 'block';
    document.getElementById('subscriptions-list').style.display = 'none';
    document.getElementById('subscriptions-empty').style.display = 'none';
  }

  hideLoadingState() {
    document.getElementById('subscriptions-loading').style.display = 'none';
  }

  showEmptyState() {
    document.getElementById('subscriptions-loading').style.display = 'none';
    document.getElementById('subscriptions-list').style.display = 'none';
    document.getElementById('subscriptions-empty').style.display = 'block';
  }

  async refreshSubscriptions() {
    const btn = document.getElementById('refresh-subs-btn');
    btn.disabled = true;
    btn.textContent = 'Загрузка...';

    try {
      await this.loadSubscriptions();
      window.utils.showToast('Подписки обновлены', 'success');
    } catch (error) {
      window.utils.showToast('Ошибка обновления подписок', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36M20.49 15a9 9 0 01-14.85 3.36"/></svg>Обновить';
    }
  }

  async cleanupInactive() {
    const inactiveCount = this.subscriptions.filter(s => !this.isChannelActive(s)).length;

    if (inactiveCount === 0) {
      window.utils.showToast('Нет неактивных подписок для удаления', 'info');
      return;
    }

    const confirmed = await window.utils.showConfirmation(
      `Отписаться от ${inactiveCount} неактивных каналов?`,
      'Это удалит подписки на каналы, которые не стримили более 30 дней'
    );

    if (!confirmed) return;

    try {
      const accounts = await Storage.getAccounts();
      const account = accounts[0];

      for (const sub of this.subscriptions) {
        if (!this.isChannelActive(sub)) {
          await window.electronAPI.unsubscribeChannel(account.accessToken, sub.id);
        }
      }

      this.subscriptions = this.subscriptions.filter(s => this.isChannelActive(s));
      await Storage.saveSubscriptions(this.subscriptions);

      this.updateStats();
      this.applyFilter();
      window.utils.showToast(`Отписались от ${inactiveCount} каналов`, 'success');
    } catch (error) {
      console.error('Error cleaning up subscriptions:', error);
      window.utils.showToast('Ошибка при удалении подписок', 'error');
    }
  }

  async unsubscribeChannel(sub) {
    const modalHtml = `
      <div style="text-align: center;">
        <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: linear-gradient(135deg, rgba(255, 107, 107, 0.2), rgba(255, 107, 107, 0.05)); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </div>
        <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Удалить ${sub.displayName}?</h3>
        <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 24px;">Канал будет удален из списка. Откроется страница на Twitch для отписки - нажмите кнопку <strong>"Не следить"</strong>.</p>
      </div>
    `;

    const confirmed = await window.utils.showCustomConfirmation(modalHtml, {
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      confirmClass: 'btn-danger'
    });

    if (!confirmed) return;

    try {
      // Удаляем из локального списка
      this.subscriptions = this.subscriptions.filter(s => s.id !== sub.id);
      await Storage.saveSubscriptions(this.subscriptions);

      this.updateStats();
      this.applyFilter();
      
      // Открываем страницу канала для ручной отписки
      window.electronAPI.openExternal(`https://www.twitch.tv/${sub.login}`);
      
      window.utils.showToast(`${sub.displayName} удален из списка`, 'success');
    } catch (error) {
      console.error('Error removing subscription:', error);
      window.utils.showToast('Ошибка при удалении', 'error');
    }
  }

  async startFarmingChannel(sub) {
    try {
      // Добавляем канал в фарминг или переключаемся на него
      if (window.farmingPage) {
        window.farmingPage.addChannelToFarming(sub.login);
        window.router?.switchPage('farming');
        window.utils.showToast(`Начинаем фарминг ${sub.displayName}...`, 'success');
      }
    } catch (error) {
      console.error('Error starting farming:', error);
      window.utils.showToast('Ошибка при запуске фарминга', 'error');
    }
  }

  async toggleFavorite(sub) {
    try {
      sub.isFavorite = !sub.isFavorite;

      // Обновляем в массиве
      const index = this.subscriptions.findIndex(s => s.id === sub.id);
      if (index !== -1) {
        this.subscriptions[index].isFavorite = sub.isFavorite;
      }

      // Сохраняем
      await Storage.saveSubscriptions(this.subscriptions);

      // Перерисовываем
      this.applyFilter();

      window.utils.showToast(
        sub.isFavorite ? `${sub.displayName} добавлен в избранное` : `${sub.displayName} убран из избранного`,
        'success'
      );
    } catch (error) {
      console.error('Error toggling favorite:', error);
      window.utils.showToast('Ошибка при обновлении избранного', 'error');
    }
  }

  updateViewMode() {
    const list = document.getElementById('subscriptions-list');
    if (!list) return;

    list.className = this.currentView === 'grid' ? 'subscriptions-grid-view' : 'subscriptions-list-view';
  }

  async savePrioritySetting(enabled) {
    try {
      await Storage.setItem('subscriptions_priority_enabled', enabled);
      window.utils.showToast(
        enabled ? 'Приоритет подписок включен' : 'Приоритет подписок отключен',
        'success'
      );
    } catch (error) {
      console.error('Error saving priority setting:', error);
    }
  }

  async loadPrioritySetting() {
    try {
      const enabled = await Storage.getItem('subscriptions_priority_enabled');
      const toggle = document.getElementById('priority-subs-toggle');
      if (toggle) {
        toggle.checked = enabled || false;
      }
    } catch (error) {
      console.error('Error loading priority setting:', error);
    }
  }

  // Drag and Drop methods
  handleDragStart(e, sub) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.innerHTML);
    e.target.classList.add('dragging');
    this.draggedSub = sub;
  }

  handleDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.subscription-card').forEach(card => {
      card.classList.remove('drag-over');
    });
  }

  handleDragOver(e) {
    if (e.preventDefault) {
      e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';

    const card = e.target.closest('.subscription-card');
    if (card && !card.classList.contains('dragging')) {
      card.classList.add('drag-over');
    }

    return false;
  }

  handleDragLeave(e) {
    const card = e.target.closest('.subscription-card');
    if (card) {
      card.classList.remove('drag-over');
    }
  }

  async handleDrop(e, targetSub) {
    if (e.stopPropagation) {
      e.stopPropagation();
    }

    const card = e.target.closest('.subscription-card');
    if (card) {
      card.classList.remove('drag-over');
    }

    if (!this.draggedSub || this.draggedSub.id === targetSub.id) {
      return false;
    }

    // Получаем индексы
    const draggedIndex = this.filteredSubscriptions.findIndex(s => s.id === this.draggedSub.id);
    const targetIndex = this.filteredSubscriptions.findIndex(s => s.id === targetSub.id);

    if (draggedIndex === -1 || targetIndex === -1) {
      return false;
    }

    // Меняем местами в filteredSubscriptions
    const temp = this.filteredSubscriptions[draggedIndex];
    this.filteredSubscriptions[draggedIndex] = this.filteredSubscriptions[targetIndex];
    this.filteredSubscriptions[targetIndex] = temp;

    // Обновляем приоритет в основном массиве
    const newPriorities = new Map();
    this.filteredSubscriptions.forEach((sub, index) => {
      newPriorities.set(sub.id, index);
    });

    this.subscriptions.forEach(sub => {
      if (newPriorities.has(sub.id)) {
        sub.priority = newPriorities.get(sub.id);
      }
    });

    // Сохраняем
    await Storage.saveSubscriptions(this.subscriptions);

    // Перерисовываем
    this.renderSubscriptions();

    window.utils.showToast('Порядок обновлен', 'success');

    return false;
  }
}

// Экспортируем класс в window для использования в router
window.SubscriptionsPage = SubscriptionsPage;
