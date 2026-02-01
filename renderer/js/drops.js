// Drops detection and management
class DropsManager {
  constructor() {
    this.activeDrops = new Map();
    this.checkInterval = null;
    this.cachedCampaigns = null;
    this.lastFetch = 0;
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  }

  async fetchTwitchDropsCampaigns() {
    // Check cache
    if (this.cachedCampaigns && (Date.now() - this.lastFetch) < this.CACHE_DURATION) {
      console.log('Using cached campaigns');
      return this.cachedCampaigns;
    }

    try {
      console.log('Fetching Twitch drops via IPC...');
      
      // Fetch через main process (обход CORS)
      const campaigns = await window.electronAPI.fetchTwitchDrops();
      
      console.log('API response:', campaigns ? `${campaigns.length} campaigns` : 'null');
      
      if (!campaigns || campaigns.length === 0) {
        console.log('No campaigns from API');
        this.cachedCampaigns = [];
        this.lastFetch = Date.now();
        return [];
      }

      // Format campaigns data - показываем ВСЕ кампании
      const formattedCampaigns = campaigns
        .map(campaign => {
          const now = Date.now();
          let endTime, startTime;
          
          // Пытаемся распарсить даты
          try {
            endTime = campaign.endAt ? new Date(campaign.endAt).getTime() : now + (7 * 24 * 60 * 60 * 1000);
            startTime = campaign.startAt ? new Date(campaign.startAt).getTime() : now - (24 * 60 * 60 * 1000);
          } catch (e) {
            endTime = now + (7 * 24 * 60 * 60 * 1000);
            startTime = now - (24 * 60 * 60 * 1000);
          }
          
          const hoursRemaining = Math.max(0, Math.floor((endTime - now) / (1000 * 60 * 60)));
          const daysRemaining = Math.floor(hoursRemaining / 24);
          const isActive = now >= startTime && now <= endTime;
          
          console.log(`Campaign ${campaign.name}: ${daysRemaining}d ${hoursRemaining % 24}h remaining, active=${isActive}`);
          
          return {
            id: campaign.id || `campaign-${Math.random().toString(36).substr(2, 9)}`,
            name: campaign.name || 'Unknown Campaign',
            game: campaign.game?.displayName || campaign.game?.name || campaign.game || campaign.name,
            gameId: campaign.gameId || campaign.game?.id || campaign.id || `game-${Math.random().toString(36).substr(2, 9)}`,
            imageUrl: campaign.imageUrl || campaign.game?.boxArtURL || campaign.game?.boxArtUrl || 'https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg',
            startDate: startTime,
            endDate: endTime,
            status: campaign.status || (isActive ? 'ACTIVE' : 'EXPIRED'),
            hoursRemaining,
            daysRemaining,
            isActive,
            isEnding: hoursRemaining <= 48 && hoursRemaining > 0,
            drops: (campaign.drops || campaign.timeBasedDrops || []).map((drop, idx) => ({
              id: drop.id || `drop-${idx}`,
              name: drop.name || 'Drop Item',
              imageUrl: drop.imageUrl || drop.imageURL || '',
              requiredMinutes: drop.requiredMinutes || drop.requiredMinutesWatched || 180,
              progress: 0
            }))
          };
        });

      console.log('Formatted campaigns:', formattedCampaigns.length);
      
      this.cachedCampaigns = formattedCampaigns;
      this.lastFetch = Date.now();
      
      return formattedCampaigns;
    } catch (error) {
      console.error('Error fetching Twitch drops:', error);
      // Не используем заглушки при ошибке, просто возвращаем пустой массив
      return [];
    }
  }

  parseDropsHTML(html) {
    // This method is no longer used, kept for reference
    return [];
  }

  formatCampaignsData(rawCampaigns) {
    // This method is no longer used, kept for reference
    return [];
  }

  getFallbackDrops() {
    // Актуальные дропсы на январь 2026
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    return [
      {
        id: 'fallback-cod',
        name: 'Call of Duty: Black Ops 7',
        game: 'Call of Duty',
        gameId: 'cod',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/512710-285x380.jpg',
        startDate: now - (3 * oneDayMs),
        endDate: now + (4 * oneDayMs),
        hoursRemaining: 96,
        daysRemaining: 4,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-cod1', name: 'Weapon Blueprint', requiredMinutes: 180, progress: 0 },
          { id: 'drop-cod2', name: 'Operator Skin', requiredMinutes: 360, progress: 0 }
        ]
      },
      {
        id: 'fallback-arena',
        name: 'Arena Breakout: Infinite',
        game: 'Arena Breakout',
        gameId: 'arena',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1869358481_IGDB-285x380.jpg',
        startDate: now - (2 * oneDayMs),
        endDate: now + (5 * oneDayMs),
        hoursRemaining: 120,
        daysRemaining: 5,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-arena1', name: 'Weapon Skin', requiredMinutes: 240, progress: 0 }
        ]
      },
      {
        id: 'fallback-finals',
        name: 'THE FINALS',
        game: 'THE FINALS',
        gameId: 'finals',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/655052099_IGDB-285x380.jpg',
        startDate: now - (1 * oneDayMs),
        endDate: now + (13 * oneDayMs),
        hoursRemaining: 312,
        daysRemaining: 13,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-finals1', name: 'Character Outfit', requiredMinutes: 180, progress: 0 }
        ]
      },
      {
        id: 'fallback-cult',
        name: 'Cult of the Lamb',
        game: 'Cult of the Lamb',
        gameId: 'cult',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/518213_IGDB-285x380.jpg',
        startDate: now - (5 * oneDayMs),
        endDate: now + (2 * oneDayMs),
        hoursRemaining: 48,
        daysRemaining: 2,
        isActive: true,
        isEnding: true,
        drops: [
          { id: 'drop-cult1', name: 'Follower Skin', requiredMinutes: 120, progress: 0 }
        ]
      },
      {
        id: 'fallback-lol',
        name: 'League of Legends',
        game: 'League of Legends',
        gameId: 'lol',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/21779-285x380.jpg',
        startDate: now - (7 * oneDayMs),
        endDate: now + (17 * oneDayMs),
        hoursRemaining: 408,
        daysRemaining: 17,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-lol1', name: 'Hextech Chest', requiredMinutes: 180, progress: 0 },
          { id: 'drop-lol2', name: 'Champion Capsule', requiredMinutes: 360, progress: 0 }
        ]
      },
      {
        id: 'fallback-warships',
        name: 'Modern Warships',
        game: 'Modern Warships',
        gameId: 'warships',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/516575-285x380.jpg',
        startDate: now - (8 * oneDayMs),
        endDate: now + (16 * oneDayMs),
        hoursRemaining: 384,
        daysRemaining: 16,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-warships1', name: 'Premium Ship', requiredMinutes: 300, progress: 0 }
        ]
      },
      {
        id: 'fallback-matin',
        name: 'Matin2',
        game: 'Matin2',
        gameId: 'matin',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/18973_IGDB-285x380.jpg',
        startDate: now - (9 * oneDayMs),
        endDate: now + (9 * oneDayMs),
        hoursRemaining: 216,
        daysRemaining: 9,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-matin1', name: 'Equipment Set', requiredMinutes: 240, progress: 0 }
        ]
      },
      {
        id: 'fallback-quarantine',
        name: 'Quarantine Zone: The Last Check',
        game: 'Quarantine Zone',
        gameId: 'quarantine',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/518019_IGDB-285x380.jpg',
        startDate: now - (9 * oneDayMs),
        endDate: now + (14 * oneDayMs),
        hoursRemaining: 336,
        daysRemaining: 14,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-qz1', name: 'Survival Pack', requiredMinutes: 180, progress: 0 }
        ]
      },
      {
        id: 'fallback-kirka',
        name: 'Kirka.io',
        game: 'Kirka.io',
        gameId: 'kirka',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/518673_IGDB-285x380.jpg',
        startDate: now - (6 * oneDayMs),
        endDate: now + (10 * oneDayMs),
        hoursRemaining: 240,
        daysRemaining: 10,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-kirka1', name: 'Weapon Skin', requiredMinutes: 120, progress: 0 }
        ]
      },
      {
        id: 'fallback-mlbb',
        name: 'Mobile Legends: Bang Bang',
        game: 'Mobile Legends',
        gameId: 'mlbb',
        imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/514790_IGDB-285x380.jpg',
        startDate: now - (10 * oneDayMs),
        endDate: now + (15 * oneDayMs),
        hoursRemaining: 360,
        daysRemaining: 15,
        isActive: true,
        isEnding: false,
        drops: [
          { id: 'drop-mlbb1', name: 'Hero Skin', requiredMinutes: 240, progress: 0 }
        ]
      }
    ];
  }

  async scanForDrops() {
    const campaigns = await this.fetchTwitchDropsCampaigns();
    
    // Sort by ending soon first
    campaigns.sort((a, b) => {
      // Ending soon campaigns first
      if (a.isEnding && !b.isEnding) return -1;
      if (!a.isEnding && b.isEnding) return 1;
      // Then by hours remaining (ascending)
      return a.hoursRemaining - b.hoursRemaining;
    });

    return campaigns;
  }

  async getDropsForCategory(categoryId) {
    const allDrops = await this.scanForDrops();
    return allDrops.find(d => d.gameId === categoryId);
  }

  async getDropsForGame(gameName) {
    const allDrops = await this.scanForDrops();
    
    // Нормализуем название игры для поиска
    const normalizeGameName = (name) => {
      return name.toLowerCase()
        .replace(/[^a-z0-9а-яё]/g, '')
        .replace(/\s+/g, '');
    };
    
    const searchNormalized = normalizeGameName(gameName);
    
    // Ищем дропсы по имени игры (частичное совпадение)
    const foundDrops = allDrops.filter(d => {
      const dropGameName = normalizeGameName(d.game || d.name || '');
      
      // Проверяем различные варианты совпадения
      return dropGameName.includes(searchNormalized) || 
             searchNormalized.includes(dropGameName) ||
             dropGameName === searchNormalized;
    });
    
    console.log(`Searching drops for "${gameName}" (normalized: "${searchNormalized}")`);
    console.log('Found drops:', foundDrops.length, foundDrops.map(d => d.game));
    
    return foundDrops;
  }

  async selectStreamer(category, preferredLanguage, blacklist = []) {
    const settings = await Storage.getSettings();
    let streamers = category.streamers.filter(s => !blacklist.includes(s.name));

    // Filter by language preference
    if (preferredLanguage !== 'any') {
      const preferredStreamers = streamers.filter(s => s.language === preferredLanguage);
      if (preferredStreamers.length > 0) {
        streamers = preferredStreamers;
      }
    }

    // Sort by viewers
    streamers.sort((a, b) => b.viewers - a.viewers);

    return streamers[0] || null;
  }

  async startDropTracking(categoryId, dropId) {
    this.activeDrops.set(dropId, {
      categoryId,
      startTime: Date.now(),
      progress: 0,
      completed: false
    });
  }

  async updateDropProgress(dropId, progress) {
    const drop = this.activeDrops.get(dropId);
    if (drop) {
      drop.progress = progress;
      if (progress >= 100) {
        drop.completed = true;
        drop.completedAt = Date.now();
        
        // Show notification
        window.electronAPI.showNotification(
          i18n.t('farming.dropsCompleted'),
          `Drop completed!`
        );

        // Play sound if enabled
        const settings = await Storage.getSettings();
        if (settings.soundAlerts) {
          this.playDropSound();
        }
      }
    }
  }

  getActiveDropProgress(dropId) {
    return this.activeDrops.get(dropId);
  }

  playDropSound() {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZRA0PVKrm77BdGAg+ltrzxnMnBSuAzvLZiTYIGmi78+ebSwkMUKjj8bVjHAY5kdfy0HgpBSR2yPDdkD8KFGCz6OyrVRMJR5/g8r5rIAUuhM/z1YU1Bhxqv+7mnEQODlSq5u+wXRgIPpbZ88Z0JwUrfs/y2Yk2CBlpvPPnmksJDVCn4/G1YhwGOZLX8s95KgUkdsfw3Y8+ChRgsujsq1UTCUef4PK+bCAFLoTP89SFNQYcab/u5p1EDg5Uqubvr10YCDyW2vPGdScGK37P8tmJNggaabzz55lLCQ1Qp+Txs2IcBjmS1/LPeSoFJHbH8N2PPgoUYLPo7KtVEwlHn+Dyvmw='); // Base64 encoded notification sound
    audio.play().catch(err => console.log('Could not play sound:', err));
  }

  stopTracking() {
    this.activeDrops.clear();
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// Create global instance
if (!window.dropsManager) {
  window.dropsManager = new DropsManager();
}
