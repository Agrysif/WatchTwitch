// Модальное окно с деталями дропа и 3D эффектом
(function() {
  'use strict';

  window.showDropDetailModal = function(drop, campaign, dropsPageInstance) {
    // Удаляем существующее модальное окно если есть
    const existingModal = document.getElementById('drop-detail-modal');
    if (existingModal) existingModal.remove();
    
    // Вычисляем редкость
    const rarity = dropsPageInstance.calculateDropRarity(drop, campaign);
    const imageUrl = drop.imageURL || drop.image || drop.imageUrl || 'https://via.placeholder.com/400x400?text=Drop';
    
    // Форматируем даты
    const claimedDateRaw = drop.claimedAt || drop.lastAwardedAt || drop.claimedDate;
    const claimedDate = claimedDateRaw 
      ? new Date(claimedDateRaw).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    
    const campaignStartRaw = campaign?.startAt || campaign?.startDate;
    const campaignEndRaw = campaign?.endsAt || campaign?.endDate;
    const campaignStart = campaignStartRaw 
      ? new Date(campaignStartRaw).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    const campaignEnd = campaignEndRaw 
      ? new Date(campaignEndRaw).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    
    // Вычисляем прогресс
    const requiredMinutes = drop.requiredMinutesWatched || drop.requiredMinutes || drop.required || rarity.requiredMinutes || 0;
    const progressPercent = Number.isFinite(drop.progressPercent) 
      ? Math.min(100, Math.max(0, Math.floor(drop.progressPercent)))
      : (Number.isFinite(drop.percentage)
        ? Math.min(100, Math.max(0, Math.floor(drop.percentage)))
        : (requiredMinutes > 0 
          ? Math.min(100, Math.max(0, Math.floor(((drop.currentMinutesWatched || drop.progress || 0) / requiredMinutes) * 100))) 
          : 0));
    const progressMinutes = Number.isFinite(drop.progressMinutes)
      ? Math.max(0, Math.floor(drop.progressMinutes))
      : (Number.isFinite(drop.currentMinutesWatched)
        ? Math.max(0, Math.floor(drop.currentMinutesWatched))
        : (requiredMinutes > 0 && Number.isFinite(drop.progress) && drop.progress <= requiredMinutes
          ? Math.max(0, Math.floor(drop.progress))
          : 0));
    
    // Определяем статус
    const isClaimed = !!(drop.claimed || drop.isClaimed);
    const isClaimable = !!(drop.canClaim || drop.isClaimable || drop.claimable || drop.isUnlocked);
    let statusText = 'В процессе';
    let statusColor = '#7c5cff';
    if (isClaimed) {
      statusText = 'Получено';
      statusColor = '#35d08a';
    } else if (progressPercent >= 100 || isClaimable) {
      statusText = 'Доступно к получению';
      statusColor = '#35d08a';
    } else if (progressPercent === 0) {
      statusText = 'Не начато';
      statusColor = 'var(--text-secondary)';
    }
    
    const formatViewersCount = typeof dropsPageInstance?.formatViewersCount === 'function'
      ? dropsPageInstance.formatViewersCount.bind(dropsPageInstance)
      : (count) => (count || count === 0 ? count.toString() : '—');
    
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.id = 'drop-detail-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: fadeIn 0.2s ease;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: var(--bg-secondary);
      border: 2px solid ${rarity.color};
      border-radius: var(--radius-md);
      width: 90%;
      max-width: 700px;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: 0 0 60px ${rarity.glow}, 0 20px 60px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.3s ease;
      position: relative;
    `;
    
    modalContent.innerHTML = `
      <!-- Размытый фон цвета изображения -->
      <div style="position: absolute; top: 0; left: 0; right: 0; height: 250px; background-image: url('${imageUrl}'); background-size: cover; background-position: center; filter: blur(40px); opacity: 0.3; border-radius: 16px 16px 0 0;"></div>
      
      <div style="padding: 32px; position: relative;">
        <!-- Кнопка закрытия -->
        <button id="close-drop-modal" style="
          position: absolute;
          top: 16px;
          right: 16px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-circle);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          z-index: 10;
        ">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style="color: var(--text-primary);">
            <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <!-- Главный контейнер -->
        <div style="display: flex; gap: 32px; align-items: start; flex-wrap: wrap;">
          
          <!-- Левая колонка: 3D изображение дропа -->
          <div style="flex-shrink: 0; width: 100%; max-width: 320px; margin: 0 auto;">
            <div id="drop-3d-container" style="perspective: 1200px; position: relative;">
              <div id="drop-3d-card" style="
                position: relative;
                width: 100%;
                aspect-ratio: 1;
                transform-style: preserve-3d;
                transition: transform 0.1s ease-out;
                cursor: grab;
              ">
                <!-- Основное изображение (слой 1, глубина 0px) -->
                <div style="
                  position: absolute;
                  inset: 0;
                  border-radius: var(--radius-md);
                  overflow: hidden;
                  transform: translateZ(0px);
                  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                ">
                  <img src="${imageUrl}" style="width: 100%; height: 100%; object-fit: cover;">
                </div>
                
                <!-- Бадж редкости (слой 2, самый верхний, глубина +60px) -->
                <div style="
                  position: absolute;
                  top: 16px;
                  left: 16px;
                  background: linear-gradient(135deg, ${rarity.color}, ${rarity.color}CC);
                  color: #fff;
                  padding: 8px 16px;
                  border-radius: var(--radius-md);
                  font-size: 13px;
                  font-weight: 700;
                  text-transform: uppercase;
                  box-shadow: 0 4px 12px ${rarity.glow}, 0 8px 24px rgba(0,0,0,0.6);
                  transform: translateZ(60px);
                  letter-spacing: 0.5px;
                  border: 2px solid rgba(255,255,255,0.3);
                  backdrop-filter: blur(4px);
                  z-index: 100;
                ">${rarity.label}</div>
              </div>
            </div>
            
            <!-- Статистика под картинкой -->
            <div style="margin-top: 16px; display: flex; gap: 8px;">
              <div style="flex: 1; background: rgba(0,0,0,0.3); padding: 12px; border-radius: var(--radius-md); text-align: center; border: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 4px;">Сложность</div>
                <div style="font-size: 18px; font-weight: 700; color: ${rarity.color};">${'★'.repeat(rarity.difficulty)}</div>
              </div>
              <div style="flex: 1; background: rgba(0,0,0,0.3); padding: 12px; border-radius: var(--radius-md); text-align: center; border: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 4px;">Владельцы</div>
                <div style="font-size: 18px; font-weight: 700; color: var(--text-primary);">${rarity.estimatedOwners}</div>
              </div>
            </div>
            
            <!-- Статус -->
            <div style="margin-top: 8px; background: rgba(0,0,0,0.3); padding: 12px; border-radius: var(--radius-md); text-align: center; border: 1px solid rgba(255,255,255,0.1);">
              <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 4px;">Статус</div>
              <div style="font-size: 18px; font-weight: 700; color: ${statusColor};">${statusText}</div>
            </div>
          </div>
          
          <!-- Правая колонка: Детальная информация -->
          <div style="flex: 1; min-width: 250px;">
            <h2 style="color: var(--text-primary); font-size: 24px; font-weight: 700; margin: 0 0 8px; line-height: 1.2;">${drop.benefitName || drop.name || 'Награда'}</h2>
            <div style="color: ${rarity.color}; font-size: 14px; font-weight: 600; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 0.5px;">${rarity.label}</div>
            
            <!-- Информационные блоки -->
            <div style="display: flex; flex-direction: column; gap: 12px;">
              
              <!-- Игра -->
              <div style="background: rgba(0,0,0,0.3); padding: 14px; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #7c5cff; flex-shrink: 0;">
                    <path d="M21 6H3C2.45 6 2 6.45 2 7V17C2 17.55 2.45 18 3 18H8V20H16V18H21C21.55 18 22 17.55 22 17V7C22 6.45 21.55 6 21 6ZM20 16H4V8H20V16Z"/>
                  </svg>
                  <div style="flex: 1;">
                    <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 2px;">Игра</div>
                    <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);">${campaign?.game?.name || drop.game || 'Неизвестно'}</div>
                  </div>
                </div>
              </div>
              
              <!-- Время получения -->
              <div style="background: rgba(0,0,0,0.3); padding: 14px; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #ff8800; flex-shrink: 0;">
                    <path d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M12 20C7.59 20 4 16.41 4 12S7.59 4 12 4 20 7.59 20 12 16.41 20 12 20M12.5 7V13L17 15.5L16.2 16.9L11 14V7H12.5Z"/>
                  </svg>
                  <div style="flex: 1;">
                    <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 2px;">Время фарма</div>
                    <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);">${requiredMinutes} минут</div>
                  </div>
                </div>
              </div>
              
              <!-- Прогресс -->
              <div style="background: rgba(0,0,0,0.3); padding: 14px; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #7c5cff; flex-shrink: 0;">
                    <path d="M3 13H9V11H3V13M3 17H13V15H3V17M3 9H13V7H3V9M15 7V9H21V7H15M15 11V13H21V11H15M15 15V17H21V15H15Z"/>
                  </svg>
                  <div style="flex: 1;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                      <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 2px;">Прогресс</div>
                      <div style="font-size: 12px; font-weight: 700; color: var(--text-primary);">${progressPercent}%</div>
                    </div>
                    <div style="height: 6px; background: rgba(255,255,255,0.12); border-radius: var(--radius-sm); overflow: hidden; margin: 6px 0 4px;">
                      <div style="height: 100%; width: ${progressPercent}%; background: ${statusColor}; transition: width 0.3s ease;"></div>
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary);">
                      ${requiredMinutes > 0 ? `${progressMinutes} / ${requiredMinutes} мин` : '—'}
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Дата получения -->
              <div style="background: rgba(53, 208, 138,0.1); padding: 14px; border-radius: var(--radius-md); border: 1px solid rgba(53, 208, 138,0.2);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #35d08a; flex-shrink: 0;">
                    <path d="M9 11H7V13H9V11M13 11H11V13H13V11M17 11H15V13H17V11M19 4H18V2H16V4H8V2H6V4H5C3.89 4 3 4.9 3 6V20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V6C21 4.9 20.1 4 19 4M19 20H5V9H19V20Z"/>
                  </svg>
                  <div style="flex: 1;">
                    <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 2px;">Получено</div>
                    <div style="font-size: 15px; font-weight: 600; color: #35d08a;">${claimedDate || '—'}</div>
                  </div>
                </div>
              </div>
              
              ${campaignStart || campaignEnd ? `
              <!-- Период проведения -->
              <div style="background: rgba(0,0,0,0.3); padding: 14px; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: var(--accent-color); flex-shrink: 0;">
                    <path d="M19 4H18V2H16V4H8V2H6V4H5C3.89 4 3 4.9 3 6V20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V6C21 4.9 20.1 4 19 4M19 20H5V9H19V20Z"/>
                  </svg>
                  <div style="flex: 1;">
                    <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 2px;">Период кампании</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${campaignStart || '—'} — ${campaignEnd || '—'}</div>
                  </div>
                </div>
              </div>` : ''}
              
              ${rarity.viewersCount > 0 ? `
              <!-- Зрителей категории -->
              <div style="background: rgba(0,0,0,0.3); padding: 14px; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #00ccff; flex-shrink: 0;">
                    <path d="M12 5.5A3.5 3.5 0 0 1 15.5 9A3.5 3.5 0 0 1 12 12.5A3.5 3.5 0 0 1 8.5 9A3.5 3.5 0 0 1 12 5.5M5 8C5.56 8 6.08 8.15 6.53 8.42C6.38 9.85 6.8 11.27 7.66 12.38C7.16 13.34 6.16 14 5 14C3.34 14 2 12.66 2 11S3.34 8 5 8M19 8C20.66 8 22 9.34 22 11S20.66 14 19 14C17.84 14 16.84 13.34 16.34 12.38C17.2 11.27 17.62 9.85 17.47 8.42C17.92 8.15 18.44 8 19 8M5.5 18.25C5.5 16.18 8.41 14.5 12 14.5S18.5 16.18 18.5 18.25V20H5.5V18.25M0 20V18.5C0 17.11 1.89 15.94 4.45 15.6C3.86 16.28 3.5 17.22 3.5 18.25V20H0M24 20H20.5V18.25C20.5 17.22 20.14 16.28 19.55 15.6C22.11 15.94 24 17.11 24 18.5V20Z"/>
                  </svg>
                  <div style="flex: 1;">
                    <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 2px;">Зрителей категории</div>
                    <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);">${formatViewersCount(rarity.viewersCount)}</div>
                  </div>
                </div>
              </div>` : ''}
              
            </div>
          </div>
        </div>
      </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // 3D эффект наклона под мышкой
    const drop3DCard = document.getElementById('drop-3d-card');
    const drop3DContainer = document.getElementById('drop-3d-container');
    
    let isMouseDown = false;
    
    drop3DContainer.addEventListener('mouseleave', () => {
      if (!isMouseDown) {
        drop3DCard.style.transform = 'rotateX(0deg) rotateY(0deg) scale(1)';
      }
    });
    
    drop3DContainer.addEventListener('mousedown', () => {
      isMouseDown = true;
      drop3DCard.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mouseup', () => {
      isMouseDown = false;
      drop3DCard.style.cursor = 'grab';
    });
    
    drop3DContainer.addEventListener('mousemove', (e) => {
      const rect = drop3DContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateY = ((x - centerX) / centerX) * 25; // -25 до +25 градусов
      const rotateX = ((centerY - y) / centerY) * 25;
      
      drop3DCard.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;
    });
    
    // Закрытие модального окна
    const closeBtn = document.getElementById('close-drop-modal');
    closeBtn.addEventListener('mouseenter', function() {
      this.style.background = 'rgba(255, 255, 255, 0.2)';
      });
    closeBtn.addEventListener('mouseleave', function() {
      this.style.background = 'rgba(255, 255, 255, 0.1)';
      });
    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  };

  // Добавляем CSS анимации
  if (!document.getElementById('drop-modal-animations')) {
    const style = document.createElement('style');
    style.id = 'drop-modal-animations';
    style.textContent = `
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

  console.log('drop-detail-modal.js loaded');
})();
