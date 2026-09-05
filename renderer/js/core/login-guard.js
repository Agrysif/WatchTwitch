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
    try {
      accounts = (await Storage.getAccounts()) || [];
      const state = await window.electronAPI.hasTwitchSession();
      loggedIn = !!state?.loggedIn;
    } catch (error) {
      console.warn('[Вход] Проверка не удалась:', error?.message);
      return;
    }

    this.renderBadge(LoginGuard.shouldBadge({ accounts, loggedIn }));

    if (loggedIn) {
      if (this.overlay) this.close();
      return;
    }

    // Сохранённый флаг «в Twitch вошли» больше не соответствует правде:
    // снимаем его, чтобы на вкладке аккаунтов появилась кнопка входа
    for (const account of accounts) {
      if (account.twitchLoggedIn) {
        account.twitchLoggedIn = false;
        try { await Storage.saveAccount(account); } catch (e) { /* не критично */ }
      }
    }

    if (LoginGuard.shouldPrompt({ accounts, loggedIn, lastPromptAt: this.lastPromptAt })) {
      this.lastPromptAt = Date.now();
      this.show(accounts[0]);
    }
  }

  renderBadge(visible) {
    const badge = document.getElementById('login-badge');
    if (!badge) return;
    badge.hidden = !visible;
  }

  show(account) {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'login-guard-overlay';
    overlay.className = 'whats-new-overlay';
    overlay.innerHTML = `
      <div class="whats-new" role="dialog" aria-label="Нужен вход в Twitch" style="max-width: 460px;">
        <div class="whats-new-head">
          <div>
            <div class="whats-new-eyebrow">Фарминг остановится без входа</div>
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
            Twitch не узнаёт сохранённый вход${account?.username ? ' аккаунта <b>' + String(account.username).replace(/[<>&]/g, '') + '</b>' : ''}:
            токен протух или хранилище браузера обновилось. Стрим будет играть,
            но минуты просмотра и награды без входа не засчитываются.
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
  openLogin(account) {
    this.close();
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
