const { ipcRenderer } = require('electron');

// Подсчёт трафика здесь НЕ ведётся намеренно.
// Единственный источник цифр — CDP-событие Network.dataReceived в main-процессе
// (см. setupTrafficMonitoring в main.js). Оно покрывает все webContents, включая
// этот webview, поэтому любой подсчёт на стороне страницы был бы дублем.
// Раньше здесь стояли PerformanceObserver + перехват fetch/XHR: они не только
// задваивали цифры, но и дочитывали тело каждого ответа (включая видео-сегменты),
// что бессмысленно нагружало плеер.

console.log('[WebviewPreload] ✅ Preload loaded');

// ================================
// Auto-claim channel points chests
// ================================
let autoClaimEnabled = true;

async function refreshAutoClaimSetting() {
  try {
    const setting = await ipcRenderer.invoke('store-get', 'settings.autoClaimDrops');
    autoClaimEnabled = typeof setting === 'boolean' ? setting : true;
    console.log('[AutoClaim] Setting autoClaimDrops:', autoClaimEnabled);
  } catch (e) {
    console.warn('[AutoClaim] Failed to read setting, defaulting to enabled:', e.message);
    autoClaimEnabled = true;
  }
}

function isChatPage() {
  try {
    const href = window.location.href || '';
    return href.includes('twitch.tv') && (href.includes('/chat') || href.includes('popout') || href.includes('embed'));
  } catch (_) {
    return false;
  }
}

function findClaimButtons() {
  const selectors = [
    'button[data-test-id="chat-reward-claim-button"]',
    'button[data-a-target="chat-reward-claim-button"]',
    'button[aria-label="Claim Bonus"]',
    'button[aria-label="Claim"]'
  ];
  for (const selector of selectors) {
    const buttons = document.querySelectorAll(selector);
    if (buttons && buttons.length) return buttons;
  }
  return [];
}

function tryClaimChests() {
  if (!autoClaimEnabled) return;
  if (!isChatPage()) return;

  const buttons = findClaimButtons();
  if (!buttons.length) return;

  for (const btn of buttons) {
    if (btn.dataset.autoClaimed === 'true') continue;

    const notification = btn.closest('[data-test-id="chat-notification"]') || btn.closest('[data-a-target="chat-notification"]');
    if (notification && notification.dataset.autoClaimed === 'true') continue;

    btn.dataset.autoClaimed = 'true';
    if (notification) notification.dataset.autoClaimed = 'true';

    console.log('[AutoClaim] Claiming chest reward...');
    try {
      btn.click();
      ipcRenderer.send('chest-claimed', { timestamp: Date.now() });
    } catch (e) {
      console.warn('[AutoClaim] Click failed:', e.message);
    }
  }
}

function setupAutoClaimObserver() {
  try {
    const observer = new MutationObserver(() => {
      tryClaimChests();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[AutoClaim] ✅ MutationObserver ready');
  } catch (e) {
    console.warn('[AutoClaim] ❌ Observer error:', e.message);
  }
}

refreshAutoClaimSetting();
setInterval(refreshAutoClaimSetting, 30000);
setupAutoClaimObserver();
setInterval(tryClaimChests, 1000);

console.log('[WebviewPreload] ✅ Preload fully initialized');
