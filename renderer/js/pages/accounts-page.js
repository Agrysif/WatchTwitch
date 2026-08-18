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
  const i18n = window.i18n;
  const container = document.getElementById('accounts-list');
  
  if (!container) return;
  
  if (accounts.length === 0) {
    container.innerHTML = `
      <div class="no-accounts" style="text-align: center; padding: 60px; color: var(--text-secondary);">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="opacity: 0.3; margin: 0 auto;">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke-width="2"/>
          <circle cx="12" cy="7" r="4" stroke-width="2"/>
        </svg>
        <p style="margin-top: 16px;">${i18n.t('accounts.noAccounts')}</p>
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
      ? i18n.t('accounts.tokenExpiringSoon') 
      : (isActive && isTwitchLoggedIn ? i18n.t('accounts.active') : (!isActive ? i18n.t('accounts.requiresOAuthShort') : i18n.t('accounts.requiresTwitchLoginShort')));
    
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
          ⚠️ ${i18n.t('accounts.requiresOAuthWarning')}
        </div>` : ''}
        ${isActive && !isTwitchLoggedIn ? `<div style="font-size: 12px; color: #ff9147; margin-top: 6px;">
          ⚠️ ${i18n.t('accounts.requiresTwitchLoginWarning')}
        </div>` : ''}
        ${tokenExpiringSoon ? `<div style="font-size: 12px; color: #ff9147; margin-top: 6px;">
          ⏰ ${i18n.t('accounts.tokenExpiresOn')} ${new Date(account.oauthExpiresAt).toLocaleDateString()}
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
        ${isActive && isTwitchLoggedIn ? `<button class="account-btn logout-twitch" data-username="${account.username}" title="Выйти из Twitch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke-width="2"/>
            <polyline points="16 17 21 12 16 7" stroke-width="2"/>
            <line x1="21" y1="12" x2="9" y2="12" stroke-width="2"/>
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
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const username = btn.getAttribute('data-username');
      await handleTwitchWebLogin(username);
    });
  });

  // Setup logout from Twitch buttons
  container.querySelectorAll('.account-btn.logout-twitch').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const username = btn.getAttribute('data-username');
      
      const confirmed = await window.utils.showCustomConfirmation(`
        <div style="text-align: center;">
          <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: linear-gradient(135deg, rgba(255, 159, 67, 0.2), rgba(255, 159, 67, 0.05)); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FF9F43" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
          <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Выйти из Twitch?</h3>
          <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0;">
            Вы уверены, что хотите выйти из аккаунта <strong style="color: var(--text-primary);">${username}</strong>?<br>
            <span style="color: #ff9147;">⚠️ Для фарминга дропсов потребуется снова войти</span>
          </p>
        </div>
      `, {
        confirmText: 'Выйти',
        cancelText: 'Отмена',
        confirmClass: 'btn-warning'
      });

      if (!confirmed) return;

      const accounts = await Storage.getAccounts();
      const accountIndex = accounts.findIndex(a => a.username === username);
      
      if (accountIndex >= 0) {
        accounts[accountIndex].twitchLoggedIn = false;
        accounts[accountIndex].webviewCookies = null;
        await Storage.set('accounts', accounts);
        await loadAndRenderAccounts();
        window.utils.showToast(`Выполнен выход из ${username}`, 'success');
      }
    });
  });

  // Setup activate buttons
  container.querySelectorAll('.account-btn.activate').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
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
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent card click
      const username = btn.getAttribute('data-username');
      
      // Show custom confirmation modal
      const modalHtml = `
        <div style="text-align: center;">
          <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: linear-gradient(135deg, rgba(255, 107, 107, 0.2), rgba(255, 107, 107, 0.05)); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" stroke-width="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </div>
          <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Удалить аккаунт?</h3>
          <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0;">Вы уверены, что хотите удалить аккаунт <strong style="color: var(--text-primary);">${username}</strong>?</p>
        </div>
      `;

      const confirmed = await window.utils.showCustomConfirmation(modalHtml, {
        confirmText: 'Удалить',
        cancelText: 'Отмена',
        confirmClass: 'btn-danger'
      });

      if (!confirmed) return;
      
      await Storage.removeAccount(username);
      await loadAndRenderAccounts();
      window.utils.showToast(`Аккаунт ${username} удален`, 'success');
      
      confirmModal.querySelector('.auth-modal-overlay').addEventListener('click', () => {
        document.body.removeChild(confirmModal);
      });
    });
  });

  // Setup click on account card to show details
  container.querySelectorAll('.account-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      // Don't show modal if clicking on buttons or drag handle
      if (e.target.closest('.account-actions') || e.target.closest('.drag-handle')) {
        return;
      }
      
      const username = card.getAttribute('data-username');
      const accounts = await Storage.getAccounts();
      const account = accounts.find(a => a.username === username);
      
      if (account) {
        showAccountDetailsModal(account);
      }
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
      // Получаем accessToken из store (он сохранился при авторизации)
      const oauthData = await window.electronAPI.getOAuthUser();
      console.log('OAuth data:', oauthData);
      
      const account = {
        username: result.user.login,
        displayName: result.user.displayName,
        avatar: result.user.profileImageUrl || '',
        email: result.user.email,
        cookies: null,
        loginMethod: 'oauth',
        accessToken: oauthData?.accessToken || null, // Сохраняем токен!
        refreshToken: oauthData?.refreshToken || null,
        twitchLoggedIn: true, // После OAuth авторизации уже logged in
        addedAt: Date.now(),
        lastLogin: Date.now(),
        oauthExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // 60 дней
      };
      
      console.log('Saving account with token:', account.accessToken ? 'YES' : 'NO');
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
  const i18n = window.i18n;
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-modal-overlay"></div>
    <div class="auth-modal-content" style="width: 700px; max-height: 90vh;">
      <div class="auth-modal-header">
        <h3>🔐 ${i18n.t('accounts.twitchLogin')}</h3>
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
            ${i18n.t('accounts.whyTwitchLogin')}
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
            ${i18n.t('accounts.whyTwitchLoginText')}
          </div>
        </div>
        
        <div style="margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">
            ${i18n.t('accounts.loginThroughBrowser')}
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
            ${i18n.t('accounts.checkAuthorization')}
          </button>
          <button class="btn btn-secondary close-modal" style="flex: 1;">${i18n.t('accounts.close')}</button>
        </div>
        
        <div id="login-status" style="margin-top: 12px; text-align: center; font-size: 13px; color: var(--text-secondary);">${i18n.t('accounts.checkingAuth')}</div>
      </div>
    </div>
  `;
  
  document.body.style.overflow = 'hidden';
  document.body.appendChild(modal);
  
  const webview = modal.querySelector('#twitch-login-webview');
  const checkBtn = modal.querySelector('#check-login-btn');
  const statusDiv = modal.querySelector('#login-status');
  const closeModal = () => {
    document.body.style.overflow = '';
    document.body.removeChild(modal);
  };
  
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

async function handleWebLoginForNewAccount() {
  const i18n = window.i18n;
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-modal-overlay"></div>
    <div class="auth-modal-content" style="width: 700px; max-height: 90vh;">
      <div class="auth-modal-header">
        <h3>🔐 Войти через логин/пароль Twitch</h3>
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
            Важная информация
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
            Войдите в Twitch через встроенный браузер используя логин и пароль. 
            После успешного входа аккаунт будет автоматически добавлен в приложение для фарминга дропсов и баллов канала.
          </div>
        </div>
        
        <div style="margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">
            Войдите в Twitch:
          </div>
          <div style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; height: 500px; background: white;">
            <webview id="twitch-login-webview" 
                     src="https://www.twitch.tv/login" 
                     style="width: 100%; height: 100%;"
                     partition="persist:newaccount"
                     allowpopups="false"></webview>
          </div>
        </div>
        
        <div style="display: flex; gap: 12px; align-items: center;">
          <button class="btn btn-primary" id="check-login-btn" style="flex: 1;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="margin-right: 6px;">
              <path d="M9 11l3 3L22 4" stroke-width="2"/>
            </svg>
            ${i18n.t('accounts.checkAndAddAccount')}
          </button>
          <button class="btn btn-secondary close-modal" style="flex: 1;">${i18n.t('accounts.close')}</button>
        </div>
        
        <div id="login-status" style="margin-top: 12px; text-align: center; font-size: 13px; color: var(--text-secondary);">${i18n.t('accounts.waitingForLogin')}</div>
      </div>
    </div>
  `;
  
  document.body.style.overflow = 'hidden';
  document.body.appendChild(modal);
  
  const webview = modal.querySelector('#twitch-login-webview');
  const checkBtn = modal.querySelector('#check-login-btn');
  const statusDiv = modal.querySelector('#login-status');
  const closeModal = () => {
    clearInterval(autoCheckInterval);
    document.body.style.overflow = '';
    document.body.removeChild(modal);
  };
  
  // Функция проверки авторизации и добавления аккаунта
  const checkAndAddAccount = async () => {
    try {
      const currentUrl = webview.getURL();
      console.log('Current webview URL:', currentUrl);
      
      if (currentUrl.includes('/login') || currentUrl.includes('/passport')) {
        console.log('Still on login page, skipping check');
        statusDiv.innerHTML = '<span style="color: var(--text-secondary);">⏳ Ожидание входа в Twitch...</span>';
        return false;
      }
      
      const isLoggedIn = await webview.executeJavaScript(`
        (function() {
          const userButton = document.querySelector('[data-a-target="user-menu-toggle"]');
          if (userButton) return true;
          
          const userAvatar = document.querySelector('figure[class*="ScAvatar"]');
          if (userAvatar) return true;
          
          const usernameElement = document.querySelector('[data-a-target="user-display-name"]');
          if (usernameElement && usernameElement.textContent.trim().length > 0) return true;
          
          return false;
        })()
      `);
      
      if (!isLoggedIn) {
        console.log('Not logged in yet');
        return false;
      }
      
      console.log('✅ User is logged in!');
      statusDiv.innerHTML = '<span style="color: #00e57a;">✅ Авторизация обнаружена! Получаем данные аккаунта...</span>';
      
      // Получаем имя пользователя
      const userData = await webview.executeJavaScript(`
        (function() {
          const usernameElement = document.querySelector('[data-a-target="user-display-name"]');
          if (usernameElement) {
            return { username: usernameElement.textContent.trim() };
          }
          return null;
        })()
      `);
      
      if (!userData || !userData.username) {
        statusDiv.innerHTML = '<span style="color: #ff9147;">⚠️ Не удалось получить имя пользователя</span>';
        return false;
      }
      
      console.log('Got username:', userData.username);
      
      // Проверяем, не добавлен ли уже этот аккаунт
      const existingAccounts = await Storage.getAccounts();
      const accountExists = existingAccounts.some(acc => acc.username.toLowerCase() === userData.username.toLowerCase());
      
      if (accountExists) {
        statusDiv.innerHTML = `<span style="color: #ff9147;">⚠️ Аккаунт ${userData.username} уже добавлен</span>`;
        window.utils.showToast(`Аккаунт ${userData.username} уже существует`, 'warning');
        setTimeout(() => closeModal(), 2000);
        return true;
      }
      
      // Добавляем новый аккаунт
      const newAccount = {
        username: userData.username,
        displayName: userData.username,
        loginMethod: 'webview',
        isTwitchLoggedIn: true,
        addedAt: Date.now(),
        lastLogin: Date.now()
      };
      
      await Storage.saveAccount(newAccount);
      await loadAndRenderAccounts();
      
      statusDiv.innerHTML = `<span style="color: #00e57a;">✅ Аккаунт ${userData.username} успешно добавлен!</span>`;
      window.utils.showToast(`Аккаунт ${userData.username} добавлен!`, 'success');
      
      setTimeout(() => closeModal(), 1500);
      return true;
      
    } catch (error) {
      console.error('Error checking login:', error);
      statusDiv.innerHTML = '<span style="color: #ff4757;">❌ Ошибка проверки авторизации</span>';
      return false;
    }
  };
  
  // Автоматическая проверка каждые 3 секунды
  let autoCheckInterval = setInterval(checkAndAddAccount, 3000);
  
  // Первая проверка через 2 секунды
  setTimeout(() => checkAndAddAccount(), 2000);
  
  // Обработчик кнопки проверки
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    statusDiv.innerHTML = '<span style="color: var(--text-secondary);">⏳ Проверка авторизации...</span>';
    
    const result = await checkAndAddAccount();
    
    if (!result) {
      statusDiv.innerHTML = '<span style="color: #ff9147;">⚠️ Войдите в Twitch в окне выше и попробуйте снова</span>';
      checkBtn.disabled = false;
    }
  });
  
  // Закрытие модального окна
  modal.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });
  
  modal.querySelector('.auth-modal-overlay').addEventListener('click', closeModal);
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
  document.body.style.overflow = 'hidden';
  document.body.appendChild(modal);

  const closeModal = () => {
    document.body.style.overflow = '';
    document.body.removeChild(modal);
  };
  
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

// Show account details modal
function showAccountDetailsModal(account) {
  const avatarContent = account.avatar 
    ? `<img src="${account.avatar}" alt="${account.username}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` 
    : `<div style="width: 100%; height: 100%; border-radius: 50%; background: linear-gradient(135deg, #9147ff, #772ce8); display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: 600; color: white;">${account.username.charAt(0).toUpperCase()}</div>`;
  
  const isActive = account.loginMethod === 'oauth';
  const isTwitchLoggedIn = account.twitchLoggedIn || false;
  const tokenExpiringSoon = isActive && account.oauthExpiresAt && (new Date(account.oauthExpiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000);
  
  const statusBadge = (isActive && isTwitchLoggedIn) 
    ? `<div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(0, 229, 122, 0.15); color: #00E57A; border-radius: 20px; font-size: 13px; font-weight: 600;"><span style="width: 8px; height: 8px; background: #00E57A; border-radius: 50%;"></span>${i18n.t('accounts.active')}</div>`
    : tokenExpiringSoon
    ? `<div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(255, 159, 67, 0.15); color: #FF9F43; border-radius: 20px; font-size: 13px; font-weight: 600;"><span style="width: 8px; height: 8px; background: #FF9F43; border-radius: 50%;"></span>${i18n.t('accounts.tokenExpires')}</div>`
    : '<div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(255, 107, 107, 0.15); color: #FF6B6B; border-radius: 20px; font-size: 13px; font-weight: 600;"><span style="width: 8px; height: 8px; background: #FF6B6B; border-radius: 50%;"></span>Требует действий</div>';

  const addedDate = new Date(account.addedAt);
  const lastLoginDate = account.lastLogin ? new Date(account.lastLogin) : null;
  const oauthExpiryDate = account.oauthExpiresAt ? new Date(account.oauthExpiresAt) : null;

  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-modal-overlay"></div>
    <div class="auth-modal-content account-details-modal" style="animation: slideUp 0.3s ease;">
      <div class="auth-modal-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 20px; margin-bottom: 24px; position: relative; display: flex; align-items: center; justify-content: space-between;">
        <h2 style="margin: 0;">${i18n.t('accounts.accountInfo')}</h2>
        <button class="modal-close-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="auth-modal-body" style="padding: 0;">
        <!-- Avatar and Name Section -->
        <div style="display: flex; flex-direction: column; align-items: center; gap: 16px; margin-bottom: 32px;">
          <div style="width: 120px; height: 120px; border-radius: 50%; overflow: hidden; box-shadow: 0 8px 32px rgba(145, 71, 255, 0.25); border: 4px solid var(--card-bg);">
            ${avatarContent}
          </div>
          <div style="text-align: center;">
            <h3 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600; color: var(--text-primary);">${account.displayName || account.username}</h3>
            ${account.displayName ? `<p class="clickable" data-copy="@${account.username}" style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-secondary); cursor: pointer; transition: color 0.2s;" onmouseover="this.style.color='var(--accent-color)'" onmouseout="this.style.color='var(--text-secondary)'">@${account.username}</p>` : ''}
            ${statusBadge}
          </div>
        </div>

        <!-- Details Grid -->
        <div style="display: grid; gap: 16px;">
          ${account.email ? `
          <div class="detail-row clickable" data-copy="${account.email}" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: 12px; border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, rgba(145, 71, 255, 0.15), rgba(119, 44, 232, 0.05)); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9147ff" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${i18n.t('accounts.email')}</div>
              <div style="font-size: 14px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis;">${account.email}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" style="flex-shrink: 0;">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </div>
          ` : ''}

          <div class="detail-row" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: 12px; border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, rgba(0, 229, 122, 0.15), rgba(0, 229, 122, 0.05)); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E57A" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${i18n.t('accounts.authMethod')}</div>
              <div style="font-size: 14px; font-weight: 500; color: var(--text-primary);">${account.loginMethod === 'oauth' ? 'OAuth 2.0' : 'Cookies'}</div>
            </div>
          </div>

          <div class="detail-row" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: 12px; border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, rgba(255, 159, 67, 0.15), rgba(255, 159, 67, 0.05)); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF9F43" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${i18n.t('accounts.dateAdded')}</div>
              <div style="font-size: 14px; font-weight: 500; color: var(--text-primary);">${addedDate.toLocaleDateString(i18n.getLocale(), { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            </div>
          </div>

          ${lastLoginDate ? `
          <div class="detail-row" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: 12px; border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, rgba(0, 224, 255, 0.15), rgba(0, 224, 255, 0.05)); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E0FF" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${i18n.t('accounts.lastActivity')}</div>
              <div style="font-size: 14px; font-weight: 500; color: var(--text-primary);">${lastLoginDate.toLocaleString(i18n.getLocale(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
          ` : ''}

          ${oauthExpiryDate && isActive ? `
          <div class="detail-row" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: 12px; border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, ${tokenExpiringSoon ? 'rgba(255, 159, 67, 0.15), rgba(255, 159, 67, 0.05)' : 'rgba(145, 71, 255, 0.15), rgba(119, 44, 232, 0.05)'}); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${tokenExpiringSoon ? '#FF9F43' : '#9147ff'}" stroke-width="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3"/>
              </svg>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${i18n.t('accounts.tokenExpires')}</div>
              <div style="font-size: 14px; font-weight: 500; color: ${tokenExpiringSoon ? '#FF9F43' : 'var(--text-primary)'};">${oauthExpiryDate.toLocaleDateString(i18n.getLocale(), { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            </div>
          </div>
          ` : ''}

          ${!isActive || !isTwitchLoggedIn ? `
          <div style="margin-top: 8px; padding: 16px; background: rgba(255, 159, 67, 0.1); border-radius: 12px; border: 1px solid rgba(255, 159, 67, 0.3);">
            <div style="display: flex; gap: 12px; align-items: start;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF9F43" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div style="flex: 1;">
                <div style="font-size: 13px; font-weight: 600; color: #FF9F43; margin-bottom: 6px;">${i18n.t('accounts.requiresAction')}</div>
                <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">
                  ${!isActive ? i18n.t('accounts.requiresOAuth') : i18n.t('accounts.requiresTwitchLogin')}
                </div>
              </div>
            </div>
          </div>
          ` : ''}
        </div>
      </div>

      <div class="auth-modal-footer">
        <span class="footer-close-text" onclick="this.closest('.auth-modal').querySelector('.modal-close-btn').click();">
          ${i18n.t('common.close')}
        </span>
      </div>
    </div>
  `;

  document.body.style.overflow = 'hidden';
  document.body.appendChild(modal);

  const closeModal = () => {
    document.body.style.overflow = '';
    const overlay = modal.querySelector('.auth-modal-overlay');
    if (overlay) overlay.style.opacity = '0';
    setTimeout(() => document.body.removeChild(modal), 200);
  };

  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);

  modal.querySelector('.auth-modal-overlay').addEventListener('click', closeModal);

  // Add click handlers for copying
  modal.querySelectorAll('[data-copy]').forEach(element => {
    element.addEventListener('click', async () => {
      const textToCopy = element.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(textToCopy);
        window.utils.showToast(`Скопировано: ${textToCopy}`, 'success');
      } catch (error) {
        console.error('Failed to copy:', error);
        window.utils.showToast('Ошибка копирования', 'error');
      }
    });
  });

  // Add fade-in animation
  setTimeout(() => {
    const overlay = modal.querySelector('.auth-modal-overlay');
    if (overlay) overlay.style.opacity = '1';
  }, 10);
}

// Expose functions globally
window.AccountsPage = function() {
  this.init = initAccountsPage;
};

window.initAccountsPage = initAccountsPage;
