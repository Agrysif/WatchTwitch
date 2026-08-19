/**
 * ChatManager — постоянный webview с чатом Twitch.
 *
 * Чат здесь не столько для чтения, сколько рабочий инструмент: именно в нём
 * появляются кнопки бонусных сундуков, которые приложение нажимает само.
 *
 * Раньше этот webview лежал внутри страницы фарминга. Роутер перерисовывает
 * страницу через innerHTML, поэтому при уходе на любую другую вкладку чат
 * уничтожался — и автосбор сундуков вместе с ним. Сундуки собирались только
 * пока пользователь стоял на странице фарминга, а счётчик сундуков в статистике
 * показывал заниженные цифры.
 *
 * Теперь чат живёт в <body> рядом с плеером и переживает навигацию.
 */
class ChatManager extends SlottedWebview {
  constructor() {
    super({
      logName: 'ChatManager',
      hostId: 'persistent-chat-host',
      webviewId: 'twitch-chat',
      zIndex: 5,
      attributes: {
        partition: 'persist:twitch',
        allowpopups: 'false',
        webpreferences: 'contextIsolation=false'
      }
    });

    this.channel = null;
    this.collectorScript = null;
    this.collectorReady = false;
  }

  static get() {
    if (!window._chatManager) {
      window._chatManager = new ChatManager();
    }
    return window._chatManager;
  }

  onCreated(webview) {
    // preload раздаёт автосбор сундуков. Раньше его проставлял инлайновый
    // скрипт страницы, обходивший все webview на ней; теперь чат вне страницы,
    // поэтому ставим сами.
    if (window.electronAPI?.getWebviewPreloadPath) {
      window.electronAPI.getWebviewPreloadPath()
        .then(path => {
          if (path) webview.setAttribute('preload', path);
        })
        .catch(e => console.warn('[ChatManager] Не удалось получить preload:', e?.message));
    }

    // Скрипт-сборщик переинжектится при каждой загрузке документа:
    // после смены канала или перезагрузки чата предыдущая инъекция пропадает.
    webview.addEventListener('dom-ready', () => this._injectCollector());
  }

  isReadyFor(channelLogin) {
    const login = ChatManager.normalize(channelLogin);
    return this.channel === login && this.collectorReady;
  }

  static normalize(channelLogin) {
    return String(channelLogin || '').replace(/^@/, '').toLowerCase();
  }

  /** Грузит чат канала. Тот же канал повторно не перезагружаем. */
  load(channelLogin) {
    if (!channelLogin) return;

    const login = ChatManager.normalize(channelLogin);
    const webview = this.ensure();

    if (this.channel === login && webview.src) {
      console.log('[ChatManager] Канал не изменился, перезагрузка не нужна:', login);
      return;
    }

    this.channel = login;
    this.collectorReady = false;
    webview.src = `https://www.twitch.tv/embed/${login}/chat?parent=localhost&darkpopout`;
    console.log('[ChatManager] Загружаю чат канала:', login);
  }

  /**
   * Скрипт автосбора задаёт страница фарминга — там он и формируется.
   * ChatManager отвечает за то, чтобы скрипт оказывался внутри чата
   * после каждой его загрузки.
   */
  setCollectorScript(script) {
    this.collectorScript = script;
    if (this.webview && this.webview.src) this._injectCollector();
  }

  _injectCollector() {
    if (!this.collectorScript || !this.webview) return;

    // Даём чату прогрузить разметку: сразу после dom-ready кнопок ещё нет
    setTimeout(() => {
      if (!this.webview || !this.collectorScript) return;

      this.webview.executeJavaScript(this.collectorScript)
        .then(() => {
          this.collectorReady = true;
          console.log('[ChatManager] Сборщик сундуков внедрён');
        })
        .catch(err => {
          console.error('[ChatManager] Не удалось внедрить сборщик:', err?.message);
        });
    }, 3000);
  }

  unload() {
    if (!this.webview) return;
    this.channel = null;
    this.collectorReady = false;
    try {
      this.webview.src = '';
    } catch (e) {
      console.warn('[ChatManager] Не удалось очистить src:', e.message);
    }
    this.detach();
  }
}

window.ChatManager = ChatManager;
window.chatManager = ChatManager.get();
