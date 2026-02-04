const { ipcRenderer } = require('electron');

console.log('[AutoClaim] ✅ Preload loaded');

// Наблюдаем за появлением сундуков и автоматически кликаем на них
function setupChestAutoClaimObserver() {
  // Ищем container который содержит notification о chest reward
  const observer = new MutationObserver(() => {
    // Ищем кнопку клейма для chest reward
    const claimButtons = document.querySelectorAll('[data-test-id="chat-reward-claim-button"]');
    
    for (const btn of claimButtons) {
      // Проверяем что это chest (по классам или атрибутам)
      const parent = btn.closest('[data-test-id="chat-notification"]');
      if (!parent) continue;
      
      // Проверяем если это уже был кликнут
      if (btn.dataset.autoClaimed === 'true') continue;
      
      // Проверяем наличие chest иконки
      const isChest = parent.textContent.includes('Chest') || 
                      parent.innerHTML.includes('chest') ||
                      parent.innerHTML.includes('Reward');
      
      if (isChest) {
        console.log('[AutoClaim] Found chest reward, clicking...');
        btn.click();
        btn.dataset.autoClaimed = 'true';
        
        // Отправляем уведомление в main process
        ipcRenderer.send('chest-claimed', { timestamp: Date.now() });
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  console.log('[AutoClaim] Observer setup complete');
}

// Альтернативный способ - ищем через React Fiber
function setupChestAutoClaimViaReact() {
  // Проверяем каждые 500мс на наличие notification элементов
  const checkInterval = setInterval(() => {
    try {
      // Ищем элементы notification которые недавно добавлены
      const notifications = document.querySelectorAll('[data-a-target="chat-notification"]');
      
      for (const notif of notifications) {
        // Ищем кнопку в notification
        const claimBtn = notif.querySelector('button');
        if (!claimBtn) continue;
        
        // Проверяем что это chest (ищем по текста или иконкам)
        const hasChestIcon = notif.innerHTML.includes('chest') || 
                            notif.innerHTML.includes('Chest') ||
                            notif.innerHTML.includes('reward-chest');
        
        const hasClaimText = claimBtn.textContent.toLowerCase().includes('claim');
        
        if (hasChestIcon && hasClaimText && !notif.dataset.claimed) {
          console.log('[AutoClaim] Found chest notification, claiming...');
          claimBtn.click();
          notif.dataset.claimed = 'true';
          ipcRenderer.send('chest-claimed', { timestamp: Date.now() });
        }
      }
    } catch (e) {
      console.warn('[AutoClaim] Check error:', e.message);
    }
  }, 500);

  // Отправляем интервал в window чтобы его можно было остановить
  window.__autoClaimInterval = checkInterval;
}

// Более целевой способ через обсервер на появление модального окна
function setupChestAutoClaimModal() {
  let lastNotificationTime = 0;
  
  const observer = new MutationObserver((mutations) => {
    const now = Date.now();
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          // Проверяем добавленные элементы
          if (node.nodeType === 1) { // Element node
            const isChestReward = node.querySelector && (
              node.querySelector('[data-test-id="chat-notification-reward"]') ||
              node.querySelector('.rewards-list') ||
              node.innerHTML?.includes('Chest')
            );
            
            if (isChestReward && now - lastNotificationTime > 1000) {
              lastNotificationTime = now;
              
              // Даем немного времени на рендер
              setTimeout(() => {
                const claimButtons = node.querySelectorAll('button');
                for (const btn of claimButtons) {
                  if (btn.textContent.includes('Claim')) {
                    console.log('[AutoClaim] Claiming chest from modal...');
                    btn.click();
                    ipcRenderer.send('chest-claimed', { timestamp: Date.now() });
                    break;
                  }
                }
              }, 100);
            }
          }
        }
      }
    }
  });

  // Наблюдаем за change-list или похожей структурой
  const notificationContainer = document.querySelector('[class*="notification"]') || document.body;
  observer.observe(notificationContainer, {
    childList: true,
    subtree: true
  });

  console.log('[AutoClaim] Modal observer setup');
}

// Запускаем все методы
try {
  setupChestAutoClaimObserver();
  setupChestAutoClaimViaReact();
  setupChestAutoClaimModal();
  console.log('[AutoClaim] ✅ All auto-claim methods initialized');
} catch (e) {
  console.warn('[AutoClaim] Setup error:', e.message);
}

// Слушаем сообщение от renderer чтобы остановить auto-claim если отключено
ipcRenderer.on('auto-claim-toggle', (event, enabled) => {
  if (enabled) {
    console.log('[AutoClaim] Enabled');
    if (window.__autoClaimInterval) {
      clearInterval(window.__autoClaimInterval);
    }
    setupChestAutoClaimViaReact();
  } else {
    console.log('[AutoClaim] Disabled');
    if (window.__autoClaimInterval) {
      clearInterval(window.__autoClaimInterval);
    }
  }
});

console.log('[AutoClaim] ✅ Preload fully initialized');
