// Drops page - полностью переписан
(function() {
  'use strict';

  if (window.DropsPage) {
    console.log('DropsPage already loaded');
    return;
  }

  class DropsPage {
    constructor() {
      console.log('DropsPage constructor');
      this.campaigns = [];
      this.claimedDrops = [];
      this.updateTimer = null;
      this.inventoryPage = 1;
      this.inventoryPageSize = 20;
      this.inventoryFilter = 'all'; // all, game, time
      this.inventoryGameFilter = null;
      this.showAllGames = false; // Новое свойство для управления показом всех игр
      this.initialized = false;
      this.init();
    }

    async init() {
      console.log('DropsPage init');
      
      // Проверяем авторизацию
      try {
        const user = await window.electronAPI.getOAuthUser();
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
              try {
                await window.electronAPI.startTwitchAuth();
                // После авторизации перезагружаем страницу
                window.location.reload();
              } catch (error) {
                console.error('Auth error:', error);
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
            logoutBtn.onclick = async () => {
              try {
                await window.electronAPI.logoutTwitch();
                window.location.reload();
              } catch (e) {
                console.error('Logout error:', e);
              }
            };
          }
        }
        if (tabsContainer) {
          tabsContainer.style.display = 'block';
          console.log('Showing tabs container');
        }
        if (progressTab) {
          progressTab.style.display = 'block';
          console.log('Showing progress tab');
        }

        // Убираем любую попытку включить фон-градIENT на этой странице
        
        this.setupTabs();
        this.setupButtons();
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
      document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
          const tab = button.getAttribute('data-tab');
          
          // Обновляем кнопки
          document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
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
        refreshBtn.addEventListener('click', () => this.loadDrops());
      }
      
      // Кнопка получения всех наград
      const claimAllBtn = document.getElementById('claimAllButton');
      if (claimAllBtn) {
        claimAllBtn.addEventListener('click', async () => {
          claimAllBtn.disabled = true;
          claimAllBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/></svg> Получение...';
          
          try {
            const result = await window.electronAPI.claimAllDrops();
            if (result.success) {
              window.utils?.showToast(`Получено наград: ${result.claimed}`, 'success');
              setTimeout(() => this.loadDrops(), 2000);
            } else {
              window.utils?.showToast(result.error || 'Ошибка', 'error');
            }
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

    async loadDrops() {
      const loadingEl = document.getElementById('loadingState');
      const containerEl = document.getElementById('campaignsContainer');
      const emptyEl = document.getElementById('emptyState');
      
      if (loadingEl) loadingEl.style.display = 'block';
      if (containerEl) containerEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'none';

      try {
        console.log('Fetching drops inventory...');
        const data = await window.electronAPI.fetchDropsInventory();
        console.log('Drops data received:', data);
        
        if (data && data.campaigns && data.campaigns.length > 0) {
          this.campaigns = data.campaigns;
          this.claimedDrops = data.claimedDrops || [];
          this.updateStats();
          this.renderCampaigns();
        } else {
          if (emptyEl) emptyEl.style.display = 'block';
        }
      } catch (error) {
        console.error('Error loading drops:', error);
        if (emptyEl) {
          emptyEl.style.display = 'block';
          emptyEl.textContent = 'Ошибка загрузки дропсов';
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
        // Считаем полученные дропсы
        if (campaign.drops) {
          const claimedCount = campaign.drops.filter(d => d.claimed).length;
          totalClaimedDrops += claimedCount;
        }
        
        // Считаем завершенные кампании
        const isCompleted = isCampaignCompleted(campaign) || isCampaignExpired(campaign);
        if (isCompleted) {
          completedCampaigns++;
        } else {
          activeCampaigns++;
        }
      });
      
      // Обновляем элементы на странице
      const totalClaimedEl = document.getElementById('totalClaimedDrops');
      const completedCampaignsEl = document.getElementById('completedCampaignsCount');
      const activeCampaignsEl = document.getElementById('activeCampaignsCount');
      
      if (totalClaimedEl) totalClaimedEl.textContent = totalClaimedDrops;
      if (completedCampaignsEl) completedCampaignsEl.textContent = completedCampaigns;
      if (activeCampaignsEl) activeCampaignsEl.textContent = activeCampaigns;
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
      
      // Функция для расчета прогресса кампании
      const getCampaignProgress = (campaign) => {
        if (!campaign.drops || campaign.drops.length === 0) return 0;
        let totalProgress = 0;
        campaign.drops.forEach(drop => {
          const earned = isDropEarned(drop);
          const dropPercent = earned ? 100 : (drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0);
          totalProgress += dropPercent;
        });
        return Math.floor(totalProgress / campaign.drops.length);
      };
      
      // Сортируем активные кампании по прогрессу (от большего к меньшему)
      activeCampaigns.sort((a, b) => getCampaignProgress(b) - getCampaignProgress(a));
      
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
      card.style.cssText = `background: rgba(0,0,0,0.2); border-radius: 12px; overflow: hidden; margin-bottom: 20px; transition: border 0.2s; border: 2px solid transparent; transform: none !important; box-shadow: none !important; ${isCompleted ? 'opacity: 0.85;' : ''}`;
      
      // Добавляем обработчики hover только для обводки
      card.addEventListener('mouseenter', () => {
        card.style.border = '2px solid rgba(145,71,255,0.6)';
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
            timeText = `Осталось: ${days}д ${hours}ч`;
          } else if (hours > 0) {
            timeText = `Осталось: ${hours}ч ${minutes}м`;
          } else {
            timeText = `Осталось: ${minutes}м`;
          }
        }
      }
      
      // Прогресс - используем ту же логику что и в farming-page.js
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
      
      const totalDrops = campaign.drops ? campaign.drops.length : 0;
      const completedDrops = campaign.drops ? campaign.drops.filter(isDropEarned).length : 0;
      const progressPercent = totalDrops > 0 ? Math.floor((completedDrops / totalDrops) * 100) : 0;
      
      // Превью игры
      const gameImage = campaign.game?.boxArtURL ? campaign.game.boxArtURL.replace('{width}', '300').replace('{height}', '400') : '';
      
      // Дополнительная информация
      const startDate = campaign.startAt ? new Date(campaign.startAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
      const endDate = campaign.endsAt ? new Date(campaign.endsAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
      
      card.innerHTML = `
        <div style="position: relative; height: 180px; background: ${gameImage ? `linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.85)), url('${gameImage}')` : 'rgba(0,0,0,0.3)'}; background-size: cover; background-position: center; display: flex; flex-direction: column; justify-content: flex-end; padding: 20px;">
          <div style="color: #fff; font-size: 20px; font-weight: 700; margin-bottom: 6px; text-shadow: 0 2px 8px rgba(0,0,0,0.8);">${campaign.name || 'Campaign'}</div>
          <div style="color: rgba(255,255,255,0.9); font-size: 14px; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">${campaign.game?.name || 'Unknown Game'}</div>
          ${startDate && endDate ? `<div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-top: 4px; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">${startDate} — ${endDate}</div>` : ''}
          ${timeText ? `<div style="color: rgba(255,255,255,0.85); font-size: 13px; margin-top: 6px; font-weight: 600; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">${timeText}</div>` : ''}
          ${isExpired ? '<div style="position: absolute; top: 15px; right: 15px; background: rgba(255,255,255,0.15); color: #fff; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.2);">Завершено</div>' : (isCompleted ? '<div style="position: absolute; top: 15px; right: 15px; background: rgba(0,245,147,0.2); color: #00f593; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; backdrop-filter: blur(8px); border: 1px solid rgba(0,245,147,0.4);">✓ 100%</div>' : '')}
        </div>
        
        <div style="padding: 20px;">
          <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: var(--text-secondary); font-size: 14px; font-weight: 600;">${completedDrops} из ${totalDrops} получено</span>
              <span style="color: ${progressPercent === 100 ? '#00f593' : 'var(--accent-color)'}; font-size: 14px; font-weight: 700;">${progressPercent}%</span>
            </div>
            <div style="background: rgba(255,255,255,0.08); height: 10px; border-radius: 5px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);">
              <div style="background: ${progressPercent === 100 ? '#00f593' : '#9147ff'} !important; height: 100%; width: ${progressPercent}%; transition: width 0.5s ease; box-shadow: 0 0 10px ${progressPercent === 100 ? 'rgba(0,245,147,0.5)' : 'rgba(145,71,255,0.5)'};"></div>
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 12px;">
            ${campaign.drops && campaign.drops.length > 0 ? campaign.drops.map(drop => this.createDropElement(drop)).join('') : '<div style="color: var(--text-secondary); padding: 20px; text-align: center;">Нет дропсов</div>'}
          </div>
        </div>
      `;
      
      return card;
    }

    createDropElement(drop) {
      const imageUrl = drop.imageURL || 'https://via.placeholder.com/90x90?text=Drop';
      const percentage = drop.percentage || 0;
      const isClaimed = drop.claimed || false;
      const canClaim = !isClaimed && percentage >= 100 && drop.dropInstanceID;
      const progress = drop.progress || 0;
      const required = drop.required || 0;
      const remaining = Math.max(0, required - progress);
      
      let statusBadge = '';
      let bottomSection = '';
      
      if (isClaimed) {
        // Получено - бадж внизу над картинкой
        bottomSection = `
          <div style="background: rgba(0,0,0,0.85); padding: 8px;">
            <div style="background: rgba(0,245,147,0.95); padding: 4px; text-align: center; font-size: 9px; font-weight: 600; color: #000; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 3px; margin-bottom: 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">✓ Получено</div>
            <div style="color: rgba(255,255,255,0.7); font-size: 10px; font-weight: 600; text-align: center;">${drop.benefitName || 'Reward'}</div>
          </div>
        `;
      } else if (canClaim) {
        // Готово к получению
        bottomSection = `
          <div style="background: rgba(0,0,0,0.85); padding: 8px;">
            <div style="color: rgba(255,255,255,0.9); font-size: 10px; font-weight: 600; margin-bottom: 6px; text-align: center;">${drop.benefitName || 'Reward'}</div>
            <button onclick="window.claimDropNow('${drop.dropInstanceID}', this)" style="width: 100%; background: linear-gradient(135deg, #9147ff, #772ce8); color: white; border: none; padding: 6px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;">Забрать</button>
          </div>
        `;
      } else {
        // В процессе
        bottomSection = `
          <div style="background: rgba(0,0,0,0.9); padding: 8px;">
            <div style="color: rgba(255,255,255,0.9); font-size: 10px; font-weight: 600; margin-bottom: 6px; text-align: center;">${drop.benefitName || 'Reward'}</div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: rgba(255,255,255,0.7); font-size: 9px;">${percentage}%</span>
              <span style="color: rgba(255,255,255,0.5); font-size: 9px;">${remaining} мин</span>
            </div>
            <div style="background: rgba(255,255,255,0.1); height: 4px; border-radius: 2px; overflow: hidden;">
              <div style="background: #9147ff; height: 100%; width: ${percentage}%; transition: width 0.5s ease;"></div>
            </div>
          </div>
        `;
      }
      
      return `
        <div style="
          position: relative; 
          background: rgba(0,0,0,0.3); 
          border-radius: 8px; 
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
                background: url('${imageUrl}');
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
                background: url('${imageUrl}');
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
          claimedDrops = data.claimedDrops || [];
          this.claimedDrops = claimedDrops;
        }
        
        console.log('Inventory items:', claimedDrops.length);
        
        if (claimedDrops.length > 0) {
          this.renderInventory(claimedDrops);
        } else {
          if (emptyEl) emptyEl.style.display = 'block';
        }
      } catch (error) {
        console.error('Error loading inventory:', error);
        if (emptyEl) {
          emptyEl.style.display = 'block';
          emptyEl.textContent = 'Ошибка загрузки инвентаря';
        }
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
              claimedAt: new Date().toISOString(),
              claimed: true,
              canClaim: false
            });
          }
          // Добавляем дропсы готовые к получению (100% но не claimed)
          else if (drop.percentage >= 100 && !drop.claimed) {
            allDrops.push({
              id: drop.benefitId || drop.id,
              dropInstanceID: drop.dropInstanceID,
              name: drop.benefitName || drop.name || 'Награда',
              image: drop.imageURL,
              game: campaign.game?.name || 'Неизвестно',
              claimedAt: new Date().toISOString(),
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
            allDrops.push({
              id: claimed.id,
              name: 'Полученная награда',
              image: null,
              game: 'Различные игры',
              claimedAt: claimed.lastAwardedAt || new Date().toISOString(),
              claimed: true
            });
          }
        });
      }
      
      // Сортируем по дате (новые сверху)
      allDrops.sort((a, b) => new Date(b.claimedAt) - new Date(a.claimedAt));
      
      // Получаем уникальные игры для фильтра
      const uniqueGames = [...new Set(allDrops.map(d => d.game))].sort();
      
      // Создаем фильтры
      const filtersSection = document.createElement('div');
      filtersSection.style.cssText = 'display: flex; gap: 8px; flex-wrap: nowrap; margin-bottom: 15px; overflow-x: auto; padding-bottom: 5px;';
      
      // Кнопка "Все"
      const allFilterBtn = document.createElement('button');
      allFilterBtn.textContent = 'Все';
      allFilterBtn.className = 'btn btn-secondary';
      allFilterBtn.style.cssText = `font-size: 12px; padding: 6px 12px; ${this.inventoryFilter === 'all' ? 'background: rgba(145,71,255,0.5);' : ''}`;
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
        gameBtn.style.cssText = `font-size: 12px; padding: 6px 12px; ${isActive ? 'background: rgba(145,71,255,0.5);' : ''}`;
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
          background: rgba(145,71,255,0.12);
          border: 1px solid rgba(145,71,255,0.25);
          color: var(--accent-color);
          font-weight: 500;
          cursor: pointer;
          border-radius: 6px;
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
          toggleGamesBtn.style.background = 'rgba(145,71,255,0.2)';
          toggleGamesBtn.style.borderColor = 'rgba(145,71,255,0.4)';
        };
        
        toggleGamesBtn.onmouseleave = () => {
          toggleGamesBtn.style.background = 'rgba(145,71,255,0.12)';
          toggleGamesBtn.style.borderColor = 'rgba(145,71,255,0.25)';
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
          background: rgba(145,71,255,0.08);
          border: 1px solid rgba(145,71,255,0.2);
          color: var(--accent-color);
          font-weight: 600;
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.25s ease;
          margin-top: 30px;
        `;
        
        loadMoreBtn.onmouseenter = () => {
          loadMoreBtn.style.background = 'rgba(145,71,255,0.15)';
          loadMoreBtn.style.borderColor = 'rgba(145,71,255,0.4)';
          loadMoreBtn.style.transform = 'translateY(-2px)';
          loadMoreBtn.style.boxShadow = '0 4px 12px rgba(145,71,255,0.2)';
        };
        
        loadMoreBtn.onmouseleave = () => {
          loadMoreBtn.style.background = 'rgba(145,71,255,0.08)';
          loadMoreBtn.style.borderColor = 'rgba(145,71,255,0.2)';
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
      const imageUrl = drop.image || 'https://via.placeholder.com/100x100?text=Drop';
      const timeAgo = drop.claimedAt ? this.getTimeAgo(drop.claimedAt) : '';
      
      const card = document.createElement('div');
      card.style.cssText = 'position: relative; background: rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden; cursor: pointer; border: 2px solid transparent; transition: border 0.3s;';
      
      // Анимация flip с подсветкой
      card.onmouseenter = () => {
        card.style.border = '2px solid rgba(145,71,255,0.6)';
        card.style.boxShadow = '0 0 20px rgba(145,71,255,0.4)';
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
            <div style="position: absolute; width: 100%; height: 100%; backface-visibility: hidden; background: url('${imageUrl}'); background-size: cover; background-position: center;"></div>
            
            <!-- Back -->
            <div style="position: absolute; width: 100%; height: 100%; backface-visibility: hidden; transform: rotateY(180deg); background: url('${imageUrl}'); background-size: cover; background-position: center;"></div>
          </div>
        </div>
        
        <div style="background: rgba(0,0,0,0.9); padding: 10px;">
          ${drop.claimed ? 
            '<div style="display: inline-flex; align-items: center; gap: 3px; background: rgba(0,200,83,0.15); color: #00c853; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; margin-bottom: 6px;"><span style="font-size: 10px;">✓</span> Получено</div>' : 
            drop.canClaim ? 
              `<button onclick="window.claimDropNow('${drop.dropInstanceID}', this)" style="width: 100%; background: linear-gradient(135deg, #9147ff, #772ce8); color: white; border: none; padding: 6px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase; margin-bottom: 6px;">Забрать</button>` :
              ''
          }
          <div style="color: #fff; font-size: 12px; font-weight: 600; margin-bottom: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${drop.name}">${drop.name}</div>
          <div style="color: rgba(255,255,255,0.6); font-size: 10px; margin-bottom: 4px;">${drop.game}</div>
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

    startAutoRefresh() {
      // Обновляем каждые 5 минут
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
      }
      this.updateTimer = setInterval(() => {
        this.loadDrops();
      }, 5 * 60 * 1000);
    }

    destroy() {
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }
    }
  }

  // Глобальная функция для получения дропа
  window.claimDropNow = async function(dropInstanceID, button) {
    if (!dropInstanceID || !button) return;
    
    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '...';
    
    try {
      const result = await window.electronAPI.claimDrop(dropInstanceID);
      
      if (result.success) {
        button.innerHTML = '✓ Получено';
        button.style.background = '#00f593';
        button.style.color = '#000';
        window.utils?.showToast('Награда получена!', 'success');
        
        setTimeout(() => {
          if (window.dropsPageInstance) {
            window.dropsPageInstance.loadDrops();
          }
        }, 2000);
      } else {
        button.innerHTML = originalHTML;
        button.disabled = false;
        window.utils?.showToast(result.error || 'Ошибка', 'error');
      }
    } catch (error) {
      console.error('Error claiming drop:', error);
      button.innerHTML = originalHTML;
      button.disabled = false;
      window.utils?.showToast('Ошибка получения награды', 'error');
    }
  };

  // Экспорт
  window.DropsPage = DropsPage;
  
  // Инициализация для роутера
  if (!window.dropsPageInstance) {
    window.dropsPageInstance = new DropsPage();
  }

  console.log('drops-page.js loaded successfully');
})();
