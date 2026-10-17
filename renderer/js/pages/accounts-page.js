// Страница «Аккаунты»
//
// Список — строки .list-row (как в остальных списках приложения): аватар,
// имя, мета, статус бейджем и действия. Цвет только по смыслу: зелёный
// «Активен», янтарный «Нужен вход». Классы и data-атрибуты строк
// (.account-card, .account-btn.*, data-username) прежние — на них завязаны
// обработчики ниже и снимки.
function initAccountsPage() {
  console.log('Initializing accounts page...');

  // Load and render accounts
  loadAndRenderAccounts();

  // Кнопки «Войти через cookies» больше нет: она создавала аккаунт-пустышку
  // без настоящего cookie, а под первым аккаунтом идёт фарминг. Cookie
  // сохраняет окно «Войти в Twitch» на строке аккаунта
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
  let accounts = [];
  try {
    accounts = (await Storage.getAccounts()) || [];
  } catch (error) {
    // Без списка показываем пустое состояние с кнопкой входа, а не вечный скелетон
    console.error('[Аккаунты] Не удалось прочитать список:', error);
  }
  renderAccounts(accounts);
}

// Даты на строке аккаунта. Раньше было «Added 14.10.2026 • Last:
// 14.10.2026, 01:51:07» — по-английски и с секундами, которые тут ни к чему.
// Хвост « г.» из русской локали убираем: в строке он только мешает
function formatAccountDay(ts, withYear = true) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const options = withYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short' };
  return d.toLocaleDateString(tr.locale(), options).replace(/\s*г\.$/, '');
}

function formatAccountLastLogin(ts) {
  const d = ts ? new Date(ts) : null;
  if (!d || isNaN(d.getTime())) return tr('никогда');

  // В английском — «8:05 PM» без ведущего нуля, в русском — «08:05», как было
  const time = d.toLocaleTimeString(tr.locale(), { hour: tr.lang() === 'en' ? 'numeric' : '2-digit', minute: '2-digit' });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  // Округление, а не деление нацело: в день перевода часов сутки не 24 часа
  const daysAgo = Math.round((today - day) / 86400000);

  if (daysAgo === 0) return tr('сегодня в {time}', { time });
  if (daysAgo === 1) return tr('вчера в {time}', { time });
  return tr('{day} в {time}', { day: formatAccountDay(d, d.getFullYear() !== today.getFullYear()), time });
}

/**
 * Состояние аккаунта одним объектом — его показывают и строка списка, и
 * окно подробностей, и раньше оба считали его каждый по-своему.
 */
function describeAccountState(account) {
  const isActive = account.loginMethod === 'oauth';
  const isTwitchLoggedIn = account.twitchLoggedIn || false;
  const tokenExpiringSoon = isActive && account.oauthExpiresAt &&
    (new Date(account.oauthExpiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000); // 7 дней

  if (!isActive) {
    return {
      isActive, isTwitchLoggedIn, tokenExpiringSoon, tone: 'warning',
      badge: tr('Нужно подключить'),
      note: tr('Аккаунт добавлен по cookie — подключите его через Twitch, иначе фарминг под ним не работает'),
      action: 'activate'
    };
  }
  if (!isTwitchLoggedIn) {
    return {
      isActive, isTwitchLoggedIn, tokenExpiringSoon, tone: 'warning',
      badge: tr('Нужен вход'),
      note: tr('Без входа в Twitch минуты и баллы канала не засчитываются'),
      action: 'login'
    };
  }
  if (tokenExpiringSoon) {
    return {
      isActive, isTwitchLoggedIn, tokenExpiringSoon, tone: 'warning',
      badge: tr('Токен скоро истечёт'),
      note: tr('OAuth-токен истечёт {date}', { date: formatAccountDay(account.oauthExpiresAt) }),
      action: ''
    };
  }
  return {
    isActive, isTwitchLoggedIn, tokenExpiringSoon, tone: 'success',
    badge: tr('Активен'), note: '', action: ''
  };
}

function accountIcon(name, size = 16) {
  return window.Icons?.get(name, size) ?? '';
}

function accountAvatarHtml(account, size = 40) {
  const esc = window.escapeHtml;
  const letter = esc(String(account.username || '?').charAt(0).toUpperCase());
  return account.avatar
    ? `<img src="${esc(account.avatar)}" alt="" width="${size}" height="${size}" data-letter="${letter}">`
    : `<span>${letter}</span>`;
}

// Битая ссылка на аватар оставляла пустой круг — подставляем букву имени
function fallbackAccountAvatars(root) {
  root.querySelectorAll('.account-avatar img[data-letter]').forEach(img => {
    img.addEventListener('error', () => {
      const span = document.createElement('span');
      span.textContent = img.dataset.letter;
      img.replaceWith(span);
    }, { once: true });
  });
}

function renderAccounts(accounts) {
  const container = document.getElementById('accounts-list');

  if (!container) return;
  const esc = window.escapeHtml;
  const addBtn = document.getElementById('add-twitch-btn');
  if (addBtn) addBtn.hidden = accounts.length === 0;

  if (accounts.length === 0) {
    container.innerHTML = `
      <div class="empty-state no-accounts">
        ${accountIcon('users', 40)}
        <h3>${tr('Добавьте аккаунт Twitch')}</h3>
        <p>${tr('Вход — через Twitch в браузере: пароль приложению не передаётся.')}</p>
        <button type="button" class="btn btn-primary" id="empty-add-twitch-btn">
          <img src="../assets/logo.svg" alt="" class="btn-logo" width="18" height="18"><span>${tr('Войти через Twitch')}</span>
        </button>
      </div>
    `;
    container.querySelector('#empty-add-twitch-btn')?.addEventListener('click', handleTwitchLogin);
    return;
  }

  const several = accounts.length > 1;

  container.innerHTML = accounts.map((account, index) => {
    const username = esc(account.username);
    const state = describeAccountState(account);
    const addedDay = account.addedAt ? formatAccountDay(account.addedAt) : '';
    const meta = [
      addedDay ? tr('Добавлен {date}', { date: addedDay }) : '',
      account.loginMethod === 'oauth' ? 'OAuth' : 'Cookie',
      tr('Вход {when}', { when: formatAccountLastLogin(account.lastLogin) })
    ].filter(Boolean).map(part => `<span>${esc(part)}</span>`).join('');

    // Главное действие строки — подписью и всегда на виду; выход и
    // удаление — значками, по наведению (как в остальных списках)
    const mainAction = state.action === 'activate'
      ? `<button type="button" class="btn btn-secondary btn-sm account-btn activate" data-username="${username}" title="${tr('Подключить через Twitch (OAuth)')}">${tr('Подключить')}</button>`
      : state.action === 'login'
        ? `<button type="button" class="btn btn-secondary btn-sm account-btn login-twitch" data-username="${username}" title="${tr('Войти в Twitch')}">${accountIcon('user', 14)}<span>${tr('Войти')}</span></button>`
        : '';

    return `
    <div class="account-card list-row ${state.tone === 'warning' ? 'inactive-account' : ''}" draggable="${several}" tabindex="0"
         data-username="${username}" data-priority="${Number(account.priority) || 0}">
      ${several ? `<span class="drag-handle" title="${tr('Перетащите, чтобы поменять порядок (или Alt + ↑/↓)')}" aria-hidden="true">${accountIcon('grip', 16)}</span>` : ''}
      <div class="account-avatar">${accountAvatarHtml(account, 40)}</div>
      <div class="row-main account-info">
        <div class="account-title">
          <span class="row-title account-username" data-no-tr>${username}</span>
          <span class="badge ${state.tone === 'success' ? 'badge-success' : 'badge-warning'} account-status ${state.tone === 'success' ? 'connected' : 'warning'}">${esc(state.badge)}</span>
          ${several && index === 0 ? `<span class="badge badge-outline" title="${tr('Фарминг идёт под этим аккаунтом')}">${tr('Основной')}</span>` : ''}
        </div>
        <div class="row-meta account-meta">${meta}</div>
        ${state.note ? `<div class="account-note tone-warn">${accountIcon(state.action ? 'warning' : 'clock', 14)}<span>${esc(state.note)}</span></div>` : ''}
      </div>
      <div class="account-actions">
        ${mainAction}
        <div class="row-actions">
          ${state.isActive && state.isTwitchLoggedIn ? `<button type="button" class="btn btn-ghost btn-icon btn-sm account-btn logout-twitch" data-username="${username}" title="${tr('Выйти из Twitch')}" aria-label="${tr('Выйти из Twitch')}">${accountIcon('logout', 16)}</button>` : ''}
          <button type="button" class="btn btn-ghost btn-icon btn-sm account-btn delete" data-username="${username}" title="${tr('Удалить аккаунт')}" aria-label="${tr('Удалить аккаунт')}">${accountIcon('trash', 16)}</button>
        </div>
      </div>
    </div>
  `;
  }).join('');
  fallbackAccountAvatars(container);

  // Setup login to Twitch buttons
  container.querySelectorAll('.account-btn.login-twitch').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await handleTwitchWebLogin(btn.getAttribute('data-username'));
    });
  });

  // Setup logout from Twitch buttons
  container.querySelectorAll('.account-btn.logout-twitch').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await logoutTwitchAccount(btn.getAttribute('data-username'));
    });
  });

  // Setup activate buttons
  container.querySelectorAll('.account-btn.activate').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await activateAccountOAuth(btn.getAttribute('data-username'));
    });
  });

  // Setup delete buttons
  container.querySelectorAll('.account-btn.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent card click
      await deleteAccount(btn.getAttribute('data-username'));
    });
  });

  // Строка открывает подробности — щелчком или Enter/Пробелом с клавиатуры
  container.querySelectorAll('.account-card').forEach(card => {
    const open = async () => {
      const username = card.getAttribute('data-username');
      const list = await Storage.getAccounts();
      const account = list.find(a => a.username === username);
      if (account) showAccountDetailsModal(account, card);
    };
    card.addEventListener('click', (e) => {
      // Don't show modal if clicking on buttons or drag handle
      if (e.target.closest('.account-actions') || e.target.closest('.drag-handle')) return;
      open();
    });
    card.addEventListener('keydown', (e) => {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // Порядок с клавиатуры: перетаскивание мышью доступно не всем
        e.preventDefault();
        const sibling = e.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
        if (!sibling?.classList.contains('account-card')) return;
        if (e.key === 'ArrowUp') container.insertBefore(card, sibling);
        else container.insertBefore(sibling, card);
        card.focus();
        saveAccountOrder(container);
      }
    });
  });

  // Setup drag-and-drop reordering
  if (several) setupAccountDragAndDrop();
}

/** Порядок строк на экране → priority в хранилище. */
async function saveAccountOrder(container) {
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
  window.utils.showToast(tr('Порядок аккаунтов обновлён'), 'success');
  // Пометка «Основной» должна переехать к новому первому
  renderAccounts(await Storage.getAccounts());
}

function setupAccountDragAndDrop() {
  const container = document.getElementById('accounts-list');
  if (!container) return;

  let draggedElement = null;

  container.querySelectorAll('.account-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedElement = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedElement = null;
    });

    card.addEventListener('dragover', (e) => {
      if (!draggedElement) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const afterElement = getDragAfterElement(container, e.clientY);
      if (afterElement == null) {
        container.appendChild(draggedElement);
      } else if (afterElement !== draggedElement) {
        container.insertBefore(draggedElement, afterElement);
      }
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      await saveAccountOrder(container);
    });
  });
}

function getDragAfterElement(container, y) {
  // Перетаскиваемую строку помечает класс .dragging. Раньше её искали по
  // style="opacity", и строки, которые уже перетаскивали однажды, навсегда
  // выпадали из расчёта
  const draggableElements = [...container.querySelectorAll('.account-card:not(.dragging)')];

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

/** Текст окна подтверждения: заголовок и одна-две строки, без значков-кругов. */
function accountConfirmHtml(title, textHtml) {
  return `
    <div class="settings-confirm">
      <h3 class="settings-confirm-title">${window.escapeHtml(title)}</h3>
      ${textHtml ? `<p class="settings-confirm-text">${textHtml}</p>` : ''}
    </div>
  `;
}

async function logoutTwitchAccount(username) {
  const esc = window.escapeHtml;
  const confirmed = await window.utils.showCustomConfirmation(
    accountConfirmHtml(tr('Выйти из Twitch?'),
      tr('Аккаунт {name} останется в списке, но для фарминга дропсов и баллов придётся войти снова.', { name: `<b>${esc(username)}</b>` })),
    { confirmText: tr('Выйти'), cancelText: tr('Отмена'), confirmClass: 'btn-danger' });

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
    window.utils.showToast(tr('Выполнен выход из {name}', { name: username }), 'success');
  }
}

async function activateAccountOAuth(username) {
  window.utils.showToast(tr('Открываем OAuth авторизацию...'), 'info');

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
        window.utils.showToast(tr('Аккаунт {name} активирован!', { name: username }), 'success');
      }
    } else {
      // Неудачный вход раньше проходил молча: кнопка ничего не говорила
      throw new Error(result?.error || tr('Авторизация не удалась'));
    }
  } catch (error) {
    console.error('Activation error:', error);
    window.utils.showToast(friendlyLoginError(error?.message), 'error');
  }
}

async function deleteAccount(username) {
  const esc = window.escapeHtml;
  const confirmed = await window.utils.showCustomConfirmation(
    accountConfirmHtml(tr('Удалить аккаунт?'),
      tr('Аккаунт {name} пропадёт из списка. Чтобы вернуть его, придётся войти заново.', { name: `<b>${esc(username)}</b>` })),
    { confirmText: tr('Удалить'), cancelText: tr('Отмена'), confirmClass: 'btn-danger' });

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
    window.utils.showToast(tr('Аккаунт {name} удалён, фарминг остановлен', { name: username }), 'success');
    return;
  }

  // Здесь же раньше обращались к несуществующему confirmModal, и каждое
  // удаление заканчивалось ошибкой в консоли: окно подтверждения
  // закрывает себя само
  window.utils.showToast(tr('Аккаунт {name} удалён', { name: username }), 'success');
}

async function handleTwitchLogin() {
  try {
    console.log('handleTwitchLogin called - opening browser for OAuth');
    window.utils.showToast(tr('Открываю браузер для авторизации...'), 'info');

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
      window.utils.showToast(tr('Добро пожаловать, {name}!', { name: account.displayName }), 'success');
    } else {
      throw new Error(result?.error || tr('Авторизация не удалась'));
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
  if (/access_denied/i.test(text)) return tr('Вход отменён в браузере');
  // Ответ браузера принимает локальный сервер на порту 3000
  if (/EADDRINUSE|address already in use/i.test(text)) {
    return tr('Порт 3000 занят другой программой — закройте её и повторите вход');
  }
  // Сеть проверяем раньше ожидания: ETIMEDOUT — обрыв связи, а не
  // брошенное окно браузера
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(text)) {
    return tr('Нет связи с Twitch — проверьте интернет и повторите вход');
  }
  if (/time\s*out|timed\s*out/i.test(text)) {
    return tr('Вход не завершён — нажмите «Войти через Twitch» ещё раз');
  }
  // Готовый русский текст из главного процесса показываем как есть,
  // кроме полуанглийского «Не удалось получить access token». В
  // английском — его перевод из словаря, а если перевода нет, общий текст
  // ниже: полрусского тоста хуже, чем просто «не удалось»
  if (/[а-яё]/i.test(text) && !/token/i.test(text)) {
    const shown = tr(text);
    if (tr.lang() !== 'en' || !/[а-яё]/i.test(shown)) return shown;
  }
  return tr('Не удалось войти в Twitch — попробуйте ещё раз');
}

async function handleTwitchWebLogin(username) {
  // У webview входа нет allowpopups: атрибут булев, и прежний
  // allowpopups="false" как раз разрешал всплывающие окна в сессии Twitch.
  // Класс .auth-modal сохранён: по нему фарминг понимает, что открыто окно
  // входа, и не перезапускается поверх него
  const returnFocus = document.activeElement;
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-modal-overlay"></div>
    <div class="auth-modal-content twitch-login-modal" role="dialog" aria-modal="true" aria-labelledby="twitch-login-title">
      <div class="auth-modal-header">
        <h3 id="twitch-login-title">${tr('Вход в Twitch')}</h3>
        <button type="button" class="close-modal" title="${tr('Закрыть')}" aria-label="${tr('Закрыть')}">
          ${accountIcon('close', 16)}
        </button>
      </div>
      <div class="auth-modal-body">
        <p class="twitch-login-why">
          ${accountIcon('info', 16)}
          <span><b>${tr('Зачем нужен вход в Twitch?')}</b> ${tr('Без входа Twitch не засчитывает минуты просмотра и не даёт собирать баллы канала. Войдите в окне ниже — оно закроется само.')}</span>
        </p>

        <div class="twitch-login-frame">
          <webview id="twitch-login-webview"
                   src="https://www.twitch.tv/login"
                   partition="persist:twitch"></webview>
        </div>

        <div class="twitch-login-foot">
          <div id="login-status" class="twitch-login-status" role="status">${tr('Жду вход в Twitch… После входа окно закроется само')}</div>
          <button type="button" class="btn btn-secondary close-modal">${tr('Закрыть')}</button>
          <button type="button" class="btn btn-primary" id="check-login-btn">
            ${accountIcon('check', 16)}<span>${tr('Проверить авторизацию')}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.style.overflow = 'hidden';
  document.body.appendChild(modal);

  const webview = modal.querySelector('#twitch-login-webview');
  const checkBtn = modal.querySelector('#check-login-btn');
  const statusDiv = modal.querySelector('#login-status');
  const setStatus = (text, tone = '') => {
    statusDiv.innerHTML = `<span${tone ? ` class="tone-${tone}"` : ''}>${window.escapeHtml(text)}</span>`;
  };
  // Окно закрывают и по таймеру после входа, и кнопкой — второй вызов
  // не должен падать на уже убранном окне
  const closeModal = () => {
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey, true);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    if (returnFocus && document.body.contains(returnFocus)) returnFocus.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      clearInterval(autoCheckInterval);
      closeModal();
    }
  };
  document.addEventListener('keydown', onKey, true);
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
        setStatus(tr('Жду вход в Twitch…'));
        return false;
      }

      // Проверяем наличие элементов которые появляются только после авторизации
      const isLoggedIn = await webview.executeJavaScript(/* i18n-ignore: код для страницы Twitch */ `
        (function() {
          // Проверяем URL еще раз внутри webview
          if (window.location.href.includes('/login') || window.location.href.includes('/passport')) {
            return false;
          }

          // Способ 1: Проверяем кнопку пользовательского меню (самый надежный)
          if (document.querySelector('[data-a-target="user-menu-toggle"]')) return true;

          // Способ 2: Проверяем аватар пользователя в шапке
          if (document.querySelector('figure[class*="ScAvatar"], img[alt*="user avatar"]')) return true;

          // Способ 3: Проверяем наличие имени пользователя в DOM
          const usernameElement = document.querySelector('[data-a-target="user-display-name"]');
          if (usernameElement && usernameElement.textContent.trim().length > 0) return true;

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
            setStatus(tr('Вход есть, но аккаунт не найден. Добавьте его кнопкой «Добавить аккаунт»'), 'warn');
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

            setStatus(tr('Вход выполнен — закрываю окно'), 'ok');
            window.utils.showToast(tr('Аккаунт {name} активирован!', { name: account.username }), 'success');
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
      document.removeEventListener('keydown', onKey, true);
      return;
    }
    checkTwitchLogin();
  }, 3000);

  // Первая проверка через 2 секунды после открытия (даем время загрузиться)
  setTimeout(() => checkTwitchLogin(), 2000);

  // Обработчик кнопки "Проверить авторизацию" (ручная проверка)
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    setStatus(tr('Проверяю вход…'));

    const result = await checkTwitchLogin();

    if (result === false) {
      setStatus(tr('Войдите в Twitch в окне выше и попробуйте снова'), 'warn');
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

  modal.querySelector('.close-modal')?.focus();
}

// Окно «Об аккаунте». Раньше — цветные плитки на каждое поле (фиолетовая
// почта, зелёный метод, оранжевая дата, голубое время); теперь спокойный
// список «название — значение», цвет только у статуса
function showAccountDetailsModal(account, returnFocusTo = null) {
  // Имя, аватар и почта — внешние строки: в разметку только экранированными
  const esc = window.escapeHtml;
  const username = esc(account.username);
  const state = describeAccountState(account);
  const locale = tr.locale();

  const addedDate = account.addedAt ? new Date(account.addedAt) : null;
  const lastLoginDate = account.lastLogin ? new Date(account.lastLogin) : null;
  const oauthExpiryDate = account.oauthExpiresAt ? new Date(account.oauthExpiresAt) : null;
  const valid = (d) => d && !isNaN(d.getTime());

  const facts = [
    account.email ? `
      <div class="account-fact">
        <dt>Email</dt>
        <dd><button type="button" class="account-copy" data-copy="${esc(account.email)}" title="${tr('Скопировать')}">
          <span class="truncate">${esc(account.email)}</span>${accountIcon('copy', 14)}
        </button></dd>
      </div>` : '',
    `<div class="account-fact">
      <dt>${tr('Метод авторизации')}</dt>
      <dd>${account.loginMethod === 'oauth' ? 'OAuth 2.0' : 'Cookie'}</dd>
    </div>`,
    valid(addedDate) ? `<div class="account-fact">
      <dt>${tr('Дата добавления')}</dt>
      <dd>${addedDate.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
    </div>` : '',
    valid(lastLoginDate) ? `<div class="account-fact">
      <dt>${tr('Последняя активность')}</dt>
      <dd>${lastLoginDate.toLocaleString(locale, { day: 'numeric', month: 'long', hour: tr.lang() === 'en' ? 'numeric' : '2-digit', minute: '2-digit' })}</dd>
    </div>` : '',
    valid(oauthExpiryDate) && state.isActive ? `<div class="account-fact">
      <dt>${tr('OAuth-токен истекает')}</dt>
      <dd class="${state.tokenExpiringSoon ? 'tone-warn' : ''}">${oauthExpiryDate.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
    </div>` : ''
  ].filter(Boolean).join('');

  const actionLabel = state.action === 'activate' ? tr('Подключить через Twitch')
    : state.action === 'login' ? tr('Войти в Twitch') : '';

  const modal = document.createElement('div');
  modal.className = 'dialog-backdrop account-details-backdrop';
  modal.innerHTML = `
    <div class="dialog dialog-sm account-details-modal" role="dialog" aria-modal="true" aria-labelledby="account-details-title">
      <div class="dialog-head">
        <div>
          <div class="dialog-eyebrow">${tr('Информация об аккаунте')}</div>
          <h2 class="dialog-title" id="account-details-title" data-no-tr>${esc(account.displayName || account.username)}</h2>
        </div>
        <button type="button" class="dialog-close modal-close-btn" title="${tr('Закрыть')}" aria-label="${tr('Закрыть')}">
          ${accountIcon('close', 16)}
        </button>
      </div>

      <div class="dialog-body">
        <div class="account-hero">
          <div class="account-avatar account-avatar-lg">${accountAvatarHtml(account, 56)}</div>
          <div class="account-hero-text">
            <button type="button" class="account-copy account-handle" data-copy="@${username}" title="${tr('Скопировать')}">@${username}${accountIcon('copy', 14)}</button>
            <span class="badge ${state.tone === 'success' ? 'badge-success' : 'badge-warning'}">${esc(state.badge)}</span>
          </div>
        </div>

        <dl class="account-facts">${facts}</dl>

        ${state.action ? `
          <div class="account-alert">
            ${accountIcon('warning', 16)}
            <div>
              <div class="account-alert-title">${tr('Требуется действие')}</div>
              <div>${state.action === 'activate' ? tr('Для корректной работы необходима OAuth-авторизация.') : tr('Требуется вход в Twitch для фарминга дропсов и баллов канала.')}</div>
            </div>
          </div>` : ''}
      </div>

      ${state.action ? `
        <div class="dialog-foot">
          <button type="button" class="btn btn-secondary" data-action="close">${tr('Закрыть')}</button>
          <button type="button" class="btn btn-primary" data-action="fix">${actionLabel}</button>
        </div>` : ''}
    </div>
  `;

  document.body.style.overflow = 'hidden';
  document.body.appendChild(modal);
  fallbackAccountAvatars(modal);

  const closeModal = () => {
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey, true);
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    if (returnFocusTo && document.body.contains(returnFocusTo)) returnFocusTo.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeModal();
    }
  };
  document.addEventListener('keydown', onKey, true);

  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  modal.querySelector('[data-action="close"]')?.addEventListener('click', closeModal);
  modal.querySelector('[data-action="fix"]')?.addEventListener('click', () => {
    closeModal();
    if (state.action === 'activate') activateAccountOAuth(account.username);
    else handleTwitchWebLogin(account.username);
  });

  // Закрывает только щелчок, начатый на фоне: выделение текста с
  // отпусканием мыши за краем окна раньше закрывало его
  let downOnBackdrop = false;
  modal.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === modal; });
  modal.addEventListener('click', (e) => {
    if (e.target === modal && downOnBackdrop) closeModal();
  });

  // Add click handlers for copying
  modal.querySelectorAll('[data-copy]').forEach(element => {
    element.addEventListener('click', async () => {
      const textToCopy = element.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(textToCopy);
        window.utils.showToast(tr('Скопировано: {text}', { text: textToCopy }), 'success');
      } catch (error) {
        console.error('Failed to copy:', error);
        window.utils.showToast(tr('Ошибка копирования'), 'error');
      }
    });
  });

  (modal.querySelector('[data-action="fix"]') || modal.querySelector('.modal-close-btn'))?.focus();
}

// Expose functions globally
window.AccountsPage = function() {
  this.init = initAccountsPage;
};

window.initAccountsPage = initAccountsPage;
// Окно входа зовёт и экран повторного входа (LoginGuard)
window.handleTwitchWebLogin = handleTwitchWebLogin;
