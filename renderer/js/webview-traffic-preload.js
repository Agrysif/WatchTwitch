const { ipcRenderer } = require('electron');

let pendingBytes = 0;

console.log('[WebviewTraffic] ✅ Preload loaded');

function addBytes(count) {
  if (Number.isFinite(count) && count > 0) {
    pendingBytes += count;
    console.log('[WebviewTraffic] +' + count + ' bytes → total pending: ' + pendingBytes);
  }
}

// Observe resource loads and accumulate transfer sizes
try {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (typeof entry.transferSize === 'number' && entry.transferSize > 0) {
        console.log('[WebviewTraffic] Performance entry:', entry.name.substring(0, 100), '→', entry.transferSize);
        addBytes(entry.transferSize);
      }
    }
  });

  observer.observe({ entryTypes: ['resource'] });
  console.log('[WebviewTraffic] ✅ PerformanceObserver ready');
} catch (e) {
  console.warn('[WebviewTraffic] ❌ PerformanceObserver error:', e.message);
}

// Intercept fetch and count bytes from the response stream
try {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      if (response && response.body && response.clone) {
        const clone = response.clone();
        const reader = clone.body.getReader();
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength) total += value.byteLength;
        }
        if (total > 0) {
          console.log('[WebviewTraffic] Fetch response:', args[0], '→', total, 'bytes');
          addBytes(total);
        }
      }
    } catch (_) {
      // ignore
    }
    return response;
  };
  console.log('[WebviewTraffic] ✅ Fetch interceptor ready');
} catch (e) {
  console.warn('[WebviewTraffic] ❌ Fetch interceptor error:', e.message);
}

// Intercept XHR and count bytes via progress events
try {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args) {
    this.__lastLoaded = 0;
    this.__url = args[1];
    return originalOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('progress', (event) => {
      if (event && typeof event.loaded === 'number') {
        const delta = event.loaded - (this.__lastLoaded || 0);
        this.__lastLoaded = event.loaded;
        if (delta > 0) {
          console.log('[WebviewTraffic] XHR progress:', this.__url, '→ +' + delta + ' bytes');
          addBytes(delta);
        }
      }
    });
    return originalSend.apply(this, args);
  };
  console.log('[WebviewTraffic] ✅ XHR interceptor ready');
} catch (e) {
  console.warn('[WebviewTraffic] ❌ XHR interceptor error:', e.message);
}

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

// Report bytes to main process every 500ms
setInterval(() => {
  if (pendingBytes > 0) {
    console.log('[WebviewTraffic] 📤 Sending', pendingBytes, 'bytes to main');
    try {
      ipcRenderer.send('webview-traffic', pendingBytes);
      pendingBytes = 0;
    } catch (e) {
      console.warn('[WebviewTraffic] ❌ send failed:', e.message);
    }
  }
}, 500);

console.log('[WebviewTraffic] ✅ Preload fully initialized');
