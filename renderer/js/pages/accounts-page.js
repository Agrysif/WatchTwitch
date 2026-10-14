// Accounts page logic
function initAccountsPage() {
  console.log('Initializing accounts page...');
  
  // Load and render accounts
  loadAndRenderAccounts();
  
  // Setup event listeners
  // Кнопки «Войти через cookies» больше нет: она создавала аккаунт-пустышку
  // без настоящего cookie, а под первым аккаунтом идёт фарминг. Cookie
  // сохраняет окно «Войти в Twitch» на карточке аккаунта
  const addTwitchBtn = document.getElementById('add-twitch-btn');
  const openBrowserBtn = document.getElementById('open-browser-btn');

  if (addTwitchBtn) {
    addTwitchBtn.addEventListener('click', handleTwitchLogin);
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

// Даты на карточке аккаунта. Раньше было «Added 14.10.2026 • Last:
// 14.10.2026, 01:51:07» — по-английски и с секундами, которые тут ни к чему.
// Хвост « г.» из русской локали убираем: в строке он только мешает
function formatAccountDay(ts, withYear = true) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const options = withYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short' };
  return d.toLocaleDateString('ru-RU', options).replace(/\s*г\.$/, '');
}

function formatAccountLastLogin(ts) {
  const d = ts ? new Date(ts) : null;
  if (!d || isNaN(d.getTime())) return 'никогда';

  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  // Округление, а не деление нацело: в день перевода часов сутки не 24 часа
  const daysAgo = Math.round((today - day) / 86400000);

  if (daysAgo === 0) return `сегодня в ${time}`;
  if (daysAgo === 1) return `вчера в ${time}`;
  return `${formatAccountDay(d, d.getFullYear() !== today.getFullYear())} в ${time}`;
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

  // Значки в строках-предупреждениях — те же, что в тостах, вместо эмодзи:
  // эмодзи рисуются системным шрифтом и выбиваются из остальных иконок
  const warningIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 1px;"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  const clockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 1px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  const noteStyle = 'font-size: 12px; color: #f0a83c; margin-top: 6px; display: flex; gap: 6px; align-items: flex-start;';
  // Имя, аватар и почта приходят от Twitch или из файла резервной копии —
  // в разметку только экранированными
  const esc = window.escapeHtml;

  container.innerHTML = accounts.map(account => {
    const username = esc(account.username);
    const avatarContent = account.avatar
      ? `<img src="${esc(account.avatar)}" alt="${username}" style="width: 100%; height: 100%; border-radius: var(--radius-circle); object-fit: cover;">`
      : esc(String(account.username || '').charAt(0).toUpperCase());
    const addedDay = account.addedAt ? formatAccountDay(account.addedAt) : '';
    const meta = [
      addedDay ? `Добавлен ${addedDay}` : '',
      account.loginMethod === 'oauth' ? 'OAuth' : 'Cookie',
      `Последний вход: ${formatAccountLastLogin(account.lastLogin)}`
    ].filter(Boolean).join(' · ');
    
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
    <div class="account-card scale-in ${!isActive || !isTwitchLoggedIn ? 'inactive-account' : ''}" draggable="true" data-username="${username}" data-priority="${Number(account.priority) || 0}">
      <div class="account-avatar">
        ${avatarContent}
      </div>
      <div class="account-info">
        <div class="account-username">${username}</div>
        <div class="account-meta">${meta}</div>
        ${!isActive ? `<div style="${noteStyle}">
          ${warningIcon}<span>${i18n.t('accounts.requiresOAuthWarning')}</span>
        </div>` : ''}
        ${isActive && !isTwitchLoggedIn ? `<div style="${noteStyle}">
          ${warningIcon}<span>${i18n.t('accounts.requiresTwitchLoginWarning')}</span>
        </div>` : ''}
        ${tokenExpiringSoon ? `<div style="${noteStyle}">
          ${clockIcon}<span>${i18n.t('accounts.tokenExpiresOn')} ${formatAccountDay(account.oauthExpiresAt)}</span>
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
        ${!isActive ? `<button class="account-btn activate" data-username="${username}" title="Активировать через OAuth">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M9 11l3 3L22 4" stroke-width="2"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke-width="2"/>
          </svg>
        </button>` : ''}
        ${isActive && !isTwitchLoggedIn ? `<button class="account-btn login-twitch" data-username="${username}" title="Войти в Twitch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
          </svg>
        </button>` : ''}
        ${isActive && isTwitchLoggedIn ? `<button class="account-btn logout-twitch" data-username="${username}" title="Выйти из Twitch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke-width="2"/>
            <polyline points="16 17 21 12 16 7" stroke-width="2"/>
            <line x1="21" y1="12" x2="9" y2="12" stroke-width="2"/>
          </svg>
        </button>` : ''}
        <button class="account-btn delete" data-username="${username}" title="Удалить аккаунт" aria-label="Удалить аккаунт">
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
          <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: rgba(255, 159, 67, 0.2); border-radius: var(--radius-circle); display: flex; align-items: center; justify-content: center;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FF9F43" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
          <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Выйти из Twitch?</h3>
          <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0;">
            Вы уверены, что хотите выйти из аккаунта <strong style="color: var(--text-primary);">${esc(username)}</strong>?<br>
            <span style="color: #f0a83c;">⚠️ Для фарминга дропсов потребуется снова войти</span>
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
        // Выход ручной: проверка входа (LoginGuard) не должна сама вернуть флаг
        delete accounts[accountIndex].twitchSessionLost;
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
        } else {
          // Неудачный вход раньше проходил молча: кнопка ничего не говорила
          throw new Error(result?.error || 'Авторизация не удалась');
        }
      } catch (error) {
        console.error('Activation error:', error);
        window.utils.showToast(friendlyLoginError(error?.message), 'error');
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
          <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: rgba(255, 107, 107, 0.2); border-radius: var(--radius-circle); display: flex; align-items: center; justify-content: center;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f0555f" stroke-width="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </div>
          <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Удалить аккаунт?</h3>
          <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0;">Вы уверены, что хотите удалить аккаунт <strong style="color: var(--text-primary);">${esc(username)}</strong>?</p>
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

      // Без аккаунтов фарминг шёл вхолостую: стрим играл, а дропсы не
      // копились. Останавливаем, но активную сессию сохраняем — с новым
      // аккаунтом её можно будет продолжить
      let noAccountsLeft = false;
      try {
        noAccountsLeft = ((await Storage.getAccounts()) || []).length === 0;
      } catch (e) { /* список не прочитан — фарминг не трогаем */ }
      const page = window.farmingPage;
      if (noAccountsLeft && page?.sessionStartTime) {
        page.stopFarming(false, true);
        window.utils.showToast(`Аккаунт ${username} удалён, фарминг остановлен`, 'success');
        return;
      }

      // Здесь же раньше обращались к несуществующему confirmModal, и каждое
      // удаление заканчивалось ошибкой в консоли: окно подтверждения
      // закрывает себя само
      window.utils.showToast(`Аккаунт ${username} удалён`, 'success');
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
      throw new Error(result?.error || 'Авторизация не удалась');
    }
  } catch (error) {
    console.error('Login error:', error);
    window.utils.showToast(friendlyLoginError(error?.message), 'error');
  }
}

/**
 * Понятный текст вместо служебной ошибки входа. Раньше в тост уходило
 * как есть «access_denied» или «listen EADDRINUSE: address already in use
 * :::3000». Технический текст остаётся в console.error у вызывающего.
 */
function friendlyLoginError(raw) {
  const text = String(raw || '');
  // Отказ на странице Twitch: error=access_denied в адресе возврата.
  // Только этот код: голое «denied» есть и в «EACCES: permission denied»
  // при занятом системой порте, и тогда тост врал бы, что вход отменили
  if (/access_denied/i.test(text)) return 'Вход отменён в браузере';
  // Ответ браузера принимает локальный сервер на порту 3000
  if (/EADDRINUSE|address already in use/i.test(text)) {
    return 'Порт 3000 занят другой программой — закройте её и повторите вход';
  }
  // Сеть проверяем раньше ожидания: ETIMEDOUT — обрыв связи, а не
  // брошенное окно браузера
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(text)) {
    return 'Нет связи с Twitch — проверьте интернет и повторите вход';
  }
  if (/time\s*out|timed\s*out/i.test(text)) {
    return 'Вход не завершён — нажмите «Войти через Twitch» ещё раз';
  }
  // Готовый русский текст из главного процесса показываем как есть,
  // кроме полуанглийского «Не удалось получить access token»
  if (/[а-яё]/i.test(text) && !/token/i.test(text)) return text;
  return 'Не удалось войти в Twitch — попробуйте ещё раз';
}

async function handleTwitchWebLogin(username) {
  const i18n = window.i18n;
  // У webview входа нет allowpopups: атрибут булев, и прежний
  // allowpopups="false" как раз разрешал всплывающие окна в сессии Twitch.
  // То же в окне входа для нового аккаунта ниже
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
        <div style="background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px;">
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
          <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; height: 500px; background: white;">
            <webview id="twitch-login-webview" 
                     src="https://www.twitch.tv/login" 
                     style="width: 100%; height: 100%;"
                     partition="persist:twitch"></webview>
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
  // Окно закрывают и по таймеру после входа, и кнопкой — второй вызов
  // не должен падать на уже убранном окне
  const closeModal = () => {
    document.body.style.overflow = '';
    if (modal.parentNode) modal.parentNode.removeChild(modal);
  };
  // Проверки идут по таймеру и по кнопке одновременно: вход засчитываем один раз
  let loginDone = false;
  
  // Функция проверки авторизации.
  // true — вход есть и сохранён, false — входа пока нет,
  // null — вход есть, но привязать его не к чему (статус уже написан)
  const checkTwitchLogin = async () => {
    if (loginDone) return true;
    try {
      // Получаем URL webview
      const currentUrl = webview.getURL();
      console.log('Current webview URL:', currentUrl);
      
      // НЕ проверяем если всё ещё на странице входа
      if (currentUrl.includes('/login') || currentUrl.includes('/passport')) {
        console.log('Still on login page, skipping check');
        statusDiv.innerHTML = '<span style="color: var(--text-secondary);">Жду вход в Twitch…</span>';
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
          if (loginDone) return true;
          let accountIndex = username ? accounts.findIndex(a => a.username === username) : -1;
          // Окно открыто без имени — из значка «Нет входа в Twitch». Раньше
          // тогда аккаунт не находился, вход не засчитывался и окно не
          // закрывалось. Привязываем вход к первому аккаунту: под ним фарминг
          if (accountIndex < 0 && !username && accounts.length > 0) accountIndex = 0;
          
          if (accountIndex < 0) {
            statusDiv.innerHTML = '<span style="color: #f0a83c;">Вход есть, но аккаунт не найден. Добавьте его кнопкой «Войти через Twitch»</span>';
            return null;
          }

          if (accountIndex >= 0) {
            loginDone = true;
            const account = accounts[accountIndex];
            account.twitchLoggedIn = true;
            account.lastLogin = Date.now();
            account.webviewCookies = cookies; // Сохраняем куки
            // Вход восстановлен вручную — метка «сняла проверка» больше не нужна
            delete account.twitchSessionLost;
            
            await Storage.set('accounts', accounts);
            
            statusDiv.innerHTML = '<span style="color: var(--success-color);">Вход выполнен — закрываю окно</span>';
            window.utils.showToast(`Аккаунт ${account.username} активирован!`, 'success');
            // Красный значок и экран повторного входа обновляем сразу, а не
            // при следующей плановой проверке через пять минут
            window.loginGuard?.check?.();
            
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
  // Модалку могли снести переходом на другую вкладку — тогда остановить
  // опрос было бы некому, а webview входа уже нет
  let autoCheckInterval = setInterval(() => {
    if (!document.body.contains(modal)) {
      clearInterval(autoCheckInterval);
      return;
    }
    checkTwitchLogin();
  }, 3000);
  
  // Первая проверка через 2 секунды после открытия (даем время загрузиться)
  setTimeout(() => checkTwitchLogin(), 2000);
  
  // Обработчик кнопки "Проверить авторизацию" (ручная проверка)
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    statusDiv.innerHTML = '<span style="color: var(--text-secondary);">Проверяю вход…</span>';
    
    const result = await checkTwitchLogin();
    
    if (result === false) {
      statusDiv.innerHTML = '<span style="color: #f0a83c;">Войдите в Twitch в окне выше и попробуйте снова</span>';
    }
    if (result !== true) checkBtn.disabled = false;
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
        <div style="background: rgba(124, 92, 255, 0.1); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px;">
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
          <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; height: 500px; background: white;">
            <webview id="twitch-login-webview" 
                     src="https://www.twitch.tv/login" 
                     style="width: 100%; height: 100%;"
                     partition="persist:newaccount"></webview>
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
      statusDiv.innerHTML = '<span style="color: #35d08a;">✅ Авторизация обнаружена! Получаем данные аккаунта...</span>';
      
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
        statusDiv.innerHTML = '<span style="color: #f0a83c;">⚠️ Не удалось получить имя пользователя</span>';
        return false;
      }
      
      console.log('Got username:', userData.username);
      
      // Проверяем, не добавлен ли уже этот аккаунт
      const existingAccounts = await Storage.getAccounts();
      const accountExists = existingAccounts.some(acc => acc.username.toLowerCase() === userData.username.toLowerCase());
      
      if (accountExists) {
        statusDiv.innerHTML = `<span style="color: #f0a83c;">⚠️ Аккаунт ${window.escapeHtml(userData.username)} уже добавлен</span>`;
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
      
      statusDiv.innerHTML = `<span style="color: #35d08a;">✅ Аккаунт ${window.escapeHtml(userData.username)} успешно добавлен!</span>`;
      window.utils.showToast(`Аккаунт ${userData.username} добавлен!`, 'success');
      
      setTimeout(() => closeModal(), 1500);
      return true;
      
    } catch (error) {
      console.error('Error checking login:', error);
      statusDiv.innerHTML = '<span style="color: #f0555f;">❌ Ошибка проверки авторизации</span>';
      return false;
    }
  };
  
  // Автоматическая проверка каждые 3 секунды
  // Модалку могли снести переходом на другую вкладку — тогда остановить
  // опрос было бы некому, а webview входа уже нет
  let autoCheckInterval = setInterval(() => {
    if (!document.body.contains(modal)) {
      clearInterval(autoCheckInterval);
      return;
    }
    checkAndAddAccount();
  }, 3000);
  
  // Первая проверка через 2 секунды
  setTimeout(() => checkAndAddAccount(), 2000);
  
  // Обработчик кнопки проверки
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    statusDiv.innerHTML = '<span style="color: var(--text-secondary);">⏳ Проверка авторизации...</span>';
    
    const result = await checkAndAddAccount();
    
    if (!result) {
      statusDiv.innerHTML = '<span style="color: #f0a83c;">⚠️ Войдите в Twitch в окне выше и попробуйте снова</span>';
      checkBtn.disabled = false;
    }
  });
  
  // Закрытие модального окна
  modal.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });
  
  modal.querySelector('.auth-modal-overlay').addEventListener('click', closeModal);
}

// Show account details modal
function showAccountDetailsModal(account) {
  // Имя, аватар и почта — внешние строки: в разметку только экранированными
  const esc = window.escapeHtml;
  const username = esc(account.username);
  const avatarContent = account.avatar 
    ? `<img src="${esc(account.avatar)}" alt="${username}" style="width: 100%; height: 100%; border-radius: var(--radius-circle); object-fit: cover;">` 
    : `<div style="width: 100%; height: 100%; border-radius: var(--radius-circle); background: #7c5cff; display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: 600; color: white;">${esc(String(account.username || '').charAt(0).toUpperCase())}</div>`;
  
  const isActive = account.loginMethod === 'oauth';
  const isTwitchLoggedIn = account.twitchLoggedIn || false;
  const tokenExpiringSoon = isActive && account.oauthExpiresAt && (new Date(account.oauthExpiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000);
  
  const statusBadge = (isActive && isTwitchLoggedIn) 
    ? `<div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(53, 208, 138, 0.15); color: #35d08a; border-radius: var(--radius-md); font-size: 13px; font-weight: 600;"><span style="width: 8px; height: 8px; background: #35d08a; border-radius: var(--radius-circle);"></span>${i18n.t('accounts.active')}</div>`
    : tokenExpiringSoon
    ? `<div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(255, 159, 67, 0.15); color: #FF9F43; border-radius: var(--radius-md); font-size: 13px; font-weight: 600;"><span style="width: 8px; height: 8px; background: #FF9F43; border-radius: var(--radius-circle);"></span>${i18n.t('accounts.tokenExpires')}</div>`
    : '<div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(255, 107, 107, 0.15); color: #f0555f; border-radius: var(--radius-md); font-size: 13px; font-weight: 600;"><span style="width: 8px; height: 8px; background: #f0555f; border-radius: var(--radius-circle);"></span>Требует действий</div>';

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
          <div style="width: 120px; height: 120px; border-radius: var(--radius-circle); overflow: hidden; box-shadow: none; border: 4px solid var(--card-bg);">
            ${avatarContent}
          </div>
          <div style="text-align: center;">
            <h3 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600; color: var(--text-primary);">${esc(account.displayName || account.username)}</h3>
            ${account.displayName ? `<p class="clickable" data-copy="@${username}" style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-secondary); cursor: pointer; transition: color 0.2s;" onmouseover="this.style.color='var(--accent-color)'" onmouseout="this.style.color='var(--text-secondary)'">@${username}</p>` : ''}
            ${statusBadge}
          </div>
        </div>

        <!-- Details Grid -->
        <div style="display: grid; gap: 16px;">
          ${account.email ? `
          <div class="detail-row clickable" data-copy="${esc(account.email)}" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: rgba(124, 92, 255, 0.15); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${i18n.t('accounts.email')}</div>
              <div style="font-size: 14px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis;">${esc(account.email)}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" style="flex-shrink: 0;">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </div>
          ` : ''}

          <div class="detail-row" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: rgba(53, 208, 138, 0.15); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#35d08a" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${i18n.t('accounts.authMethod')}</div>
              <div style="font-size: 14px; font-weight: 500; color: var(--text-primary);">${account.loginMethod === 'oauth' ? 'OAuth 2.0' : 'Cookie'}</div>
            </div>
          </div>

          <div class="detail-row" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: rgba(255, 159, 67, 0.15); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
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
          <div class="detail-row" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: rgba(0, 224, 255, 0.15); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
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
          <div class="detail-row" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--input-bg); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, ${tokenExpiringSoon ? 'rgba(255, 159, 67, 0.15), rgba(255, 159, 67, 0.05)' : 'rgba(124, 92, 255, 0.15), rgba(107, 73, 240, 0.05)'}); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${tokenExpiringSoon ? '#FF9F43' : '#7c5cff'}" stroke-width="2">
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
          <div style="margin-top: 8px; padding: 16px; background: rgba(255, 159, 67, 0.1); border-radius: var(--radius-md); border: 1px solid rgba(255, 159, 67, 0.3);">
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
// Окно входа зовёт и экран повторного входа (LoginGuard)
window.handleTwitchWebLogin = handleTwitchWebLogin;
