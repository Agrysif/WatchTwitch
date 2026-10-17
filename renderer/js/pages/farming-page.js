// Farming page logic
class FarmingPage {
  /** Срок защёлки запуска и блокировки кнопки «Начать фарминг» — один на обоих. */
  static get START_LATCH_MS() {
    return 90000;
  }

  /**
   * Как часто записывать живую сессию в статистику. Каждая запись
   * переписывает файл настроек целиком; раз в полминуты — лишнее:
   * длительность считается в минутах, а признака жизни lastSeenAt хватает
   * с запасом (сессия считается брошенной через 10 минут тишины).
   */
  static get LIVE_STATS_MS() {
    return 60000;
  }

  constructor() {
    this.i18n = window.i18n;
    this.categories = [];
    this.updateInterval = null;
    this.dropsFilterEnabled = false;
    // sessionStartTime намеренно НЕ обнуляется: это свойство проксируется
    // в window.sessionState, который переживает пересоздание страницы.
    this.sessionInterval = null;
    this.statsUpdateInterval = null;
    this.estimatedBandwidth = 0;
    this.sessionBytes = 0;
    this.bandwidthHistory = [];
    this.streamStatsInterval = null;
    this.viewersHistory = [];
    this.currentCategory = null;
    this.currentStream = null;
    this.dropsMissingChecks = 0;
    this.activeSessionResumed = false;
    this.isEventListenersSetup = false;
    this._destroyed = false;
    this.streamInfoClickHandler = null;
    this.isStreamDetailsOpen = false;
    this.activeChatChannelLogin = null;
    this.manualPlayLockCategoryId = null;
    // Категория, запущенная пользователем вручную. Приложение не переключает
    // её самостоятельно — только предлагает.
    this.manualCategoryId = null;
    this.lastAutoDropsSyncAt = 0;
    this.autoDropsModeEnabled = false;
    // id категорий, которые страница уже видела. Нужны при сохранении:
    // категорию, добавленную в хранилище в обход страницы (календарь,
    // копия), надо подхватить, а удалённую здесь — не воскрешать.
    this._knownCategoryIds = new Set();
    // Категории, где только что никто не стримил: id → до какого времени
    // их пропускать. Выключать такие категории насовсем нельзя — ночью
    // стримы кончаются, а утром появляются снова.
    this._noStreamsUntil = new Map();

    // Те же цвета, что на странице «Дропсы»: окно награды одно на обе
    // страницы, и со старой кислотной палитрой отсюда оно выглядело иначе
    this.rarityTiers = [
      { name: 'common', label: tr('Обычный'), minMinutes: 0, maxMinutes: 60, minViewers: 50000, color: '#8a93a3', glow: 'rgba(138, 147, 163, 0.4)' },
      { name: 'uncommon', label: tr('Необычный'), minMinutes: 61, maxMinutes: 120, minViewers: 30000, color: '#35d08a', glow: 'rgba(53, 208, 138, 0.4)' },
      { name: 'rare', label: tr('Редкий'), minMinutes: 121, maxMinutes: 240, minViewers: 15000, color: '#4aa3ff', glow: 'rgba(74, 163, 255, 0.4)' },
      { name: 'epic', label: tr('Эпический'), minMinutes: 241, maxMinutes: 480, minViewers: 8000, color: '#7c5cff', glow: 'rgba(124, 92, 255, 0.4)' },
      { name: 'legendary', label: tr('Легендарный'), minMinutes: 481, maxMinutes: 720, minViewers: 3000, color: '#f0a83c', glow: 'rgba(240, 168, 60, 0.4)' },
      { name: 'mythic', label: tr('Мифический'), minMinutes: 721, maxMinutes: 99999, minViewers: 0, color: '#f0555f', glow: 'rgba(240, 85, 95, 0.4)' }
    ];
    
    // Учёт баллов канала.
    //
    // Разделяем три величины, потому что интерфейс показывает разное:
    //   sessionEarned     — накоплено за всю сессию фарминга (переживает смену стрима)
    //   earnedThisStream  — накоплено на текущем стриме
    //   chests*/passive*  — разбивка по источнику: разовые сундуки против просмотра
    // channelPoints и sessionDropsCollected проксируются в window.sessionState:
    // учёт баллов должен переживать пересоздание страницы.

    this.init();
  }

  async init() {
    this.categories = await Storage.getCategories();
    this.stripServiceFields(this.categories);
    this.rememberCategoryIds(this.categories);
    this.autoDropsModeEnabled = await Storage.get('autoDropsModeEnabled', this.categories.some(cat => cat.autoDrops === true));
    this.renderCategories();
    this.setupEventListeners();

    // Завершаем сессию при закрытии приложения (сохраняем активную сессию).
    // Подписка одна на всё приложение: страница пересоздаётся при каждой
    // навигации, а ipcRenderer.on не имеет автоснятия — иначе обработчики
    // копились бы бесконечно.
    //
    // Main ждёт ответа farming-saved не дольше 3 секунд, а потом закрывает
    // окно. Раньше здесь сначала шёл запрос трафика (updateSessionInfo), а
    // записи stopFarming никто не ждал: окно закрывалось раньше, время по
    // играм терялось, а сессия в статистике оставалась «активной». Теперь
    // останавливаемся сразу, дожидаемся всех записей и только тогда
    // отвечаем. Без сессии отвечаем сразу, чтобы выход не ждал впустую.
    if (!window._appClosingHooked &&
        window.electronAPI && typeof window.electronAPI.onAppClosing === 'function') {
      window._appClosingHooked = true;
      window.electronAPI.onAppClosing(() => {
        const reply = () => {
          try { window.electronAPI?.notifyFarmingSaved?.(); } catch (e) { /* main сам закроет по сроку */ }
        };
        const page = window.farmingPage;
        if (!page || !page.sessionStartTime) {
          reply();
          return;
        }
        let saving = null;
        try {
          saving = page.stopFarming(false, true);
        } catch (error) {
          console.error('[Выход] Не удалось сохранить сессию:', error);
        }
        Promise.resolve(saving).catch(() => {}).finally(reply);
      });
    }

    // Восстанавливаем активную сессию ПЕРВЫМ делом.
    //
    // Раньше перед этим запускались периодические проверки, а следом шла
    // загрузка подписанных каналов — десятки запросов к Twitch. Пока она
    // тянулась, страница не знала, что именно фармит: проверки дропсов
    // работали с пустой категорией, заключали «дропсов нет» и через три
    // круга переключали категорию. Со стороны это выглядело так, будто
    // приложение забыло про Overwatch, стоило уйти на другую вкладку.
    await this.resumeActiveSession();

    // Только теперь заводим периодические проверки: им нужна
    // восстановленная категория
    this.startAutoUpdate();

    // Подписки в категории больше не превращаются. При каждом запуске по
    // каждой подписке уходил запрос в Twitch (десятки на старте, ближе к
    // 429), а канал с именем игры («warframe») добавлялся как категория и
    // возвращался после удаления. Подписки и так учитывает выбор стрима
    // (pickPreferredStream) при включённом приоритете подписок.

    // Если есть авто-категории, автоматически запускаем фарминг (если не восстановили активную)
    if (!this.activeSessionResumed && this.categories.some(cat => cat.enabled) && (!window.streamingManager || !window.streamingManager.isFarmingActive || !window.streamingManager.isFarmingActive())) {
      this.startFarming();
    }

    if (window.streamingManager && window.streamingManager.isFarmingActive) {
      if (window.streamingManager.isFarmingActive()) {
        this.showFarmingState();
      }
    }
  }

  /**
   * Экранирует строку перед вставкой в разметку.
   *
   * Названия стримов, описания каналов и имена категорий приходят от
   * Twitch и из файлов копий. Вставленные как есть, они давали любому
   * стримеру выполнить код внутри приложения: заголовок вида
   * <img onerror=…> срабатывал при открытии окна стрима. Общая функция
   * живёт в dom-helpers.js; запасной вариант — на случай, если файл
   * подключили без неё.
   */
  esc(text) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(text);
    return String(text ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  /**
   * Адрес картинки, который безопасно подставить в src и в CSS url().
   * Экранирование здесь не спасает: в атрибуте style &#39; снова
   * превращается в кавычку и закрывает url('…').
   */
  safeImageUrl(url, fallback = '') {
    const value = String(url || '').trim();
    return /^https:\/\/[^\s'"()<>\\]+$/i.test(value) ? value : fallback;
  }

  /**
   * Убирает из категорий служебные поля с «_» в начале.
   *
   * Старые версии сохраняли в категорию отметку _switchScheduled, и она
   * переживала перезапуск. Код её больше не читает, а из хранилища она
   * уйдёт при ближайшей записи списка.
   */
  stripServiceFields(list) {
    (Array.isArray(list) ? list : []).forEach(cat => {
      if (!cat || typeof cat !== 'object') return;
      Object.keys(cat).forEach(key => {
        if (key.startsWith('_')) delete cat[key];
      });
    });
  }

  rememberCategoryIds(list) {
    if (!this._knownCategoryIds) this._knownCategoryIds = new Set();
    (list || []).forEach(cat => {
      if (cat && cat.id != null) this._knownCategoryIds.add(cat.id);
    });
  }

  /**
   * Сохраняет список категорий, не теряя добавленные в обход страницы.
   *
   * Страница держит список в памяти и пишет его целиком. Календарь и
   * восстановление копии пишут в хранилище сами, и первое же сохранение
   * здесь молча затирало их категорию. Поэтому перед записью подхватываем
   * из хранилища то, чего страница ещё не видела. То, что она видела и
   * убрала сама, обратно не возвращаем.
   */
  async saveCategories() {
    try {
      const stored = await Storage.getCategories();
      if (Array.isArray(stored)) {
        const known = this._knownCategoryIds || new Set();
        for (const cat of stored) {
          if (!cat || cat.id == null || known.has(cat.id)) continue;
          if (this.categories.some(c => c.id === cat.id ||
              this.normalizeGameKey(c.name) === this.normalizeGameKey(cat.name))) continue;
          this.categories.push(cat);
          console.log('[Категории] Подхватил добавленную вне фарминга:', cat.name);
        }
      }
    } catch (error) {
      // Без чтения хранилища сохраняем как есть — как и раньше
    }
    this.rememberCategoryIds(this.categories);
    await Storage.saveCategories(this.categories);
  }

  /**
   * Перечитывает категории из хранилища.
   *
   * Вызывается по событию wt:categories-changed: его шлют календарь
   * и восстановление копии, записав список напрямую.
   */
  async reloadCategoriesFromStorage() {
    try {
      const fresh = await Storage.getCategories();
      if (this._destroyed || !Array.isArray(fresh)) return;

      const currentId = this.currentCategory?.id;
      this.stripServiceFields(fresh);
      this.categories = fresh;
      this.rememberCategoryIds(fresh);

      // Текущая категория должна остаться тем же объектом, что в списке,
      // иначе её отметки (прогресс, «отработана») не попадут в сохранение
      if (currentId) {
        const same = fresh.find(cat => cat.id === currentId);
        if (same) this.currentCategory = same;
      }

      this.renderCategories();
      this.updateAutoDropsButtonState();
      console.log('[Категории] Список перечитан из хранилища:', fresh.length);
    } catch (error) {
      console.warn('[Категории] Не удалось перечитать список:', error?.message);
    }
  }

  /** Тост, который по одному поводу не повторяется чаще раза в 10 минут. */
  toastOnce(key, text, type = 'info', intervalMs = 10 * 60 * 1000) {
    if (!this._toastShownAt) this._toastShownAt = new Map();
    const now = Date.now();
    if (now - (this._toastShownAt.get(key) || 0) < intervalMs) return;
    this._toastShownAt.set(key, now);
    window.utils?.showToast(text, type);
  }

  /**
   * Категории, удалённые пользователем крестиком (нормализованные названия).
   *
   * Синхронизация автокатегорий и подписки возвращали их через пару
   * минут, и пользователь удалял одно и то же по кругу. Теперь удалённое
   * запоминается и пропускается. Добавление той же игры вручную или
   * «Вернуть» сразу после удаления снимают запрет.
   */
  async getDeletedCategoryKeys() {
    if (!this._deletedCategoryKeys) {
      let list = [];
      try {
        list = await Storage.get('deletedCategories', []);
      } catch (error) {
        // без списка просто ничего не пропускаем
      }
      // Пока шло чтение, набор мог завести параллельный вызов
      if (!this._deletedCategoryKeys) {
        this._deletedCategoryKeys = new Set(
          (Array.isArray(list) ? list : []).filter(key => typeof key === 'string' && key)
        );
      }
    }
    return this._deletedCategoryKeys;
  }

  async setCategoryDeleted(name, deleted) {
    const key = this.normalizeGameKey(name);
    if (!key) return;

    const keys = await this.getDeletedCategoryKeys();
    if (keys.has(key) === !!deleted) return;
    if (deleted) keys.add(key);
    else keys.delete(key);

    try {
      await Storage.set('deletedCategories', [...keys]);
    } catch (error) {
      console.warn('[Категории] Не удалось запомнить удалённые:', error?.message);
    }
  }

  /**
   * Можно ли приложению самому включить категорию.
   *
   * Выключенную пользователем — нельзя: синхронизация автокатегорий раньше
   * включала всё подряд, и выключенная игра через пару минут снова была в
   * ротации. Включаем только то, что выключило само приложение.
   */
  mayEnableCategory(category) {
    if (!category || category.userDisabled) return false;
    return category.enabled !== false || !!category.disabledByCompletion || !!category.disabledByApp;
  }

  isSingleManualPlayLocked(category = this.currentCategory) {
    if (!category || !this.manualPlayLockCategoryId) return false;
    if (category.id !== this.manualPlayLockCategoryId) return false;
    if (category.autoDrops) return false;

    const enabledCategories = this.categories.filter(cat => cat.enabled);
    return enabledCategories.length === 1 && enabledCategories[0].id === category.id;
  }

  setManualPlayLock(category) {
    if (!category || category.autoDrops) {
      this.manualPlayLockCategoryId = null;
      return;
    }

    const enabledCategories = this.categories.filter(cat => cat.enabled);
    const manualCategories = this.categories.filter(cat => !cat.autoDrops);

    if (enabledCategories.length === 1 && enabledCategories[0].id === category.id && manualCategories.length === 1) {
      this.manualPlayLockCategoryId = category.id;
      console.log('[ManualPlayLock] Enabled for category:', category.name);
      return;
    }

    this.manualPlayLockCategoryId = null;
  }

  buildActiveCampaignsMapFromCampaigns(campaignsData) {
    const activeCampaignsMap = new Map();
    const campaigns = Array.isArray(campaignsData)
      ? campaignsData
      : (Array.isArray(campaignsData?.campaigns) ? campaignsData.campaigns : []);

    if (!campaigns || campaigns.length === 0) {
      return activeCampaignsMap;
    }

    const now = Date.now();

    for (const campaign of campaigns) {
      const gameNameRaw = campaign?.game?.name || campaign?.game?.displayName || campaign?.game;
      if (!gameNameRaw) continue;

      const normalizedGameKey = this.normalizeGameKey(gameNameRaw);
      if (!normalizedGameKey) continue;

      const startAtRaw = campaign?.startAt || campaign?.startsAt;
      const endAtRaw = campaign?.endAt || campaign?.endsAt;
      const startAtMs = startAtRaw ? new Date(startAtRaw).getTime() : null;
      const endAtMs = endAtRaw ? new Date(endAtRaw).getTime() : null;

      if (startAtMs && startAtMs > now) continue;
      if (endAtMs && endAtMs <= now) continue;

      const status = String(campaign?.status || '').toUpperCase();
      if (status === 'EXPIRED') continue;

      const drops = Array.isArray(campaign.timeBasedDrops)
        ? campaign.timeBasedDrops
        : (Array.isArray(campaign.drops) ? campaign.drops : []);
      const totalDrops = drops.length;
      // Награда за подписку или другое условие (0 минут) просмотром не
      // берётся. Раньше она одна держала кампанию «незавершённой»: отметку
      // «категория отработана» каждые полминуты снимало заново
      const completedDrops = drops.filter(drop => {
        const required = Number(drop.required) || Number(drop.requiredMinutes) || Number(drop.requiredMinutesWatched) || 0;
        const progress = Number(drop.progress) || 0;
        return !!drop.claimed || !!drop.isClaimed || required <= 0 || progress >= required;
      }).length;

      if (totalDrops > 0 && completedDrops >= totalDrops) {
        continue;
      }

      // Прогресс — по набранному времени, тем же счётом, что в панели под
      // стримом и в сайдбаре.
      //
      // Раньше здесь стояло completedDrops / totalDrops: посмотрев 45 минут
      // из 60 и не забрав ничего, категория честно показывала 0, и так до
      // самого получения награды. Панель при этом писала в то же поле свои
      // проценты, а обновление категорий затирало их нулём.
      const withMinutes = drops.map(d => ({
        required: Number(d.required) || Number(d.requiredMinutes) ||
          Number(d.requiredMinutesWatched) || 0,
        progress: Number(d.progress) || Number(d.currentMinutesWatched) || 0,
        claimed: !!(d.claimed || d.isClaimed)
      }));

      const progressPercent = Math.floor(
        window.CampaignValue.timeline({ drops: withMinutes }).percent
      );

      activeCampaignsMap.set(normalizedGameKey, {
        campaign,
        progress: progressPercent
      });
    }

    return activeCampaignsMap;
  }

  /**
   * Кампании с дропсами и признак полноты источника.
   *
   * Полный список отдаёт только dashboard-запрос, а он требует
   * Client-Integrity — тот появляется лишь после того, как в приложении
   * запустится стрим. До этого работает откат на инвентарь, который знает
   * исключительно НАЧАТЫЕ кампании: их полтора десятка против сотни с
   * лишним. Отличать эти два случая обязательно — иначе неполный список
   * выглядит как «дропсов больше нигде нет».
   */
  async loadActiveCampaigns() {
    const campaigns = await window.electronAPI.fetchTwitchDrops();
    const fromDashboard = this.buildActiveCampaignsMapFromCampaigns(campaigns);

    if (fromDashboard.size > 0) {
      this.noteCampaignsComplete(true);
      return { map: fromDashboard, complete: true };
    }

    const inventory = await window.electronAPI.fetchDropsInventory();
    this.noteCampaignsComplete(false);
    return { map: this.buildActiveCampaignsMapFromCampaigns(inventory), complete: false };
  }

  /** Полон ли список кампаний — для подсказки на заглушке простоя. */
  noteCampaignsComplete(complete) {
    if (this._campaignsComplete === complete) return;
    this._campaignsComplete = complete;
    this.updateWaitingSub();
  }

  async loadActiveCampaignsMap() {
    return (await this.loadActiveCampaigns()).map;
  }

  normalizeGameKey(name) {
    if (!name || typeof name !== 'string') return '';
    return name
      .toLowerCase()
      .trim()
      .replace(/[’'`]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Приводит адрес обложки Twitch к нужному размеру. Нет адреса или он не
   * с CDN обложек — пустая строка. Раньше вместо неё возвращалась обложка
   * Just Chatting: она сохранялась в категорию, и игра в списке, календаре
   * и статистике выглядела чужой. Для показа — boxArtSrc с заглушкой.
   */
  normalizeBoxArtURL(url, size = '52x72') {
    const fallback = '';
    if (!url || typeof url !== 'string') return fallback;

    let normalized = url.trim();
    if (!normalized) return fallback;

    if (normalized.startsWith('//')) {
      normalized = `https:${normalized}`;
    }

    normalized = normalized.replace(/^http:\/\//i, 'https://');
    normalized = normalized
      .replace(/\{width\}x\{height\}/gi, size)
      .replace(/(-\d+x\d+)(\.[a-z0-9]+)(\?.*)?$/i, `-${size}$2$3`);

    if (!normalized.startsWith('https://static-cdn.jtvnw.net/ttv-boxart/')) {
      return fallback;
    }

    return normalized;
  }

  /**
   * Адрес обложки для <img>. Нет обложки — нейтральная заглушка вместо
   * чужой картинки. categoryId нужен для старых записей: в них обложка
   * Just Chatting (игра 509658) лежит как запасная у любой игры.
   */
  boxArtSrc(url, size = '52x72', categoryId = null) {
    const normalized = this.normalizeBoxArtURL(url, size);
    const legacyFallback = categoryId != null && String(categoryId) !== '509658' &&
      normalized.includes('/ttv-boxart/509658-');
    return (normalized && !legacyFallback) ? normalized : (window.DROP_PLACEHOLDER || '');
  }

  async syncAutoDropsCategoriesFromInventory(allCategories, activeCampaignsMap = null) {
    if (!this.autoDropsModeEnabled) return 0;

    const now = Date.now();
    if (now - this.lastAutoDropsSyncAt < 120000) {
      return 0;
    }
    this.lastAutoDropsSyncAt = now;

    let campaignsMap = activeCampaignsMap;
    if (!campaignsMap) {
      campaignsMap = await this.loadActiveCampaignsMap();
    }

    if (!campaignsMap || campaignsMap.size === 0) {
      return 0;
    }

    const categoriesByName = new Map(
      (allCategories || []).map(cat => [this.normalizeGameKey(cat.name), cat])
    );
    const deleted = await this.getDeletedCategoryKeys();

    let addedCount = 0;
    let changedExisting = false;

    for (const [gameNameKey, campaignInfo] of campaignsMap.entries()) {
      const existing = this.categories.find(cat => this.normalizeGameKey(cat.name) === gameNameKey);
      const freshCategory = categoriesByName.get(gameNameKey);

      if (existing) {
        if (existing.autoDrops) {
          existing.hasDrops = true;
          // Кампания, признанная безнадёжной, остаётся отработанной, пока
          // у игры не начнётся другая: иначе синхронизация через пару
          // минут возвращала приложение туда, откуда оно только что ушло
          const campaignId = campaignInfo.campaign?.id || '';
          const skipped = !!campaignId && !!existing.skipCampaignIds &&
            existing.skipCampaignIds.split(',').includes(campaignId);
          if (!skipped) existing.dropsCompleted = false;
          // Выключенную пользователем не включаем — только то, что
          // выключило само приложение
          if (this.mayEnableCategory(existing)) {
            existing.enabled = true;
            existing.disabledByApp = false;
          }
          existing.dropsProgressPercent = campaignInfo.progress;
          existing.dropsEndsAt = campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt;
          if (freshCategory?.viewersCount !== undefined) {
            existing.viewersCount = freshCategory.viewersCount;
          }
          if (freshCategory?.boxArtURL) {
            existing.boxArtURL = this.normalizeBoxArtURL(freshCategory.boxArtURL, '52x72');
          }
          changedExisting = true;
        }
        continue;
      }

      // Удалённую пользователем игру обратно не добавляем
      if (deleted.has(gameNameKey)) continue;

      const newCategory = {
        id: freshCategory?.id || `${Date.now()}-${Math.random()}`,
        name: freshCategory?.name || campaignInfo.campaign?.game?.name || campaignInfo.campaign?.game?.displayName || campaignInfo.campaign?.game || gameNameKey,
        boxArtURL: this.normalizeBoxArtURL(freshCategory?.boxArtURL || campaignInfo.campaign?.imageUrl || campaignInfo.campaign?.game?.boxArtURL, '52x72'),
        viewersCount: freshCategory?.viewersCount || 0,
        tags: freshCategory?.tags || [],
        hasDrops: true,
        autoDrops: true,
        enabled: true,
        priority: this.categories.length + 1,
        dropsProgressPercent: campaignInfo.progress,
        dropsEndsAt: campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt,
        dropsCompleted: false
      };

      this.categories.push(newCategory);
      addedCount++;
    }

    if (addedCount > 0 || changedExisting) {
      await this.saveCategories();
      this.renderCategories();
      this.updateAutoDropsButtonState();
    }

    if (addedCount > 0) {
      window.utils.showToast(tr('Автодобавлено новых категорий с дропсами: {count}', { count: addedCount }), 'success');
    }

    // Фарминг отсюда НЕ запускаем. Этот метод вызывается только из init(),
    // который сразу после него сам решает, надо ли стартовать. Отложенный
    // запуск отсюда давал второй параллельный старт — отсюда и брались
    // задвоенные уведомления «Ищем стрим…» и «Нет активных категорий…».

    return addedCount;
  }

  startAutoUpdate() {
    // Страница могла быть уничтожена, пока выполнялся асинхронный init()
    if (this._destroyed) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.updateInterval = setInterval(() => {
      this.updateCategoriesData();
    }, 30000);
  }

  async updateCategoriesData() {
    if (this.categories.length === 0 && !this.autoDropsModeEnabled) return;

    // Прогон при медленном Twitch идёт дольше 30 секунд. Раньше следующий
    // начинался поверх: два прохода одновременно слали запросы и
    // наперегонки сохраняли список категорий
    if (this._updatingCategories) {
      console.log('[Категории] Прошлое обновление ещё идёт — пропускаю');
      return;
    }
    this._updatingCategories = true;
    try {
      await this._updateCategoriesData();
    } finally {
      this._updatingCategories = false;
    }
  }

  async _updateCategoriesData() {
    try {
      console.log('Updating categories data...');

      // Получаем свежие данные о категориях. Не ответил — зрителей не
      // обновляем, а дропсы проверяем как обычно
      const fetched = await window.electronAPI.fetchTwitchCategories();
      const allCategories = Array.isArray(fetched) ? fetched : [];
      const { map: activeCampaignsMap, complete: campaignsComplete } = await this.loadActiveCampaigns();
      const hasInventoryCampaigns = activeCampaignsMap.size > 0;
      
      // updated — изменилось то, что надо сохранить (дропсы, прогресс,
      // кампания, включение). Зрители и теги — только для показа: число
      // зрителей меняется при каждом опросе, и раньше из-за него файл
      // настроек (сотни КБ) переписывался целиком дважды в минуту
      let updated = false;
      let displayChanged = false;
      let manualGainedDrops = false;

      // Обновляем данные наших сохраненных категорий
      for (let category of this.categories) {
        const freshData = allCategories.find(cat => cat.id === category.id);
        if (freshData) {
          const oldViewers = category.viewersCount;
          category.viewersCount = freshData.viewersCount;
          category.tags = freshData.tags || [];

          if (oldViewers !== freshData.viewersCount) {
            displayChanged = true;
          }
        }
        
        // Проверяем наличие дропсов
        const prevHasDrops = !!category.hasDrops;
        const gameNameKey = this.normalizeGameKey(category.name || '');
        const campaignInfo = activeCampaignsMap.get(gameNameKey);

        let hasDrops = false;
        if (campaignInfo) {
          hasDrops = true;

          const prevProgress = category.dropsProgressPercent;
          const prevEndsAt = category.dropsEndsAt;

          category.dropsProgressPercent = campaignInfo.progress;
          category.dropsEndsAt = campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt;

          // Кампании у игры сменяются: одна закончилась, назавтра началась
          // другая. Раньше отметка «зафармлено» ставилась навсегда, а
          // категория оставалась выключенной — приложение считало игру
          // отработанной и не возвращалось к ней, пока стрим не запустят
          // вручную.
          const campaignId = campaignInfo.campaign?.id || '';
          const isNewCampaign = !!campaignId
            && !!category.dropsCampaignIds
            && !category.dropsCampaignIds.split(',').includes(campaignId);

          // Кампания, признанная безнадёжной («не успеть»), остаётся
          // отработанной, пока у игры не начнётся другая. Раньше отметка
          // снималась через полминуты: незавершённая кампания всё ещё в
          // списке, и приложение возвращалось туда, откуда только что ушло.
          const skippedCampaign = !!campaignId && !!category.skipCampaignIds
            && category.skipCampaignIds.split(',').includes(campaignId);

          if (isNewCampaign) {
            category.dropsCompleted = false;
            category.dropsCampaignIds = campaignId;
            delete category.skipCampaignIds;
            delete category.skipReason;
            updated = true;

            // Возвращаем в работу только то, что выключило само приложение
            if (category.disabledByCompletion) {
              category.enabled = true;
              category.disabledByCompletion = false;
              console.log('[Дропсы] Новая кампания, категория снова в работе:', category.name);
              window.utils?.showToast(tr('{name}: новая кампания дропсов', { name: category.name }), 'success');
            }
          } else if (!skippedCampaign) {
            category.dropsCompleted = false;
            if (category.skipCampaignIds) {
              delete category.skipCampaignIds;
              delete category.skipReason;
              updated = true;
            }
          }

          if (prevProgress !== category.dropsProgressPercent || prevEndsAt !== category.dropsEndsAt) {
            updated = true;
          }
        } else if (!hasInventoryCampaigns) {
          // Пустой список кампаний — это незнание (нет входа в Twitch,
          // dashboard ещё не получен), а не «дропсов нет». Раньше здесь по
          // каждой категории уходил отдельный запрос в Twitch: под сотню
          // раз в полминуты, с риском 429, который тормозит и сам фарминг.
          // Прежнее значение оставляем и ждём полного списка; удалять по
          // неполному списку и так запрещено ниже.
          hasDrops = prevHasDrops;
        }

        // Неполный список кампаний (инвентарь без dashboard) знает только
        // начатые кампании. Отсутствие игры в нём ничего не доказывает,
        // поэтому по такому списку дропсы можно найти, но не потерять.
        if (!campaignsComplete && !hasDrops && prevHasDrops) {
          hasDrops = true;
        }

        if (category.hasDrops !== hasDrops) {
          category.hasDrops = hasDrops;
          updated = true;
          // Отслеживаем: у ручной категории появились дропсы
          if (!category.autoDrops && hasDrops && !prevHasDrops) {
            manualGainedDrops = true;
          }
        }
      }
      
      // Авто‑категории без дропсов: удаляем из списка.
      //
      // Удаление — потеря данных, поэтому оно обставлено двумя условиями.
      // Во-первых, источник кампаний должен быть полным: неполный (инвентарь
      // вместо dashboard) знает только начатые кампании, и на нём все
      // остальные категории выглядят пустыми. Именно так однажды исчезли
      // разом семь десятков только что добавленных категорий.
      //
      // Во-вторых, одного наблюдения мало — Twitch отвечает неровно.
      // Категорию убираем, только когда она не показала дропсов несколько
      // проверок подряд.
      if (!this._noDropsStreak) this._noDropsStreak = new Map();

      for (const cat of this.categories) {
        if (cat.autoDrops !== true) continue;
        if (cat.hasDrops === false && campaignsComplete) {
          this._noDropsStreak.set(cat.id, (this._noDropsStreak.get(cat.id) || 0) + 1);
        } else {
          this._noDropsStreak.delete(cat.id);
        }
      }

      const MISSES_BEFORE_REMOVAL = 3;
      const beforeCount = this.categories.length;
      const currentId = this.currentCategory?.id;
      const isRemovable = (cat) => cat.autoDrops === true
        && cat.hasDrops === false
        && !cat.pinned
        && (this._noDropsStreak.get(cat.id) || 0) >= MISSES_BEFORE_REMOVAL;

      const toRemoveIds = this.categories.filter(isRemovable).map(c => c.id);

      if (!campaignsComplete) {
        console.log('[Категории] Список кампаний неполный, ничего не удаляю');
      }

      if (toRemoveIds.length > 0) {
        // Если текущая категория среди удаляемых, переключаемся корректно
        if (currentId && toRemoveIds.includes(currentId)) {
          console.warn('Current auto category lost drops, switching...');
          await this.handleCategoryNoDrops();
        }
        // Удаляем прочие авто‑категории без дропсов
        // Закреплённые не удаляем никогда: закрепление означает «оставить».
        // Раньше закреплённая авто-категория без дропсов вычищалась вместе
        // с остальными и добавлялась заново уже без метки — со стороны это
        // выглядело так, будто закрепление слетает после перезапуска.
        const kept = this.categories.filter(cat => !isRemovable(cat));
        toRemoveIds.forEach(id => this._noDropsStreak.delete(id));
        this.categories = kept;
        await this.saveCategories();
        this.renderCategories();
        window.utils?.showToast(tr('Удалено авто‑категорий без дропсов: {count}', { count: beforeCount - kept.length }), 'info');
      }

      // Автоскан: добавляем новые категории с дропсами, пока включён автофарм
      await this.syncAutoDropsCategoriesFromInventory(allCategories, activeCampaignsMap);

      if (!updated && displayChanged) {
        // Сменились только зрители — перерисовываем без записи на диск.
        // В файл они попадут со следующим настоящим сохранением
        this.renderCategories();
      }

      if (updated) {
        // Сохраняем обновленные данные
        await this.saveCategories();

        // Перерисовываем список
        this.renderCategories();

        console.log('Categories data updated:', this.categories.map(c => `${c.name}: ${(c.viewersCount/1000).toFixed(1)}K`));

        // Приоритет пользователю: если сейчас активна авто‑категория, а у ручной появились дропсы — переключаемся
        if (this.currentCategory && this.currentCategory.autoDrops && manualGainedDrops) {
          console.log('Manual category gained drops; prioritizing manual category');
          // Текущая авто-категория рабочая: если у ручной сейчас никто не
          // стримит, остаёмся где были, а не останавливаем фарминг
          await this.switchToNextEnabledCategory({ keepCurrent: true });
        }
      }
    } catch (error) {
      console.error('Error updating categories:', error);
    }
  }

  // Ручное обновление
  async manualUpdateCategories() {
    if (this.categories.length === 0) {
      window.utils.showToast(tr('Нет категорий для обновления'), 'warning');
      return;
    }
    
    window.utils.showToast(tr('Обновление данных...'), 'info');
    await this.updateCategoriesData();
    window.utils.showToast(tr('Данные обновлены'), 'success');
  }

  setupEventListeners() {
    // init() асинхронный — страница могла быть уничтожена, пока он выполнялся
    if (this._destroyed) return;

    // Проверяем, были ли уже установлены обработчики
    if (this.isEventListenersSetup) {
      console.log('Event listeners already setup, skipping');
      return;
    }
    this.isEventListenersSetup = true;

    // Все обработчики регистрируем через AbortController.
    // Часть целей (кнопки сайдбара, document) живёт вне страницы и переживает
    // навигацию — без снятия обработчиков каждый повторный заход на страницу
    // фарминга добавлял ещё один комплект: клик срабатывал многократно,
    // а старые экземпляры страницы не освобождались.
    if (this._listenerAbort) {
      this._listenerAbort.abort();
    }
    this._listenerAbort = new AbortController();
    const listenerSignal = this._listenerAbort.signal;
    const on = (el, type, handler) => {
      if (el) el.addEventListener(type, handler, { signal: listenerSignal });
    };

    // Сторож плеера один, в PlayerManager; сюда приходит только итог
    // «канал не оживить» — и страница решает, куда переключиться
    on(window, 'wt:player-dead', (event) => this.onPlayerDead(event.detail || {}));

    // Календарь и восстановление копии пишут категории в хранилище сами.
    // Без перечитывания первое же сохранение здесь затирало их запись.
    on(window, 'wt:categories-changed', () => this.reloadCategoriesFromStorage());

    // Используем setTimeout для гарантии, что DOM загружен
    setTimeout(() => {
      const addBtn = document.getElementById('add-category-btn');
      const addAllDropsBtn = document.getElementById('add-all-drops-btn');
      const dropsFilterBtn = document.getElementById('drops-filter-btn');
      const nextStreamBtn = document.getElementById('next-stream-btn');
      const prevCategoryBtn = document.getElementById('prev-category-btn');
      const nextCategoryBtn = document.getElementById('next-category-btn');
      // Кнопка чата убрана: она открывала окно, которое почти всегда
      // сообщало «нет активного стрима». Сам чат по-прежнему работает
      // фоном и собирает бонусные сундуки — видимым он и не был нужен.

      if (dropsFilterBtn) {
        on(dropsFilterBtn, 'click', () => {
          this.dropsFilterEnabled = !this.dropsFilterEnabled;

          // Состояние — классом и aria-pressed, а не инлайновыми цветами:
          // те не знали о светлой теме и перебивали оформление кнопки
          dropsFilterBtn.classList.toggle('is-on', this.dropsFilterEnabled);
          dropsFilterBtn.setAttribute('aria-pressed', String(this.dropsFilterEnabled));

          this.renderCategories();
        });
      } else {
        console.warn('drops-filter-btn not found');
      }

      if (addAllDropsBtn) {
        this.updateAutoDropsButtonState();
        on(addAllDropsBtn, 'click', async () => {
          await this.toggleAutoDropsCategories();
        });
      } else {
        console.warn('add-all-drops-btn not found');
      }

      if (addBtn) {
        on(addBtn, 'click', () => {
          this.showCategorySelector();
        });
      } else {
        console.warn('add-category-btn not found');
      }

      // «Начать/Остановить» в сайдбаре здесь не привязываем: их держит
      // app.js и всегда зовёт актуальный window.farmingPage. Вторая
      // привязка здесь выполняла остановку дважды и давала тост «×2»

      // Навигация: следующий стрим
      if (nextStreamBtn) {
        on(nextStreamBtn, 'click', async () => {
          // Пока идёт поиск, повторные нажатия пропускаем: каждое заново
          // спрашивало Twitch и повторяло тост «Ищем следующий стрим...».
          // Срок у флага — на случай зависшего запроса
          if (Date.now() - (this._nextStreamClickAt || 0) < 30000) return;
          this._nextStreamClickAt = Date.now();
          try {
            await this.switchToNextStream();
          } finally {
            this._nextStreamClickAt = 0;
          }
        });
      }

      // Навигация: предыдущая категория
      if (prevCategoryBtn) {
        on(prevCategoryBtn, 'click', () => {
          this.switchToPrevCategory();
        });
      }

      // Переход с ручного фарма на автоматический
      const toAutofarmBtn = document.getElementById('sidebar-to-autofarm-btn');
      if (toAutofarmBtn) {
        on(toAutofarmBtn, 'click', () => {
          this.switchToAutoFarming();
        });
      }

      // Навигация: следующая категория
      if (nextCategoryBtn) {
        on(nextCategoryBtn, 'click', () => {
          this.switchToNextCategory();
        });
      }

      // Заглушка «Фарминг не запущен» запускает фарминг. Слушаем
      // контейнер: сама заглушка пересоздаётся при каждой остановке.
      // Кнопки «Подписаться на канал» здесь больше нет — её не было и в
      // разметке, а проверка подписки слала заведомо неудачные запросы
      const streamInfoBox = document.getElementById('current-stream-info');
      const startFromPlaceholder = (e) => {
        if (!e.target.closest || !e.target.closest('.waiting-state')) return;
        if (e.type === 'keydown') {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
        }
        if (this.sessionStartTime) return;
        this.startFarming();
      };
      on(streamInfoBox, 'click', startFromPlaceholder);
      on(streamInfoBox, 'keydown', startFromPlaceholder);

      // Уведомления
      const notificationsBtn = document.getElementById('notifications-btn');
      if (notificationsBtn) {
        on(notificationsBtn, 'click', () => {
          this.toggleNotifications();
        });
      }

      // Обработчик кликов по карточкам дропов
      on(document, 'click', (e) => {
        // Страница фарминга живёт и на других вкладках, а карточки с этим
        // классом есть только в её разметке. Раньше обработчик ловил клики
        // по наградам на любой странице, и окно награды строилось дважды
        if (window.router?.currentPage && window.router.currentPage !== 'farming') return;
        const dropCard = e.target.closest('.drop-card-clickable');
        if (dropCard) {
          const dropData = dropCard.getAttribute('data-drop');
          const campaignData = dropCard.getAttribute('data-campaign');
          
          if (dropData && campaignData) {
            try {
              const drop = JSON.parse(decodeURIComponent(dropData));
              const campaign = JSON.parse(decodeURIComponent(campaignData));

              if (!drop.imageURL && drop.imageUrl) {
                drop.imageURL = drop.imageUrl;
              }
              if (!drop.required && drop.requiredMinutes) {
                drop.required = drop.requiredMinutes;
              }
              
              this.showDropDetailModal(drop, campaign);
            } catch (err) {
              console.error('Ошибка при открытии модального окна с деталями дропа:', err);
            }
          }
        }
      });

      // Карточка награды — кнопка (role="button"): с клавиатуры она
      // открывается так же, как мышью
      on(document, 'keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target?.closest?.('.drop-card-clickable');
        if (!card || card !== e.target) return;
        e.preventDefault();
        card.click();
      });
    }, 100);
  }

  calculateDropRarity(drop, campaign) {
    const requiredMinutes = drop.required || drop.requiredMinutesWatched || 0;
    const viewersCount = campaign?.game?.viewersCount || campaign?.viewersCount || 0;

    let rarity = this.rarityTiers[0];

    for (const tier of this.rarityTiers) {
      if (requiredMinutes >= tier.minMinutes && requiredMinutes <= tier.maxMinutes) {
        rarity = tier;
        break;
      }
    }

    if (viewersCount > 0 && viewersCount < rarity.minViewers) {
      const currentIndex = this.rarityTiers.indexOf(rarity);
      if (currentIndex < this.rarityTiers.length - 1) {
        rarity = this.rarityTiers[currentIndex + 1];
      }
    }

    // Выдуманное число «владельцев» убрано, как и на странице «Дропсы»:
    // окно награды его больше не показывает, а настоящих данных нет
    const difficulty = Math.min(10, Math.max(1, Math.ceil(requiredMinutes / 90)));

    return {
      ...rarity,
      requiredMinutes,
      viewersCount,
      difficulty
    };
  }

  showDropDetailModal(drop, campaign) {
    if (typeof window.showDropDetailModal === 'function') {
      window.showDropDetailModal(drop, campaign, this);
    } else {
      console.error('Drop detail modal script not loaded');
    }
  }

  /**
   * Проверяет, идёт ли ещё восстановленный эфир.
   *
   * Возобновлять сессию на давно погасшем канале незачем: в сайдбаре шёл
   * бы таймер и капал трафик впустую. Но и держать из-за этой проверки
   * всю страницу тоже нельзя, поэтому она идёт фоном.
   *
   * Один неудачный ответ ничего не решает — Twitch отвечает неровно, а
   * бросать рабочую сессию из-за сетевой заминки хуже, чем подождать.
   *
   * «Не в эфире» и «не ответил» — разные ответы. null от getStreamStats
   * означает подтверждённый офлайн, а сбой сети отклоняет вызов. Раньше
   * оба читались как офлайн: после автозапуска Windows, пока сеть ещё не
   * поднялась, ночная сессия сбрасывалась через десяток секунд. Теперь
   * при сбое ждём сеть до десяти минут и сессию не трогаем.
   *
   * Проверка идёт фоном, и пользователь за это время может сам выбрать
   * другой стрим. Поздний ответ про старый канал не должен отменять его
   * выбор — поэтому после каждого ожидания сверяемся со снимком.
   */
  async verifyResumedStream(stream) {
    if (!stream?.login || !window.electronAPI?.getStreamStats) return;

    const snapshot = this.streamSnapshot();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const NETWORK_RETRY_MS = 45 * 1000;
    const NETWORK_WAIT_LIMIT_MS = 10 * 60 * 1000;
    const startedAt = Date.now();
    let offlineAnswers = 0;

    for (;;) {
      let stats;
      let failed = false;
      try {
        stats = await window.electronAPI.getStreamStats(stream.login);
      } catch (e) {
        failed = true;
      }
      if (!this.isCurrentStream(snapshot)) return;

      if (failed) {
        if (Date.now() - startedAt > NETWORK_WAIT_LIMIT_MS) {
          console.warn('[Сессия] Twitch так и не ответил про канал — оставляю сессию как есть:', stream.login);
          return;
        }
        console.log('[Сессия] Twitch не ответил про восстановленный канал, повторю позже:', stream.login);
        await sleep(NETWORK_RETRY_MS);
        if (!this.isCurrentStream(snapshot)) return;
        continue;
      }

      if (stats) {
        if (stats.title) this.currentStream = { ...this.currentStream, title: stats.title };
        return;
      }

      // Офлайн подтверждаем вторым ответом: канал мог моргнуть
      offlineAnswers += 1;
      if (offlineAnswers >= 2) break;
      await sleep(4000);
      if (!this.isCurrentStream(snapshot)) return;
    }

    console.log('[Сессия] Восстановленный канал не в эфире:', stream.login);

    // Сохранённую сессию удаляем, только если в ней всё ещё этот канал:
    // за время проверки там могла появиться уже новая
    const saved = await Storage.get('activeSession', null).catch(() => null);
    if (!this.isCurrentStream(snapshot)) return;
    if (saved && saved.streamLogin === stream.login) {
      await Storage.delete('activeSession').catch(() => {});
      if (!this.isCurrentStream(snapshot)) return;
    }

    // Категорию менять только если пользователь не запускал её сам
    if (this.isManualCategoryActive()) {
      this.showSwitchOffer('offline');
      return;
    }
    await this.switchToNextEnabledCategory({ reason: 'offline' });
  }

  async resumeActiveSession() {
    try {
      const sessionState = await Storage.get('activeSession', null);
      if (!sessionState) return;

      // Без аккаунта сессию не продолжаем: стрим играл и тратил трафик,
      // а дропсы не копились. Сохранённую сессию не стираем — её можно
      // продолжить, когда аккаунт добавят. Сбой чтения (null) — незнание,
      // тогда восстанавливаем как раньше
      const accounts = await Promise.resolve()
        .then(() => Storage.getAccounts())
        .catch(() => null);
      if (Array.isArray(accounts) && accounts.length === 0) {
        console.log('[Сессия] Аккаунтов нет — сохранённую сессию не продолжаю');
        return;
      }

      // Подтягиваем категорию
      const category = this.categories.find(c => c.id === sessionState.categoryId) ||
        this.categories.find(c => c.name && c.name.toLowerCase() === (sessionState.categoryName || '').toLowerCase());
      if (!category) return;

      // Собираем данные о стриме
      const stream = {
        login: sessionState.streamLogin,
        displayName: sessionState.streamDisplayName || sessionState.streamLogin,
        title: sessionState.streamTitle || ''
      };

      // Сессия, которую давно не видели, — уже прошлое: приложение было
      // закрыто. Канал и категорию продолжаем, а время считаем заново,
      // иначе в статистику попадает всё время, пока приложение не работало.
      // Переход между вкладками и перезапуск после обновления — продолжение.
      let stale = false;
      if (!window.sessionState?.isActive?.()) {
        const stats = await Storage.getStatistics().catch(() => null);
        const active = (stats?.sessions || []).find(s => s.isActive);
        stale = SessionState.isStale(active);
        if (stale) {
          console.log('[Сессия] Прошлая сессия закончилась вместе с приложением — начинаю новую на том же канале');
          await Storage.finalizeCurrentSession({}).catch(() => {});
        }
      }

      // Восстанавливаем время сессии
      const now = Date.now();
      this.sessionStartTime = stale ? now : (sessionState.startTime || now);
      // Отсчёт времени категории тоже восстанавливаем: без него следующая
      // смена категории записала бы ей всё время сессии целиком
      this.categoryStartTime = stale ? now : (sessionState.categoryStartTime || this.sessionStartTime);
      this.currentCategory = category;
      this.currentStream = stream;

      // Ручной запуск переживает переход между вкладками. Отметки
      // восстанавливаем до записи сессии: saveActiveSession берёт их со
      // страницы, и устаревшая сессия раньше перезаписывалась с пустыми —
      // после второго перезапуска ручной режим терялся
      this.manualCategoryId = sessionState.manualCategoryId || null;
      this.manualPlayLockCategoryId = sessionState.manualPlayLockCategoryId || null;
      if (this.manualCategoryId) {
        console.log('[Сессия] Категория запущена вручную — переключать её не будем:', category.name);
      }
      if (stale) await this.saveActiveSession(stream, category);
      this.resetCategoryCounters(category);
      this.activeSessionResumed = true;

      // Обновляем UI и перезапускаем интервалы
      await this.updateCurrentStreamUI(stream, category);
      const sessionInfo = document.getElementById('farming-session-info');
      if (sessionInfo) {
        sessionInfo.style.display = 'block';
        sessionInfo.style.opacity = '1';
        sessionInfo.style.transform = 'translateY(0)';
      }
      this.showFarmingState();

      this.updateSessionInfo();

      // Проверку эфира делаем ПОСЛЕ восстановления и не дожидаясь её.
      //
      // Раньше она стояла до всего остального, и страница молчала о том,
      // что фармит, пока Twitch отвечал. Возвращаясь на вкладку,
      // пользователь видел приложение, которое «забыло» про категорию, —
      // а проверки дропсов в это время уже шли и делали свои выводы.
      this.verifyResumedStream(stream);

      // Очищаем старый интервал если он существует
      if (this.sessionInterval) {
        clearInterval(this.sessionInterval);
        this.sessionInterval = null;
      }
      
      this.sessionInterval = setInterval(() => {
        this.updateSessionInfo();
      }, 1000);

      // Запускаем периодическое обновление статистики (раз в минуту, см. LIVE_STATS_MS)
      if (this.statsUpdateInterval) {
        clearInterval(this.statsUpdateInterval);
      }
      this.statsUpdateInterval = setInterval(() => {
        this.updateLiveStatistics();
      }, FarmingPage.LIVE_STATS_MS);

      // Запускаем сборщик бонусов и проверку здоровья стрима
      this.resetChannelPointsTracking();
      this.startBackgroundBonusCollector(stream.login);

      // Показываем баллы
      const pointsCard = document.getElementById('channel-points-card');
      if (pointsCard) pointsCard.style.display = 'block';
    } catch (e) {
      console.error('Failed to resume active session', e);
    }
  }

  /**
   * Записывает время, проведённое в текущей категории, и начинает отсчёт
   * для следующей.
   *
   * Раньше ради этого обнулялся sessionStartTime — то есть счётчик всей
   * сессии в сайдбаре прыгал на ноль при каждой смене категории, хотя
   * сессия не прерывалась. Смена категории и продолжительность сессии —
   * разные величины, и считаются теперь порознь.
   */
  async noteCategoryWatchTime() {
    const начало = this.categoryStartTime || this.sessionStartTime;

    if (this.currentCategory?.name && начало) {
      await this.saveWatchTimeForCategory(this.currentCategory.name, Date.now() - начало);
    }
    this.categoryStartTime = Date.now();
  }

  /**
   * Обнуляет счётчики, которые копятся по текущей категории.
   *
   * Их сбрасывал только запуск через Play, а «Пред./След. категория» и
   * автопереключение уносили промахи прошлой категории в новую: после
   * двух пустых проверок в A выбранная кнопкой B выключалась на первой
   * же своей. Вызывать при каждой смене категории.
   */
  resetCategoryCounters(nextCategory) {
    this.dropsMissingChecks = 0;
    this._emptyDropsChecks = 0;
    this._leaveVotes = 0;
    this._gameMismatchCount = 0;
    // Отметка «эту категорию уже бросили» нужна, только пока идёт она же
    if (this._exhaustedCategoryId && this._exhaustedCategoryId !== nextCategory?.id) {
      this._exhaustedCategoryId = null;
    }
    // «Остаться» относилось к прежней категории
    if (this._offerDismissed && this._offerDismissed.categoryId !== (nextCategory?.id || null)) {
      this._offerDismissed = null;
    }
  }

  /** overrides — поля поверх собранных (stopFarming передаёт отметки ручного запуска). */
  async saveActiveSession(stream, category, overrides = {}) {
    if (!stream || !category) return;
    await Storage.set('activeSession', {
      startTime: this.sessionStartTime || Date.now(),
      categoryStartTime: this.categoryStartTime || this.sessionStartTime || Date.now(),
      categoryId: category.id,
      categoryName: category.name,
      // Отметка ручного запуска жила только на странице, а страница
      // пересоздаётся при каждом переходе между вкладками. Достаточно было
      // уйти и вернуться, чтобы приложение забыло, что категорию выбрали
      // руками, и снова начало переключать её само.
      manualCategoryId: this.manualCategoryId || null,
      manualPlayLockCategoryId: this.manualPlayLockCategoryId || null,
      streamLogin: stream.login,
      streamDisplayName: stream.displayName,
      streamTitle: stream.title || '',
      ...overrides
    });
  }

  async showCategorySelector() {
    // Окно уже открыто — второе поверх не нужно
    const opened = this._categorySelectorModal;
    if (opened && opened.isConnected) {
      opened.querySelector('#category-search')?.focus();
      return;
    }
    // Повторный клик, пока список грузится, открывал второе окно поверх
    // первого и повторял тост «Загрузка категорий...». Срок у флага — на
    // случай зависшего запроса, чтобы кнопка не умерла навсегда
    if (Date.now() - (this._categorySelectorLoadingAt || 0) < 30000) return;
    this._categorySelectorLoadingAt = Date.now();
    try {
      await this._showCategorySelector();
    } finally {
      this._categorySelectorLoadingAt = 0;
    }
  }

  async _showCategorySelector() {
    console.log('Opening category selector...');

    try {
      // Загружаем все категории Twitch
      window.utils.showToast(tr('Загрузка категорий...'), 'info');
      const categories = await window.electronAPI.fetchTwitchCategories();
      console.log('Categories loaded:', categories.length);
      
      if (!categories || categories.length === 0) {
        window.utils.showToast(tr('Не удалось загрузить категории'), 'error');
        return;
      }

      // Проверяем дропсы для первых 10 категорий
      console.log('Checking drops for top 10 categories...');
      const categoriesToCheck = categories.slice(0, 10);
      const dropsChecks = await Promise.all(
        categoriesToCheck.map(async (cat) => {
          const hasDrops = await window.electronAPI.checkCategoryDrops(cat.name);
          return { id: cat.id, hasDrops };
        })
      );

      // Обновляем данные о дропсах
      categories.forEach(cat => {
        const dropsInfo = dropsChecks.find(d => d.id === cat.id);
        cat.hasDrops = dropsInfo ? dropsInfo.hasDrops : false;
      });
      
      // Обычное окно приложения (.dialog): поиск сверху, список игр
      // строками. Класс auth-modal больше не нужен — это не окно входа
      const icon = (name, size) => window.Icons?.get(name, size) ?? '';
      const modal = document.createElement('div');
      modal.className = 'dialog-backdrop category-picker';
      modal.innerHTML = `
        <div class="dialog dialog-lg category-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="category-picker-title">
          <div class="dialog-head">
            <div>
              <h2 class="dialog-title" id="category-picker-title">${tr('Добавить категорию')}</h2>
            </div>
            <button class="dialog-close close-modal" type="button" title="${tr('Закрыть (Esc)')}" aria-label="${tr('Закрыть')}">
              ${icon('close', 16)}
            </button>
          </div>
          <div class="category-picker-search">
            <label class="search-field">
              ${icon('search', 16)}
              <input type="text" class="input-field" id="category-search" placeholder="${tr('Поиск по названию игры')}" autocomplete="off" aria-label="${tr('Поиск категории')}">
            </label>
          </div>
          <div class="dialog-body category-list" id="category-list">
            ${this.renderCategoryItems(categories, categories)}
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      this._categorySelectorModal = modal;

      // Закрытие одно на все пути и повторно безопасно: removeChild на уже
      // снятом окне бросал ошибку. Esc закрывает, как и остальные окна
      const keyAbort = new AbortController();
      const closeSelector = () => {
        keyAbort.abort();
        if (modal.isConnected) modal.remove();
      };
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSelector();
      }, { signal: keyAbort.signal });

      // Focus на поиск
      const searchInput = modal.querySelector('#category-search');
      setTimeout(() => searchInput.focus(), 100);

      // Обработчик поиска
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = categories.filter(cat =>
          cat.name.toLowerCase().includes(query)
        );

        const list = modal.querySelector('#category-list');
        list.innerHTML = this.renderCategoryItems(filtered, categories);

        // Re-attach click handlers
        list.querySelectorAll('.game-item-selector').forEach(item => {
          item.addEventListener('click', () => {
            const categoryId = item.dataset.categoryId;
            const category = categories.find(c => c.id === categoryId);
            if (category) {
              this.addCategory(category);
              closeSelector();
            }
          });
        });
      });

      // Обработчик закрытия. Фон — сам контейнер окна: закрываем, только
      // если нажали мимо окна, а не внутри него
      const closeBtn = modal.querySelector('.close-modal');

      closeBtn.addEventListener('click', closeSelector);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSelector();
      });

      // Строка игры — кнопка (role="button"): Enter и пробел добавляют её
      // так же, как щелчок
      modal.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const item = e.target?.closest?.('.game-item-selector');
        if (!item || item !== e.target) return;
        e.preventDefault();
        item.click();
      });

      // Обработчик клика на игру
      modal.querySelectorAll('.game-item-selector').forEach(item => {
        item.addEventListener('click', () => {
          const categoryId = item.dataset.categoryId;
          const category = categories.find(c => c.id === categoryId);
          if (category) {
            this.addCategory(category);
            closeSelector();
          }
        });
      });
      
    } catch (error) {
      console.error('Error loading categories:', error);
      window.utils.showToast(tr('Ошибка загрузки категорий'), 'error');
    }
  }
  
  renderCategoryItems(categories, allCategories) {
    if (categories.length === 0) {
      return `<div class="picker-empty">${tr('Ничего не найдено — проверьте название')}</div>`;
    }

    const icon = (name, size) => window.Icons?.get(name, size) ?? '';

    return categories.map(cat => {
      const isAdded = this.categories.some(c => c.id === cat.id);

      // Подробности одной строкой: зрители · «Дропсы» зелёным, если идёт
      // кампания (проверяются первые десять игр списка)
      const meta = [
        cat.viewersCount ? `<span>${this.esc(this.viewersLabel(cat.viewersCount))}</span>` : '',
        cat.hasDrops ? `<span class="tone-ok">${tr('Дропсы')}</span>` : ''
      ].filter(Boolean).join('');

      return `
        <div class="game-item-selector ${isAdded ? 'added' : ''}" data-category-id="${this.esc(cat.id)}" role="button" tabindex="0">
          <img src="${this.esc(this.boxArtSrc(cat.boxArtURL, '52x72', cat.id))}" alt="" onerror="this.onerror=null;this.src=window.DROP_PLACEHOLDER||'';">
          <div class="game-item-info">
            <div class="game-item-name">${this.esc(cat.name)}</div>
            <div class="game-item-viewers row-meta">${meta}</div>
          </div>
          ${isAdded
            ? `<div class="game-item-added">${tr('Уже в очереди')}</div>`
            : `<span class="game-item-add" aria-hidden="true">${icon('plus', 16)}</span>`}
        </div>
      `;
    }).join('');
  }

  /**
   * Добавляет категорию в список. Единая точка входа: ею пользуются
   * выбор категории здесь и календарь, пока страница фарминга жива.
   * Раньше календарь писал в хранилище в обход страницы, и следующее
   * сохранение здесь молча затирало добавленную игру.
   *
   * Возвращает true, если категория добавлена.
   */
  async addCategory(category) {
    if (!category || !category.name) return false;
    console.log('Adding category:', category.name);

    // Дубль ищем и по id, и по названию: календарь подставляет свой id,
    // когда Twitch не отдал настоящий
    const isDuplicate = () => this.categories.some(cat =>
      (category.id != null && cat.id === category.id) ||
      this.normalizeGameKey(cat.name) === this.normalizeGameKey(category.name));

    if (isDuplicate()) {
      window.utils.showToast(tr('{name} уже добавлена', { name: category.name }), 'warning');
      return false;
    }

    // Если вызывающий уже знает, что дропсы есть (календарь, подсказка),
    // второй раз не спрашиваем. null от проверки — Twitch не ответил.
    let hasDrops = category.hasDrops === true;
    if (!hasDrops) {
      const checked = await window.electronAPI.checkCategoryDrops(category.name);
      hasDrops = checked === true;
    }

    // Пока шла проверка, ту же игру могли добавить вторым нажатием
    if (isDuplicate()) return false;

    const newCategory = {
      id: category.id != null ? category.id : `${Date.now()}-${Math.random()}`,
      name: category.name,
      boxArtURL: this.normalizeBoxArtURL(category.boxArtURL, '52x72'),
      viewersCount: category.viewersCount || 0,
      tags: category.tags || [],
      hasDrops: hasDrops,
      enabled: true, // По умолчанию включена
      priority: this.categories.length + 1,
      dropsCompleted: false
    };

    this.categories.push(newCategory);
    // Игру добавили руками — запрет на автодобавление больше не нужен
    await this.setCategoryDeleted(category.name, false);
    await this.saveCategories();
    this.renderCategories();
    window.utils.showToast(tr('{name} добавлена', { name: category.name }), 'success');
    return true;
  }

  updateAutoDropsButtonState() {
    const btn = document.getElementById('add-all-drops-btn');
    if (!btn) return;
    const isAutoMode = this.autoDropsModeEnabled === true;
    // Подпись больше не меняется («Отключить автофарм» по подписи не
    // говорил, включён ли режим): состояние показывает переключатель
    // внутри кнопки, он рисуется по aria-pressed. Цвета — из оформления,
    // а не инлайновые: те не знали о светлой теме
    btn.classList.toggle('is-on', isAutoMode);
    btn.setAttribute('aria-pressed', String(isAutoMode));
  }

  async toggleAutoDropsCategories() {
    if (this.autoDropsModeEnabled) {
      // Отключение убирает авто-категории — у пользователя их бывает под
      // сотню, и случайный клик стирал почти весь список вместе с
      // закреплениями. Закреплённые оставляем (закрепление и значит
      // «оставить»), об остальных спрашиваем.
      const removable = this.categories.filter(cat => cat.autoDrops === true && !cat.pinned);
      if (removable.length > 0 && typeof window.utils?.showConfirmation === 'function') {
        const n = removable.length;
        const word = window.utils.plural
          ? window.utils.plural(n, 'авто-категория', 'авто-категории', 'авто-категорий')
          : tr('авто-категорий');
        const ok = await window.utils.showConfirmation(
          tr('Отключить автофарм?'),
          tr('Будет убрано из списка: {n} {word}. Закреплённые останутся.', { n, word }),
          // Действие убирает категории из очереди — кнопка красная и с глаголом
          { confirmText: tr('Отключить'), confirmClass: 'btn-danger' }
        );
        if (!ok || this._destroyed) return;
      }

      this.autoDropsModeEnabled = false;
      await Storage.set('autoDropsModeEnabled', false);

      // Пока висел вопрос, синхронизация могла добавить новые — берём
      // список заново
      const removedIds = new Set(this.categories
        .filter(cat => cat.autoDrops === true && !cat.pinned)
        .map(cat => cat.id));
      // Закреплённые авто-категории становятся обычными: автофарма больше
      // нет, а удалять «отработанную» авто-категорию закреплённой нельзя
      this.categories.forEach(cat => {
        if (cat.autoDrops === true && cat.pinned) cat.autoDrops = false;
      });
      this.categories = this.categories.filter(cat => !removedIds.has(cat.id));
      await this.saveCategories();
      this.renderCategories();
      this.updateAutoDropsButtonState();
      window.utils.showToast(tr('Автофарм дропсов отключен'), 'info');

      // Раньше фарм удалённой категории продолжался: плеер играл игру,
      // которой в списке уже не было. Уходим в оставшиеся категории, а
      // если их нет — останавливаемся без «всё собрано».
      if (this.sessionStartTime && this.currentCategory && removedIds.has(this.currentCategory.id)) {
        this.manualCategoryId = null;
        this.manualPlayLockCategoryId = null;
        await this.switchToNextEnabledCategory({ reason: 'disabled' });
      }
    } else {
      this.autoDropsModeEnabled = true;
      await Storage.set('autoDropsModeEnabled', true);
      this.updateAutoDropsButtonState();
      await this.addAllDropsCategories();
    }
  }

  async addAllDropsCategories() {
    try {
      window.utils.showToast(tr('Загружаем категории с дропсами...'), 'info');
      const allCategories = await window.electronAPI.fetchTwitchCategories();
      if (!allCategories || allCategories.length === 0) {
        window.utils.showToast(tr('Не удалось загрузить категории'), 'error');
        return;
      }

      const activeCampaignsMap = await this.loadActiveCampaignsMap();
      const categoriesByName = new Map(
        allCategories.map(cat => [this.normalizeGameKey(cat.name), cat])
      );
      // Удалённые пользователем крестиком игры обратно не добавляем
      const deleted = await this.getDeletedCategoryKeys();

      let addedCount = 0;

      if (activeCampaignsMap.size > 0) {
        for (const [gameKey, campaignInfo] of activeCampaignsMap.entries()) {
          const existing = this.categories.find(cat => this.normalizeGameKey(cat.name) === gameKey);
          if (existing) {
            if (existing.autoDrops) {
              // Выключенную пользователем не включаем
              if (this.mayEnableCategory(existing)) {
                existing.enabled = true;
                existing.disabledByApp = false;
              }
              existing.hasDrops = true;
              existing.dropsCompleted = false;
              existing.dropsProgressPercent = campaignInfo.progress;
              existing.dropsEndsAt = campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt;
            }
            continue;
          }
          if (deleted.has(gameKey)) continue;

          const freshCategory = categoriesByName.get(gameKey);
          const campaignGameName = campaignInfo.campaign?.game?.name || campaignInfo.campaign?.game?.displayName || campaignInfo.campaign?.game;
          const campaignGameId = campaignInfo.campaign?.gameId || campaignInfo.campaign?.game?.id;

          const newCategory = {
            id: freshCategory?.id || campaignGameId || `${Date.now()}-${Math.random()}`,
            name: freshCategory?.name || campaignGameName || gameKey,
            boxArtURL: this.normalizeBoxArtURL(freshCategory?.boxArtURL || campaignInfo.campaign?.imageUrl || campaignInfo.campaign?.game?.boxArtURL, '52x72'),
            viewersCount: freshCategory?.viewersCount || 0,
            tags: freshCategory?.tags || [],
            hasDrops: true,
            autoDrops: true,
            enabled: true,
            priority: this.categories.length + 1,
            dropsProgressPercent: campaignInfo.progress,
            dropsEndsAt: campaignInfo.campaign?.endAt || campaignInfo.campaign?.endsAt,
            dropsCompleted: false
          };

          this.categories.push(newCategory);
          addedCount++;
        }
      } else {
        // Списка кампаний ещё нет (dashboard появляется после первого
        // стрима) — проверяем категории по одной. Раньше все сто проверок
        // уходили разом через Promise.all: Twitch отвечал 429, а пауза после
        // него задерживала и запросы самого фарминга. Теперь не больше
        // четырёх одновременно, порядок списка сохраняется.
        const candidates = allCategories.filter(cat =>
          !this.categories.some(c => c.id === cat.id) &&
          !deleted.has(this.normalizeGameKey(cat.name)));
        const found = new Array(candidates.length).fill(null);
        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < candidates.length) {
            const index = nextIndex++;
            try {
              if (await window.electronAPI.checkCategoryDrops(candidates[index].name)) {
                found[index] = candidates[index];
              }
            } catch (error) {
              // Сбой проверки одной игры — не повод бросать остальные
            }
          }
        };
        const MAX_PARALLEL_CHECKS = 4;
        await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_CHECKS, candidates.length) }, worker));
        const validCategories = found.filter(cat => cat !== null);

        for (const category of validCategories) {
          const newCategory = {
            id: category.id,
            name: category.name,
            boxArtURL: this.normalizeBoxArtURL(category.boxArtURL, '52x72'),
            viewersCount: category.viewersCount || 0,
            tags: category.tags || [],
            hasDrops: true,
            autoDrops: true,
            enabled: true,
            priority: this.categories.length + 1
          };
          this.categories.push(newCategory);
          addedCount++;
        }
      }

      if (addedCount === 0) {
        window.utils.showToast(tr('Не найдено новых категорий с незавершенными дропсами'), 'warning');
        return;
      }

      await this.saveCategories();
      this.renderCategories();
      this.updateAutoDropsButtonState();
      // «Добавлено 21 категорий» — так выходило у самодельного склонения
      window.utils.showToast(tr('Добавлено категорий с незавершёнными дропсами: {count}', { count: addedCount }), 'success');
      // Запускаем, только если фарминг не идёт. Раньше запуск шёл всегда:
      // включение «Фарм всех дропсов» посреди сессии начинало её заново —
      // таймер прыгал в ноль, баллы и дропсы за прошедшие часы пропадали
      setTimeout(() => {
        if (!this._destroyed && !this.sessionStartTime) this.startFarming();
      }, 1000);
    } catch (error) {
      console.error('Error adding all drops categories:', error);
      window.utils.showToast(tr('Ошибка при добавлении категорий'), 'error');
    }
  }

  /**
   * Переносит отметку «Сейчас» в списке на категорию, которая фармится.
   * Перерисовка дешёвая: заменятся только две карточки — прежняя и новая.
   */
  syncCurrentCategoryMark() {
    const id = (this.currentStream && this.currentCategory) ? String(this.currentCategory.id) : null;
    if (id === (this._renderedCurrentId ?? null)) return;
    this.renderCategories();
  }

  renderCategories() {
    const container = document.getElementById('categories-list');

    if (!container) return;

    // Пока карточку тащат, список не трогаем: перерисовка раз в полминуты
    // выбрасывала перетаскиваемый узел, и dragover вставлял его обратно
    // дублем. Отложенную перерисовку делает dragend.
    const dragged = this._draggedItem;
    if (dragged && dragged.isConnected && dragged.classList.contains('dragging')) {
      this._categoriesRenderPending = true;
      return;
    }

    // Счётчик в заголовке, пояснение на заглушке простоя и чек-лист
    // первого запуска зависят от очереди — обновляем их здесь же
    this.updateQueueSummary();

    if (this.categories.length === 0) {
      const empty = {
        icon: 'list',
        title: tr('Очередь пуста'),
        text: tr('Добавьте игру или включите «Автофарм всех дропсов» — приложение само соберёт игры с кампаниями.')
      };
      container.innerHTML = typeof window.DOMHelpers?.emptyState === 'function'
        ? window.DOMHelpers.emptyState(empty).replace('class="empty-state"', 'class="empty-state no-categories"')
        : `<div class="empty-state no-categories"><h3>${empty.title}</h3><p>${empty.text}</p></div>`;
      this._categoryCardHtml = null;
      this.updateAutoDropsButtonState();
      return;
    }

    // Сортировка категорий: приоритезация по дропсам и статусу
    let categoriesToRender = [...this.categories];
    if (this.dropsFilterEnabled) {
      categoriesToRender.sort((a, b) => {
        // Закреплённые наверху и здесь. Без этого «Сначала с дропсами»
        // опускала закреплённую категорию под разделитель «Остальные
        // категории»: он ставится по числу закреплённых, а не по ним самим
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        const aEnabled = a.enabled !== false;
        const bEnabled = b.enabled !== false;
        const aCompleted = !!(a.dropsCompleted && a.hasDrops);
        const bCompleted = !!(b.dropsCompleted && b.hasDrops);
        
        // Сначала включенные, потом выключенные
        if (aEnabled && !bEnabled) return -1;
        if (!aEnabled && bEnabled) return 1;

        // Завершенные опускаем вниз
        if (aCompleted && !bCompleted) return 1;
        if (!aCompleted && bCompleted) return -1;
        
        // Среди включенных: сначала с дропсами неполными, потом полными, потом без дропсов
        if (aEnabled && bEnabled) {
          const aHasDrops = a.hasDrops && !a.dropsCompleted;
          const bHasDrops = b.hasDrops && !b.dropsCompleted;
          
          if (aHasDrops && !bHasDrops) return -1;
          if (!aHasDrops && bHasDrops) return 1;
          
          // Если оба с неполными дропсами или оба без - сортируем по процентам прогресса (меньший процент = выше приоритет)
          if (aHasDrops && bHasDrops) {
            const aProgress = a.dropsProgressPercent || 0;
            const bProgress = b.dropsProgressPercent || 0;
            return aProgress - bProgress;
          }
        }
        
        return 0;
      });
    } else {
      // Без фильтра: сначала включенные, потом выключенные
      categoriesToRender.sort((a, b) => {
        const aEnabled = a.enabled !== false;
        const bEnabled = b.enabled !== false;
        // Закреплённые всегда наверху, независимо от остального
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        const aCompleted = !!(a.dropsCompleted && a.hasDrops);
        const bCompleted = !!(b.dropsCompleted && b.hasDrops);
        
        if (aEnabled && !bEnabled) return -1;
        if (!aEnabled && bEnabled) return 1;

        // Завершенные внизу
        if (aCompleted && !bCompleted) return 1;
        if (!aCompleted && bCompleted) return -1;
        
        return 0;
      });
    }

    // Граница между закреплёнными и остальными: рисуем разделитель перед
    // первой незакреплённой категорией, но только если закреплённые есть
    const pinnedCount = categoriesToRender.filter(cat => cat.pinned).length;

    // Категория, которая фармится сейчас. Раньше по списку это было не
    // понять: карточка ничем не отличалась от остальных
    const currentId = (this.currentStream && this.currentCategory) ? String(this.currentCategory.id) : null;
    this._renderedCurrentId = currentId;

    const icon = (name, size) => window.Icons?.get(name, size) ?? '';
    const DAY_MS = 24 * 60 * 60 * 1000;

    const html = categoriesToRender.map((cat, index) => {
      // Подписи групп: «Закреплённые» над закреплёнными и прежний ключ
      // «Остальные категории» над остальными
      const pinnedHead = (pinnedCount > 0 && index === 0)
        ? `<div class="pinned-divider pinned-head"><span>${tr('Закреплённые')}</span></div>`
        : '';
      const divider = (pinnedCount > 0 && index === pinnedCount)
        ? `<div class="pinned-divider"><span>${tr('Остальные категории')}</span></div>`
        : '';
      const tagsHtml = cat.tags && cat.tags.length > 0
        ? `<span class="category-tag">${this.esc(cat.tags[0])}</span>`
        : '';
      // «Авто» — тихий бейдж с рамкой, без заливки акцентом
      const autoBadge = cat.autoDrops ? `<span class="category-tag category-auto-tag" title="${tr('Добавлена автофармом')}">${tr('Авто')}</span>` : '';
      const isCurrentCard = currentId !== null && String(cat.id) === currentId;
      const currentBadge = isCurrentCard ? `<span class="category-current-badge">${tr('Сейчас')}</span>` : '';

      // Безнадёжная кампания — это не «всё собрано», а «уже не успеть»:
      // награды есть, но времени до конца кампании на них не хватит
      const catValue = this.getCategoryValue(cat);
      const tooLate = catValue && !catValue.feasible && catValue.reason === 'tooLate';
      const skipHint = tooLate
        ? window.CampaignValue.describe(catValue)
        : (cat.skipReason || '');

      // Срок кампании — янтарным, если осталось меньше суток
      const endsAtMs = cat.dropsEndsAt ? new Date(cat.dropsEndsAt).getTime() : NaN;
      const endingSoon = Number.isFinite(endsAtMs) && endsAtMs - Date.now() < DAY_MS;

      // Статус дропсов — словами и цветом текста, без плашек: зелёный —
      // собрано, янтарный — не успеть, обычный текст — кампания идёт.
      // Оставшееся время — в своём span: оно меняется каждые полминуты,
      // и applyCategoriesMarkup обновляет его текстом, не пересоздавая
      // карточку.
      const dropsStatusHtml = cat.hasDrops ? (
        tooLate
          ? `<span class="category-drops-status too-late" title="${this.esc(skipHint)}">${tr('Не успеть')}</span>`
          : cat.dropsCompleted
            ? `<span class="category-drops-status completed"${skipHint ? ` title="${this.esc(skipHint)}"` : ''}>${tr('Дропсы получены')}</span>`
            : `<span class="category-drops-status active">${cat.dropsProgressPercent !== undefined ? tr('Дропсы {percent}%', { percent: this.esc(cat.dropsProgressPercent) }) : tr('Дропсы идут')}<span class="category-time-left${endingSoon ? ' is-soon' : ''}">${cat.dropsEndsAt ? this.formatTimeRemaining(cat.dropsEndsAt) : ''}</span></span>`
      ) : '';

      const isDisabled = cat.enabled === false;
      const isCompleted = cat.dropsCompleted && cat.hasDrops;
      const name = this.esc(cat.name);

      return `
      ${pinnedHead}${divider}
      <div class="category-item ${isDisabled ? 'disabled' : ''} ${isCompleted ? 'drops-completed' : ''} ${cat.pinned ? 'pinned' : ''} ${isCurrentCard ? 'current' : ''}" draggable="true" data-category-id="${this.esc(cat.id)}">
        <div class="category-priority" aria-hidden="true">${index + 1}</div>
        <div class="category-drag-handle" title="${tr('Перетащите, чтобы изменить порядок')}" aria-hidden="true">${icon('grip', 16)}</div>
        <div class="category-image" title="${tr('Стримы категории')}">
          <img src="${this.esc(this.boxArtSrc(cat.boxArtURL, '52x72', cat.id))}" alt="" onerror="this.onerror=null;this.src=window.DROP_PLACEHOLDER||'';">
        </div>
        <div class="category-info">
          <div class="category-name" title="${name}">${name}</div>
          <div class="category-status">
            ${currentBadge}
            ${dropsStatusHtml}
            <span class="category-viewers">${this.viewersLabel(cat.viewersCount)}</span>
            ${autoBadge}
            ${tagsHtml}
          </div>
        </div>
        <button class="category-play-btn" data-category-id="${this.esc(cat.id)}" title="${tr('Смотреть эту категорию')}" aria-label="${tr('Смотреть {name}', { name })}">
          ${icon('play', 16)}
        </button>
        <button class="category-pin-btn ${cat.pinned ? 'active' : ''}" data-category-id="${this.esc(cat.id)}"
                title="${cat.pinned ? tr('Открепить') : tr('Закрепить наверху очереди')}" aria-label="${cat.pinned ? tr('Открепить {name}', { name }) : tr('Закрепить {name}', { name })}" aria-pressed="${cat.pinned ? 'true' : 'false'}">
          ${icon('pin', 16)}
        </button>
        <label class="category-toggle-switch ${!isDisabled ? 'checked' : ''}" data-category-id="${this.esc(cat.id)}" title="${isDisabled ? tr('Выключена — приложение её пропускает') : tr('Включена в очередь')}">
          <input type="checkbox" ${!isDisabled ? 'checked' : ''} data-category-id="${this.esc(cat.id)}" aria-label="${tr('Фармить {name}', { name })}">
          <span class="toggle-track"></span>
          <span class="toggle-thumb"></span>
        </label>
        <button class="category-remove" data-category-id="${this.esc(cat.id)}" title="${tr('Убрать из очереди')}" aria-label="${tr('Убрать {name}', { name })}">
          ${icon('close', 16)}
        </button>
      </div>
      `;
    }).join('');

    this.applyCategoriesMarkup(container, html);

    this.setupPinControls();
    this.setupDragAndDrop();
    this.setupRemoveButtons();
    this.setupToggleButtons();
    this.setupPlayButtons();
    this.setupCategoryImageClick();
    this.updateAutoDropsButtonState();
  }

  /**
   * Сводка очереди в разметке: счётчик в заголовке «Очередь категорий»,
   * пояснение на заглушке простоя и чек-лист первого запуска. Только
   * текст — очередь и фарминг отсюда не меняются.
   */
  updateQueueSummary() {
    const total = this.categories.length;
    const enabled = this.categories.filter(cat => cat.enabled !== false).length;

    const count = document.getElementById('farm-queue-count');
    if (count) {
      count.textContent = total > 0 ? String(total) : '';
      count.title = total > 0 ? tr('Включено {enabled} из {total}', { enabled, total }) : '';
    }

    this.updateWaitingSub();
    this.renderOnboarding();
  }

  /**
   * Пояснение под «Фарминг не запущен»: что будет, если нажать. Раньше
   * заглушка молчала, и было непонятно, с чего фарминг начнёт.
   */
  updateWaitingSub() {
    const sub = document.getElementById('current-stream-info')?.querySelector?.('.waiting-sub');
    if (!sub) return;

    const total = this.categories.length;
    const enabled = this.categories.filter(cat => cat.enabled !== false);
    const withDrops = enabled.filter(cat => cat.hasDrops && !cat.dropsCompleted).length;

    let text;
    if (total === 0) {
      text = tr('Очередь пуста — добавьте категорию или включите автофарм всех дропсов');
    } else if (enabled.length === 0) {
      text = tr('Все категории очереди выключены — включите хотя бы одну');
    } else {
      // Фраза целиком, а не склейка кусков: в английском другой порядок слов
      const count = enabled.length;
      const word = this.plural(count, 'категория', 'категории', 'категорий');
      if (withDrops === 1) text = tr('В очереди {count} {word}, у одной идёт кампания', { count, word });
      else if (withDrops > 1) text = tr('В очереди {count} {word}, у {withDrops} идут кампании', { count, word, withDrops });
      else text = tr('В очереди {count} {word}', { count, word });
      // Полный список кампаний Twitch отдаёт только после первого стрима за
      // запуск приложения. На новом компьютере без пояснения казалось, что
      // автофарм сломан
      if (this._campaignsComplete === false) {
        text = tr('{text}. Twitch пока показал не все кампании — полный список придёт через несколько секунд после запуска, можно начинать', { text });
      }
    }
    if (sub.textContent !== text) sub.textContent = text;
  }

  /**
   * Чек-лист первого запуска: войти, выбрать игры, начать. Показывается,
   * пока шаги не выполнены и его не скрыли. Аккаунты и сессии читаются из
   * хранилища не чаще раза в 30 секунд — перерисовка списка идёт часто.
   */
  renderOnboarding() {
    const slot = document.getElementById('onboarding-slot');
    if (!slot || this._destroyed) return;

    let hidden = false;
    try {
      hidden = localStorage.getItem('wt.onboarding.hidden') === '1';
    } catch (e) {
      // Хранилище недоступно — показываем, скрыть можно и на этот запуск
      hidden = !!this._onboardingHidden;
    }
    // Всё уже сделано — больше не спрашиваем хранилище на каждой перерисовке
    if (hidden || this._onboardingHidden || this._onboardingComplete) {
      if (slot.innerHTML) slot.innerHTML = '';
      return;
    }

    const facts = this._onboardingFacts;
    if ((!facts || Date.now() - facts.at > 30000) && !this._onboardingLoading) {
      this._onboardingLoading = true;
      Promise.all([
        Promise.resolve().then(() => Storage.getAccounts()).catch(() => null),
        Promise.resolve().then(() => Storage.getStatistics()).catch(() => null)
      ]).then(([accounts, stats]) => {
        this._onboardingFacts = {
          at: Date.now(),
          // Сбой чтения — не повод звать новичка «войти»
          hasAccount: accounts === null || (Array.isArray(accounts) && accounts.length > 0),
          hasSession: stats === null || (Array.isArray(stats?.sessions) && stats.sessions.length > 0)
        };
      }).finally(() => {
        this._onboardingLoading = false;
        this.renderOnboarding();
      });
    }
    if (!facts) return;

    const steps = [
      {
        done: facts.hasAccount,
        title: tr('Войдите в Twitch'),
        sub: tr('Без входа Twitch не засчитывает минуты просмотра'),
        actions: `<button type="button" class="btn btn-secondary btn-sm" data-onboarding="login">${tr('Войти')}</button>`
      },
      {
        done: this.categories.length > 0,
        title: tr('Выберите игры'),
        sub: tr('Добавьте категорию вручную или включите автофарм всех игр с кампаниями'),
        actions: `<button type="button" class="btn btn-secondary btn-sm" data-onboarding="add">${tr('Добавить')}</button>`
          + `<button type="button" class="btn btn-secondary btn-sm" data-onboarding="auto">${tr('Автофарм')}</button>`
      },
      {
        done: facts.hasSession || !!this.sessionStartTime,
        title: tr('Начните фарминг'),
        sub: tr('Дальше приложение само переключает стримы и категории'),
        // Вторичная: главная кнопка запуска уже есть на заглушке ниже
        actions: `<button type="button" class="btn btn-secondary btn-sm" data-onboarding="start">${tr('Начать')}</button>`
      }
    ];

    if (steps.every(step => step.done)) {
      this._onboardingComplete = true;
      if (slot.innerHTML) slot.innerHTML = '';
      return;
    }

    // Та же разметка — не трогаем: иначе сбрасывался бы фокус на кнопке
    const key = steps.map(step => step.done ? 1 : 0).join('');
    if (slot.dataset.state === key && slot.firstElementChild) return;
    slot.dataset.state = key;

    const check = window.Icons?.get('check', 14) ?? '✓';
    const close = window.Icons?.get('close', 16) ?? '✕';
    slot.innerHTML = `
      <section class="card farm-onboarding" aria-label="${tr('Начало работы')}">
        <div class="card-header">
          <div class="card-title">${tr('Начало работы')}</div>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-onboarding="hide" title="${tr('Скрыть подсказку')}" aria-label="${tr('Скрыть подсказку')}">${close}</button>
        </div>
        <ol class="onboarding-steps">
          ${steps.map((step, index) => `
            <li class="onboarding-step${step.done ? ' is-done' : ''}">
              <span class="onboarding-mark" aria-hidden="true">${step.done ? check : index + 1}</span>
              <div class="onboarding-text">
                <div class="onboarding-title">${step.title}${step.done ? `<span class="visually-hidden"> ${tr('— готово')}</span>` : ''}</div>
                <div class="onboarding-sub">${step.sub}</div>
              </div>
              ${step.done ? '' : `<div class="onboarding-actions">${step.actions}</div>`}
            </li>
          `).join('')}
        </ol>
      </section>
    `;

    if (slot.dataset.bound) return;
    slot.dataset.bound = '1';
    slot.addEventListener('click', (event) => {
      const action = event.target?.closest?.('[data-onboarding]')?.dataset.onboarding;
      if (!action) return;
      const page = window.farmingPage || this;
      if (action === 'login') window.router?.navigate('accounts');
      if (action === 'add') document.getElementById('add-category-btn')?.click();
      if (action === 'auto' && !page.autoDropsModeEnabled) document.getElementById('add-all-drops-btn')?.click();
      if (action === 'start') page.startFarming?.();
      if (action === 'hide') {
        page._onboardingHidden = true;
        try { localStorage.setItem('wt.onboarding.hidden', '1'); } catch (e) { /* только на этот запуск */ }
        slot.innerHTML = '';
        delete slot.dataset.state;
      }
    });
  }

  /**
   * Обновляет список категорий, не пересобирая то, что не изменилось.
   *
   * Список из сотни с лишним карточек раньше собирался через innerHTML
   * каждые полминуты — число зрителей меняется всегда. Вместе с разметкой
   * пропадали состояние наведения и загруженные обложки, а браузер
   * перекладывал сотню узлов ради одной цифры. Теперь карточка заменяется
   * только когда её разметка действительно другая; остальные узлы
   * переезжают на новое место как есть, вместе со своими обработчиками.
   * Поэтому все setup*-методы ниже вешают обработчик один раз на узел.
   *
   * Число зрителей и оставшееся время меняются каждые полминуты, поэтому
   * в сравнение не входят: у живой карточки им просто меняется текст.
   * Раньше из-за них пересоздавалась каждая карточка — пропадало
   * наведение и срывалось перетаскивание.
   *
   * Номер #N тоже обновляется на месте: перетаскивание меняет его прямо в
   * живой карточке, и сравнение со старой разметкой иначе оставило бы на
   * экране номер, которого в списке уже нет.
   */
  applyCategoriesMarkup(container, html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const keyOf = (el) => (el.dataset && el.dataset.categoryId)
      ? 'c:' + el.dataset.categoryId
      : 'x:' + (el.className || el.tagName);

    // Части карточки, которые обновляются на месте
    const VOLATILE = ['.category-viewers', '.category-time-left', '.category-priority'];
    const stableMarkup = (el) => {
      if (!el.querySelector || !VOLATILE.some(sel => el.querySelector(sel))) return el.outerHTML;
      const copy = el.cloneNode(true);
      VOLATILE.forEach(sel => copy.querySelectorAll(sel).forEach(part => { part.innerHTML = ''; }));
      return copy.outerHTML;
    };
    const syncVolatile = (old, fresh) => {
      VOLATILE.forEach(sel => {
        const target = old.querySelector(sel);
        const source = fresh.querySelector(sel);
        // Разметку сюда кладёт только сама страница (числа и слова), не Twitch
        if (target && source && target.innerHTML !== source.innerHTML) {
          target.innerHTML = source.innerHTML;
        }
      });
    };

    const existing = new Map();
    for (const el of container.children) {
      const key = keyOf(el);
      if (!existing.has(key)) existing.set(key, el);
    }

    const previousHtml = this._categoryCardHtml || new Map();
    const nextHtml = new Map();
    const nodes = [];
    const reused = new Set();
    let replaced = 0;

    for (const fresh of Array.from(template.content.children)) {
      const key = keyOf(fresh);
      const markup = stableMarkup(fresh);
      nextHtml.set(key, markup);

      const old = existing.get(key);
      if (old && !reused.has(old) && previousHtml.get(key) === markup) {
        syncVolatile(old, fresh);
        reused.add(old);
        nodes.push(old);
      } else {
        replaced++;
        nodes.push(fresh);
      }
    }

    this._categoryCardHtml = nextHtml;

    // Порядок не изменился — меняем только изменившиеся карточки. Полная
    // пересборка через replaceChildren снимала наведение со всех карточек
    const current = Array.from(container.children);
    const sameOrder = current.length === nodes.length &&
      current.every((el, i) => keyOf(el) === keyOf(nodes[i]));
    if (sameOrder) {
      current.forEach((el, i) => {
        if (el !== nodes[i]) el.replaceWith(nodes[i]);
      });
    } else {
      container.replaceChildren(...nodes);
    }

    if (replaced > 0 && reused.size > 0) {
      console.log('[Категории] Обновлено карточек:', replaced, 'из', nodes.length);
    }
  }

  /**
   * Закрепление категорий.
   *
   * Значок закрепления появляется после удержания карточки около секунды —
   * так он не мешает обычной работе со списком и не конфликтует с
   * перетаскиванием. У уже закреплённых категорий значок виден всегда,
   * иначе открепить их было бы неочевидно.
   */
  /**
   * Кнопка закрепления показывается при наведении на карточку (это делает
   * CSS) и постоянно — у уже закреплённых категорий, иначе открепить их
   * было бы неочевидно. Здесь остаётся только сам обработчик нажатия.
   */
  setupPinControls() {
    document.querySelectorAll('.category-pin-btn').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await this.togglePinned(btn.dataset.categoryId);
      });
    });
  }

  async togglePinned(categoryId) {
    const category = this.categories.find(cat => cat.id === categoryId);
    if (!category) return;

    category.pinned = !category.pinned;

    // Закреплённые держим в начале массива: порядок массива задаёт
    // очередь фарминга, и после перезапуска он должен сохраниться
    this.categories.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });

    await this.saveCategories();
    this.renderCategories();

    window.utils.showToast(
      category.pinned
        ? tr('{name} закреплена', { name: category.name })
        : tr('{name} откреплена', { name: category.name }),
      'success'
    );
  }

  setupPlayButtons() {
    const playButtons = document.querySelectorAll('.category-play-btn');
    playButtons.forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const categoryId = e.currentTarget.dataset.categoryId;
        const category = this.categories.find(c => c.id === categoryId);
        
        if (category) {
          console.log('Manual play category:', category.name);
          window.utils.showToast(tr('Запуск категории {name}...', { name: category.name }), 'info');

          // Текущую сессию НЕ останавливаем. Раньше здесь стоял stopFarming:
          // смена категории начинала новую сессию (таймер в ноль, баллы и
          // дропсы за прошедшие часы пропадали), а Play на категории, где
          // никто не стримит, просто убивал ночной фарм. Теперь стрим
          // меняется только когда для новой категории нашёлся канал, а
          // отметку ручного запуска ставит сам startFarmingForCategory —
          // в тот же момент.
          await this.startFarmingForCategory(category, { manual: true });
          this.updateAutoFarmButton();
        }
      });
    });
  }

  setupCategoryImageClick() {
    const categoryImages = document.querySelectorAll('.category-image');
    categoryImages.forEach(img => {
      if (img.dataset.bound) return;
      img.dataset.bound = '1';
      img.style.cursor = 'pointer';
      img.addEventListener('click', async (e) => {
        e.stopPropagation();
        const categoryItem = e.currentTarget.closest('.category-item');
        const categoryId = categoryItem?.dataset.categoryId;
        const category = this.categories.find(c => c.id === categoryId);
        
        if (category) {
          await this.showCategoryDetails(category);
        }
      });
    });
  }

  async showCategoryDetails(category) {
    // Разметка окна вынесена в features/farming/category-details-modal.js:
    // 330 строк шаблона мешали читать логику фарминга
    return window.showCategoryDetailsModal(this, category);
  }

  /**
   * «Запустить» у конкретного стримера в окне категории.
   *
   * Раньше выбранный логин попадал только в текст тоста, а запускался
   * канал, который приложение выбирало само, — обычно другой. Теперь
   * запускается именно выбранный. Текущий стрим меняется лишь после
   * того, как убедились, что выбранный канал в эфире и в этой игре:
   * иначе вместо одного стрима пользователь оставался без двух. Сессия
   * при этом не прерывается.
   */
  async startStreamFromModal(streamLogin, categoryId, info = {}) {
    const modal = document.querySelector('.category-detail-modal');
    if (modal) {
      modal.style.opacity = '0';
      setTimeout(() => modal.remove(), 200);
    }

    const category = this.categories.find(c => c.id === categoryId);
    if (!category) return;

    const displayName = info.displayName || streamLogin;
    window.utils.showToast(tr('Запускаю {name}…', { name: displayName }), 'info');

    const stream = await this.resolveChosenStream(category, { ...info, login: streamLogin });
    if (!stream || this._destroyed) return;

    // Как у кнопки Play: идущая сессия продолжается, меняется только
    // стрим, а выбор пользователя приложение само не меняет
    await this.startFarmingForCategory(category, { stream, manual: true });
    this.updateAutoFarmButton();
  }

  /**
   * Проверяет канал, выбранный пользователем: в эфире ли он и в той ли игре.
   *
   * Возвращает объект стрима или null, если запускать нечего (причина уже
   * показана). Если Twitch не ответил, доверяем данным окна категории —
   * канал был в эфире секунду назад.
   */
  async resolveChosenStream(category, info = {}) {
    const login = window.StreamPicker.normalizeLogin(info.login).trim();
    if (!login) return null;
    const name = info.displayName || login;

    let stats;
    try {
      stats = await window.electronAPI.getStreamStats(login);
    } catch (error) {
      stats = undefined;
    }

    if (stats === null) {
      window.utils?.showToast(tr('{name} сейчас не в эфире', { name }), 'warning');
      return null;
    }
    if (stats && stats.gameName && !this.isSameGame(stats.gameName, category.name, stats.gameId, category.id)) {
      window.utils?.showToast(tr('{name} сейчас стримит другую игру: {game}', { name, game: stats.gameName }), 'warning');
      return null;
    }

    // Часть кампаний засчитывается только на своих каналах. Выбор
    // пользователя не отменяем, но предупреждаем, что дропсов тут не будет.
    // По неполному списку кампаний (soft) не предупреждаем: у игры могут
    // быть кампании, которых Twitch ещё не показал
    const allowed = await this.allowedChannelsFor(category.name);
    if (allowed.length > 0 && !allowed.soft && !allowed.includes(login)) {
      window.utils?.showToast(tr('Этот канал не засчитывает дропсы кампании'), 'warning');
    }

    return {
      login,
      displayName: info.displayName || login,
      title: stats?.title || info.title || '',
      viewersCount: stats?.viewers || info.viewersCount || 0,
      profileImageUrl: info.profileImageUrl || null
    };
  }

  /**
   * Подписчики — тем же русским форматом, что и зрители: «3 473»,
   * «44 тыс.», «1,2 млн». Раньше рядом с «44 тыс. зрителей» стояло
   * «1.2M подписчиков».
   */
  formatFollowers(count) {
    return this.formatViewersCount(count);
  }

  /**
   * Число зрителей по-русски: «3 473», «44 тыс.», «1,2 млн».
   * Раньше выходило «44.0K» — английские сокращения и точка вместо запятой.
   * '—' значит «нет данных» (категории нет в свежем списке Twitch), а не
   * «ноль зрителей»; в списке категорий такую подпись прячем целиком.
   */
  formatViewersCount(count) {
    if (!count) return '—';
    if (count < 10000) return Number(count).toLocaleString(tr.locale());
    try {
      return new Intl.NumberFormat(tr.locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(count);
    } catch (error) {
      const millions = (count / 1000000).toFixed(1);
      return count >= 1000000
        ? tr('{n} млн', { n: tr.lang() === 'en' ? millions : millions.replace('.', ',') })
        : tr('{n} тыс.', { n: Math.round(count / 1000) });
    }
  }

  /**
   * Форма слова по числу. Общая функция живёт в dom-helpers.js; запасной
   * вариант — на случай, если страницу подключили без неё. Самодельные
   * «n < 5 ? … : …» давали «21 категорий» и «5 кампании».
   */
  plural(n, one, few, many) {
    if (typeof window.DOMHelpers?.plural === 'function') return window.DOMHelpers.plural(n, one, few, many);
    if (typeof window.utils?.plural === 'function') return window.utils.plural(n, one, few, many);
    if (typeof window.tr?.plural === 'function') return window.tr.plural(n, one, few, many);
    const value = Number(n) || 0;
    if (!Number.isInteger(value)) return few;
    const tens = Math.abs(value) % 100;
    const units = tens % 10;
    if (tens > 10 && tens < 20) return many;
    if (units === 1) return one;
    if (units >= 2 && units <= 4) return few;
    return many;
  }

  /** «зритель / зрителя / зрителей» к числу из formatViewersCount. */
  viewersWord(count) {
    // После «44 тыс.» и «1,2 млн» всегда «зрителей»
    if (!count || count >= 10000) return tr('зрителей');
    return this.plural(count, 'зритель', 'зрителя', 'зрителей');
  }

  /** Подпись «3 473 зрителя»; без данных — пустая строка. */
  viewersLabel(count) {
    if (!count) return '';
    return `${this.formatViewersCount(count)} ${this.viewersWord(count)}`;
  }
  
  /** Крупная обложка для окна категории; без обложки — заглушка. */
  getHighQualityBoxArt(url, categoryId = null) {
    return this.boxArtSrc(url, '285x380', categoryId);
  }

  /**
   * Заглушка на месте стрима, когда фарминг не идёт. Она же кнопка
   * запуска: обработчик висит на #current-stream-info (setupEventListeners).
   * Раньше она выглядела кнопкой, клик не делал ничего, а подпись
   * «Ожидание» при остановленном фарминге сбивала с толку.
   */
  getWaitingStateMarkup() {
    const action = this.esc(tr('Начать фарминг'));
    // Та же разметка, что в farming.html. Пояснение (.waiting-sub) дописывает
    // updateWaitingSub сразу после вставки — см. stopFarming
    return `
      <div class="no-stream waiting-state" tabindex="0" role="button" aria-label="${action}">
        <div class="waiting-icon" aria-hidden="true">
          <span class="waiting-ring waiting-ring-outer"></span>
          <span class="waiting-ring waiting-ring-inner"></span>
          <span class="waiting-dot"></span>
        </div>
        <p class="waiting-label">${tr('Фарминг не запущен')}</p>
        <p class="waiting-sub"></p>
        <p class="waiting-hint">${window.Icons?.get('play', 14) ?? ''}<span>${action}</span></p>
      </div>
    `;
  }
  
  /**
   * Выбирает канал из списка стримов категории.
   *
   * Смысл избранного в подписках именно в этом: если избранный стример
   * сейчас ведёт эфир по нужной игре, смотреть надо его. Раньше избранное
   * не использовалось в фарминге вообще — везде безусловно брался streams[0],
   * то есть первый по версии Twitch. А «приоритет подписок» в настройках
   * сортировал КАТЕГОРИИ, сравнивая название игры с логином стримера, —
   * такое совпадение возможно только случайно.
   *
   * Порядок предпочтения:
   *   1. избранные каналы;
   *   2. остальные подписки, если включён приоритет подписок;
   *   3. первый из выдачи Twitch.
   */
  /**
   * Все категории отработаны — фармить больше нечего.
   *
   * Здесь же срабатывает автовыключение компьютера. Механика выключения
   * в приложении была реализована полностью (IPC в main-процессе, окно с
   * обратным отсчётом и отменой), но вызывать её было некому: обработчик
   * завершения жил в StreamingManager, а тот в текущей версии не участвует
   * в фарминге. Настройка сохранялась и не делала ничего.
   */
  onAllCategoriesCompleted() {
    // Через общий notifyFarmingEvent: он молчит в тихие часы и при
    // выключенных уведомлениях Windows. Прямой вызов всплывал и ночью
    window.notifyFarmingEvent?.(
      tr('Завершено'),
      tr('Все доступные дропсы собраны')
    );
    // Журнал и звук: событие запоминается и тогда, когда уведомление
    // молчит (тихие часы); тихие часы звук глушит сам chime.js
    window.eventLog?.add({ type: 'all-done', title: tr('Все награды собраны') });
    window.chime?.play?.('allDone');

    window.shutdownManager?.onDropsCompleted();
  }

  /**
   * Выбирает канал для просмотра в категории.
   *
   * Ключевой момент: Twitch отдаёт по игре только топ-20 стримов по числу
   * зрителей. Избранные каналы — как правило небольшие, и в эту выдачу они
   * почти никогда не попадают. Поэтому искать их в списке бесполезно:
   * сначала спрашиваем напрямую, в эфире ли они и в той ли игре.
   *
   * Подписки учитываются ТОЛЬКО при включённом приоритете подписок.
   * Порядок предпочтения при включённом:
   *   1. избранные каналы, идущие сейчас по нужной игре;
   *   2. остальные подписки;
   *   3. подписки, попавшие в выдачу Twitch;
   *   4. первый из выдачи.
   *
   * options.exclude — канал, который выбирать нельзя (кнопка «Другой стрим»).
   */
  async pickPreferredStream(streams, categoryName, options = {}) {
    if (!Array.isArray(streams) || streams.length === 0) return null;

    const SP = window.StreamPicker;

    // Часть кампаний Twitch привязывает к конкретным стримерам: просмотр
    // остальных не засчитывается вовсе. Раньше приложение выбирало стрим по
    // зрителям и тегу «Drops» и могло всю ночь смотреть «не того».
    let allowed = await this.allowedChannelsFor(categoryName);
    if (allowed.length > 0) {
      const permitted = window.DropCredit.filterAllowed(streams, allowed);
      if (permitted.length > 0) {
        console.log('[Выбор стрима] Кампания только для %d каналов, в выдаче подходят: %d', allowed.length, permitted.length);
        streams = permitted;
      } else {
        const live = await this.findLiveAllowedChannel(allowed, categoryName, options.exclude);
        if (live) {
          console.log('[Выбор стрима] Разрешённый канал в эфире:', live.login);
          return live;
        }
        if (allowed.soft) {
          // Список кампаний неполный — ограничение лишь пожелание (см.
          // allowedChannelsFor): никого из разрешённых нет, берём любой стрим
          console.log('[Выбор стрима] Разрешённые каналы не в эфире, список кампаний ещё неполный — беру любой стрим категории');
          allowed = [];
        } else {
          console.warn('[Выбор стрима] Кампания только для %d каналов, никто из них не в эфире', allowed.length);
          // При переборе категорий (options.quiet) итог сообщает перебор
          // одним тостом — иначе на каждую категорию выходило по три
          if (!options.quiet) {
            const word = this.plural(allowed.length, 'канала', 'каналов', 'каналов');
            window.utils?.showToast(tr('Кампания засчитывается только у {n} {word}, никто не в эфире', { n: allowed.length, word }), 'warning');
          }
          return null;
        }
      }
    }

    // Канал, который просили не выбирать (кнопка «Другой стрим»)
    const fallback = SP.poolWithout(streams, options.exclude);

    try {
      const priorityEnabled = await Storage.getItem('subscriptions_priority_enabled');

      // Выключенный переключатель означает именно выключенный: подписки и
      // избранное не влияют на выбор вообще. Раньше избранные применялись
      // всегда, и отключить их было невозможно — приложение упорно
      // возвращало один и тот же канал.
      if (!priorityEnabled) {
        return fallback[0];
      }

      const subscriptions = (await Storage.getSubscriptions()) || [];
      if (subscriptions.length === 0) return fallback[0];

      // Избранные вперёд, внутри группы — по заданному пользователем порядку
      const ordered = SP.orderSubscriptions(subscriptions, options.exclude)
        .filter(sub => !allowed.length || allowed.includes(SP.normalizeLogin(sub.login)));

      const direct = await this.findLivePreferredChannel(ordered, categoryName);
      if (direct) return direct;

      // Подстраховка: вдруг подписка всё же попала в выдачу
      const inList = SP.findInList(fallback, ordered);
      if (inList) {
        console.log('[Выбор стрима] Канал из подписок в выдаче:', inList.displayName || inList.login);
        return inList;
      }
    } catch (error) {
      console.warn('[Выбор стрима] Не удалось учесть подписки:', error?.message);
    }

    return fallback[0];
  }

  /**
   * Разрешённые каналы для кампаний игры. Пусто — любой канал категории.
   * Берутся только кампании, которые ещё имеет смысл фармить.
   * allowed.soft — список кампаний неполный, ограничение лишь пожелание.
   */
  async allowedChannelsFor(categoryName) {
    if (!window.DropCredit || !window.electronAPI?.fetchDropsInventory) return [];
    try {
      const result = await window.electronAPI.fetchDropsInventory();
      const matched = this.matchCampaignsForGame(result?.campaigns || [], categoryName);
      const CV = window.CampaignValue;
      const worthwhile = CV ? matched.filter(c => CV.evaluate(c).feasible) : matched;
      const allowed = window.DropCredit.allowedLogins(worthwhile.length ? worthwhile : matched);
      // Пока Twitch не отдал полный список кампаний (до первого стрима после
      // запуска; на новом компьютере это бросается в глаза), видны только
      // начатые. У Overwatch среди них оказалась одна кампания, привязанная
      // к двум каналам не в эфире, — и приложение решило, что игра
      // засчитывается только у них, и не запускало ни один стрим. Совсем
      // отбрасывать ограничение тоже нельзя: у игры, где все кампании на
      // своих каналах, первый стрим после каждого запуска шёл бы мимо
      // зачёта, а при выключенном автопереключении — так и оставался бы.
      // Поэтому по неполному списку ограничение мягкое: живой разрешённый
      // канал берём, а если таких нет — любой стрим категории; после старта
      // плеера придёт полный список, и проверка зачёта поправит выбор
      if (allowed.length && result?.dashboardComplete !== true) allowed.soft = true;
      return allowed;
    } catch (error) {
      console.warn('[Выбор стрима] Не удалось прочитать список каналов кампании:', error?.message);
      return [];
    }
  }

  /** Кто из разрешённых каналов сейчас в эфире по нужной игре. */
  async findLiveAllowedChannel(allowed, categoryName, exclude) {
    if (!window.electronAPI?.getStreamStats) return null;
    const skip = window.DropCredit.normalizeLogin(exclude);
    const candidates = allowed.filter(login => login !== skip);

    // Раньше проверялись только первые 12, и категория пропускалась, хотя
    // живые разрешённые каналы стояли в списке дальше. Теперь — пачками по
    // 12, пока не найдётся живой. Предел и срок — чтобы кампания на сотни
    // каналов не превратилась в сотни запросов и минуты ожидания
    const BATCH = 12;
    const MAX_CHECKS = 60;
    const deadline = Date.now() + 30000;
    const limited = candidates.slice(0, MAX_CHECKS);

    for (let i = 0; i < limited.length; i += BATCH) {
      if (i > 0 && Date.now() > deadline) break;

      let failed = 0;
      const batch = limited.slice(i, i + BATCH);
      const checked = await Promise.all(batch.map(async (login) => {
        try {
          const stats = await window.electronAPI.getStreamStats(login);
          if (!stats || !stats.gameName) return null;
          if (!this.isSameGame(stats.gameName, categoryName)) return null;
          return {
            login,
            displayName: login,
            title: stats.title || '',
            viewersCount: stats.viewers || 0,
            profileImageUrl: null
          };
        } catch (error) {
          failed++;
          return null;
        }
      }));

      // Порядок сохраняется: первый непустой — раньше всех в списке
      const live = checked.find(Boolean);
      if (live) return live;
      // Twitch не ответил ни по одному каналу пачки — дальше спрашивать
      // бессмысленно, только нагрузим его повторами
      if (failed === batch.length) break;
    }

    if (candidates.length > limited.length) {
      console.log('[Выбор стрима] Проверено разрешённых каналов: %d из %d', limited.length, candidates.length);
    }
    return null;
  }

  /**
   * Спрашивает у Twitch напрямую, идёт ли кто-то из приоритетных каналов
   * по нужной игре. Проверяем ограниченное число каналов и параллельно,
   * чтобы не задерживать запуск стрима.
   */
  async findLivePreferredChannel(orderedSubscriptions, categoryName) {
    if (!categoryName || orderedSubscriptions.length === 0) return null;
    if (!window.electronAPI?.getStreamStats) return null;

    const MAX_CHECKS = 12;
    const candidates = orderedSubscriptions.slice(0, MAX_CHECKS);

    const checked = await Promise.all(candidates.map(async (sub) => {
      try {
        const stats = await window.electronAPI.getStreamStats(sub.login);
        // stats === null означает, что канал сейчас не в эфире
        if (!stats || !stats.gameName) return null;
        if (!this.isSameGame(stats.gameName, categoryName)) return null;

        return window.StreamPicker.toStream(sub, stats);
      } catch (error) {
        return null;
      }
    }));

    // Порядок массива сохраняется, поэтому первый непустой — самый приоритетный
    const match = checked.find(Boolean);
    if (match) {
      console.log('[Выбор стрима] %s канал в эфире по нужной игре: %s',
        match.isFavorite ? 'Избранный' : 'Подписанный', match.displayName);
    }
    return match || null;
  }

  /**
   * Одна ли это игра — для всех решений фарминга.
   *
   * Раньше сравнивалось начало названия: «World of Tanks» совпадало с
   * «World of Tanks Console», и избранный стример соседней игры
   * выбирался, через минуту отбрасывался как «сменил игру» — и так по
   * кругу. Теперь сравнение строгое, как и в проверке смены игры: по id
   * игры, если он известен с обеих сторон, иначе по точному названию.
   */
  isSameGame(a, b, idA, idB) {
    return window.StreamPicker.isExactGame(a, b, idA, idB);
  }

  /**
   * Запуск категории.
   *
   * options.stream — канал, уже выбранный пользователем и проверенный
   * (окно категории, карточка подписки): тогда он и запускается, а не тот,
   * который приложение выбрало бы само.
   * options.manual — запуск руками (Play, окно категории, подписки):
   * отметка ручного запуска ставится вместе со сменой стрима, а не до неё.
   *
   * Если сессия уже идёт, это смена категории внутри неё: время прежней
   * категории записывается, а таймер сессии, трафик, баллы и дропсы не
   * трогаются. Пока для новой категории не нашёлся канал, текущий стрим
   * продолжает играть.
   *
   * Возвращает true, если стрим запущен, false — если нет.
   */
  async startFarmingForCategory(category, options = {}) {
    const revision = this.beginStreamOperation();

    // Неудача при идущей сессии — не повод её бросать: говорим, что
    // продолжаем прежнюю категорию
    const keepTail = () => {
      const current = this.sessionStartTime && this.currentStream && this.currentCategory &&
        this.currentCategory.id !== category.id ? this.currentCategory : null;
      return current ? ' ' + tr('— продолжаю «{name}»', { name: current.name }) : '';
    };

    const accounts = await Storage.getAccounts();
    if (!this.isStreamOperationCurrent(revision)) return;
    if (accounts.length === 0) {
      window.utils.showToast(tr('Добавьте хотя бы один аккаунт'), 'warning');
      return false;
    }

    let stream = options.stream?.login ? options.stream : null;
    const chosenByUser = !!stream;

    if (!stream) {
      // Получаем стримы для этой категории.
      //
      // Раньше этот запрос стоял голым: отказ сети выбрасывал исключение
      // прямо из обработчика нажатия, и дальше не происходило ничего —
      // пользователь видел «Запуск категории…» и тишину. Теперь у запроса
      // есть срок, а любая неудача называется вслух.
      let streams = null;
      try {
        streams = await Promise.race([
          window.electronAPI.getStreamsWithDrops(category.name),
          new Promise(resolve => setTimeout(() => resolve(null), 15000))
        ]);
        if (!this.isStreamOperationCurrent(revision)) return;
      } catch (error) {
        console.error('[Фарминг] Не удалось получить стримы:', error);
        window.utils.showToast(tr('Не удалось запустить {name}: {error}{tail}', { name: category.name, error: error?.message || tr('ошибка сети'), tail: keepTail() }), 'error');
        return false;
      }

      if (streams === null) {
        window.utils.showToast(tr('Twitch не ответил по категории {name}{tail}', { name: category.name, tail: keepTail() }), 'error');
        return false;
      }

      if (!Array.isArray(streams) || streams.length === 0) {
        const tail = keepTail();
        window.utils.showToast(tail
          ? tr('В «{name}» сейчас никто не стримит{tail}', { name: category.name, tail })
          : tr('Нет стримов для {name}', { name: category.name }), 'warning');
        return false;
      }

      // Выбираем первый стрим
      stream = await this.pickPreferredStream(streams, category.name);
      if (!this.isStreamOperationCurrent(revision)) return;

      if (!stream || !stream.login) {
        window.utils.showToast(tr('Не удалось выбрать стрим в {name}{tail}', { name: category.name, tail: keepTail() }), 'error');
        return false;
      }
    }
    const streamUrl = `https://www.twitch.tv/${stream.login}`;

    console.log('Starting stream:', stream.displayName, streamUrl);
    // Для выбранного пользователем канала тост «Запускаю…» уже показан
    if (!chosenByUser) {
      window.utils.showToast(tr('Запуск стрима: {name}', { name: stream.displayName }), 'success');
    }

    // Смена категории внутри идущей сессии: время прежней записываем
    // здесь, пока она ещё текущая. Раньше смена шла через stopFarming и
    // новый старт, и статистика по играм записывала прежней категории
    // всю сессию целиком.
    const sessionRunning = !!window.sessionState?.isActive?.();
    if (sessionRunning && this.currentCategory?.id !== category.id) {
      await this.noteCategoryWatchTime();
      if (!this.isStreamOperationCurrent(revision)) return;
    }

    // Отметку ручного запуска ставим только теперь, когда канал найден:
    // при неудаче остаётся прежняя категория со своей отметкой
    if (options.manual) {
      this.manualCategoryId = category.id;
      this.setManualPlayLock(category);
    }

    // Сохраняем текущую категорию и стрим
    this.currentCategory = category;
    this.currentStream = stream;
    this.resetCategoryCounters(category);

    // Новую сессию начинает SessionState.start(): он заводит таймер
    // автовыключения и сбрасывает качество плеера. Раньше здесь стояло
    // голое присваивание sessionStartTime, которое шло через restore(),
    // и выключение по таймеру не срабатывало никогда. Делаем это до
    // загрузки плеера, чтобы сброс качества успел к ней.
    const newSession = !!window.sessionState && !window.sessionState.isActive();
    if (newSession) {
      window.sessionState.start({ categoryName: category.name, streamLogin: stream.login });
      window.eventLog?.add({ type: 'start', title: tr('Фарминг запущен'), detail: category.name });
    }

    // Открываем стрим
    await window.electronAPI.openStream(streamUrl, accounts[0]);
    if (!this.isStreamOperationCurrent(revision)) return;
    
    // Обновляем UI
    this.updateCurrentStreamUI(stream, category);
    
    // Обновляем кнопки
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    if (startBtn) {
      startBtn.style.display = 'none';
      if (stopBtn) {
        stopBtn.style.display = 'flex';
      }
    }
    
    // Показываем информацию о сессии
    const sessionInfo = document.getElementById('farming-session-info');
    if (sessionInfo) {
      sessionInfo.style.display = 'block';
    }
    
    // Очищаем старый интервал если он существует
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    
    // Запускаем трекинг. Трафик и баллы новой сессии уже обнулил
    // SessionState.start(); здесь — то, что живёт на странице. Идущую
    // сессию смена категории не обнуляет. Отсчёт категории при её смене
    // уже начат noteCategoryWatchTime; другой стрим той же категории
    // отсчёт не сбрасывает.
    if (!sessionRunning || !this.categoryStartTime) {
      this.categoryStartTime = Date.now();
    }
    if (newSession) {
      this.estimatedBandwidth = 0;
      this.bandwidthHistory = [];
      this._sessionDropsBaseline = null;
      this._sessionCountedDrops = null;
      this._sessionSeenCampaigns = null;
    }

    this.updateSessionInfo();

    // Старый таймер обязательно глушим. Без этого каждый запуск категории
    // (ручной кнопкой Play и всякое автопереключение идут именно сюда)
    // оставлял позади живой секундный интервал без ссылки — заглушить его
    // потом было уже нечем. За ночь с десятком переключений набегал
    // десяток таймеров, и каждый дёргал обновление сессии с запросом
    // трафика и записью в DOM.
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    this.sessionInterval = setInterval(() => {
      this.updateSessionInfo();
    }, 1000);

    // Запускаем периодическое обновление статистики (раз в минуту, см. LIVE_STATS_MS)
    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
    }
    this.statsUpdateInterval = setInterval(() => {
      this.updateLiveStatistics();
    }, FarmingPage.LIVE_STATS_MS);

    // Создаем начальную сессию в статистике
    this.updateLiveStatistics();

    // Сбрасываем трекинг баллов для нового стрима
    this.resetChannelPointsTracking();

    // Сохраняем активную сессию
    await this.saveActiveSession(stream, category);
    if (!this.isStreamOperationCurrent(revision)) return;
    
    // Загружаем дропсы
    this.loadAndDisplayDrops(stream.login, category.name);
    
    // Показываем блок баллов
    const pointsCard = document.getElementById('channel-points-card');
    if (pointsCard) {
      pointsCard.style.display = 'block';
    }
    
    // Запускаем автосбор
    this.startBackgroundBonusCollector(stream.login);
    
    // Запускаем проверку состояния трансляции

    // Отображаем корректное состояние кнопок
    this.showFarmingState();
    return true;
  }

  setupToggleButtons() {
    const toggles = document.querySelectorAll('.category-toggle-switch input[type="checkbox"]');
    toggles.forEach(toggle => {
      if (toggle.dataset.bound) return;
      toggle.dataset.bound = '1';
      toggle.addEventListener('change', async (e) => {
        const categoryId = e.target.dataset.categoryId;
        const category = this.categories.find(c => c.id === categoryId);
        const label = e.target.closest('.category-toggle-switch');
        
        if (category) {
          // Категория без поля enabled считается включённой
          const wasEnabled = category.enabled !== false;
          category.enabled = e.target.checked;

          // Пользователь распорядился сам — снимаем отметку о том, что
          // категорию выключило приложение, иначе оно вернуло бы её
          // в работу при новой кампании вопреки решению пользователя.
          // Выключение руками запоминаем: синхронизация автокатегорий
          // раньше включала такую категорию обратно через пару минут.
          category.disabledByCompletion = false;
          category.disabledByApp = false;
          if (category.enabled) delete category.userDisabled;
          else category.userDisabled = true;
          
          console.log('Toggle category:', {
            name: category.name,
            id: categoryId,
            wasEnabled,
            nowEnabled: category.enabled,
            currentCategoryId: this.currentCategory?.id,
            isCurrent: this.currentCategory?.id === categoryId
          });
          
          // Обновляем класс для плавной анимации
          if (e.target.checked) {
            label.classList.add('checked');
          } else {
            label.classList.remove('checked');
          }
          
          await this.saveCategories();
          
          window.utils.showToast(category.enabled
            ? tr('{name} включена', { name: category.name })
            : tr('{name} отключена', { name: category.name }), 'success');

          // Список сразу не пересортировываем: выключенная карточка уезжала
          // вниз, к выключенным, и чтобы вернуть тумблер, её приходилось
          // искать. Меняем только вид самой карточки, порядок поправит
          // следующая перерисовка (разметка карточки уже другая, и она
          // заменится целиком)
          const card = e.target.closest('.category-item');
          if (card) card.classList.toggle('disabled', !category.enabled);
          
          // Если выключили текущую категорию, переключаемся на следующую.
          //
          // Отметку ручного запуска снимаем: пользователь сам выключил
          // категорию, которую запускал. Раньше защита от автопереключения
          // её удерживала — плеер продолжал её смотреть, а предложение
          // сообщало «дропсов нет», хотя дело было не в этом.
          if (wasEnabled && !category.enabled && this.currentCategory && this.currentCategory.id === categoryId) {
            console.log('Current category disabled, switching to next enabled category');
            if (this.manualCategoryId === categoryId) this.manualCategoryId = null;
            if (this.manualPlayLockCategoryId === categoryId) this.manualPlayLockCategoryId = null;
            this.updateAutoFarmButton();
            setTimeout(() => {
              // За секунду категорию могли включить обратно или сменить
              if (this._destroyed || category.enabled || this.currentCategory?.id !== categoryId) return;
              this.switchToNextEnabledCategory({ reason: 'disabled' });
            }, 1000);
          }
        }
      });
    });
  }
  
  /**
   * «Начать фарминг» с карточки канала в подписках.
   *
   * Раньше здесь создавалась категория с именем канала («ow_esports_kr»),
   * а Twitch ищет стримы по названию игры — дальше было только «нет
   * стримов с дропсами», и список засорялся мусором. Теперь узнаём, что
   * канал стримит сейчас, находим (или заводим) категорию этой игры и
   * запускаем именно этот канал — как ручной выбор.
   *
   * Возвращает { ok: true } или { ok: false, reason } — тост по результату
   * показывает вызывающая страница. Если запустить нечего, список
   * категорий не меняется.
   */
  async addChannelToFarming(channelLogin, info = {}) {
    const login = window.StreamPicker.normalizeLogin(channelLogin).trim();
    if (!login) return { ok: false, reason: tr('Не указан канал') };
    const name = info.displayName || login;

    try {
      // Без аккаунта startFarmingForCategory показал бы свой тост, а
      // подписки — второй («Не удалось запустить»). Отвечаем сразу, пока
      // в список категорий ничего не добавлено. Сбой чтения — незнание:
      // идём дальше, там проверка повторится
      const accounts = await Promise.resolve()
        .then(() => Storage.getAccounts())
        .catch(() => null);
      if (Array.isArray(accounts) && accounts.length === 0) {
        return { ok: false, reason: tr('Добавьте хотя бы один аккаунт') };
      }

      let stats;
      try {
        stats = await window.electronAPI.getStreamStats(login);
      } catch (error) {
        return { ok: false, reason: tr('Twitch не ответил, попробуйте позже') };
      }
      if (!stats) return { ok: false, reason: tr('{name} сейчас не в эфире', { name }) };

      const gameName = stats.gameName;
      if (!gameName) return { ok: false, reason: tr('Не удалось узнать, во что играет {name}', { name }) };

      let category = this.categories.find(c => this.isSameGame(c.name, gameName, c.id, stats.gameId)) || null;

      // Дропсы проверяем по игре, а не по логину канала
      if (category?.hasDrops !== true) {
        const checked = await window.electronAPI.checkCategoryDrops(gameName);
        if (checked === null || checked === undefined) {
          return { ok: false, reason: tr('Twitch не ответил, попробуйте позже') };
        }
        if (!checked) return { ok: false, reason: tr('У игры «{game}» сейчас нет дропсов', { game: gameName }) };
      }

      if (!category) {
        // Свежие данные Twitch дают id, обложку и зрителей; без них
        // категория тоже работает
        let fresh = null;
        try {
          const all = await window.electronAPI.fetchTwitchCategories();
          fresh = (all || []).find(c => this.isSameGame(c.name, gameName, c.id, stats.gameId)) || null;
        } catch (error) {
          // не критично
        }
        // Пока шли запросы, ту же игру могли добавить
        category = this.categories.find(c => this.isSameGame(c.name, gameName, c.id, stats.gameId)) || null;
        if (!category) {
          const slug = String(gameName).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
          category = {
            id: fresh?.id || ('game-' + (slug || Date.now().toString(36))),
            name: fresh?.name || gameName,
            boxArtURL: this.normalizeBoxArtURL(fresh?.boxArtURL, '52x72'),
            viewersCount: fresh?.viewersCount || 0,
            tags: fresh?.tags || [],
            enabled: true,
            autoDrops: false,
            hasDrops: true,
            priority: this.categories.length + 1,
            dropsCompleted: false
          };
          this.categories.push(category);
        }
      }

      category.hasDrops = true;
      if (!category.enabled) {
        category.enabled = true;
        category.disabledByCompletion = false;
        category.disabledByApp = false;
      }
      // Канал запущен руками — прежние «выключил» и «удалил» больше не действуют
      delete category.userDisabled;
      await this.setCategoryDeleted(category.name, false);
      await this.saveCategories();
      this.renderCategories();

      const stream = {
        login,
        displayName: name,
        title: stats.title || '',
        viewersCount: stats.viewers || 0,
        profileImageUrl: info.profileImageUrl || null
      };

      // Канал выбран руками — приложение само его не меняет. Идущую
      // сессию не останавливаем: меняется только стрим
      const started = await this.startFarmingForCategory(category, { stream, manual: true });
      this.updateAutoFarmButton();
      return started === true
        ? { ok: true, category: category.name }
        : { ok: false, reason: tr('Не удалось запустить {name}', { name }) };
    } catch (error) {
      console.error('Error adding channel to farming:', error);
      return { ok: false, reason: tr('Ошибка при запуске канала') };
    }
  }

  /**
   * Переход к следующей категории, где есть что фармить.
   *
   * Возвращает:
   *   true    — переключились (или ручная блокировка держит текущую);
   *   false   — переключаться некуда: фарминг остановлен (или ручная
   *             категория — тогда показано предложение);
   *   'retry' — Twitch не ответил: текущий стрим оставлен, повтор по таймеру;
   *   undefined — операцию перебила более новая.
   *
   * options.keepCurrent — текущая категория рабочая, и уходить из неё
   * стоит только если нашлось куда. Тогда при неудаче ничего не меняем.
   *
   * options.reason — почему уходим: 'noDrops', 'offline', 'gameChanged',
   * 'noCredit', 'done' или 'disabled'. Нужна, чтобы предложение у ручной
   * категории называло настоящую причину, а не всегда «дропсов нет».
   * 'disabled' — категорию убрал сам пользователь: если перейти некуда,
   * фарминг останавливается без «всё собрано» и без автовыключения.
   */
  async switchToNextEnabledCategory(options = {}) {
    const keepCurrent = options.keepCurrent === true;
    const reason = options.reason || '';
    const revision = this.beginStreamOperation();
    clearTimeout(this._categoryRetryTimer);
    this._categoryRetryTimer = null;
    // Категорию, запущенную вручную, не меняем ни по какой причине.
    // Раньше защита стояла только в handleCategoryNoDrops, а сюда ведут
    // и другие пути: смена игры у стримера, завершение дропсов, ошибки.
    if (this.isManualCategoryActive()) {
      console.log('[Ручной запуск] Смена категории отменена:', this.currentCategory?.name);
      this.showSwitchOffer(reason, options.detail);
      return false;
    }

    console.log('switchToNextEnabledCategory called');
    console.log('Current category:', this.currentCategory);
    console.log('All categories:', this.categories.map(c => ({ name: c.name, id: c.id, enabled: c.enabled })));
    
    // Сохраняем статистику текущей категории перед переключением
    await this.noteCategoryWatchTime();
    if (!this.isStreamOperationCurrent(revision)) return;
    
    // Находим следующую включенную категорию (пропускаем завершенные)
    // Приоритет: 1) ручные категории, 2) подписанные каналы с дропсами (если включен приоритет), 3) наличие дропсов, 4) сохранённый порядок/priority
    const candidates = this.categories
      .filter(cat => cat.enabled && cat.id !== this.currentCategory?.id && !cat.dropsCompleted);

    // Где только что никто не стримил, в этом проходе не спрашиваем
    // снова. Такие категории не выключаются: они вернутся сами.
    if (!this._noStreamsUntil) this._noStreamsUntil = new Map();
    const pausedUntil = this._noStreamsUntil;
    const now = Date.now();
    let enabledCategories = candidates.filter(cat => !((pausedUntil.get(cat.id) || 0) > now));
    const pausedCount = candidates.length - enabledCategories.length;

    // Проверяем включен ли приоритет подписок
    const subscriptionsPriorityEnabled = await Storage.getItem('subscriptions_priority_enabled');
    if (!this.isStreamOperationCurrent(revision)) return;
    if (subscriptionsPriorityEnabled) {
      const subscriptions = await Storage.getSubscriptions() || [];
      if (!this.isStreamOperationCurrent(revision)) return;
      const subscriptionLogins = subscriptions.map(s => s.login.toLowerCase());
      
      enabledCategories.sort((a, b) => {
        // Закреплённые всегда впереди
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        // Ручные категории имеют наивысший приоритет
        const aManual = a.autoDrops ? 0 : 1;
        const bManual = b.autoDrops ? 0 : 1;
        if (aManual !== bManual) return bManual - aManual;
        
        // Категория считается подписочной, только если её имя в точности
        // совпадает с логином канала. Сравнение через includes ловило ложные
        // совпадения: короткий логин находится внутри названия любой игры.
        const aIsSubscribed = subscriptionLogins.includes(a.name.toLowerCase());
        const bIsSubscribed = subscriptionLogins.includes(b.name.toLowerCase());
        
        if (aIsSubscribed !== bIsSubscribed) return aIsSubscribed ? -1 : 1;
        
        // Если оба подписанные или оба нет, сортируем по остальным критериям
        // Выгода: безнадёжные вниз, впереди та, где за час возьмём больше
        const byValue = this.compareCategoryValue(a, b);
        if (byValue !== 0) return byValue;

        const aNoDrops = a.hasDrops ? 0 : 1;
        const bNoDrops = b.hasDrops ? 0 : 1;
        if (aNoDrops !== bNoDrops) return aNoDrops - bNoDrops;
        return (a.priority || 0) - (b.priority || 0);
      });
    } else {
      // Обычная сортировка без приоритета подписок
      enabledCategories.sort((a, b) => {
        // Закреплённые всегда впереди
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        // Ручные категории имеют наивысший приоритет
        const aManual = a.autoDrops ? 0 : 1;
        const bManual = b.autoDrops ? 0 : 1;
        if (aManual !== bManual) return bManual - aManual;
        
        // Выгода: безнадёжные вниз, впереди та, где за час возьмём больше
        const byValue = this.compareCategoryValue(a, b);
        if (byValue !== 0) return byValue;

        const aNoDrops = a.hasDrops ? 0 : 1;
        const bNoDrops = b.hasDrops ? 0 : 1;
        if (aNoDrops !== bNoDrops) return aNoDrops - bNoDrops;
        return (a.priority || 0) - (b.priority || 0);
      });
    }
    
    console.log('Enabled categories:', enabledCategories.map(c => c.name));
    
    if (enabledCategories.length === 0) {
      if (this.isSingleManualPlayLocked()) {
        console.log('[ManualPlayLock] No next categories, keeping current category active');
        window.utils.showToast(tr('Оставляем текущую категорию активной до ручной остановки'), 'info');
        return true;
      }

      if (keepCurrent) return false;

      // Пользователь сам убрал текущую категорию, а других нет. Это не
      // «все дропсы собраны»: раньше здесь срабатывало уведомление о
      // завершении и автовыключение компьютера.
      if (reason === 'disabled') {
        window.utils.showToast(tr('Других включённых категорий нет — фарминг остановлен'), 'info');
        this.stopFarming(false);
        return false;
      }

      // Кампании есть, но стримов по ним сейчас нет — это не «всё
      // собрано». Сообщать о завершении и выключать компьютер рано.
      //
      // То же, когда уходим из НЕотработанной категории только потому, что
      // в ней некого смотреть: стрим кончился, стример сменил игру, канал
      // не засчитывает. Других категорий нет — но награды в этой остались.
      // Раньше здесь звучало «Все категории отработаны» и срабатывало
      // автовыключение «по дропсам»
      const current = this.currentCategory;
      const leftUnfinished = ['offline', 'gameChanged', 'noCredit'].includes(reason) &&
        !!current && current.enabled !== false && !current.dropsCompleted;
      if (pausedCount > 0 || leftUnfinished) {
        this.stopWhenNothingLive();
        return false;
      }

      // Больше фармить нечего — это и есть завершение работы.
      //
      // Раньше здесь только снимался запрет сна, а плеер продолжал
      // играть: всю ночь качался трафик, шла сессия в статистике, а
      // интерфейс показывал фарм, хотя приложение ничего не фармило.
      console.log('[Категории] Переключаться некуда — фарминг завершён');
      window.utils.showToast(tr('Все категории отработаны — фарминг остановлен'), 'info');
      this.stopFarming(false);
      this.onAllCategoriesCompleted();
      return false;
    }

    // Twitch, не ответивший по категории, — это незнание, а не «стримов
    // нет». Раньше пустой ответ при сбое сети выключал категорию насовсем:
    // минутная заминка Twitch разом отключала весь список, и фарминг
    // стоял до утра. Теперь такие категории не трогаем.
    const unanswered = [];
    // Пропущенные «никто не в эфире» — одним итоговым тостом, а не по
    // тосту на категорию: раньше за пару секунд их высыпало с дюжину
    const skippedOffline = [];
    let failuresInRow = 0;
    const MAX_FAILURES_IN_ROW = 3;
    const NO_STREAMS_PAUSE_MS = 15 * 60 * 1000;

    // Пробуем категории по очереди, пока не найдем со стримами
    for (const nextCategory of enabledCategories) {
      console.log('Trying category:', nextCategory.name);

      try {
        const accounts = await Storage.getAccounts();
        if (!this.isStreamOperationCurrent(revision)) return;
        if (!accounts || accounts.length === 0) {
          window.utils.showToast(tr('Нет аккаунтов для запуска стрима'), 'error');
          if (!keepCurrent) this.stopFarming(false);
          return false;
        }
        const account = accounts[0];

        // Получаем стримы для категории
        const streams = await window.electronAPI.getStreamsWithDrops(nextCategory.name);
        if (!this.isStreamOperationCurrent(revision)) return;

        if (!Array.isArray(streams)) {
          console.warn('[Категории] Twitch не ответил по категории, её не трогаю:', nextCategory.name);
          unanswered.push(nextCategory.name);
          // Несколько отказов подряд — Twitch лежит, остальные спрашивать
          // бессмысленно: только нагрузим его повторами
          if (++failuresInRow >= MAX_FAILURES_IN_ROW) break;
          continue;
        }
        failuresInRow = 0;

        if (streams.length === 0) {
          // Стримов сейчас нет. Категорию не выключаем — пропускаем на
          // время: ночью стримы кончаются, утром появляются снова
          console.warn('[Категории] Сейчас никто не стримит, пропускаю:', nextCategory.name);
          pausedUntil.set(nextCategory.id, Date.now() + NO_STREAMS_PAUSE_MS);
          skippedOffline.push(nextCategory.name);
          continue;
        }

        // Берём первый стрим. Тихо: про пропуск скажет итоговый тост
        const stream = await this.pickPreferredStream(streams, nextCategory.name, { quiet: true });
        if (!this.isStreamOperationCurrent(revision)) return;
        if (!stream?.login) {
          // Кампания привязана к каналам, и никто из них не в эфире: это не
          // поломка категории, а вопрос времени — выключать её не надо
          console.warn('[Категории] Разрешённые каналы не в эфире:', nextCategory.name);
          pausedUntil.set(nextCategory.id, Date.now() + NO_STREAMS_PAUSE_MS);
          skippedOffline.push(nextCategory.name);
          continue;
        }
        console.log('Selected stream:', stream.displayName);

        // Нашли стрим! Закрываем текущий и открываем новый. Закрываем
        // только теперь: раньше это делалось до выбора канала, и если
        // выбрать было некого, система оставалась без запрета сна.
        // Тоста «Переключение…» нет: через секунду придёт итог
        await window.electronAPI.closeStream();
        if (!this.isStreamOperationCurrent(revision)) return;

        // Открываем стрим
        await window.electronAPI.openStream(`https://www.twitch.tv/${stream.login}`, account);
        if (!this.isStreamOperationCurrent(revision)) return;

        // КРИТИЧЕСКИ ВАЖНО: обновляем UI и устанавливаем currentCategory
        this.currentCategory = nextCategory;
        this.currentStream = stream;
        this.resetCategoryCounters(nextCategory);
        pausedUntil.delete(nextCategory.id);
        this.resetChannelPointsTracking();
        this.updateCurrentStreamUI(stream, nextCategory);
        await this.saveActiveSession(stream, nextCategory);
        if (!this.isStreamOperationCurrent(revision)) return;

        const skipped = skippedOffline.length;
        const names = { category: nextCategory.name, stream: stream.displayName };
        window.utils.showToast(skipped > 0
          ? tr('Переключено на {category} — {stream}. Пропущено {count} {word}: никто не в эфире', {
            ...names, count: skipped, word: this.plural(skipped, 'категория', 'категории', 'категорий')
          })
          : tr('Переключено на {category} — {stream}', names), 'success');
        // Утром в журнале должно быть видно, почему сменилась игра
        window.eventLog?.add({
          type: 'switch',
          title: tr('Переход к {name}', { name: nextCategory.name }),
          detail: ({
            done: options.detail || tr('награды прежней категории собраны'),
            noDrops: tr('в прежней категории нет дропсов'),
            offline: tr('стрим закончился'),
            gameChanged: tr('стример сменил игру'),
            noCredit: tr('канал не засчитывал минуты'),
            disabled: tr('прежняя категория выключена')
          })[reason] || stream.displayName,
          game: nextCategory.name
        });
        console.log('Stream switched successfully, currentCategory set to:', this.currentCategory);
        return true;
      } catch (error) {
        console.error('Error switching to category:', nextCategory.name, error);
        if (!this.isStreamOperationCurrent(revision)) return;
        // Исключение здесь — временный сбой (сеть, IPC), а не свойство
        // категории. Раньше категория выключалась с подписью «удалена».
        unanswered.push(nextCategory.name);
        if (++failuresInRow >= MAX_FAILURES_IN_ROW) break;
        continue;
      }
    }

    if (keepCurrent) return false;

    // Twitch не ответил хотя бы по одной категории: там вполне могут быть
    // стримы. Текущий стрим оставляем и пробуем снова через минуту.
    if (unanswered.length > 0) {
      console.warn('[Категории] Twitch не ответил по категориям:', unanswered.join(', '));
      this.scheduleCategoryRetry({ reason, detail: options.detail });
      return 'retry';
    }

    // Ответы есть, но смотреть сейчас нечего: стримов нет или нужные
    // каналы не в эфире
    this.stopWhenNothingLive();
    return false;
  }

  /**
   * Twitch не отвечает: пробуем сменить категорию позже.
   * Тост один на всю полосу сбоя, а не на каждую попытку.
   */
  scheduleCategoryRetry(retryOptions = {}) {
    clearTimeout(this._categoryRetryTimer);

    const now = Date.now();
    if (!this._twitchDownToastAt || now - this._twitchDownToastAt > 10 * 60 * 1000) {
      this._twitchDownToastAt = now;
      window.utils?.showToast(tr('Twitch не отвечает — повторю через минуту'), 'warning');
    }

    const snapshot = this.streamSnapshot();
    this._categoryRetryTimer = setTimeout(() => {
      this._categoryRetryTimer = null;
      // Пользователь мог сам сменить стрим или остановить фарминг
      if (this._destroyed || !this.sessionStartTime || !this.isCurrentStream(snapshot)) return;
      // Причина переезжает в повтор: убранная пользователем категория
      // и при повторе не должна заканчиваться «всё собрано»
      this.switchToNextEnabledCategory({ reason: retryOptions.reason, detail: retryOptions.detail });
    }, 60 * 1000);
  }

  /**
   * Смотреть нечего, но кампании ждут — останавливаемся честно и
   * пробуем позже.
   *
   * Раньше в этом месте плеер продолжал играть отработанный канал: шла
   * сессия, качался трафик, интерфейс показывал фарм.
   */
  stopWhenNothingLive() {
    const minutes = Math.round(FarmingPage.AUTO_RESTART_MS / 60000);
    const text = tr('Сейчас никто не стримит категории с дропсами. Попробую снова через {minutes} мин', { minutes });
    console.warn('[Категории] Стримов с дропсами сейчас нет — останавливаюсь, повтор через', minutes, 'мин');
    window.utils?.showToast(tr('Фарминг остановлен. {text}', { text }), 'warning');
    window.notifyFarmingEvent?.(tr('Фарминг остановлен'), text);
    window.eventLog?.add({ type: 'error', title: tr('Фарминг остановлен'), detail: text });
    window.chime?.play?.('attention');
    this.stopFarming(false);
    this.scheduleAutoRestart();
  }

  static get AUTO_RESTART_MS() {
    return 15 * 60 * 1000;
  }

  /**
   * Повторный запуск после остановки «стримов нет».
   *
   * Ночью стримы кончаются, а утром появляются снова — без повтора
   * фарминг стоял бы до тех пор, пока пользователь не нажмёт кнопку.
   * Ручная остановка и ручной запуск повтор отменяют.
   */
  scheduleAutoRestart(attemptsLeft = 32) {
    clearTimeout(this._autoRestartTimer);
    this._autoRestartTimer = setTimeout(async () => {
      this._autoRestartTimer = null;
      if (this._destroyed || this.sessionStartTime || window._farmingStarting) return;
      // Открытое окно входа — сначала его решает пользователь
      if (document.querySelector('.auth-modal')) return;

      console.log('[Фарминг] Повторная попытка запуска после паузы');
      await this.startFarming({ auto: true });

      if (!this._destroyed && !this.sessionStartTime && attemptsLeft > 1 &&
          !document.querySelector('.auth-modal')) {
        this.scheduleAutoRestart(attemptsLeft - 1);
      }
    }, FarmingPage.AUTO_RESTART_MS);
  }

  setupDragAndDrop() {
    const container = document.getElementById('categories-list');
    if (!container) return;

    // Перетаскиваемый элемент храним на странице, а не в замыкании:
    // карточки, пережившие перерисовку, держат старые обработчики, и
    // общая переменная нужна им всем.
    container.querySelectorAll('.category-item').forEach(item => {
      if (item.dataset.dndBound) return;
      item.dataset.dndBound = '1';

      item.addEventListener('dragstart', () => {
        this._draggedItem = item;
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        // Раньше ссылка на узел жила вечно, и dragover следующего
        // перетаскивания мог вставить в список уже выброшенную карточку
        if (this._draggedItem === item) this._draggedItem = null;
        // Порядок сохраняем и здесь, а не только в drop. drop приходит,
        // лишь когда карточку отпустили над другой карточкой; отпущенная
        // в зазор между ними или за краем списка, она оставалась на новом
        // месте, но порядок не сохранялся — через полминуты список
        // откатывался. После drop повторный вызов ничего не пишет: порядок
        // уже совпадает. Он же делает перерисовку, отложенную на время
        // перетаскивания.
        this._categoriesRenderPending = false;
        this.commitDraggedOrder();
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this._draggedItem === item) return;
        this.moveDraggedCategory(container, e.clientY);
      });
    });

    // Обработчики контейнера — по одному. Раньше сброс добавлялся при
    // каждой перерисовке: за ночь их набегали десятки, и одно
    // перетаскивание сохраняло и перерисовывало список десятки раз.
    if (!container.dataset.dropBound) {
      container.dataset.dropBound = '1';

      // Зазоры между карточками тоже место для сброса: без preventDefault
      // курсор над ними становился «нельзя», и drop не приходил вовсе
      container.addEventListener('dragover', (e) => {
        if (!this._draggedItem) return;
        e.preventDefault();
        // Над карточкой место уже выбрал её собственный обработчик
        if (e.target.closest && e.target.closest('.category-item')) return;
        this.moveDraggedCategory(container, e.clientY);
      });

      container.addEventListener('drop', (e) => {
        e.preventDefault();
        this.commitDraggedOrder();
      });
    }
  }

  /** Ставит перетаскиваемую карточку на место под курсором. */
  moveDraggedCategory(container, clientY) {
    const dragged = this._draggedItem;
    if (!dragged || !dragged.isConnected) return;

    const afterElement = this.getDragAfterElement(clientY);
    if (afterElement == null) {
      if (container.lastElementChild === dragged) return;
      container.appendChild(dragged);
    } else {
      if (afterElement === dragged || dragged.nextElementSibling === afterElement) return;
      container.insertBefore(dragged, afterElement);
    }

    // Номера #N — по новому месту уже во время перетаскивания: раньше до
    // отпускания карточка показывала прежний номер. Число в разметке
    // обновляется на месте (applyCategoriesMarkup), так что следующая
    // перерисовка поправит его, если порядок в итоге не сохранится
    container.querySelectorAll('.category-item .category-priority').forEach((el, index) => {
      el.textContent = `${index + 1}`;
    });
  }

  /**
   * Сохраняет порядок категорий так, как он стоит на экране после
   * перетаскивания. Если порядок не изменился, ничего не пишет.
   */
  async commitDraggedOrder() {
    const container = document.getElementById('categories-list');
    if (!container) return;

    const items = container.querySelectorAll('.category-item');
    // Дубли убираем: сорванное перетаскивание могло оставить в списке
    // две карточки одной категории, и она сохранялась дважды
    const newOrder = [...new Set(Array.from(items).map(item => item.getAttribute('data-category-id')))];

    // Категории, которых нет на экране (добавлены, пока перерисовка
    // ждала конца перетаскивания), не теряем — ставим в конец
    const byId = new Map(this.categories.map(cat => [String(cat.id), cat]));
    const ordered = newOrder.map(id => byId.get(id)).filter(Boolean);
    const placed = new Set(newOrder);
    const next = [...ordered, ...this.categories.filter(cat => !placed.has(String(cat.id)))];

    const changed = next.length !== this.categories.length ||
      next.some((cat, index) => cat !== this.categories[index]);

    if (changed) {
      this.categories = next;
      this.categories.forEach((cat, index) => {
        cat.priority = index + 1;
      });
      await this.saveCategories();
    }
    this.renderCategories();
  }

  getDragAfterElement(y) {
    const draggableElements = [...document.querySelectorAll('.category-item:not(.dragging)')];

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

  setupRemoveButtons() {
    document.querySelectorAll('.category-remove').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const categoryId = btn.getAttribute('data-category-id');
        const index = this.categories.findIndex(cat => cat.id === categoryId);
        if (index < 0) return;
        const removed = this.categories[index];
        const isCurrent = this.currentCategory && this.currentCategory.id === categoryId;
        this.categories = this.categories.filter(cat => cat.id !== categoryId);
        // Запоминаем удаление: синхронизация автокатегорий и подписки
        // раньше возвращали игру через пару минут
        await this.setCategoryDeleted(removed.name, true);
        await this.saveCategories();
        this.renderCategories();
        this.showUndoRemove(removed, index);

        if (isCurrent && this.sessionStartTime) {
          // Удалили то, что сейчас фармится: уходим в другую категорию
          // внутри той же сессии. Раньше сессия останавливалась и
          // начиналась заново — таймер и счётчики сбрасывались
          if (this.manualCategoryId === categoryId) this.manualCategoryId = null;
          if (this.manualPlayLockCategoryId === categoryId) this.manualPlayLockCategoryId = null;
          await this.switchToNextEnabledCategory({ reason: 'disabled' });
        }
      });
    });
  }

  /**
   * «Категория удалена» с кнопкой «Вернуть».
   *
   * Крестик удалял сразу и без подтверждения: промахнулся мимо
   * переключателя — и игра со всеми отметками пропала. Несколько секунд
   * на отмену дешевле, чем вопрос перед каждым удалением.
   */
  showUndoRemove(category, index) {
    const host = document.getElementById('categories-list')?.parentElement;
    if (!host) {
      window.utils.showToast(tr('Категория удалена'), 'success');
      return;
    }

    clearTimeout(this._undoTimer);
    this._undoBar?.remove();

    const bar = document.createElement('div');
    bar.className = 'category-undo';
    bar.setAttribute('role', 'status');
    // Вид тоста: нейтральная плашка, действие — тихой кнопкой акцентным
    // текстом (page-farming.css, .category-undo)
    bar.innerHTML = `
      <span class="category-undo-text"></span>
      <button type="button" class="btn btn-ghost btn-sm category-undo-btn">${tr('Вернуть')}</button>
    `;
    bar.querySelector('.category-undo-text').textContent = tr('«{name}» удалена', { name: category.name });

    const close = () => {
      clearTimeout(this._undoTimer);
      bar.remove();
      if (this._undoBar === bar) this._undoBar = null;
    };

    bar.querySelector('.category-undo-btn').addEventListener('click', async () => {
      close();
      if (this._destroyed) return;
      // Ту же игру могли успеть добавить заново
      const key = this.normalizeGameKey(category.name);
      if (this.categories.some(cat => cat.id === category.id || this.normalizeGameKey(cat.name) === key)) return;

      this.categories.splice(Math.min(index, this.categories.length), 0, category);
      await this.setCategoryDeleted(category.name, false);
      await this.saveCategories();
      this.renderCategories();
      window.utils.showToast(tr('«{name}» возвращена', { name: category.name }), 'success');
    });

    host.appendChild(bar);
    this._undoBar = bar;
    this._undoTimer = setTimeout(close, 6000);
  }

  /**
   * Запуск фарминга. Обёртка вокруг реальной реализации.
   *
   * Точек вызова несколько (автозапуск при инициализации, кнопка в сайдбаре,
   * добавление категорий), и они способны сработать почти одновременно —
   * тогда пользователь видел два одинаковых уведомления подряд. Флаг живёт
   * на window, а не на объекте страницы: страница пересоздаётся при каждой
   * навигации, и отложенный вызов от прежнего экземпляра иначе прошёл бы мимо
   * защиты.
   */
  async startFarming(options = {}) {
    // Ручной запуск отменяет отложенный повтор после «стримов нет»
    if (!options.auto) {
      clearTimeout(this._autoRestartTimer);
      this._autoRestartTimer = null;
    }

    // Защёлка от двойного запуска. Раньше она снималась только в finally,
    // то есть при зависшем сетевом запросе не снималась никогда: блок
    // await не завершался, и кнопка молча переставала работать до
    // перезапуска приложения. Теперь у неё есть срок годности.
    const STALE_MS = FarmingPage.START_LATCH_MS;
    const startedAt = window._farmingStartingAt || 0;

    if (window._farmingStarting) {
      if (Date.now() - startedAt < STALE_MS) {
        console.log('[Фарминг] Запуск уже идёт — повторное нажатие пропущено');
        // Нажатие (кнопка, горячая клавиша) не должно пропадать молча
        if (!options.auto) this.toastOnce('start-busy', tr('Поиск стрима ещё идёт…'), 'info', 5000);
        return;
      }
      console.warn('[Фарминг] Прошлый запуск завис, снимаю защёлку');
      this.setStartButtonBusy(false);
    }

    window._farmingStarting = true;
    window._farmingStartingAt = Date.now();

    // Кнопка молчала все несколько секунд поиска и выглядела сломанной
    this.setStartButtonBusy(true);

    try {
      return await this._startFarming();
    } catch (error) {
      console.error('[Фарминг] Запуск не удался:', error);
      window.utils?.showToast(tr('Не удалось запустить: {error}', { error: error?.message || tr('неизвестная ошибка') }), 'error');
    } finally {
      window._farmingStarting = false;
      window._farmingStartingAt = 0;
      this.setStartButtonBusy(false);
    }
  }

  /**
   * Показывает, что приложение занято поиском стрима.
   *
   * Возврат в рабочий вид подстрахован таймером. Раньше он делался только
   * в finally: если запуск подвисал, кнопка навсегда оставалась серой с
   * подписью «Ищем стрим…», и нажать её было уже нельзя — приходилось
   * перезапускать приложение.
   */
  setStartButtonBusy(busy) {
    const btn = document.getElementById('sidebar-start-farming-btn');
    if (!btn) return;

    clearTimeout(this._startButtonTimer);

    const label = btn.querySelector('span');
    if (busy) {
      btn.disabled = true;
      btn.style.opacity = '0.7';
      if (label) {
        if (!this._startButtonLabel) this._startButtonLabel = label.textContent;
        label.textContent = tr('Ищем стрим…');
      }

      // Поиск ограничен и по числу категорий, и по времени. Дольше срока
      // защёлки — зависание, и кнопку надо вернуть пользователю. Срок
      // общий с защёлкой: кнопка, разблокированная через 60 с при
      // защёлке на 90, ещё полминуты выглядела рабочей и молча не нажималась
      this._startButtonTimer = setTimeout(() => {
        console.warn('[Фарминг] Поиск затянулся, разблокирую кнопку');
        this.setStartButtonBusy(false);
      }, FarmingPage.START_LATCH_MS);
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      if (label && this._startButtonLabel) label.textContent = this._startButtonLabel;
    }
  }

  async _startFarming() {
    // Фарминг уже идёт — новый старт начал бы сессию заново. Раньше так и
    // выходило при включении «Фарм всех дропсов» посреди сессии: таймер
    // прыгал в ноль, баллы и дропсы за прошедшие часы пропадали. Сменить
    // категорию внутри сессии можно кнопкой Play.
    if (this.sessionStartTime && this.currentStream) {
      console.log('[Фарминг] Сессия уже идёт — повторный запуск пропущен');
      this.showFarmingState();
      return;
    }

    const revision = this.beginStreamOperation();
    if (this.categories.length === 0) {
      window.utils.showToast(tr('Добавьте хотя бы одну категорию'), 'warning');
      return;
    }

    const accounts = await Storage.getAccounts();
    if (!this.isStreamOperationCurrent(revision)) return;
    if (accounts.length === 0) {
      window.utils.showToast(tr('Добавьте хотя бы один аккаунт'), 'warning');
      if (window.router) {
        window.router.navigate('accounts');
      }
      return;
    }
    
    // Проверяем, есть ли хотя бы один активный аккаунт (OAuth)
    const activeAccounts = accounts.filter(acc => acc.loginMethod === 'oauth');
    if (activeAccounts.length === 0) {
      window.utils.showToast(tr('Для работы требуется OAuth авторизация'), 'error');
      
      // Показываем модальное окно с инструкцией
      const modal = document.createElement('div');
      modal.className = 'auth-modal';
      modal.innerHTML = `
        <div class="auth-modal-overlay"></div>
        <div class="auth-modal-content farm-login-dialog">
          <div class="auth-modal-header">
            <h3>${tr('Нужен вход через Twitch')}</h3>
          </div>
          <div class="auth-modal-body">
            <p class="farm-login-lead">
              ${tr('Для корректной работы фарминга необходимо авторизоваться через Twitch OAuth.')}
            </p>
            <div class="farm-login-steps">
              <div class="section-label">${tr('Что нужно сделать')}</div>
              <ol>
                <li>${tr('Перейдите на вкладку "Аккаунты"')}</li>
                <li>${tr('Нажмите "Войти через Twitch"')}</li>
                <li>${tr('Авторизуйтесь в браузере')}</li>
                <li>${tr('Вернитесь в приложение и запустите фарминг')}</li>
              </ol>
            </div>
            <div class="farm-login-actions">
              <button class="btn btn-secondary" id="close-modal">${tr('Закрыть')}</button>
              <button class="btn btn-primary" id="go-to-accounts">${tr('Перейти к аккаунтам')}</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      
      modal.querySelector('#go-to-accounts').addEventListener('click', () => {
        document.body.removeChild(modal);
        if (window.router) {
          window.router.navigate('accounts');
        }
      });
      
      modal.querySelector('#close-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      modal.querySelector('.auth-modal-overlay').addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      return;
    }
    
    // Проверяем вход в Twitch
    const loggedInAccounts = activeAccounts.filter(acc => acc.twitchLoggedIn);
    if (loggedInAccounts.length === 0) {
      window.utils.showToast(tr('Требуется вход в Twitch'), 'error');
      
      // Показываем модальное окно с инструкцией
      const modal = document.createElement('div');
      modal.className = 'auth-modal';
      modal.innerHTML = `
        <div class="auth-modal-overlay"></div>
        <div class="auth-modal-content farm-login-dialog">
          <div class="auth-modal-header">
            <h3>${tr('Нужен вход в Twitch')}</h3>
          </div>
          <div class="auth-modal-body">
            <p class="farm-login-lead">
              ${tr('Для фарминга дропсов и баллов канала необходимо войти в Twitch через приложение.')}
            </p>
            <div class="farm-login-steps">
              <div class="section-label">${tr('Что нужно сделать')}</div>
              <ol>
                <li>${tr('Перейдите на вкладку "Аккаунты"')}</li>
                <li>${tr('Найдите свой аккаунт')}</li>
                <li>${tr('Нажмите кнопку "Войти в Twitch" (иконка Twitch)')}</li>
                <li>${tr('Войдите в аккаунт в открывшемся окне')}</li>
                <li>${tr('Нажмите "Проверить авторизацию"')}</li>
              </ol>
            </div>
            <div class="farm-login-actions">
              <button class="btn btn-secondary" id="close-modal">${tr('Закрыть')}</button>
              <button class="btn btn-primary" id="go-to-accounts">${tr('Перейти к аккаунтам')}</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      
      modal.querySelector('#go-to-accounts').addEventListener('click', () => {
        document.body.removeChild(modal);
        if (window.router) {
          window.router.navigate('accounts');
        }
      });
      
      modal.querySelector('#close-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      modal.querySelector('.auth-modal-overlay').addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      return;
    }

    window.utils.showToast(tr('Ищем стрим с дропсами...'), 'info');

    await this.refreshCategoryValues();
    if (!this.isStreamOperationCurrent(revision)) return;

    // Находим первую включенную категорию: приоритет ручных, затем по наличию дропсов и priority
    const enabledCategories = this.categories
      .filter(c => c.enabled !== false && !c.dropsCompleted)
      .sort((a, b) => {
        // Закреплённые проверяются на дропсы и фармятся в первую очередь
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        const aManual = a.autoDrops ? 1 : 0;
        const bManual = b.autoDrops ? 1 : 0;
        if (aManual !== bManual) return aManual - bManual;
        // Выгода: безнадёжные вниз, впереди та, где за час возьмём больше
        const byValue = this.compareCategoryValue(a, b);
        if (byValue !== 0) return byValue;

        const aNoDrops = a.hasDrops ? 0 : 1;
        const bNoDrops = b.hasDrops ? 0 : 1;
        if (aNoDrops !== bNoDrops) return aNoDrops - bNoDrops;
        return (a.priority || 0) - (b.priority || 0);
      })
      .filter(c => c.hasDrops); // стартуем по категории с дропсами
    
    if (enabledCategories.length === 0) {
      window.utils.showToast(tr('Нет активных категорий с дропсами'), 'warning');
      return;
    }
    
    // Идём по категориям по порядку, пока какая-нибудь не запустится.
    //
    // Раньше бралась ровно первая, и если у неё не было живых стримов,
    // запуск на этом заканчивался. Особенно обидно выходило с закреплённой
    // категорией: она идёт первой всегда, и когда дропсы в ней кончались,
    // «Начать фарминг» переставал делать хоть что-нибудь — остальные
    // категории даже не проверялись.
    const MAX_ATTEMPTS = 8;
    const attempts = enabledCategories.slice(0, MAX_ATTEMPTS);

    let category = null;
    let streams = [];
    const skipped = [];
    // Отдельно — категории, по которым Twitch не ответил: это не «стримов
    // нет», и пользователю надо видеть разницу
    const unanswered = [];

    // Каждый запрос со своим сроком: одна залипшая категория не должна
    // останавливать перебор остальных
    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);

    // Общий срок на весь перебор: восемь категорий по двенадцать секунд —
    // это полторы минуты, и всё это время кнопка выглядит занятой впустую
    const deadline = Date.now() + 45000;

    for (const candidate of attempts) {
      if (Date.now() > deadline) {
        console.warn('[Фарминг] Перебор затянулся, останавливаюсь');
        break;
      }

      let found = null;
      try {
        found = await withTimeout(window.electronAPI.getStreamsWithDrops(candidate.name), 12000);
      } catch (error) {
        found = null;
      }
      if (!this.isStreamOperationCurrent(revision)) return;
      if (!Array.isArray(found)) {
        console.warn('[Фарминг] Twitch не ответил по категории:', candidate.name);
        unanswered.push(candidate.name);
        continue;
      }
      if (found.length > 0) {
        category = candidate;
        streams = found;
        break;
      }
      skipped.push(candidate.name);
    }

    if (skipped.length > 0) {
      console.log('[Фарминг] Без живых стримов, пропущено:', skipped.join(', '));
    }
    if (enabledCategories.length > MAX_ATTEMPTS) {
      console.log('[Фарминг] Проверено', MAX_ATTEMPTS, 'категорий из', enabledCategories.length);
    }

    if (!category) {
      const list = (names) => `${names.slice(0, 3).join(', ')}${names.length > 3 ? ' ' + tr('и др.') : ''}`;
      const parts = [];
      if (skipped.length > 0) parts.push(tr('Нет стримов с дропсами: {list}', { list: list(skipped) }));
      if (unanswered.length > 0) parts.push(tr('Twitch не ответил по категориям: {list}', { list: list(unanswered) }));
      window.utils.showToast(parts.join('. ') || tr('Не нашлось стрима с дропсами'), 'warning');
      return;
    }
    
    // Выбираем первый стрим
    const stream = await this.pickPreferredStream(streams, category.name);
    if (!this.isStreamOperationCurrent(revision)) return;
    if (!stream?.login) {
      window.utils.showToast(tr('В категории {name} нет подходящего стрима', { name: category.name }), 'warning');
      return;
    }
    const streamUrl = `https://www.twitch.tv/${stream.login}`;
    
    console.log('Starting stream:', stream.displayName, streamUrl);
    window.utils.showToast(tr('Запуск стрима: {name}', { name: stream.displayName }), 'success');
    
    // Сохраняем текущую категорию и стрим
    this.currentCategory = category;
    this.currentStream = stream;
    this.resetCategoryCounters(category);

    // Новую сессию начинает SessionState.start(): только он заводит таймер
    // автовыключения и сбрасывает качество плеера. Раньше здесь стояло
    // присваивание sessionStartTime, которое шло через restore(), и
    // выключение по таймеру не срабатывало никогда. До загрузки плеера —
    // чтобы сброс качества успел к ней.
    const newSession = !!window.sessionState && !window.sessionState.isActive();
    if (newSession) {
      window.sessionState.start({ categoryName: category.name, streamLogin: stream.login });
      window.eventLog?.add({ type: 'start', title: tr('Фарминг запущен'), detail: category.name });
    }

    // Открываем стрим в фоновом окне с аккаунтом
    await window.electronAPI.openStream(streamUrl, accounts[0]);
    if (!this.isStreamOperationCurrent(revision)) return;
    
    // Обновляем UI текущего стрима
    this.updateCurrentStreamUI(stream, category);
    
    // Обновляем кнопки в сайдбаре с плавной анимацией
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    if (startBtn) {
      startBtn.style.opacity = '0';
      startBtn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        startBtn.style.display = 'none';
        if (stopBtn) {
          stopBtn.style.display = 'flex';
          setTimeout(() => {
            stopBtn.style.opacity = '1';
            stopBtn.style.transform = 'scale(1)';
          }, 10);
        }
      }, 200);
    }
    
    // Показываем информацию о сессии с анимацией
    const sessionInfo = document.getElementById('farming-session-info');
    if (sessionInfo) {
      sessionInfo.style.display = 'block';
      sessionInfo.style.opacity = '0';
      sessionInfo.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        sessionInfo.style.opacity = '1';
        sessionInfo.style.transform = 'translateY(0)';
      }, 10);
    }
    
    // Запускаем трекинг сессии. Трафик и баллы новой сессии уже обнулил
    // SessionState.start(); здесь — то, что живёт на странице
    this.categoryStartTime = Date.now();
    if (newSession) {
      this.estimatedBandwidth = 0;
      this.bandwidthHistory = [];
      this._sessionDropsBaseline = null;
      this._sessionCountedDrops = null;
      this._sessionSeenCampaigns = null;
    }
    this.updateSessionInfo();

    // Mark global farming active for other modules (e.g., mini-player)
    if (window.streamingManager) {
      try { window.streamingManager.isFarming = true; } catch (e) {}
    }
    
    // Очищаем старый интервал если он существует
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    
    // Без requestAnimationFrame: в свёрнутом в трей окне он не срабатывает
    // вовсе, и трафик за ночь в итог сессии не попадал. Отрисовки здесь
    // больше нет — только учёт.
    this.sessionInterval = setInterval(() => {
      this.updateSessionInfo();
    }, 1000);

    // Запускаем периодическое обновление статистики (раз в минуту, см. LIVE_STATS_MS)
    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
    }
    this.statsUpdateInterval = setInterval(() => {
      this.updateLiveStatistics();
    }, FarmingPage.LIVE_STATS_MS);

    // Создаем начальную сессию в статистике
    this.updateLiveStatistics();

    // Сохраняем активную сессию для восстановления
    await this.saveActiveSession(stream, category);
    if (!this.isStreamOperationCurrent(revision)) return;
    
    // Загружаем и отображаем дропсы
    this.loadAndDisplayDrops(stream.login, category.name);
    
    // Показываем блок баллов
    const pointsCard = document.getElementById('channel-points-card');
    if (pointsCard) {
      pointsCard.style.display = 'block';
    }
    
    // Запускаем автосбор бонусов в фоне
    this.startBackgroundBonusCollector(stream.login);
    
    // Обновляем мини-плеер в сайдбаре если пользователь не на странице фарминга
    if (window.router && typeof window.router.manageMiniPlayer === 'function') {
      window.router.manageMiniPlayer(window.router.currentPage);
    }
  }

  async loadAndDisplayDrops(channelLogin, gameName) {
    try {
      console.log('Loading drops for', channelLogin, gameName);
      
      // Показываем простое уведомление о дропсах
      const container = document.getElementById('drops-progress-container');
      const listEl = document.getElementById('drops-campaigns-list');
      
      if (!container || !listEl) {
        console.log('Drops container not found');
        return;
      }
      
      // Старый контейнер скрываем — используется новый горизонтальный блок прогресса
      container.style.display = 'none';
      listEl.innerHTML = '';
    } catch (error) {
      console.error('Error loading drops:', error);
      this.hideDropsContainer();
    }
  }

  displayDropsCampaigns(campaigns, progress) {
    const container = document.getElementById('drops-progress-container');
    const listEl = document.getElementById('drops-campaigns-list');
    
    if (!container || !listEl) return;
    
    // Показываем контейнер
    container.style.display = 'block';
    
    // Отображаем кампании
    listEl.innerHTML = campaigns.map(campaign => {
      const totalDrops = campaign.drops.length;
      const completedDrops = campaign.drops.filter(d => d.progress >= 100).length;
      
      // Русское в разметке ниже, кроме tr(), — только HTML-комментарий
      return /* i18n-ignore */ `
        <div style="margin-bottom: 16px; padding: 16px; background: var(--bg-primary); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          <div style="display: flex; gap: 12px; margin-bottom: 12px;">
            <img src="${this.esc(campaign.imageUrl)}" 
                 alt="${this.esc(campaign.name)}" 
                 style="width: 60px; height: 80px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0;"
                 onerror="this.style.display='none'">
            <div style="flex: 1;">
              <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${this.esc(campaign.name)}</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">${this.esc(campaign.game)}</div>
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <span style="font-size: 12px; padding: 4px 8px; background: ${campaign.isActive ? 'rgba(53, 208, 138, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${campaign.isActive ? '#35d08a' : '#ef4444'}; border-radius: var(--radius-sm); font-weight: 600;">
                  ${campaign.isActive ? tr('Активно') : tr('Завершено')}
                </span>
                ${campaign.isActive ? `
                  <span style="font-size: 12px; color: var(--text-secondary);">
                    ${campaign.daysRemaining > 0
                      ? tr('{days}д {hours}ч до конца', { days: campaign.daysRemaining, hours: campaign.hoursRemaining % 24 })
                      : tr('{hours}ч до конца', { hours: campaign.hoursRemaining % 24 })}
                  </span>
                ` : ''}
              </div>
            </div>
          </div>
          
          <!-- Список дропсов -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${campaign.drops.map((drop, idx) => {
              const dropData = encodeURIComponent(JSON.stringify(drop));
              const campaignData = encodeURIComponent(JSON.stringify({
                name: campaign.name,
                game: campaign.game,
                imageUrl: campaign.imageUrl,
                startDate: campaign.startDate,
                endDate: campaign.endDate
              }));
              
              return `
              <div class="drop-card-clickable" 
                   data-drop="${dropData}" 
                   data-campaign="${campaignData}"
                   style="display: flex; gap: 12px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-sm); align-items: center; cursor: pointer; transition: all 0.2s ease;"
                   onmouseover="this.style.background='rgba(124, 92, 255, 0.1)'; this.style.transform='translateX(4px)'"
                   onmouseout="this.style.background='var(--bg-secondary)'; this.style.transform='translateX(0)'">
                ${drop.imageUrl ? `
                  <img src="${this.esc(drop.imageUrl)}" 
                       alt="${this.esc(drop.name)}" 
                       style="width: 48px; height: 48px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0;">
                ` : ''}
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${this.esc(drop.name)}</div>
                  <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">
                    ${tr('Смотреть {minutes} мин', { minutes: this.esc(drop.requiredMinutes) })}
                  </div>
                  <div style="height: 6px; background: var(--bg-primary); border-radius: var(--radius-sm); overflow: hidden;">
                    <div style="height: 100%; width: ${drop.progress || 0}%; background: var(--accent-color); transition: width 0.5s ease;"></div>
                  </div>
                </div>
                <div style="font-size: 14px; font-weight: 700; color: ${drop.progress >= 100 ? 'var(--success-color)' : 'var(--accent-color)'}; min-width: 45px; text-align: right;">
                  ${Math.round(drop.progress || 0)}%
                </div>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
    
    // Обновляем общий прогресс
    const totalDrops = campaigns.reduce((sum, c) => sum + c.drops.length, 0);
    const completedDrops = campaigns.reduce((sum, c) => sum + c.drops.filter(d => d.progress >= 100).length, 0);
    
    const overallEl = document.getElementById('drops-overall-progress');
    if (overallEl) {
      overallEl.textContent = tr('{done} / {total} получено', { done: completedDrops, total: totalDrops });
    }
  }

  hideDropsContainer() {
    const container = document.getElementById('drops-progress-container');
    if (container) {
      container.style.display = 'none';
    }
  }

  /**
   * Приводит название игры к виду, пригодному для сравнения.
   * Twitch в разных запросах отдаёт то displayName, то name, плюс различаются
   * регистр, апострофы, тире и лишние пробелы — из-за этого точное сравнение
   * регулярно промахивалось и дропсы выглядели как отсутствующие.
   */
  /** Логика вынесена в StreamPicker, метод оставлен ради мест вызова. */
  normalizeGameName(name) {
    return window.StreamPicker.normalizeGameName(name);
  }

  /**
   * Все активные кампании для указанной игры.
   * Раньше здесь стоял find() и бралась только первая кампания — если у игры
   * их несколько (например, две компании со своими наборами наград),
   * вторая просто не отображалась.
   *
   * Сравнение строгое — то же правило, что в выборе стрима и в проверке
   * смены игры: по id игры, если он известен с обеих сторон, иначе по
   * точному названию. Раньше при отсутствии точного совпадения брались
   * кампании, чьё название начинается так же: у «World of Tanks» без
   * своей кампании находилась кампания «World of Tanks Console», и
   * категория фармилась впустую.
   */
  matchCampaignsForGame(campaigns, gameName, gameId) {
    if (!this.normalizeGameName(gameName) || !Array.isArray(campaigns)) return [];

    return campaigns.filter(c => window.StreamPicker.isExactGame(
      c?.game?.displayName || c?.game?.name || c?.game,
      gameName,
      c?.game?.id || c?.gameId,
      gameId
    ));
  }

  /** Дроп считается выполненным, если получен или уже доступен к получению. */
  isDropEarned(drop) {
    return !!(
      drop.claimed ||
      drop.canClaim ||
      drop.isClaimable ||
      drop.claimable ||
      drop.isUnlocked ||
      (drop.required > 0 && drop.progress >= drop.required)
    );
  }

  /** Человекочитаемый остаток времени кампании. */
  formatCampaignTimeLeft(endsAt) {
    if (!endsAt) return '';

    const diff = new Date(endsAt) - new Date();
    if (diff <= 0) return tr('Завершена');

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    // Единицы через пробел: «3 д 4 ч», а не «3д 4ч»
    if (days > 0) return hours > 0 ? tr('{days} д {hours} ч', { days, hours }) : tr('{days} д', { days });
    if (hours > 0) return minutes > 0 ? tr('{hours} ч {minutes} мин', { hours, minutes }) : tr('{hours} ч', { hours });
    return tr('{minutes} мин', { minutes });
  }

  /**
   * Карточка одной награды: картинка 48, процент (или галочка), название
   * в две строки, тонкая полоса и «95 / 120 мин · ещё 25 мин».
   *
   * Раньше карточка была 220px высотой, с фиолетовой заливкой, тенью при
   * наведении и вечной пульсацией — четыре такие подряд перетягивали
   * внимание со всего экрана. Классы drop-progress-card, drop-card-clickable
   * и data-drop/data-campaign прежние: по ним открывается окно награды.
   */
  renderDropCard(drop, campaign, gameName) {
    const isCompleted = this.isDropEarned(drop);
    const dropPercent = isCompleted
      ? 100
      : (drop.required > 0 ? Math.min(100, Math.floor((drop.progress / drop.required) * 100)) : 0);
    const remaining = Math.max(0, (Number(drop.required) || 0) - (Number(drop.progress) || 0));
    const dropName = drop.benefitName || drop.name || tr('Награда');
    const icon = (name, size) => window.Icons?.get(name, size) ?? '';

    const dropData = encodeURIComponent(JSON.stringify({
      name: dropName,
      imageUrl: drop.imageURL || '',
      requiredMinutes: drop.required || 0,
      progress: dropPercent,
      benefitEdges: drop.benefitEdges || []
    }));

    const campaignData = encodeURIComponent(JSON.stringify({
      name: campaign.name || gameName,
      game: campaign.game?.displayName || campaign.game?.name || gameName,
      imageUrl: campaign.game?.boxArtURL || '',
      startDate: campaign.startAt || '',
      endDate: campaign.endsAt || campaign.endAt || ''
    }));

    const art = drop.imageURL
      ? `<img class="drop-tile-art" src="${this.esc(drop.imageURL)}" alt="" onerror="this.onerror=null;this.src=window.DROP_PLACEHOLDER||'';">`
      : `<div class="drop-tile-art is-empty" aria-hidden="true">${icon('gift', 22)}</div>`;

    // Полученная и только набравшая время — разные состояния: вторую
    // автосбор ещё забирает. У незаконченной — сколько осталось; точные
    // минуты «95 из 120» — в подсказке карточки: в узкую плитку обе
    // подписи не помещались и обрезались
    const notWatchable = !isCompleted && !(Number(drop.required) > 0);
    const meta = notWatchable
      ? `<span>${tr('Не за просмотр')}</span>`
      : isCompleted
      ? `<span>${drop.claimed ? tr('Получено') : tr('Можно забрать')}</span>`
      : (remaining > 0
        ? `<span>${tr('ещё {time}', { time: this.esc(this.formatMinutes(remaining)) })}</span>`
        : `<span>${tr('{progress} / {required} мин', { progress: this.esc(drop.progress), required: this.esc(drop.required) })}</span>`);
    const tip = notWatchable
      ? tr('{name} — выдаётся за подписку или другое условие, просмотром не получить', { name: dropName })
      : isCompleted
      ? dropName
      : tr('{name} — {progress} из {required} мин', { name: dropName, progress: Number(drop.progress) || 0, required: Number(drop.required) || 0 });

    return `
      <div class="drop-progress-card drop-card-clickable${isCompleted ? ' is-earned' : ''}"
           data-drop="${dropData}"
           data-campaign="${campaignData}"
           role="button" tabindex="0" title="${this.esc(tip)}">
        <div class="drop-tile-top">
          ${art}
          ${isCompleted
            ? `<span class="drop-tile-check" aria-label="${tr('Получено')}">${icon('check-circle', 16)}</span>`
            : `<span class="drop-tile-pct">${dropPercent}%</span>`}
        </div>
        <div class="drop-tile-name">${this.esc(dropName)}</div>
        <div class="progress progress-sm${isCompleted ? ' is-complete' : ''}" aria-hidden="true">
          <div class="progress-fill" style="width: ${dropPercent}%"></div>
        </div>
        <div class="drop-tile-meta">${meta}</div>
      </div>
    `;
  }

  /** Блок одной кампании: заголовок (если кампаний несколько) и сетка наград. */
  renderCampaignSection(campaign, gameName, showHeader) {
    const drops = campaign.drops || [];
    const total = drops.length;

    let sum = 0;
    drops.forEach(drop => {
      const raw = drop.required > 0 ? Math.floor((drop.progress / drop.required) * 100) : 0;
      sum += this.isDropEarned(drop) ? 100 : Math.min(100, raw);
    });

    const percent = total > 0 ? Math.floor(sum / total) : 0;
    const completed = drops.filter(d => this.isDropEarned(d)).length;
    const timeLeft = this.formatCampaignTimeLeft(campaign.endsAt || campaign.endAt);
    const campaignTitle = campaign.name || gameName;
    const notStarted = campaign.inProgress === false;

    // Заголовок кампании показываем только когда кампаний несколько —
    // иначе он дублировал бы общий заголовок блока. Строка, а не плашка
    const header = showHeader ? `
      <div class="drops-panel-campaign">
        ${campaign.game?.boxArtURL ? `<img class="drops-panel-campaign-art" src="${this.esc(campaign.game.boxArtURL)}" alt="">` : ''}
        <span class="drops-panel-campaign-name" title="${this.esc(campaignTitle)}">${this.esc(campaignTitle)}</span>
        ${notStarted ? `<span class="badge badge-warning">${tr('Не начата')}</span>` : ''}
        <span class="drops-panel-campaign-meta">${[timeLeft, tr('{done} из {total}', { done: completed, total })].filter(Boolean).map(part => this.esc(part)).join(' · ')}</span>
      </div>
    ` : '';

    return {
      percent,
      total,
      completed,
      html: `
        <div class="drops-campaign-section">
          ${header}
          <div class="drop-tiles">
            ${drops.map(drop => this.renderDropCard(drop, campaign, gameName)).join('')}
          </div>
        </div>
      `
    };
  }

  /**
   * Разметка панели «Награды кампании» — чистая функция от списка кампаний
   * игры: ничего не пишет и ничего не решает. Её зовёт
   * updateDropsHorizontalProgress (там же — все проверки и переключения),
   * а снимки экрана получают тот же вид без сети.
   *
   * Вид нейтральный: заголовок с остатком срока и общим процентом, полоса,
   * прогноз строкой, сетка карточек и подпись внизу. Цвет — только у
   * заливки полосы и у слов «собрано/не успеть».
   */
  renderDropsPanel(matched, gameName) {
    const campaigns = Array.isArray(matched) ? matched : [];
    const icon = (name, size) => window.Icons?.get(name, size) ?? '';

    const showCampaignHeaders = campaigns.length > 1;
    const sections = campaigns.map(c => this.renderCampaignSection(c, gameName, showCampaignHeaders));
    const totalDrops = sections.reduce((sum, s) => sum + s.total, 0);
    const completedDrops = sections.reduce((sum, s) => sum + s.completed, 0);

    // То же число, что в сайдбаре и в списке категорий (CampaignValue)
    const overallPercent = window.CampaignValue?.progressPercent
      ? window.CampaignValue.progressPercent(campaigns)
      : (totalDrops > 0 ? Math.floor(completedDrops / totalDrops * 100) : 0);
    const pendingClaim = overallPercent === 100 && this.hasPendingClaims(campaigns);
    const allDone = overallPercent === 100 && !pendingClaim;

    // Ближайшее окончание среди кампаний; меньше суток — янтарным
    const soonestEnd = campaigns
      .map(c => c.endsAt || c.endAt)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0];
    const timeRemaining = this.formatCampaignTimeLeft(soonestEnd);
    const endingSoon = !!soonestEnd && new Date(soonestEnd).getTime() - Date.now() < 24 * 60 * 60 * 1000;

    const countBadge = campaigns.length > 1
      ? `<span class="badge">${campaigns.length} ${this.plural(campaigns.length, 'кампания', 'кампании', 'кампаний')}</span>`
      : '';

    const foot = allDone
      ? `<div class="drops-done">
           ${icon('check-circle', 16)}
           <span class="drops-done-text">${tr('Все награды кампании получены')}</span>
           <div class="drops-done-actions" id="drops-done-actions"></div>
         </div>`
      : pendingClaim
        ? tr('Награда готова — забираю')
        // «1 из 4 наград получено» вместо «1/4 Дропсов получено»
        : tr('{done} из {total} {word} получено', {
          done: completedDrops, total: totalDrops, word: this.plural(totalDrops, 'награды', 'наград', 'наград')
        });

    return `
      <div class="drops-panel">
        <div class="drops-panel-head">
          <div class="card-title">${tr('Награды кампании')} ${countBadge}</div>
          <div class="drops-panel-meta">
            ${timeRemaining ? `<span class="${endingSoon ? 'tone-warn' : ''}" title="${tr('До конца кампании')}">${tr('до конца {time}', { time: this.esc(timeRemaining) })}</span>` : ''}
            <span class="drops-panel-pct">${overallPercent}%</span>
          </div>
        </div>
        <div class="progress progress-lg${overallPercent === 100 ? ' is-complete' : ''}" role="progressbar" aria-label="${tr('Прогресс кампании')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${overallPercent}">
          <div class="progress-fill" style="width: ${overallPercent}%"></div>
        </div>
        ${this.buildForecastMarkup(campaigns)}
        ${sections.map(s => s.html).join('')}
        <div id="drops-received-footer" class="drops-panel-foot${pendingClaim ? ' is-pending' : ''}">${foot}</div>
      </div>
    `;
  }

  /**
   * «Следующая награда» в колонке рядом с плеером: картинка, название,
   * «через 25 мин · к 03:40» и процент. Без кампании (null) блок прячется.
   * Ответ на главный вопрос экрана — когда награда, — без прокрутки.
   */
  updateNextReward(matched) {
    const box = document.getElementById('farm-next-reward');
    if (!box) return;

    const CV = window.CampaignValue;
    const next = (Array.isArray(matched) && matched.length && CV) ? CV.nextDrop(matched) : null;
    if (!next) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    const drop = next.drop;
    const name = drop.benefitName || drop.name || tr('Награда');
    const required = Number(drop.required) || 0;
    const progress = Number(drop.progress) || 0;
    const percent = required > 0 ? Math.min(100, Math.floor(progress / required * 100)) : 0;
    const left = Math.max(0, Math.ceil(next.minutesNeeded));
    // В английском — «8:05 PM» без ведущего нуля, в русском — «08:05», как было
    const clock = new Date(Date.now() + left * 60000)
      .toLocaleTimeString(tr.locale(), { hour: tr.lang() === 'en' ? 'numeric' : '2-digit', minute: '2-digit' });
    const image = drop.imageURL || drop.image || '';
    const icon = (n, size) => window.Icons?.get(n, size) ?? '';

    box.innerHTML = `
      ${image
        ? `<img class="farm-next-art" src="${this.esc(image)}" alt="" onerror="this.onerror=null;this.src=window.DROP_PLACEHOLDER||'';">`
        : `<div class="farm-next-art is-empty" aria-hidden="true">${icon('gift', 20)}</div>`}
      <div class="farm-next-name" title="${this.esc(name)}">${this.esc(name)}</div>
      <div class="farm-next-pct">${percent}%</div>
      <div class="farm-next-when${left > 0 ? '' : ' is-ready'}">${left > 0
        ? tr('Следующая награда через {time} · к {clock}', { time: this.esc(this.formatMinutes(left)), clock: this.esc(clock) })
        : tr('Время набрано — награду забирает автосбор')}</div>
      <div class="progress progress-sm" aria-hidden="true"><div class="progress-fill" style="width: ${percent}%"></div></div>
    `;
    box.setAttribute('aria-label', tr('Следующая награда: {name}, {percent}%', { name, percent }));
    box.hidden = false;
  }

  async updateDropsHorizontalProgress() {
    const snapshot = this.streamSnapshot();
    const i18n = this.i18n;

    try {
      // Определяем название игры для текущей кампании
      let currentGameName = (this.currentCategory && this.currentCategory.name) ? this.currentCategory.name : '';
      if (!currentGameName) {
        const gameEl = document.getElementById('stream-game');
        if (gameEl && gameEl.textContent) {
          currentGameName = gameEl.textContent.replace(/^\s*Игра:\s*/i, '').trim();
        }
      }
      if (!currentGameName) {
        // Сессия идёт, но страница ещё не знает, что фармит — например,
        // только что вернулись на вкладку. Это незнание, а не отсутствие
        // дропсов: считать его пропуском нельзя, иначе через три круга
        // приложение сменит категорию на ровном месте.
        if (this.sessionStartTime) {
          console.log('[Дропсы] Категория ещё не восстановлена — проверку пропускаю');
          return { hasDrops: true, unknown: true };
        }
        return { hasDrops: false };
      }

      const result = await window.electronAPI.fetchDropsInventory();
      if (!this.isCurrentStream(snapshot)) return { hasDrops: true, unknown: true };

      // Пустой ответ без кампаний вообще — это незнание, а не «дропсов нет»:
      // нет cookie-токена, пауза после 429, обрыв сети, ошибка разбора.
      // Однажды на таком ответе приложение за две минуты удалило две
      // категории и выключило третью — при живых кампаниях у всех трёх.
      if (!result || !result.campaigns || result.error || result.rateLimited || result.needsStream || result.campaigns.length === 0) {
        console.log('[Дропсы] Инвентарь недоступен — проверку пропускаю:',
          result?.needsStream ? 'нет cookie-токена' : (result?.rateLimited ? 'пауза Twitch' : (result?.error ? 'ошибка запроса' : 'пустой ответ')));
        return { hasDrops: true, unknown: true };
      }

      // ВСЕ кампании этой игры, а не только первая найденная
      const matched = this.matchCampaignsForGame(result.campaigns, currentGameName,
        this.currentCategory?.name === currentGameName ? this.currentCategory?.id : undefined)
        .filter(c => Array.isArray(c.drops) && c.drops.length > 0);
      this._lastMatchedCount = matched.length;

      // Инвентарь без dashboard знает только НАЧАТЫЕ кампании. Новая,
      // ещё не начатая кампания игры в нём не видна — это незнание, а не
      // «дропсов нет». Раньше на таком ответе в первые минуты после
      // запуска категории с новыми кампаниями выключались и удалялись.
      if (matched.length === 0 && result.dashboardComplete === false) {
        console.log('[Дропсы] Список кампаний неполный (нет dashboard) — проверку пропускаю');
        return { hasDrops: true, unknown: true };
      }

      const horizontal = document.getElementById('drops-progress-horizontal');
      if (!horizontal) return { hasDrops: false };

      if (matched.length === 0) {
        // Одной пустой выборки мало: Twitch отвечает неровно, и на один
        // сбойный ответ панель исчезала целиком, а через полминуты
        // возвращалась. Прячем только когда кампаний нет несколько
        // проверок подряд — тем же порогом, по которому меняется
        // категория, чтобы панель не пропадала раньше времени.
        //
        // Терпимость — только к своей категории. Панель с прогрессом
        // прошлой игры (или «Загрузка…» после смены) прячем сразу
        this._emptyDropsChecks = (this._emptyDropsChecks || 0) + 1;
        const ownPanel = !!this.currentCategory &&
          horizontal.dataset.categoryId === String(this.currentCategory.id);

        if (this._emptyDropsChecks >= 3 || !ownPanel) {
          horizontal.style.display = 'none';
          // Блок в сайдбаре живёт, пока у категории есть кампания
          this.hideMiniDropsProgress();
          this.updateNextReward(null);
        } else {
          console.log('[Дропсы] Пустой ответ', this._emptyDropsChecks,
            'из 3 — панель оставляю как есть');
        }

        return { hasDrops: false };
      }

      this._emptyDropsChecks = 0;

      console.log('[Drops] Кампаний для', currentGameName + ':', matched.length,
        matched.map(c => c.name).join(' | '));

      this.trackSessionDrops(matched);
      this.warnAboutEndingCampaigns(matched);
      await this.autoClaimReadyDrops(matched);
      if (!this.isCurrentStream(snapshot)) return { hasDrops: true, unknown: true };

      // Порядок важен: сначала забираем готовые награды, потом решаем,
      // осталось ли ради чего смотреть дальше
      // Пополняем память кампаний прямо во время фарминга: тогда календарь
      // будет полным, даже если его ни разу не открывали при живом стриме
      window.CampaignHistory?.remember(result.campaigns)
        .catch(e => console.warn('[Дропсы] Память кампаний:', e?.message));

      this.updateCategoryValues(result.campaigns);
      this.renderCategorySuggestion(result.campaigns);
      await this.checkCategoryStillWorthwhile(matched);
      if (!this.isCurrentStream(snapshot)) return { hasDrops: true, unknown: true };

      horizontal.style.display = 'block';

      // Единое число для панели, сайдбара и списка категорий. Раньше здесь
      // считалось среднее по наградам, а сайдбар — по времени просмотра, и
      // под одним названием «дропсы» показывались разные проценты: 63
      // против 29. Считает CampaignValue, чтобы определение было одно.
      const overallPercent = window.CampaignValue.progressPercent(matched);
      // Время набрано, но готовую награду ещё не удалось забрать — это не
      // «всё получено»: раньше категорию в этот момент бросали, и
      // незабранная награда могла сгореть
      const pendingClaim = overallPercent === 100 && this.hasPendingClaims(matched);
      const allDone = overallPercent === 100 && !pendingClaim;

      // Ближайшее время окончания среди всех кампаний
      const soonestEnd = matched
        .map(c => c.endsAt || c.endAt)
        .filter(Boolean)
        .sort((a, b) => new Date(a) - new Date(b))[0];

      // Чей прогресс на панели — по этой отметке смена категории понимает,
      // что показанное устарело (resetDropsViewForCategory)
      if (this.currentCategory) horizontal.dataset.categoryId = String(this.currentCategory.id);
      else delete horizontal.dataset.categoryId;

      // Разметку собирает чистый renderDropsPanel: те же правила «получено /
      // забираю / всё собрано», что считаются здесь. Тестовое уведомление
      // по-прежнему только Shift+клик по подвалу в режиме разработчика
      horizontal.innerHTML = this.renderDropsPanel(matched, currentGameName);
      // Ближайшая награда — ещё и в колонке рядом с плеером, на первом экране
      this.updateNextReward(matched);

      // Место под кнопку перехода теперь есть в разметке выше. Раньше его
      // не было, и кнопка «Перейти к …» не появлялась никогда
      if (allDone) {
        this.renderNextCategoryAction();
      }

      // Обработчик для тестирования уведомлений (DevMode + Shift + Click)
      setTimeout(() => {
        const footer = document.getElementById('drops-received-footer');
        if (footer && overallPercent < 100) {
          footer.addEventListener('click', (e) => {
            if (!e.shiftKey) return;

            let isDeveloperMode = false;
            try {
              const savedSettings = localStorage.getItem('app_settings');
              if (savedSettings) {
                isDeveloperMode = JSON.parse(savedSettings).developerMode === true;
              }
            } catch (err) {
              console.error('[DropsProgress] Failed to read settings:', err);
            }

            if (isDeveloperMode) {
              window.showDropNotification(
                '8x 250 Lucky Envelopes',
                'Palia',
                'https://static-cdn.jtvnw.net/ttv-boxart/1239948690_IGDB-285x380.jpg'
              );
              window.utils.showToast(tr('Тестовое уведомление отправлено'), 'info');
            } else {
              window.utils.showToast(tr('Включите "Режим разработчика" в настройках'), 'warning');
            }
          });
        }
      }, 200);

      // Обновляем статус категории
      if (this.currentCategory) {
        this.currentCategory.dropsCompleted = allDone;
        this.currentCategory.dropsProgressPercent = overallPercent;
        this.currentCategory.dropsEndsAt = soonestEnd;
        // Идентификаторы кампаний нужны, чтобы отличить «та же кампания
        // всё ещё идёт» от «началась новая»
        this.currentCategory.dropsCampaignIds = matched.map(c => c.id).filter(Boolean).sort().join(',');
        await this.saveCategories();
        this.renderCategories();

        // Сайдбарная шкала идёт по времени просмотра, чтобы деления
        // совпадали с рубежами выдачи наград
        const timeline = this.updateSidebarDropsDetail(matched);
        this.updateMiniDropsProgress(overallPercent);
        this.updateTrayStatus(matched, timeline);

        // Если все дропсы получены - сразу переключаемся.
        //
        // Отметка «уже переключаемся» живёт на странице, а не в категории:
        // поле в объекте уходило в хранилище вместе со списком и переживало
        // новую кампанию — по её завершении категорию уже никто не
        // переключал
        if (!this._switchScheduledIds) this._switchScheduledIds = new Set();
        const switchScheduled = this._switchScheduledIds;
        if (allDone && !switchScheduled.has(this.currentCategory.id)) {
          if (this.isSingleManualPlayLocked()) {
            console.log('[ManualPlayLock] Drops completed, keeping category enabled');
            return { hasDrops: true, overallPercent };
          }

          // Категорию, запущенную вручную, приложение само не выключает и
          // не меняет — как и при «дропсов нет». Раньше этот путь обходил
          // защиту: при нескольких включённых категориях ручную выключало
          // и уводило в другую. Под шкалой уже есть кнопка «Перейти к …»,
          // а в сайдбаре — «Перейти к автоматике».
          if (this.isManualCategoryActive()) {
            if (this._manualDoneShownFor !== this.currentCategory.id) {
              this._manualDoneShownFor = this.currentCategory.id;
              console.log('[Ручной запуск] Все награды получены, категорию не меняем:', this.currentCategory.name);
              window.utils?.showToast(
                tr('«{name}»: все награды получены. Категория запущена вручную — переключите, когда захотите', { name: this.currentCategory.name }),
                'success'
              );
            }
            return { hasDrops: true, overallPercent };
          }
          // Отметка ручного запуска относится к другой категории — она
          // больше ничего не защищает
          this.manualCategoryId = null;

          const completedCategory = this.currentCategory;
          switchScheduled.add(completedCategory.id);

          // Время категории — до того, как она перестанет быть текущей:
          // следующая смена уже не знает, откуда ушла
          try {
            await this.noteCategoryWatchTime();
          } finally {
            // Отметка нужна лишь на время этого ожидания: дальше категория
            // либо удалена, либо выключена и перестала быть текущей
            switchScheduled.delete(completedCategory.id);
          }
          if (!this.isCurrentStream(snapshot) || this.currentCategory !== completedCategory) {
            return { hasDrops: true, overallPercent };
          }

          // Авто-категории удаляем СРАЗУ после завершения
          if (this.currentCategory.autoDrops) {
            console.log('Auto-category completed, removing:', this.currentCategory.name);
            const categoryId = this.currentCategory.id;
            this.categories = this.categories.filter(c => c.id !== categoryId);
            this.currentCategory = null;
            await this.saveCategories();
            this.renderCategories();
          } else {
            // Пользовательские категории отключаем вместо удаления.
            // Помечаем, что выключило приложение, а не пользователь: когда
            // у игры начнётся новая кампания, такую категорию можно вернуть
            // в работу автоматически, а выключенную вручную — нельзя.
            console.log('Category completed, disabling:', this.currentCategory.name);
            this.currentCategory.enabled = false;
            this.currentCategory.disabledByCompletion = true;
            this.currentCategory = null;
            await this.saveCategories();
            this.renderCategories();
          }

          // Переключаемся на следующую категорию
          const completedSnapshot = this.streamSnapshot();
          setTimeout(() => {
            if (this.isCurrentStream(completedSnapshot)) this.switchToNextEnabledCategory({ reason: 'done' });
          }, 2000);
        }
      }

      return { hasDrops: true, overallPercent };
    } catch (error) {
      console.error('Error updating drops horizontal progress:', error);
    }
  }

  /**
   * Предложение переключиться, когда в вручную запущенной категории нет дропсов.
   *
   * Показывается на месте блока прогресса дропсов — там, где пользователь и
   * ожидает увидеть их состояние. Решение остаётся за ним: приложение не
   * трогает категорию, которую он выбрал сам.
   */
  showSwitchOffer(reason = '', detail = '') {
    // Своё место под панелью дропсов: панель перерисовывается каждые
    // полминуты и стирала предложение сразу же
    const container = document.getElementById('switch-offer-slot') ||
      document.getElementById('drops-progress-horizontal');
    if (!container) return;

    // Пользователь уже ответил «Остаться» на это же предложение в этой же
    // категории. Раньше плашка возвращалась каждые полторы минуты весь
    // сеанс. Отказ забывается при смене категории и появлении дропсов
    const offerCategoryId = this.currentCategory?.id || null;
    const dismissed = this._offerDismissed;
    if (dismissed && dismissed.categoryId === offerCategoryId && dismissed.reason === reason) return;

    const candidate = this.categories.find(cat =>
      cat.enabled !== false &&
      cat.hasDrops &&
      !cat.dropsCompleted &&
      cat.id !== this.currentCategory?.id
    );

    const categoryName = this.currentCategory?.name || '';
    this._switchOfferCategoryId = this.currentCategory?.id || null;

    // Причина — настоящая. Раньше предложение всегда говорило «дропсов
    // нет», даже когда стример ушёл в другую игру или кампания отработана
    const name = categoryName;
    const titles = {
      noDrops: tr('В категории «{name}» дропсов нет', { name }),
      offline: tr('Стрим в «{name}» закончился', { name }),
      gameChanged: tr('Стример ушёл из «{name}» в другую игру', { name }),
      noCredit: tr('Канал в «{name}» не засчитывает дропсы', { name }),
      done: tr('«{name}»: {detail}', { name, detail: detail || tr('кампания отработана') })
    };
    const title = titles[reason] || tr('В «{name}» сейчас брать нечего', { name });

    // Нейтральная строка с одной главной кнопкой («Перейти»); значок
    // предупреждения — единственный цветной элемент
    container.style.display = 'block';
    container.innerHTML = `
      <div class="switch-offer" role="status">
        <div class="switch-offer-text">
          <div class="switch-offer-title">${window.Icons?.get('info', 16) ?? ''}<span>${this.esc(title)}</span></div>
          <div class="switch-offer-sub">
            ${candidate
              ? tr('Категория запущена вручную, поэтому сами её не переключаем. Дропсы есть в «{name}».', { name: this.esc(candidate.name) })
              : tr('Категория запущена вручную и останется активной. Других категорий с дропсами сейчас нет.')}
          </div>
        </div>
        <div class="switch-offer-actions">
          <button class="btn btn-secondary btn-sm" id="switch-offer-stay">${candidate ? tr('Остаться') : tr('Понятно')}</button>
          ${candidate ? `
            <button class="btn btn-primary btn-sm" id="switch-offer-go" data-category-id="${this.esc(candidate.id)}">
              ${tr('Перейти в «{name}»', { name: this.esc(candidate.name) })}
            </button>
          ` : ''}
        </div>
      </div>
    `;

    const stay = container.querySelector('#switch-offer-stay');
    if (stay) {
      stay.addEventListener('click', () => {
        container.innerHTML = '';
        container.style.display = 'none';
        this.hideSwitchOffer();
        this._offerDismissed = { categoryId: offerCategoryId, reason };
      });
    }

    const go = container.querySelector('#switch-offer-go');
    if (go) {
      go.addEventListener('click', async () => {
        const target = this.categories.find(cat => cat.id === go.dataset.categoryId);
        if (!target) return;

        // Пользователь согласился — отметку ручного запуска снимаем
        this.manualCategoryId = null;
        this.manualPlayLockCategoryId = null;
        container.innerHTML = '';
        container.style.display = 'none';

        await this.startFarmingForCategory(target);
      });
    }
  }

  /** Убирает предложение сменить категорию. */
  hideSwitchOffer() {
    this._switchOfferCategoryId = null;
    const slot = document.getElementById('switch-offer-slot');
    if (slot) {
      slot.innerHTML = '';
      slot.style.display = 'none';
    }
  }

  /** Идёт ли сейчас категория, которую пользователь запустил вручную. */
  isManualCategoryActive() {
    return !!(this.manualCategoryId && this.currentCategory?.id === this.manualCategoryId);
  }

  async handleCategoryNoDrops() {
    // Без сессии категорию не меняем и плеер не запускаем
    if (!this.sessionStartTime) return;
    if (!this.currentCategory) return;

    // Категорию, запущенную вручную, приложение не переключает само.
    // Прежняя блокировка срабатывала только когда включена ровно одна
    // категория и она же единственная ручная — то есть почти никогда.
    // Теперь достаточно того, что пользователь сам нажал Play.
    if (this.isManualCategoryActive()) {
      console.log('[Ручной запуск] Дропсов нет, но категорию не меняем:', this.currentCategory.name);
      this.dropsMissingChecks = 0;
      this.showSwitchOffer('noDrops');
      return;
    }

    console.warn('No drops visible for category, disabling from list...', this.currentCategory.name);

    // Время категории записываем, пока она ещё текущая: следующая смена
    // уже не знает, откуда ушла, и время пропадало из статистики по играм
    const leaving = this.currentCategory;
    await this.noteCategoryWatchTime();
    if (this._destroyed || this.currentCategory !== leaving) return;
    
    // Отключаем категорию без дропсов (не удаляем)
    const categoryName = this.currentCategory.name;
    // Тост говорит, что сделано на самом деле: раньше удалённая
    // авто-категория звалась «отключена», и её искали в списке
    let removedFromList = false;
    
    if (this.currentCategory.autoDrops) {
      // Авто-категории можем удалить
      if (this.currentCategory.pinned) {
        // Закреплённую категорию не удаляем, только выключаем. Пометка —
        // что выключило приложение: синхронизация вернёт её в работу,
        // когда у игры появятся кампании, а выключенную руками — нет
        this.currentCategory.enabled = false;
        this.currentCategory.disabledByApp = true;
      } else {
        this.categories = this.categories.filter(cat => cat.id !== this.currentCategory.id);
        removedFromList = true;
      }
    } else {
      // Пользовательские категории отключаем
      this.currentCategory.enabled = false;
      this.currentCategory.disabledByApp = true;
    }

    this.currentCategory = null;
    this.dropsMissingChecks = 0;
    const snapshot = this.streamSnapshot();

    await this.saveCategories();
    if (!this.isCurrentStream(snapshot)) return;
    this.renderCategories();
    
    window.utils.showToast(removedFromList
      ? tr('{name} убрана из списка: дропсов нет', { name: categoryName })
      : tr('{name} выключена: дропсов нет', { name: categoryName }), 'warning');

    // Переключаемся на следующую доступную категорию. Если переключаться
    // некуда, фарминг останавливает сам switchToNextEnabledCategory —
    // второй stopFarming здесь давал два тоста «Фарминг остановлен».
    await this.switchToNextEnabledCategory({ reason: 'noDrops' });
  }

  /**
   * Возвращает промис всех записей в хранилище (итог сессии, время по
   * игре, сохранённая сессия). Обычным вызовам ждать его незачем, а при
   * закрытии приложения ждать обязательно: окно закрывается сразу после
   * ответа, и недописанное пропадает.
   */
  stopFarming(showToast = true, preserveSession = false) {
    const saves = [];
    // Отметки ручного запуска нужны сохранённой сессии: после перезапуска
    // приложение не должно само переключать выбранную руками категорию
    const manualIds = {
      manualCategoryId: this.manualCategoryId || null,
      manualPlayLockCategoryId: this.manualPlayLockCategoryId || null
    };
    this.beginStreamOperation();
    this._playbackRevision = (this._playbackRevision || 0) + 1;
    this.manualPlayLockCategoryId = null;
    this.manualCategoryId = null;
    this._exhaustedCategoryId = null;
    // Отложенные повторы принадлежат остановленной сессии. Повтор после
    // «стримов нет» заводится уже после этой остановки, отдельно.
    clearTimeout(this._categoryRetryTimer);
    this._categoryRetryTimer = null;
    clearTimeout(this._autoRestartTimer);
    this._autoRestartTimer = null;
    this.updateAutoFarmButton();

    if (showToast) {
      window.utils.showToast(tr('Фарминг остановлен'), 'info');
      // Тост показывается только при остановке кнопкой — это и есть
      // «остановил пользователь»; остальные пути пишут в журнал сами
      if (this.sessionStartTime) window.eventLog?.add({ type: 'stop', title: tr('Фарминг остановлен') });
    }
    if (!preserveSession) {
      saves.push(Storage.delete('activeSession'));
    }

    // Останавливаем интервал обновления статистики
    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
      this.statsUpdateInterval = null;
    }
    
    // Финализируем текущую сессию в статистике
    if (this.sessionStartTime) {
      const duration = Math.floor((Date.now() - this.sessionStartTime) / 60000); // в минутах
      
      saves.push(Storage.finalizeCurrentSession({
        duration: duration,
        bandwidth: this.estimatedBandwidth,
        bandwidthHistory: this.bandwidthHistory,
        pointsEarned: this.channelPoints.sessionEarned || 0,
        chestsCollected: this.channelPoints.chestsCollected || 0,
        dropsCollected: this.sessionDropsCollected || 0
      }));

      // Статистика по категории — только её собственное время, от
      // последней смены категории. Раньше сюда писалась длительность всей
      // сессии: после A час и B час игре B доставалось два часа.
      // stopFarming синхронный, поэтому считаем на месте, без await.
      const categoryStart = this.categoryStartTime || this.sessionStartTime;
      if (this.currentCategory?.name && categoryStart) {
        saves.push(this.saveWatchTimeForCategory(this.currentCategory.name, Date.now() - categoryStart));
      }

      // Приложение закрывается, а сессия продолжится после запуска: в
      // сохранённой сессии отсчёт категории переносим на сейчас, иначе
      // записанное время засчиталось бы второй раз
      if (preserveSession && this.currentStream && this.currentCategory) {
        this.categoryStartTime = Date.now();
        saves.push(this.saveActiveSession(this.currentStream, this.currentCategory, manualIds));
      }
    }
    this.categoryStartTime = null;
    
    // Обновляем кнопки в сайдбаре с плавной анимацией
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    
    // Скрываем информацию о сессии с анимацией
    const sessionInfo = document.getElementById('farming-session-info');
    if (sessionInfo) {
      sessionInfo.style.opacity = '0';
      sessionInfo.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        sessionInfo.style.display = 'none';
      }, 300);
    }
    
    // Скрываем блок баллов
    const pointsCard = document.getElementById('channel-points-card');
    if (pointsCard) {
      pointsCard.style.display = 'none';
    }
    
    if (stopBtn) {
      stopBtn.style.opacity = '0';
      stopBtn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        stopBtn.style.display = 'none';
        if (startBtn) {
          startBtn.style.display = 'flex';
          setTimeout(() => {
            startBtn.style.opacity = '1';
            startBtn.style.transform = 'scale(1)';
          }, 10);
        }
      }, 200);
    }
    
    // Останавливаем трекинг сессии
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    this.sessionStartTime = null;
    this.estimatedBandwidth = 0;
    
    // Скрываем таймер сессии
    const sessionTimerDisplay = document.getElementById('session-timer-display');
    if (sessionTimerDisplay) {
      sessionTimerDisplay.style.display = 'none';
    }
    
    // Скрываем прогресс дропсов в сайдбаре. Через общий метод: его таймер
    // снимает следующий показ, а свой таймер здесь мог спрятать блок уже
    // новой сессии
    this.hideMiniDropsProgress();

    // Скрываем панель топ категорий
    const topPanel = document.getElementById('top-categories-panel');
    if (topPanel) {
      topPanel.style.display = 'none';
    }
    
    // Обновляем мини-плеер в сайдбаре - скрываем его
    if (window.router && typeof window.router.manageMiniPlayer === 'function') {
      window.router.manageMiniPlayer(window.router.currentPage);
    }

    // Mark global farming inactive
    if (window.streamingManager) {
      try { window.streamingManager.isFarming = false; } catch (e) {}
    }
    
    // Останавливаем polling баллов (владелец — SessionState)
    window.sessionState?.stopPointsPolling();


    
    // Сбрасываем счетчики баллов.
    //
    // Раньше здесь стояло присваивание в this.channelPoints. После переноса
    // учёта в SessionState это свойство стало вычисляемым, а тело метода
    // класса выполняется в строгом режиме — присваивание выбрасывало
    // TypeError и обрывало stopFarming ровно посередине: уведомление и
    // скрытие сессии успевали произойти, а закрытие стрима и выгрузка
    // плеера, стоящие ниже, — уже нет. Стрим продолжал играть, а запуск
    // другой категории падал вместе с обработчиком.
    window.sessionState?.resetPoints();
    
    // Закрываем стрим
    window.electronAPI.closeStream();
    
    // Проверка зачёта дропсов
    if (this.dropCreditInterval) {
      clearInterval(this.dropCreditInterval);
      this.dropCreditInterval = null;
    }
    clearTimeout(this._creditFirstTick);
    this.renderDropCredit({ state: 'waiting', reason: '' });

    // Останавливаем обновление статистики
    if (this.streamStatsInterval) {
      clearInterval(this.streamStatsInterval);
      this.streamStatsInterval = null;
    }

    // Останавливаем обновление дропсов.
    //
    // Раньше этот интервал переживал остановку и продолжал тикать раз в
    // полминуты: панель дропсов и полоска в сайдбаре появлялись снова уже
    // при выключенном фарминге. Хуже того, оттуда же вызывается
    // handleCategoryNoDrops — остановленное приложение могло само менять
    // категорию.
    if (this.dropsProgressInterval) {
      clearInterval(this.dropsProgressInterval);
      this.dropsProgressInterval = null;
    }
    this.dropsMissingChecks = 0;
    this._emptyDropsChecks = 0;
    this._leaveVotes = 0;

    const dropsPanel = document.getElementById('drops-progress-horizontal');
    if (dropsPanel) dropsPanel.style.display = 'none';
    this.hideSwitchOffer();
    // Новый запуск — новое решение пользователя
    this._offerDismissed = null;
    this._manualDoneShownFor = null;

    const legacyDrops = document.getElementById('drops-progress-container');
    if (legacyDrops) legacyDrops.style.display = 'none';

    window.electronAPI?.updateTrayStatus?.({ active: false });

    const dropsMarks = document.getElementById('sidebar-drops-marks');
    if (dropsMarks) dropsMarks.innerHTML = '';
    const dropsTip = document.getElementById('sidebar-drops-tip');
    if (dropsTip) {
      dropsTip.innerHTML = '';
      dropsTip.setAttribute('aria-hidden', 'true');
    }
    
    // Показываем контейнер обратно и очищаем UI текущего стрима
    const streamInfo = document.getElementById('current-stream-info');
    const playerContainer = document.getElementById('twitch-player-container');

    // Здесь фарминг действительно завершается, поэтому плеер выгружаем полностью
    window.playerManager?.unload();
    this.currentStream = null;
    this.currentCategory = null;
    // Снимаем отметку «Сейчас» со списка
    this.syncCurrentCategoryMark();

    if (streamInfo && playerContainer) {
      playerContainer.style.display = 'none';
      streamInfo.style.display = 'block';
      streamInfo.innerHTML = this.getWaitingStateMarkup();
      this.updateWaitingSub();
    }
    // Следующая награда относилась к остановленной сессии
    this.updateNextReward(null);

    // allSettled: сбой одной записи не должен ни бросать необработанную
    // ошибку у тех, кто промис не ждёт, ни задерживать ответ при выходе
    return Promise.allSettled(saves);
  }

  async updateSessionInfo() {
    if (!this.sessionStartTime) return;

    // Отрисовкой таймера и трафика занимается SessionState — он тикает
    // сам, раз в секунду, независимо от того, открыта ли страница. Раньше
    // здесь стоял ещё один его _tick(): таймер тикал дважды в секунду, а
    // запас «стрима нет 45 с» кончался через 23 с.
    await this.updateTrafficInfo();
  }

  /**
   * Копит расход трафика для статистики сессии.
   *
   * Источник — CDP Network.dataReceived в main-процессе. Его каждую
   * секунду уже спрашивает SessionState и рисует в сайдбаре; здесь берём
   * тот же ответ из его кэша, а не шлём второй запрос и не пишем в те же
   * элементы второй раз. Запрос сами делаем только без SessionState.
   */
  async updateTrafficInfo() {
    let stats = null;
    const cached = window.sessionState?.lastTraffic;

    if (window.sessionState) {
      // Тот же замер второй раз в историю не кладём
      if (!cached || cached.at === this._lastTrafficAt) return;
      this._lastTrafficAt = cached.at;
      stats = cached.stats;
    } else {
      if (!window.electronAPI?.getTrafficStats) return;
      try {
        stats = await window.electronAPI.getTrafficStats();
      } catch (error) {
        console.warn('[Traffic] Не удалось получить статистику трафика:', error?.message);
        return;
      }
    }
    if (!stats) return;

    this.estimatedBandwidth = stats.sessionBytes || 0;

    // История скорости для графика в статистике (храним последние 120 замеров)
    const rate = Math.round(stats.currentRateKBs || 0);
    this.bandwidthHistory.push(rate);
    if (this.bandwidthHistory.length > 120) {
      this.bandwidthHistory = this.bandwidthHistory.slice(-120);
    }
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return tr('0 Б');
    const units = [tr('Б'), tr('КБ'), tr('МБ'), tr('ГБ'), tr('ТБ')];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async updateLiveStatistics() {
    if (!this.sessionStartTime) return;
    
    const duration = Math.floor((Date.now() - this.sessionStartTime) / 60000); // в минутах
    
    await Storage.updateCurrentSession({
      timestamp: this.sessionStartTime,
      duration: duration,
      // Признак жизни: по нему при следующем запуске видно, продолжение это
      // или приложение было закрыто
      lastSeenAt: Date.now(),
      category: this.currentCategory?.name || 'Unknown',
      channel: this.currentStream?.displayName || 'Unknown',
      bandwidth: this.estimatedBandwidth,
      bandwidthHistory: this.bandwidthHistory,
      categoryBoxArtURL: this.currentCategory?.boxArtURL || '',
      pointsEarned: this.channelPoints.sessionEarned || 0,
      chestsCollected: this.channelPoints.chestsCollected || 0,
      dropsCollected: this.sessionDropsCollected || 0
    });
    
    // Отправляем событие об обновлении статистики
    window.dispatchEvent(new CustomEvent('statistics-updated'));
  }


/**
   * Подсказка и деления на шкале дропсов в сайдбаре.
   *
   * Деления показывают, где выдаётся каждая награда, подсказка при
   * наведении — какая награда следующая и сколько до неё осталось.
   *
   * Шкала считается по времени просмотра, а не по среднему проценту
   * наград: прогресс внутри кампании общий, и среднее по наградам ни на
   * что не указывает — деления на такой шкале встали бы в произвольные
   * места. По времени отметка встаёт ровно туда, где награду дадут.
   */
  updateSidebarDropsDetail(campaigns) {
    const marksBox = document.getElementById('sidebar-drops-marks');
    const tip = document.getElementById('sidebar-drops-tip');
    const CV = window.CampaignValue;
    if (!marksBox || !tip || !CV) return null;

    const next = CV.nextDrop(campaigns);
    const source = next?.campaign || (campaigns || [])[0];
    const timeline = CV.timeline(source);

    marksBox.innerHTML = timeline.marks
      .map((mark, index) => {
        const last = index === timeline.marks.length - 1;
        return `<div class="drops-mark${mark.earned ? ' earned' : ''}${last ? ' last' : ''}"
                     style="left: ${mark.percent}%"></div>`;
      })
      .join('');

    // Общее экранирование страницы — одно на всё приложение
    const escape = (text) => this.esc(text);

    if (!next) {
      tip.innerHTML = `<div class="drops-tip-name">${tr('Незабранных наград нет')}</div>`;
      tip.setAttribute('aria-hidden', 'false');
      return timeline;
    }

    const icon = next.drop.imageURL || next.drop.image || '';
    const left = Math.max(0, Math.ceil(next.minutesNeeded));
    const collected = timeline.marks.filter(m => m.earned).length;

    tip.innerHTML = `
      <div class="drops-tip-row">
        ${icon ? `<img src="${escape(icon)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
        <div>
          <div class="drops-tip-name">${escape(next.drop.name || next.drop.benefitName || tr('Награда'))}</div>
          <div class="drops-tip-left">${left > 0 ? tr('осталось {time}', { time: this.formatMinutes(left) }) : tr('готова к получению')}</div>
        </div>
      </div>
      <div class="drops-tip-note">${tr('Собрано {done} из {total} · чёрточки — рубежи выдачи', { done: collected, total: timeline.marks.length })}</div>
    `;
    tip.setAttribute('aria-hidden', 'false');

    return timeline;
  }

/**
   * Прогноз: когда будут собраны все достижимые награды и что из этого
   * успеется до автовыключения.
   *
   * Вопрос «сколько ещё сидеть» возникает при каждом запуске, а ответ
   * приложение знает точно: прогресс внутри кампании общий, поэтому
   * достаточно самой дальней достижимой награды — остальные наберутся
   * попутно.
   */
  buildForecastMarkup(campaigns) {
    const CV = window.CampaignValue;
    if (!CV) return '';

    const now = Date.now();
    const minutes = CV.minutesToFinish(campaigns, now);
    if (minutes === null) return '';

    const clock = (fromNow) => new Date(now + fromNow * 60000)
      .toLocaleTimeString(tr.locale(), { hour: tr.lang() === 'en' ? 'numeric' : '2-digit', minute: '2-digit' });

    const reachable = CV.reachableCount(campaigns, now);
    // Строка текста с часами вместо цветных плашек: «Все награды через
    // 4 ч 25 мин · к 07:01 · до выключения успеется всё»
    const parts = [`
      ${window.Icons?.get('clock', 14) ?? ''}
      <span class="drops-forecast-main">${tr('Все награды через {time}', { time: this.formatMinutes(minutes) })}</span>
      <span class="drops-forecast-clock">${tr('к {clock}', { clock: clock(minutes) })}</span>
    `];

    // Если заведено автовыключение по таймеру — сразу видно, что из
    // задуманного успеется, а что нет
    const untilShutdown = window.shutdownManager?.minutesUntilTimer?.();
    if (untilShutdown !== null && untilShutdown !== undefined) {
      const willGet = CV.dropsBefore(campaigns, untilShutdown, now);
      const enough = willGet >= reachable;

      parts.push(`
        <span class="drops-forecast-note ${enough ? 'ok' : 'short'}">
          ${enough
            ? tr('До выключения в {clock} успеется всё', { clock: clock(untilShutdown) })
            : tr('До выключения в {clock} успеется {count} из {total}', { clock: clock(untilShutdown), count: willGet, total: reachable })}
        </span>
      `);
    }

    return `<div class="drops-forecast">${parts.join('')}</div>`;
  }

/**
   * Отдаёт состояние фарминга значку в трее и полосе на панели задач.
   *
   * Чтобы понять, идёт ли фарминг и далеко ли до награды, приходилось
   * разворачивать окно. Теперь достаточно навести на значок.
   */
  updateTrayStatus(campaigns, timeline) {
    if (!window.electronAPI?.updateTrayStatus) return;

    const next = window.CampaignValue?.nextDrop(campaigns);

    window.electronAPI.updateTrayStatus({
      active: !!this.sessionStartTime,
      category: this.currentCategory?.name || '',
      percent: timeline ? timeline.percent : -1,
      nextIn: next ? this.formatMinutes(next.minutesNeeded) : ''
    });
  }

  /** Минуты в вид «2 ч 15 мин»: единицы через пробел, как во всём интерфейсе. */
  formatMinutes(minutes) {
    const total = Math.max(0, Math.round(minutes));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (hours > 0) return rest > 0 ? tr('{hours} ч {minutes} мин', { hours, minutes: rest }) : tr('{hours} ч', { hours });
    return tr('{minutes} мин', { minutes: rest });
  }

  /**
   * Блок «Дропсы» в сайдбаре. Вызывается, когда у текущей категории есть
   * кампания, — и показывает блок при любом проценте, в том числе при 0.
   *
   * Раньше 0 % прятал блок, а вместе с ним и красное «Не засчитывается»:
   * предупреждения не было видно ровно тогда, когда минуты не шли. Прячет
   * блок только hideMiniDropsProgress — при остановке и смене категории.
   */
  updateMiniDropsProgress(percent) {
    const sidebarProgress = document.getElementById('sidebar-drops-progress');
    const sidebarPercent = document.getElementById('sidebar-drops-percent');
    const sidebarBar = document.getElementById('sidebar-drops-bar');

    if (sidebarProgress && sidebarPercent && sidebarBar) {
      const value = Math.max(0, Math.min(100, Number(percent) || 0));

      // Отложенное скрытие от прошлой остановки не должно спрятать блок
      clearTimeout(this._miniDropsHideTimer);
      sidebarProgress.style.display = 'block';
      setTimeout(() => {
        sidebarProgress.style.opacity = '1';
        sidebarProgress.style.transform = 'translateY(0)';
      }, 10);

      sidebarPercent.textContent = `${Math.round(value)}%`;
      sidebarBar.style.width = `${value}%`;

      // Всё собрано — шкала зелёная. Цвет задаёт оформление по классу
      // (#sidebar-drops-progress.is-complete), а не инлайновые цвета:
      // те не знали ни о светлой теме, ни об оформлении iOS 27
      sidebarProgress.classList.toggle('is-complete', value === 100);
    }
  }

  /** Прячет блок «Дропсы» в сайдбаре: фарминг остановлен или сменилась категория. */
  hideMiniDropsProgress() {
    const sidebarProgress = document.getElementById('sidebar-drops-progress');
    if (!sidebarProgress) return;

    sidebarProgress.style.opacity = '0';
    sidebarProgress.style.transform = 'translateY(-10px)';
    clearTimeout(this._miniDropsHideTimer);
    this._miniDropsHideTimer = setTimeout(() => {
      sidebarProgress.style.display = 'none';
    }, 300);
  }

  /**
   * Сбрасывает панель дропсов и блок в сайдбаре, если они показывают
   * другую категорию.
   *
   * После смены категории там до первой проверки (а при пустых ответах —
   * ещё три) висели прогресс и прогноз прошлой игры, и казалось, что
   * фармится не то. Чья это панель, записано в data-category-id.
   */
  resetDropsViewForCategory(category) {
    const horizontal = document.getElementById('drops-progress-horizontal');
    const shown = horizontal?.dataset?.categoryId;
    if (!horizontal || !shown || !category || shown === String(category.id)) return;

    delete horizontal.dataset.categoryId;
    // Силуэт панели вместо надписи «Загрузка…»: место занято сразу, и
    // экран не прыгает, когда приходят данные
    const tile = '<div class="skeleton drops-panel-skeleton-tile"></div>';
    horizontal.innerHTML = `
      <div class="drops-panel is-loading" aria-busy="true" aria-label="${tr('Загрузка наград')}">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton drops-panel-skeleton-bar"></div>
        <div class="drop-tiles">${tile.repeat(4)}</div>
      </div>
    `;
    horizontal.style.display = 'block';
    this.hideMiniDropsProgress();
    this.updateNextReward(null);
  }

  async saveWatchTimeForCategory(categoryName, durationMs) {
    try {
      const stats = (await Storage.getWatchTimeStats()) || {};
      
      if (!stats[categoryName]) {
        stats[categoryName] = {
          totalTime: 0,
          sessions: 0,
          lastWatched: 0
        };
      }
      
      stats[categoryName].totalTime += durationMs;
      stats[categoryName].sessions += 1;
      stats[categoryName].lastWatched = Date.now();
      
      await Storage.saveWatchTimeStats(stats);
    } catch (error) {
      console.error('Error saving watch time stats:', error);
    }
  }

  showFarmingState() {
    const startBtn = document.getElementById('sidebar-start-farming-btn');
    const stopBtn = document.getElementById('sidebar-stop-farming-btn');
    if (startBtn) {
      startBtn.style.display = 'none';
      startBtn.style.opacity = '0';
      startBtn.style.transform = 'scale(0.95)';
    }
    if (stopBtn) {
      stopBtn.style.display = 'flex';
      stopBtn.style.opacity = '1';
      stopBtn.style.transform = 'scale(1)';
    }
  }
  
  /**
   * Возвращает true, если разметка нашлась и статистика стрима уже
   * запущена отсюда. Повторный startStreamStatsUpdate после этого вызова
   * удваивал запросы к Twitch и проверки дропсов при каждой смене стрима.
   */
  updateCurrentStreamUI(stream, category) {
    this._playbackRevision = (this._playbackRevision || 0) + 1;
    // Отметка «эту категорию уже бросили» относится к прошлому заходу в неё.
    // Раньше она снималась только при «выгодной» проверке: вернувшись в
    // безнадёжную категорию, приложение больше не уходило из неё никогда.
    if (this._exhaustedCategoryId && this._exhaustedCategoryId !== category?.id) {
      this._exhaustedCategoryId = null;
    }
    // Прогресс дропсов прошлой игры до первой проверки новой не показываем
    this.resetDropsViewForCategory(category);
    // Предложение сменить категорию относится к прежней категории
    if (this._switchOfferCategoryId && this._switchOfferCategoryId !== category?.id) {
      this.hideSwitchOffer();
    }
    // Как и отказ от него
    if (this._offerDismissed && this._offerDismissed.categoryId !== (category?.id || null)) {
      this._offerDismissed = null;
    }
    // Ручной режим мог смениться вместе с категорией, а с ней и отметка
    // «Сейчас» в списке. Позже, а не сразу: вызывающий код к этому
    // моменту уже записал новый стрим и категорию
    setTimeout(() => {
      this.updateAutoFarmButton();
      if (!this._destroyed) this.syncCurrentCategoryMark();
    }, 0);

    const streamInfo = document.getElementById('current-stream-info');
    const playerContainer = document.getElementById('twitch-player-container');
    const player = window.playerManager?.getWebview();

    this.registerFarmingWebviewLabels();

    if (streamInfo && playerContainer && player) {
      // Скрываем no-stream и показываем плеер
      streamInfo.style.display = 'none';
      playerContainer.style.display = 'block';

      // Загружаем стрим с низким качеством.
      // load() сам проверит, не тот же ли это канал, и не станет
      // перезагружать webview впустую.
      window.playerManager.load(stream.login);
      window.chatManager?.load(stream.login);

      // Размещение доверяем роутеру: он же заводит слежение за прокруткой,
      // чтобы плеер уезжал в сайдбар, когда его прокручивают за край.
      // Прямая привязка это слежение обходила.
      if (window.router?.currentPage && window.router.currentPage !== 'farming') {
        window.router.manageMiniPlayer(window.router.currentPage);
      } else if (window.router?.placePlayerOnFarming) {
        window.router.placePlayerOnFarming();
      } else {
        window.playerManager.attachTo('farming-player-slot');
      }

      // Автоматически обрабатываем mature content warning
      this.setupMatureContentHandler(player);

      // Устанавливаем низкое качество при загрузке плеера
      player.addEventListener('dom-ready', () => {
        // Пробуем установить качество через JavaScript injection
        // Русское внутри строки — только комментарии кода для страницы Twitch
        player.executeJavaScript(/* i18n-ignore */ `
          setTimeout(() => {
            try {
              // Пытаемся найти кнопку настроек качества
              const settingsBtn = document.querySelector('[data-a-target="player-settings-button"]');
              if (settingsBtn) {
                settingsBtn.click();
                setTimeout(() => {
                  const qualityBtn = document.querySelector('[data-a-target="player-settings-menu-item-quality"]');
                  if (qualityBtn) {
                    qualityBtn.click();
                    setTimeout(() => {
                      // Выбираем самое низкое качество (последний пункт обычно)
                      const qualityOptions = document.querySelectorAll('[data-a-target="player-settings-menu-item-quality"] input');
                      if (qualityOptions.length > 0) {
                        qualityOptions[qualityOptions.length - 1].click();
                      }
                      // Закрываем меню через 100мс
                      setTimeout(() => {
                        const settingsBtn = document.querySelector('[data-a-target="player-settings-button"]');
                        if (settingsBtn) settingsBtn.click();
                      }, 100);
                    }, 300);
                  }
                }, 300);
              }
            } catch(e) {
              console.error('Quality setup error:', e);
            }
          }, 2000);
          // Проверяем видео каждые 10 сек, если паузу жмём play
          setInterval(() => {
            try {
              const video = document.querySelector('video');
              if (video && video.paused) {
                video.play().catch(() => {});
              }
            } catch (e) {}
          }, 10000);
        `).catch(e => console.error('Failed to inject quality script:', e));
      }, { once: true });
      
      // Сохраняем текущую категорию и стрим
      this.currentCategory = category;
      this.currentStream = stream;
      
      // Обновляем информацию о стриме
      document.getElementById('stream-channel').textContent = stream.displayName;
      // Просто название игры: подпись «Игра:» лишняя — рядом обложка
      document.getElementById('stream-game').textContent = category.name;
      document.getElementById('stream-title').textContent = stream.title || tr('Без названия');
      
      // Теги стрима. Видимостью управляет CSS через :not(:empty),
      // поэтому здесь достаточно записать текст или очистить его.
      const categoryEl = document.getElementById('stream-category');
      if (categoryEl) {
        const tags = Array.isArray(stream.tags)
          ? stream.tags.filter(tag => tag && String(tag).trim())
          : [];
        categoryEl.textContent = tags.join(' · ');
      }
      
      // Отображаем обложку игры
      const gameCover = document.getElementById('stream-game-cover');
      if (gameCover && category.boxArtURL) {
        gameCover.src = category.boxArtURL;
        gameCover.style.display = 'block';
      } else if (gameCover) {
        // Без обложки — пустая заглушка (фон из farming.html), а не
        // картинка прошлой игры
        gameCover.removeAttribute('src');
        gameCover.style.display = 'block';
      }
      
      // Очищаем историю зрителей
      this.viewersHistory = [];
      
      // Настраиваем график зрителей
      this.setupViewersChart();
      
      // Запускаем обновление статистики
      this.startStreamStatsUpdate(stream.login);
      
      // Добавляем обработчик клика на информацию о стриме
      this.setupStreamInfoClick();
      return true;
    }
    // Разметки страницы нет — статистику стрима здесь не запустили,
    // это сделает вызывающий
    return false;
  }

  registerFarmingWebviewLabels() {
    const registerWebviewLabel = (id, label) => {
      const webview = document.getElementById(id);
      if (!webview || webview.dataset.processLabelSet === 'true') return;

      const setLabel = () => {
        try {
          const webContentsId = webview.getWebContentsId?.();
          if (!webContentsId) return;
          window.electronAPI.setProcessLabel({ webContentsId, label });
          webview.dataset.processLabelSet = 'true';
        } catch (error) {
          console.warn('[Diagnostics] Failed to set process label for', id, error);
        }
      };

      webview.addEventListener('dom-ready', setLabel, { once: true });
      // Если dom-ready уже прошёл, событие не придёт — пробуем сразу, но
      // молча: до готовности webview этот вызов выбрасывает исключение,
      // и раньше оно шло в лог предупреждением при каждом запуске
      try {
        if (webview.getWebContentsId?.()) setLabel();
      } catch (e) {
        // ещё не готов — дождёмся dom-ready
      }
    };

    registerWebviewLabel('twitch-player', 'Twitch Player (Main)');
    registerWebviewLabel('twitch-chat', 'Twitch Chat');
    // drops-data-extractor убран: скрытый webview не использовался ни
    // одной строкой кода, но исправно поднимал отдельный процесс
    // отрисовки и сыпал предупреждением о недоступности
  }

  setupStreamInfoClick() {
    const streamDetails = document.getElementById('stream-details');
    if (streamDetails) {
      streamDetails.style.cursor = 'pointer';

      if (this.streamInfoClickHandler) {
        streamDetails.removeEventListener('click', this.streamInfoClickHandler);
      }
      
      // Клик на блок с информацией о стриме
      this.streamInfoClickHandler = async (e) => {
        // Игнорируем клик на кнопку чата
        if (e.target.closest('#toggle-chat-btn')) return;

        if (!this.currentStream || !this.currentCategory) return;
        if (this.isStreamDetailsOpen) return;
        if (document.querySelector('.category-detail-modal')) return;

        this.isStreamDetailsOpen = true;
        await this.showCurrentStreamDetails();
      };

      streamDetails.addEventListener('click', this.streamInfoClickHandler);

      // Карточка канала — кнопка (role="button" в разметке): Enter и пробел
      // открывают подробности так же, как щелчок. Узел живёт всю жизнь
      // страницы, поэтому обработчик клавиш вешаем один раз
      if (!streamDetails.dataset.keysBound) {
        streamDetails.dataset.keysBound = '1';
        streamDetails.addEventListener('keydown', (e) => {
          if (e.target !== streamDetails || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          streamDetails.click();
        });
      }
    }
  }

  async showCurrentStreamDetails() {
    if (!this.currentStream || !this.currentCategory) return;
    if (document.querySelector('.category-detail-modal')) return;

    this.isStreamDetailsOpen = true;

    const i18n = window.i18n;
    const stream = this.currentStream;
    const category = this.currentCategory;

    // Обычное окно приложения (.dialog) вместо самодельного: тот же фон,
    // рамка, Esc и закрытие по фону, что у остальных окон. Класс
    // category-detail-modal остаётся — по нему проверяют, открыто ли окно
    const modal = document.createElement('div');
    modal.className = 'category-detail-modal dialog-backdrop stream-detail-backdrop';

    const modalContent = document.createElement('div');
    modalContent.className = 'dialog dialog-lg stream-detail-dialog';
    modalContent.setAttribute('role', 'dialog');
    modalContent.setAttribute('aria-modal', 'true');
    modalContent.setAttribute('aria-labelledby', 'stream-detail-title');
    modal.style.transition = 'opacity var(--dur-base) var(--ease-out)';
    modalContent.style.transition = 'transform var(--dur-base) var(--ease-out)';

    let channelDetails = {
      profileImageUrl: '',
      description: '',
      followers: 0,
      isLive: false
    };
    let streamStats = {
      viewers: 0,
      uptime: '',
      points: 0
    };
    
    try {
      // Загружаем данные параллельно. Каждый запрос со своей страховкой:
      // сбой одного (Twitch не ответил — вызов отклоняется) не должен
      // оставлять окно без данных другого
      // Подробности канала main берёт из публичного GQL без токена.
      // Раньше их запрашивали только при найденном токене аккаунта, и без
      // входа окно оставалось без аватарки и описания
      const results = await Promise.all([
        window.electronAPI.getStreamStats(stream.login).catch(() => null),
        window.electronAPI.getChannelDetails(null, stream.login).catch(() => null)
      ]);
      streamStats = results[0] || streamStats;
      channelDetails = results[1] || channelDetails;
      
      console.log('[StreamDetails] Channel details:', channelDetails);
      console.log('[StreamDetails] Channel details JSON:', JSON.stringify(channelDetails, null, 2));
      console.log('[StreamDetails] Stream stats:', streamStats);
      console.log('[StreamDetails] Stream stats JSON:', JSON.stringify(streamStats, null, 2));
      console.log('[StreamDetails] profileImageUrl:', channelDetails.profileImageUrl);
      console.log('[StreamDetails] followers:', channelDetails.followers);
      console.log('[StreamDetails] description:', channelDetails.description);
    } catch (error) {
      console.error('[StreamDetails] Error fetching details:', error);
    }

    // Фоллбэк для аватарки
    // Адрес проверяется: он попадает и в src, и в CSS url('…')
    const profileImageUrl = this.safeImageUrl(channelDetails.profileImageUrl,
      `https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-300x300.png`);
    
    console.log('[StreamDetails] Profile image URL:', profileImageUrl);
    
    // Функция форматирования зрителей — общая, по-русски («44 тыс.»),
    // а не «44.0K», как было здесь
    const formatViewers = (count) => this.formatViewersCount(count);

    const icon = (name, size) => window.Icons?.get(name, size) ?? '';
    // Метрики — тихими числами в строку, без цветных плиток
    const kpis = [
      channelDetails.followers ? [tr('Подписчиков'), this.esc(this.formatFollowers(channelDetails.followers))] : null,
      streamStats.viewers ? [tr('Зрителей'), this.esc(formatViewers(streamStats.viewers))] : null,
      streamStats.uptime ? [tr('В эфире'), this.esc(streamStats.uptime)] : null,
      streamStats.points ? [tr('Баллы канала'), this.esc(Number(streamStats.points).toLocaleString(tr.locale()))] : null
    ].filter(Boolean);

    modalContent.innerHTML = `
      <div class="dialog-head">
        <img class="stream-detail-avatar" src="${this.esc(profileImageUrl)}" alt=""
             onerror="this.onerror=null; this.src='https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-300x300.png';">
        <div>
          <div class="dialog-eyebrow">${tr('Сейчас смотрим')}</div>
          <h2 class="dialog-title" id="stream-detail-title">${this.esc(stream.displayName)}</h2>
          <div class="row-meta">
            <span>@${this.esc(stream.login)}</span>
            ${channelDetails.isLive ? `<span class="tone-ok">${tr('в эфире')}</span>` : ''}
          </div>
        </div>
        <button id="close-stream-modal" class="dialog-close" type="button" title="${tr('Закрыть (Esc)')}" aria-label="${tr('Закрыть')}">${icon('close', 16)}</button>
      </div>

      <div class="dialog-body">
        ${kpis.length ? `
          <div class="kpi-grid stream-detail-kpis">
            ${kpis.map(([label, value]) => `
              <div class="kpi kpi-inline">
                <div class="kpi-label">${label}</div>
                <div class="kpi-value">${value}</div>
              </div>`).join('')}
          </div>` : ''}

        <div class="stream-detail-section">
          <div class="section-label">${icon('monitor', 14)} ${tr('Название стрима')}</div>
          <div id="stream-title-text" class="stream-detail-title" title="${tr('Нажмите, чтобы скопировать')}">${this.esc(stream.title || tr('Без названия'))}</div>
        </div>

        <div class="stream-detail-section">
          <div class="section-label">${icon('gamepad', 14)} ${tr('Категория')}</div>
          <div class="stream-detail-category">
            <img class="row-art" src="${this.esc(this.boxArtSrc(category.boxArtURL, '60x84', category.id))}" alt=""
                 onerror="this.onerror=null;this.src=window.DROP_PLACEHOLDER||'';">
            <div class="row-main">
              <div class="row-title">${this.esc(category.name)}</div>
              <div class="row-meta">
                ${category.viewersCount ? `<span>${this.esc(this.viewersLabel(category.viewersCount))}</span>` : ''}
                ${category.hasDrops ? `<span class="tone-ok">${tr('Дропсы доступны')}</span>` : ''}
              </div>
            </div>
          </div>
        </div>

        ${channelDetails.description ? `
          <div class="stream-detail-section">
            <div class="section-label">${icon('info', 14)} ${tr('О канале')}</div>
            <div class="stream-detail-about">${this.esc(channelDetails.description)}</div>
          </div>` : ''}
      </div>

      <div class="dialog-foot">
        <button id="open-stream-on-twitch" class="btn btn-secondary" type="button">
          ${icon('external', 16)}
          <span>${tr('Открыть на Twitch')}</span>
        </button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Копирование названия и переход на Twitch — обработчиками, а не
    // атрибутами onclick: значение атрибута браузер сначала раскодирует,
    // и экранированная кавычка из названия стрима снова становилась
    // кавычкой, вырываясь из строки JS. Данные берём из замыкания.
    const titleEl = modal.querySelector('#stream-title-text');
    if (titleEl) {
      titleEl.addEventListener('click', () => {
        navigator.clipboard.writeText(stream.title || tr('Без названия')).then(() => {
          window.utils.showToast(tr('Название скопировано'), 'success');
        }).catch(() => {
          window.utils.showToast(tr('Ошибка копирования'), 'error');
        });
      });
    }

    const openBtn = modal.querySelector('#open-stream-on-twitch');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        window.electronAPI.openExternal('https://twitch.tv/' + encodeURIComponent(stream.login));
      });
    }

    // Обработчик закрытия. Повторное нажатие во время анимации не должно
    // удалять окно второй раз — removeChild на уже снятом узле бросал ошибку
    let closing = false;
    // Esc закрывает окно, как и остальные окна приложения; слушатель
    // снимается вместе с окном
    const keyAbort = new AbortController();
    const closeModal = () => {
      if (closing) return;
      closing = true;
      keyAbort.abort();
      modal.style.opacity = '0';
      modalContent.style.transform = 'translateY(20px)';
      setTimeout(() => {
        modal.remove();
        this.isStreamDetailsOpen = false;
      }, 200);
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    }, { signal: keyAbort.signal });

    // Закрытие по клику на overlay
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Закрытие по клику на кнопку
    const closeBtn = modal.querySelector('#close-stream-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }
  }

  
  startStreamStatsUpdate(channelLogin) {
    const snapshot = this.streamSnapshot();
    const generation = this._statsGeneration = (this._statsGeneration || 0) + 1;
    const isCurrent = () => this.isCurrentStream(snapshot) && generation === this._statsGeneration;
    this._gameMismatchCount = 0;
    // Очищаем старый интервал
    if (this.streamStatsInterval) {
      clearInterval(this.streamStatsInterval);
    }
    
    // Обновляем сразу и каждые 30 секунд
    const updateStats = async () => {
      try {
        const stats = await window.electronAPI.getStreamStats(channelLogin);

        // Запрос идёт по сети, и за это время можно уйти на другую
        // страницу: разметка уже другая, а продолжение обработчика
        // пыталось писать в исчезнувший элемент и падало
        const viewersEl = document.getElementById('stream-viewers');
        if (!isCurrent() || !viewersEl) return;

        // stats === null — Twitch подтвердил, что канал не в эфире (сбой сети
        // main отдаёт исключением, оно уходит в catch). Раньше этот ответ
        // молча пропускался: стрим заканчивался, а приложение до утра
        // показывало «Минуты засчитываются» и ничего не делало.
        if (stats === null) {
          this._offlineStatChecks = (this._offlineStatChecks || 0) + 1;
          const uptimeEl = document.getElementById('stream-uptime');
          if (uptimeEl) uptimeEl.textContent = tr('не в эфире');
          if (this._offlineStatChecks >= 2) {
            this._offlineStatChecks = 0;
            console.warn('[Стрим] Канал закончил эфир:', channelLogin);
            this.onPlayerDead({ channel: channelLogin, reason: 'канал закончил эфир' }); // i18n-ignore: причина только для журнала консоли
          }
          return;
        }
        this._offlineStatChecks = 0;

        if (stats) {
          // Обновляем зрителей: «12,4 тыс.» и слово в нужной форме рядом
          // («1 зритель», «3 зрителя») — подпись стоит прямо в строке
          const viewers = stats.viewers || 0;
          viewersEl.textContent = viewers ? this.formatViewersCount(viewers) : '0';
          const viewersLabel = document.getElementById('stream-viewers-label');
          if (viewersLabel) viewersLabel.textContent = this.viewersWord(viewers);
          
          // Сохраняем в историю (максимум 100 значений)
          this.viewersHistory.push({
            time: Date.now(),
            count: viewers
          });
          if (this.viewersHistory.length > 100) {
            this.viewersHistory.shift();
          }
          
          // Обновляем uptime
          document.getElementById('stream-uptime').textContent = 
            stats.uptime || '-';

          // Проверяем, что стример всё ещё в нужной игре (категории)
          const expectedCategory = this.currentCategory?.name;
          const currentGame = stats.gameName || '';
          if (expectedCategory && currentGame) {
            const match = this._gameMatchesCategory(currentGame, expectedCategory,
              stats.gameId, this.currentCategory?.id);
            if (!match) {
              this._gameMismatchCount = (this._gameMismatchCount || 0) + 1;
              console.log('Game mismatch detected:', { currentGame, expectedCategory, count: this._gameMismatchCount });
              const MAX_MISMATCHES = 2; // две проверки подряд (~60 сек)
              if (this._gameMismatchCount >= MAX_MISMATCHES) {
                this._gameMismatchCount = 0;
                if (window.settings?.get('autoSwitchStreams') === false) {
                  // Раньше здесь был молчаливый return: всю ночь шёл
                  // просмотр не той игры. Переключать запрещено, но сказать
                  // об этом нужно — один раз на канал, а не каждую минуту
                  this.toastOnce('game:' + channelLogin,
                    tr('Стример сменил игру, дропсы не идут. Автопереключение выключено'), 'warning');
                  return;
                }
                window.utils?.showToast(tr('Стример сменил игру — переключаюсь'), 'info');
                try {
                  // Пытаемся найти другой стрим в той же категории
                  const streams = await window.electronAPI.getStreamsWithDrops(expectedCategory);
                  if (!isCurrent()) return;
                  // Twitch не ответил — это не «стримов нет»: решим на
                  // следующей проверке, а категорию не бросаем
                  if (!Array.isArray(streams)) return;
                  if (streams.length > 0) {
                    const nextStream = await this.pickPreferredStream(streams, expectedCategory, { exclude: channelLogin });
                    if (!isCurrent()) return;
                    if (nextStream && nextStream.login.toLowerCase() !== channelLogin.toLowerCase()) {
                      await this.switchToStream(nextStream);
                      return;
                    }
                  }
                  // Если нет стримов в категории — идём к следующей включенной
                  await this.switchToNextEnabledCategory({ reason: 'gameChanged' });
                } catch (switchErr) {
                  console.error('Error switching after game change:', switchErr);
                }
              }
            } else {
              this._gameMismatchCount = 0;
            }
          }
        }
      } catch (e) {
        console.error('Error updating stream stats:', e);
      }
    };
    
    updateStats();
    this.streamStatsInterval = setInterval(updateStats, 30000);
    
    // Также запускаем обновление прогресса дропсов
    this.startDropsProgressUpdate(channelLogin);
  }

  _gameMatchesCategory(gameName, categoryName, gameId, categoryId) {
    // Подстрока может обозначать другую игру, поэтому сравниваем целые
    // названия — тем же правилом, что выбор стрима и подбор кампаний
    return window.StreamPicker.isExactGame(gameName, categoryName, gameId, categoryId);
  }
  
  startDropsProgressUpdate(channelLogin) {
    const snapshot = this.streamSnapshot();
    const generation = this._dropsGeneration = (this._dropsGeneration || 0) + 1;
    // Очищаем старый интервал
    if (this.dropsProgressInterval) {
      clearInterval(this.dropsProgressInterval);
    }
    
    const hideOldContainer = () => {
      const legacyContainer = document.getElementById('drops-progress-container');
      if (legacyContainer) legacyContainer.style.display = 'none';
    };

    // Первые минуты после запуска стрима Twitch ещё не отчитывается о
    // кампании, а свежий кэш инвентаря может быть собран до неё. Судить
    // категорию в это время рано — промахи не считаем.
    const watchStartedAt = Date.now();
    const warmupMs = window.DropCredit?.WARMUP_MS || 4 * 60 * 1000;

    // Обновляем только новую цветную раскладку, старый список скрываем
    const updateDrops = async () => {
      try {
        hideOldContainer();
        const progressState = await this.updateDropsHorizontalProgress();
        if (!this.isCurrentStream(snapshot) || generation !== this._dropsGeneration) return;
        const hasDrops = progressState && progressState.hasDrops;

        if (hasDrops) {
          this.dropsMissingChecks = 0;
          // Дропсы появились (не догадка по неполному инвентарю) — отказ
          // «Остаться» на «дропсов нет» больше ни к чему: если кампания
          // снова пропадёт, это уже новый случай
          if (!progressState.unknown && this._offerDismissed?.reason === 'noDrops') {
            this._offerDismissed = null;
          }
        } else if (Date.now() - watchStartedAt < warmupMs) {
          console.log('[Дропсы] Кампаний не видно, но стрим только запущен — промах не считаю');
        } else {
          this.dropsMissingChecks = (this.dropsMissingChecks || 0) + 1;
          // If drops not visible for a while, treat category as completed and move on
          const MAX_MISSING_CHECKS = 3; // ~90s with 30s interval
          if (this.dropsMissingChecks >= MAX_MISSING_CHECKS) {
            await this.handleCategoryNoDrops();
            return;
          }
        }
      } catch (e) {
        console.error('Error updating drops progress:', e);
      }
    };
    
    updateDrops();
    this.dropsProgressInterval = setInterval(updateDrops, 30000);

    this.startDropCreditCheck(channelLogin);
  }

  /**
   * Прямая проверка зачёта: Twitch сам говорит, какой канал засчитывает.
   *
   * Раз в минуту (первый раз через полторы) спрашиваем dropCurrentSession.
   * Первые четыре минуты ответа может не быть — это прогрев, не отказ.
   * Дальше две выборки подряд без зачёта на нашем канале — стрим меняется.
   * Индикатор под шкалой дропсов показывает состояние цветом.
   */
  startDropCreditCheck(channelLogin) {
    if (this.dropCreditInterval) {
      clearInterval(this.dropCreditInterval);
      this.dropCreditInterval = null;
    }
    clearTimeout(this._creditFirstTick);

    this._creditSamples = [];
    this._creditProgress = [];
    this._creditStartedAt = Date.now();
    this._creditLastGrowthAt = this._creditStartedAt;
    this._creditStrikes = 0;
    this.renderDropCredit({ state: 'waiting', reason: 'жду первого ответа Twitch' }); // i18n-ignore: код причины, текст даёт DropCredit.explain

    if (!window.DropCredit || !window.electronAPI?.getDropSession) return;

    const login = window.DropCredit.normalizeLogin(channelLogin);
    const snapshot = this.streamSnapshot();

    const tick = async () => {
      if (!this.isCurrentStream(snapshot) || !this.currentStream) return;
      if (window.DropCredit.normalizeLogin(this.currentStream.login) !== login) return;

      // Запрос Twitch о текущей сессии зачёта часто отвечает ошибкой
      // («service unavailable»). Раньше проверка на этом выходила, ничего не
      // решив: приговор «не засчитывает» зрел час вместо восьми минут, а
      // после возврата на канал не созревал вовсе — индикатор до утра
      // показывал «жду». Теперь неудачный ответ просто не даёт выборки, а
      // решение принимается и по минутам из инвентаря
      let response = null;
      try {
        response = await window.electronAPI.getDropSession(login);
      } catch (error) {
        response = null;
      }
      if (!this.isCurrentStream(snapshot)) return;

      const sampled = !!(response && response.ok !== false);
      if (sampled) {
        this._creditSamples.push({ at: Date.now(), session: response.session || null });
        if (this._creditSamples.length > 10) this._creditSamples.shift();
      }

      // Страховка: сумма минут по кампаниям игры из инвентаря. Растёт —
      // значит зачёт идёт, и никакой другой ответ этого не перебьёт
      let progressGrew = false;
      let progressStale = true;
      let inventoryKnown = false;
      let hasWatchable = true;
      try {
        const inv = await window.electronAPI.fetchDropsInventory();
        if (!this.isCurrentStream(snapshot)) return;
        const matched = this.matchCampaignsForGame(inv?.campaigns || [], this.currentCategory?.name || '', this.currentCategory?.id);
        // Судим только по кампаниям игры с наградами: у игры без кампаний
        // (фарм баллов) минутам расти не с чего, и ни «не засчитывает», ни
        // «награды собраны» про неё сказать нельзя
        const withDrops = matched.filter(c => Array.isArray(c.drops) && c.drops.length > 0);
        if (withDrops.length > 0) {
          inventoryKnown = true;
          // Есть ли что зарабатывать просмотром. Нет — ждать зачёт не от
          // чего: из категории уводит проверка выгодности, а не смена стрима
          hasWatchable = withDrops.some(c => window.CampaignValue.unclaimedDrops(c).length > 0);
        }
        // Сбойный ответ инвентаря (пустой список) в ряд сумм не пишем: ноль
        // в ряду делал следующий нормальный ответ «ростом», а тот сбрасывал
        // счёт стоящих минут — редкие сбои за ночь не давали приговору созреть
        if (inventoryKnown) {
          const sum = matched.reduce((acc, c) => acc + (c.drops || []).reduce((a, d) => a + (Number(d.progress) || 0), 0), 0);
          const prev = this._creditProgress;
          progressGrew = prev.length > 0 && sum > Math.min(...prev.slice(-3));
          // Пять проверок без роста — минуты и правда стоят
          progressStale = prev.length >= 5 && sum <= Math.min(...prev.slice(-5));
          if (progressGrew) this._creditLastGrowthAt = Date.now();
          prev.push(sum);
          if (prev.length > 6) prev.shift();
        }
      } catch (error) {
        // без инвентаря живём по ответу о сессии
      }

      // Ни ответа о сессии, ни инвентаря — нового ничего: прежний вердикт
      // остаётся. Иначе при сбое обоих запросов индикатор на минуту
      // прыгал с «Зачёт идёт» на «Жду зачёт от Twitch»
      if (!sampled && !inventoryKnown) return;

      const verdict = window.DropCredit.evaluate({
        startedAt: this._creditStartedAt,
        login,
        samples: this._creditSamples,
        progressGrew,
        progressStale,
        // Сколько минуты стоят — по инвентарю, без ответа о сессии
        staleForMs: inventoryKnown ? Date.now() - this._creditLastGrowthAt : 0,
        hasWatchable: inventoryKnown ? hasWatchable : true
      });
      this.renderDropCredit(verdict);

      if (verdict.state === 'ok' && this._noCreditStreak?.categoryId === this.currentCategory?.id) {
        this._noCreditStreak = null;
      }

      if (verdict.state !== 'none') {
        this._creditStrikes = 0;
        return;
      }

      // Если у игры вообще нет кампаний, ждать зачёт не от чего — этим
      // занимается проверка выгодности, а не смена стрима
      if (!this._lastMatchedCount) return;

      this._creditStrikes += 1;
      if (this._creditStrikes >= 2) {
        this._creditStrikes = 0;
        await this.onNoCredit(verdict);
      }
    };

    this._creditFirstTick = setTimeout(tick, 90 * 1000);
    this.dropCreditInterval = setInterval(tick, 60 * 1000);
  }

  renderDropCredit(verdict) {
    const box = document.getElementById('sidebar-drops-credit');
    const text = document.getElementById('sidebar-drops-credit-text');
    if (!box || !text) return;

    box.dataset.state = verdict?.state || 'waiting';
    // reason — русский код причины (DropCredit сравнивает по нему), на
    // экран — его пояснение на языке интерфейса
    box.title = window.DropCredit?.explain ? window.DropCredit.explain(verdict) : (verdict?.reason || '');
    text.textContent = window.DropCredit ? window.DropCredit.describe(verdict) : '';
  }

  /** Сколько каналов подряд не засчитывают, прежде чем отложить категорию. */
  static get NO_CREDIT_STREAMS_BEFORE_LEAVING() {
    return 3;
  }

  /** Twitch подтвердил: этот канал не засчитывает. Ищем другой в категории. */
  async onNoCredit(verdict) {
    // Без сессии ничего не переключаем: иначе остановленный фарминг мог
    // сам включить плеер, и видео шло без учёта
    if (!this.sessionStartTime) return;
    if (this._destroyed || !this.currentStream || !this.currentCategory) return;

    const login = this.currentStream.login;
    console.warn('[Зачёт] Канал не засчитывает дропсы:', login, '—', verdict?.reason || '');

    // Тосты — один раз на канал: проверка повторяется каждые две минуты,
    // и раньше одно и то же сообщение висело всю ночь
    if (window.settings && window.settings.get('autoSwitchStreams') === false) {
      this.toastOnce('nocredit:' + login, tr('Канал не засчитывает дропсы. Автопереключение выключено'), 'warning');
      return;
    }

    // Несколько каналов подряд в одной категории не засчитывают — дело не в
    // канале, а в категории (кампания привязана к другим стримерам, Twitch
    // не ведёт зачёт). Раньше приложение часами перебирало два канала
    // одной игры по кругу. Теперь после третьего отказа категория
    // откладывается на два часа и фарминг идёт дальше
    const categoryId = this.currentCategory.id;
    if (!this._noCreditStreak || this._noCreditStreak.categoryId !== categoryId) {
      this._noCreditStreak = { categoryId, count: 0 };
    }
    this._noCreditStreak.count += 1;
    if (this._noCreditStreak.count >= FarmingPage.NO_CREDIT_STREAMS_BEFORE_LEAVING) {
      const name = this.currentCategory.name;
      this._noCreditStreak = null;
      if (!this._noStreamsUntil) this._noStreamsUntil = new Map();
      const now = Date.now();
      const elsewhere = this.categories.some(cat => cat.enabled && cat.id !== categoryId &&
        cat.hasDrops && !cat.dropsCompleted && !((this._noStreamsUntil.get(cat.id) || 0) > now));

      if (this.isManualCategoryActive() || this.isSingleManualPlayLocked()) {
        // Категорию, запущенную кнопкой Play, приложение само не меняет —
        // предлагает перейти, а каналы внутри неё перебирает дальше. Раньше
        // и для неё писалось «Категория отложена… перехожу к другой», а
        // переход тут же отменяла защита ручного запуска
        this.showSwitchOffer('noCredit');
      } else if (elsewhere) {
        this._noStreamsUntil.set(categoryId, now + 2 * 60 * 60 * 1000);
        console.warn('[Зачёт] В категории не засчитывает ни один канал — откладываю на 2 ч:', name);
        window.eventLog?.add?.({ type: 'warning', title: tr('Категория отложена'), detail: tr('{name}: Twitch не засчитывает минуты ни на одном канале', { name }), game: name });
        this.toastOnce('nocredit-cat:' + categoryId, tr('{name}: Twitch не засчитывает минуты — перехожу к другой категории', { name }), 'warning');
        await this.switchToNextEnabledCategory({ reason: 'noCredit' });
        return;
      } else {
        // Перейти некуда: других категорий с дропсами нет или все отложены.
        // Отложить единственную значило остановить фарминг с «никто не
        // стримит» и через 15 минут вернуться в неё же — по кругу всю ночь.
        // Перебираем каналы дальше: зачёт может появиться и позже
        console.warn('[Зачёт] В категории не засчитывает ни один канал, перейти некуда — перебираю каналы:', name);
      }
    }

    this.toastOnce('nocredit:' + login, tr('Канал не засчитывает дропсы, ищу другой'), 'warning');
    const result = await this.switchToNextStream({ quiet: true });

    // Других стримов в категории нет — пробуем другие категории (у ручной
    // категории switchToNextEnabledCategory сам покажет предложение)
    if (result === 'none' && !this._destroyed && this.currentStream?.login === login) {
      await this.switchToNextEnabledCategory({ reason: 'noCredit' });
    }
  }
  
  
  setupViewersChart() {
    const viewersEl = document.getElementById('stream-viewers');
    const canvas = document.getElementById('viewers-chart');
    
    if (!viewersEl || !canvas) return;
    if (this._viewersChartCanvas === canvas) return;
    this._viewersChartCanvas = canvas;
    
    const ctx = canvas.getContext('2d');
    let isShowing = false;
    
    // Область срабатывания — подпись «N зрителей» целиком
    const targetElement = viewersEl.closest('.stream-meta-viewers') || viewersEl.parentElement || viewersEl;

    const showChart = () => {
      if (isShowing) return;
      isShowing = true;

      const rect = targetElement.getBoundingClientRect();
      // Под подписью, правым краем к ней; не выходит за окно. Размер
      // узнаём, только когда подсказка уже видна (у скрытой он нулевой)
      canvas.style.display = 'block';
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      const left = Math.min(Math.max(10, rect.right - width), window.innerWidth - width - 10);
      let top = rect.bottom + 8;
      if (top + height > window.innerHeight - 10) top = Math.max(10, rect.top - height - 8);
      canvas.style.left = Math.max(10, left) + 'px';
      canvas.style.top = top + 'px';
      this.drawViewersChart(ctx);
    };
    
    const hideChart = () => {
      isShowing = false;
      canvas.style.display = 'none';
    };
    
    targetElement.addEventListener('mouseenter', showChart);
    targetElement.addEventListener('mouseleave', hideChart);
    
    // Также следим за canvas чтобы не скрывался если мышь на нём
    canvas.addEventListener('mouseenter', () => {
      isShowing = true;
    });
    
    canvas.addEventListener('mouseleave', hideChart);
  }
  
  drawViewersChart(ctx) {
    // Отрисовка вынесена в features/farming/viewers-chart.js —
    // это чистая работа с canvas, состояние страницы ей не нужно
    window.drawViewersChart(ctx, this.viewersHistory);
  }

  // === Навигация между стримами и категориями ===

  beginStreamOperation() {
    this._streamRevision = (this._streamRevision || 0) + 1;
    return this._streamRevision;
  }

  isStreamOperationCurrent(revision) {
    return !this._destroyed && revision === (this._streamRevision || 0);
  }

  streamSnapshot() {
    return { revision: this._playbackRevision || 0, category: this.currentCategory, login: this.currentStream?.login };
  }

  isCurrentStream(snapshot) {
    return !this._destroyed && snapshot.revision === (this._playbackRevision || 0) &&
      snapshot.category === this.currentCategory && snapshot.login === this.currentStream?.login;
  }
  
  /**
   * Другой стрим в той же категории (кнопка «Другой стрим» и автоматика).
   *
   * Возвращает 'switched', 'none' (в категории больше некого смотреть),
   * 'error' (Twitch не ответил — решать пока нечего) или undefined, если
   * операцию перебила более новая. По 'none' автоматика идёт дальше — в
   * другую категорию; кнопка остаётся в пределах категории.
   *
   * options.quiet — без тостов «Ищем…» и «стримов нет»: при автоматическом
   * переключении их повторение раз в минуту только мешало, а итог
   * («Переключено на…» или «Фарминг остановлен…») скажет следующий шаг.
   */
  async switchToNextStream(options = {}) {
    if (!this.currentCategory || !this.currentStream) {
      window.utils.showToast(tr('Нет активного стрима'), 'warning');
      return 'none';
    }

    const revision = this.beginStreamOperation();
    const snapshot = this.streamSnapshot();
    try {
      if (!options.quiet) window.utils.showToast(tr('Ищем следующий стрим...'), 'info');

      // Получаем стримы текущей категории
      const streams = await window.electronAPI.getStreamsWithDrops(this.currentCategory.name);
      if (!this.isStreamOperationCurrent(revision) || !this.isCurrentStream(snapshot)) return;

      if (!Array.isArray(streams)) {
        window.utils.showToast(tr('Twitch не отвечает, попробуйте позже'), 'warning');
        return 'error';
      }

      if (streams.length === 0) {
        if (!options.quiet) window.utils.showToast(tr('Нет доступных стримов'), 'warning');
        return 'none';
      }

      // Явно исключаем текущий канал: иначе выбор мог вернуть тот же самый,
      // и кнопка «Другой стрим» выглядела бы неработающей
      const nextStream = await this.pickPreferredStream(
        streams,
        this.currentCategory.name,
        { exclude: this.currentStream?.login, quiet: !!options.quiet }
      );
      if (!this.isStreamOperationCurrent(revision) || !this.isCurrentStream(snapshot)) return;

      if (nextStream && nextStream.login === this.currentStream?.login) {
        if (!options.quiet) window.utils.showToast(tr('Других стримов в этой категории нет'), 'warning');
        return 'none';
      }

      if (nextStream) {
        // Переключаемся на следующий стрим
        await this.switchToStream(nextStream);
        window.utils.showToast(tr('Переключено на {name}', { name: nextStream.displayName }), 'success');
        return 'switched';
      }

      // Кампания засчитывается только на своих каналах, и никого из них
      // нет в эфире (без quiet об этом уже сказал pickPreferredStream)
      return 'none';
    } catch (error) {
      console.error('Error switching stream:', error);
      window.utils.showToast(tr('Ошибка переключения стрима'), 'error');
      return 'error';
    }
  }

  async switchToPrevCategory() {
    const revision = this.beginStreamOperation();
    // Фильтруем только активные категории
    const activeCategories = this.categories.filter(c => c.enabled !== false);
    
    if (activeCategories.length < 2) {
      window.utils.showToast(tr('Добавьте больше активных категорий'), 'warning');
      return;
    }

    if (!this.currentCategory || !this.sessionStartTime) {
      window.utils.showToast(tr('Нет активной категории'), 'warning');
      return;
    }

    // Сохраняем статистику текущей категории
    await this.noteCategoryWatchTime();
    if (!this.isStreamOperationCurrent(revision)) return;

    try {
      // Находим текущую категорию в активных
      const currentIndex = activeCategories.findIndex(c => c.id === this.currentCategory.id);
      
      // Берем предыдущую категорию (или последнюю если в начале)
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : activeCategories.length - 1;
      const prevCategory = activeCategories[prevIndex];
      
      window.utils.showToast(tr('Ищем стримы в {name}...', { name: prevCategory.name }), 'info');
      
      // Получаем стримы для предыдущей категории
      const streams = await window.electronAPI.getStreamsWithDrops(prevCategory.name);
      if (!this.isStreamOperationCurrent(revision)) return;

      // Не ответил — не то же самое, что «стримов нет»
      if (!Array.isArray(streams)) {
        window.utils.showToast(tr('Twitch не ответил по категории {name}', { name: prevCategory.name }), 'warning');
        return;
      }
      
      if (streams.length === 0) {
        window.utils.showToast(tr('Нет доступных стримов'), 'warning');
        return;
      }
      
      // Запускаем первый стрим
      const stream = await this.pickPreferredStream(streams, prevCategory.name);
      if (!this.isStreamOperationCurrent(revision)) return;
      if (!stream?.login) {
        window.utils.showToast(tr('В категории {name} нет подходящего стрима', { name: prevCategory.name }), 'warning');
        return;
      }
      this.currentCategory = prevCategory;
      this.currentStream = stream;
      this.resetCategoryCounters(prevCategory);
      this.resetChannelPointsTracking();
      
      // Смена канала — единственный случай, когда перезагрузка плеера уместна
      window.playerManager?.load(stream.login);
      
      // Чат переводим на новый канал (он живёт вне страницы и не перезагружается зря)
      window.chatManager?.load(stream.login);
      
      if (!this.updateCurrentStreamUI(stream, prevCategory)) {
        this.startStreamStatsUpdate(stream.login);
      }

      // Сохраняем сессию, иначе в хранилище останется прежняя категория:
      // стоило уйти на другую вкладку и вернуться, как приложение
      // восстанавливало старую и откатывало стрим назад
      await this.saveActiveSession(stream, prevCategory);
      if (!this.isStreamOperationCurrent(revision)) return;

      window.utils.showToast(tr('Переключено на {name}', { name: prevCategory.name }), 'success');
    } catch (error) {
      console.error('Error switching to prev category:', error);
      window.utils.showToast(tr('Ошибка переключения категории'), 'error');
    }
  }

  async switchToNextCategory() {
    const revision = this.beginStreamOperation();
    // Фильтруем только активные категории
    const activeCategories = this.categories.filter(c => c.enabled !== false);
    
    if (activeCategories.length < 2) {
      window.utils.showToast(tr('Добавьте больше активных категорий'), 'warning');
      return;
    }

    if (!this.currentCategory || !this.sessionStartTime) {
      window.utils.showToast(tr('Нет активной категории'), 'warning');
      return;
    }

    // Сохраняем статистику текущей категории
    await this.noteCategoryWatchTime();
    if (!this.isStreamOperationCurrent(revision)) return;

    try {
      // Находим текущую категорию в активных
      const currentIndex = activeCategories.findIndex(c => c.id === this.currentCategory.id);
      
      // Берем следующую категорию (или первую если в конце)
      const nextIndex = (currentIndex + 1) % activeCategories.length;
      const nextCategory = activeCategories[nextIndex];
      
      window.utils.showToast(tr('Ищем стримы в {name}...', { name: nextCategory.name }), 'info');
      
      // Получаем стримы для следующей категории
      const streams = await window.electronAPI.getStreamsWithDrops(nextCategory.name);
      if (!this.isStreamOperationCurrent(revision)) return;

      // Не ответил — не то же самое, что «стримов нет»
      if (!Array.isArray(streams)) {
        window.utils.showToast(tr('Twitch не ответил по категории {name}', { name: nextCategory.name }), 'warning');
        return;
      }
      
      if (streams.length === 0) {
        window.utils.showToast(tr('Нет доступных стримов'), 'warning');
        return;
      }
      
      // Запускаем первый стрим
      const stream = await this.pickPreferredStream(streams, nextCategory.name);
      if (!this.isStreamOperationCurrent(revision)) return;
      if (!stream?.login) {
        window.utils.showToast(tr('В категории {name} нет подходящего стрима', { name: nextCategory.name }), 'warning');
        return;
      }
      this.currentCategory = nextCategory;
      this.currentStream = stream;
      this.resetCategoryCounters(nextCategory);
      this.resetChannelPointsTracking();
      
      // Смена канала — единственный случай, когда перезагрузка плеера уместна
      window.playerManager?.load(stream.login);
      
      // Чат переводим на новый канал (он живёт вне страницы и не перезагружается зря)
      window.chatManager?.load(stream.login);
      
      if (!this.updateCurrentStreamUI(stream, nextCategory)) {
        this.startStreamStatsUpdate(stream.login);
      }
      await this.saveActiveSession(stream, nextCategory);
      if (!this.isStreamOperationCurrent(revision)) return;

      window.utils.showToast(tr('Переключено на {name}', { name: nextCategory.name }), 'success');
    } catch (error) {
      console.error('Error switching to next category:', error);
      window.utils.showToast(tr('Ошибка переключения категории'), 'error');
    }
  }

  toggleChat() {
    // Сначала проверяем наличие необходимых элементов
    const playerContainer = document.getElementById('twitch-player-container');
    const chatContainer = document.getElementById('twitch-chat-container');
    const chatSlot = document.getElementById('farming-chat-slot');
    const grid = document.getElementById('player-chat-grid');

    if (!playerContainer || !chatContainer || !chatSlot || !grid) {
      window.utils.showToast(tr('Чат не найден'), 'error');
      return;
    }

    // Проверяем видим ли контейнер плеера (значит стрим активен)
    if (playerContainer.style.display === 'none') {
      window.utils.showToast(tr('Нет активного стрима'), 'warning');
      return;
    }

    const channel = this.currentStream?.login;
    
    if (!channel) {
      window.utils.showToast(tr('Нет активного стрима'), 'warning');
      return;
    }
    
    // Переключаем видимость чата
    if (chatContainer.style.display === 'none') {
      // Показываем чат с анимацией
      chatContainer.style.display = 'block';
      grid.style.gridTemplateColumns = '1fr 340px'; // Плеер + Чат
      // Плеер с чатом — во всю ширину, колонка статуса уходит под них
      document.getElementById('farm-hero')?.classList.add('has-chat');

      // Чат уже загружен в фоне ради автосбора сундуков — здесь его достаточно
      // показать. Перезагрузка сбросила бы сборщик и накопленное состояние.
      window.chatManager?.load(channel);
      window.chatManager?.attachTo(chatSlot);

      // Запускаем анимацию появления
      setTimeout(() => {
        chatContainer.style.opacity = '1';
        chatContainer.style.transform = 'translateX(0)';
      }, 10);
      
      window.utils.showToast(tr('Чат показан'), 'info');
    } else {
      // Скрываем чат с анимацией (но не выгружаем, чтобы автосбор продолжал работать)
      chatContainer.style.opacity = '0';
      chatContainer.style.transform = 'translateX(20px)';
      grid.style.gridTemplateColumns = '1fr'; // Только плеер
      document.getElementById('farm-hero')?.classList.remove('has-chat');
      
      setTimeout(() => {
        chatContainer.style.display = 'none';
        // Отвязываем от слота, но НЕ выгружаем: автосбор сундуков
        // должен продолжать работать в фоне
        window.chatManager?.detach();
      }, 300); // Ждем завершения анимации
      
      window.utils.showToast(tr('Чат скрыт'), 'info');
    }
  }
  
  // Кнопки «Подписаться на канал» в разметке нет, а проверка подписки при
  // каждой смене стрима слала в Twitch два заведомо неудачных запроса.
  // Методы followCurrentChannel и checkFollowingStatus удалены вместе с ней.
  
  toggleNotifications() {
    if (!this.currentStream) {
      window.utils.showToast(tr('Нет активного стрима'), 'warning');
      return;
    }
    
    const channelUrl = `https://www.twitch.tv/${this.currentStream.login}`;
    window.electronAPI.openExternal(channelUrl);
    window.utils.showToast(tr('Откройте страницу канала для настройки уведомлений'), 'info');
  }

  async switchToStream(stream) {
    // Сессия уже остановлена (например, по простою) — плеер не включаем
    if (!this.sessionStartTime) return;
    const player = window.playerManager?.getWebview();
    if (!player) return;
    this.beginStreamOperation();

    // Обновляем текущий стрим
    this.currentStream = stream;
    this.resetChannelPointsTracking();

    // Переключаем плеер на другой канал
    window.playerManager.load(stream.login);
    
    // Чат переводим на новый канал
    window.chatManager?.load(stream.login);
    
    // Обновляем информацию о стриме. Статистику запускает он же, второй
    // запуск нужен только когда разметки страницы нет
    if (!this.updateCurrentStreamUI(stream, this.currentCategory)) {
      this.startStreamStatsUpdate(stream.login);
    }

    // Смена стрима тоже должна попадать в сохранённую сессию: иначе после
    // возврата на вкладку приложение вернуло бы прежний канал
    if (this.currentCategory) {
      await this.saveActiveSession(stream, this.currentCategory);
    }

    // Автоматически кликаем на кнопку Continue Watching если появится mature content warning
    this.setupMatureContentHandler(player);
  }
  
  setupMatureContentHandler(player) {
    if (!player) return;
    
    // Ждем загрузки страницы
    const checkMatureContent = () => {
      // Русское внутри строки — только комментарии кода для страницы Twitch
      player.executeJavaScript(/* i18n-ignore */ `
        (function() {
          // Ищем кнопку "Continue Watching" или "Start Watching"
          const selectors = [
            'button[data-a-target="player-overlay-mature-accept"]',
            'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
            'button:has-text("Start Watching")',
            'button:has-text("Continue Watching")',
            'button[class*="consent-banner"] button[class*="primary"]',
            'button[aria-label*="Start Watching"]',
            'button[aria-label*="Continue"]'
          ];
          
          for (const selector of selectors) {
            try {
              const button = document.querySelector(selector);
              if (button && button.offsetParent) {
                console.log('✅ Found mature content button, clicking...', selector);
                button.click();
                return true;
              }
            } catch (e) {}
          }
          
          // Проверяем текст кнопок
          const allButtons = document.querySelectorAll('button');
          for (const btn of allButtons) {
            const text = (btn.textContent || btn.innerText || '').toLowerCase();
            if (text.includes('start watching') || 
                text.includes('continue watching') ||
                text.includes('i understand')) {
              console.log('✅ Found mature content button by text, clicking...', text);
              btn.click();
              return true;
            }
          }
          
          return false;
        })();
      `).catch(e => console.log('Error checking mature content:', e));
    };
    
    // Проверяем сразу после загрузки
    player.addEventListener('dom-ready', () => {
      setTimeout(checkMatureContent, 2000);
      // Проверяем повторно через 5 секунд
      setTimeout(checkMatureContent, 5000);
    }, { once: true });
    
    // Также проверяем периодически в течение первой минуты.
    // Плеер теперь постоянный, поэтому старый интервал обязательно гасим —
    // иначе при каждой смене канала их накапливалось бы всё больше.
    if (this.matureCheckInterval) {
      clearInterval(this.matureCheckInterval);
    }
    let checks = 0;
    this.matureCheckInterval = setInterval(() => {
      checks++;
      checkMatureContent();
      if (checks >= 6) { // 6 проверок = 1 минута
        clearInterval(this.matureCheckInterval);
        this.matureCheckInterval = null;
      }
    }, 10000);
  }

  /**
   * Формирует скрипт автосбора бонусных сундуков и отдаёт его ChatManager.
   *
   * Само внедрение делает ChatManager при каждой загрузке чата: инъекция
   * пропадает после смены канала, а чат теперь переживает навигацию.
   */
  startBonusAutoCollector() {
    // Сам скрипт вынесен в features/farming/bonus-collector-script.js:
    // это 150 строк кода, исполняемого внутри чата, и к странице они
    // отношения не имеют.
    window.chatManager?.setCollectorScript(window.BONUS_COLLECTOR_SCRIPT);
  }

  startBackgroundBonusCollector(channelLogin) {
    const chat = window.chatManager;
    if (!chat) {
      console.error('[Chest] ChatManager недоступен');
      return;
    }

    if (chat.isReadyFor(channelLogin)) {
      this.startPointsPolling();
      console.log('[Chest] Сборщик уже работает для', channelLogin);
      return;
    }

    // Без фонового чата сундуки забирает main запросом при опросе баллов
    if (window.ChatManager && !window.ChatManager.enabled) {
      this.startPointsPolling();
      return;
    }

    console.log('[Chest] Запускаю фоновый сборщик сундуков для', channelLogin);

    // Скрипт регистрируем до загрузки: ChatManager внедрит его сам,
    // как только документ чата будет готов
    this.startBonusAutoCollector();
    chat.load(channelLogin);

    this.startPointsPolling();
  }
  
  /**
   * Опрос баллов ведёт SessionState — он переживает навигацию.
   * Раньше интервал принадлежал странице и гасился её destroy(), поэтому
   * баллы начислялись только пока страница фарминга открыта.
   */
  startPointsPolling() {
    window.sessionState?.startPointsPolling(this.currentStream?.login);
  }
  
  updateChannelPointsUI() {
    window.sessionState?.renderPoints();
  }

  /** Смена стрима: счётчики текущего стрима обнуляются, сессионные остаются. */
  resetChannelPointsTracking() {
    window.sessionState?.onStreamChanged(this.currentStream?.login);
  }

  /** Полный сброс — только при старте новой сессии фарминга. */
  resetSessionPointsTracking() {
    window.sessionState?.resetPoints();
    this._sessionDropsBaseline = null;
    this._sessionCountedDrops = null;
    this._sessionSeenCampaigns = null;
  }

  /**
   * Действие после того, как все награды кампании собраны.
   *
   * Раньше блок просто сообщал «Все дропсы получены» и на этом всё:
   * если приложение не переключало категорию само (например, её запустили
   * вручную), дальше нужно было догадаться пойти и переключить руками.
   * Показываем, куда можно перейти, и даём это сделать одним нажатием.
   */
  renderNextCategoryAction() {
    const box = document.getElementById('drops-done-actions');
    if (!box) return;

    const next = this.categories.find(cat =>
      cat.enabled !== false &&
      cat.hasDrops &&
      !cat.dropsCompleted &&
      cat.id !== this.currentCategory?.id
    );

    if (!next) {
      box.innerHTML = `<span class="drops-done-hint">${tr('Других категорий с дропсами сейчас нет')}</span>`;
      return;
    }

    box.innerHTML = `
      <button class="btn btn-primary btn-sm" id="drops-next-category">
        ${window.Icons?.get('play', 14) ?? ''}
        <span>${tr('Перейти к «{name}»', { name: this.esc(next.name) })}</span>
      </button>
    `;

    box.querySelector('#drops-next-category').addEventListener('click', async () => {
      // Пользователь решил сам, поэтому отметка ручного запуска снимается:
      // иначе защита от автопереключения удержала бы его на этой категории
      this.manualCategoryId = null;
      this.manualPlayLockCategoryId = null;
      await this.startFarmingForCategory(next);
    });
  }

  /**
   * Предупреждает, что кампания скоро закончится, а награды ещё не собраны.
   *
   * Фарминг фоновый: без уведомления о том, что до конца кампании час, а
   * дропс недобран, пользователь узнаёт об этом когда уже поздно.
   * Предупреждаем один раз на кампанию, иначе это превратится в напоминание
   * каждые полминуты.
   */
/**
   * Пересчитывает выгодность категорий по свежим данным о кампаниях.
   *
   * Результат — карта «название игры → оценка», которой пользуется
   * сортировка при выборе следующей категории.
   */
  /**
   * Подсказывает игру с дропсами, которой нет в списке категорий.
   *
   * Приложение видит все кампании Twitch, но пользовалось этим только для
   * своих категорий: узнать, что рядом идёт кампания выгоднее текущей,
   * было неоткуда — оставалось искать вручную.
   *
   * Показываем ровно одну, самую выгодную: список из двадцати «а ещё
   * посмотри вот это» превратился бы в шум.
   */
  renderCategorySuggestion(allCampaigns) {
    const box = document.getElementById('category-suggestion');
    if (!box) return;

    const CV = window.CampaignValue;
    const SP = window.StreamPicker;
    if (!CV || !SP || !Array.isArray(allCampaigns)) return;

    if (window.settings?.get('suggestCategories') === false) {
      box.innerHTML = '';
      return;
    }

    const now = Date.now();
    const скрытые = this._dismissedSuggestions || (this._dismissedSuggestions = new Set());

    const кандидаты = allCampaigns.filter(campaign => {
      if (!Array.isArray(campaign.drops) || campaign.drops.length === 0) return false;

      const game = campaign.game?.displayName || campaign.game?.name || campaign.name;
      if (!game || скрытые.has(game)) return false;

      // Уже в списке — предлагать нечего
      if (this.categories.some(cat => SP.isExactGame(cat.name, game, cat.id, campaign.game?.id))) return false;
      // Удалённую пользователем игру не навязываем снова
      if (this._deletedCategoryKeys?.has(this.normalizeGameKey(game))) return false;

      const value = CV.evaluate(campaign, now);
      return value.feasible && value.perHour > 0;
    });

    if (кандидаты.length === 0) {
      box.innerHTML = '';
      return;
    }

    кандидаты.sort((a, b) => CV.compare(a, b, now));
    const лучшая = кандидаты[0];
    const game = лучшая.game?.displayName || лучшая.game?.name || лучшая.name;
    const value = CV.evaluate(лучшая, now);

    // Общее экранирование страницы — одно на всё приложение
    const escape = (text) => this.esc(text);

    // Тихая строка: в очереди главное — сама очередь. Одна вторичная
    // кнопка «Добавить» и крестик «не предлагать»
    box.innerHTML = `
      <div class="suggestion" role="status">
        <img class="suggestion-art" src="${escape(this.boxArtSrc(лучшая.game?.boxArtURL, '52x72', лучшая.game?.id))}"
             alt="" onerror="this.style.visibility='hidden'">
        <div class="suggestion-text">
          <div class="suggestion-title">${tr('{game} — {count} {word} за час', {
            game: escape(game), count: value.perHour, word: this.plural(value.perHour, 'награда', 'награды', 'наград')
          })}</div>
          <div class="suggestion-sub">${tr('Игры нет в очереди · до конца кампании {time}', { time: window.CampaignCalendar.formatLeft(value.minutesLeft) })}</div>
        </div>
        <button class="btn btn-secondary btn-sm suggestion-add" id="suggestion-add">${window.Icons?.get('plus', 14) ?? ''}<span>${tr('Добавить')}</span></button>
        <button class="btn btn-ghost btn-icon btn-sm suggestion-hide" id="suggestion-hide" title="${tr('Не предлагать эту игру')}" aria-label="${tr('Не предлагать эту игру')}">${window.Icons?.get('close', 14) ?? '✕'}</button>
      </div>
    `;

    // Кнопка гаснет на время запроса: быстрый двойной клик добавлял две
    // одинаковые категории с одним id
    const addBtn = box.querySelector('#suggestion-add');
    addBtn.addEventListener('click', async () => {
      if (addBtn.disabled) return;
      addBtn.disabled = true;
      try {
        await this.addSuggestedCategory(game, лучшая);
      } finally {
        addBtn.disabled = false;
      }
    });
    box.querySelector('#suggestion-hide').addEventListener('click', () => {
      скрытые.add(game);
      box.innerHTML = '';
    });
  }

  /** Добавляет предложенную игру в список категорий. */
  async addSuggestedCategory(game, campaign) {
    try {
      let fresh = null;
      try {
        const all = await window.electronAPI.fetchTwitchCategories();
        fresh = (all || []).find(c => window.StreamPicker.isExactGame(c.name, game, c.id, campaign?.game?.id)) || null;
      } catch (e) {
        // без свежих данных категория тоже работает
      }

      const id = fresh?.id || campaign.game?.id || ('sug-' + String(game).toLowerCase().replace(/\s+/g, '-'));
      const name = fresh?.name || game;

      // Пока шёл запрос, ту же игру могли добавить другим путём (второй
      // клик, календарь, выбор категорий) — второй раз не добавляем
      const SP = window.StreamPicker;
      const exists = this.categories.some(cat =>
        String(cat.id) === String(id) ||
        SP.isExactGame(cat.name, name, cat.id, fresh?.id || campaign?.game?.id));
      if (exists) {
        const box = document.getElementById('category-suggestion');
        if (box) box.innerHTML = '';
        return;
      }

      this.categories.push({
        id,
        name,
        boxArtURL: this.normalizeBoxArtURL(fresh?.boxArtURL || campaign.game?.boxArtURL, '52x72'),
        viewersCount: fresh?.viewersCount || 0,
        tags: fresh?.tags || [],
        hasDrops: true,
        enabled: true,
        priority: this.categories.length + 1,
        dropsCompleted: false
      });

      await this.setCategoryDeleted(fresh?.name || game, false);
      await this.saveCategories();
      this.renderCategories();

      const box = document.getElementById('category-suggestion');
      if (box) box.innerHTML = '';

      window.utils?.showToast(tr('«{game}» добавлена в категории', { game }), 'success');
    } catch (error) {
      console.error('[Подсказка] Не удалось добавить категорию:', error);
      window.utils?.showToast(tr('Не удалось добавить категорию'), 'error');
    }
  }

  updateCategoryValues(allCampaigns) {
    const CV = window.CampaignValue;
    if (!CV || !Array.isArray(allCampaigns)) return;

    const now = Date.now();
    const values = new Map();

    for (const campaign of allCampaigns) {
      if (!Array.isArray(campaign.drops) || campaign.drops.length === 0) continue;

      const game = campaign.game?.displayName || campaign.game?.name || campaign.name;
      if (!game) continue;

      const key = String(game).toLowerCase();
      const value = CV.evaluate(campaign, now);
      const known = values.get(key);

      // У игры может идти несколько кампаний сразу — берём лучшую
      if (!known || CV.compare(campaign, known.campaign, now) < 0) {
        values.set(key, { ...value, campaign });
      }
    }

    this._categoryValues = values;
  }

  /**
   * Оценка категории по названию игры.
   *
   * Точного совпадения мало: в списке категорий имя может быть записано
   * не так, как его отдаёт Twitch, поэтому при промахе сверяемся тем же
   * способом, что и везде в приложении.
   */
  getCategoryValue(category) {
    if (!this._categoryValues || !category?.name) return null;

    const exact = this._categoryValues.get(String(category.name).toLowerCase());
    if (exact) return exact;

    for (const [name, value] of this._categoryValues) {
      if (this.isSameGame(category.name, name)) return value;
    }
    return null;
  }

  /**
   * Сравнение категорий по выгоде: успеваем ли и сколько наград за час.
   *
   * Ноль означает «не мне решать» — тогда работают прежние правила
   * сортировки. Так же ведёт себя выключенная настройка.
   */
  compareCategoryValue(a, b) {
    if (window.settings?.get('smartCategorySwitch') === false) return 0;

    const va = this.getCategoryValue(a);
    const vb = this.getCategoryValue(b);

    // Порядок: выполнимые, затем без оценки, и только потом безнадёжные.
    // Раньше категория без оценки шла после любой оценённой — в том числе
    // после той, где наград заведомо не успеть, и ночь уходила на неё.
    const rank = (v) => (!v ? 1 : (v.feasible ? 0 : 2));
    if (rank(va) !== rank(vb)) return rank(va) - rank(vb);
    if (!va || !vb) return 0;

    if (va.perHour !== vb.perHour) return vb.perHour - va.perHour;
    if (va.minutesLeft !== vb.minutesLeft) return va.minutesLeft - vb.minutesLeft;
    return 0;
  }

  /**
   * Подтягивает свежие оценки кампаний перед выбором категории.
   *
   * Нужна при запуске фарминга: карта оценок наполняется во время
   * сессии, а на старте она ещё пуста — без этого первая категория
   * выбиралась бы вслепую, в том числе безнадёжная.
   */
  async refreshCategoryValues() {
    if (window.settings?.get('smartCategorySwitch') === false) return;
    if (!window.electronAPI?.fetchDropsInventory) return;

    try {
      const result = await window.electronAPI.fetchDropsInventory();
      if (result?.campaigns) this.updateCategoryValues(result.campaigns);
    } catch (e) {
      // Без оценок просто работают прежние правила сортировки
      console.warn('[Дропсы] Не удалось обновить оценки категорий:', e.message);
    }
  }

  /**
   * Стоит ли продолжать смотреть текущую категорию.
   *
   * Причина появления: фарминг шёл всю ночь на кампании, где из двух
   * наград одна была получена, а вторая требовала больше времени, чем
   * оставалось до конца кампании. Переключение висело на условии
   * «получены все награды» — и оно в такой ситуации не выполняется
   * никогда. Вдобавок проверка жила в функции, которую никто не вызывал,
   * так что автопереключение не срабатывало вообще ни разу.
   *
   * Условие теперь другое: осталась ли награда, которую мы реально
   * успеваем взять. Проверяется на каждом обновлении дропсов, потому что
   * кампания может стать безнадёжной прямо посреди сессии.
   */
/**
   * Показывает кнопку перехода с ручного фарма на автоматический.
   *
   * Категорию, запущенную кнопкой Play, приложение намеренно не
   * переключает само. Но узнать об этом было неоткуда, и со стороны
   * выглядело как сломанное автопереключение — кнопка объясняет
   * происходящее и даёт вернуться к автоматике, не останавливая сессию.
   */
  updateAutoFarmButton() {
    const btn = document.getElementById('sidebar-to-autofarm-btn');
    if (!btn) return;

    const show = !!this.sessionStartTime && this.isManualCategoryActive();
    btn.style.display = show ? 'flex' : 'none';
  }

  /**
   * Снимает отметку ручного запуска, не прерывая текущую сессию.
   *
   * Стрим продолжает играть; меняется только то, что дальше приложение
   * само уйдёт в следующую категорию, когда в этой брать станет нечего.
   */
  switchToAutoFarming() {
    if (!this.isManualCategoryActive()) return;

    console.log('[Фарминг] Ручной режим снят, дальше автоматически:', this.currentCategory?.name);

    this.manualCategoryId = null;
    this.manualPlayLockCategoryId = null;
    this._exhaustedCategoryId = null;

    this.updateAutoFarmButton();
    window.utils?.showToast(tr('Дальше категории переключаются автоматически'), 'success');
  }

  async checkCategoryStillWorthwhile(matched) {
    if (window.settings?.get('smartCategorySwitch') === false) return;

    const CV = window.CampaignValue;
    if (!CV || !this.currentCategory || !this.sessionStartTime) return;
    if (!Array.isArray(matched) || matched.length === 0) return;

    const now = Date.now();

    // Готовая награда ещё не забрана, а автосбор пробует снова: уходить
    // рано. CampaignValue считает такую награду полученной, и категорию
    // бросали — забирать её на чужой игре уже никто не пытался
    if (!CV.shouldLeave(matched, now) || this.hasPendingClaims(matched)) {
      this._exhaustedCategoryId = null;
      this._leaveVotes = 0;
      return;
    }

    // Уходить по одной выборке нельзя. Список кампаний приходит от Twitch
    // неровно: неполный ответ выглядит как «брать больше нечего», и
    // категория бросалась недоработанной. Требуем, чтобы приговор
    // повторился на следующей проверке.
    this._leaveVotes = (this._leaveVotes || 0) + 1;
    if (this._leaveVotes < 2) {
      console.log('[Дропсы] Похоже, брать нечего — жду подтверждения на следующей проверке');
      return;
    }
    this._leaveVotes = 0;

    const evaluations = matched.map(c => CV.evaluate(c, now));

    // Одну и ту же категорию не бросаем повторно каждые полминуты
    if (this._exhaustedCategoryId === this.currentCategory.id) return;
    this._exhaustedCategoryId = this.currentCategory.id;

    const tooLate = evaluations.find(e => e.reason === 'tooLate');
    const reason = tooLate
      ? CV.describe(tooLate)
      : (evaluations.every(e => e.reason === 'done') ? tr('Все награды получены') : tr('Кампания закончилась'));

    console.log('[Дропсы] Смысла продолжать нет:', this.currentCategory.name, '—', reason);

    const category = this.categories.find(c => c.id === this.currentCategory.id);
    if (category) {
      // Пометка снимается сама, когда у игры начинается новая кампания.
      // Какие кампании отработаны, запоминаем по id: без этого обновление
      // списка через полминуту снимало отметку с той же самой кампании.
      category.dropsCompleted = true;
      category.dropsCompletedDate = new Date().toISOString();
      category.skipReason = reason;
      category.skipCampaignIds = matched.map(c => c.id).filter(Boolean).sort().join(',');
      this.saveCategories().catch(() => {});
    }

    const doneText = tr('{name}: {reason}', { name: this.currentCategory.name, reason });
    window.notifyFarmingEvent?.(tr('Категория отработана'), doneText);
    window.utils?.showToast(doneText, 'warning');

    // Категорию, запущенную вручную, приложение не меняет само — как и
    // при отсутствии дропсов, только предлагаем переключиться
    if (this.isManualCategoryActive()) {
      console.log('[Ручной запуск] Категория отработана, но не меняем:', this.currentCategory.name);
      this.showSwitchOffer('done', reason);
      return;
    }

    await this.switchToNextEnabledCategory({ reason: 'done', detail: reason });
  }

  warnAboutEndingCampaigns(campaigns) {
    if (!this._endWarned) this._endWarned = new Set();

    const HOUR = 60 * 60 * 1000;

    for (const campaign of campaigns) {
      if (!campaign.endsAt || this._endWarned.has(campaign.id)) continue;

      const left = new Date(campaign.endsAt).getTime() - Date.now();
      if (left <= 0 || left > HOUR) continue;

      const unclaimed = (campaign.drops || []).filter(d => !this.isDropEarned(d));
      if (unclaimed.length === 0) continue;

      this._endWarned.add(campaign.id);

      const minutes = Math.max(1, Math.round(left / 60000));
      const name = campaign.name || campaign.game?.name || tr('Кампания');

      console.log('[Дропсы] Кампания заканчивается через', minutes, 'мин:', name);
      const detail = tr('{name}: {minutes} мин, не собрано наград — {count}', { name, minutes, count: unclaimed.length });
      window.notifyFarmingEvent(tr('Кампания скоро закончится'), detail);
      window.utils?.showToast(tr('{name}: осталось {minutes} мин, наград не собрано {count}', { name, minutes, count: unclaimed.length }), 'warning');
      window.eventLog?.add({
        type: 'warning',
        title: tr('Кампания скоро закончится'),
        detail,
        game: campaign.game?.name || campaign.game?.displayName || ''
      });
    }
  }

  /**
   * Забирает награды, у которых набралось нужное время просмотра.
   *
   * Настройка автосбора существовала, но не работала: механизм в
   * drops-manager никто не запускал, а написан он был под сырой формат
   * Twitch, тогда как приложение оперирует своим. Получалось, что
   * приложение честно наматывает часы, а забрать награду всё равно
   * нужно руками — при том, что смысл фарминга в обратном.
   *
   * Делаем это здесь, где данные о кампаниях уже загружены и обновляются
   * каждые 30 секунд.
   */
  async autoClaimReadyDrops(campaigns) {
    if (window.settings && window.settings.get('autoClaimDrops') === false) return;
    if (!window.electronAPI?.claimDrop) return;

    if (!this._claimAttempted) this._claimAttempted = new Set();
    if (!this._claimRetry) this._claimRetry = new Map();
    // Награды, уже полученные за этот запуск. Twitch ещё минуту-другую
    // отдаёт их в инвентаре как «готова к получению», и раньше приложение
    // «забирало» их каждые полминуты заново — с уведомлением, звуком и
    // записью в журнал на каждый круг
    if (!this._claimedIds) this._claimedIds = new Set();

    for (const campaign of campaigns) {
      for (const drop of (campaign.drops || [])) {
        const id = drop.dropInstanceID;
        if (!id) continue;                     // Twitch выдаёт его только у готовых наград
        // Второй ключ памяти этого запуска — id награды в кампании. Сам
        // dropInstanceID у Twitch постоянен («пользователь#кампания#награда»):
        // ночные «получения» раз в полчаса в логе были разными наградами
        // кампании, а не повтором одной. Ключ по id награды страхует от
        // ответа с другим хвостом. В журнал по-прежнему идёт dropInstanceID:
        // его же пишут «Получить» на странице дропсов и в окне награды, и по
        // нему журнал склеивает ручное и автоматическое получение
        const key = drop.id ? 'drop:' + drop.id : id;
        if (this._claimedIds.has(id) || this._claimedIds.has(key)) {
          drop.claimed = true;                 // устаревший ответ Twitch
          continue;
        }
        if (drop.claimed) continue;
        // Запрос по этой награде уже идёт
        if (this._claimAttempted.has(id)) continue;
        // После неудачи ждём паузу, а не долбим Twitch каждые 30 секунд
        const retry = this._claimRetry.get(id);
        if (retry && Date.now() < retry.nextAt) continue;

        const ready = drop.required > 0 && drop.progress >= drop.required;
        if (!ready && !drop.canClaim && !drop.isClaimable) continue;

        this._claimAttempted.add(id);

        const name = drop.benefitName || drop.name || tr('Награда');
        console.log('[Дропсы] Забираю награду:', name);

        let failure = null;
        try {
          const result = await window.electronAPI.claimDrop(id);

          if (result?.success && result.already) {
            // Twitch: «уже получена». Это не новая награда — её забрали
            // раньше (мы или на сайте), объявлять нечего
            drop.claimed = true;
            this._claimedIds.add(id);
            this._claimedIds.add(key);
            this._claimRetry.delete(id);
            console.log('[Дропсы] Уже получена раньше:', name);
          } else if (result?.success && window.eventLog?.hasKey?.(id)) {
            // После перезапуска память пуста, а Twitch на уже выданную
            // награду иногда отвечает «можно получить», а не «уже получена».
            // Журнал помнит id наград 14 дней — объявлять второй раз незачем
            drop.claimed = true;
            this._claimedIds.add(id);
            this._claimedIds.add(key);
            this._claimRetry.delete(id);
            console.log('[Дропсы] Уже объявлена раньше:', name);
          } else if (result?.success) {
            this._claimedIds.add(id);
            this._claimedIds.add(key);
            window.chime?.dropClaimed();
            drop.claimed = true;
            this._claimRetry.delete(id);
            window.utils?.showToast(tr('Награда получена: {name}', { name }), 'success');
            const game = campaign.game?.name || campaign.name || '';
            window.eventLog?.add({ type: 'drop', title: name, game, icon: drop.imageURL, key: id });
            // «2 из 4» — сколько наград кампании уже получено, вместе с этой
            const drops = campaign.drops || [];
            const extra = drops.length > 1
              ? { meta: tr('{done} из {total}', { done: drops.filter(d => this.isDropEarned(d)).length, total: drops.length }) }
              : undefined;
            window.showDropNotification?.(name, game, drop.imageURL, extra);
          } else {
            failure = result?.error || 'нет ответа'; // i18n-ignore: только для журнала консоли
          }
        } catch (error) {
          failure = error?.message || 'ошибка запроса'; // i18n-ignore: только для журнала консоли
        } finally {
          this._claimAttempted.delete(id);
        }

        if (failure) this.noteClaimFailure(id, name, failure);
      }
    }
  }

  /**
   * Неудачная попытка забрать награду.
   *
   * Раньше неудача была окончательной: id помечался «уже пробовали», и
   * повтора не было до перезапуска приложения. Нет cookie-токена, 429,
   * обрыв сети — и награда молча оставалась незабранной, а категорию
   * бросали как отработанную. Теперь повторяем через 2, 5 и 15 минут
   * (дальше — раз в 15), а после нескольких неудач подряд говорим
   * пользователю забрать вручную.
   */
  noteClaimFailure(id, name, error) {
    const DELAYS_MIN = [2, 5, 15];
    const prev = this._claimRetry.get(id);
    const attempts = (prev?.attempts || 0) + 1;
    const delay = DELAYS_MIN[Math.min(attempts - 1, DELAYS_MIN.length - 1)];
    this._claimRetry.set(id, { attempts, nextAt: Date.now() + delay * 60 * 1000 });

    console.warn('[Дропсы] Не удалось забрать:', name, error, '— повтор через', delay, 'мин');

    if (attempts === 1) {
      window.utils?.showToast(tr('Не удалось забрать «{name}» — повторю через {delay} мин', { name, delay }), 'warning');
      // В журнал — первая неудача и окончательная; промежуточные повторы
      // по одной и той же награде его бы только засорили. Повтор ещё
      // впереди — это «внимание», а не ошибка: error зажигал бы точку журнала
      // и попадал в «проблемы» сводки, хотя чаще всего второй заход удаётся
      window.eventLog?.add({ type: 'warning', title: tr('Награда не получена'), detail: tr('{name} — повторю через {delay} мин', { name, delay }) });
    }
    if (attempts === FarmingPage.CLAIM_ATTEMPTS_BEFORE_GIVING_UP) {
      window.notifyFarmingEvent?.(tr('Награда не получена'), tr('{name}: забрать не удалось — заберите вручную', { name }));
      window.utils?.showToast(tr('«{name}»: забрать не удалось — заберите вручную', { name }), 'warning');
      // Звук — только когда автосбор сдался: дальше нужен человек
      window.eventLog?.add({ type: 'error', title: tr('Награда не получена'), detail: tr('{name}: заберите вручную на странице «Дропсы»', { name }) });
      window.chime?.play?.('attention');
    }
  }

  static get CLAIM_ATTEMPTS_BEFORE_GIVING_UP() {
    return 4;
  }

  /**
   * Есть ли готовая награда, которую автосбор ещё пытается забрать.
   *
   * Пока есть, категорию не считаем отработанной. После нескольких
   * неудач подряд держать её больше не стоит — пользователю уже сказано
   * забрать награду вручную.
   */
  hasPendingClaims(campaigns) {
    if (window.settings && window.settings.get('autoClaimDrops') === false) return false;
    if (!window.electronAPI?.claimDrop) return false;

    const retry = this._claimRetry || new Map();
    return (campaigns || []).some(campaign => (campaign.drops || []).some(drop => {
      if (!drop?.dropInstanceID || drop.claimed) return false;
      const attempts = retry.get(drop.dropInstanceID)?.attempts || 0;
      return attempts < FarmingPage.CLAIM_ATTEMPTS_BEFORE_GIVING_UP;
    }));
  }

  /**
   * Считает дропсы, полученные именно в этой сессии.
   *
   * Первая встреча с кампанией только запоминает уже полученное в ней
   * ранее, иначе весь накопленный за месяцы инвентарь засчитался бы как
   * добытый сейчас. Раньше в статистику писался жёсткий ноль (стояла
   * заглушка с TODO), поэтому счётчик «Дропсов получено» ничего не
   * отражал.
   *
   * Базу ведём по кампаниям, а не по первому проходу сессии: сюда
   * приходят кампании только текущей игры, и после смены игры награды
   * новой, полученные в прошлые дни, засчитывались этой сессии.
   */
  trackSessionDrops(campaigns) {
    if (!this._sessionDropsBaseline) {
      this._sessionDropsBaseline = new Set();
      this._sessionCountedDrops = new Set();
      this._sessionSeenCampaigns = new Set();
    }
    if (!this._sessionSeenCampaigns) this._sessionSeenCampaigns = new Set();

    campaigns.forEach(campaign => {
      const campaignKey = campaign.id || campaign.name || '';
      const firstSeen = !this._sessionSeenCampaigns.has(campaignKey);
      this._sessionSeenCampaigns.add(campaignKey);

      (campaign.drops || []).forEach(drop => {
        if (!this.isDropEarned(drop)) return;

        const id = drop.id || `${campaign.id}:${drop.name}`;

        if (firstSeen) {
          this._sessionDropsBaseline.add(id);
          return;
        }

        if (this._sessionDropsBaseline.has(id) || this._sessionCountedDrops.has(id)) return;

        this._sessionCountedDrops.add(id);
        this.sessionDropsCollected = (this.sessionDropsCollected || 0) + 1;
        console.log('[Drops] Получен дроп за сессию:', drop.benefitName || drop.name,
          '(всего за сессию:', this.sessionDropsCollected + ')');
      });
    });
  }

  // Проверка состояния трансляции
  /**
   * Плеер сообщил, что стрим не оживить.
   *
   * Раньше здесь был собственный сторож с проверкой каждые десять секунд —
   * второй, независимый от сторожа плеера. Они спорили: перезагрузка
   * плеера одним читалась другим как «стрим умер», и канал менялся зря.
   * Вдобавок он искал ошибки по всему документу Twitch селектором
   * [class*="error"] и срабатывал на чужие классы. Теперь надзор один, в
   * PlayerManager, а страница лишь решает, что делать, когда лестница
   * починки исчерпана.
   */
  async onPlayerDead(detail = {}) {
    if (this._destroyed) return;
    if (!this.currentStream || !this.currentCategory) return;
    if (detail.channel && detail.channel.toLowerCase() !== this.currentStream.login.toLowerCase()) return;

    const login = this.currentStream.login;

    // Конец эфира замечают двое: сторож плеера и проверка статистики. Пока
    // один ищет замену, второй ничего не делает — иначе канал сменился бы
    // дважды подряд
    if (this._deadHandlingFor === login) return;
    this._deadHandlingFor = login;
    try {
      await this._handlePlayerDead(login, detail);
    } finally {
      if (this._deadHandlingFor === login) this._deadHandlingFor = null;
    }
  }

  async _handlePlayerDead(login, detail = {}) {
    const name = this.currentStream.displayName || login;

    // Настройка «Автопереключение стримов» должна что-то значить
    if (window.settings && window.settings.get('autoSwitchStreams') === false) {
      // Переключаться нельзя. Если эфир действительно закончился, держать
      // сессию на погасшем канале незачем: раньше здесь был только тост раз
      // в минуту, а фарминг молча стоял до утра. Сбой сети офлайном не
      // считаем — сторож плеера сам оживит канал, когда сеть вернётся.
      if (await this.isConfirmedOffline(login)) {
        if (this._destroyed || this.currentStream?.login !== login) return;
        this.finishStreamEnded(tr('{name} закончил эфир, автопереключение выключено', { name }));
        return;
      }
      console.log('[Плеер] Стрим недоступен, но автопереключение выключено в настройках');
      this.toastOnce('dead:' + login, tr('Стрим недоступен. Автопереключение выключено'), 'warning');
      return;
    }

    console.warn('[Плеер] Стрим не оживить, переключаюсь:', detail.reason || '');
    this.toastOnce('dead:' + login, tr('Стрим недоступен, переключение...'), 'warning');
    const result = await this.switchToNextStream({ quiet: true });
    if (result !== 'none') return;
    if (this._destroyed || this.currentStream?.login !== login) return;

    // В категории смотреть больше некого — пробуем другие категории.
    // Раньше на этом всё заканчивалось: тост «Других стримов нет», и
    // фарминг стоял до утра.
    const switched = await this.switchToNextEnabledCategory({ reason: 'offline' });
    if (switched !== false) return;

    // Переключиться некуда. Если фарминг ещё идёт (ручная категория —
    // ей показано предложение), останавливаем его здесь
    if (this.sessionStartTime && this.currentStream?.login === login) {
      this.finishStreamEnded(tr('{name}: стрим недоступен, других стримов нет', { name }));
      return;
    }
    window.shutdownManager?.onStreamEnded();
  }

  /** Twitch подтвердил, что канал не в эфире. Сбой запроса — не подтверждение. */
  async isConfirmedOffline(login) {
    if (!window.electronAPI?.getStreamStats) return false;
    try {
      return (await window.electronAPI.getStreamStats(login)) === null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Стрим закончился, а переключиться нельзя или некуда.
   * Здесь же срабатывает автовыключение «по концу стрима»: раньше его не
   * вызывал никто, и эта настройка ничего не делала.
   */
  finishStreamEnded(text) {
    console.warn('[Плеер] Стрим закончился, переключиться некуда:', text);
    window.utils?.showToast(tr('{text}. Фарминг остановлен', { text }), 'warning');
    window.notifyFarmingEvent?.(tr('Фарминг остановлен'), text);
    window.eventLog?.add({ type: 'error', title: tr('Фарминг остановлен'), detail: text });
    window.chime?.play?.('attention');
    this.stopFarming(false);
    window.shutdownManager?.onStreamEnded();
  }

  // Остаток срока кампании для строки категории: «19 д 9 ч», «5 ч», «40 мин».
  // Просто текст — вид задаёт .category-time-left (тихий цвет, точка перед
  // ним), а не вложенный span с прозрачностью
  formatTimeRemaining(endsAt) {
    if (!endsAt) return '';

    const now = new Date();
    const endDate = new Date(endsAt);
    const diff = endDate - now;

    if (!(diff > 0)) return tr('завершена');

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) {
      return hours > 0 ? tr('{days} д {hours} ч', { days, hours }) : tr('{days} д', { days });
    } else if (hours > 0) {
      return tr('{hours} ч', { hours });
    } else {
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      return tr('{minutes} мин', { minutes });
    }
  }

  destroy() {
    console.log('🧹 FarmingPage destroy: очищаю интервалы');
    this._destroyed = true;
    const intervals = [
      'updateInterval',
      'sessionInterval',
      'statsUpdateInterval',
      'streamStatsInterval',
      'dropsProgressInterval',
      'dropCreditInterval',
      'matureCheckInterval',
      'bonusCollectorInterval'
    ];
    intervals.forEach(key => {
      if (this[key]) {
        clearInterval(this[key]);
        delete this[key];
      }
    });
    clearTimeout(this._categoryRetryTimer);
    clearTimeout(this._autoRestartTimer);
    this._categoryRetryTimer = null;
    this._autoRestartTimer = null;

    // Снимаем все обработчики событий этого экземпляра страницы.
    // Без этого обработчики на кнопках сайдбара и на document оставались
    // висеть после каждой навигации вместе со всем объектом страницы.
    // Контроллер намеренно НЕ обнуляем: addEventListener с уже отменённым
    // сигналом ничего не делает, поэтому обработчики, зарегистрированные
    // асинхронным кодом уже после уничтожения страницы, просто не появятся.
    if (this._listenerAbort) {
      this._listenerAbort.abort();
    }
    this.isEventListenersSetup = false;
  }
}

/**
 * sessionStartTime проксируется в глобальный SessionState.
 *
 * Так вся существующая логика страницы (а она обращается к этому свойству в
 * двух десятках мест) продолжает работать без правок, но реальное состояние
 * сессии больше не умирает вместе с объектом страницы при навигации.
 */
/**
 * channelPoints и sessionDropsCollected тоже проксируются в SessionState,
 * чтобы существующий код страницы читал и писал единое состояние сессии.
 */
Object.defineProperty(FarmingPage.prototype, 'channelPoints', {
  configurable: true,
  get() {
    return window.sessionState ? window.sessionState.points : SessionState.emptyPoints();
  },
  // Сеттер нужен именно как страховка: файл большой и legacy, присваивание
  // может встретиться там, где его не ждут. Без сеттера любое такое место
  // валит метод целиком, потому что классы работают в строгом режиме.
  set(value) {
    if (window.sessionState && value && typeof value === 'object') {
      window.sessionState.points = value;
    }
  }
});

Object.defineProperty(FarmingPage.prototype, 'sessionDropsCollected', {
  configurable: true,
  get() {
    return window.sessionState ? window.sessionState.dropsCollected : 0;
  },
  set(value) {
    if (window.sessionState) window.sessionState.dropsCollected = value;
  }
});

Object.defineProperty(FarmingPage.prototype, 'sessionStartTime', {
  configurable: true,
  get() {
    return window.sessionState ? window.sessionState.startTime : null;
  },
  set(value) {
    const state = window.sessionState;
    if (!state) return;

    if (value === null || value === undefined) {
      state.stop();
      return;
    }

    if (state.isActive()) {
      // Сессия уже идёт — это сдвиг точки отсчёта при смене категории
      state.startTime = value;
    } else {
      state.restore(value, {
        categoryName: this.currentCategory?.name,
        streamLogin: this.currentStream?.login
      });
    }
  }
});

// Export to window
window.FarmingPage = FarmingPage;

/**
 * Уведомление о полученной награде.
 *
 * Настройка «Уведомления о получении дропсов» существовала, но здесь не
 * проверялась: переключатель ни на что не влиял, уведомления приходили
 * всегда. Теперь он работает.
 */
// extra — необязательный { kind, meta }: «2 из 4» под названием награды или
// вид окна (сводка, проверка). Пробрасывается в main как есть; старые
// вызовы без него работают по-прежнему
window.showDropNotification = function(dropName, gameName, dropIcon = null, extra = undefined) {
  if (window.settings && window.settings.get('notifyOnDropClaimed') === false) return;
  // Окно о награде — тоже уведомление Windows: его глушат и общий
  // выключатель, и тихие часы. Раньше оно всплывало поверх всего даже
  // ночью, хотя настройка обещала тишину
  if (window.settings && (window.settings.get('systemNotifications') === false ||
      window.settings.get('notifications') === false)) return;
  if (window.QuietHours?.active()) {
    console.log('[Уведомления] Тихие часы, окно о награде не показываю:', dropName);
    return;
  }

  if (window.electronAPI && window.electronAPI.showDropNotification) {
    if (extra && typeof extra === 'object') {
      window.electronAPI.showDropNotification(dropName, gameName, dropIcon, extra);
    } else {
      window.electronAPI.showDropNotification(dropName, gameName, dropIcon);
    }
  } else {
    console.error('[DropNotification] electronAPI.showDropNotification not available');
  }
};

/**
 * Уведомление о событии фарминга: кампания заканчивается, стрим пропал.
 *
 * При фоновом фарминге такие вещи иначе остаются незамеченными до тех
 * пор, пока пользователь сам не откроет окно.
 */
window.notifyFarmingEvent = function(title, body) {
  // Выключатель «Уведомления Windows» пишет оба ключа; проверяем оба,
  // чтобы старое значение одного из них не включало уведомления обратно
  if (window.settings && (window.settings.get('notifications') === false ||
      window.settings.get('systemNotifications') === false)) return;

  // В тихие часы событие всё равно происходит и попадает в журнал —
  // молчит только само уведомление
  if (window.QuietHours?.active()) {
    console.log('[Уведомления] Тихие часы, не показываю:', title);
    return;
  }

  window.electronAPI?.showNotification?.(title, body);
};

window.hideDropNotification = function(notificationId) {
  // Не нужно - Electron окно закрывается само
};
