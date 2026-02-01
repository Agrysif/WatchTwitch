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
    
    return `
    <div class="account-card scale-in">
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
      </div>
      <div class="account-status connected">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <circle cx="6" cy="6" r="6"/>
        </svg>
        <span>Подключен</span>
      </div>
      <div class="account-actions">
        <button class="account-btn delete" data-username="${account.username}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke-width="2"/>
          </svg>
        </button>
      </div>
    </div>
  `}).join('');

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
        addedAt: Date.now(),
        lastLogin: Date.now()
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
