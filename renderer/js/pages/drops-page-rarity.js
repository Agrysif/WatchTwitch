// Система редкости и модальное окно для дропов

// Расширение DropsPage с функциями редкости
window.DropsPageRarityExtension = {
  // Определение редкостей дропов
  rarityTiers: [
    { name: 'common', label: 'Обычный', minMinutes: 0, maxMinutes: 60, minViewers: 50000, color: '#888888', glow: 'rgba(136, 136, 136, 0.4)' },
    { name: 'uncommon', label: 'Необычный', minMinutes: 61, maxMinutes: 120, minViewers: 30000, color: '#00ff00', glow: 'rgba(0, 255, 0, 0.4)' },
    { name: 'rare', label: 'Редкий', minMinutes: 121, maxMinutes: 240, minViewers: 15000, color: '#0099ff', glow: 'rgba(0, 153, 255, 0.4)' },
    { name: 'epic', label: 'Эпический', minMinutes: 241, maxMinutes: 480, minViewers: 8000, color: '#9d00ff', glow: 'rgba(157, 0, 255, 0.4)' },
    { name: 'legendary', label: 'Легендарный', minMinutes: 481, maxMinutes: 720, minViewers: 3000, color: '#ff8800', glow: 'rgba(255, 136, 0, 0.4)' },
    { name: 'mythic', label: 'Мифический', minMinutes: 721, maxMinutes: 99999, minViewers: 0, color: '#ff0088', glow: 'rgba(255, 0, 136, 0.4)' }
  ],

  // Вычисление редкости дропа
  calculateDropRarity: function(drop, campaign) {
    const requiredMinutes = drop.required || drop.requiredMinutesWatched || 0;
    const viewersCount = campaign?.game?.viewersCount || campaign?.viewersCount || 0;
    
    // Ищем подходящий tier на основе времени
    let rarity = this.rarityTiers[0]; // По умолчанию common
    
    for (let tier of this.rarityTiers) {
      if (requiredMinutes >= tier.minMinutes && requiredMinutes <= tier.maxMinutes) {
        rarity = tier;
        break;
      }
    }
    
    // Повышаем редкость если мало зрителей (редкая игра)
    if (viewersCount > 0 && viewersCount < rarity.minViewers) {
      const currentIndex = this.rarityTiers.indexOf(rarity);
      if (currentIndex < this.rarityTiers.length - 1) {
        rarity = this.rarityTiers[currentIndex + 1];
      }
    }
    
    // Вычисляем примерное количество владельцев
    const baseOwners = Math.max(viewersCount * 0.3, 10000);
    const rarityMultiplier = Math.pow(this.rarityTiers.indexOf(rarity) + 1, 2);
    const estimatedOwners = Math.floor(baseOwners / rarityMultiplier);
    
    // Вычисляем сложность (1-10)
    const difficulty = Math.min(10, Math.max(1, Math.ceil(requiredMinutes / 90)));
    
    return {
      ...rarity,
      requiredMinutes,
      viewersCount,
      estimatedOwners: estimatedOwners > 1000 ? `${Math.floor(estimatedOwners / 1000)}K+` : `${estimatedOwners}+`,
      difficulty
    };
  },

  formatViewersCount: function(count) {
    if (!count || count === 0) return '—';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  }
};

// Добавляем CSS анимации
if (!document.getElementById('drop-modal-animations')) {
  const style = document.createElement('style');
  style.id = 'drop-modal-animations';
  style.textContent = `
    @keyframes borderGlow {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideUp {
      from { transform: translateY(40px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}
