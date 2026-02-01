// Claim Service - логика получения дропов
class ClaimService {
  constructor() {
    this.processedDrops = new Set(); // Отслеживание обработанных дропов
    this.autoClaimEnabled = true;
  }

  /**
   * Проверить готовность дропа к получению
   */
  isDropReady(drop) {
    if (!drop) return false;
    
    const hasProgress = drop.self?.currentMinutesWatched !== undefined;
    const hasRequirement = drop.requiredMinutesWatched !== undefined;
    
    if (!hasProgress || !hasRequirement) return false;
    
    const progress = drop.self.currentMinutesWatched;
    const required = drop.requiredMinutesWatched;
    
    return progress >= required && !drop.self.isClaimed;
  }

  /**
   * Получить процент прогресса
   */
  getDropProgress(drop) {
    if (!drop?.self?.currentMinutesWatched || !drop.requiredMinutesWatched) {
      return 0;
    }
    
    const progress = drop.self.currentMinutesWatched;
    const required = drop.requiredMinutesWatched;
    
    return Math.min(Math.round((progress / required) * 100), 100);
  }

  /**
   * Проверить был ли дроп уже обработан (для уведомлений)
   */
  isDropProcessed(drop) {
    const key = `${drop.id}_${drop.name}`;
    return this.processedDrops.has(key);
  }

  /**
   * Пометить дроп как обработанный
   */
  markDropAsProcessed(drop) {
    const key = `${drop.id}_${drop.name}`;
    this.processedDrops.add(key);
  }

  /**
   * Получить дроп (claim)
   */
  async claimDrop(dropInstanceID) {
    try {
      if (!dropInstanceID) {
        throw new Error('Drop instance ID is required');
      }

      const result = await window.TwitchAPI.claimDrop(dropInstanceID);
      
      if (result.status === 'SUCCESS') {
        return { success: true, result };
      } else {
        const errorMessage = result.errors?.[0]?.message || 'Unknown error';
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Failed to claim drop:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to claim drop'
      };
    }
  }

  /**
   * Автоматически проверить и получить готовые дропы
   */
  async autoClaimDrops(campaigns) {
    if (!this.autoClaimEnabled || !campaigns) return [];

    const claimedDrops = [];

    for (const campaign of campaigns) {
      if (!campaign.timeBasedDrops) continue;

      for (const drop of campaign.timeBasedDrops) {
        // Проверяем готовность дропа
        if (!this.isDropReady(drop)) continue;

        // Проверяем не обработан ли уже
        if (this.isDropProcessed(drop)) continue;

        // Помечаем как обработанный (чтобы не спамить)
        this.markDropAsProcessed(drop);

        // Показываем уведомление о готовности
        const dropName = drop.benefitEdges?.[0]?.benefit?.name || drop.name;
        const gameName = campaign.game?.displayName || 'Игра';
        
        window.NotificationService?.notifyDropReady(dropName, gameName);

        // Пытаемся получить дроп
        const dropInstanceID = drop.self?.dropInstanceID;
        if (!dropInstanceID) continue;

        const result = await this.claimDrop(dropInstanceID);
        
        if (result.success) {
          claimedDrops.push({
            drop,
            campaign,
            timestamp: new Date()
          });
          
          // Уведомление об успешном получении
          window.NotificationService?.notifyDropClaimed(dropName, gameName);
        }
      }
    }

    return claimedDrops;
  }

  /**
   * Включить/выключить автоматическое получение
   */
  toggleAutoClaim(enabled) {
    this.autoClaimEnabled = enabled;
    return this.autoClaimEnabled;
  }

  /**
   * Очистить историю обработанных дропов
   */
  clearProcessedDrops() {
    this.processedDrops.clear();
  }
}

// Экспорт синглтона
window.ClaimService = window.ClaimService || new ClaimService();
