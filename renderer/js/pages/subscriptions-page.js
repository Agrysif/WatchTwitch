class SubscriptionsPage {
  // Подробности канала (фолловеры, дата эфира, «в эфире») считаем свежими
  // полчаса. Раньше они запрашивались заново при каждом открытии страницы,
  // по запросу на каждый канал разом, и Twitch в ответ начинал ограничивать
  // и сам фарминг.
  static DETAILS_TTL_MS = 30 * 60 * 1000;
  // Не больше стольких запросов подробностей одновременно
  static DETAILS_PARALLEL = 5;
  // Канал, не стримивший дольше этого, считается неактивным
  static INACTIVE_DAYS = 30;
  // Для массовой отписки дата эфира должна быть проверена не раньше, чем
  // столько назад: по давно сохранённой дате отписывать нельзя — канал мог
  // с тех пор стримить
  static CLEANUP_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  // Где запомнить выбранный вид (список или плитка). Это удобство одного
  // окна, а не данные: при пустом или недоступном хранилище будет список
  static VIEW_STORAGE_KEY = 'subscriptionsView';
  // Названия фильтров — для пустого состояния «ничего не нашлось среди …»
  static FILTER_NAMES = { active: 'В эфире', inactive: 'Неактивные', favorites: 'Избранные', 'with-drops': 'С дропсами' };

  constructor() {
    this.i18n = window.i18n;
    this._destroyed = false;
    // Номер текущей загрузки: ответ от прежней (страницу обновили или
    // открыли заново) не должен перезаписать свежие данные
    this._loadRun = 0;
    this.subscriptions = [];
    this.filteredSubscriptions = [];
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.currentView = 'list';
    this.subscriptionStats = {
      total: 0,
      withDrops: 0,
      active: 0,
      inactive: 0
    };
    // Окно канала: для кого открыто и куда вернуть фокус после закрытия
    this._modalSub = null;
    this._modalReturnId = null;
    this._onModalKeydown = (e) => this.handleModalKeydown(e);
    this._stickyObserver = null;
    this.init();
  }

  async init() {
    // Вид восстанавливаем до первой отрисовки, иначе список мелькнул бы
    // строками и тут же перестроился в плитку
    this.restoreViewMode();
    this.setupEventListeners();
    this.setupStickyToolbar();
    // Переключатель приоритета читаем сразу, а не после ответа Twitch:
    // раньше при неудачной загрузке он так и оставался выключенным, хотя
    // настройка включена и фарминг её учитывает
    this.loadPrioritySetting();
    this.loadSubscriptions();
  }

  /**
   * Роутер вызывает при уходе со страницы.
   *
   * Раньше метода не было: загрузка, начатая до перехода, доходила до
   * обращения к уже удалённым элементам и показывала на чужой странице
   * красное «Ошибка загрузки подписок».
   *
   * Слушатель Esc окна канала висит на document и пережил бы страницу,
   * поэтому снимается здесь же, как и наблюдатель за панелью поиска.
   */
  destroy() {
    this._destroyed = true;
    document.removeEventListener('keydown', this._onModalKeydown, true);
    this._stickyObserver?.disconnect();
    this._stickyObserver = null;
  }

  // Ответ пришёл, когда страница уже закрыта или запущена новая загрузка
  isStale(run) {
    return this._destroyed || run !== this._loadRun;
  }

  // Строки от Twitch (имена, логин, описание) идут в разметку только
  // экранированными: описание канала задаёт сам стример, и вставка как есть
  // позволяла чужому каналу выполнить код в окне приложения
  esc(text) {
    if (window.escapeHtml) return window.escapeHtml(text);
    return String(text ?? '').replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  }

  // Адрес картинки из ответа Twitch: только https и без символов, которыми
  // можно выйти из атрибута или из url('…') в стиле
  safeImageUrl(url) {
    return typeof url === 'string' && /^https:\/\/[^\s"'()<>\\]+$/i.test(url) ? url : '';
  }

  // Селектор карточки канала. id приходит от Twitch, поэтому экранируем
  cardSelector(id) {
    return `[data-channel-id="${CSS.escape(String(id))}"]`;
  }

  // Иконка из общего набора (dom-helpers.js). Набор грузится раньше
  // страниц, но без него страница не должна падать — тогда кнопка без значка
  icon(name, size = 16) {
    return window.Icons?.get(name, size) ?? '';
  }

  // Канал по data-channel-id строки. Ищем в полном списке: объекты в
  // отфильтрованном — те же самые
  findSub(id) {
    if (id == null) return null;
    const key = String(id);
    return this.subscriptions.find(s => String(s.id) === key) || null;
  }

  // Этот канал сейчас смотрит фарминг — строка помечается «Смотрим сейчас»
  isCurrentChannel(sub) {
    const login = window.farmingPage?.currentStream?.login;
    return !!login && !!sub?.login && String(login).toLowerCase() === String(sub.login).toLowerCase();
  }

  openOnTwitch(sub) {
    if (!sub?.login) return;
    window.electronAPI.openExternal(`https://www.twitch.tv/${encodeURIComponent(sub.login)}`);
  }

  /**
   * Обработчики страницы.
   *
   * Строки списка перерисовываются целиком (поиск, фильтр, подробности
   * каналов), поэтому клики, клавиши и перетаскивание слушает сам список,
   * а не каждая строка. Раньше на каждую карточку вешалось по шесть
   * обработчиков при каждой отрисовке, а обновление одной карточки
   * теряло обработчики её кнопок.
   */
  setupEventListeners() {
    // Фильтры
    const filters = document.getElementById('subs-filters');
    filters?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (btn && filters.contains(btn)) this.setFilter(btn.dataset.filter);
    });

    // Вид: список или плитка
    const views = document.getElementById('subs-view');
    views?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (btn && views.contains(btn)) this.setView(btn.dataset.view);
    });

    // Кнопки управления
    document.getElementById('refresh-subs-btn')?.addEventListener('click', () => this.refreshSubscriptions());
    document.getElementById('cleanup-subs-btn')?.addEventListener('click', () => this.cleanupInactive());
    document.getElementById('priority-subs-toggle')?.addEventListener('change', (e) => this.savePrioritySetting(e.target.checked));

    // Поиск. Esc и крестик в поле очищают его — на длинном списке это
    // быстрее, чем стирать запрос
    const search = document.getElementById('search-input');
    search?.addEventListener('input', () => this.onSearchInput());
    search?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) {
        e.preventDefault();
        e.stopPropagation();
        this.clearSearch();
      }
    });
    document.getElementById('subs-search-clear')?.addEventListener('click', () => {
      this.clearSearch();
      search?.focus();
    });

    // Список: клики, клавиатура и перетаскивание избранных
    const list = document.getElementById('subscriptions-list');
    if (list) {
      list.addEventListener('click', (e) => this.handleListClick(e));
      list.addEventListener('keydown', (e) => this.handleListKeydown(e));
      list.addEventListener('dragstart', (e) => this.handleDragStart(e));
      list.addEventListener('dragend', (e) => this.handleDragEnd(e));
      list.addEventListener('dragover', (e) => this.handleDragOver(e));
      list.addEventListener('dragleave', (e) => this.handleDragLeave(e));
      list.addEventListener('drop', (e) => this.handleDrop(e));
    }

    // Кнопка в пустом состоянии: сбросить поиск, показать всё, обновить
    document.getElementById('subscriptions-empty')?.addEventListener('click', (e) => {
      const action = e.target.closest('[data-empty-action]')?.dataset.emptyAction;
      if (action === 'reset-search') this.clearSearch();
      else if (action === 'show-all') this.setFilter('all');
      else if (action === 'refresh') this.refreshSubscriptions();
    });

    // Авторизация
    // У роутера нет switchPage — вызов бросал TypeError, и кнопка ничего
    // не делала
    document.getElementById('subscriptions-auth-btn')?.addEventListener('click', () => {
      window.router?.navigate('accounts');
    });

    // Окно канала. По фону закрываем, только если и нажатие началось на
    // фоне: иначе выделение текста описания, отпущенное за краем окна,
    // закрывало бы его
    document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
    const modal = document.getElementById('channel-detail-modal');
    modal?.addEventListener('pointerdown', (e) => {
      this._backdropPressed = e.target === modal;
    });
    modal?.addEventListener('click', (e) => {
      if (e.target === modal && this._backdropPressed) this.closeModal();
      this._backdropPressed = false;
    });
  }

  /**
   * Панель поиска прилипает к верху при прокрутке (position: sticky).
   * Нижняя граница у неё нужна только в прилипшем виде — понять это CSS
   * сам не может, поэтому за меткой перед панелью следит наблюдатель.
   */
  setupStickyToolbar() {
    const toolbar = document.getElementById('subs-toolbar');
    const sentinel = document.querySelector('.subscriptions-page .subs-toolbar-sentinel');
    if (!toolbar || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const root = toolbar.closest('.content');
    this._stickyObserver = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      // Скрытая метка (раздел ещё не показан) — нулевой прямоугольник:
      // её «выход» за верх ничего не значит
      const visible = entry.boundingClientRect.width > 0;
      const top = entry.rootBounds ? entry.rootBounds.top : 0;
      toolbar.classList.toggle('is-stuck', visible && !entry.isIntersecting && entry.boundingClientRect.top < top);
    }, { root: root || null, threshold: 0 });
    this._stickyObserver.observe(sentinel);
  }

  setFilter(filter) {
    if (!filter) return;
    this.currentFilter = filter;
    document.querySelectorAll('#subs-filters button[data-filter]').forEach(b => {
      const on = b.dataset.filter === filter;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    this.applyFilter();
  }

  onSearchInput() {
    const input = document.getElementById('search-input');
    const value = input?.value || '';
    // Пробелы по краям — не часть имени: запрос «xqc » раньше не находил xQc
    this.searchQuery = value.trim().toLowerCase();
    const clear = document.getElementById('subs-search-clear');
    if (clear) clear.hidden = value.length === 0;
    this.applyFilter();
  }

  clearSearch() {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    this.onSearchInput();
  }

  // Клик по строке открывает окно канала, по кнопке строки — её действие
  handleListClick(e) {
    const list = e.currentTarget;
    const card = e.target.closest('.subscription-card');
    if (!card || !list.contains(card)) return;
    const sub = this.findSub(card.dataset.channelId);
    if (!sub) return;

    const action = e.target.closest('.subscription-action-btn');
    if (!action) {
      this.showChannelDetails(sub);
      return;
    }

    e.stopPropagation();
    if (action.classList.contains('favorite-btn')) this.toggleFavorite(sub);
    else if (action.classList.contains('farm-btn')) this.startFarmingChannel(sub);
    else if (action.classList.contains('twitch-btn')) this.openOnTwitch(sub);
    else if (action.classList.contains('unsub-btn')) this.unsubscribeChannel(sub);
  }

  // Строка в фокусе открывается Enter или пробелом, как кнопка. Кнопки
  // внутри строки обрабатывают клавиши сами
  handleListKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target;
    if (!card.classList?.contains('subscription-card')) return;
    const sub = this.findSub(card.dataset.channelId);
    if (!sub) return;
    e.preventDefault();
    this.showChannelDetails(sub);
  }

  /**
   * Загружает список подписок.
   *
   * Возвращает true, только если Twitch отдал полный свежий список: по
   * этому результату «Обновить» решает, показывать ли «Подписки обновлены».
   * Раньше тост успеха появлялся всегда, даже следом за «Не удалось
   * обновить список».
   */
  async loadSubscriptions({ force = false } = {}) {
    const run = ++this._loadRun;
    try {
      const accounts = await Storage.getAccounts();
      if (this.isStale(run)) return false;
      if (!accounts || accounts.length === 0) {
        this.showAuthSection();
        return false;
      }

      const account = accounts[0];
      let oauthData = null;
      try {
        oauthData = await window.electronAPI.getOAuthUser?.();
      } catch (e) {
        console.warn('Failed to get OAuth data:', e);
      }
      if (this.isStale(run)) return false;

      if (oauthData?.accessToken) {
        const tokenChanged = oauthData.accessToken !== account.accessToken;
        const refreshChanged = oauthData.refreshToken && oauthData.refreshToken !== account.refreshToken;

        if (tokenChanged || refreshChanged) {
          account.accessToken = oauthData.accessToken;
          if (oauthData.refreshToken) {
            account.refreshToken = oauthData.refreshToken;
          }
          await Storage.saveAccount(account);
          if (this.isStale(run)) return false;
        }
      }

      if (!account.accessToken) {
        console.log('[Subscriptions] Нет токена — показываю вход');
        this.showAuthSection();
        return false;
      }

      this.showContentSection();

      // Сохранённое показываем ПЕРВЫМ делом, до всяких запросов.
      //
      // Раньше сначала включался спиннер, а он прячет список целиком:
      // возвращаясь на вкладку, пользователь видел, как всё пропадает и
      // собирается заново — вместе с аватарками, хотя они и так лежат в
      // кеше браузера. Спиннер теперь появляется, только когда показать
      // действительно нечего.
      const stored = (await Storage.getSubscriptions()) || [];
      if (this.isStale(run)) return false;
      const savedSubs = (Array.isArray(stored) ? stored : [])
        .filter(s => s && typeof s === 'object')
        .map(s => this.prepareSaved(s));

      if (savedSubs.length > 0) {
        this.subscriptions = savedSubs;
        this.applyFilter();
        this.showRefreshingHint();
      } else {
        this.showLoadingState();
      }

      console.log('[Subscriptions] Обновляю список…');

      let timer = null;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Twitch не ответил за 10 секунд')), 10000);
      });

      let response = null;
      try {
        response = await Promise.race([
          window.electronAPI.getUserSubscriptions(account.accessToken),
          timeoutPromise
        ]);
      } catch (e) {
        console.warn('[Subscriptions] Запрос не удался:', e?.message);
      } finally {
        clearTimeout(timer);
      }
      if (this.isStale(run)) return false;

      const fetched = this.normalizeFetched(response);
      const items = (fetched?.items || []).filter(f => f && f.id && f.login);

      // Пустой ответ НЕ считаем правдой. Раньше он записывался поверх
      // сохранённого списка, стирая избранное и заданные приоритеты —
      // достаточно было один раз открыть страницу с протухшим токеном.
      if (items.length === 0) {
        console.warn('[Subscriptions] Twitch вернул пусто — оставляем сохранённый список');
        this.hideLoadingState();

        if (savedSubs.length === 0) {
          this.showEmptyState();
          // Полный пустой ответ — правда: подписок действительно нет
          if (fetched?.complete) return true;
          if (force) window.utils.showToast('Не удалось загрузить подписки с Twitch', 'warning');
        } else {
          window.utils.showToast('Не удалось обновить список, показаны сохранённые подписки', 'warning');
          this.applyFilter();
          // Сам список не пришёл, но подробности каналов от него не
          // зависят — обновляем их, иначе статусы остались бы старыми
          this.loadChannelDetails(run, account, { force });
        }
        return false;
      }

      console.log('[Subscriptions] Loaded:', items.length, 'subscriptions');

      // Слияние. Основа — то, что уже есть (метрики, избранное, приоритет),
      // а из ответа берём только поля самого списка: id, логин, имя.
      //
      // Раньше сохранённое целиком накладывалось поверх свежего, и
      // устаревшие данные перекрывали новые. Обратный порядок тоже не
      // годится: в ответе лежат заглушки followers: 0 и isLive: false,
      // и они затёрли бы настоящие значения.
      const current = new Map(this.subscriptions.map(s => [s.id, s]));
      const merged = items.map(fresh => {
        const saved = current.get(fresh.id);
        const sub = {
          ...(saved || {}),
          id: fresh.id,
          login: fresh.login,
          displayName: fresh.displayName || fresh.login
        };
        // Аватарка из подробностей канала крупнее той, что в списке
        // (300 против 70 точек), поэтому сохранённую не заменяем
        if (!sub.profileImageUrl) {
          const avatar = this.safeImageUrl(fresh.profileImageUrl);
          if (avatar) sub.profileImageUrl = avatar;
        }
        sub.lastSeen = saved?.lastSeen || new Date().toISOString();
        sub.rating = this.calculateRating(sub);
        sub.recommended = this.shouldRecommendUnsubscribe(sub);
        return sub;
      });

      // Twitch отдал не весь список: одна из страниц не пришла. Каналы,
      // которых нет в ответе, не выбрасываем — раньше вместе с ними
      // пропадали избранное и заданные приоритеты
      if (!fetched.complete) {
        const got = new Set(merged.map(s => s.id));
        const fromTwitch = merged.length;
        for (const sub of this.subscriptions) {
          if (!got.has(sub.id)) merged.push(sub);
        }
        // Про сохранённые говорим, только если они действительно добавлены:
        // при пустом сохранённом списке добавлять нечего
        window.utils.showToast(
          merged.length > fromTwitch
            ? 'Twitch отдал не весь список — остальные каналы показаны из сохранённых'
            : 'Twitch отдал не весь список подписок',
          'warning'
        );
      }

      this.subscriptions = merged;
      await Storage.saveSubscriptions(this.subscriptions);
      if (this.isStale(run)) return false;

      this.hideLoadingState();
      this.applyFilter();

      // Подробности грузятся в фоне: список уже на экране
      this.loadChannelDetails(run, account, { force });
      return fetched.complete;
    } catch (error) {
      if (this.isStale(run)) return false;
      console.error('Error loading subscriptions:', error);
      window.utils.showToast('Ошибка загрузки подписок', 'error');
      this.hideLoadingState();
      if (this.subscriptions.length > 0) this.applyFilter();
      else this.showEmptyState();
      return false;
    }
  }

  /**
   * Ответ get-user-subscriptions в одном виде: { items, complete }.
   *
   * Прежний main отдавал просто массив и не сообщал, что список урезан.
   * Пустой массив от него означал и «подписок нет», и «нет токена», поэтому
   * полным его не считаем.
   */
  normalizeFetched(response) {
    if (Array.isArray(response)) return { items: response, complete: response.length > 0 };
    if (response && Array.isArray(response.items)) {
      return { items: response.items, complete: response.complete === true };
    }
    return null;
  }

  /**
   * Сохранённый канал перед показом.
   *
   * «В эфире» — состояние на момент проверки. Раньше сохранённое значение
   * показывалось как есть, и канал, стримивший вчера, при открытии страницы
   * висел «в эфире». Держим его, только если проверка была недавно.
   */
  prepareSaved(saved) {
    const sub = { ...saved };
    if (!this.isDetailsFresh(sub)) delete sub.isLive;
    sub.rating = this.calculateRating(sub);
    return sub;
  }

  // Проверялись ли подробности канала не раньше maxAge назад
  isDetailsFresh(sub, maxAge = SubscriptionsPage.DETAILS_TTL_MS) {
    const at = Date.parse(sub?.detailsCheckedAt);
    if (!Number.isFinite(at)) return false;
    const age = Date.now() - at;
    return age >= 0 && age < maxAge;
  }

  /**
   * Подробности каналов: аватарка, описание, фолловеры, дата эфира.
   *
   * Раньше запрос уходил по каждому каналу сразу — на 62 подписки сотни
   * обращений к Twitch за секунду, и Twitch начинал ограничивать и сам
   * фарминг. Теперь одновременно не больше DETAILS_PARALLEL запросов, а
   * каналы, проверенные за последние полчаса, не запрашиваются вовсе
   * (кроме ручного «Обновить»).
   *
   * Сохранение и сортировка — один раз, когда пришло всё. Раньше список
   * сортировался по рейтингу до прихода данных, а полученное не
   * сохранялось, и каждый заход начинался со старого.
   */
  async loadChannelDetails(run, account, { force = false } = {}) {
    if (!window.electronAPI?.getChannelDetails) return;

    const queue = this.subscriptions.filter(s => s?.login && (force || !this.isDetailsFresh(s)));
    if (queue.length === 0) return;

    // Номер загрузки, чьи подробности сейчас идут. Простой флаг залипал:
    // прерванная загрузка его не снимала, а новая могла не начать своих
    this._detailsRun = run;
    let changed = false;

    const worker = async () => {
      while (queue.length > 0 && !this.isStale(run)) {
        const sub = queue.shift();
        let details = null;
        try {
          // Токен main больше не использует, но сигнатура вызова прежняя
          details = await window.electronAPI.getChannelDetails(account?.accessToken, sub.login);
        } catch (e) {
          console.warn(`[Subscriptions] Подробности ${sub.login} не получены:`, e?.message);
        }
        if (this.isStale(run)) return;
        if (this.applyChannelDetails(sub, details)) {
          changed = true;
          this.updateChannelCard(sub);
        }
      }
    };

    try {
      const workers = Math.min(SubscriptionsPage.DETAILS_PARALLEL, queue.length);
      await Promise.allSettled(Array.from({ length: workers }, () => worker()));
      if (this.isStale(run) || !changed) return;

      await Storage.saveSubscriptions(this.subscriptions);
      if (this.isStale(run)) return;
      this.applyFilter();
    } catch (e) {
      console.error('[Subscriptions] Ошибка загрузки подробностей:', e);
    } finally {
      if (this._detailsRun === run) this._detailsRun = null;
    }
  }

  isDetailsLoading() {
    return this._detailsRun != null && this._detailsRun === this._loadRun && !this._destroyed;
  }

  /**
   * Переносит подробности канала в подписку. Возвращает true, если данные
   * действительно пришли.
   *
   * Поле берём, только если оно получено и похоже на правду. Раньше при
   * сбое main отдавал заглушку с нулями, а страница принимала её за ответ
   * (0 >= 0): у всех каналов становилось 0 фолловеров и «не в эфире»,
   * очистка считала их неактивными, и нули уходили на диск.
   */
  applyChannelDetails(sub, details) {
    if (!details || typeof details !== 'object') return false;

    // Заглушка прежнего обработчика при неудаче: ни аватарки, ни даты,
    // одни нули. У настоящего канала аватарка есть всегда
    const isFailureStub = !details.profileImageUrl && !details.description &&
      !details.lastStreamDate && details.followers === 0 && details.isLive === false;
    if (isFailureStub) return false;

    const avatar = this.safeImageUrl(details.profileImageUrl);
    if (avatar) sub.profileImageUrl = avatar;
    if (typeof details.description === 'string') sub.description = details.description;
    if (typeof details.followers === 'number' && Number.isFinite(details.followers) && details.followers >= 0) {
      sub.followers = details.followers;
    }
    if (typeof details.isLive === 'boolean') sub.isLive = details.isLive;
    if (details.lastStreamDate) {
      const ts = new Date(details.lastStreamDate).getTime();
      if (Number.isFinite(ts)) sub.lastStreamDate = new Date(ts).toISOString();
    }

    sub.detailsCheckedAt = new Date().toISOString();
    sub.rating = this.calculateRating(sub);
    return true;
  }

  /**
   * Оценка канала для фарминга, 0–100.
   *
   * Прежняя формула не работала. Она стартовала с 50 баллов и только
   * добавляла — рейтинг ниже 50 был невозможен, поэтому нулевых каналов
   * не существовало в принципе. Три её слагаемых из пяти (частота стримов,
   * регулярность, язык) считались по полям, которые никто никогда не
   * заполнял, то есть 60% веса всегда были нулём. Сверху добавлялась
   * «вариация» из кода первого символа id — она не несла смысла, но
   * создавала видимость точности.
   *
   * Хуже всего, что рейтинг считался в момент слияния списков, когда
   * подробности канала ещё не загружены: у всех каналов выходило одно и
   * то же число.
   *
   * Здесь используются только те данные, которые приложение реально
   * получает, а до их загрузки рейтинг не выдумывается — возвращается null.
   */
  calculateRating(subscription) {
    const followers = Number(subscription.followers);
    const hasFollowers = Number.isFinite(followers);
    const hasActivity = !!subscription.lastStreamDate || subscription.isLive !== undefined;

    // Пока подробности не подгружены, честнее не показывать ничего
    if (!hasFollowers && !hasActivity) return null;

    // Активность — 45 баллов. Для фарминга важнее всего, идут ли эфиры.
    //
    // Затухание плавное, а не ступенями: ступени давали одинаковые оценки
    // каналам, которые стримили неделю назад и три недели назад, и все
    // значения выходили кратными пяти. Период полураспада — две недели.
    let activity = 0;
    if (subscription.isLive) {
      activity = 45;
    } else if (subscription.lastStreamDate) {
      const days = Math.max(0, (Date.now() - new Date(subscription.lastStreamDate).getTime()) / 86400000);
      activity = 45 * Math.pow(0.5, days / 14);
    }

    // Аудитория — 25 баллов по логарифмической шкале.
    //
    // Логарифм потому, что разница между 100 и 1000 подписчиков значит
    // куда больше, чем между 500 000 и 600 000. Шкала растянута от сотни
    // (0 баллов) до миллиона (25 баллов).
    let audience = 0;
    if (hasFollowers && followers > 0) {
      const scale = (Math.log10(followers) - 2) / 4;
      audience = 25 * Math.min(1, Math.max(0, scale));
    }

    // Дропсы — 30 баллов. Ради них приложение и существует.
    const drops = subscription.hasDrops ? 30 : 0;

    // Округляем до десятых: целые числа снова слипались бы в одинаковые
    // значения у близких каналов, а именно этого и хотелось избежать
    const total = Math.max(0, Math.min(100, activity + audience + drops));
    return Math.round(total * 10) / 10;
  }

  shouldRecommendUnsubscribe(subscription, saved = {}) {
    const lastStreamDate = new Date(subscription.lastStreamDate || 0);
    const daysSinceStream = (Date.now() - lastStreamDate.getTime()) / (1000 * 60 * 60 * 24);

    // Рекомендуем отписаться если:
    // 1. Не стримил более 90 дней
    // 2. Рейтинг очень низкий (< 20)
    // 3. Есть дропсы но регулярность низкая

    return daysSinceStream > 90 || this.calculateRating(subscription, saved) < 20;
  }

  updateStats() {
    this.subscriptionStats = {
      total: this.subscriptions.length,
      withDrops: this.subscriptions.filter(s => s.hasDrops).length,
      active: this.subscriptions.filter(s => this.isChannelActive(s)).length,
      inactive: this.subscriptions.filter(s => this.isChannelInactive(s)).length
    };

    // Подпись тоже склоняется: было «62 подписок» вместо «62 подписки»
    const n = this.subscriptionStats.total;
    const слово = (this.i18n?.currentLang || 'ru') === 'ru'
      ? this.plural(n, 'подписка', 'подписки', 'подписок')
      : this.i18n.t('subscriptions.subsCount');

    // В шапке — одно число рядом с названием, полная подпись — в подсказке.
    // Пустой бейдж CSS прячет: «0» при пустом списке ничего не сообщает
    const counter = document.getElementById('subs-count');
    if (counter) {
      counter.textContent = n > 0 ? String(n) : '';
      counter.title = `${n} ${слово}`;
      counter.setAttribute('aria-label', `${n} ${слово}`);
    }

    // Число у каждого фильтра: видно заранее, есть ли кто-то в эфире и
    // сколько каналов уйдёт при очистке
    const counts = {
      all: n,
      active: this.subscriptionStats.active,
      inactive: this.subscriptionStats.inactive,
      favorites: this.subscriptions.filter(s => s.isFavorite).length
    };
    document.querySelectorAll('#subs-filters [data-count]').forEach(el => {
      const value = counts[el.dataset.count];
      el.textContent = Number.isFinite(value) ? String(value) : '';
    });
  }

  /**
   * Падеж существительного по числу.
   * Русский требует трёх форм: 1 неделю, 2 недели, 5 недель — а раньше
   * везде подставлялась третья, и выходило «1 недель назад».
   */
  plural(n, одна, две, много) {
    const десятки = Math.abs(n) % 100;
    const единицы = десятки % 10;

    if (десятки > 10 && десятки < 20) return много;
    if (единицы === 1) return одна;
    if (единицы >= 2 && единицы <= 4) return две;
    return много;
  }

  // «Активный» для фильтра «В эфире» — идёт эфир прямо сейчас
  isChannelActive(subscription) {
    return subscription?.isLive === true;
  }

  /**
   * Неактивный — не в эфире, и последний эфир был больше 30 дней назад.
   *
   * Раньше «неактивным» считался любой канал не в эфире прямо сейчас, а
   * если подробности не загрузились — вообще все. Очистка поэтому
   * отписывала почти от всех подписок, включая стримивших вчера. Канал с
   * неизвестной датой эфира неактивным не считается.
   */
  isChannelInactive(subscription) {
    if (subscription?.isLive === true) return false;
    const ts = Date.parse(subscription?.lastStreamDate);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts > SubscriptionsPage.INACTIVE_DAYS * 86400000;
  }

  applyFilter() {
    // Счётчик считался только после успешного ответа Twitch, а сохранённый
    // список показывается раньше — в шапке висело «0 подписок» при полном
    // списке на экране
    this.updateStats();

    let filtered = this.subscriptions;

    // Применяем фильтр
    switch (this.currentFilter) {
      case 'active':
        filtered = this.subscriptions.filter(s => this.isChannelActive(s));
        break;
      case 'with-drops':
        filtered = this.subscriptions.filter(s => s.hasDrops);
        break;
      case 'inactive':
        filtered = this.subscriptions.filter(s => this.isChannelInactive(s));
        break;
      case 'favorites':
        filtered = this.subscriptions.filter(s => s.isFavorite);
        break;
    }

    // Применяем поиск. По логину тоже: поля loginName, по которому искали
    // раньше, не существует, и канал с нелатинским именем было не найти
    if (this.searchQuery) {
      filtered = filtered.filter(s =>
        s.displayName?.toLowerCase().includes(this.searchQuery) ||
        s.login?.toLowerCase().includes(this.searchQuery)
      );
    }

    // Сортируем: избранные вверху, потом по приоритету (если есть), иначе по рейтингу
    this.filteredSubscriptions = filtered.sort((a, b) => {
      // Избранные всегда вверху
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      
      // Внутри избранных — заданный вручную порядок, а при равном
      // приоритете (то есть когда порядок не задавали) тоже по рейтингу
      if (a.isFavorite && b.isFavorite) {
        const aPriority = a.priority !== undefined ? a.priority : 9999;
        const bPriority = b.priority !== undefined ? b.priority : 9999;
        if (aPriority !== bPriority) return aPriority - bPriority;
      }
      
      // Обычные каналы по рейтингу, выше — впереди.
      // Каналы без оценки уходят вниз: раньше сравнение null с числом
      // давало NaN, и порядок получался произвольным.
      const rank = (sub) => Number.isFinite(sub.rating) ? sub.rating : -1;
      return rank(b) - rank(a);
    });

    this.renderSubscriptions();
  }

  renderSubscriptions() {
    const list = document.getElementById('subscriptions-list');
    const empty = document.getElementById('subscriptions-empty');
    const loading = document.getElementById('subscriptions-loading');

    if (!list) return;

    // Скрываем loading
    if (loading) loading.style.display = 'none';
    this.hideRefreshingHint();

    if (this.filteredSubscriptions.length === 0) {
      list.style.display = 'none';
      if (empty) {
        empty.innerHTML = this.renderEmptyState();
        empty.style.display = 'block';
      }
      return;
    }

    // Вид (строки или плитка) задают классы списка, а не встроенный стиль
    list.style.display = '';
    if (empty) empty.style.display = 'none';

    // Разделяем на избранные и обычные. Подписи групп нужны, только когда
    // на экране есть обе: при фильтре «Избранные» подпись повторяла бы его
    const favorites = this.filteredSubscriptions.filter(s => s.isFavorite);
    const regular = this.filteredSubscriptions.filter(s => !s.isFavorite);
    const grouped = favorites.length > 0 && regular.length > 0;

    let html = '';
    if (grouped) {
      html += this.renderSectionLabel('Избранные', favorites.length,
        favorites.length > 1 ? 'порядок меняется перетаскиванием' : '');
    }
    html += favorites.map(sub => this.renderSubscriptionItem(sub)).join('');
    if (grouped) {
      html += this.renderSectionLabel(this.i18n?.t('subscriptions.otherChannels') || 'Остальные каналы', regular.length);
    }
    html += regular.map(sub => this.renderSubscriptionItem(sub)).join('');

    // Если разметка не изменилась, DOM не трогаем вовсе.
    //
    // Возвращаясь на вкладку, пользователь чаще всего видит ровно тот же
    // список: перезапись innerHTML пересоздала бы все элементы и заставила
    // браузер заново раскладывать картинки — отсюда и ощущение, что
    // аватарки грузятся каждый раз. Обработчики висят на самом списке,
    // поэтому перерисовка их не трогает.
    if (html === this._renderedHtml && list.children.length > 0) {
      return;
    }
    this._renderedHtml = html;

    list.innerHTML = html;
  }

  renderSectionLabel(title, count, hint = '') {
    return `<div class="section-label subs-section-label">`
      + `<span>${this.esc(title)}</span><span class="count num">${count}</span>`
      + (hint ? `<span class="subs-section-hint">${this.esc(hint)}</span>` : '')
      + `</div>`;
  }

  /**
   * Пустое состояние под текущий фильтр и поиск.
   *
   * Раньше на всё было одно «Подписок не найдено» со звездой — и при
   * пустом поиске, и когда никто не в эфире, и когда избранного ещё нет.
   * Теперь сказано, почему пусто, и есть одна кнопка, которая это меняет.
   */
  renderEmptyState() {
    const make = (opts) => {
      if (window.DOMHelpers?.emptyState) return window.DOMHelpers.emptyState(opts);
      return `<div class="empty-state"><h3>${this.esc(opts.title)}</h3>`
        + (opts.text ? `<p>${this.esc(opts.text)}</p>` : '')
        + (opts.actionHtml || '') + `</div>`;
    };
    const button = (action, label) =>
      `<button type="button" class="btn btn-secondary btn-sm" data-empty-action="${action}">${this.esc(label)}</button>`;

    if (this.subscriptions.length === 0) {
      return make({
        icon: 'users',
        title: 'Подписок пока нет',
        text: 'Каналы, на которые вы подписаны в Twitch, появятся здесь.',
        actionHtml: button('refresh', 'Обновить список')
      });
    }

    const filterName = SubscriptionsPage.FILTER_NAMES[this.currentFilter];
    if (this.searchQuery) {
      const raw = (document.getElementById('search-input')?.value || '').trim();
      return make({
        icon: 'search',
        title: `Нет каналов по запросу «${raw}»`,
        text: filterName ? `Поиск шёл только среди «${filterName}».` : '',
        actionHtml: button('reset-search', 'Сбросить поиск')
      });
    }

    switch (this.currentFilter) {
      case 'active':
        return make({
          icon: 'eye',
          title: 'Сейчас никто не в эфире',
          text: 'Статусы каналов проверяются раз в полчаса. Обновите список, чтобы проверить сейчас.',
          actionHtml: button('refresh', 'Проверить сейчас')
        });
      case 'inactive':
        return make({
          icon: 'check-circle',
          title: 'Неактивных каналов нет',
          text: 'Все каналы стримили за последние 30 дней.',
          actionHtml: button('show-all', 'Показать все')
        });
      case 'favorites':
        return make({
          icon: 'heart',
          title: 'Избранных пока нет',
          text: 'Отметьте канал сердечком — приложение скажет, когда он выйдет в эфир, а с приоритетом подписок будет выбирать его первым.',
          actionHtml: button('show-all', 'Показать все')
        });
      default:
        return make({
          icon: 'users',
          title: this.i18n?.t('subscriptions.noSubscriptions') || 'Подписок не найдено',
          actionHtml: button('show-all', 'Показать все')
        });
    }
  }

  /**
   * Строка канала.
   *
   * Одна строка списка — 56 точек: аватар, имя с рейтингом, статус, справа
   * число фолловеров. Кнопки (избранное, фарминг, Twitch, отписка) видны
   * при наведении и фокусе и встают на место числа фолловеров. Раньше в
   * каждой строке висели четыре кнопки с цветными рамками, а одни и те же
   * цифры повторялись трижды (в аватаре, под именем и справа).
   *
   * Та же разметка — и для плитки: её перестраивает CSS.
   */
  renderSubscriptionItem(sub) {
    const isFavorite = sub.isFavorite || false;
    const classes = ['subscription-card', 'list-row', 'subs-row'];
    if (isFavorite) classes.push('is-favorite');
    if (this.isCurrentChannel(sub)) classes.push('is-current');
    if (this.isChannelInactive(sub)) classes.push('is-inactive');

    return `
      <div class="${classes.join(' ')}" data-channel-id="${this.esc(sub.id)}" tabindex="0" aria-label="${this.esc(this.rowLabel(sub))}"${isFavorite ? ' draggable="true"' : ''}>
        ${this.renderAvatar(sub)}
        ${this.renderMain(sub)}
        <div class="subs-side">
          ${this.renderFollowers(sub)}
          <div class="row-actions subs-actions subscription-card-actions">
            ${this.renderActionButtons(sub)}
          </div>
        </div>
      </div>
    `;
  }

  // Подпись строки для экранного диктора: имя и состояние
  rowLabel(sub) {
    const name = sub.displayName || sub.login || '';
    if (this.isCurrentChannel(sub)) return `${name}, смотрим сейчас`;
    if (sub.isLive === true) return `${name}, в эфире`;
    return `${name}, ${this.lastStreamPhrase(sub).toLowerCase()}`;
  }

  // Аватар с точкой «в эфире». Без картинки — первая буква имени на
  // нейтральном круге: прежняя заглушка была фиолетовым квадратом с «?»
  renderAvatar(sub, imgClass = 'row-avatar subscription-card-avatar') {
    const url = this.esc(this.safeImageUrl(sub.profileImageUrl));
    const initial = this.esc(String(sub.displayName || sub.login || '?').trim().charAt(0).toUpperCase() || '?');
    const image = url
      ? `<img class="${imgClass}" src="${url}" alt="" decoding="async" draggable="false">`
      : `<span class="${imgClass} subs-avatar-fallback" aria-hidden="true">${initial}</span>`;
    const live = sub.isLive === true ? '<span class="subs-live-dot" title="В эфире"></span>' : '';
    return `<div class="subs-avatar subscription-card-avatar-wrapper">${image}${live}</div>`;
  }

  renderMain(sub) {
    const name = this.esc(sub.displayName || sub.login || '');
    const favMark = sub.isFavorite
      ? `<span class="subs-fav-mark" title="В избранном">${this.icon('heart', 12)}</span>`
      : '';
    return `
          <div class="row-main subs-main subscription-card-info">
            <div class="subs-name-line">
              <span class="row-title subscription-card-name">${name}</span>${favMark}${this.renderRating(sub)}
            </div>
            <div class="row-meta subs-status subscription-card-status">${this.renderStatus(sub)}</div>
          </div>`;
  }

  /**
   * Оценка канала: нейтральный бейдж с цветной точкой.
   *
   * Раньше это была красная плашка «28» с восклицательным знаком у
   * каждого второго канала — тревога там, где тревожиться не о чем.
   * Цвет остался только в точке, объяснение — в подсказке.
   */
  ratingInfo(sub) {
    const has = Number.isFinite(sub.rating);
    const value = has ? Math.round(sub.rating) : null;
    const tone = !has ? '' : sub.rating >= 70 ? 'is-good' : sub.rating >= 40 ? 'is-mid' : 'is-low';
    const word = !has ? ''
      : sub.rating >= 70 ? this.i18n.t('subscriptions.excellent')
      : sub.rating >= 40 ? this.i18n.t('subscriptions.average')
      : this.i18n.t('subscriptions.low');
    const ratingText = !has ? ''
      : sub.rating >= 70 ? this.i18n.t('subscriptions.excellentRating')
      : sub.rating >= 40 ? this.i18n.t('subscriptions.averageRating')
      : this.i18n.t('subscriptions.lowRating');
    const title = has
      ? `${ratingText}: ${value} из 100. Складывается из эфиров, аудитории и дропсов на канале`
      : 'Рейтинг появится после загрузки данных канала';
    return { has, value, tone, word, title };
  }

  renderRating(sub) {
    const r = this.ratingInfo(sub);
    return `<span class="badge subs-rating subscription-card-rating-inline" title="${this.esc(r.title)}">`
      + (r.has ? `<span class="subs-rating-dot ${r.tone}"></span>` : '')
      + `<span class="num">${r.has ? r.value : '—'}</span></span>`;
  }

  // Состояние канала фразой: «В эфире · 2 ч 15 мин», «Был в эфире вчера»
  renderStatus(sub) {
    const parts = [];
    const isLive = sub.isLive === true;
    if (this.isCurrentChannel(sub)) {
      parts.push('<span class="subs-now">Смотрим сейчас</span>');
    } else if (isLive) {
      parts.push(`<span class="tone-ok">${this.esc(this.i18n.t('subscriptions.live'))}</span>`);
    }

    if (isLive || this.isCurrentChannel(sub)) {
      const uptime = isLive ? this.formatUptime(sub.lastStreamDate) : '';
      if (uptime) parts.push(`<span class="num" title="Эфир идёт">${uptime}</span>`);
    } else {
      // Неактивный канал и канал без данных — тише остальных: глазу проще
      // отделить тех, кто стримит
      const quiet = this.isChannelInactive(sub) || !Number.isFinite(Date.parse(sub.lastStreamDate));
      parts.push(`<span${quiet ? ' class="tone-muted"' : ''}>${this.esc(this.lastStreamPhrase(sub))}</span>`);
    }
    return parts.join('');
  }

  /**
   * «Был в эфире вчера» вместо отдельных «Офлайн» и «1 месяц назад».
   * Без даты эфира различаем «данных ещё нет» и «Twitch проверен, эфиров
   * не было»: раньше в обоих случаях стояло «Никогда».
   */
  lastStreamPhrase(sub) {
    if (!Number.isFinite(Date.parse(sub?.lastStreamDate))) {
      return sub?.detailsCheckedAt ? 'Эфиров не было' : 'Нет данных об эфирах';
    }
    const when = this.getLastStreamText(sub.lastStreamDate);
    if ((this.i18n?.currentLang || 'ru') !== 'ru') return when;
    return `Был в эфире ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
  }

  // Сколько идёт эфир: у идущего эфира дата — его начало
  formatUptime(start) {
    const ts = Date.parse(start);
    if (!Number.isFinite(ts)) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    // Эфир дольше двух суток — скорее устаревшая дата, чем правда
    if (minutes > 48 * 60) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} мин`;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }

  renderFollowers(sub) {
    const n = sub.followers;
    const known = typeof n === 'number' && Number.isFinite(n);
    const title = known
      ? `${n.toLocaleString('ru-RU')} ${this.plural(n, 'фолловер', 'фолловера', 'фолловеров')}`
      : 'Число фолловеров ещё не загружено';
    return `<span class="subs-followers num subscription-card-stats" title="${this.esc(title)}">${this.icon('users', 14)}<span>${this.formatFollowers(n)}</span></span>`;
  }

  // Кнопки строки. Классы favorite-btn/farm-btn/twitch-btn/unsub-btn —
  // по ним список понимает, что нажато
  renderActionButtons(sub) {
    const fav = !!sub.isFavorite;
    const favTitle = this.esc(fav ? this.i18n.t('subscriptions.removeFromFavorites') : this.i18n.t('subscriptions.addToFavorites'));
    const twitchTitle = this.esc(this.i18n.t('subscriptions.openOnTwitch'));
    const unsubTitle = this.esc(this.i18n.t('subscriptions.unsubscribe'));
    const farmTitle = 'Фармить на этом канале';
    return `
              <button type="button" class="btn btn-ghost btn-icon btn-sm subscription-action-btn favorite-btn${fav ? ' active' : ''}" title="${favTitle}" aria-label="${favTitle}" aria-pressed="${fav}">${this.icon('heart', 14)}</button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm subscription-action-btn farm-btn" title="${farmTitle}" aria-label="${farmTitle}">${this.icon('play', 14)}</button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm subscription-action-btn twitch-btn" title="${twitchTitle}" aria-label="${twitchTitle}">${this.icon('external', 14)}</button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm subscription-action-btn unsub-btn" title="${unsubTitle}" aria-label="${unsubTitle}">${this.icon('close', 14)}</button>`;
  }

  formatFollowers(count) {
    // Неизвестное число — прочерк, а не ноль: раньше до загрузки
    // подробностей (и при их сбое) у всех каналов стояло «0»
    if (typeof count !== 'number' || !Number.isFinite(count)) return '—';
    // По-русски: «2,5 млн», «343 тыс.», а не «2.5M» и «343.3K»
    const ru = (this.i18n?.currentLang || 'ru') === 'ru';
    const short = (v) => {
      const r = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
      return ru ? String(r).replace('.', ',') : String(r);
    };
    // 999 950 округлилось бы в «1000 тыс.» — такие уже миллион
    if (count >= 999500) return short(count / 1e6) + (ru ? ' млн' : 'M');
    if (count >= 1000) return short(count / 1e3) + (ru ? ' тыс.' : 'K');
    return count.toString();
  }

  /**
   * Пришли подробности канала — обновляем его строку на месте.
   *
   * Меняются аватар, имя со статусом и фолловеры; кнопки остаются теми же
   * узлами, поэтому строка под курсором не мигает. Кеш разметки сбрасываем:
   * DOM уже не совпадает с ним, и следующая отрисовка должна пройти.
   */
  updateChannelCard(sub) {
    const card = document.querySelector(`#subscriptions-list ${this.cardSelector(sub.id)}`);
    if (!card) return;
    this._renderedHtml = null;

    const swap = (selector, html) => {
      const el = card.querySelector(selector);
      if (el) el.outerHTML = html;
    };
    swap('.subs-avatar', this.renderAvatar(sub));
    swap('.subs-main', this.renderMain(sub));
    swap('.subs-followers', this.renderFollowers(sub));

    card.classList.toggle('is-inactive', this.isChannelInactive(sub));
    card.classList.toggle('is-current', this.isCurrentChannel(sub));
    card.setAttribute('aria-label', this.rowLabel(sub));

    // Числа у фильтров («В эфире 3») растут по мере прихода данных
    this.updateStats();
  }

  getLastStreamText(lastStreamDate) {
    if (!lastStreamDate) return this.i18n.t('subscriptions.never');

    const ts = new Date(lastStreamDate).getTime();
    if (!Number.isFinite(ts)) return this.i18n.t('subscriptions.never');
    // У идущего эфира дата — его начало. Часы компьютера могут чуть
    // отставать от Twitch, и только что начатый эфир оказывался «в будущем»:
    // выходило «-1 день назад»
    const days = Math.max(0, Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24)));

    if (days === 0) return this.i18n.t('subscriptions.today');
    if (days === 1) return this.i18n.t('subscriptions.yesterday');
    // Падежи по числу: раньше выходило «2 дней назад», «1 недель назад»
    // и «1 месяцев назад». Единицу не пишем: говорят «месяц назад», а не
    // «1 месяц назад»
    const ago = (n, одна, две, много) => n === 1 ? `${одна} назад` : `${n} ${this.plural(n, одна, две, много)} назад`;
    if (days < 7) return ago(days, 'день', 'дня', 'дней');
    if (days < 30) return ago(Math.floor(days / 7), 'неделю', 'недели', 'недель');
    if (days < 365) return ago(Math.floor(days / 30), 'месяц', 'месяца', 'месяцев');
    return ago(Math.floor(days / 365), 'год', 'года', 'лет');
  }

  /**
   * Окно канала.
   *
   * Раньше это был цветной плакат: размытая аватарка фоном, три плитки
   * разного цвета (зелёная, синяя, фиолетовая), эмодзи-кружки активности
   * и красная пульсирующая точка. Теперь — обычное окно приложения: шапка
   * с аватаром и статусом, три числа без подложек, кнопки внизу. Цвет —
   * только в точках статуса и у главной кнопки.
   */
  showChannelDetails(sub) {
    const modal = document.getElementById('channel-detail-modal');
    const content = document.getElementById('modal-content');
    if (!modal || !content || !sub) return;

    const wasOpen = this._modalSub != null;
    this._modalSub = sub;
    this._modalReturnId = sub.id;
    content.innerHTML = this.renderChannelDetails(sub);

    document.getElementById('farm-channel-detail-btn')?.addEventListener('click', () => {
      this.closeModal();
      this.startFarmingChannel(sub);
    });

    document.getElementById('view-twitch-btn')?.addEventListener('click', () => this.openOnTwitch(sub));

    document.getElementById('fav-channel-detail-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      await this.toggleFavorite(sub);
      this.syncFavoriteButton(btn, sub);
    });

    document.getElementById('unsub-channel-detail-btn')?.addEventListener('click', () => {
      this.closeModal();
      this.unsubscribeChannel(sub);
    });

    modal.style.display = 'flex';

    // Описание обрезано тремя строками; кнопка «Показать полностью» нужна,
    // только если текст действительно не поместился. Мерить можно лишь
    // после показа окна
    const desc = document.getElementById('channel-description');
    const more = document.getElementById('show-more-desc');
    if (desc && more) {
      requestAnimationFrame(() => {
        if (desc.scrollHeight <= desc.clientHeight + 1) return;
        more.hidden = false;
        more.addEventListener('click', () => {
          const open = desc.classList.toggle('is-expanded');
          more.textContent = open ? 'Свернуть' : 'Показать полностью';
          more.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      });
    }

    if (!wasOpen) document.addEventListener('keydown', this._onModalKeydown, true);

    // Фокус — на само окно, а не на «Фармить»: окно открывается и с
    // клавиатуры (Enter по строке), и повтор зажатой клавиши запустил бы
    // фарминг. Tab дальше ведёт по кнопкам окна
    modal.querySelector('.subs-channel-dialog')?.focus({ preventScroll: true });
  }

  renderChannelDetails(sub) {
    const isLive = sub.isLive === true;
    const current = this.isCurrentChannel(sub);
    const name = this.esc(sub.displayName || sub.login || '');
    const rating = this.ratingInfo(sub);

    // Дата эфира неизвестна — так и пишем. Раньше она подменялась 1970 годом,
    // и любой канал без загруженных данных выглядел «неактивным»
    const lastStreamTs = Date.parse(sub.lastStreamDate);
    const activityKnown = isLive || Number.isFinite(lastStreamTs);
    const daysSinceStream = isLive ? 0 : (Date.now() - lastStreamTs) / (1000 * 60 * 60 * 24);
    const activity = !activityKnown
      ? { text: 'Нет данных', dot: '' }
      : isLive ? { text: this.i18n.t('subscriptions.live'), dot: 'is-ok' }
      : daysSinceStream > 30 ? { text: this.i18n.t('subscriptions.inactive'), dot: '' }
      : daysSinceStream > 7 ? { text: this.i18n.t('subscriptions.rarely'), dot: 'is-wait' }
      : { text: this.i18n.t('subscriptions.activeStatus'), dot: 'is-ok' };
    const activitySub = isLive
      ? (this.formatUptime(sub.lastStreamDate) ? `Эфир идёт ${this.formatUptime(sub.lastStreamDate)}` : 'Эфир идёт сейчас')
      : this.lastStreamPhrase(sub);

    const followersKnown = typeof sub.followers === 'number' && Number.isFinite(sub.followers);
    const fav = !!sub.isFavorite;

    return `
      <div class="dialog-head subs-channel-head">
        ${this.renderAvatar(sub, 'subs-channel-img')}
        <div class="subs-channel-id">
          <h2 class="dialog-title" id="channel-dialog-title">${name}</h2>
          <div class="row-meta subs-channel-meta">
            <span>@${this.esc(sub.login)}</span>${current ? '<span class="subs-now">Смотрим сейчас</span>' : isLive ? `<span class="tone-ok">${this.esc(this.i18n.t('subscriptions.live'))}</span>` : ''}
          </div>
        </div>
      </div>

      <div class="dialog-body subs-channel-body">
        ${sub.description ? `
        <div class="subs-channel-desc-wrap">
          <p class="subs-channel-desc" id="channel-description">${this.esc(sub.description)}</p>
          <button type="button" class="subs-link-btn" id="show-more-desc" aria-controls="channel-description" aria-expanded="false" hidden>Показать полностью</button>
        </div>` : ''}

        <div class="subs-channel-stats">
          <div class="kpi kpi-inline">
            <div class="kpi-label">${this.esc(this.i18n.t('subscriptions.rating'))}</div>
            <div class="kpi-value" title="${this.esc(rating.title)}">${rating.has ? `${rating.value}<span class="subs-kpi-of">из 100</span>` : '—'}</div>
            <div class="kpi-sub">${rating.has ? `<span class="subs-rating-dot ${rating.tone}"></span>${this.esc(rating.word)}` : 'Появится после загрузки'}</div>
          </div>
          <div class="kpi kpi-inline">
            <div class="kpi-label">Фолловеры</div>
            <div class="kpi-value">${this.formatFollowers(sub.followers)}</div>
            <div class="kpi-sub">${followersKnown ? sub.followers.toLocaleString('ru-RU') : 'Ещё не загружено'}</div>
          </div>
          <div class="kpi kpi-inline">
            <div class="kpi-label">${this.esc(this.i18n.t('subscriptions.activity'))}</div>
            <div class="kpi-value subs-kpi-state"><span class="status-dot ${activity.dot}"></span><span>${this.esc(activity.text)}</span></div>
            <div class="kpi-sub">${this.esc(activitySub)}</div>
          </div>
        </div>

        ${sub.hasDrops ? `
        <div class="subs-channel-perk">
          ${this.icon('gift', 16)}
          <span>${this.esc(this.i18n.t('subscriptions.canGetRewards'))}</span>
        </div>` : ''}

        <p class="subs-channel-note">
          ${this.icon('info', 14)}
          <span>Рейтинг упорядочивает список: эфиры дают до 45 баллов, аудитория — до 25, дропсы на канале — до 30.</span>
        </p>
      </div>

      <div class="dialog-foot subs-channel-foot">
        <button type="button" class="btn btn-danger-ghost" id="unsub-channel-detail-btn">${this.esc(this.i18n.t('subscriptions.unsubscribe'))}</button>
        <span class="subs-foot-spacer"></span>
        <button type="button" class="btn btn-secondary btn-icon" id="view-twitch-btn" title="${this.esc(this.i18n.t('subscriptions.openOnTwitch'))}" aria-label="${this.esc(this.i18n.t('subscriptions.openOnTwitch'))}">${this.icon('external', 16)}</button>
        <button type="button" class="btn btn-secondary subs-fav-toggle" id="fav-channel-detail-btn" aria-pressed="${fav}">${this.icon('heart', 16)}<span>${fav ? 'В избранном' : 'В избранное'}</span></button>
        <button type="button" class="btn btn-primary" id="farm-channel-detail-btn">${this.icon('play', 16)}<span>Фармить на канале</span></button>
      </div>
    `;
  }

  // Кнопка «В избранное» в окне после переключения
  syncFavoriteButton(btn, sub) {
    if (!btn || !btn.isConnected) return;
    const fav = !!sub.isFavorite;
    btn.setAttribute('aria-pressed', fav ? 'true' : 'false');
    const label = btn.querySelector('span');
    if (label) label.textContent = fav ? 'В избранном' : 'В избранное';
  }

  // Esc закрывает окно, Tab не уходит за его пределы
  handleModalKeydown(e) {
    if (this._modalSub == null) return;
    // Поверх окна канала может быть открыто подтверждение — клавиши его
    if (document.getElementById('confirmation-modal')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closeModal();
      return;
    }

    if (e.key !== 'Tab') return;
    const dialog = document.querySelector('#channel-detail-modal .subs-channel-dialog');
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]):not([hidden]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  closeModal() {
    const modal = document.getElementById('channel-detail-modal');
    if (modal) modal.style.display = 'none';
    document.removeEventListener('keydown', this._onModalKeydown, true);
    const returnId = this._modalReturnId;
    this._modalSub = null;
    this._modalReturnId = null;

    // Фокус — обратно на строку канала. Список мог перерисоваться, пока
    // окно было открыто (например, канал добавили в избранное), поэтому
    // строку ищем заново по id
    if (returnId != null && !this._destroyed) {
      const row = document.querySelector(`#subscriptions-list ${this.cardSelector(returnId)}`);
      row?.focus({ preventScroll: true });
    }
  }

  // Элементы страницы к этому моменту могут быть уже удалены (со страницы
  // ушли, пока шла загрузка), поэтому стиль ставим только существующим
  setDisplay(id, value) {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
  }

  showAuthSection() {
    this.setDisplay('subscriptions-auth-section', 'block');
    this.setDisplay('subscriptions-content', 'none');
    // Обновлять и чистить без входа нечего
    const actions = document.getElementById('subs-page-actions');
    if (actions) actions.hidden = true;
  }

  showContentSection() {
    this.setDisplay('subscriptions-auth-section', 'none');
    this.setDisplay('subscriptions-content', 'block');
    const actions = document.getElementById('subs-page-actions');
    if (actions) actions.hidden = false;
  }

  /**
   * Ненавязчивая отметка «обновляю» поверх уже показанного списка.
   *
   * Прятать список ради спиннера незачем: старые данные полезнее пустого
   * места, а обновление занимает секунду-другую. Пока идёт обновление,
   * крутится значок «Обновить» в шапке (CSS по классу списка).
   */
  showRefreshingHint() {
    const list = document.getElementById('subscriptions-list');
    if (!list) return;

    list.classList.add('refreshing');
    list.setAttribute('aria-busy', 'true');
  }

  hideRefreshingHint() {
    const list = document.getElementById('subscriptions-list');
    list?.classList.remove('refreshing');
    list?.removeAttribute('aria-busy');
  }

  showLoadingState() {
    this.setDisplay('subscriptions-loading', 'block');
    this.setDisplay('subscriptions-list', 'none');
    this.setDisplay('subscriptions-empty', 'none');
  }

  hideLoadingState() {
    this.setDisplay('subscriptions-loading', 'none');
    this.hideRefreshingHint();
  }

  showEmptyState() {
    this.setDisplay('subscriptions-loading', 'none');
    this.setDisplay('subscriptions-list', 'none');
    const empty = document.getElementById('subscriptions-empty');
    if (empty) {
      empty.innerHTML = this.renderEmptyState();
      empty.style.display = 'block';
    }
  }

  async refreshSubscriptions() {
    if (this._refreshing) return;
    this._refreshing = true;

    // Кнопка — одна иконка без текста. Раньше на время загрузки в неё
    // ставился текст «Загрузка...»: панель прыгала. Теперь, пока идёт
    // загрузка, иконка просто крутится (класс is-spinning)
    const btn = document.getElementById('refresh-subs-btn');
    if (btn) {
      btn.classList.add('is-spinning');
      btn.setAttribute('aria-busy', 'true');
    }

    try {
      // Тост успеха — только если Twitch действительно отдал список.
      // О неудаче loadSubscriptions сообщает сама
      const ok = await this.loadSubscriptions({ force: true });
      if (ok && !this._destroyed) window.utils.showToast('Подписки обновлены', 'success');
    } catch (error) {
      window.utils.showToast('Ошибка обновления подписок', 'error');
    } finally {
      this._refreshing = false;
      if (btn) {
        btn.classList.remove('is-spinning');
        btn.removeAttribute('aria-busy');
      }
    }
  }

  /**
   * «Очистить неактивные»: массовая отписка на Twitch.
   *
   * Раньше неактивным считался любой канал не в эфире прямо сейчас, а при
   * несработавших подробностях — вообще все. Одно нажатие отписывало почти
   * от всех подписок, ошибки отписки не проверялись, а из списка каналы
   * убирались в любом случае.
   *
   * Теперь под очистку попадают только каналы, у которых дата последнего
   * эфира проверена недавно и старше 30 дней. Избранные и идущие в эфире
   * не трогаются. Перед отпиской — список с галочками, отписка по одному
   * с прогрессом на кнопке, из списка убираются только успешно отписанные.
   */
  async cleanupInactive() {
    if (this._cleanupRunning) return;

    const candidates = this.subscriptions.filter(s =>
      !s.isFavorite &&
      this.isChannelInactive(s) &&
      this.isDetailsFresh(s, SubscriptionsPage.CLEANUP_CHECK_MAX_AGE_MS)
    );

    if (candidates.length === 0) {
      // Дата есть только в старых сохранённых данных — по ней не отписываем
      const unchecked = this.subscriptions.some(s => !s.isFavorite && this.isChannelInactive(s));
      window.utils.showToast(
        this.isDetailsLoading()
          ? 'Данные каналов ещё загружаются — попробуйте чуть позже'
          : unchecked
            ? 'Активность каналов давно не проверялась — нажмите «Обновить»'
            : 'Нет каналов, которые не стримили больше 30 дней',
        'info'
      );
      return;
    }

    const rows = candidates.map(s => {
      const url = this.esc(this.safeImageUrl(s.profileImageUrl));
      const avatar = url
        ? `<img class="subs-cleanup-avatar" src="${url}" alt="" decoding="async" draggable="false">`
        : '<span class="subs-cleanup-avatar" aria-hidden="true"></span>';
      return `
        <label class="subs-cleanup-row">
          <input type="checkbox" data-sub-id="${this.esc(s.id)}" checked>
          ${avatar}
          <span class="subs-cleanup-name">${this.esc(s.displayName || s.login)}</span>
          <span class="subs-cleanup-when">${this.esc(this.getLastStreamText(s.lastStreamDate))}</span>
        </label>`;
    }).join('');

    const modalHtml = `
      <div id="subs-cleanup-confirm" class="subs-confirm">
        <h3 class="subs-confirm-title">Отписаться от неактивных каналов?</h3>
        <p class="subs-confirm-text">Эти каналы не стримили больше 30 дней. Снимите галочки с тех, кого хотите оставить. Отписка выполнится на Twitch; избранные сюда не попадают.</p>
        <div class="subs-cleanup-bar">
          <span data-cleanup-count></span>
          <button type="button" class="subs-link-btn" data-cleanup-all></button>
        </div>
        <div class="subs-cleanup-list">${rows}</div>
      </div>
    `;

    const confirmLabel = (n) => `Отписаться от ${n}`;
    const selected = new Set(candidates.map(s => String(s.id)));

    const pending = window.utils.showCustomConfirmation(modalHtml, {
      confirmText: confirmLabel(candidates.length),
      cancelText: 'Отмена',
      confirmClass: 'btn-danger'
    });

    // Окно уже в документе: следим за галочками и держим число на кнопке
    // в соответствии с выбором
    const root = document.getElementById('subs-cleanup-confirm');
    const okBtn = root?.closest('#confirmation-modal')?.querySelector('#confirm-ok')
      || document.getElementById('confirm-ok');
    if (okBtn) {
      // «Отписаться от 12» не помещалось в прежнюю ширину кнопки окна
      okBtn.style.maxWidth = 'none';
      okBtn.style.whiteSpace = 'nowrap';
    }
    const countEl = root?.querySelector('[data-cleanup-count]');
    const allBtn = root?.querySelector('[data-cleanup-all]');
    const sync = () => {
      const n = selected.size;
      if (countEl) countEl.textContent = `Выбрано ${n} из ${candidates.length}`;
      if (allBtn) allBtn.textContent = n === candidates.length ? 'Снять все' : 'Выбрать все';
      if (okBtn) {
        okBtn.textContent = confirmLabel(n);
        okBtn.disabled = n === 0;
      }
    };
    sync();

    root?.addEventListener('change', (e) => {
      const box = e.target.closest?.('input[data-sub-id]');
      if (!box) return;
      if (box.checked) selected.add(box.dataset.subId);
      else selected.delete(box.dataset.subId);
      sync();
    });
    allBtn?.addEventListener('click', () => {
      const check = selected.size !== candidates.length;
      root.querySelectorAll('input[data-sub-id]').forEach(box => {
        box.checked = check;
        if (check) selected.add(box.dataset.subId);
        else selected.delete(box.dataset.subId);
      });
      sync();
    });

    if (!(await pending)) return;

    const targets = candidates.filter(s => selected.has(String(s.id)));
    if (targets.length === 0) return;

    this._cleanupRunning = true;
    const btn = document.getElementById('cleanup-subs-btn');
    const originalHtml = btn?.innerHTML;
    const label = btn?.querySelector('span');
    if (btn) btn.disabled = true;

    const done = [];
    let failed = 0;
    let crashed = false;

    try {
      for (let i = 0; i < targets.length; i++) {
        const sub = targets[i];
        // Отписка занимает секунды на канал: без прогресса казалось, что
        // ничего не происходит, и кнопку нажимали ещё раз
        const progress = `Отписываюсь… ${i + 1} из ${targets.length}`;
        if (label) label.textContent = progress;
        else if (btn) btn.textContent = progress;

        let result = null;
        try {
          result = await window.electronAPI.unsubscribeChannel(null, sub.login);
        } catch (e) {
          result = { success: false, error: e?.message };
        }

        if (result?.success) {
          done.push(sub.id);
        } else {
          failed++;
          console.warn('[Subscriptions] Не удалось отписаться от', sub.login, result?.error);
        }
      }

      await this.forgetChannels(done);
    } catch (error) {
      crashed = true;
      console.error('Error cleaning up subscriptions:', error);
    } finally {
      this._cleanupRunning = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }

    const ok = done.length;
    const total = targets.length;
    if (crashed) {
      window.utils.showToast('Ошибка при удалении подписок', 'error');
    } else if (failed === 0) {
      window.utils.showToast(`Отписались от ${ok} ${this.plural(ok, 'канала', 'каналов', 'каналов')}`, 'success');
    } else if (ok === 0) {
      window.utils.showToast('Не удалось отписаться ни от одного канала — они остались в списке', 'error');
    } else {
      window.utils.showToast(`Отписались от ${ok} из ${total}, не удалось: ${failed} — они остались в списке`, 'warning');
    }
  }

  /**
   * Убирает отписанные каналы из списка и с диска.
   *
   * Если со страницы уже ушли, правим то, что лежит на диске: список этого
   * экземпляра мог устареть, и его запись затёрла бы изменения, сделанные
   * на заново открытой странице.
   */
  async forgetChannels(ids) {
    const gone = new Set(ids);
    if (gone.size === 0) return;

    this.subscriptions = this.subscriptions.filter(s => !gone.has(s.id));

    if (this._destroyed) {
      const stored = (await Storage.getSubscriptions()) || [];
      await Storage.saveSubscriptions(stored.filter(s => !gone.has(s?.id)));
      return;
    }

    await Storage.saveSubscriptions(this.subscriptions);
    this.applyFilter();
  }

  async unsubscribeChannel(sub) {
    // Аватар в вопросе — чтобы было видно, от кого именно отписываемся:
    // имена каналов бывают похожими (ewc_…_en и ewc_…_ar)
    const url = this.esc(this.safeImageUrl(sub.profileImageUrl));
    const avatar = url
      ? `<img class="subs-confirm-avatar" src="${url}" alt="" draggable="false">`
      : '';
    const modalHtml = `
      <div class="subs-confirm">
        <div class="subs-confirm-head">
          ${avatar}
          <h3 class="subs-confirm-title">Отписаться от ${this.esc(sub.displayName || sub.login)}?</h3>
        </div>
        <p class="subs-confirm-text">Отписка выполнится прямо здесь, переходить на Twitch не нужно.${sub.isFavorite ? ' Канал уйдёт и из избранного.' : ''}</p>
      </div>
    `;

    const confirmed = await window.utils.showCustomConfirmation(modalHtml, {
      confirmText: 'Отписаться',
      cancelText: 'Отмена',
      confirmClass: 'btn-danger'
    });

    if (!confirmed) return;

    try {
      // Настоящая отписка через Twitch. Раньше приложение только убирало
      // канал из своего списка и открывало сайт, предлагая отписаться
      // вручную — при том, что вызов для отписки давно был реализован,
      // просто его никто не вызывал.
      // Передаём login: отписка выполняется действием на самой странице
      // канала, а не запросом по идентификатору
      const result = await window.electronAPI.unsubscribeChannel(null, sub.login);

      if (!result?.success) {
        console.error('Не удалось отписаться:', result?.error);
        window.utils.showToast(
          'Не удалось отписаться: ' + (result?.error || 'неизвестная ошибка'),
          'error'
        );
        return;
      }

      // Из списка убираем только после подтверждённой отписки, иначе канал
      // исчезал бы из приложения, оставаясь в подписках на Twitch
      await this.forgetChannels([sub.id]);

      const name = sub.displayName || sub.login;
      window.utils.showToast(
        result.already
          ? `Вы уже не подписаны на ${name}`
          : `Отписка от ${name} выполнена`,
        'success'
      );
    } catch (error) {
      console.error('Error removing subscription:', error);
      window.utils.showToast('Ошибка при отписке', 'error');
    }
  }

  /**
   * «Начать фарминг» с карточки канала.
   *
   * Раньше вызывался несуществующий router.switchPage — переход падал с
   * ошибкой, а тост «Начинаем фарминг» появлялся до того, как стало
   * известно, получилось ли. Теперь тост — по результату.
   */
  async startFarmingChannel(sub) {
    if (this._startingFarm) return;
    this._startingFarm = true;
    // После восстановления из копии displayName может быть пустым
    const name = sub.displayName || sub.login;

    try {
      // Страница фарминга создаётся при запуске приложения и живёт всё
      // время, но если её почему-то нет — сначала открываем её, иначе
      // добавлять канал некуда
      if (!window.farmingPage?.addChannelToFarming) {
        await window.router?.navigate('farming');
      }

      const farming = window.farmingPage;
      if (!farming?.addChannelToFarming) {
        window.utils.showToast('Страница фарминга ещё не готова — попробуйте ещё раз', 'warning');
        return;
      }

      window.utils.showToast(`Запускаю ${name}…`, 'info');
      // Имя и аватарка нужны фармингу для тостов и карточки стрима: без них
      // там стоял логин («ow_esports_kr сейчас не в эфире») и пустая аватарка
      const result = await farming.addChannelToFarming(sub.login, {
        displayName: name,
        profileImageUrl: this.safeImageUrl(sub.profileImageUrl) || null
      });

      // { ok: false, reason } — канал запустить нельзя (офлайн, у игры нет
      // дропсов). Остаёмся на подписках и объясняем почему
      if (result?.ok === false) {
        const reason = typeof result.reason === 'string' && /[а-яё]/i.test(result.reason)
          ? result.reason
          : `Не удалось запустить ${name}`;
        window.utils.showToast(reason, 'warning');
        return;
      }

      // Прежняя версия ничего не возвращала и сама сообщала о неудаче,
      // поэтому без явного отказа просто переходим на фарминг. Запуск
      // занимает несколько секунд: если за это время пользователь ушёл на
      // другую страницу, не выдёргиваем его оттуда — хватит тоста
      if (!this._destroyed && window.router && window.router.currentPage !== 'farming') {
        await window.router.navigate('farming');
      }
      if (result?.ok === true) {
        window.utils.showToast(`Фарминг ${name} запущен`, 'success');
      }
    } catch (error) {
      console.error('Error starting farming:', error);
      window.utils.showToast('Ошибка при запуске фарминга', 'error');
    } finally {
      this._startingFarm = false;
    }
  }

  async toggleFavorite(sub) {
    try {
      sub.isFavorite = !sub.isFavorite;

      // Обновляем в массиве
      const index = this.subscriptions.findIndex(s => s.id === sub.id);
      if (index !== -1) {
        this.subscriptions[index].isFavorite = sub.isFavorite;
      }

      // Сохраняем
      await Storage.saveSubscriptions(this.subscriptions);

      // Перерисовываем
      this.applyFilter();

      // После восстановления из копии displayName бывает пустым — как и в
      // остальных тостах страницы, тогда показываем логин, а не «null»
      const name = sub.displayName || sub.login;
      window.utils.showToast(
        sub.isFavorite ? `${name} добавлен в избранное` : `${name} убран из избранного`,
        'success'
      );
    } catch (error) {
      console.error('Error toggling favorite:', error);
      window.utils.showToast('Ошибка при обновлении избранного', 'error');
    }
  }

  // Вид списка задают классы: .list — строки с разделителями,
  // .subscriptions-grid-view — плитка. Класс refreshing при этом остаётся:
  // раньше className перезаписывался целиком и стирал его
  updateViewMode() {
    const list = document.getElementById('subscriptions-list');
    if (!list) return;

    const grid = this.currentView === 'grid';
    list.classList.toggle('list', !grid);
    list.classList.toggle('subscriptions-list-view', !grid);
    list.classList.toggle('subscriptions-grid-view', grid);
  }

  setView(view, { remember = true } = {}) {
    if (view !== 'list' && view !== 'grid') return;
    this.currentView = view;
    document.querySelectorAll('#subs-view button[data-view]').forEach(b => {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    this.updateViewMode();
    if (!remember) return;
    try {
      localStorage.setItem(SubscriptionsPage.VIEW_STORAGE_KEY, view);
    } catch (e) {
      // Хранилище недоступно — вид просто не запомнится
    }
  }

  // Плитку выбирают осознанно, и каждый раз переключать её заново
  // неудобно — вид запоминается для этого окна
  restoreViewMode() {
    let saved = null;
    try {
      saved = localStorage.getItem(SubscriptionsPage.VIEW_STORAGE_KEY);
    } catch (e) {
      saved = null;
    }
    if (saved === 'grid') this.setView('grid', { remember: false });
  }

  async savePrioritySetting(enabled) {
    try {
      await Storage.setItem('subscriptions_priority_enabled', enabled);
      window.utils.showToast(
        enabled ? 'Приоритет подписок включён' : 'Приоритет подписок отключён',
        'success'
      );
    } catch (error) {
      console.error('Error saving priority setting:', error);
    }
  }

  async loadPrioritySetting() {
    try {
      const enabled = await Storage.getItem('subscriptions_priority_enabled');
      const toggle = document.getElementById('priority-subs-toggle');
      if (toggle) {
        toggle.checked = enabled || false;
      }
    } catch (error) {
      console.error('Error loading priority setting:', error);
    }
  }

  // Перетаскивание. Слушает сам список: строки перерисовываются, а
  // обработчики на них терялись бы. Тащить можно только избранные — им
  // разметка ставит draggable
  handleDragStart(e) {
    const card = e.target.closest?.('.subscription-card[draggable="true"]');
    const sub = card && this.findSub(card.dataset.channelId);
    if (!sub) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(sub.id));
    card.classList.add('dragging');
    this.draggedSub = sub;
    // После броска список перерисовывается, и эта строка уже вне
    // документа: её dragend до списка не всплывёт. Без своего слушателя
    // перетаскивание «залипало», и файл, протащенный над окном позже,
    // переставлял бы избранные
    card.addEventListener('dragend', () => this.handleDragEnd(), { once: true });
  }

  handleDragEnd() {
    this.draggedSub = null;
    document.querySelectorAll('#subscriptions-list .subscription-card.dragging, #subscriptions-list .subscription-card.drag-over')
      .forEach(card => card.classList.remove('dragging', 'drag-over'));
  }

  // Бросить можно только на другое избранное: обычные каналы сортируются
  // по рейтингу, и подсветка над ними обещала бы перестановку, которой не будет
  handleDragOver(e) {
    if (!this.draggedSub) return;
    const card = e.target.closest?.('.subscription-card');
    if (!card || card.getAttribute('draggable') !== 'true') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!card.classList.contains('dragging')) card.classList.add('drag-over');
  }

  handleDragLeave(e) {
    const card = e.target.closest?.('.subscription-card');
    // Переход курсора на дочерний элемент строки — не уход со строки
    if (card && !card.contains(e.relatedTarget)) {
      card.classList.remove('drag-over');
    }
  }

  async handleDrop(e) {
    const card = e.target.closest?.('.subscription-card');
    if (card) {
      card.classList.remove('drag-over');
    }
    const targetSub = card && this.findSub(card.dataset.channelId);
    if (!targetSub) return false;
    e.preventDefault();
    e.stopPropagation();

    // Бросок завершает перетаскивание при любом исходе: перерисовка ниже
    // убирает исходную строку вместе с отметками
    const draggedSub = this.draggedSub;
    this.handleDragEnd();

    if (!draggedSub || draggedSub.id === targetSub.id) {
      return false;
    }

    // Порядок задаётся только между избранными
    if (!draggedSub.isFavorite || !targetSub.isFavorite) {
      return false;
    }

    // Получаем индексы
    const draggedIndex = this.filteredSubscriptions.findIndex(s => s.id === draggedSub.id);
    const targetIndex = this.filteredSubscriptions.findIndex(s => s.id === targetSub.id);

    if (draggedIndex === -1 || targetIndex === -1) {
      return false;
    }

    // Меняем местами в filteredSubscriptions
    const temp = this.filteredSubscriptions[draggedIndex];
    this.filteredSubscriptions[draggedIndex] = this.filteredSubscriptions[targetIndex];
    this.filteredSubscriptions[targetIndex] = temp;

    // Обновляем приоритет ТОЛЬКО для избранных каналов
    const newPriorities = new Map();
    this.filteredSubscriptions.forEach((sub, index) => {
      if (sub.isFavorite) {
        newPriorities.set(sub.id, index);
      }
    });

    let changed = false;
    this.subscriptions.forEach(sub => {
      if (newPriorities.has(sub.id) && sub.priority !== newPriorities.get(sub.id)) {
        sub.priority = newPriorities.get(sub.id);
        changed = true;
      }
    });

    // «Порядок обновлен» — только если он действительно изменился.
    // Иначе возвращаем список к сохранённому порядку
    if (!changed) {
      this.applyFilter();
      return false;
    }

    // Сохраняем
    await Storage.saveSubscriptions(this.subscriptions);

    // Перерисовываем
    this.renderSubscriptions();

    window.utils.showToast('Порядок избранных сохранён', 'success');

    return false;
  }
}

// Экспортируем класс в window для использования в router
window.SubscriptionsPage = SubscriptionsPage;
