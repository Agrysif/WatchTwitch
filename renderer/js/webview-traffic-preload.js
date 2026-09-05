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
// Качество плеера
// ================================
//
// Плеер Twitch игнорирует параметр quality в адресе: качество он берёт из
// собственного localStorage. Записать значение после загрузки страницы
// недостаточно — плеер к тому моменту уже выбрал поток. Preload выполняется
// ДО скриптов страницы, поэтому запись отсюда попадает вовремя.
(async function applyPlayerQuality() {
  try {
    if (!location.host.includes('player.twitch.tv')) return;

    let quality = await ipcRenderer.invoke('store-get', 'settings.preferredStreamQuality');
    const known = ['160p30', '360p30', '480p30', '720p60', 'chunked'];
    if (!known.includes(quality)) quality = '160p30';

    localStorage.setItem('video-quality', JSON.stringify({ default: quality }));
    console.log('[PlayerPreload] Качество задано до запуска плеера:', quality);
  } catch (e) {
    console.warn('[PlayerPreload] Не удалось задать качество:', e.message);
  }
})();

// ================================
// Принудительно низкое качество видео
// ================================
// Параметр quality= в URL встроенный плеер Twitch игнорирует, а прокликивание
// меню настроек скриптом срабатывает не всегда. Надёжный способ — записать
// предпочтение в localStorage ДО загрузки скриптов плеера: preload выполняется
// раньше страницы, поэтому плеер стартует сразу в нужном качестве.
// Без этого стрим шёл в исходном качестве: около 10 Мбит/с трафика и
// заметная нагрузка на процессор от декодирования 1080p ради фарма дропсов.
try {
  const host = window.location.hostname || '';
  if (host.includes('twitch.tv')) {
    localStorage.setItem('video-quality', '{"default":"160p30"}');
    console.log('[WebviewPreload] ✅ Качество видео зафиксировано на 160p30');
  }
} catch (e) {
  console.warn('[WebviewPreload] Не удалось задать качество видео:', e.message);
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

/**
 * Наблюдатель за чатом с задержкой.
 *
 * Раньше здесь стояли наблюдатель без задержки и интервал в одну секунду
 * разом: в живом чате каждое сообщение запускало поиск кнопок по всему
 * документу, а между сообщениями его запускал таймер. Причём наблюдатель
 * подключался, пока document.body ещё не существовал, и молча падал —
 * всю работу делал интервал. Сундук появляется раз в четверть часа, и
 * ждать его можно спокойно: одна проверка через 300 мс после последнего
 * изменения в чате, и страховочная — раз в минуту.
 */
function setupAutoClaimObserver() {
  if (!isChatPage()) {
    console.log('[AutoClaim] Не страница чата — автосбор здесь не нужен');
    return;
  }

  let pending = null;
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      tryClaimChests();
    }, 300);
  };

  try {
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[AutoClaim] ✅ MutationObserver ready');
  } catch (e) {
    console.warn('[AutoClaim] ❌ Observer error:', e.message);
  }

  setInterval(tryClaimChests, 60000);
  tryClaimChests();
}

refreshAutoClaimSetting();
setInterval(refreshAutoClaimSetting, 60000);

// Preload выполняется до разбора страницы: body появится позже
if (document.body) {
  setupAutoClaimObserver();
} else {
  document.addEventListener('DOMContentLoaded', setupAutoClaimObserver, { once: true });
}

console.log('[WebviewPreload] ✅ Preload fully initialized');
