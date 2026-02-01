// Drops Manager - централизованное управление дропами
class DropsManager {
  constructor() {
    this.campaigns = [];
    this.inventory = [];
    this.updateInterval = null;
    this.isLoading = false;
  }

  /**
   * Загрузить кампании с дропами
   */
  async loadCampaigns() {
    this.isLoading = true;
    
    try {
      const inventory = await window.TwitchAPI.getDropsInventory();
      
      if (!inventory) {
        throw new Error('Failed to fetch drops inventory');
      }

      // Обрабатываем кампании в прогрессе
      this.campaigns = (inventory.dropCampaignsInProgress || []).map(campaign => ({
        id: campaign.id,
        name: campaign.name,
        game: campaign.game,
        drops: (campaign.timeBasedDrops || []).map(drop => ({
          id: drop.id,
          name: drop.name,
          dropInstanceID: drop.self?.dropInstanceID,
          requiredMinutesWatched: drop.requiredMinutesWatched,
          currentMinutesWatched: drop.self?.currentMinutesWatched || 0,
          claimed: drop.self?.isClaimed || false,
          percentage: this.calculatePercentage(
            drop.self?.currentMinutesWatched || 0,
            drop.requiredMinutesWatched
          ),
          benefitId: drop.benefitEdges?.[0]?.benefit?.id,
          benefitName: drop.benefitEdges?.[0]?.benefit?.name,
          imageURL: drop.benefitEdges?.[0]?.benefit?.imageAssetURL
        }))
      }));

      // Обрабатываем полученные дропы
      this.inventory = (inventory.gameEventDrops || []).map(drop => ({
        id: drop.id,
        name: drop.name,
        image: drop.imageAssetURL,
        claimed: drop.isClaimed
      }));

      return {
        campaigns: this.campaigns,
        inventory: this.inventory
      };
    } catch (error) {
      console.error('Failed to load drops:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Рассчитать процент прогресса
   */
  calculatePercentage(current, required) {
    if (!required || required === 0) return 0;
    return Math.min(Math.round((current / required) * 100), 100);
  }

  /**
   * Получить активные кампании
   */
  getActiveCampaigns() {
    return this.campaigns.filter(campaign => {
      // Кампания активна если есть хотя бы один незавершенный дроп
      return campaign.drops.some(drop => !drop.claimed);
    });
  }

  /**
   * Получить завершённые кампании
   */
  getCompletedCampaigns() {
    return this.campaigns.filter(campaign => {
      // Кампания завершена если все дропы получены
      return campaign.drops.every(drop => drop.claimed);
    });
  }

  /**
   * Получить готовые к получению дропы
   */
  getReadyDrops() {
    const readyDrops = [];
    
    this.campaigns.forEach(campaign => {
      campaign.drops.forEach(drop => {
        if (drop.percentage >= 100 && !drop.claimed) {
          readyDrops.push({
            ...drop,
            campaignName: campaign.name,
            gameName: campaign.game?.displayName
          });
        }
      });
    });
    
    return readyDrops;
  }

  /**
   * Получить прогресс по всем дропам
   */
  getOverallProgress() {
    let totalDrops = 0;
    let completedDrops = 0;
    let claimedDrops = 0;
    
    this.campaigns.forEach(campaign => {
      campaign.drops.forEach(drop => {
        totalDrops++;
        if (drop.percentage >= 100) completedDrops++;
        if (drop.claimed) claimedDrops++;
      });
    });
    
    return {
      total: totalDrops,
      completed: completedDrops,
      claimed: claimedDrops,
      ready: completedDrops - claimedDrops,
      percentage: totalDrops > 0 ? Math.round((claimedDrops / totalDrops) * 100) : 0
    };
  }

  /**
   * Найти кампанию по ID игры
   */
  findCampaignByGameId(gameId) {
    return this.campaigns.find(campaign => campaign.game?.id === gameId);
  }

  /**
   * Получить дроп по ID
   */
  findDropById(dropId) {
    for (const campaign of this.campaigns) {
      const drop = campaign.drops.find(d => d.id === dropId);
      if (drop) {
        return {
          drop,
          campaign
        };
      }
    }
    return null;
  }

  /**
   * Обновить прогресс конкретного дропа
   */
  updateDropProgress(dropId, currentMinutes) {
    const result = this.findDropById(dropId);
    if (!result) return false;
    
    result.drop.currentMinutesWatched = currentMinutes;
    result.drop.percentage = this.calculatePercentage(
      currentMinutes,
      result.drop.requiredMinutesWatched
    );
    
    return true;
  }

  /**
   * Пометить дроп как полученный
   */
  markDropAsClaimed(dropId) {
    const result = this.findDropById(dropId);
    if (!result) return false;
    
    result.drop.claimed = true;
    result.drop.percentage = 100;
    
    return true;
  }

  /**
   * Запустить автоматическое обновление
   */
  startAutoUpdate(intervalMs = 120000) {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(async () => {
      try {
        await this.loadCampaigns();
        
        // Проверяем готовые дропы
        const readyDrops = this.getReadyDrops();
        if (readyDrops.length > 0) {
          // Можно запустить автоматическое получение
          if (window.ClaimService) {
            await window.ClaimService.autoClaimDrops(this.campaigns);
          }
        }
      } catch (error) {
        console.error('Auto-update failed:', error);
      }
    }, intervalMs);
  }

  /**
   * Остановить автоматическое обновление
   */
  stopAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Очистить данные
   */
  clear() {
    this.campaigns = [];
    this.inventory = [];
    this.stopAutoUpdate();
  }
}

// Экспорт синглтона
window.DropsManager = window.DropsManager || new DropsManager();
