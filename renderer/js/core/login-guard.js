/**
 * LoginGuard — экран повторного входа в Twitch.
 *
 * Токен Twitch живёт в cookie webview и может пропасть: протух, Twitch
 * разлогинил, Chromium сменил формат хранилища при обновлении. Раньше
 * приложение об этом не сообщало: стрим играл, минуты не шли, инвентарь
 * был пуст, а пользователь узнавал об этом утром. Теперь при запуске и
 * раз в пять минут проверяется, есть ли cookie, и если аккаунт сохранён,
 * а входа нет — показывается экран с одной кнопкой «Войти в Twitch», а в
 * сайдбаре висит красный значок, пока вход не восстановлен.
 *
 * Логика решения вынесена в чистые функции ради тестов.
 */
class LoginGuard {
  static get FIRST_CHECK_MS() {
    return 10 * 1000;
  }

  static get PERIOD_MS() {
    return 5 * 60 * 1000;
  }

  /** Напоминать экраном не чаще, чем раз в час; значок висит всегда. */
  static get PROMPT_COOLDOWN_MS() {
    return 60 * 60 * 1000;
  }

  /**
   * Нужен ли экран.
   *   accounts — сохранённые аккаунты (без них входа и не ждём);
   *   loggedIn — есть ли cookie auth-token;
   *   lastPromptAt — когда экран показывали в прошлый раз.
   */
  static shouldPrompt({ accounts, loggedIn, lastPromptAt = 0, now = Date.now() }) {
    if (!Array.isArray(accounts) || accounts.length === 0) return false;
    if (loggedIn) return false;
    return now - lastPromptAt >= LoginGuard.PROMPT_COOLDOWN_MS;
  }

  /** Значок в сайдбаре: пока аккаунт есть, а входа нет. */
  static shouldBadge({ accounts, loggedIn }) {
    return Array.isArray(accounts) && accounts.length > 0 && !loggedIn;
  }

  /**
   * Вернуть ли флаг входа аккаунту: вход есть, флага нет, а снимала его
   * сама проверка (метка twitchSessionLost), а не кнопка «Выйти из Twitch».
   */
  static shouldRestore({ account, loggedIn }) {
    return !!(loggedIn && account && !account.twitchLoggedIn && account.twitchSessionLost);
  }

  constructor() {
    this.lastPromptAt = 0;
    this.timer = null;
    this.overlay = null;
  }

  start() {
    if (this.timer) return;
    setTimeout(() => this.check(), LoginGuard.FIRST_CHECK_MS);
    this.timer = setInterval(() => this.check(), LoginGuard.PERIOD_MS);
  }

  async check() {
    if (!window.electronAPI?.hasTwitchSession) return;

    let accounts = [];
    let loggedIn = true;
    let revoked = false;
    try {
      accounts = (await Storage.getAccounts()) || [];
      const state = await window.electronAPI.hasTwitchSession();
      loggedIn = !!state?.loggedIn;
      // cookie на месте, но Twitch сам завершил этот вход: «истёк» тут
      // неправда, и пользователь искал бы, что сломалось у него
      revoked = !!state?.revoked;
    } catch (error) {
      console.warn('[Вход] Проверка не удалась:', error?.message);
      return;
    }

    this.renderBadge(LoginGuard.shouldBadge({ accounts, loggedIn }));

    if (loggedIn) {
      if (this.overlay) this.close();

      // Вход вернулся. Флаг, который эта же проверка сняла, когда cookie
      // пропал, возвращаем первому аккаунту — под ним идёт фарминг, а
      // берёт он только аккаунты с флагом. Иначе вход в обход карточки
      // (значок в сайдбаре, cookie вернулся сам) оставлял фарминг
      // заблокированным. Флаг, снятый кнопкой «Выйти из Twitch», не
      // трогаем: метки twitchSessionLost у такого аккаунта нет
      const first = accounts[0];
      if (LoginGuard.shouldRestore({ account: first, loggedIn })) {
        first.twitchLoggedIn = true;
        delete first.twitchSessionLost;
        try {
          await Storage.saveAccount(first);
          if (typeof window.loadAndRenderAccounts === 'function') window.loadAndRenderAccounts();
        } catch (e) { /* не критично: вернём при следующей проверке */ }
      }
      return;
    }

    // Сохранённый флаг «в Twitch вошли» больше не соответствует правде:
    // снимаем его, чтобы на вкладке аккаунтов появилась кнопка входа.
    // Метка нужна, чтобы при возврате входа отличить это от ручного выхода
    for (const account of accounts) {
      if (account.twitchLoggedIn) {
        account.twitchLoggedIn = false;
        account.twitchSessionLost = true;
        try { await Storage.saveAccount(account); } catch (e) { /* не критично */ }
      }
    }

    if (LoginGuard.shouldPrompt({ accounts, loggedIn, lastPromptAt: this.lastPromptAt })) {
      this.lastPromptAt = Date.now();
      this.show(accounts[0], { revoked });
    }
  }

  renderBadge(visible) {
    const badge = document.getElementById('login-badge');
    if (!badge) return;
    badge.hidden = !visible;
  }

  show(account, { revoked = false } = {}) {
    if (this.overlay) return;

    const user = account?.username ? ' <b>' + window.escapeHtml(account.username) + '</b>' : '';
    const reason = revoked
      ? 'Twitch завершил сеанс' + (user ? ' аккаунта' + user : '') + ' — войдите заново.'
      : (user
          ? 'Twitch не узнаёт вход аккаунта' + user + ': сохранённый вход истёк.'
          : 'Сохранённый вход в Twitch истёк.');

    const overlay = document.createElement('div');
    overlay.id = 'login-guard-overlay';
    overlay.className = 'whats-new-overlay';
    // Раньше надзаголовок обещал остановку фарминга, а текст — что стрим
    // продолжит играть. Верно второе: плеер никто не останавливает, но без
    // входа Twitch не засчитывает ни минуты, ни награды
    overlay.innerHTML = `
      <div class="whats-new" role="dialog" aria-label="Нужен вход в Twitch" style="max-width: 460px;">
        <div class="whats-new-head">
          <div>
            <div class="whats-new-eyebrow">Награды не засчитываются</div>
            <h2 class="whats-new-title">Войдите в Twitch заново</h2>
          </div>
          <button class="whats-new-close" id="login-guard-close" aria-label="Позже">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="whats-new-body">
          <p style="margin: 0 0 12px; color: var(--text-secondary); line-height: 1.5;">
            ${reason}
            Стрим продолжит играть, но минуты и награды не засчитываются,
            пока вы не войдёте снова.
          </p>
          <div style="display: flex; gap: 10px; margin-top: 16px;">
            <button class="btn btn-primary" id="login-guard-login" style="flex: 1; justify-content: center;">Войти в Twitch</button>
            <button class="btn btn-secondary" id="login-guard-later" style="justify-content: center;">Позже</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const abort = new AbortController();
    this._abort = abort;
    const signal = abort.signal;

    overlay.querySelector('#login-guard-close').addEventListener('click', () => this.close(), { signal });
    overlay.querySelector('#login-guard-later').addEventListener('click', () => this.close(), { signal });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); }, { signal });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); }, { signal });
    overlay.querySelector('#login-guard-login').addEventListener('click', () => this.openLogin(account), { signal });
  }

  close() {
    if (this._abort) this._abort.abort();
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    this._abort = null;
  }

  /** Ведёт на вкладку аккаунтов и открывает окно входа Twitch. */
  async openLogin(account) {
    this.close();

    // Без аккаунта окну входа некого отметить вошедшим, и оно не
    // закрывалось даже после успешного входа. Берём первый — под ним
    // идёт фарминг
    if (!account?.username) {
      try {
        account = (await Storage.getAccounts())?.[0] || account;
      } catch (e) { /* окно само возьмёт первый аккаунт */ }
    }

    window.router?.navigate('accounts');
    // Страница аккаунтов рисуется с задержкой роутера; окно входа живёт в
    // body и от страницы не зависит, но пусть она успеет появиться
    setTimeout(() => {
      if (typeof window.handleTwitchWebLogin === 'function') {
        window.handleTwitchWebLogin(account?.username || '');
      }
    }, 700);
  }
}

if (typeof window !== 'undefined') {
  window.LoginGuard = LoginGuard;
  window.loginGuard = window.loginGuard || new LoginGuard();
}
