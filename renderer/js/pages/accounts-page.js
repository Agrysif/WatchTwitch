// Accounts page logic
function initAccountsPage() {
  console.log('Initializing accounts page...');
  
  // Load and render accounts
  loadAndRenderAccounts();
  
  // Setup event listeners
  const addTwitchBtn = document.getElementById('add-twitch-btn');
  const addCookiesBtn = document.getElementById('add-cookies-btn');
  const openBrowserBtn = document.getElementById('open-browser-btn');
  
  if (addTwitchBtn) {
    addTwitchBtn.addEventListener('click', handleTwitchLogin);
  }

  if (addCookiesBtn) {
    addCookiesBtn.addEventListener('click', handleCookiesLogin);
  }

  if (openBrowserBtn) {
    openBrowserBtn.addEventListener('click', () => {
      window.electronAPI.openExternal('https://www.twitch.tv/');
    });
  }
}

async function loadAndRenderAccounts() {
  const accounts = await Storage.getAccounts();
  renderAccounts(accounts);
}

function renderAccounts(accounts) {
  const container = document.getElementById('accounts-list');
  
  if (!container) return;
  
  if (accounts.length === 0) {
    container.innerHTML = `
      <div class="no-accounts" style="text-align: center; padding: 60px; color: var(--text-secondary);">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="opacity: 0.3; margin: 0 auto;">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke-width="2"/>
          <circle cx="12" cy="7" r="4" stroke-width="2"/>
        </svg>
        <p style="margin-top: 16px;">Нет добавленных аккаунтов</p>
      </div>
    `;
    return;
  }

  container.innerHTML = accounts.map(account => {
    const lastLogin = account.lastLogin ? new Date(account.lastLogin).toLocaleString() : 'Never';
    const avatarContent = account.avatar 
      ? `<img src="${account.avatar}" alt="${account.username}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` 
      : account.username.charAt(0).toUpperCase();
    
    // Проверяем статус аккаунта: активен только если OAuth авторизация
    const isActive = account.loginMethod === 'oauth';
    const isTwitchLoggedIn = account.twitchLoggedIn || false; // Новый флаг для входа в Twitch
    const statusClass = (isActive && isTwitchLoggedIn) ? 'connected' : 'warning';
    const tokenExpiringSoon = isActive && account.oauthExpiresAt && (new Date(account.oauthExpiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000); // 7 дней
    const finalStatusClass = tokenExpiringSoon ? 'warning' : statusClass;
    const statusIcon = (isActive && isTwitchLoggedIn)
      ? '<circle cx="12" cy="12" r="5"/>' 
      : '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>';
    const statusText = tokenExpiringSoon 
      ? 'Токен скоро истечет' 
      : (isActive && isTwitchLoggedIn ? 'Активен' : (!isActive ? 'Требуется OAuth' : 'Требуется вход в Twitch'));
    
    return `
    <div class="account-card scale-in ${!isActive || !isTwitchLoggedIn ? 'inactive-account' : ''}" draggable="true" data-username="${account.username}" data-priority="${account.priority || 0}">
      <div class="account-avatar">
        ${avatarContent}
      </div>
      <div class="account-info">
        <div class="account-username">${account.username}</div>
        <div class="account-meta">
          Added ${new Date(account.addedAt).toLocaleDateString()} • 
          ${account.loginMethod === 'oauth' ? 'OAuth' : 'Cookies'} •
          Last: ${lastLogin}
        </div>
        ${!isActive ? `<div style="font-size: 12px; color: #ff9147; margin-top: 6px;">
          ⚠️ Для корректной работы необходима OAuth авторизация
        </div>` : ''}
        ${isActive && !isTwitchLoggedIn ? `<div style="font-size: 12px; color: #ff9147; margin-top: 6px;">
          ⚠️ Требуется вход в Twitch для фарминга дропсов и баллов
        </div>` : ''}
        ${tokenExpiringSoon ? `<div style="font-size: 12px; color: #ff9147; margin-top: 6px;">
          ⏰ OAuth токен истечет ${new Date(account.oauthExpiresAt).toLocaleDateString()}
        </div>` : ''}
      </div>
      <div style="display: flex; align-items: center; margin-right: 8px; cursor: grab; color: var(--text-tertiary);" class="drag-handle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.5;">
          <circle cx="6" cy="12" r="2"/>
          <circle cx="18" cy="12" r="2"/>
          <circle cx="6" cy="5" r="2"/>
          <circle cx="18" cy="5" r="2"/>
          <circle cx="6" cy="19" r="2"/>
          <circle cx="18" cy="19" r="2"/>
        </svg>
      </div>
      <div class="account-status ${finalStatusClass}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          ${statusIcon}
        </svg>
        <span>${statusText}</span>
      </div>
      <div class="account-actions">
        ${!isActive ? `<button class="account-btn activate" data-username="${account.username}" title="Активировать через OAuth">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M9 11l3 3L22 4" stroke-width="2"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke-width="2"/>
          </svg>
        </button>` : ''}
        ${isActive && !isTwitchLoggedIn ? `<button class="account-btn login-twitch" data-username="${account.username}" title="Войти в Twitch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
          </svg>
        </button>` : ''}
        <button class="account-btn delete" data-username="${account.username}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke-width="2"/>
          </svg>
        </button>
      </div>
    </div>
  `}).join('');

  // Setup login to Twitch buttons
  container.querySelectorAll('.account-btn.login-twitch').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.getAttribute('data-username');
      await handleTwitchWebLogin(username);
    });
  });

  // Setup activate buttons
  container.querySelectorAll('.account-btn.activate').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.getAttribute('data-username');
      window.utils.showToast('Открываем OAuth авторизацию...', 'info');
      
      try {
        const result = await window.electronAPI.startTwitchAuth();
        
        if (result && result.success && result.user) {
          // Обновляем существующий аккаунт с OAuth данными
          const accounts = await Storage.getAccounts();
          const accountIndex = accounts.findIndex(a => a.username === username);
          
          if (accountIndex >= 0) {
            accounts[accountIndex] = {
              ...accounts[accountIndex],
              loginMethod: 'oauth',
              displayName: result.user.displayName,
              avatar: result.user.profileImageUrl || accounts[accountIndex].avatar,
              email: result.user.email,
              lastLogin: Date.now(),
              oauthExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // 60 дней
            };
            
            await Storage.set('accounts', accounts);
            await loadAndRenderAccounts();
            window.utils.showToast(`Аккаунт ${username} активирован!`, 'success');
          }
        }
      } catch (error) {
        console.error('Activation error:', error);
        window.utils.showToast(`Ошибка активации: ${error.message}`, 'error');
      }
    });
  });

  // Setup delete buttons
  container.querySelectorAll('.account-btn.delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.getAttribute('data-username');
      
      // Show custom confirmation modal
      const confirmModal = document.createElement('div');
      confirmModal.className = 'auth-modal';
      confirmModal.innerHTML = `
        <div class="auth-modal-overlay"></div>
        <div class="auth-modal-content" style="width: 400px;">
          <div class="auth-modal-header">
            <h3>Удалить аккаунт</h3>
          </div>
          <div class="auth-modal-body">
            <p style="color: var(--text-secondary); margin-bottom: 24px;">
              Вы уверены, что хотите удалить аккаунт <strong style="color: var(--text-primary);">${username}</strong>?
            </p>
            <div style="display: flex; gap: 12px;">
              <button class="btn btn-danger confirm-delete" style="flex: 1;">Удалить</button>
              <button class="btn btn-secondary cancel-delete" style="flex: 1;">Отмена</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(confirmModal);
      
      confirmModal.querySelector('.confirm-delete').addEventListener('click', async () => {
        await Storage.removeAccount(username);
        await loadAndRenderAccounts();
        window.utils.showToast(`Аккаунт ${username} удален`, 'success');
        document.body.removeChild(confirmModal);
      });
      
      confirmModal.querySelector('.cancel-delete').addEventListener('click', () => {
        document.body.removeChild(confirmModal);
      });
      
      confirmModal.querySelector('.auth-modal-overlay').addEventListener('click', () => {
        document.body.removeChild(confirmModal);
      });
    });
  });

  // Setup drag-and-drop reordering
  setupAccountDragAndDrop();
}

function setupAccountDragAndDrop() {
  const container = document.getElementById('accounts-list');
  if (!container) return;

  let draggedElement = null;

  const accountCards = container.querySelectorAll('.account-card');

  accountCards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedElement = card;
      card.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
      draggedElement = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      const afterElement = getDragAfterElement(container, e.clientY);
      if (afterElement == null) {
        container.appendChild(draggedElement);
      } else {
        container.insertBefore(draggedElement, afterElement);
      }
    });

    card.addEventListener('drop', async () => {
      // Save new order
      const cards = container.querySelectorAll('.account-card');
      const accounts = await Storage.getAccounts();
      
      cards.forEach((card, index) => {
        const username = card.getAttribute('data-username');
        const accountIndex = accounts.findIndex(a => a.username === username);
        if (accountIndex >= 0) {
          accounts[accountIndex].priority = index;
        }
      });

      await Storage.set('accounts', accounts);
      window.utils.showToast('Порядок аккаунтов обновлен', 'success');
    });
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.account-card:not([style*="opacity"])')]
    .filter(el => el.style.opacity !== '0.5');

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function handleTwitchLogin() {
  try {
    console.log('handleTwitchLogin called - opening browser for OAuth');
    window.utils.showToast('Открываю браузер для авторизации...', 'info');
    
    const result = await window.electronAPI.startTwitchAuth();
    console.log('Auth result:', result);
    
    if (result && result.success && result.user) {
      const account = {
        username: result.user.login,
        displayName: result.user.displayName,
        avatar: result.user.profileImageUrl || '',
        email: result.user.email,
        cookies: null,
        loginMethod: 'oauth',
        twitchLoggedIn: false, // По умолчанию требуется вход в Twitch
        addedAt: Date.now(),
        lastLogin: Date.now(),
        oauthExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // 60 дней
      };
      
      await Storage.saveAccount(account);
      await loadAndRenderAccounts();
      window.utils.showToast(`Добро пожаловать, ${account.displayName}!`, 'success');
    } else {
      throw new Error(result.error || 'Авторизация не удалась');
    }
  } catch (error) {
    console.error('Login error:', error);
    window.utils.showToast(`Ошибка входа: ${error.message}`, 'error');
  }
}

async function handleTwitchWebLogin(username) {
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-modal-overlay"></div>
    <div class="auth-modal-content" style="width: 700px; max-height: 90vh;">
      <div class="auth-modal-header">
        <h3>🔐 Вход в Twitch</h3>
        <button class="close-modal">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>
      </div>
      <div class="auth-modal-body">
        <div style="background: rgba(145, 71, 255, 0.1); border: 1px solid rgba(145, 71, 255, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="vertical-align: middle; margin-right: 6px;">
              <circle cx="12" cy="12" r="10" stroke-width="2"/>
              <path d="M12 16v-4M12 8h.01" stroke-width="2"/>
            </svg>
            Зачем нужен вход в Twitch?
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
            Для полноценного фарминга дропсов и баллов канала требуется войти в Twitch через встроенный браузер. 
            Это позволит приложению автоматически собирать бонусы и отслеживать прогресс дропсов.
          </div>
        </div>
        
        <div style="margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">
            Войдите через встроенный браузер:
          </div>
          <div style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; height: 500px; background: white;">
            <webview id="twitch-login-webview" 
                     src="https://www.twitch.tv/login" 
                     style="width: 100%; height: 100%;"
                     partition="persist:twitch"
                     allowpopups="false"></webview>
          </div>
        </div>
        
        <div style="display: flex; gap: 12px; align-items: center;">
          <button class="btn btn-primary" id="check-login-btn" style="flex: 1;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="margin-right: 6px;">
              <path d="M9 11l3 3L22 4" stroke-width="2"/>
            </svg>
            Проверить авторизацию
          </button>
          <button class="btn btn-secondary close-modal" style="flex: 1;">Закрыть</button>
        </div>
        
        <div id="login-status" style="margin-top: 12px; text-align: center; font-size: 13px; color: var(--text-secondary);">⏳ Проверка авторизации... (после входа окно закроется автоматически)</div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const webview = modal.querySelector('#twitch-login-webview');
  const checkBtn = modal.querySelector('#check-login-btn');
  const statusDiv = modal.querySelector('#login-status');
  const closeModal = () => document.body.removeChild(modal);
  
  // Функция проверки авторизации
  const checkTwitchLogin = async () => {
    try {
      // Получаем URL webview
      const currentUrl = webview.getURL();
      console.log('Current webview URL:', currentUrl);
      
      // НЕ проверяем если всё ещё на странице входа
      if (currentUrl.includes('/login') || currentUrl.includes('/passport')) {
        console.log('Still on login page, skipping check');
        statusDiv.innerHTML = '<span style="color: var(--text-secondary);">⏳ Ожидание входа в Twitch...</span>';
        return false;
      }
      
      // Проверяем наличие элементов которые появляются только после авторизации
      const isLoggedIn = await webview.executeJavaScript(`
        (function() {
          console.log('🔍 Checking Twitch login status...');
          
          // Проверяем URL еще раз внутри webview
          if (window.location.href.includes('/login') || window.location.href.includes('/passport')) {
            console.log('❌ Still on login/passport page');
            return false;
          }
          
          // Способ 1: Проверяем кнопку пользовательского меню (самый надежный)
          const userButton = document.querySelector('[data-a-target="user-menu-toggle"]');
          if (userButton) {
            console.log('✅ Found user menu toggle button');
            return true;
          }
          
          // Способ 2: Проверяем аватар пользователя в шапке
          const userAvatar = document.querySelector('figure[class*="ScAvatar"], img[alt*="user avatar"]');
          if (userAvatar) {
            console.log('✅ Found user avatar');
            return true;
          }
          
          // Способ 3: Проверяем наличие имени пользователя в DOM
          const usernameElement = document.querySelector('[data-a-target="user-display-name"]');
          if (usernameElement && usernameElement.textContent.trim().length > 0) {
            console.log('✅ Found username element:', usernameElement.textContent);
            return true;
          }
          
          console.log('❌ No clear auth indicators found');
          return false;
        })();
      `).catch((err) => {
        console.log('Error checking login:', err);
        return false;
      });
      
      if (isLoggedIn) {
        // Извлекаем куки из webview для сохранения
        try {
          const cookies = await webview.executeJavaScript(`
            (function() {
              return document.cookie;
            })();
          `);
          
          console.log('Extracted cookies from webview');
          
          // Обновляем аккаунт
          const accounts = await Storage.getAccounts();
          const accountIndex = accounts.findIndex(a => a.username === username);
          
          if (accountIndex >= 0) {
            accounts[accountIndex].twitchLoggedIn = true;
            accounts[accountIndex].lastLogin = Date.now();
            accounts[accountIndex].webviewCookies = cookies; // Сохраняем куки
            
            await Storage.set('accounts', accounts);
            
            statusDiv.innerHTML = '<span style="color: var(--success-color);">✅ Авторизация успешна! Закрываю...</span>';
            window.utils.showToast(`Аккаунт ${username} активирован!`, 'success');
            
            // Очищаем интервал и закрываем
            clearInterval(autoCheckInterval);
            setTimeout(() => {
              closeModal();
              loadAndRenderAccounts();
            }, 1000);
            
            return true;
          }
        } catch (error) {
          console.error('Error extracting cookies:', error);
        }
      }
      return false;
    } catch (error) {
      console.log('Login check error (expected if not logged in):', error);
      return false;
    }
  };
  
  // Автоматическая проверка каждые 3 секунды (уменьшили частоту)
  let autoCheckInterval = setInterval(checkTwitchLogin, 3000);
  
  // Первая проверка через 2 секунды после открытия (даем время загрузиться)
  setTimeout(() => checkTwitchLogin(), 2000);
  
  // Обработчик кнопки "Проверить авторизацию" (ручная проверка)
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    statusDiv.innerHTML = '<span style="color: var(--text-secondary);">⏳ Проверка авторизации...</span>';
    
    const result = await checkTwitchLogin();
    
    if (!result) {
      statusDiv.innerHTML = '<span style="color: #ff9147;">⚠️ Войдите в Twitch в окне выше и попробуйте снова</span>';
      checkBtn.disabled = false;
    }
  });
  
  // Закрытие модального окна
  modal.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      clearInterval(autoCheckInterval);
      closeModal();
    });
  });
  
  modal.querySelector('.auth-modal-overlay').addEventListener('click', () => {
    clearInterval(autoCheckInterval);
    closeModal();
  });
}

async function handleCookiesLogin() {
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-modal-overlay"></div>
    <div class="auth-modal-content" style="width: 600px;">
      <div class="auth-modal-header">
        <h3>Login with Cookies</h3>
        <button class="close-modal">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>
      </div>
      <div class="auth-modal-body">
        <div class="input-group">
          <label class="input-label">Username</label>
          <input type="text" class="input-field" id="cookie-username" placeholder="Your Twitch username">
        </div>
        <div class="input-group">
          <label class="input-label">Cookies (optional для тестирования)</label>
          <textarea class="input-field" id="cookie-data" rows="6" placeholder="Paste your Twitch cookies here (optional)..."></textarea>
        </div>
        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button class="btn btn-primary" id="save-cookies-btn" style="flex: 1;">Save</button>
          <button class="btn btn-secondary close-modal" style="flex: 1;">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => document.body.removeChild(modal);
  
  modal.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  modal.querySelector('#save-cookies-btn').addEventListener('click', async () => {
    const username = modal.querySelector('#cookie-username').value.trim();
    const cookies = modal.querySelector('#cookie-data').value.trim() || 'demo_cookies';

    if (!username) {
      window.utils.showToast('Please enter username', 'warning');
      return;
    }

    try {
      const account = {
        username,
        cookies,
        loginMethod: 'cookies',
        addedAt: Date.now(),
        lastLogin: Date.now()
      };
      
      await Storage.saveAccount(account);
      await loadAndRenderAccounts();
      closeModal();
      window.utils.showToast(`Account ${username} added!`, 'success');
    } catch (error) {
      console.error('Error saving account:', error);
      window.utils.showToast('Failed to save account', 'error');
    }
  });
}

// Expose functions globally
window.AccountsPage = function() {
  this.init = initAccountsPage;
};

window.initAccountsPage = initAccountsPage;
