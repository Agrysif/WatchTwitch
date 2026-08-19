/**
 * Окно с подробностями категории.
 *
 * Это 330 строк шаблона разметки: обложка, счётчики, кампании дропсов.
 * К управлению фармингом отношения не имеет, поэтому вынесено из
 * farming-page.js. Страница передаётся первым аргументом ради трёх
 * вспомогательных методов форматирования.
 */
window.showCategoryDetailsModal = async function (page, category) {
  const i18n = window.i18n;
  
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
    max-width: 900px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    animation: slideUp 0.3s ease;
  `;

  modalContent.innerHTML = `
    <div style="position: relative; padding: 24px; padding-bottom: 32px;">
      <button id="close-category-modal" style="position: absolute; top: 16px; right: 16px; background: rgba(255, 255, 255, 0.1); border: none; width: 32px; height: 32px; border-radius: var(--radius-circle); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; z-index: 10;" onmouseover="this.style.background='rgba(255, 255, 255, 0.2)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.1)'">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="color: var(--text-primary);">
          <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <!-- Двухколоночный layout -->
      <div style="display: flex; gap: 24px; align-items: start; margin-top: 8px;">
        
        <!-- Левая колонка: Карточка категории -->
        <div style="flex-shrink: 0; width: 280px;">
          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 20px; position: sticky; top: 0;">
            <div id="cover-container" style="perspective: 1000px; margin-bottom: 16px;">
              <img id="category-cover" src="${page.getHighQualityBoxArt(category.boxArtURL)}" 
                   alt="${category.name}"
                   style="width: 100%; aspect-ratio: 3/4; border-radius: var(--radius-md); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); object-fit: cover; transition: transform 0.1s ease-out, box-shadow 0.3s; transform-style: preserve-3d; cursor: pointer;">
            </div>
            
            <h2 style="color: var(--text-primary); font-size: 22px; font-weight: 700; margin: 0 0 16px; line-height: 1.2;">${category.name}</h2>
            
            <div id="category-info-blocks" style="display: flex; flex-direction: column; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 8px; padding: 10px; background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.2); border-radius: var(--radius-md);">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style="color: #7c5cff; flex-shrink: 0;">
                  <path d="M8 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 14c0-2.21 1.79-4 4-4s4 1.79 4 4H4z"/>
                </svg>
                <div style="flex: 1;">
                  <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Зрители</div>
                  <div style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${page.formatViewersCount(category.viewersCount)}</div>
                </div>
              </div>
              
              ${category.hasDrops ? `
              <div style="display: flex; align-items: center; gap: 8px; padding: 10px; background: rgba(53, 208, 138, 0.1); border: 1px solid rgba(53, 208, 138, 0.2); border-radius: var(--radius-md);">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style="color: #35d08a; flex-shrink: 0;">
                  <path d="M8 2L10 6H14L11 9L12 13L8 10.5L4 13L5 9L2 6H6L8 2Z"/>
                </svg>
                <div style="flex: 1;">
                  <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Статус</div>
                  <div style="font-size: 13px; font-weight: 600; color: #35d08a;">Дропсы доступны</div>
                </div>
              </div>` : ''}
            </div>
          </div>
        </div>

        <!-- Правая колонка: Список стримов -->
        <div style="flex: 1; min-width: 0; margin-right: 40px;">
          <div id="streams-scroll-container" style="max-height: calc(85vh - 80px); overflow-y: auto; padding-right: 8px; padding-bottom: 8px; scroll-behavior: smooth;">
            <div id="category-streams-loading" style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
              <div style="width: 40px; height: 40px; border: 3px solid rgba(124, 92, 255, 0.3); border-top-color: #7c5cff; border-radius: var(--radius-circle); animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
              <div style="font-size: 14px;">Загрузка стримов...</div>
            </div>

            <div id="category-streams-content" style="display: none;"></div>
          </div>
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
    setTimeout(() => document.body.removeChild(modal), 200);
  };

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.getElementById('close-category-modal').addEventListener('click', closeModal);

  // 3D эффект наклона обложки при наведении мыши (как в Resident Evil)
  const coverContainer = document.getElementById('cover-container');
  const categoryCover = document.getElementById('category-cover');
  
  if (coverContainer && categoryCover) {
    coverContainer.addEventListener('mousemove', (e) => {
      const rect = coverContainer.getBoundingClientRect();
      const x = e.clientX - rect.left; // позиция X относительно контейнера
      const y = e.clientY - rect.top;  // позиция Y относительно контейнера
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      // Вычисляем углы наклона (от -15 до 15 градусов)
      const rotateX = ((y - centerY) / centerY) * -15; // инвертируем для естественного эффекта
      const rotateY = ((x - centerX) / centerX) * 15;
      
      // Применяем трансформацию
      categoryCover.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;
      categoryCover.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.6)';
    });
    
    coverContainer.addEventListener('mouseleave', () => {
      // Возвращаем в исходное положение
      categoryCover.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
      categoryCover.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
    });
  }

  // Загружаем стримы с дропсами
  try {
    const streams = await window.electronAPI.getStreamsWithDrops(category.name);
    const loadingEl = document.getElementById('category-streams-loading');
    const contentEl = document.getElementById('category-streams-content');

    if (!streams || streams.length === 0) {
      loadingEl.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary); margin-bottom: 12px;">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div style="color: var(--text-secondary); font-size: 14px;">Нет стримов с дропсами</div>
        </div>
      `;
      return;
    }

    // Получаем информацию о всех стримах
    const topStreams = streams;
    const accounts = await Storage.getAccounts();
    const authToken = accounts.find(acc => acc.loginMethod === 'oauth')?.authToken;

    const streamsData = await Promise.all(
      topStreams.map(async (stream) => {
        const details = await window.electronAPI.getChannelDetails(authToken, stream.login);
        console.log(`[CategoryModal] Stream ${stream.login}:`, { 
          profileImageUrl: details.profileImageUrl, 
          displayName: stream.display_name || stream.displayName,
          merged: { ...stream, ...details }
        });
        return { ...stream, ...details };
      })
    );

    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    
    // Обновляем левую колонку с количеством стримеров
    const categoryInfoBlocks = document.getElementById('category-info-blocks');
    if (categoryInfoBlocks) {
      categoryInfoBlocks.innerHTML += `
        <div style="display: flex; align-items: center; gap: 8px; padding: 10px; background: rgba(255, 87, 51, 0.1); border: 1px solid rgba(255, 87, 51, 0.2); border-radius: var(--radius-md);">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style="color: #ff5733; flex-shrink: 0;">
            <path d="M2 2v12h12V2H2zm10 10H4V4h8v8z"/>
            <circle cx="8" cy="8" r="2" fill="currentColor"/>
            <path d="M1 4h1v8H1V4zm13 0h1v8h-1V4z"/>
          </svg>
          <div style="flex: 1;">
            <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Стримеров онлайн</div>
            <div style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${streams.length}</div>
          </div>
        </div>
      `;
    }

    contentEl.innerHTML = `
      <div>
        <h3 style="color: var(--text-primary); font-size: 18px; font-weight: 700; margin: 0 0 20px; display: flex; align-items: center; gap: 10px;">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" style="color: #7c5cff;">
            <path d="M8 2L10 6H14L11 9L12 13L8 10.5L4 13L5 9L2 6H6L8 2Z"/>
          </svg>
          Топ стримы с дропсами
          <span style="background: rgba(124, 92, 255, 0.15); color: #7c5cff; padding: 2px 8px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 700;">${streams.length}</span>
        </h3>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${streamsData.map((stream, index) => `
            <div class="stream-card-clickable" 
                 style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; display: flex; gap: 14px; align-items: center; transition: all 0.2s; cursor: pointer; position: relative; overflow: hidden;" 
                 onmouseover="this.style.borderColor='#7c5cff'; this.style.boxShadow='0 4px 16px rgba(124, 92, 255, 0.3)'; this.style.transform='translateY(-2px)'" 
                 onmouseout="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none'; this.style.transform='translateY(0)'"
                 onclick="window.farmingPage.startStreamFromModal('${stream.login}', '${category.id}')">
              
              <!-- Фон gradient при наведении -->
              <div style="position: absolute; inset: 0; background: rgba(124, 92, 255, 0.05); opacity: 0; transition: opacity 0.2s; pointer-events: none;" class="stream-hover-bg"></div>
              
              <!-- Аватар стримера -->
              <div style="position: relative; flex-shrink: 0; z-index: 1;">
                <img src="${stream.profileImageUrl || stream.thumbnail_url?.replace('{width}', '70').replace('{height}', '70') || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-70x70.png'}" 
                     alt="${stream.display_name || stream.user_name || stream.login}"
                     onerror="this.onerror=null; this.src='https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-70x70.png'; console.error('[Avatar] Failed to load for ${stream.login}', this.src);"
                     onload="console.log('[Avatar] Loaded for ${stream.login}');"
                     style="width: 64px; height: 64px; border-radius: var(--radius-circle); border: 3px solid ${index === 0 ? '#ffd700' : 'var(--border-color)'}; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);">
                ${stream.isLive ? '<div style="position: absolute; bottom: 2px; right: 2px; width: 16px; height: 16px; background: #ff0000; border: 3px solid var(--bg-primary); border-radius: var(--radius-circle); box-shadow: 0 0 12px rgba(255, 0, 0, 0.8); animation: pulse-live 2s ease-in-out infinite;"></div>' : ''}
                ${index === 0 ? '<div style="position: absolute; top: -6px; left: -6px; background: #ffd700; color: #000; padding: 3px 8px; border-radius: var(--radius-md); font-size: 9px; font-weight: 800; box-shadow: 0 2px 6px rgba(255, 215, 0, 0.4);">TOP</div>' : ''}
              </div>
              
              <!-- Информация о стриме -->
              <div style="flex: 1; min-width: 0; z-index: 1;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
                  <div style="font-weight: 700; font-size: 16px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${stream.display_name || stream.displayName || stream.user_name || stream.login}</div>
                  ${stream.isLive ? `
                  <div style="display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; background: rgba(255, 0, 0, 0.2); border: 1px solid rgba(255, 0, 0, 0.4); border-radius: var(--radius-md); font-size: 11px; font-weight: 700; color: #ff4444;">
                    <span style="width: 6px; height: 6px; background: #ff0000; border-radius: var(--radius-circle); box-shadow: 0 0 4px rgba(255, 0, 0, 0.8);"></span>
                    LIVE
                  </div>` : ''}
                  ${stream.isPartner ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="#7c5cff" title="Партнер Twitch"><path d="M12.5 3.5L8 2L3.5 3.5L2 8L3.5 12.5L8 14L12.5 12.5L14 8L12.5 3.5ZM7 11L4 8L5.41 6.59L7 8.17L10.59 4.58L12 6L7 11Z"/></svg>' : ''}
                </div>
                
                <div style="color: var(--text-secondary); font-size: 12px; margin-bottom: 8px; font-family: 'Consolas', monospace;">@${stream.login}</div>
                
                <!-- Статистика -->
                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                  ${stream.viewersCount ? `
                  <div style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color: #7c5cff;">
                      <path d="M8 2C4.5 2 1.5 4.5 0 8c1.5 3.5 4.5 6 8 6s6.5-2.5 8-6c-1.5-3.5-4.5-6-8-6zm0 10c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4zm0-6.5c-1.4 0-2.5 1.1-2.5 2.5s1.1 2.5 2.5 2.5 2.5-1.1 2.5-2.5-1.1-2.5-2.5-2.5z"/>
                    </svg>
                    <span style="color: var(--text-primary); font-weight: 600;">${page.formatViewersCount(stream.viewersCount)}</span>
                    <span style="color: var(--text-tertiary); font-size: 11px;">зрителей</span>
                  </div>` : ''}
                  ${stream.followers ? `
                  <div style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color: #e91e63;">
                      <path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/>
                    </svg>
                    <span style="color: var(--text-primary); font-weight: 600;">${page.formatFollowers(stream.followers)}</span>
                    <span style="color: var(--text-tertiary); font-size: 11px;">подписчиков</span>
                  </div>` : ''}
                  ${stream.language ? `
                  <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary);">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z"/>
                    </svg>
                    ${stream.language.toUpperCase()}
                  </div>` : ''}
                </div>
                
                ${stream.title ? `
                <div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                  ${stream.title}
                </div>` : ''}
              </div>
              
              <!-- Кнопка запуска -->
              <button style="flex-shrink: 0; background: #7c5cff; color: white; border: none; padding: 12px 20px; border-radius: var(--radius-md); font-size: 14px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s; box-shadow: none; z-index: 1;" 
                      onmouseover="this.style.boxShadow='0 6px 20px rgba(124, 92, 255, 0.5)'" 
                      onmouseout="this.style.boxShadow='0 4px 12px rgba(124, 92, 255, 0.3)'">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2L14 8L4 14V2Z"/>
                </svg>
                Запустить
              </button>
            </div>
          `).join('')}
        </div>
      </div>

      ${streamsData[0].description ? `
      <div style="margin-top: 24px; padding: 16px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
        <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color: #7c5cff;">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7 5h2v2H7V5zm0 3h2v5H7V8z"/>
          </svg>
          О канале ${streamsData[0].displayName}
        </div>
        <div style="font-size: 13px; line-height: 1.6; color: var(--text-secondary);">${streamsData[0].description}</div>
      </div>` : ''}
      
      <style>
        .stream-card-clickable:hover .stream-hover-bg {
          opacity: 1 !important;
        }
        
        /* Кастомный скроллбар для списка стримов */
        #streams-scroll-container::-webkit-scrollbar {
          width: 8px;
        }
        
        #streams-scroll-container::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: var(--radius-sm);
        }
        
        #streams-scroll-container::-webkit-scrollbar-thumb {
          background: #7c5cff;
          border-radius: var(--radius-sm);
          transition: background 0.2s;
        }
        
        #streams-scroll-container::-webkit-scrollbar-thumb:hover {
          background: #a55fff;
        }
      </style>
    `;

  } catch (error) {
    console.error('Error loading category details:', error);
    document.getElementById('category-streams-loading').innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
        Ошибка загрузки данных
      </div>
    `;
  }
};
